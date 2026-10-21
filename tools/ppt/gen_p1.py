#!/usr/bin/env python
"""为 PPT 封面生成四层素材（L1 底图 / L3 名册）。

SDXL base fp16 + SDXL-Lightning 4-step LoRA，CPU offload，单进程；
产物写到 D:\AI大模型\ppt-work\p1\，并记 manifest。
"""
import json
import os
import time

import torch
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline
from PIL import Image

MODEL_DIR = r"D:\AI大模型\SDXL-Lightning\base-fp16"
LORA = r"D:\AI大模型\SDXL-Lightning\lightning\sdxl_lightning_4step_lora.safetensors"
OUT = r"D:\AI大模型\ppt-work\p1"
os.makedirs(OUT, exist_ok=True)

JOBS = [
    {
        "id": "p1-bg",
        "w": 1024,
        "h": 576,
        "seed": 460737,
        "prompt": (
            "cinematic still, night exterior of a massive 1930s Shanghai concrete warehouse, five storeys, "
            "damaged west wall with pockmarks and bullet holes, seen from across a dark river at low angle, "
            "cold moonlight, distant warm window glow, snow and ash drifting in the air, thick fog, "
            "desaturated dark ink palette, one single deep red accent, heavy shadows, film grain, "
            "moody, epic scale, no people, no text, no letters, no watermark"
        ),
        "negative": (
            "text, watermark, letters, characters, logo, modern buildings, cars, neon, bright colors, cartoon, "
            "anime, oversaturated, people, faces, hands, crowd, sunny, daylight"
        ),
    },
    {
        "id": "p1-roster",
        "w": 768,
        "h": 768,
        "seed": 460738,
        "prompt": (
            "antique open Chinese thread-bound ledger book with faint handwritten name columns on aged paper, "
            "resting on a dark wooden desk, warm single lamp light from upper left, three-quarter top view, "
            "deep shadows all around, near-black background, cinematic still life, museum photograph, "
            "shallow depth of field, no readable text, no words"
        ),
        "negative": (
            "readable text, paragraphs, watermark, modern objects, bright, white background, hands, people, "
            "colorful, cartoon, illustration"
        ),
    },
]


def main():
    t0 = time.time()
    print("[load]", MODEL_DIR, flush=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        MODEL_DIR, dtype=torch.float16, variant="fp16", use_safetensors=True, local_files_only=True
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    pipe.load_lora_weights(os.path.dirname(LORA), weight_name=os.path.basename(LORA))
    pipe.enable_model_cpu_offload()
    pipe.set_progress_bar_config(disable=True)

    records = []
    for job in JOBS:
        start = time.time()
        generator = torch.Generator(device="cpu").manual_seed(job["seed"])
        image = pipe(
            prompt=job["prompt"],
            negative_prompt=job["negative"],
            width=job["w"],
            height=job["h"],
            num_inference_steps=4,
            guidance_scale=1.0,
            generator=generator,
        ).images[0]
        path = os.path.join(OUT, job["id"] + ".png")
        image.save(path)
        elapsed = round(time.time() - start, 1)
        print(f"[gen] {job['id']} {job['w']}x{job['h']} seed={job['seed']} {elapsed}s -> {path}", flush=True)
        records.append({**job, "file": path, "seconds": elapsed, "model": "sdxl-base-fp16+lightning4", "steps": 4, "cfg": 1.0})

    manifest = os.path.join(OUT, "manifest.json")
    with open(manifest, "w", encoding="utf8") as fh:
        json.dump({"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "jobs": records}, fh, ensure_ascii=False, indent=2)
    print(f"[done] {time.time() - t0:.1f}s total -> {manifest}", flush=True)


if __name__ == "__main__":
    main()
