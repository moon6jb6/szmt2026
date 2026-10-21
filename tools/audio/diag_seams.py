"""Diagnostic: are the periodic stripes in some loops real material or seams I made?

For each id, report the largest sample-to-sample step in the delivered file and
whether it sits on a loop-unit boundary, plus the same statistic for the raw take.

Usage: python tools/audio/diag_seams.py drone-ending-photo drone-ending-message
"""
from __future__ import annotations

import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_lib as L  # noqa: E402
import inspect_audio as IA  # noqa: E402

PROJ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUB = os.path.join(PROJ, "public", "audio")


def main(ids: list[str]) -> int:
    for jid in ids:
        raw = sorted(glob.glob(os.path.join(L.OUT_DIR, "raw", f"{jid}__*.wav")))[0]
        x, sr = L.load_wav(raw)
        d = np.abs(np.diff(x.mean(axis=0)))
        p999 = np.percentile(d, 99.9)
        print(f"\n{jid}")
        print(f"  RAW {os.path.basename(raw)} len {len(x[0])} sr {sr}")
        print(f"    max|diff| {d.max():.5f} at {d.argmax()/sr:.3f}s   "
              f"p99.9 {p999:.5f}  max/p99.9 {d.max()/p999:.2f}")

        y, sy = IA.load_any(os.path.join(PUB, f"{jid}.ogg"))
        mono = y.mean(axis=0)
        dy = np.abs(np.diff(mono))
        dur = len(mono) / sy
        # infer unit length: delivered loops are an integer number of units
        print(f"  DELIVERED {dur:.2f}s  max|diff| {dy.max():.5f} "
              f"p99.9 {np.percentile(dy, 99.9):.5f}")
        top = np.argsort(dy)[-6:][::-1]
        for i in sorted(top, key=lambda i: -dy[i]):
            t = i / sy
            print(f"    spike {t:7.3f}s  {dy[i]:.5f}  ({dy[i]/np.percentile(dy,99.9):.1f}x p99.9)")
        # repeat period via autocorrelation of the envelope
        env = np.abs(mono)
        env = env - env.mean()
        ac = np.correlate(env, env, "full")[len(env) - 1:]
        ac /= ac[0] + 1e-12
        lo = int(1.0 * sy)
        peak = lo + int(np.argmax(ac[lo:int(dur * sy / 2)]))
        print(f"  envelope repeat period ~{peak/sy:.3f}s "
              f"(r={ac[peak]:.3f}) -> unit likely {peak/sy:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["drone-ending-photo", "drone-ending-message"]))
