#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""diag2：聚焦验证「文本编码器能否真正离开 GPU」+「UNet/VAE 常驻后单张耗时/峰值」。
不做任何业务逻辑，只为给 gen_fast 定方案。"""
import gc
import os
import sys
import time

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "max_split_size_mb:256")
os.environ.setdefault("HF_HOME", r"D:\AI大模型\hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline

MODEL = r"D:\AI大模型\SDXL-Lightning\base-fp16"
LORA = r"D:\AI大模型\SDXL-Lightning\lightning\sdxl_lightning_4step_lora.safetensors"
gib = lambda n=None: round((torch.cuda.memory_allocated() if n is None else n) / (1024 ** 3), 3)


def snap(tag):
    print(f"[mem] {tag:<34} alloc={gib()}GiB resv={gib(torch.cuda.memory_reserved())}GiB", flush=True)


def main():
    t0 = time.perf_counter()
    pipe = StableDiffusionXLPipeline.from_pretrained(
        MODEL, dtype=torch.float16, variant="fp16", use_safetensors=True, local_files_only=True,
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    pipe.load_lora_weights(os.path.dirname(LORA), weight_name=os.path.basename(LORA))
    pipe.set_progress_bar_config(disable=True)
    print(f"[load] {time.perf_counter() - t0:.2f}s", flush=True)
    snap("loaded/cpu")
    pipe.enable_attention_slicing()
    try:
        pipe.vae.enable_tiling()
        pipe.vae.enable_slicing()
        print("[mem] vae tiling+slicing on", flush=True)
    except Exception as e:
        print("[err] vae tiling:", e, flush=True)

    # 1) 文本编码器上卡 → 编码 → 尝试彻底卸载，观察显存
    pipe.text_encoder.to("cuda")
    pipe.text_encoder_2.to("cuda")
    snap("te on cuda")
    t1 = time.perf_counter()
    pe, _n, pooled, _np = pipe.encode_prompt(
        prompt="cinematic film still, empty concrete warehouse interior, dust in light shaft",
        device="cuda", num_images_per_prompt=1, do_classifier_free_guidance=False)
    pe_c, pooled_c = pe.to("cpu"), pooled.to("cpu")
    print(f"[encode] 1 prompt {time.perf_counter() - t1:.3f}s", flush=True)
    snap("after encode")

    for name in ("text_encoder", "text_encoder_2"):
        try:
            getattr(pipe, name).to("cpu")
        except Exception as e:
            print(f"[err] {name}.to(cpu): {type(e).__name__}: {e}", flush=True)
    gc.collect()
    torch.cuda.empty_cache()
    snap("after te->cpu")

    for name in ("text_encoder", "text_encoder_2"):
        try:
            setattr(pipe, name, None)
        except Exception as e:
            print(f"[err] set {name}=None: {type(e).__name__}: {e}", flush=True)
    gc.collect()
    torch.cuda.empty_cache()
    snap("after te=None")
    # 检查是否还有模块留在显存：遍历所有子模块找 cuda 参数
    leftover = []
    for name, mod in getattr(pipe, "components", {}).items():
        if isinstance(mod, torch.nn.Module):
            try:
                dev = next(mod.parameters()).device
            except StopIteration:
                continue
            if dev.type == "cuda":
                leftover.append(name)
    print(f"[check] cuda 上的组件: {leftover}", flush=True)

    # 2) UNet + VAE 常驻
    pipe.unet.to("cuda")
    pipe.vae.to("cuda")
    torch.cuda.empty_cache()
    snap("unet+vae resident")

    # VAE 用 fp16 解码（省 0.17GB + 提速）；SDXL config 有 force_upcast
    try:
        print(f"[vae] force_upcast was {pipe.vae.config.force_upcast}", flush=True)
        pipe.vae.config.force_upcast = False
    except Exception as e:
        print("[err] force_upcast:", e, flush=True)

    pipe.scheduler.set_timesteps(4, device="cuda")

    for i, seed in enumerate((42, 43), 1):
        gen = torch.Generator(device="cuda").manual_seed(seed)
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        t2 = time.perf_counter()
        with torch.inference_mode():
            img = pipe(
                prompt_embeds=pe_c.to("cuda"), pooled_prompt_embeds=pooled_c.to("cuda"),
                width=960, height=544, num_inference_steps=4, guidance_scale=0.0, generator=gen,
            ).images[0]
        torch.cuda.synchronize()
        print(f"[run{i}] 960x544 4step elapsed={time.perf_counter() - t2:.2f}s "
              f"peak_alloc={gib(torch.cuda.max_memory_allocated())}GiB "
              f"peak_resv={gib(torch.cuda.max_memory_reserved())}GiB", flush=True)
        snap(f"after run{i}")
        img.save(rf"D:\AI大模型\art-work\diag2-{i}.jpg")
    return 0


if __name__ == "__main__":
    sys.exit(main())
