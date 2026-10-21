#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""《赤旗·山河证言》2.5D 场景背景图 —— SDXL base 1.0 fp16 + SDXL-Lightning 4-step LoRA 生成器。

设计目标：8GB 显存内稳定出 1024 级 16:9 背景图，单张 < 8s，seed 可复现。

用法：
    python gen.py --prompt "..." --out out/a.png --seed 1234
    python gen.py --batch batch.json

显存策略（三级阶梯）：
    默认整条 pipeline 上卡（fp16 约 6.5 GiB 权重）；
    显存不足时自动 enable_model_cpu_offload() 重试；
    仍不足则 enable_sequential_cpu_offload() 再重试。
"""
import argparse
import gc
import json
import os
import sys
import time

# ---- 必须在 import torch 之前设置 ----
# 8GB 卡上避免显存碎片导致"明明够却 OOM"。
# 注意：expandable_segments 在 Windows 上不被支持（会打一条 UserWarning），故只在 Linux 设。
if sys.platform != "win32":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
# 缓存一律放 D 盘，绝不污染 C 盘 / OneDrive
os.environ.setdefault("HF_HOME", r"D:\AI大模型\hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch  # noqa: E402
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline  # noqa: E402

# 关掉 from_pretrained 期间刷屏的 tqdm 进度条，日志才好读
try:
    from transformers.utils import logging as _tlog

    _tlog.disable_progress_bar()
except Exception:  # pragma: no cover
    pass

DEFAULT_MODEL_DIR = r"D:\AI大模型\SDXL-Lightning\base-fp16"
DEFAULT_LORA = r"D:\AI大模型\SDXL-Lightning\lightning\sdxl_lightning_4step_lora.safetensors"

MODEL_TAG = "stable-diffusion-xl-base-1.0 (fp16) + SDXL-Lightning 4-step LoRA"

# 推荐给 1937 抗战中国的风格尾缀（不自动加，避免偷偷改 prompt；用 --style-suffix 显式启用）
NEGATIVE_DEFAULT = (
    "blurry, lowres, jpeg artifacts, watermark, text, logo, signature, "
    "cartoon, anime, 3d render, plastic skin, extra limbs, deformed, "
    "modern buildings, neon signs, cars, power lines, oversaturated"
)


def log(msg):
    print(msg, flush=True)


def gib(nbytes):
    return round(nbytes / (1024 ** 3), 3)


# --------------------------------------------------------------------------- #
# pipeline
# --------------------------------------------------------------------------- #
def build_pipeline(args):
    t0 = time.perf_counter()

    log(f"[load] {args.model_dir}")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        args.model_dir,
        dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
        local_files_only=True,
    )

    # Lightning 蒸馏模型必须配 Euler + trailing timestep spacing，
    # 用 base 默认的 DPMSolver 会直接糊成一团。
    pipe.scheduler = EulerDiscreteScheduler.from_config(
        pipe.scheduler.config, timestep_spacing="trailing"
    )

    lora_path = args.lora
    if lora_path and os.path.isfile(lora_path):
        log(f"[load] LoRA {lora_path}")
        pipe.load_lora_weights(
            os.path.dirname(lora_path), weight_name=os.path.basename(lora_path)
        )
        if args.fuse_lora:
            # 把 LoRA 权重焊进 UNet：省掉每次 forward 的 merge 开销。
            # 但实测在机械硬盘/CPU 上要 60-75s，单图生产不划算，默认关。
            try:
                pipe.fuse_lora(components=["unet"])
            except Exception as exc:  # 融合失败只是变慢，不影响正确性
                log(f"[warn] fuse_lora 失败，保留未融合 LoRA: {type(exc).__name__}: {exc}")
    else:
        log(f"[warn] LoRA 不存在，退回纯 base 模型（步数建议 >= 20）：{lora_path}")

    # ---- 显存策略（这些是"省显存"开关，失败只降级不致命）----
    mem_flags = {"attention_slicing": False, "vae_tiling": False, "vae_slicing": False}

    def soft(key, label, fn):
        try:
            fn()
            mem_flags[key] = True
        except Exception as exc:
            log(f"[warn] {label} 不可用: {type(exc).__name__}: {exc}")

    # diffusers >= 0.30 起 VAE 的 tiling/slicing 挂在 AutoencoderKL 上，
    # pipeline 上的 enable_vae_tiling() 已被移除 —— 这里两个位置都试。
    def vae_switch(pipe_method, vae_method, what):
        if hasattr(pipe.vae, vae_method):
            getattr(pipe.vae, vae_method)()
        elif hasattr(pipe, pipe_method):
            getattr(pipe, pipe_method)()
        else:
            raise AttributeError(f"pipeline 与 vae 都没有 {what} 开关")

    if args.mem_mode == "safe":
        soft("attention_slicing", "enable_attention_slicing", pipe.enable_attention_slicing)
    soft("vae_tiling", "enable_vae_tiling",
         lambda: vae_switch("enable_vae_tiling", "enable_tiling", "VAE tiling"))
    soft("vae_slicing", "enable_vae_slicing",
         lambda: vae_switch("enable_vae_slicing", "enable_slicing", "VAE slicing"))
    args._mem_flags = mem_flags

    pipe.set_progress_bar_config(disable=True)

    # ---- 显存驻留策略 ----
    # 实测：整条 fp16 pipeline 驻留 GPU 时 reserved 峰值 8.31GiB > 7.96GiB 物理显存，
    # Windows WDDM 会静默溢出到共享内存 → GPU 利用率 0%、单步 20s。所以默认走 offload。
    if args.mem_policy == "offload":
        log("[mem] enable_model_cpu_offload()：仅 UNet 驻留显存（默认，8GB 卡实测最快）")
        pipe.enable_model_cpu_offload()
        args._resident = False
    else:
        pipe.to("cuda")
        args._resident = True

    load_s = time.perf_counter() - t0
    log(f"[load] done in {load_s:.2f}s")
    return pipe, load_s


# --------------------------------------------------------------------------- #
# 单张生成
# --------------------------------------------------------------------------- #
def run_once(pipe, prompt, negative, width, height, steps, seed, guidance, verbose=False):
    """返回 (PIL.Image, elapsed_seconds, peak_alloc, peak_reserved)"""
    generator = torch.Generator(device="cuda").manual_seed(int(seed))
    kwargs = dict(
        prompt=prompt,
        width=width,
        height=height,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
    )
    # guidance_scale <= 1 时 diffusers 不做 CFG，negative_prompt 会被忽略，
    # 传进去只会换来一条 warning，索性不传。
    if guidance > 1.0 and negative:
        kwargs["negative_prompt"] = negative

    # 逐步回调：定位"慢在去噪还是慢在 VAE 解码"，出问题时不用猜
    marks = []
    if verbose:
        def _cb(p, i, t, cb_kwargs):
            torch.cuda.synchronize()
            marks.append((int(i), time.perf_counter()))
            log(f"        step {int(i) + 1}/{steps} @ {marks[-1][1]:.3f}")
            return cb_kwargs

        kwargs["callback_on_step_end"] = _cb

    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()

    image = pipe(**kwargs).images[0]

    torch.cuda.synchronize()
    elapsed = time.perf_counter() - t0

    if verbose and marks:
        t_denoise = marks[-1][1] - t0
        log(f"        denoise(step0..last)={t_denoise:.3f}s  "
            f"tail(decode+save)={elapsed - t_denoise:.3f}s")
    return (
        image,
        elapsed,
        torch.cuda.max_memory_allocated(),
        torch.cuda.max_memory_reserved(),
    )


def generate_with_fallback(pipe, args, job):
    """按 mem_policy 选起点，OOM 时逐级降级。
    返回 (image, elapsed, peak_alloc, peak_res, oom_notes, stage)"""
    oom_notes = []

    ladder = []
    if args.mem_policy in ("resident", "auto"):
        ladder.append(("on-gpu", lambda: None))
    ladder.append(("model_cpu_offload", lambda: pipe.enable_model_cpu_offload()))
    ladder.append(("sequential_cpu_offload", lambda: pipe.enable_sequential_cpu_offload()))

    for name, switch in ladder:
        try:
            switch()
            stage = name
            return (*run_once(
                pipe,
                job["prompt"],
                job["negative"],
                job["width"],
                job["height"],
                job["steps"],
                job["seed"],
                job["guidance"],
                getattr(args, "verbose_steps", False),
            ), oom_notes, stage)
        except torch.cuda.OutOfMemoryError as exc:
            msg = str(exc).strip().splitlines()[0] if str(exc).strip() else repr(exc)
            first = f"[OOM @ {name}] {msg}"
            log(first)
            oom_notes.append(first)
            gc.collect()
            torch.cuda.empty_cache()
            try:
                pipe.remove_all_hooks()
            except Exception:
                pass
            continue

    raise RuntimeError("三级降级全部 OOM：" + " | ".join(oom_notes))


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #
def save_outputs(image, out_path, job, elapsed, peak_alloc, peak_res, oom_notes, stage, args):
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    image.save(out_path)

    meta = {
        "output": os.path.basename(out_path),
        "prompt": job["prompt"],
        "negative": job["negative"],
        "seed": job["seed"],
        "steps": job["steps"],
        "model": MODEL_TAG,
        "model_dir": args.model_dir,
        "lora": args.lora if args.lora and os.path.isfile(args.lora or "") else None,
        "width": job["width"],
        "height": job["height"],
        "guidance_scale": job["guidance"],
        "elapsed_seconds": round(elapsed, 3),
        "peak_vram_allocated_gib": gib(peak_alloc),
        "peak_vram_reserved_gib": gib(peak_res),
        "peak_vram_allocated_bytes": peak_alloc,
        "mem_mode": args.mem_mode,
        "mem_policy": args.mem_policy,
        "fuse_lora": bool(args.fuse_lora),
        "attention_slicing": getattr(args, "_mem_flags", {}).get("attention_slicing", False),
        "vae_tiling": getattr(args, "_mem_flags", {}).get("vae_tiling", False),
        "vae_slicing": getattr(args, "_mem_flags", {}).get("vae_slicing", False),
        "vram_overcommitted": bool(
            peak_res > torch.cuda.get_device_properties(0).total_memory
        ),
        "vram_total_gib": gib(torch.cuda.get_device_properties(0).total_memory),
        "oom": bool(oom_notes),
        "offload_stage": stage,
        "oom_events": oom_notes,
        "diffusers_version": __import__("diffusers").__version__,
        "torch_version": torch.__version__,
        "gpu": torch.cuda.get_device_name(0),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    if job.get("prompt_raw") and job["prompt_raw"] != job["prompt"]:
        meta["prompt_raw"] = job["prompt_raw"]
        meta["style_suffix"] = job.get("style_suffix", "")

    json_path = os.path.splitext(out_path)[0] + ".json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return json_path, meta


def make_job(args, prompt=None, seed=None, out=None):
    raw = prompt if prompt is not None else args.prompt
    suffix = (args.style_suffix or "").strip().strip(",")
    final_prompt = f"{raw}, {suffix}" if suffix else raw
    return {
        "prompt": final_prompt,
        "prompt_raw": raw,
        "style_suffix": suffix,
        "negative": args.negative,
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "seed": seed if seed is not None else args.seed,
        "guidance": args.guidance,
        "out": out or args.out,
    }


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="SDXL-Lightning 4-step 背景图生成器（8GB 显存友好）"
    )
    p.add_argument("--prompt", help="正向提示词")
    p.add_argument("--negative", default=NEGATIVE_DEFAULT, help="负向提示词")
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=576)
    p.add_argument("--steps", type=int, default=4)
    p.add_argument("--seed", type=int, default=1234, help="固定 seed 可复现")
    p.add_argument("--out", help="输出图片路径（同名 .json 自动生成）")
    p.add_argument("--guidance", type=float, default=0.0,
                   help="Lightning 蒸馏要求 0（不做 CFG）；>1 才启用 CFG，negative 才生效，但更慢")
    p.add_argument("--style-suffix", default="", help="追加到 prompt 末尾的风格串")
    p.add_argument("--mem-mode", choices=["safe", "balanced", "fast"], default="safe",
                   help="safe=attention slicing + vae tiling/slicing（默认，省显存）")
    p.add_argument("--mem-policy", choices=["offload", "resident", "auto"], default="offload",
                   help="offload=只让 UNet 驻留显存（默认，8GB 卡实测最快）；"
                        "resident=整条 pipeline 上卡（8GB 会溢出到共享内存，极慢）；"
                        "auto=先 resident，OOM 再降级")
    p.add_argument("--fuse-lora", action="store_true",
                   help="把 LoRA 焊进 UNet（省推理开销，但加载要多花约 60-75s）")
    p.add_argument("--model-dir", default=DEFAULT_MODEL_DIR)
    p.add_argument("--lora", default=DEFAULT_LORA)
    p.add_argument("--verbose-steps", action="store_true", help="逐步打印时间戳，用于定位瓶颈")
    p.add_argument("--batch", help="批量 JSON：[{prompt, negative?, seed?, out}, ...]")
    args = p.parse_args(argv)

    if not args.batch and (not args.prompt or not args.out):
        p.error("非 --batch 模式必须同时给 --prompt 和 --out")
    if args.batch and not os.path.isfile(args.batch):
        p.error(f"--batch 文件不存在: {args.batch}")
    return args


def load_batch(path, args):
    with open(path, "r", encoding="utf-8") as fh:
        items = json.load(fh)
    jobs = []
    for i, item in enumerate(items):
        if isinstance(item, str):
            item = {"prompt": item, "out": f"out/{i:03d}.png"}
        sub = argparse.Namespace(**vars(args))
        if item.get("negative"):
            sub.negative = item["negative"]
        if item.get("width"):
            sub.width = item["width"]
        if item.get("height"):
            sub.height = item["height"]
        if item.get("steps"):
            sub.steps = item["steps"]
        if item.get("guidance") is not None:
            sub.guidance = item["guidance"]
        jobs.append((make_job(sub, prompt=item["prompt"],
                              seed=item.get("seed"), out=item["out"]), sub))
    return jobs


def main(argv=None):
    args = parse_args(argv)

    if not os.path.isdir(args.model_dir):
        log(f"[fatal] 模型目录不存在: {args.model_dir}")
        return 2
    if not torch.cuda.is_available():
        log("[fatal] CUDA 不可用")
        return 2

    log(f"[env] torch={torch.__version__} cuda={torch.version.cuda} "
        f"gpu={torch.cuda.get_device_name(0)} "
        f"vram={gib(torch.cuda.get_device_properties(0).total_memory)}GiB")

    pipe, load_s = build_pipeline(args)

    if args.batch:
        jobs = load_batch(args.batch, args)
    else:
        jobs = [(make_job(args), args)]

    results = []
    for idx, (job, sub) in enumerate(jobs, 1):
        if job["seed"] is None:
            job["seed"] = int(torch.randint(0, 2 ** 31 - 1, (1,)).item())
        log(f"\n[{idx}/{len(jobs)}] seed={job['seed']} steps={job['steps']} "
            f"{job['width']}x{job['height']} -> {job['out']}")
        log(f"        prompt: {job['prompt'][:160]}")

        image, elapsed, peak_alloc, peak_res, oom_notes, stage = generate_with_fallback(
            pipe, sub, job
        )
        json_path, meta = save_outputs(
            image, job["out"], job, elapsed, peak_alloc, peak_res, oom_notes, stage, sub
        )

        log(f"        elapsed={elapsed:.3f}s  "
            f"peak_alloc={meta['peak_vram_allocated_gib']}GiB  "
            f"peak_reserved={meta['peak_vram_reserved_gib']}GiB  "
            f"stage={stage}  oom={'yes' if oom_notes else 'no'}")
        if meta["vram_overcommitted"]:
            log(f"        [WARN] reserved 峰值 {meta['peak_vram_reserved_gib']}GiB 超过物理显存 "
                f"{meta['vram_total_gib']}GiB，WDDM 已溢出到共享内存，速度会严重劣化")
        log(f"        -> {job['out']}")
        log(f"        -> {json_path}")
        results.append(meta)

    log("\n===== SUMMARY =====")
    for r in results:
        log(f"{r['output']:<40} {r['elapsed_seconds']:>7.3f}s  "
            f"peak {r['peak_vram_allocated_gib']}GiB  seed={r['seed']}  "
            f"oom={'yes' if r['oom_events'] else 'no'}")
    log(f"load_time={load_s:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
