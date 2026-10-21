"""Post-process raw takes into the delivered set in public/audio/.

What it does, per file:
  1. DC/rumble removal (biquad highpass).
  2. One-shots: pick one gesture around its strongest onset, window it, fade it,
     collapse to mono (a UI click must survive a phone speaker and never cancel
     in mono), then shape it into its carrier's own spectral pocket.
     Loops: build a seamless long loop (2 takes crossfaded when they match in
     timbre, otherwise one take wrapped and doubled), wrap-crossfade the loop
     point, and keep stereo.
  3. Loudness: short-term RMS target per group, true-peak capped at -1 dBFS.
  4. Resample 44.1 kHz -> 48 kHz (polyphase 160/147).
  5. Encode Ogg Vorbis via ffmpeg, then measure everything and write
     docs/audio/audio-manifest.json.

Usage:
  python tools/audio/post.py                 # build + manifest
  python tools/audio/post.py --format webm   # Opus/WebM instead (Safari fallback)
  python tools/audio/post.py --dry           # measure, write nothing
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_lib as L  # noqa: E402
import jobs as J  # noqa: E402

PROJ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUB = os.path.join(PROJ, "public", "audio")
DOCS = os.path.join(PROJ, "docs", "audio")
TARGET_SR = 48000

# Loudness targets. One-shots are levelled on the loudest 100 ms (a click is all
# transient), loops on full-file RMS. Kept conservative on purpose: this score sits
# under reading, it never leads.
LEVEL = {"carrier": -20.0, "material": -21.0, "ambience": -32.0, "drone": -34.0}
LEVEL_OVERRIDE = {
    "tape-hiss": -42.0,          # dirt layer, must sit under everything
    "radio-static": -38.0,
    "room-tone": -36.0,
    "distant-thud": -20.0,
    "drone-ending-message": -37.0,
    "flag-flap": -33.0,
}

# Per-carrier spectral shaping so the six carriers never blur together.
# (kind, freq, gain_db, q) with kind in low_shelf / high_shelf / peak / hp / lp
CARRIER_EQ = {
    "click-roster":    [("hp", 40, 0, 0.7), ("low_shelf", 300, 4.5, 0.7),
                        ("high_shelf", 6000, -3.0, 0.7)],
    "click-letters":   [("hp", 220, 0, 0.7), ("high_shelf", 3000, 3.5, 0.7),
                        ("low_shelf", 250, -3.0, 0.7)],
    "click-flag":      [("hp", 110, 0, 0.7), ("peak", 520, 3.0, 1.2),
                        ("peak", 1500, 2.0, 1.0), ("low_shelf", 200, -1.5, 0.7)],
    "click-photo":     [("hp", 380, 0, 0.8), ("lp", 7000, 0, 0.8),
                        ("peak", 2600, 4.0, 1.4)],
    "click-testimony": [("hp", 380, 0, 0.7), ("peak", 4200, 4.0, 1.0),
                        ("low_shelf", 600, -3.0, 0.7)],
    "click-message":   [("hp", 260, 0, 0.7), ("peak", 2000, 2.0, 1.2),
                        ("high_shelf", 5000, -2.0, 0.7)],
}

# Ambience/drone shaping: take out sub-rumble that would only eat bitrate on
# laptop speakers, and tame any tonal whistles the model added.
GROUP_EQ = {
    "ambience": [("hp", 35, 0, 0.7)],
    "drone":    [("hp", 30, 0, 0.7), ("high_shelf", 9000, -2.0, 0.7)],
    "material": [("hp", 30, 0, 0.7)],
}

LOOP_SECONDS = 22.0        # delivered loop length (plan asks 20-30 s)
WRAP_XFADE = 1.2           # crossfade folded across the loop point
JOIN_XFADE = 0.9           # crossfade between two takes


# ------------------------------------------------------------------ dsp helpers
def biquad(x: np.ndarray, kind: str, freq: float, gain_db: float, q: float,
           sr: int) -> np.ndarray:
    nyq = sr / 2.0
    f = min(max(freq / nyq, 1e-4), 0.999)
    if kind == "hp":
        sos = signal.butter(2, f, btype="highpass", output="sos")
        return signal.sosfilt(sos, x, axis=-1)
    if kind == "lp":
        sos = signal.butter(2, f, btype="lowpass", output="sos")
        return signal.sosfilt(sos, x, axis=-1)
    if kind == "peak":
        A = 10 ** (gain_db / 40.0)
        w0 = np.pi * f
        alpha = np.sin(w0) / (2 * q)
        b = [1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A]
        a = [1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A]
    elif kind == "low_shelf":
        A = 10 ** (gain_db / 40.0)
        w0 = np.pi * f
        alpha = np.sin(w0) / 2 * np.sqrt((A + 1 / A) * (1 / q - 1) + 2)
        two_sqrtA_alpha = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * np.cos(w0) + two_sqrtA_alpha),
             2 * A * ((A - 1) - (A + 1) * np.cos(w0)),
             A * ((A + 1) - (A - 1) * np.cos(w0) - two_sqrtA_alpha)]
        a = [(A + 1) + (A - 1) * np.cos(w0) + two_sqrtA_alpha,
             -2 * ((A - 1) + (A + 1) * np.cos(w0)),
             (A + 1) + (A - 1) * np.cos(w0) - two_sqrtA_alpha]
    elif kind == "high_shelf":
        A = 10 ** (gain_db / 40.0)
        w0 = np.pi * f
        alpha = np.sin(w0) / 2 * np.sqrt((A + 1 / A) * (1 / q - 1) + 2)
        two_sqrtA_alpha = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * np.cos(w0) + two_sqrtA_alpha),
             -2 * A * ((A - 1) + (A + 1) * np.cos(w0)),
             A * ((A + 1) + (A - 1) * np.cos(w0) - two_sqrtA_alpha)]
        a = [(A + 1) - (A - 1) * np.cos(w0) + two_sqrtA_alpha,
             2 * ((A - 1) - (A + 1) * np.cos(w0)),
             (A + 1) - (A - 1) * np.cos(w0) - two_sqrtA_alpha]
    else:
        raise ValueError(kind)
    b = np.array(b, dtype=np.float64) / a[0]
    a = np.array(a, dtype=np.float64) / a[0]
    return signal.lfilter(b, a, x, axis=-1)


def apply_eq(x: np.ndarray, chain: list, sr: int) -> np.ndarray:
    for kind, freq, gain, q in chain:
        x = biquad(x, kind, freq, gain, q, sr)
    return x


def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=0, keepdims=True)


def channel_corr(x: np.ndarray) -> float:
    if x.shape[0] < 2:
        return 1.0
    a = x[0] - x[0].mean()
    b = x[1] - x[1].mean()
    d = np.sqrt((a ** 2).sum() * (b ** 2).sum()) + 1e-12
    return float((a * b).sum() / d)


def envelope(x: np.ndarray, sr: int, hop_s: float = 0.01) -> np.ndarray:
    mono = x.mean(axis=0)
    hop = max(1, int(hop_s * sr))
    n = len(mono) // hop
    return np.array([np.sqrt(np.mean(mono[i * hop:(i + 1) * hop] ** 2) + 1e-12)
                     for i in range(n)]), hop


def find_onset(x: np.ndarray, sr: int, search_s: float = 5.0,
               room_s: float = 0.0) -> int:
    """Sample index of a strong, early-enough onset inside the first search_s seconds.

    Works on the envelope derivative so a slow bed cannot win over a real attack.
    `room_s` is how much audio must remain after the onset, so a late attack near
    the tail of the take cannot truncate the delivered one-shot.
    """
    env, hop = envelope(x, sr)
    limit = min(len(env), int(search_s / 0.01))
    if limit < 4:
        return 0
    e = env[:limit]
    d = np.diff(np.log(e + 1e-9))
    score = d * (e[1:] ** 0.5)
    if not np.any(score > 0):
        return 0
    # earliest attack that is nearly as strong as the strongest one, and that
    # leaves room for the requested window
    need = int(room_s / 0.01)
    good = np.where(score >= 0.6 * score.max())[0]
    for idx in good:
        if idx + 2 + need <= limit:
            return int(idx * hop)
    return int(good[0] * hop) if len(good) else 0


def fade(x: np.ndarray, sr: int, fin_ms: float, fout_ms: float,
         shape: str = "exp") -> np.ndarray:
    n = x.shape[-1]
    fi = min(int(sr * fin_ms / 1000), n // 2)
    fo = min(int(sr * fout_ms / 1000), n // 2)
    if fi:
        x[..., :fi] *= np.linspace(0, 1, fi) ** 1.5
    if fo:
        t = np.linspace(0, 1, fo)
        g = np.exp(-4.0 * t) if shape == "exp" else (1 - t)
        x[..., n - fo:] *= g
    return x


def short_term_rms(x: np.ndarray, sr: int, win_s: float = 0.1) -> float:
    mono = x.mean(axis=0) if x.ndim > 1 else x
    n = max(1, int(win_s * sr))
    if len(mono) <= n:
        return float(np.sqrt(np.mean(mono ** 2) + 1e-12))
    c = np.cumsum(mono ** 2)
    w = (c[n:] - c[:-n]) / n
    return float(np.sqrt(max(float(w.max()), 1e-12)))


def level_to(x: np.ndarray, sr: int, target_db: float, peak_ceiling_db: float = -1.0,
             mode: str = "max") -> np.ndarray:
    """Gain to a loudness reference, then keep peaks under the ceiling.

    mode="max"  reference = loudest 100 ms RMS (one-shots: perceived hit)
    mode="rms"  reference = full-file RMS       (loops: steady beds)
    """
    if mode == "rms":
        cur = rms_db(x)
    else:
        cur = 20 * np.log10(max(short_term_rms(x, sr), 1e-9))
    gain = 10 ** ((target_db - cur) / 20)
    y = x * gain
    peak = float(np.max(np.abs(y))) + 1e-12
    ceil = 10 ** (peak_ceiling_db / 20)
    if peak > ceil:
        y *= ceil / peak
    return y


def equal_power_xfade(a: np.ndarray, b: np.ndarray, n: int) -> np.ndarray:
    t = np.linspace(0, 1, n)
    ra, rb = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)
    return a * ra + b * rb


def wrap_loop(x: np.ndarray, xfade: int) -> np.ndarray:
    """Fold the tail under the head so out[-1] -> out[0] reads as continuous.

    out[i] = x[i]*sin(t) + x[L+i]*cos(t) for i < xfade, t = i/xfade*pi/2
      i=0        -> out[0] = x[L]    (the sample right after x[L-1], i.e. the end)
      i=xfade    -> out[i] = x[i]    (back to the original material)
    Equal power (sin^2+cos^2=1), so the blend neither dips nor pumps.
    """
    n = x.shape[-1]
    xfade = min(xfade, n // 3)
    L_ = n - xfade
    out = x[..., :L_].copy()
    t = np.linspace(0, 1, xfade)
    w_head, w_tail = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    out[..., :xfade] = x[..., :xfade] * w_head + x[..., L_:n] * w_tail
    return out


def trim_silence(x: np.ndarray, sr: int, floor_db: float = -46.0,
                 margin_s: float = 0.05) -> np.ndarray:
    """Drop near-silent head/tail. A take that fades to silence would otherwise put
    a hole at the loop point (the wrap pulls the tail under the head)."""
    env, hop = envelope(x, sr)
    if not len(env):
        return x
    above = np.where(20 * np.log10(env + 1e-12) > floor_db)[0]
    if not len(above):
        return x
    a = max(0, above[0] * hop - int(margin_s * sr))
    b = min(x.shape[-1], (above[-1] + 1) * hop + int(margin_s * sr))
    if b - a < int(0.5 * sr):
        return x
    return x[..., a:b].copy()


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x
    from math import gcd
    g = gcd(sr_in, sr_out)
    return signal.resample_poly(x, sr_out // g, sr_in // g, axis=-1)


def resample_pad(x: np.ndarray, sr_in: int, sr_out: int,
                 pad_s: float = 0.05) -> np.ndarray:
    """Resample with reflected padding so the FIR's edge transient never lands on
    the material. Loop continuity is decided *after* this, at 48 kHz, so the loop
    point is sample-exact in the delivered file."""
    if sr_in == sr_out:
        return x
    pad = max(64, int(pad_s * sr_in))
    xp = np.pad(x, ((0, 0), (pad, pad)), mode="reflect")
    y = resample(xp, sr_in, sr_out)
    out_pad = int(round(pad * sr_out / sr_in))
    return y[..., out_pad:y.shape[-1] - out_pad]


def band_shares(x: np.ndarray, sr: int) -> np.ndarray:
    mono = x.mean(axis=0)
    n, hop = 4096, 2048
    win = np.hanning(n)
    acc, cnt = None, 0
    for i in range(0, max(1, len(mono) - n), hop):
        seg = mono[i:i + n] * win
        if len(seg) < n:
            break
        m = np.abs(np.fft.rfft(seg))
        acc = m if acc is None else acc + m
        cnt += 1
    spec = acc / max(cnt, 1)
    f = np.fft.rfftfreq(n, 1 / sr)
    total = spec.sum() + 1e-12
    edges = [0, 60, 250, 1000, 4000, 16000]
    return np.array([spec[(f >= edges[i]) & (f < edges[i + 1])].sum() / total
                     for i in range(len(edges) - 1)])


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


def rms_db(x: np.ndarray) -> float:
    mono = x.mean(axis=0) if x.ndim > 1 else x
    return 20 * np.log10(max(float(np.sqrt(np.mean(mono ** 2))), 1e-9))


def seam_metrics(x: np.ndarray) -> tuple[float, float, float]:
    """(seam step percentile, step ratio, level jump dB).

    The percentile is the useful one: it says where the step across the loop point
    sits inside the file's own distribution of sample-to-sample steps. A perfect
    loop lands near the middle; a click lands at 100. Comparing to the *mean* step
    instead would be meaningless for smooth or noisy material alike.
    """
    mono = x.mean(axis=0)
    seam = abs(float(mono[0]) - float(mono[-1]))
    d = np.abs(np.diff(mono))
    pct = float((d < seam).mean() * 100)
    ratio = seam / (float(d.mean()) + 1e-12)
    k = min(len(mono) // 10, 2400)
    lvl_jump = abs(rms_db(mono[:k]) - rms_db(mono[-k:]))
    return pct, ratio, lvl_jump


# ------------------------------------------------------------------ one-shots
def build_oneshot(job: dict) -> tuple[np.ndarray, int, dict]:
    takes = sorted(glob.glob(os.path.join(L.OUT_DIR, "raw", f"{job['id']}__*.wav")))
    if not takes:
        raise FileNotFoundError(job["id"])
    x, sr = L.load_wav(takes[0])
    corr = channel_corr(x)
    x = to_mono(x)                              # UI one-shots must be mono-safe
    x = resample_pad(x, sr, TARGET_SR)          # do this before any fade/onset math
    sr = TARGET_SR
    x = apply_eq(x, [("hp", 25, 0, 0.7)] + GROUP_EQ.get(job["group"], []), sr)

    onset = find_onset(x, sr, room_s=float(job["trim_seconds"]))
    pre = int(0.04 * sr)
    start = max(0, onset - pre)
    dur = float(job["trim_seconds"])
    end = min(x.shape[-1], start + int(dur * sr))
    seg = x[:, start:end].copy()
    if seg.shape[-1] < int(0.08 * sr):
        raise RuntimeError(f"{job['id']}: segment too short")
    seg = fade(seg, sr, 2.0, min(180.0, 1000 * seg.shape[-1] / sr / 3), "exp")

    if job["group"] == "carrier":
        seg = apply_eq(seg, CARRIER_EQ[job["id"]], sr)
    seg = level_to(seg, sr, LEVEL_OVERRIDE.get(job["id"], LEVEL[job["group"]]),
                   peak_ceiling_db=-1.0, mode="max")
    meta = {"onset_s": round(float(onset) / sr, 3), "chan_corr_raw": round(corr, 3),
            "mono": True, "target_level_dbfs": LEVEL_OVERRIDE.get(job["id"],
                                                                 LEVEL[job["group"]])}
    return seg, sr, meta


# ------------------------------------------------------------------ loops
def build_loop(job: dict) -> tuple[np.ndarray, int, dict]:
    takes = sorted(glob.glob(os.path.join(L.OUT_DIR, "raw", f"{job['id']}__*.wav")))
    if not takes:
        raise FileNotFoundError(job["id"])
    t1, sr = L.load_wav(takes[0])
    corr1 = channel_corr(t1)
    if corr1 < 0.15:                            # would cancel in mono: take one side
        t1 = to_mono(t1)
    t1 = resample_pad(t1, sr, TARGET_SR)        # 48 kHz first, so the loop point
    sr = TARGET_SR                              # stays sample-exact after delivery

    use_two, why = False, "single take"
    if len(takes) > 1 and job.get("loop_from") != "single":
        raw2, sr2 = L.load_wav(takes[1])
        corr2 = channel_corr(raw2)
        if corr2 >= 0.15:
            t2 = resample_pad(raw2, sr2, TARGET_SR)
            sim = cosine(band_shares(t1, sr), band_shares(t2, sr))
            lvl = abs(rms_db(t1) - rms_db(t2))
            if sim >= 0.95 and lvl <= 3.0:
                use_two, why = True, f"two takes (sim {sim:.3f}, drms {lvl:.1f} dB)"
            else:
                why = f"single take (takes differ: sim {sim:.3f}, drms {lvl:.1f} dB)"
        else:
            why = "single take (take2 not mono-safe)"

    x = apply_eq(trim_silence(t1, sr), GROUP_EQ[job["group"]], sr)
    if use_two:
        t2 = apply_eq(trim_silence(t2, sr), GROUP_EQ[job["group"]], sr)
        n = min(x.shape[-1], t2.shape[-1])
        x, t2 = x[:, :n], t2[:, :n]
        jn = int(JOIN_XFADE * sr)
        joined = equal_power_xfade(x[:, n - jn:], t2[:, :jn], jn)
        x = np.concatenate([x[:, :n - jn], joined, t2[:, jn:]], axis=-1)

    # One wrap turns the素材 itself into a seamless unit; every internal join of a
    # tile of that unit is then the same continuous join, so the file loops by
    # construction and needs no second fold. Pick the crossfade that lets an
    # integer number of units land inside the 20-30 s the plan asks for.
    unit = None
    for xf in (WRAP_XFADE, 0.8, 0.5, 0.3):
        cand = wrap_loop(x, max(256, int(xf * sr)))
        lu = cand.shape[-1] / sr
        k = max(1, int(np.ceil(20.0 / lu)))
        if k * lu <= 30.0:
            unit, reps, used_xf = cand, k, xf
            break
    if unit is None:                             # fall back to the plain target
        used_xf = WRAP_XFADE
        unit = wrap_loop(x, int(WRAP_XFADE * sr))
        lu = unit.shape[-1] / sr
        reps = max(1, int(round(LOOP_SECONDS / lu)))
    out = np.tile(unit, (1, reps))
    lu = out.shape[-1] / sr
    lvl = LEVEL_OVERRIDE.get(job["id"], LEVEL[job["group"]])
    out = level_to(out, sr, lvl, peak_ceiling_db=-1.5, mode="rms")
    why += f"; unit {unit.shape[-1]/sr:.2f}s x{reps} (xf {used_xf}s, {lu:.2f}s)"
    meta = {"chan_corr_raw": round(corr1, 3), "build": why,
            "target_rms_dbfs": lvl}
    return out, sr, meta


# ------------------------------------------------------------------ encode
def encode(wav_path: str, out_path: str, fmt: str, quality: int,
           channels: int) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if fmt == "ogg":
        codec = ["-c:a", "libvorbis", "-q:a", str(quality)]
    elif fmt == "webm":
        # Opus in WebM: the Safari-safe alternative (--format webm)
        codec = ["-c:a", "libopus", "-b:a", f"{max(48, quality * 16)}k",
                 "-vbr", "on", "-application", "audio"]
    else:
        raise ValueError(fmt)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", wav_path, *codec,
           "-ar", str(TARGET_SR), "-ac", str(channels), out_path]
    subprocess.run(cmd, check=True, capture_output=True)


def probe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--format", default="ogg", choices=["ogg", "webm"])
    ap.add_argument("--q-oneshot", type=int, default=6)
    ap.add_argument("--q-loop", type=int, default=5)
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    runs = {}
    runs_file = os.path.join(L.OUT_DIR, "runs.jsonl")
    if os.path.exists(runs_file):
        for line in open(runs_file, encoding="utf-8"):
            r = json.loads(line)
            if r.get("kind") == "gen" and r.get("id"):
                runs.setdefault(r["id"], []).append(r)

    DOCS_DIR = DOCS
    os.makedirs(DOCS_DIR, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="audio_post_")
    entries, problems = [], []

    for job in J.JOBS:
        jid = job["id"]
        try:
            if job["loop"]:
                audio, sr, meta = build_loop(job)
            else:
                audio, sr, meta = build_oneshot(job)
        except Exception as exc:
            problems.append(f"{jid}: {type(exc).__name__}: {exc}")
            print(f"!! {jid} FAILED: {exc}", flush=True)
            continue

        chans = 1 if (audio.shape[0] == 1) else 2
        out_audio = audio if sr == TARGET_SR else resample(audio, sr, TARGET_SR)
        if chans == 1:
            out_audio = out_audio[:1]
        wav_tmp = os.path.join(tmpdir, f"{jid}.wav")
        L.write_wav(wav_tmp, out_audio, TARGET_SR)

        ext = args.format
        out_path = os.path.join(PUB, f"{jid}.{ext}")
        if not args.dry:
            encode(wav_tmp, out_path,
                   args.format,
                   args.q_oneshot if not job["loop"] else args.q_loop, chans)

        dur = probe_duration(out_path) if (not args.dry and os.path.exists(out_path)) \
            else out_audio.shape[-1] / TARGET_SR
        if job["loop"]:
            seam_pct, seam_step, seam_lvl = seam_metrics(out_audio)
            if seam_pct > 99.9:
                problems.append(f"{jid}: loop seam step at {seam_pct:.2f} percentile "
                                f"(a click would sit here)")
        else:
            seam_pct, seam_step, seam_lvl = 0.0, 0.0, 0.0
        gen = runs.get(jid, [])
        filesize = os.path.getsize(out_path) if (not args.dry and
                                                os.path.exists(out_path)) else 0
        entries.append({
            "id": jid,
            "file": f"public/audio/{jid}.{ext}",
            "use": job["use"],
            "group": job["group"],
            "duration_s": round(dur, 2),
            "loop": bool(job["loop"]),
            "sample_rate": TARGET_SR,
            "channels": chans,
            "bytes": filesize,
            "rms_dbfs": round(rms_db(out_audio), 1),
            "peak_dbfs": round(20 * np.log10(max(float(np.max(np.abs(out_audio))),
                                                 1e-9)), 2),
            "loop_seam_step_percentile": round(seam_pct, 2) if job["loop"] else None,
            "loop_seam_step_ratio": round(seam_step, 2) if job["loop"] else None,
            "loop_seam_level_jump_db": round(seam_lvl, 2) if job["loop"] else None,
            "prompt": job["prompt"],
            "negative_prompt": job.get("negative"),
            "seed": [g["seed"] for g in gen],
            "steps": 8,
            "cfg_scale": 1.0,
            "sampler": "pingpong",
            "gen_seconds": job["gen_seconds"],
            "gen_wall_s": [g["wall_s"] for g in gen],
            "vram_peak_mib": max([g["vram_peak_mib"] for g in gen], default=None),
            "model": "stabilityai/stable-audio-open-small",
            "model_params_m": 497.2,
            "license": "Stability AI Community License (non-commercial / <$1M revenue OK)",
            **meta,
        })
        print(f"{jid:26s} {dur:6.2f}s {chans}ch {filesize/1024:7.1f} KB "
              f"rms {entries[-1]['rms_dbfs']:6.1f}  seam_pct {seam_pct:5.1f}  {meta}",
              flush=True)

    total = sum(e["bytes"] for e in entries)
    loops = [e for e in entries if e["loop"]]
    oneshots = [e for e in entries if not e["loop"]]
    print(f"\ntotal {len(entries)} files, {total/1024/1024:.2f} MB "
          f"({total/1024:.0f} KB)")
    print(f"  one-shots: {len(oneshots)}  loops: {len(loops)} "
          f"(loop len {min(e['duration_s'] for e in loops):.1f}-"
          f"{max(e['duration_s'] for e in loops):.1f}s)")
    if total > 8 * 1024 * 1024:
        problems.append(f"total size {total/1024/1024:.2f} MB exceeds the 8 MB budget")
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  -", p)

    if not args.dry:
        manifest = {
            "project": "《把名字留下来》",
            "spec": "docs/superpowers/specs/2026-10-22-3d-audio-plan.md §二",
            "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
            "model": {
                "id": "stabilityai/stable-audio-open-small",
                "params_m": 497.2,
                "dit": "DiT 1024d/16 layers/8 heads, rectified-flow, 8-step pingpong",
                "text_encoder": "t5-base (768)",
                "sample_rate_native": 44100,
                "max_native_seconds": 11.89,
                "weights": r"D:\AI大模型\audio\stable-audio-open-small",
                "license": "Stability AI Community License",
                "license_url": "https://huggingface.co/stabilityai/stable-audio-open-small/blob/main/LICENSE",
                "commercial": "keeps free non-commercial + commercial use under US$1M annual revenue; this entry is a non-commercial student competition",
            },
            "pipeline": {
                "delivery_format": args.format,
                "delivery_sample_rate": TARGET_SR,
                "vorbis_quality_oneshot": args.q_oneshot,
                "vorbis_quality_loop": args.q_loop,
                "loop_seconds": LOOP_SECONDS,
                "loop_wrap_crossfade_s": WRAP_XFADE,
                "sources": "Stable Audio Open Small generates 44.1 kHz tensors; all EQ, "
                           "crossfade, loudness and 48 kHz resampling are classical DSP in "
                           "tools/audio/post.py (no second model)",
            },
            "totals": {
                "files": len(entries),
                "bytes": total,
                "mb": round(total / 1024 / 1024, 2),
                "budget_mb": 8,
                "peak_vram_mib": max([e["vram_peak_mib"] or 0 for e in entries]),
                "gpu": "NVIDIA GeForce RTX 5070 Laptop GPU 8 GB",
            },
            "problems": problems,
            "items": entries,
        }
        path = os.path.join(DOCS_DIR, "audio-manifest.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
