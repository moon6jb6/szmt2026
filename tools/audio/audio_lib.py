"""Shared helpers for the Stable Audio Open Small generation runs.

Contains the GPU-discipline guard (hard rule for this repo: only one python
process may touch the GPU at a time), the local checkpoint loader, a
generation wrapper that records wall time and real peak VRAM, and WAV writing.

No network, no other model, no torch.compile.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

MODEL_DIR = r"D:\AI大模型\audio\stable-audio-open-small"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


# --------------------------------------------------------------------------- GPU guard
def _smi(*args: str) -> str:
    exe = "nvidia-smi"
    return subprocess.run([exe, *args], capture_output=True, text=True, timeout=30).stdout.strip()


def compute_apps() -> list[dict[str, str]]:
    """Every process currently holding a CUDA context on this GPU."""
    out = _smi("--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader")
    apps = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 3 and parts[0].isdigit():
            apps.append({"pid": parts[0], "name": parts[1], "vram": parts[2]})
    return apps


def gpu_used_mib() -> int:
    out = _smi("--query-gpu=memory.used", "--format=csv,noheader,nounits")
    return int(out.splitlines()[0].strip())


# Huorong (火绒) antivirus daemon keeps a CUDA context registered on this machine but
# holds 0 MiB and 0% utilisation. It is not a workload and cannot be stopped; it is
# explicitly ignored (and always reported) rather than mistaken for a busy card.
IGNORE_NAMES = {"HipsDaemon"}


def _resolve_name(pid: int) -> str:
    """nvidia-smi reports '[Insufficient Permissions]' for other sessions' processes;
    fall back to tasklist so the guard can still tell a daemon from a training run."""
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=15).stdout.strip()
        if out and out.startswith('"'):
            name = out.split('","')[0].strip('"')
            return name[:-4] if name.lower().endswith(".exe") else name
    except Exception:
        pass
    return ""


def require_idle_gpu(allow_pids: set[int] | None = None) -> None:
    """Hard stop if anything else is computing on the GPU.

    Rule from the audio plan: one python process on the card at a time. We never
    kill or pre-empt another process; we stop and report instead.
    """
    allow_pids = allow_pids or set()
    apps = compute_apps()
    for a in apps:
        if not a["name"] or a["name"].startswith("[") or a["name"] == "N/A":
            a["name"] = _resolve_name(int(a["pid"])) or a["name"]
    ignored = [a for a in apps if a["name"] in IGNORE_NAMES]
    apps = [a for a in apps
            if int(a["pid"]) not in allow_pids and a["name"] not in IGNORE_NAMES]
    if ignored:
        print("[gpu ] ignoring known 0-MiB system daemon(s): "
              + ", ".join(f"{a['name']}(pid {a['pid']}, {a['vram']})" for a in ignored),
              flush=True)
    if apps:
        msg = ["GPU is busy - refusing to start.", "Compute processes:"]
        msg += [f"  pid={a['pid']} name={a['name']} vram={a['vram']}" for a in apps]
        msg.append("Wait for the other process or report it; do not pre-empt.")
        raise SystemExit("\n".join(msg))
    print(f"[gpu ] idle, memory.used={gpu_used_mib()} MiB", flush=True)


class VramSampler:
    """Poll nvidia-smi while generating to get true device usage (context included)."""

    def __init__(self, interval: float = 0.15) -> None:
        self.interval = interval
        self.peak = 0
        self._stop = threading.Event()
        self._base = 0
        self._t: threading.Thread | None = None

    def __enter__(self) -> "VramSampler":
        self._base = gpu_used_mib()
        self.peak = self._base
        self._t = threading.Thread(target=self._loop, daemon=True)
        self._t.start()
        return self

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.peak = max(self.peak, gpu_used_mib())
            except Exception:
                pass
            self._stop.wait(self.interval)

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        if self._t:
            self._t.join(timeout=2)

    @property
    def base(self) -> int:
        return self._base


# --------------------------------------------------------------------------- model
def load_model(device: str = "cuda", half: bool = False):
    import torch
    from stable_audio_tools.models.factory import create_model_from_config
    from stable_audio_tools.models.utils import load_ckpt_state_dict

    cfg_path = os.path.join(MODEL_DIR, "model_config.json")
    w_path = os.path.join(MODEL_DIR, "model.safetensors")
    with open(cfg_path, encoding="utf-8") as f:
        config = json.load(f)

    t0 = time.time()
    model = create_model_from_config(config)
    sd = load_ckpt_state_dict(w_path)
    model.load_state_dict(sd)
    model.eval()
    model = model.to(device)
    if half:
        model = model.to(torch.float16)
    n_par = sum(p.numel() for p in model.parameters())
    print(f"[load] {n_par/1e6:.1f}M params, {time.time()-t0:.1f}s, half={half}", flush=True)
    return model, config


@dataclass
class GenResult:
    audio: np.ndarray              # (channels, samples) float32
    sample_rate: int
    seconds: float
    wall_s: float
    vram_peak_mib: int
    vram_base_mib: int
    seed: int
    prompt: str
    steps: int
    cfg: float
    extra: dict = field(default_factory=dict)


def generate(
    model,
    config: dict,
    prompt: str,
    seconds: float,
    seed: int = 0,
    steps: int = 8,
    cfg: float = 1.0,
    sampler: str = "pingpong",
    negative: str | None = None,
    init_audio: tuple[np.ndarray, int] | None = None,
    init_noise_level: float = 0.4,
) -> GenResult:
    """One generation. `seconds` is the requested audio length in seconds."""
    import torch
    from einops import rearrange
    from stable_audio_tools.inference.generation import generate_diffusion_cond

    sr = int(config["sample_rate"])
    n_samples = int(round(seconds * sr))
    # keep the length a multiple of the latent downsampling ratio
    ds = int(config["model"]["pretransform"]["config"]["downsampling_ratio"])
    n_samples = max(ds, (n_samples // ds) * ds)
    seconds = n_samples / sr

    cond = [{"prompt": prompt, "seconds_total": round(seconds, 3)}]
    neg = [{"prompt": negative, "seconds_total": round(seconds, 3)}] if negative else None

    gen_kw: dict[str, Any] = dict(
        conditioning=cond,
        negative_conditioning=neg,
        sample_size=n_samples,
        steps=steps,
        cfg_scale=cfg,
        sampler_type=sampler,
        seed=seed,
        device="cuda",
        batch_size=1,
    )
    if init_audio is not None:
        # API expects (in_sr, tensor[batch, channels, samples]); init_noise_level maps to sigma_max
        wav, in_sr = init_audio
        gen_kw["init_audio"] = (int(in_sr), torch.from_numpy(wav).unsqueeze(0))
        gen_kw["init_noise_level"] = init_noise_level

    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    with torch.inference_mode(), VramSampler() as vs:
        out = generate_diffusion_cond(model, **gen_kw)
    wall = time.time() - t0
    torch_peak = int(torch.cuda.max_memory_allocated() / (1024 * 1024))
    reserved = int(torch.cuda.max_memory_reserved() / (1024 * 1024))

    out = rearrange(out, "b d n -> d (b n)").to(torch.float32).cpu().numpy()
    if not np.isfinite(out).all():
        raise RuntimeError("non-finite samples")
    peak = max(vs.peak, torch_peak)
    return GenResult(
        audio=out, sample_rate=sr, seconds=out.shape[-1] / sr, wall_s=wall,
        vram_peak_mib=peak, vram_base_mib=vs.base, seed=seed, prompt=prompt,
        steps=steps, cfg=cfg,
        extra={"torch_peak_alloc_mib": torch_peak, "torch_peak_reserved_mib": reserved,
               "sampler": sampler, "negative": negative},
    )


# --------------------------------------------------------------------------- io
def peak_normalize(audio: np.ndarray, target: float = 0.891) -> np.ndarray:  # -1 dBFS
    m = float(np.max(np.abs(audio))) if audio.size else 0.0
    if m <= 1e-9:
        return audio
    return (audio * (target / m)).astype(np.float32)


def write_wav(path: str, audio: np.ndarray, sr: int) -> None:
    """16-bit PCM WAV via scipy (no soundfile/librosa needed)."""
    from scipy.io import wavfile

    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = np.clip(audio.T, -1.0, 1.0)  # (samples, channels)
    wavfile.write(path, sr, (a * 32767.0).round().astype(np.int16))


def load_wav(path: str) -> tuple[np.ndarray, int]:
    from scipy.io import wavfile

    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    else:
        data = data.astype(np.float32)
    if data.ndim == 1:
        data = data[:, None]
    return data.T.astype(np.float32), sr  # (channels, samples)


def rms_db(audio: np.ndarray) -> float:
    r = float(np.sqrt(np.mean(np.square(audio))))
    return 20.0 * np.log10(max(r, 1e-9))


def log_run(record: dict) -> None:
    path = os.path.join(OUT_DIR, "runs.jsonl")
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    require_idle_gpu()
    print("audio_lib self-check ok", file=sys.stderr)
