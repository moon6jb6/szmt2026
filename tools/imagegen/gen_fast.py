#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""gen_fast.py —— 与 gen.py 同模型、同参数的「低延迟」出图跑步器（不改 gen.py 一行）。

为什么要这个脚本：
    gen.py 默认 enable_model_cpu_offload。实测（probe1024.log + pilot1.log）每生成一张
    图，都要把 CLIP(1.4GB)+UNet(2.55GB)+VAE(0.33GB) 从 CPU 搬上 GPU，WDDM 下这次搬运
    ~19s；真正 4 步去噪合计不到 5s。于是稳态 30—56s/张，500 张要 7—8h。

本脚本的优化（不改变采样语义，任何一张图的结果与同 seed 的 gen.py 一致）：
    1) 启动时用文本编码器把本批全部 prompt 一次性编码成 embeddings（编码器随后卸回 CPU）；
    2) UNet + VAE 常驻 GPU，不再逐张搬运；
    3) 每张图只做「4 步去噪 + VAE 解码 + 存盘」。
    预期 6—10s/张（1024×576），显存 ~5—6GB，安全。

用法（与 gen.py 相同的 batch json 格式）：
    python gen_fast.py --batch ../../docs/art/batches/pilot-001.json
    python gen_fast.py --batch ../../docs/art/batches/batch-001.json --skip-existing --limit 3
    python gen_fast.py --prompt "..." --out ../../public/art/scene-999.jpg --seed 1234

