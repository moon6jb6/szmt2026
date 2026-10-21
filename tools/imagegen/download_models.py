# -*- coding: utf-8 -*-
"""下载 SDXL base 1.0 (fp16 变体) + SDXL-Lightning 4-step LoRA 到 D 盘。

只用 ModelScope（国内快）。权重一律落在 D:\\AI大模型\\SDXL-Lightning\\，
绝不落到 C 盘 / OneDrive。
"""
import os
import sys
import time

ROOT = r"D:\AI大模型\SDXL-Lightning"
BASE_DIR = os.path.join(ROOT, "base-fp16")
LORA_DIR = os.path.join(ROOT, "lightning")

BASE_REPO = "AI-ModelScope/stable-diffusion-xl-base-1.0"
LORA_REPO = "AI-ModelScope/SDXL-Lightning"

BASE_PATTERNS = [
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "text_encoder/model.fp16.safetensors",
    "text_encoder_2/config.json",
    "text_encoder_2/model.fp16.safetensors",
    "tokenizer/merges.txt",
    "tokenizer/special_tokens_map.json",
    "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json",
    "tokenizer_2/merges.txt",
    "tokenizer_2/special_tokens_map.json",
    "tokenizer_2/tokenizer_config.json",
    "tokenizer_2/vocab.json",
    "unet/config.json",
    "unet/diffusion_pytorch_model.fp16.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.fp16.safetensors",
]

LORA_PATTERNS = ["sdxl_lightning_4step_lora.safetensors"]


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.2f}TB"


def dir_size(path):
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    return total


def main():
    os.makedirs(BASE_DIR, exist_ok=True)
    os.makedirs(LORA_DIR, exist_ok=True)

    from modelscope import snapshot_download

    t0 = time.time()
    print(f"[1/2] SDXL base 1.0 fp16  <-  {BASE_REPO}", flush=True)
    snapshot_download(
        BASE_REPO,
        local_dir=BASE_DIR,
        allow_patterns=BASE_PATTERNS,
        revision="master",
        max_workers=8,
    )
    t1 = time.time()
    print(f"      done in {t1 - t0:.1f}s  size={human(dir_size(BASE_DIR))}", flush=True)

    print(f"[2/2] SDXL-Lightning 4-step LoRA  <-  {LORA_REPO}", flush=True)
    snapshot_download(
        LORA_REPO,
        local_dir=LORA_DIR,
        allow_patterns=LORA_PATTERNS,
        revision="master",
        max_workers=4,
    )
    t2 = time.time()
    print(f"      done in {t2 - t1:.1f}s  size={human(dir_size(LORA_DIR))}", flush=True)

    print(f"\nTOTAL {t2 - t0:.1f}s", flush=True)
    print("\n=== 权重清单 ===", flush=True)
    for root in (BASE_DIR, LORA_DIR):
        for dirpath, _d, filenames in os.walk(root):
            for f in sorted(filenames):
                fp = os.path.join(dirpath, f)
                rel = os.path.relpath(fp, ROOT)
                print(f"{os.path.getsize(fp):>12,} {human(os.path.getsize(fp)):>9}  {rel}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
