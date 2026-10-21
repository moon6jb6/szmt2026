#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""诊断：为什么文本编码器从 pipeline 里卸不掉、常驻显存是多少。
只做显存测量 + 一次小图推理，不写业务代码。"""
import gc
import os
import sys
import time

os.environ.setdefault("HF_HOME", r"D:\AI大模型\hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline

MODEL = r"D:\AI大模型\SDXL-Lightning\base-fp16"
LORA = r"D:\AI大模型\SDXL-Lightning\lightning\sdxl_lightning_4step_lora.safetensors"


def gib(n=None):
    if n is None:
        n = torch.cuda.memory_allocated()
    return round(n / (1024 ** 3), 3)


def snap(tag):
    print(f"[mem] {tag:<38} allocated={gib()}GiB reserved={gib(torch.cuda.memory_reserved())}GiB", flush=True)


def step(tag, fn):
    try:
        fn()
        snap(tag)
        return True
    except Exception as exc:
        print(f"[ERR] {tag}: {type(exc).__name__}: {exc}", flush=True)
        return False


def main():
    snap("start")
    t0 = time.perf_counter()
    pipe = StableDiffusionXLPipeline.from_pretrained(
        MODEL, dtype=torch.float16, variant="fp16", use_safetensors=True, local_files_only=True,
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    pipe.load_lora_weights(os.path.dirname(LORA), weight_name=os.path.basename(LORA))
    pipe.set_progress_bar_config(disable=True)
    print(f"[load] {time.perf_counter() - t0:.2f}s", flush=True)
    snap("loaded (all cpu)")

    pipe.enable_attention_slicing()
    step("te1->cuda", lambda: pipe.text_encoder.to("cuda"))
    step("te2->cuda", lambda: pipe.text_encoder_2.to("cuda"))
    t1 = time.perf_counter()
    pe, _neg, pooled, _np = pipe.encode_prompt(
        prompt="cinematic film still, empty concrete warehouse interior, dust in light shaft",
        device="cuda", num_images_per_prompt=1, do_classifier_free_guidance=False,
    )
    pe_cpu, pooled_cpu = pe.to("cpu"), pooled.to("cpu")
    print(f"[encode] {time.perf_counter() - t1:.2f}s", flush=True)
    snap("after encode")

    step("te1->cpu", lambda: pipe.text_encoder.to("cpu"))
    step("te2->cpu", lambda: pipe.text_encoder_2.to("cpu"))
    gc.collect()
    torch.cuda.empty_cache()
    snap("after te->cpu + empty_cache")

    # 尝试 A：del 属性
    def _del():
        del pipe.text_encoder
        del pipe.text_encoder_2
        gc.collect()
        torch.cuda.empty_cache()
    if step("after del pipe.text_encoder(_2)", _del):
        print(f"    has attr text_encoder? {hasattr(pipe, 'text_encoder')}", flush=True)
    # 尝试 B：置 None
    if hasattr(pipe, "text_encoder") and pipe.text_encoder is not None:
        step("te1 = None", lambda: setattr(pipe, "text_encoder", None))
    if hasattr(pipe, "text_encoder_2") and pipe.text_encoder_2 is not None:
        step("te2 = None", lambda: setattr(pipe, "text_encoder_2", None))
    # 尝试 C：to meta
    for name in ("text_encoder", "text_encoder_2"):
        mod = getattr(pipe, name, None)
        if mod is not None:
            step(f"{name}.to('meta')", lambda m=mod: m.to("meta"))

    step("unet->cuda", lambda: pipe.unet.to("cuda"))
    step("vae->cuda", lambda: pipe.vae.to("cuda"))
    print(f"[est] unet+vae should be ~5.3GiB; allocated={gib()}", flush=True)

    # 小图推理测峰值与耗时
    pipe.scheduler.set_timesteps(4, device="cuda")
    gen = torch.Generator(device="cuda").manual_seed(42)
    torch.cuda.reset_peak_memory_stats()
    torch.cuda.synchronize()
    t2 = time.perf_counter()
    with torch.inference_mode():
        img = pipe(
            prompt_embeds=pe_cpu.to("cuda"),
            pooled_prompt_embeds=pooled_cpu.to("cuda"),
            width=960, height=544, num_inference_steps=4, guidance_scale=0.0, generator=gen,
        ).images[0]
    torch.cuda.synchronize()
    print(f"[run] 960x544 elapsed={time.perf_counter() - t2:.2f}s peak_alloc={gib(torch.cuda.max_memory_allocated())}GiB "
          f"peak_reserved={gib(torch.cuda.max_memory_reserved())}GiB", flush=True)
    img.save(r"D:\AI大模型\art-work\diag.jpg")

    # 再跑一张，看稳态
    gen = torch.Generator(device="cuda").manual_seed(43)
    torch.cuda.reset_peak_memory_stats()
    t3 = time.perf_counter()
    with torch.inference_mode():
        img = pipe(
            prompt_embeds=pe_cpu.to("cuda"),
            pooled_prompt_embeds=pooled_cpu.to("cuda"),
            width=960, height=544, num_inference_steps=4, guidance_scale=0.0, generator=gen,
        ).images[0]
    torch.cuda.synchronize()
    print(f"[run2] steady elapsed={time.perf_counter() - t3:.2f}s peak_reserved={gib(torch.cuda.max_memory_reserved())}GiB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
