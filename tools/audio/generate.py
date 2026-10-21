"""Generate every raw take for the audio set, in one single python process.

GPU discipline: this is the only process that touches the card for the whole
batch. It refuses to start if anything else is computing, writes QUEUE.md as it
goes, and never runs two generations at once.

Usage:
  python tools/audio/generate.py              # everything still missing
  python tools/audio/generate.py --only click-roster,rain-light
  python tools/audio/generate.py --force      # redo even if the take exists
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audio_lib as L  # noqa: E402
import jobs as J  # noqa: E402

RAW = os.path.join(L.OUT_DIR, "raw")
QUEUE_MD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "QUEUE.md")


def take_path(job_id: str, take: int, seed: int) -> str:
    return os.path.join(RAW, f"{job_id}__t{take}__s{seed}.wav")


def plan_takes(job: dict) -> list[tuple[int, int]]:
    """Return [(take_index, seed)]. Loops need two independent takes to crossfade."""
    if job["loop"]:
        # second take gets a different seed so the loop does not repeat one event
        return [(1, job["seed"]), (2, job["seed"] + 7919)]
    return [(1, job["seed"])]


def render_queue(states: dict[str, dict], header_note: str = "") -> None:
    lines = [
        "# QUEUE — 音效生成队列（tools/audio/generate.py 自动写入）",
        "",
        "> GPU 纪律：同一时刻只有一个 python 进程占卡；开工前 `nvidia-smi` 确认无其他",
        "> compute 进程；不运行 `tools/imagegen/gen.py`；发现卡被占用就停下报告，不抢占。",
        "",
        f"模型：`stabilityai/stable-audio-open-small`（本地 `{L.MODEL_DIR}`） · "
        "8 steps · pingpong sampler · cfg 1.0 · 44.1kHz",
        "",
    ]
    if header_note:
        lines += [header_note, ""]
    lines += [
        "| # | id | 组 | 轮次 | 状态 | 秒 | 耗时 s | 显存峰值 MiB |",
        "|---|----|----|------|------|----|--------|--------------|",
    ]
    for i, job in enumerate(J.JOBS, 1):
        st = states.get(job["id"], {})
        status = st.get("status", "pending")
        mark = {"done": "✅ done", "running": "🔄 running", "pending": "⏳ pending",
                "skip": "↩︎ exists", "fail": "❌ fail"}.get(status, status)
        takes = len(plan_takes(job))
        lines.append(
            f"| {i} | `{job['id']}` | {job['group']} | {takes} | {mark} | "
            f"{st.get('seconds', job['gen_seconds'])} | {st.get('wall_s', '')} | "
            f"{st.get('vram_peak_mib', '')} |")
    done = sum(1 for j in J.JOBS if states.get(j["id"], {}).get("status") in ("done", "skip"))
    lines += ["", f"进度：{done}/{len(J.JOBS)} 条已生成。",
              "", f"最后更新：{time.strftime('%Y-%m-%d %H:%M:%S')}"]
    with open(QUEUE_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma separated ids")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    args = ap.parse_args()

    wanted = [s.strip() for s in args.only.split(",") if s.strip()]
    todo = [j for j in J.JOBS if not wanted or j["id"] in wanted]
    if wanted:
        missing = set(wanted) - {j["id"] for j in J.JOBS}
        if missing:
            raise SystemExit(f"unknown ids: {sorted(missing)}")

    L.require_idle_gpu()
    os.makedirs(RAW, exist_ok=True)

    # which takes already exist?
    states: dict[str, dict] = {}
    work: list[tuple[dict, int, int]] = []
    for job in J.JOBS:
        takes = plan_takes(job)
        have = all(os.path.exists(take_path(job["id"], t, s)) for t, s in takes)
        if job not in todo:
            states[job["id"]] = {"status": "skip" if have else "pending"}
            continue
        if have and not args.force:
            states[job["id"]] = {"status": "skip"}
            continue
        for t, s in takes:
            work.append((job, t, s))
        states[job["id"]] = {"status": "pending"}
    render_queue(states, "开工。")
    if not work:
        print("nothing to do", flush=True)
        return 0

    t_load = time.time()
    model, config = L.load_model()
    load_s = time.time() - t_load

    t_batch = time.time()
    for n, (job, take, seed) in enumerate(work, 1):
        jid = job["id"]
        out = take_path(jid, take, seed)
        print(f"\n[{n}/{len(work)}] {jid} take{take} seed={seed} "
              f"{job['gen_seconds']}s", flush=True)
        states.setdefault(jid, {})["status"] = "running"
        states[jid]["seconds"] = job["gen_seconds"]
        render_queue(states, f"正在跑第 {n}/{len(work)} 个 take。")
        try:
            res = L.generate(
                model, config, job["prompt"], job["gen_seconds"], seed=seed,
                steps=args.steps, cfg=args.cfg, negative=job.get("negative"))
        except Exception as exc:  # keep the batch alive, record the failure
            print(f"  FAILED: {type(exc).__name__}: {exc}", flush=True)
            states[jid]["status"] = "fail"
            states[jid]["error"] = f"{type(exc).__name__}: {exc}"
            L.log_run({"kind": "gen", "id": jid, "take": take, "seed": seed,
                       "error": f"{type(exc).__name__}: {exc}"})
            render_queue(states)
            continue

        L.write_wav(out, L.peak_normalize(res.audio), res.sample_rate)
        states[jid].update(status="done", wall_s=round(res.wall_s, 2),
                           vram_peak_mib=res.vram_peak_mib,
                           seed=seed, take=take, wav=out)
        print(f"  ok {res.seconds:.2f}s audio in {res.wall_s:.2f}s, "
              f"vram peak {res.vram_peak_mib} MiB", flush=True)
        L.log_run({
            "kind": "gen", "id": jid, "group": job["group"], "take": take,
            "seed": seed, "prompt": job["prompt"], "negative": job.get("negative"),
            "seconds": round(res.seconds, 3), "wall_s": round(res.wall_s, 3),
            "vram_peak_mib": res.vram_peak_mib, "vram_base_mib": res.vram_base_mib,
            "steps": args.steps, "cfg": args.cfg, "sampler": "pingpong",
            "sample_rate": res.sample_rate,
            "torch_peak_alloc_mib": res.extra["torch_peak_alloc_mib"],
            "torch_peak_reserved_mib": res.extra["torch_peak_reserved_mib"],
        })
        render_queue(states)

    batch_s = time.time() - t_batch
    done = sum(1 for j in J.JOBS if states.get(j["id"], {}).get("status") in ("done", "skip"))
    note = (f"本轮完成 {len(work)} 个 take，用时 {batch_s/60:.1f} min"
            f"（模型加载 {load_s:.1f}s）。")
    render_queue(states, note)
    print(f"\n=== batch done: {done}/{len(J.JOBS)} jobs, {len(work)} takes, "
          f"{batch_s/60:.1f} min ===", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
