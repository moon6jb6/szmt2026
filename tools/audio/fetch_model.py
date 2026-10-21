"""Download Stable Audio Open Small weights to D:\\AI大模型\\audio\\stable-audio-open-small.

Source: ModelScope mirror of stabilityai/stable-audio-open-small (the HF repo is gated;
file sizes match the HF listing exactly). Resumable, verifies size, no GPU touched.

Usage:  python tools/audio/fetch_model.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

DEST = r"D:\AI大模型\audio\stable-audio-open-small"
REPO = "stabilityai/stable-audio-open-small"
REV = "master"
BASE = f"https://modelscope.cn/api/v1/models/{REPO}/repo?Revision={REV}&FilePath="
FILES = ["model.safetensors", "model_config.json", "base_model_config.json", "LICENSE", "README.md"]
EXPECTED = {"model.safetensors": 1676829212}


def remote_size(name: str) -> int:
    req = urllib.request.Request(BASE + name, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as r:
        return int(r.headers.get("Content-Length") or 0)


def download(name: str) -> None:
    path = os.path.join(DEST, name)
    want = EXPECTED.get(name) or remote_size(name)
    have = os.path.getsize(path) if os.path.exists(path) else 0
    if have == want and want > 0:
        print(f"[skip] {name} already complete ({have} bytes)", flush=True)
        return
    print(f"[get ] {name} {have}/{want}", flush=True)
    t0 = time.time()
    last = 0.0
    req = urllib.request.Request(BASE + name)
    if have:
        req.add_header("Range", f"bytes={have}-")
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "ab") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            have += len(chunk)
            now = time.time()
            if now - last > 5:
                last = now
                pct = 100.0 * have / max(want, 1)
                print(f"  {name} {have/1e6:7.1f}/{want/1e6:.1f} MB  {pct:5.1f}%  "
                      f"{have/1e6/max(now-t0,1e-6):5.1f} MB/s", flush=True)
    got = os.path.getsize(path)
    print(f"[done] {name} {got} bytes in {time.time()-t0:.1f}s", flush=True)
    if want and got != want:
        raise SystemExit(f"size mismatch for {name}: {got} != {want}")


def main() -> int:
    os.makedirs(DEST, exist_ok=True)
    for f in FILES:
        download(f)
    # record provenance next to the weights
    meta = {
        "model": REPO,
        "source": "modelscope.cn mirror (HF repo is gated)",
        "files": {f: os.path.getsize(os.path.join(DEST, f)) for f in FILES
                  if os.path.exists(os.path.join(DEST, f))},
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(DEST, "SOURCE.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
