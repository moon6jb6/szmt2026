"""Smoke test: one 5-second rain clip on Stable Audio Open Small.

Proves the env works end to end and records peak VRAM + wall time, which the
plan requires before committing to the full batch.

Usage:  python tools/audio/smoke.py [--half]
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audio_lib as L  # noqa: E402

PROMPT = ("steady light rain falling on concrete pavement, close microphone, "
          "small drips and splashes, no thunder, no music, no voices, no wind")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--half", action="store_true", help="float16 weights")
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--seed", type=int, default=1937)
    args = ap.parse_args()

    L.require_idle_gpu()          # hard rule: nothing else may hold the card
    t_all = time.time()
    model, config = L.load_model(half=args.half)
    res = L.generate(model, config, PROMPT, args.seconds, seed=args.seed,
                     steps=args.steps, cfg=1.0, sampler="pingpong")

    out = os.path.join(L.OUT_DIR, "smoke_rain_5s.wav")
    L.write_wav(out, L.peak_normalize(res.audio), res.sample_rate)

    peak_after = L.gpu_used_mib()
    print("\n================ SMOKE RESULT ================")
    print(f"prompt        : {PROMPT}")
    print(f"requested     : {args.seconds}s   generated: {res.seconds:.2f}s")
    print(f"sample rate   : {res.sample_rate} Hz   channels: {res.audio.shape[0]}")
    print(f"steps / cfg   : {res.steps} / {res.cfg}  sampler: pingpong")
    print(f"seed          : {res.seed}")
    print(f"wall time     : {res.wall_s:.2f}s  (incl. conditioning)")
    print(f"vram baseline : {res.vram_base_mib} MiB")
    print(f"vram peak     : {res.vram_peak_mib} MiB  (nvidia-smi, whole device)")
    print(f"torch alloc   : {res.extra['torch_peak_alloc_mib']} MiB peak / "
          f"{res.extra['torch_peak_reserved_mib']} MiB reserved")
    print(f"vram after    : {peak_after} MiB")
    print(f"total         : {time.time()-t_all:.1f}s incl. model load")
    print(f"rms           : {L.rms_db(res.audio):.1f} dBFS")
    print(f"wrote         : {out}")
    print("=============================================")

    L.log_run({
        "kind": "smoke", "prompt": PROMPT, "seconds": res.seconds,
        "wall_s": round(res.wall_s, 3), "vram_peak_mib": res.vram_peak_mib,
        "vram_base_mib": res.vram_base_mib, "seed": res.seed, "steps": res.steps,
        "half": args.half, "sample_rate": res.sample_rate,
        "torch_peak_alloc_mib": res.extra["torch_peak_alloc_mib"],
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
