"""One-off probe: find a prompt that yields a single stiff-card click.

click-photo came out as four periodic taps (a mechanism, not a photograph), so we
try narrower prompts and pick by measurement: one dominant onset, short decay,
energy mostly 1.5-6 kHz, not out of phase between channels.

Usage: python tools/audio/probe_photo.py
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_lib as L  # noqa: E402

CANDIDATES = [
    ("a single stiff photo print dropped flat on a wooden table, one soft paper "
     "slap, close microphone, no music, no voices", 1943),
    ("one cardboard photograph placed down on wood, single dry slap of stiff "
     "paper, close microphone, no music, no voices", 1944),
    ("a glossy photo print tapped once with a fingertip, single sharp paper "
     "click, close microphone, no music, no voices", 1945),
    ("paper photograph handled once, one short crisp paper snap, close "
     "microphone, no music, no voices", 1946),
]


def onset_count(x: np.ndarray, sr: int, thresh_db: float = 12.0) -> int:
    """Count bursts: RMS envelope peaks that rise >thresh_db above local floor."""
    mono = x.mean(axis=0)
    hop = int(0.01 * sr)
    n = len(mono) // hop
    env = np.array([np.sqrt(np.mean(mono[i * hop:(i + 1) * hop] ** 2) + 1e-12)
                    for i in range(n)])
    env_db = 20 * np.log10(env)
    floor = np.percentile(env_db, 20)
    above = env_db > floor + thresh_db
    onsets = 0
    prev = False
    for a in above:
        if a and not prev:
            onsets += 1
        prev = a
    return onsets


def corr(x: np.ndarray) -> float:
    if x.shape[0] < 2:
        return 1.0
    a, b = x[0] - x[0].mean(), x[1] - x[1].mean()
    d = np.sqrt((a ** 2).sum() * (b ** 2).sum()) + 1e-12
    return float((a * b).sum() / d)


def main() -> int:
    L.require_idle_gpu()
    model, config = L.load_model()
    outdir = os.path.join(L.OUT_DIR, "probe")
    os.makedirs(outdir, exist_ok=True)
    rows = []
    for i, (prompt, seed) in enumerate(CANDIDATES, 1):
        res = L.generate(model, config, prompt, 4.0, seed=seed, steps=8, cfg=1.0)
        path = os.path.join(outdir, f"photo_c{i}_s{seed}.wav")
        L.write_wav(path, L.peak_normalize(res.audio), res.sample_rate)
        x = res.audio
        mono = x.mean(axis=0)
        c = corr(x)
        n_on = onset_count(x, res.sample_rate)
        rows.append((i, seed, n_on, corr(x), L.rms_db(mono), path))
        print(f"cand{i} seed={seed}: onsets={n_on} chan_corr={c:+.3f} "
              f"rms={L.rms_db(mono):.1f} dBFS -> {os.path.basename(path)}", flush=True)
    print("\nbest = fewest onsets (want 1) and chan_corr > 0.6")
    return 0


if __name__ == "__main__":
    sys.exit(main())
