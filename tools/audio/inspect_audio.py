"""Numeric + visual inspection of takes and delivered files.

Prints the numbers we can actually verify without ears (level, crest factor,
spectral centroid, loop seam error, stereo width) and renders a spectrogram
montage so the material can be eyeballed as well as measured.

Usage:
  python tools/audio/inspect_audio.py --raw click-testimony rain-light
  python tools/audio/inspect_audio.py --dir public/audio
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_lib as L  # noqa: E402

PROJ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def stats(x: np.ndarray, sr: int) -> dict:
    mono = x.mean(axis=0) if x.ndim > 1 else x
    peak = float(np.max(np.abs(mono)))
    rms = float(np.sqrt(np.mean(mono ** 2)))
    # spectral centroid on a 4096-point window average
    n = 4096
    win = np.hanning(n)
    cents, mags = [], []
    for i in range(0, max(1, len(mono) - n), n // 2):
        seg = mono[i:i + n] * win
        if len(seg) < n:
            break
        m = np.abs(np.fft.rfft(seg))
        f = np.fft.rfftfreq(n, 1 / sr)
        s = m.sum()
        if s > 1e-9:
            cents.append(float((f * m).sum() / s))
            mags.append(m)
    cent = float(np.mean(cents)) if cents else 0.0
    # octave-band energy share (rough timbre fingerprint)
    spec = np.mean(mags, axis=0) if mags else np.zeros(1)
    f = np.fft.rfftfreq(n, 1 / sr)
    total = spec.sum() + 1e-12
    bands = {"sub<60": (0, 60), "low60-250": (60, 250), "mid250-1k": (250, 1000),
             "hi1k-4k": (1000, 4000), "air4k-16k": (4000, 16000)}
    share = {k: float(spec[(f >= a) & (f < b)].sum() / total) for k, (a, b) in bands.items()}
    return {
        "dur_s": len(mono) / sr, "peak_dbfs": 20 * np.log10(max(peak, 1e-9)),
        "rms_dbfs": 20 * np.log10(max(rms, 1e-9)),
        "crest_db": 20 * np.log10(max(peak, 1e-9) / max(rms, 1e-9)),
        "centroid_hz": cent, "dc": float(mono.mean()),
        "clip_pct": float(np.mean(np.abs(mono) > 0.999) * 100), **share,
    }


def seam_error(x: np.ndarray) -> float:
    """|last - first| relative to RMS: rough 'is the loop point a click?' metric."""
    mono = x.mean(axis=0) if x.ndim > 1 else x
    rms = np.sqrt(np.mean(mono ** 2)) + 1e-12
    jump = abs(float(mono[-1]) - float(mono[0]))
    # also compare the step across the seam to typical adjacent-sample steps
    step = np.mean(np.abs(np.diff(mono)))
    return float(jump / step) if step > 0 else 0.0


def spectrogram_png(files: list[tuple[str, np.ndarray, int]], out: str,
                    title: str) -> str:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    n = len(files)
    fig, axes = plt.subplots(n, 1, figsize=(11, 1.75 * n + 0.6), squeeze=False)
    for ax, (name, x, sr) in zip(axes[:, 0], files):
        mono = x.mean(axis=0) if x.ndim > 1 else x
        ax.specgram(mono, NFFT=2048, Fs=sr, noverlap=1024, cmap="magma",
                    vmin=-120, vmax=-20)
        ax.set_ylim(0, 12000)
        ax.set_ylabel("Hz", fontsize=7)
        ax.tick_params(labelsize=6)
        ax.set_title(f"{name}  ({len(mono)/sr:.2f}s)", fontsize=8, loc="left")
    fig.suptitle(title, fontsize=9)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out


def load_any(path: str) -> tuple[np.ndarray, int]:
    if path.lower().endswith((".ogg", ".webm")):
        # decode via ffmpeg to raw f32le on stdout is awkward on Windows sandboxed
        # shells; use a temp wav instead.
        import subprocess
        import tempfile
        tmp = os.path.join(tempfile.gettempdir(), "inspect_tmp.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-c:a", "pcm_s16le", tmp],
                       check=True, capture_output=True)
        return L.load_wav(tmp)
    return L.load_wav(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", nargs="*", default=[], help="job ids to inspect")
    ap.add_argument("--dir", default="", help="directory of .ogg to inspect")
    ap.add_argument("--png", default="")
    args = ap.parse_args()

    items: list[tuple[str, np.ndarray, int]] = []
    if args.raw:
        for jid in args.raw:
            for f in sorted(glob.glob(os.path.join(L.OUT_DIR, "raw", f"{jid}__*.wav"))):
                x, sr = L.load_wav(f)
                items.append((os.path.basename(f)[:-4], x, sr))
    if args.dir:
        for f in sorted(glob.glob(os.path.join(PROJ, args.dir, "*.ogg"))):
            x, sr = load_any(f)
            items.append((os.path.basename(f)[:-4], x, sr))

    if not items:
        print("nothing to inspect")
        return 1

    print(f"{'name':38s} {'dur':>6s} {'peak':>7s} {'rms':>7s} {'crest':>6s} "
          f"{'cent':>6s} {'dc':>7s} {'clip%':>6s} {'seam':>6s}")
    for name, x, sr in items:
        s = stats(x, sr)
        print(f"{name[:38]:38s} {s['dur_s']:6.2f} {s['peak_dbfs']:7.1f} "
              f"{s['rms_dbfs']:7.1f} {s['crest_db']:6.1f} {s['centroid_hz']:6.0f} "
              f"{s['dc']:7.4f} {s['clip_pct']:6.2f} {seam_error(x):6.1f}")
    print("\nband share of average spectrum (sub / low / mid / hi / air)")
    for name, x, sr in items:
        s = stats(x, sr)
        print(f"{name[:38]:38s} {s['sub<60']:.2f} {s['low60-250']:.2f} "
              f"{s['mid250-1k']:.2f} {s['hi1k-4k']:.2f} {s['air4k-16k']:.2f}")

    png = args.png or os.path.join(L.OUT_DIR, "spectrograms.png")
    spectrogram_png(items, png, "spectrogram check")
    print(f"\nwrote {png}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
