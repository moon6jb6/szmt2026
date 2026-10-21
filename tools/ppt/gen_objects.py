#!/usr/bin/env python
"""为 PPT 生成 L3 透明意象物件（干净黑底生成 → 亮度抠图 → 羽化）。"""
import json
import os
import time

import numpy as np
import torch
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline
from PIL import Image, ImageFilter

MODEL_DIR = r"D:\AI大模型\SDXL-Lightning\base-fp16"
LORA = r"D:\AI大模型\SDXL-Lightning\lightning\sdxl_lightning_4step_lora.safetensors"
WORK = r"D:\AI大模型\ppt-work\objects"
OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "docs", "deliverables", "ppt-assets", "objects",
)
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

NEG = "text, letters, watermark, logo, bright background, white background, hands, people, cartoon, oversaturated"

JOBS = [
    ("obj-letter", "a bundle of old handwritten letters tied with twine, aged paper envelopes, on a dark wooden table, single warm light from the left, near-black background, cinematic still life, no readable text"),
    ("obj-flag", "a folded red flag with a small white star corner, torn edge, cloth texture, on a dark surface, single warm side light, near-black background, cinematic still life, no text"),
    ("obj-photo", "a faded black and white photograph of a group of soldiers, anonymous silhouettes, creased and worn corners, lying on dark wood, single warm light, near-black background, cinematic still life"),
    ("obj-recorder", "an old cassette tape recorder with microphone, 1980s Chinese model, worn metal and dark plastic, on a dark table, single warm light, near-black background, cinematic still life, no text"),
    ("obj-note", "a small folded paper note with faint pencil marks, unfolded on dark wood, single warm light, near-black background, cinematic still life, no readable text"),
    ("obj-lamp", "a kerosene oil lamp with warm flame, dark metal base, glowing light, on a dark wooden table, near-black background, cinematic still life, no text"),
    ("obj-ledger-closed", "a closed thread-bound Chinese ledger book, worn dark blue cover, aged paper edges, on a dark table, single warm side light, near-black background, cinematic still life, no text"),
    ("obj-ledger-empty", "an open thread-bound Chinese ledger page with faint empty columns and grid lines, aged paper, on a dark table, warm light from upper left, near-black background, cinematic still life, no readable text"),
]


def build_pipe():
    pipe = StableDiffusionXLPipeline.from_pretrained(
        MODEL_DIR, dtype=torch.float16, variant="fp16", use_safetensors=True, local_files_only=True
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    pipe.load_lora_weights(os.path.dirname(LORA), weight_name=os.path.basename(LORA))
    pipe.enable_model_cpu_offload()
    pipe.set_progress_bar_config(disable=True)
    return pipe


def key_out(path):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img).astype(np.float32)
    # 近黑背景 → 透明；用 max(r,g,b) 亮度做 alpha，羽化去边
    lum = arr.max(axis=2)
    alpha = np.clip((lum - 10.0) / 46.0, 0, 1) ** 1.4
    alpha = (alpha * 255).astype(np.uint8)
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    out = Image.fromarray(rgba, "RGBA")
    # 收边一点，去掉灰边
    a = out.split()[3].filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out.putalpha(a)
    # 裁到内容框，留 6% 边
    bbox = out.getbbox()
    if bbox:
        pad = int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.06)
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(out.width, bbox[2] + pad), min(out.height, bbox[3] + pad))
        out = out.crop(bbox)
    dst = os.path.join(OUT, os.path.splitext(os.path.basename(path))[0] + ".png")
    out.save(dst)
    return dst, out.size


def main():
    t0 = time.time()
    pipe = build_pipe()
    records = []
    for i, (oid, prompt) in enumerate(JOBS):
        start = time.time()
        g = torch.Generator(device="cpu").manual_seed(460740 + i)
        image = pipe(
            prompt=prompt,
            negative_prompt=NEG,
            width=768,
            height=768,
            num_inference_steps=4,
            guidance_scale=1.0,
            generator=g,
        ).images[0]
        raw = os.path.join(WORK, oid + "-raw.png")
        image.save(raw)
        dst, size = key_out(raw)
        print(f"[obj] {oid} {round(time.time()-start,1)}s -> {dst} {size}", flush=True)
        records.append({"id": oid, "raw": raw, "png": dst, "size": size, "seed": 460740 + i, "prompt": prompt, "seconds": round(time.time() - start, 1)})
    with open(os.path.join(WORK, "manifest.json"), "w", encoding="utf8") as fh:
        json.dump({"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "objects": records}, fh, ensure_ascii=False, indent=2)
    print(f"[done] {round(time.time()-t0,1)}s")


if __name__ == "__main__":
    main()