输出：图片 + 同名 json（字段与 gen.py 兼容，另加 engine="gen_fast"），供 vl_score.py / qa_batch.py 直接读。
"""
import argparse
import gc
import json
import os
import sys
import time

# ---- 必须在 import torch 之前设置 ----
if sys.platform != "win32":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("HF_HOME", r"D:\AI大模型\hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch  # noqa: E402
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline  # noqa: E402

try:
    from transformers.utils import logging as _tlog
    _tlog.disable_progress_bar()
except Exception:  # pragma: no cover
    pass

DEFAULT_MODEL_DIR = r"D:\AI大模型\SDXL-Lightning\base-fp16"
DEFAULT_LORA = r"D:\AI大模型\SDXL-Lightning\lightning\sdxl_lightning_4step_lora.safetensors"
MODEL_TAG = "stable-diffusion-xl-base-1.0 (fp16) + SDXL-Lightning 4-step LoRA [gen_fast]"

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
# 加载（与 gen.py 完全一致的组件和调度器）
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
    # Lightning 蒸馏模型必须 Euler + trailing
    pipe.scheduler = EulerDiscreteScheduler.from_config(
        pipe.scheduler.config, timestep_spacing="trailing"
    )
    if args.lora and os.path.isfile(args.lora):
        log(f"[load] LoRA {args.lora}")
        pipe.load_lora_weights(os.path.dirname(args.lora), weight_name=os.path.basename(args.lora))
    else:
        log(f"[warn] LoRA 不存在：{args.lora}")
    pipe.set_progress_bar_config(disable=True)
    load_s = time.perf_counter() - t0
    log(f"[load] done in {load_s:.2f}s")
    return pipe, load_s


def _vae_switch(pipe, pipe_method, vae_method, what):
    if hasattr(pipe.vae, vae_method):
        getattr(pipe.vae, vae_method)()
    elif hasattr(pipe, pipe_method):
        getattr(pipe, pipe_method)()
    else:
        raise AttributeError(f"pipeline 与 vae 都没有 {what} 开关")


def prepare_resident(pipe, args):
    """文本编码器批量编码 → 删除编码器（释放显存）→ UNet+VAE 常驻 GPU。"""
    # 省显存开关（与 gen.py safe 档一致；如要更快可 --mem-mode fast）
    if args.mem_mode == "safe":
        try:
            pipe.enable_attention_slicing()
            log("[mem] attention_slicing=on")
        except Exception as exc:
            log(f"[warn] attention_slicing: {exc}")
    if args.mem_mode in ("safe", "balanced"):
        try:
            _vae_switch(pipe, "enable_vae_tiling", "enable_tiling", "VAE tiling")
            _vae_switch(pipe, "enable_vae_slicing", "enable_slicing", "VAE slicing")
            log("[mem] vae_tiling=on vae_slicing=on")
        except Exception as exc:
            log(f"[warn] vae tiling/slicing: {exc}")

    # 文本编码器临时上卡做批量编码（编码完立刻删掉，SDXL 的 CLIP 共约 1.6GB）
    log("[precompute] 文本编码器上卡...")
    pipe.text_encoder.to("cuda")
    pipe.text_encoder_2.to("cuda")
    log(f"[mem] after te->cuda: allocated={gib(torch.cuda.memory_allocated())}GiB")


def encode_all_prompts(pipe, jobs):
    """一次性编码所有 prompt（guidance<=1 不需要 negative embeds），随后从 pipeline 删除文本编码器。"""
    t0 = time.perf_counter()
    n = len(jobs)
    for i, job in enumerate(jobs, 1):
        prompt_embeds, _neg, pooled, _npooled = pipe.encode_prompt(
            prompt=job["prompt"],
            device="cuda",
            num_images_per_prompt=1,
            do_classifier_free_guidance=False,
        )
        # 放回 CPU 保存，逐张用时再搬（每张 <1MB，可忽略）
        job["_prompt_embeds"] = prompt_embeds.to("cpu")
        job["_pooled_prompt_embeds"] = pooled.to("cpu")
        if i % 10 == 0 or i == n:
            log(f"        encode {i}/{n}  {time.perf_counter() - t0:.2f}s")
    log(f"[precompute] {n} prompts encoded in {time.perf_counter() - t0:.2f}s")

    # 彻底释放文本编码器：先搬 CPU 再删引用（只依赖预计算 embeddings，后面不再需要 CLIP）
    try:
        pipe.text_encoder.to("cpu")
        pipe.text_encoder_2.to("cpu")
    except Exception:
        pass
    try:
        del pipe.text_encoder
        del pipe.text_encoder_2
        pipe.text_encoder = None
        pipe.text_encoder_2 = None
    except Exception:
        pass
    gc.collect()
    torch.cuda.empty_cache()
    log(f"[mem] text encoders unloaded: allocated={gib(torch.cuda.memory_allocated())}GiB")

    # UNet + VAE 常驻
    pipe.unet.to("cuda")
    pipe.vae.to("cuda")
    torch.cuda.empty_cache()
    log(f"[mem] resident: unet+vae on cuda, allocated={gib(torch.cuda.memory_allocated())}GiB")
    # 预热：建一次调度器 timestep（避免首图额外开销）
    pipe.scheduler.set_timesteps(4, device="cuda")


# --------------------------------------------------------------------------- #
# 单张生成
# --------------------------------------------------------------------------- #
def run_job(pipe, job, args):
    generator = torch.Generator(device="cuda").manual_seed(int(job["seed"]))
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()
    with torch.inference_mode():
        image = pipe(
            prompt_embeds=job["_prompt_embeds"].to("cuda"),
            pooled_prompt_embeds=job["_pooled_prompt_embeds"].to("cuda"),
            width=job["width"],
            height=job["height"],
            num_inference_steps=job["steps"],
            guidance_scale=job["guidance"],
            generator=generator,
        ).images[0]
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - t0
    return image, elapsed, torch.cuda.max_memory_allocated(), torch.cuda.max_memory_reserved()


def save_outputs(image, job, elapsed, peak_alloc, peak_res, args, load_s):
    out_path = job["out"]
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    image.save(out_path)
    meta = {
        "output": os.path.basename(out_path),
        "id": job.get("id") or os.path.splitext(os.path.basename(out_path))[0],
        "prompt": job["prompt"],
        "prompt_raw": job.get("prompt_raw", job["prompt"]),
        "negative": job["negative"],
        "seed": job["seed"],
        "steps": job["steps"],
        "model": MODEL_TAG,
        "model_dir": args.model_dir,
        "lora": args.lora if args.lora and os.path.isfile(args.lora) else None,
        "width": job["width"],
        "height": job["height"],
        "guidance_scale": job["guidance"],
        "elapsed_seconds": round(elapsed, 3),
        "peak_vram_allocated_gib": gib(peak_alloc),
        "peak_vram_reserved_gib": gib(peak_res),
        "mem_mode": args.mem_mode,
        "mem_policy": "resident_unet_vae",
        "engine": "gen_fast",
        "batch_load_seconds": round(load_s, 2),
        "vram_total_gib": gib(torch.cuda.get_device_properties(0).total_memory),
        "oom": False,
        "diffusers_version": __import__("diffusers").__version__,
        "torch_version": torch.__version__,
        "gpu": torch.cuda.get_device_name(0),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    json_path = os.path.splitext(out_path)[0] + ".json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return json_path, meta


# --------------------------------------------------------------------------- #
# 批次读取（与 gen.py load_batch 语义一致）
# --------------------------------------------------------------------------- #
def _snap8(v):
    """SDXL 要求宽高是 8 的倍数；批次里若写了 960×540 这类尺寸自动吸附到最近的 8 倍数。"""
    iv = int(v)
    snapped = max(256, int(round(iv / 8.0)) * 8)
    if snapped != iv:
        log(f"[snap] {iv} -> {snapped}（SDXL 要求宽高为 8 的倍数）")
    return snapped


def make_job(item, args):
    prompt = item["prompt"]
    suffix = (item.get("style_suffix") or args.style_suffix or "").strip().strip(",")
    final_prompt = f"{prompt}, {suffix}" if suffix else prompt
    return {
        "id": item.get("id"),
        "prompt": final_prompt,
        "prompt_raw": prompt,
        "negative": item.get("negative") or args.negative,
        "width": _snap8(int(item.get("width") or args.width)),
        "height": _snap8(int(item.get("height") or args.height)),
        "steps": int(item.get("steps") or args.steps),
        "seed": item.get("seed") if item.get("seed") is not None else args.seed,
        "guidance": float(item["guidance"]) if item.get("guidance") is not None else args.guidance,
        "out": item["out"],
    }


def load_jobs(args):
    if not args.batch:
        if not args.prompt or not args.out:
            raise SystemExit("[fatal] 非 batch 模式必须给 --prompt 和 --out")
        jobs = [make_job({"prompt": args.prompt, "out": args.out, "seed": args.seed}, args)]
    else:
        with open(args.batch, "r", encoding="utf-8") as fh:
            items = json.load(fh)
        jobs = []
        for i, item in enumerate(items):
            if isinstance(item, str):
                item = {"prompt": item, "out": f"out/{i:03d}.png"}
            jobs.append(make_job(item, args))
    skipped = 0
    if args.skip_existing:
        kept = []
        for job in jobs:
            if os.path.isfile(job["out"]):
                skipped += 1
                continue
            kept.append(job)
        jobs = kept
        log(f"[skip-existing] 跳过已存在 {skipped} 张，剩 {len(jobs)} 张")
    if args.limit:
        jobs = jobs[: args.limit]
    return jobs


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def parse_args(argv=None):
    p = argparse.ArgumentParser(description="SDXL-Lightning 4-step 低延迟出图器（常驻 UNet/VAE）")
    p.add_argument("--prompt")
    p.add_argument("--negative", default=NEGATIVE_DEFAULT)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=576)
    p.add_argument("--steps", type=int, default=4)
    p.add_argument("--seed", type=int, default=1234)
    p.add_argument("--out")
    p.add_argument("--guidance", type=float, default=0.0)
    p.add_argument("--style-suffix", default="")
    p.add_argument("--mem-mode", choices=["safe", "balanced", "fast"], default="safe",
                   help="safe=attention slicing+vae tiling/slicing；balanced=只 vae；fast=都不开（最快但吃显存）")
    p.add_argument("--batch")
    p.add_argument("--skip-existing", action="store_true", help="输出已存在则跳过（断点续跑/避免覆盖）")
    p.add_argument("--limit", type=int)
    p.add_argument("--model-dir", default=DEFAULT_MODEL_DIR)
    p.add_argument("--lora", default=DEFAULT_LORA)
    args = p.parse_args(argv)
    if not args.batch and (not args.prompt or not args.out):
        p.error("非 batch 模式必须同时给 --prompt 和 --out")
    if args.batch and not os.path.isfile(args.batch):
        p.error(f"--batch 文件不存在: {args.batch}")
    return args


def main(argv=None):
    args = parse_args(argv)
    if not os.path.isdir(args.model_dir):
        log(f"[fatal] 模型目录不存在: {args.model_dir}")
        return 2
    if not torch.cuda.is_available():
        log("[fatal] CUDA 不可用")
        return 2
    log(f"[env] torch={torch.__version__} cuda={torch.version.cuda} "
        f"gpu={torch.cuda.get_device_name(0)} vram={gib(torch.cuda.get_device_properties(0).total_memory)}GiB")

    jobs = load_jobs(args)
    if not jobs:
        log("[done] 没有需要生成的图")
        return 0
    log(f"[plan] {len(jobs)} 张待生成；前 3 张：{[(j.get('id'), j['out']) for j in jobs[:3]]}")

    pipe, load_s = build_pipeline(args)
    prepare_resident(pipe, args)
    encode_all_prompts(pipe, jobs)

    results, t_batch = [], time.perf_counter()
    oom_count = 0
    for idx, job in enumerate(jobs, 1):
        if job["seed"] is None:
            job["seed"] = int(torch.randint(0, 2 ** 31 - 1, (1,)).item())
        log(f"\n[{idx}/{len(jobs)}] seed={job['seed']} steps={job['steps']} "
            f"{job['width']}x{job['height']} -> {job['out']}")
        if job.get("id"):
            log(f"        id={job['id']}")
        try:
            image, elapsed, peak_alloc, peak_res = run_job(pipe, job, args)
        except torch.cuda.OutOfMemoryError as exc:
            oom_count += 1
            msg = str(exc).strip().splitlines()[0] if str(exc).strip() else repr(exc)
            log(f"        [OOM] {msg}")
            gc.collect()
            torch.cuda.empty_cache()
            continue
        json_path, meta = save_outputs(image, job, elapsed, peak_alloc, peak_res, args, load_s)
        eta = (time.perf_counter() - t_batch) / idx * (len(jobs) - idx)
        log(f"        elapsed={elapsed:.3f}s  peak_alloc={meta['peak_vram_allocated_gib']}GiB  "
            f"peak_reserved={meta['peak_vram_reserved_gib']}GiB  eta={eta / 60:.1f}min")
        log(f"        -> {job['out']}")
        results.append(meta)
        # 每 10 张清一次缓存，防止碎片累积
        if idx % 10 == 0:
            torch.cuda.empty_cache()

    wall = time.perf_counter() - t_batch
    log("\n===== SUMMARY (gen_fast) =====")
    for r in results:
        log(f"{r['output']:<44} {r['elapsed_seconds']:>7.3f}s  seed={r['seed']}  "
            f"peak {r['peak_vram_allocated_gib']}GiB")
    if results:
        per = sum(r["elapsed_seconds"] for r in results) / len(results)
        log(f"张数={len(results)} 墙钟={wall:.1f}s 平均={per:.2f}s/张 load={load_s:.2f}s "
            f"oom={oom_count} 峰值={max(r['peak_vram_reserved_gib'] for r in results)}GiB")
    else:
        log(f"张数=0 wall={wall:.1f}s oom={oom_count}")
    return 0 if oom_count == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
