#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_warehouse.py — 《把名字留下来》 hero 资产：四行仓库西墙外观
================================================================

在 Blender 4.2.3 无头模式（`blender -b -P build_warehouse.py`）下生成：

  1. 64 m x 25 m 花岗岩条石西立面（五层、八开间、32 个窗洞、铁门、女儿墙）
  2. 历史弹痕：8 个炮弹孔 + 430 个枪弹孔（上海四行仓库西墙实测口径）
  3. 一段被打穿的破洞（含露出的钢筋）与墙脚碎石、沙袋
  4. 程序化生成的条石 / 砖 贴图（numpy 现场画，含法线图），随 GLB 内嵌
  5. 单文件 `public/models/warehouse-ext.glb`（Y-up，米制，可直接 GLTFLoader 加载）
  6. 1—2 张 Cycles **CPU** 预览（1024x576）

全部随机量由 `--seed` 决定，脚本可重复运行、参数化（尺寸 / 破损程度 / 弹孔数）。

用法（PowerShell，项目根 = .../frontend/2026数字媒体）：

    $B = 'D:\\AI大模型\\blender\\blender-4.2.3-windows-x64\\blender.exe'
    & $B -b -P tools/blender/build_warehouse.py -- --render

参数见 `--help`。默认输出：
    public/models/warehouse-ext.glb
    docs/report/blender-shots/*.png
    tools/blender/tex/*.png            （中间贴图，不入库亦可）

所有单位 = 米。原点 = 西墙外皮中心在地面的投影（x 居中、z=0 为墙脚、y=0 为外皮，
+y 指向建筑内部）。导出 glTF 时 Blender 自动 Z-up -> Y-up。

色板严格取自 docs/art/visual-bible.md（旗红 / 铁锈 / 沙金 / 烟黑 / 纸白）派生出
花岗岩三阶与砖、铁、沙袋色；不引入青蓝高光，不用纯黑纯白。
"""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
import sys
import time
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------------------
# 0. 色板（docs/art/visual-bible.md §1）
# --------------------------------------------------------------------------------------
# 硬约束五色：旗红 #A32B2B / 铁锈 #7A3E2E / 沙金 #C8A063 / 烟黑 #16130F / 纸白 #EDE6D8
# 派生：花岗岩三阶落在「烟黑—纸白」之间且偏暖（bible：冷色只能经雾/水灰进入，色相居中），
# 砖 = 铁锈降饱和，铁 = 烟黑提亮并偏暖，沙袋 = 沙金降饱和。
PALETTE = {
    "flag_red": "#A32B2B",      # 仅用于极少量记忆点（本资产几乎不用，留在调色板里做对照）
    "iron_rust": "#7A3E2E",     # 砖、锈铁
    "sand_gold": "#C8A063",     # 沙袋、暖光
    "smoke_black": "#16130F",    # 阴影、窗洞、夜
    "paper_white": "#EDE6D8",   # 破口新茬、弹孔白茬、天光
    # --- 派生 ---
    "granite": "#666055",       # 条石主色（暖灰）
    "granite_lt": "#948A79",    # 台基 / 窗台 / 腰线亮面
    "granite_break": "#6F6858", # 破口白茬（只比主色亮一档，不许成为白块）
    "granite_dk": "#3E382F",    # 条石暗面 / 破口内壁
    "scar": "#736B5E",          # 弹着点崩边的浅茬（比花岗岩略亮，不许成白点）
    "brick": "#55453C",         # 封窗砖（铁锈降饱和降明度，不许比花岗岩更跳）
    "brick_mortar": "#6E675B",
    "iron": "#3B352F",          # 铁门、窗钢棂、落水管、钢筋
    "concrete": "#3B352E",      # 屋面板、门槛
    "sandbag": "#8C7C60",       # 沙袋布（沙金降饱和）
    "void": "#0C0A08",          # 窗洞内部（比烟黑更暗，但不纯黑）
    "ground": "#14110D",
}

TEX_WORLD = {  # 每张贴图覆盖的真实尺寸（米）：必须能整除立面尺寸，UV 才能对齐楼层线
    "granite": (8.0, 5.0),   # 8 m 宽 = 1 开间；5 m 高 = 1 层 -> 64/8=8 次、25/5=5 次，正好整
    "brick": (2.4, 2.4),     # 一个窗洞
}


# --------------------------------------------------------------------------------------
# 1. 小工具
# --------------------------------------------------------------------------------------
def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def hex_linear(h: str):
    """hex -> Blender/glTF 需要的线性 RGBA。"""
    r, g, b = hex_rgb(h)
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def write_png(path: Path, arr_bottom_up: np.ndarray) -> int:
    """把 HxWx3 uint8 数组写成 8-bit RGB PNG（行 0 = 图像底部，符合 UV v=0 在底部）。

    自己写 PNG 而不是用 bpy.data.images：避免 Image.pixels 的线性/色彩空间歧义，
    并让贴图成为可单独查看的产物。返回字节数。
    """
    arr = np.ascontiguousarray(arr_bottom_up[::-1].astype(np.uint8))  # PNG 行 0 = 顶部
    h, w, _ = arr.shape
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0 (None)
        raw += arr[y].tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return len(png)


# --- 确定性 value noise（可平铺：索引按周期取模）----------------------------------------
def _hash2(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263
         + (seed * 2246822519) % 4294967296)
    h &= 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / 16777215.0


def value_noise(x, y, seed, period=None):
    """标准 value noise；period=(nx,ny) 时按周期取模 -> 贴图可无缝平铺。"""
    ix = np.floor(x).astype(np.int64)
    iy = np.floor(y).astype(np.int64)
    tx = x - ix
    ty = y - iy
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    x0, x1, y0, y1 = ix, ix + 1, iy, iy + 1
    if period is not None:
        nx, ny = period
        x0, x1 = np.mod(x0, nx), np.mod(x1, nx)
        y0 = np.mod(y0, ny)
        y1 = np.mod(y1, ny)
    v00 = _hash2(x0, y0, seed)
    v10 = _hash2(x1, y0, seed)
    v01 = _hash2(x0, y1, seed)
    v11 = _hash2(x1, y1, seed)
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty


def fbm(x, y, seed, octaves=3, base=2.0, period=None):
    tot = np.zeros_like(x, dtype=np.float64)
    amp, norm, f = 1.0, 0.0, base
    for o in range(octaves):
        per = None if period is None else (period[0] * f, period[1] * f)
        tot += amp * value_noise(x * f, y * f, seed + o * 977, per)
        norm += amp
        amp *= 0.5
        f *= 2.0
    return tot / norm


def height_to_normal(H: np.ndarray, strength: float) -> np.ndarray:
    """高度场（0..1，行=v，列=u）-> 切线空间法线贴图的 RGB 字节（uint8，非色彩数据）。"""
    dx = (np.roll(H, -1, axis=1) - np.roll(H, 1, axis=1)) * 0.5
    dy = (np.roll(H, -1, axis=0) - np.roll(H, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(H)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
    return np.clip((out * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------------------
# 2. 程序化贴图
# --------------------------------------------------------------------------------------
def gen_granite_maps(cfg, out_dir: Path):
    """花岗岩条石：1.0 m 长条石 x 0.5 m 层高，错缝砌法，8 m x 5 m 无缝平铺。

    - 每块独立色差（hash 决定，非 loop，向量化）
    - 灰缝下凹（同时进 base color 与 height -> normal）
    - 细颗粒（逐像素 hash，对应真实花岗岩 8 mm 粒级）
    - 竖向雨痕 + 墙脚湿痕（风化）
    """
    wpx, hpx = cfg["tex_granite_w"], cfg["tex_granite_h"]
    ww, wh = TEX_WORLD["granite"]
    n_blocks = max(1, cfg["blocks_per_row"])
    course_h = wh / 10.0                     # 0.5 m 层高
    block_w = ww / n_blocks                  # 8/6 = 1.33 m 条石
    joint = 0.010
    rng_seed = cfg["seed"] * 7 + 11

    xs = (np.arange(wpx) + 0.5) / wpx * ww
    zs = (np.arange(hpx) + 0.5) / hpx * wh
    X, Z = np.meshgrid(xs, zs)                        # (hpx, wpx)
    px_per_m = 1.0 / (ww / wpx)

    row = np.floor(Z / course_h).astype(np.int64)
    col_coord = X + (row % 2) * (block_w * 0.5)
    col = np.floor(col_coord / block_w).astype(np.int64)
    lx = col_coord - col * block_w
    lz = Z - row * course_h
    # 平铺要无缝：hash 必须用取模后的块号，否则接缝两侧同位置的两块色差不同，
    # 会在立面上每 8 m 出现一条竖向"色阶"。
    n_rows = int(round(wh / course_h))
    hc = np.mod(col, n_blocks)
    hr = np.mod(row, n_rows)

    # 软边（1.5 px 过渡，避免法线图出现硬阶梯）
    soft = 1.5 / px_per_m
    jt_h = np.clip(1.0 - (np.minimum(lz, course_h - lz) - 0.004) / soft, 0.0, 1.0)  # 水平缝
    jt_v = np.clip(1.0 - (np.minimum(lx, block_w - lx) - 0.004) / soft, 0.0, 1.0)  # 竖缝
    # 关键：竖向缝要远弱于水平缝。两者一样重就立刻读成"砖墙"，而花岗岩条石立面上
    # 看到的是层层水平灰缝，竖缝只有走近才分辨得出。
    jt = np.maximum(jt_h, jt_v * 0.40)
    H_joint = np.maximum(jt_h, jt_v * 0.45)

    base = np.array(hex_rgb(PALETTE["granite"]))
    light = np.array(hex_rgb(PALETTE["granite_lt"]))
    dark = np.array(hex_rgb(PALETTE["granite_dk"]))
    brick = np.array(hex_rgb(PALETTE["brick"]))

    # 每块色差（极小：花岗岩条石远看是一整片，色差一大就变砖墙）
    rv = _hash2(hc, hr, rng_seed) - 0.5              # -0.5 .. 0.5
    tone = 1.0 + rv * 0.07
    col_rgb = base[None, None, :] * tone[..., None]
    # 少量偏暖/偏暗的“脏”石
    dirty = (_hash2(hc, hr, rng_seed + 31) < 0.06).astype(np.float64)
    col_rgb = col_rgb * (1 - dirty[..., None] * 0.15) + brick[None, None, :] * dirty[..., None] * 0.15

    # 细颗粒（逐像素；坐标取模 -> 平铺无缝）
    gx = np.mod(np.arange(wpx)[None, :], wpx)
    gy = np.mod(np.arange(hpx)[:, None], hpx)
    pix = (_hash2(np.repeat(gx, hpx, 0), np.repeat(gy, wpx, 1), rng_seed + 5) - 0.5)
    col_rgb = col_rgb * (1.0 + pix[..., None] * 0.18)

    # 中尺度斑驳（可平铺：8 m x 5 m -> 4 x 2.5 个噪声格）
    mot = fbm(X / ww * 4.0, Z / wh * 2.5, rng_seed + 77, octaves=3,
              base=1.0, period=(4, 2))
    col_rgb = col_rgb * (1.0 + (mot - 0.5)[..., None] * 0.18)
    # 大尺度污渍（整张图 1x1 格）：老墙读的是这种成片的深浅，不是每块石头的色差
    broad = fbm(X / ww * 1.0, Z / wh * 1.0, rng_seed + 211, octaves=2,
                base=1.0, period=(1, 1))
    col_rgb = col_rgb * (1.0 + (broad - 0.5)[..., None] * 0.30)

    # 竖向雨痕（只沿 x 变化；上强下弱），周期 = 8 m / 0.55 => 取整数 15 格平铺
    streak = value_noise(X / ww * 15.0, np.zeros_like(X), rng_seed + 123, period=(15, 1))
    streak = (streak - 0.5)
    top_weight = np.clip((Z / wh) ** 1.3, 0, 1) * 0.7 + 0.3
    col_rgb = col_rgb * (1.0 + (streak * top_weight)[..., None] * 0.22)
    # 墙脚湿痕（下部整体压暗）
    damp = np.clip(1.0 - Z / 2.6, 0, 1) ** 1.8
    col_rgb = col_rgb * (1.0 - damp[..., None] * 0.26)

    # 灰缝压暗（克制：花岗岩缝细而浅，压太狠就读成砖；进法线图的浮雕比色差更重要）
    col_rgb = col_rgb * (1.0 - jt[..., None] * 0.14) + dark[None, None, :] * jt[..., None] * 0.14

    # 小概率的浅色补丁（旧修补）
    patch = value_noise(X / ww * 3.0, Z / wh * 2.0, rng_seed + 401, period=(3, 2))
    patch = np.clip((patch - 0.72) / 0.28, 0, 1) * 0.5
    col_rgb = col_rgb * (1 - patch[..., None]) + light[None, None, :] * patch[..., None]

    base_rgb = np.clip(col_rgb, 0, 1)
    base_path = out_dir / "granite_base.png"
    b1 = write_png(base_path, (base_rgb * 255).round())

    # 高度场 / 法线
    H = (1.0 - H_joint) * 0.75 + (pix * 0.5 + 0.5) * 0.06 + mot * 0.12 + patch * 0.10
    nrm = height_to_normal(H, strength=cfg["normal_strength"])
    nrm_path = out_dir / "granite_normal.png"
    b2 = write_png(nrm_path, nrm)

    return {"base": base_path, "normal": nrm_path,
            "bytes": {"base": b1, "normal": b2},
            "texel_per_m": wpx / ww}


def gen_brick_maps(cfg, out_dir: Path):
    """封窗砖：0.30 x 0.075 m 砖，2.4 x 2.4 m 平铺；少量掉砖露出黑缝。"""
    wpx, hpx = cfg["tex_brick"], cfg["tex_brick"]
    ww, wh = TEX_WORLD["brick"]
    bw, bh = 0.30, 0.075
    mortar = 0.012
    rng_seed = cfg["seed"] * 13 + 29

    xs = (np.arange(wpx) + 0.5) / wpx * ww
    zs = (np.arange(hpx) + 0.5) / hpx * wh
    X, Z = np.meshgrid(xs, zs)
    px_per_m = wpx / ww

    row = np.floor(Z / bh).astype(np.int64)
    col_coord = X + (row % 2) * (bw * 0.5)
    col = np.floor(col_coord / bw).astype(np.int64)
    lx = col_coord - col * bw
    lz = Z - row * bh
    hc = np.mod(col, int(round(ww / bw)))
    hr = np.mod(row, int(round(wh / bh)))
    d_edge = np.minimum(np.minimum(lx, bw - lx), np.minimum(lz, bh - lz))
    jt = np.clip(1.0 - (d_edge - mortar * 0.5) / (1.2 / px_per_m), 0.0, 1.0)

    base = np.array(hex_rgb(PALETTE["brick"]))
    mort = np.array(hex_rgb(PALETTE["brick_mortar"]))
    dark = np.array(hex_rgb(PALETTE["granite_dk"]))

    rv = _hash2(hc, hr, rng_seed) - 0.5
    tone = 1.0 + rv * 0.26
    col_rgb = base[None, None, :] * tone[..., None]

    gx = np.mod(np.arange(wpx)[None, :], wpx)
    gy = np.mod(np.arange(hpx)[:, None], hpx)
    pix = (_hash2(np.repeat(gx, hpx, 0), np.repeat(gy, wpx, 1), rng_seed + 3) - 0.5)
    col_rgb = col_rgb * (1.0 + pix[..., None] * 0.14)
    mot = fbm(X / ww * 5.0, Z / wh * 5.0, rng_seed + 9, octaves=2, base=1.0, period=(5, 5))
    col_rgb = col_rgb * (1.0 + (mot - 0.5)[..., None] * 0.20)

    col_rgb = col_rgb * (1 - jt[..., None]) + (mort * 0.92)[None, None, :] * jt[..., None]

    # 掉砖（黑缝）——封窗砖的空壳感
    missing = (_hash2(hc, hr, rng_seed + 55) < 0.035).astype(np.float64)
    col_rgb = col_rgb * (1 - missing[..., None]) + dark[None, None, :] * missing[..., None]

    path = out_dir / "brick_base.png"
    n = write_png(path, (np.clip(col_rgb, 0, 1) * 255).round())
    return {"base": path, "bytes": n, "texel_per_m": wpx / ww}


# --------------------------------------------------------------------------------------
# 3. 材质
# --------------------------------------------------------------------------------------
def _principled(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    return nt, nt.nodes.get("Principled BSDF")


def mat_flat(name, hex_color, rough=0.85, metallic=0.0):
    mat = bpy.data.materials.new(name)
    nt, bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = hex_linear(hex_color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    mat.use_backface_culling = False   # -> glTF doubleSided，规避手工绕序风险
    return mat


def mat_textured(name, base_png: Path, normal_png: Path | None, rough, metallic,
                 world_w, world_h, normal_strength=1.0):
    mat = bpy.data.materials.new(name)
    nt, bsdf = _principled(mat)
    nodes, links = nt.nodes, nt.links

    img = bpy.data.images.load(str(base_png), check_existing=True)
    img.colorspace_settings.name = "sRGB"
    img.pack()
    t = nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Linear"
    t.extension = "REPEAT"
    t.label = "base"
    t.location = (-700, 300)
    links.new(t.outputs["Color"], bsdf.inputs["Base Color"])

    if normal_png is not None:
        nimg = bpy.data.images.load(str(normal_png), check_existing=True)
        nimg.colorspace_settings.name = "Non-Color"
        nimg.pack()
        tn = nodes.new("ShaderNodeTexImage")
        tn.image = nimg
        tn.interpolation = "Linear"
        tn.extension = "REPEAT"
        tn.label = "normal"
        tn.location = (-700, -100)
        nm = nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nm.location = (-380, -100)
        links.new(tn.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    mat.use_backface_culling = False
    # 记录贴图真实覆盖尺寸，供 UV 生成
    mat["uv_world"] = [world_w, world_h]
    return mat


# --------------------------------------------------------------------------------------
# 4. 网格构建器
# --------------------------------------------------------------------------------------
class Builder:
    """累积顶点/面/材质索引；最后由 finish() 生成 bpy 网格（世界尺度 UV、平面着色）。"""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []          # list[tuple[int,...]]
        self.fmat = []           # list[int] 与 faces 对齐
        self.keys = []           # material key -> index
        self.index = {}

    def mat_index(self, key):
        if key not in self.index:
            self.index[key] = len(self.keys)
            self.keys.append(key)
        return self.index[key]

    def _push(self, pts, key):
        i0 = len(self.verts)
        self.verts.extend([(float(p[0]), float(p[1]), float(p[2])) for p in pts])
        self.faces.append(tuple(range(i0, i0 + len(pts))))
        self.fmat.append(self.mat_index(key))

    # --- 基本图元 -------------------------------------------------------------
    def quad(self, p0, p1, p2, p3, key):
        self._push([p0, p1, p2, p3], key)

    def tri(self, p0, p1, p2, key):
        self._push([p0, p1, p2], key)

    def poly(self, pts, key):
        self._push(list(pts), key)

    def box(self, x0, x1, y0, y1, z0, z1, key, skip=()):
        """轴对齐长方体；skip 里的面名可省（'x0','x1','y0','y1','z0','z1'）。"""
        if "y0" not in skip:  # 朝外（-Y）
            self.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), key)
        if "y1" not in skip:
            self.quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), key)
        if "x0" not in skip:
            self.quad((x0, y1, z0), (x0, y1, z1), (x0, y0, z1), (x0, y0, z0), key)
        if "x1" not in skip:
            self.quad((x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0), key)
        if "z0" not in skip:
            self.quad((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0), key)
        if "z1" not in skip:
            self.quad((x1, y0, z1), (x0, y0, z1), (x0, y1, z1), (x1, y1, z1), key)

    def box_rot(self, center, size, key, rz=0.0, rx=0.0, ry=0.0, jitter=0.0, rng=None):
        """任意旋转 + 顶点抖动的盒子（沙袋、碎石）。"""
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                   (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        if jitter > 0 and rng is not None:
            corners = [(c[0] * (1 + rng.uniform(-jitter, jitter)),
                        c[1] * (1 + rng.uniform(-jitter, jitter)),
                        c[2] * (1 + rng.uniform(-jitter, jitter))) for c in corners]
        R = (Matrix.Rotation(rz, 3, "Z") @ Matrix.Rotation(ry, 3, "Y")
             @ Matrix.Rotation(rx, 3, "X"))
        pts = []
        for c in corners:
            v = R @ Vector(c)
            pts.append((v.x + center[0], v.y + center[1], v.z + center[2]))
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        for q in f:
            self._push([pts[i] for i in q], key)

    # --- 输出 ----------------------------------------------------------------
    def finish(self, materials: dict, uv_scale_default=(8.0, 5.0)):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        for k in self.keys:
            me.materials.append(materials[k])

        # 材质索引（faces 顺序在 validate 后可能变化，故按多边形顺序映射后校验数量）
        if len(me.polygons) == len(self.fmat):
            me.polygons.foreach_set("material_index", self.fmat)
        else:  # validate 删掉了退化面：退回按顺序截断匹配，宁可少分材质也不崩
            for i, p in enumerate(me.polygons):
                p.material_index = self.fmat[min(i, len(self.fmat) - 1)]

        me.update()
        uvl = me.uv_layers.new(name="UVMap")
        uvdata = uvl.data
        loops = me.loops
        verts = me.vertices
        for poly in me.polygons:
            mat = me.materials[poly.material_index] if me.materials else None
            su, sv = (list(mat.get("uv_world", uv_scale_default)) if mat is not None
                      else uv_scale_default)
            n = poly.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for li in poly.loop_indices:
                co = verts[loops[li].vertex_index].co
                if ay >= ax and ay >= az:      # 朝外/朝内的面：投 XZ
                    u, v = co.x / su, co.z / sv
                elif ax >= az:                  # 侧返：投 YZ
                    u, v = co.y / su, co.z / sv
                else:                           # 顶/底：投 XY
                    u, v = co.x / su, co.y / sv
                uvdata[li].uv = (u, v)

        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob["tris"] = sum(len(p.vertices) - 2 for p in me.polygons)
        ob["faces"] = len(me.polygons)
        return ob


def tri_count(objs) -> int:
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def join_objects(objs, name):
    """合并成单一网格：glTF 里 (mesh x 用到的材质) = draw calls，
    合并后从 26 个 primitive 降到「材质数」个，满足 3D 切片的 ≤25 draw call 预算。"""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name + "_mesh"
    # 清掉没被任何面引用的材质槽（合并后可能出现空槽）
    used = {p.material_index for p in ob.data.polygons}
    if len(used) != len(ob.data.materials):
        for i in reversed(range(len(ob.data.materials))):
            if i not in used:
                ob.data.materials.pop(index=i)
                for p in ob.data.polygons:
                    if p.material_index > i:
                        p.material_index -= 1
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    return ob


# --------------------------------------------------------------------------------------
# 5. 几何：西立面
# --------------------------------------------------------------------------------------
def window_rects(cfg):
    """返回每个窗洞的 (x0,x1,z0,z1,floor,bay) 与状态。"""
    W, bays = cfg["width"], cfg["bays"]
    bay_w = W / bays
    ww, wh, sill, head = cfg["win_w"], cfg["win_h"], cfg["win_sill"], cfg["win_head"]
    out = []
    for f in range(1, cfg["floors"]):          # 二—五层
        z0, z1 = f * cfg["floor_h"] + sill, f * cfg["floor_h"] + head
        for b in range(bays):
            bx = -W / 2 + b * bay_w
            x0 = bx + (bay_w - ww) / 2
            out.append([x0, x0 + ww, z0, z1, f, b, None])
    return out


def breach_rect(cfg):
    """破洞在立面网格上切出的矩形（= 真实穿孔的外轮廓盒）。build_wall 挖空它，
    build_damage 在里面造锯齿破口，两者用同一个矩形才能严丝合缝。"""
    bx, bz = cfg["breach_x"], cfg["breach_z"]
    hw, hh = cfg["breach_hw"], cfg["breach_hh"]
    return (bx - hw, bx + hw, bz - hh, bz + hh)


def build_wall(cfg, mats, stats):
    rng = random.Random(cfg["seed"] + 101)
    W, H, T = cfg["width"], cfg["height"], cfg["depth"]
    dmg = cfg["damage"]
    wins = window_rects(cfg)

    # 窗洞状态：封砖 / 敞开（含钢窗棂）。封砖比例随破损程度上升（战时封窗御弹）
    for w in wins:
        w[6] = "bricked" if rng.random() < (0.16 + 0.30 * dmg) else "open"
    stats["windows"] = len(wins)
    stats["windows_bricked"] = sum(1 for w in wins if w[6] == "bricked")

    # 铁门（底楼，跨中轴）：故事里只开一半
    gate = [-cfg["gate_w"] / 2, cfg["gate_w"] / 2, 0.0, cfg["gate_h"]]
    brx = breach_rect(cfg)

    xs = {-W / 2, W / 2, gate[0], gate[1], brx[0], brx[1]}
    for w in wins:
        xs.add(round(w[0], 6))
        xs.add(round(w[1], 6))
    zs = {0.0, H, gate[3], brx[2], brx[3]}
    for f in range(1, cfg["floors"]):
        zs.add(f * cfg["floor_h"])
    for w in wins:
        zs.add(w[2])
        zs.add(w[3])
    xs = sorted(xs)
    zs = sorted(zs)

    def which(x0, x1, z0, z1):
        e = 1e-6
        if (x0 > brx[0] - e and x1 < brx[1] + e
                and z0 > brx[2] - e and z1 < brx[3] + e):
            return ("breach", None)
        for w in wins:
            if abs(x0 - w[0]) < e and abs(x1 - w[1]) < e and abs(z0 - w[2]) < e and abs(z1 - w[3]) < e:
                return ("win", w)
        if abs(x0 - gate[0]) < e and abs(x1 - gate[1]) < e and abs(z0 - gate[2]) < e and abs(z1 - gate[3]) < e:
            return ("gate", None)
        return ("solid", None)

    b_wall = Builder("wall")
    b_win = Builder("windows")
    b_gate = Builder("gate")
    depth_open = cfg["reveal"]

    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            x0, x1, z0, z1 = xs[i], xs[i + 1], zs[j], zs[j + 1]
            if x1 - x0 < 1e-5 or z1 - z0 < 1e-5:
                continue
            kind, w = which(x0, x1, z0, z1)
            if kind == "solid":
                b_wall.quad((x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1), "granite")
            elif kind == "win":
                d = depth_open
                # 洞口四壁（花岗岩）
                b_win.quad((x0, 0, z0), (x1, 0, z0), (x1, d, z0), (x0, d, z0), "granite_break")  # 窗台
                b_win.quad((x0, d, z1), (x1, d, z1), (x1, 0, z1), (x0, 0, z1), "granite")     # 过梁
                b_win.quad((x0, 0, z0), (x0, d, z0), (x0, d, z1), (x0, 0, z1), "granite")     # 左
                b_win.quad((x1, 0, z0), (x1, 0, z1), (x1, d, z1), (x1, d, z0), "granite")     # 右
                if w[6] == "bricked":
                    yb = 0.10
                    b_win.quad((x0, yb, z0), (x1, yb, z0), (x1, yb, z1), (x0, yb, z1), "brick")
                else:
                    b_win.quad((x0, d, z0), (x1, d, z0), (x1, d, z1), (x0, d, z1), "void")
                    # 钢窗棂：2 竖 2 横（1930s 工业窗）
                    wd = x1 - x0
                    hd = z1 - z0
                    for k in (1, 2):
                        mx = x0 + wd * k / 3.0
                        b_win.box(mx - 0.035, mx + 0.035, 0.08, 0.14, z0, z1, "iron")
                    for k in (1, 2):
                        mz = z0 + hd * k / 3.0
                        b_win.box(x0, x1, 0.08, 0.14, mz - 0.03, mz + 0.03, "iron")
            else:  # gate 以外的破洞矩形：立面在此处整个挖空，破口几何由 build_damage 填
                if kind == "gate":
                    d = 0.75
                    b_gate.quad((x0, 0, z0), (x1, 0, z0), (x1, d, z0), (x0, d, z0), "concrete")
                    b_gate.quad((x0, d, z1), (x1, d, z1), (x1, 0, z1), (x0, 0, z1), "iron")
                    b_gate.quad((x0, 0, z0), (x0, d, z0), (x0, d, z1), (x0, 0, z1), "iron")
                    b_gate.quad((x1, 0, z0), (x1, 0, z1), (x1, d, z1), (x1, d, z0), "iron")
                    b_gate.quad((x0, 0.62, z0), (x1, 0.62, z0), (x1, 0.62, z1),
                                (x0, 0.62, z1), "void")
                continue

    # 墙体其余面（左右返、顶、底、内皮）
    b_wall.quad((-W / 2, 0, 0), (-W / 2, 0, H), (-W / 2, T, H), (-W / 2, T, 0), "granite")
    b_wall.quad((W / 2, 0, 0), (W / 2, T, 0), (W / 2, T, H), (W / 2, 0, H), "granite")
    b_wall.quad((-W / 2, 0, H), (W / 2, 0, H), (W / 2, T, H), (-W / 2, T, H), "granite")
    b_wall.quad((-W / 2, T, 0), (W / 2, T, 0), (W / 2, T, H), (-W / 2, T, H), "concrete")
    # 门洞与窗洞内侧的"背幕"：防止穿帮看穿
    b_wall.quad((-W / 2, T - 0.02, 0), (W / 2, T - 0.02, 0), (W / 2, T - 0.02, H),
                (-W / 2, T - 0.02, H), "void")

    objs = [b_wall.finish(mats), b_win.finish(mats), b_gate.finish(mats)]
    return objs, wins, gate


def build_courses(cfg, mats):
    """层间腰线 / 檐口 / 台基：7 条水平石带，靠投影阴影读楼层。"""
    W, H = cfg["width"], cfg["height"]
    b = Builder("courses")
    for f in range(1, cfg["floors"]):
        z = f * cfg["floor_h"]
        b.box(-W / 2 - 0.02, W / 2 + 0.02, -0.15, 0.02, z - 0.11, z + 0.11, "granite")
    # 檐口（顶层上）
    b.box(-W / 2 - 0.06, W / 2 + 0.06, -0.26, 0.02, H - 0.52, H - 0.10, "granite")
    # 台基
    b.box(-W / 2 - 0.05, W / 2 + 0.05, -0.24, 0.02, 0.0, 0.62, "granite")
    # 竖向壁柱（开间分隔）：9 根，落在开间线上
    bays = cfg["bays"]
    for i in range(bays + 1):
        x = -W / 2 + i * (W / bays)
        if i in (0, bays):
            continue
        b.box(x - 0.24, x + 0.24, -0.12, 0.02, 0.62, H - 0.52, "granite")
    return [b.finish(mats)]


def build_parapet_roof(cfg, mats):
    """女儿墙（分段、顶上被削平/缺角）+ 屋面板 + 屋顶构筑物 + 落水管。"""
    W, H = cfg["width"], cfg["height"]
    dmg = cfg["damage"]
    rng = random.Random(cfg["seed"] + 303)
    b = Builder("parapet")
    segs = 7
    seg_w = W / segs
    for i in range(segs):
        x0 = -W / 2 + i * seg_w + 0.008
        x1 = x0 + seg_w - 0.016
        h = cfg["parapet_h"] * (1.0 + rng.uniform(-0.10, 0.10))
        if rng.random() < 0.22 * dmg:          # 被炮火削低的一段
            h *= rng.uniform(0.45, 0.72)
        b.box(x0, x1, -0.06, 0.34, H, H + h, "granite")
        # 压顶石
        b.box(x0 - 0.02, x1 + 0.02, -0.10, 0.38, H + h, H + h + 0.10, "granite_break")
    # 山墙两端返（沿 y 往里 9 m）
    for x in (-W / 2, W / 2):
        b.box(x - 0.17, x + 0.17, -0.06, 9.0, H, H + cfg["parapet_h"], "granite")
    # 屋面板
    b.box(-W / 2, W / 2, 0.30, 9.0, H - 0.14, H - 0.02, "concrete")
    # 屋顶构筑物：楼梯间、排风井、烟囱
    b.box(-11.0, -7.4, 2.2, 5.6, H - 0.02, H + 2.5, "concrete")
    b.box(-10.6, -7.8, 2.6, 5.2, H + 2.5, H + 2.62, "concrete")
    b.box(6.4, 7.6, 3.0, 4.2, H - 0.02, H + 1.9, "concrete")
    for i, x in enumerate((13.5, 23.0)):
        b.box(x - 0.42, x + 0.42, 2.8, 3.64, H - 0.02, H + 1.35 + i * 0.2, "brick")
    # 落水管（铸铁）
    for x in (-W / 2 + 1.2, W / 2 - 1.2):
        b.box(x - 0.07, x + 0.07, -0.16, -0.02, 0.4, H - 0.6, "iron")
    return [b.finish(mats)]


def build_gate_leaves(cfg, mats):
    """铁门两扇：左扇关、右扇开 55°（故事：铁门只开一半）。"""
    b = Builder("gate_leaves")
    gw, gh = cfg["gate_w"], cfg["gate_h"]
    leaf_w = gw / 2 - 0.04
    # 门槛石
    b.box(-gw / 2 - 0.2, gw / 2 + 0.2, -0.40, 0.30, 0.0, 0.14, "granite_lt")
    # 门框（花岗岩镶边）
    b.box(-gw / 2 - 0.26, -gw / 2, -0.06, 0.06, 0.14, gh + 0.24, "granite_lt")
    b.box(gw / 2, gw / 2 + 0.26, -0.06, 0.06, 0.14, gh + 0.24, "granite_lt")
    b.box(-gw / 2 - 0.26, gw / 2 + 0.26, -0.06, 0.06, gh, gh + 0.26, "granite_lt")

    cy = 0.30          # 门扇所在 y（在门洞内 0.62 的背幕之前）
    strap_z = [0.55 + k * (gh - 1.35) / 2 for k in range(3)]

    # 关着的左扇：门板 + 3 道横向铁箍
    b.box(-gw / 2 + 0.04, -0.02, cy - 0.035, cy + 0.035, 0.14, gh, "iron")
    for z in strap_z:
        b.box(-gw / 2 + 0.04, -0.02, cy - 0.078, cy - 0.035, z - 0.06, z + 0.06, "iron")

    # 开着的右扇：绕右铰链（x=+gw/2, y=cy）向室内转 55°
    hinge = Vector((gw / 2 - 0.02, cy, 0.0))
    R = Matrix.Rotation(-math.radians(55.0), 3, "Z")

    def leaf_prism(lx0, lx1, ly0, ly1, zz0, zz1):
        corners = ((lx0, ly0, zz0), (lx1, ly0, zz0), (lx1, ly1, zz0), (lx0, ly1, zz0),
                   (lx0, ly0, zz1), (lx1, ly0, zz1), (lx1, ly1, zz1), (lx0, ly1, zz1))
        pts = []
        for c in corners:
            v = R @ Vector(c)
            pts.append((v.x + hinge.x, v.y + hinge.y, v.z))
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5),
                  (2, 3, 7, 6), (3, 0, 4, 7)):
            b._push([pts[i] for i in q], "iron")

    leaf_prism(-leaf_w, 0.0, -0.035, 0.035, 0.14, gh)
    for z in strap_z:
        leaf_prism(-leaf_w, 0.0, -0.078, -0.035, z - 0.06, z + 0.06)
    return [b.finish(mats)]


def build_damage(cfg, mats, wins, gate):
    """弹痕：8 个炮弹孔（内凹碗状，崩边亮）+ N 个枪弹孔（小面片）+ 一处打穿的破洞。"""
    W, H = cfg["width"], cfg["height"]
    rng = random.Random(cfg["seed"] + 707)
    b = Builder("damage")

    def in_opening(x, z):
        for w in wins:
            if w[0] - 0.15 < x < w[1] + 0.15 and w[2] - 0.15 < z < w[3] + 0.15:
                return True
        if gate[0] - 0.3 < x < gate[1] + 0.3 and z < gate[3] + 0.3:
            return True
        br = breach_rect(cfg)
        if br[0] - 0.35 < x < br[1] + 0.35 and br[2] - 0.35 < z < br[3] + 0.35:
            return True
        return False

    # ---- 8 个炮弹孔：贴在墙面上的浅碗贴片（崩边亮环 + 碗底暗心）----
    # 不做真实凹坑：立面是单张平面，凹进去的部分会被挡住；而 1.5 m 的坑在游戏视距下
    # 只有 ~18 px，两层贴片和真凹坑不可区分（省掉 8 次立面挖洞）。
    shell_spots = []
    tries = 0
    while len(shell_spots) < cfg["shell_holes"] and tries < 4000:
        tries += 1
        f = rng.choice([3, 3, 4, 4, 2])
        cx = rng.uniform(-W / 2 + 3.0, W / 2 - 3.0)
        cz = f * cfg["floor_h"] + rng.uniform(0.9, 4.4)
        if in_opening(cx, cz):
            continue
        if any((cx - s[0]) ** 2 + (cz - s[1]) ** 2 < 3.0 for s in shell_spots):
            continue
        shell_spots.append((cx, cz, rng.uniform(0.55, 1.15)))
    for (cx, cz, r) in shell_spots:
        n = 8
        outer, mid, core = [], [], []
        for k in range(n):
            a = 2 * math.pi * k / n + rng.uniform(-0.12, 0.12)
            rr = r * rng.uniform(0.85, 1.2)
            outer.append((cx + rr * math.cos(a), -0.004 - rng.uniform(0, 0.004),
                          cz + rr * math.sin(a)))
            rm = rr * 0.52 * rng.uniform(0.9, 1.1)
            mid.append((cx + rm * math.cos(a), -0.006 - rng.uniform(0, 0.004),
                        cz + rm * math.sin(a)))
            rc = rr * 0.34 * rng.uniform(0.75, 1.25)
            core.append((cx + rc * math.cos(a), -0.008, cz + rc * math.sin(a)))
        for k in range(n):
            k2 = (k + 1) % n
            b.quad(outer[k], outer[k2], mid[k2], mid[k], "scar")         # 崩边（浅一档）
        b.poly(core, "void")                                             # 碗底
    stats_shell = len(shell_spots)

    # ---- 枪弹孔：集中在两块斑区，430 个（历史口径） ----
    clusters = [(-6.0, 17.0, 15.0, 6.6, 0.60),
                (11.0, 12.5, 6.5, 5.0, 0.40)]
    holes = 0
    tries = 0
    want = cfg["bullet_holes"]
    while holes < want and tries < want * 60:
        tries += 1
        tot = sum(c[4] for c in clusters)
        pick = rng.uniform(0, tot)
        acc = 0.0
        for c in clusters:
            acc += c[4]
            if pick <= acc:
                cx, cz, rx, rz, _ = c
                break
        # 椭圆内均匀取样
        while True:
            u = rng.uniform(-1, 1)
            v = rng.uniform(-1, 1)
            if u * u + v * v <= 1.0:
                break
        x = cx + u * rx
        z = cz + v * rz
        if x < -W / 2 + 0.5 or x > W / 2 - 0.5 or z < 0.8 or z > H - 0.8:
            continue
        if in_opening(x, z):
            continue
        s = rng.uniform(0.035, 0.090) if rng.random() > 0.10 else rng.uniform(0.11, 0.17)
        ang = rng.uniform(0, math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        y0 = -0.003 - rng.uniform(0, 0.003)     # 崩边贴片
        y1 = y0 - 0.003                          # 弹孔暗心：必须更靠近观察者，否则被贴片挡住
        quad = [(x - s * ca, y0, z - s * sa), (x - s * sa * 0.9, y0, z + s * ca * 0.9),
                (x + s * ca, y0, z + s * sa), (x + s * sa, y0, z - s * ca)]
        inner = [(px * 0.58 + x * 0.42, y1, pz * 0.58 + z * 0.42) for (px, _, pz) in quad]
        b.quad(*quad, "scar")
        b.quad(inner[0], inner[1], inner[2], inner[3], "void")
        holes += 1
    stats_bullets = holes

    # ---- 被打穿的破洞（night3b）：build_wall 已在立面挖空 breach_rect，
    #      这里用「锯齿状外缘 + 两层内凹环 + 碗底」把那个矩形填成真实穿孔。
    brx = breach_rect(cfg)
    x0, x1, z0, z1 = brx
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    hw, hh = (x1 - x0) / 2, (z1 - z0) / 2

    # 外环：严格落在矩形边界上（与立面网格共享边），每边 3 点
    def perim_pts(n_side=3):
        pts = []
        for i in range(n_side):            # 下边：左 -> 右
            t = (i + 0.5) / n_side
            pts.append((x0 + 2 * hw * t, 0.0, z0))
        for i in range(n_side):            # 右边：下 -> 上
            t = (i + 0.5) / n_side
            pts.append((x1, 0.0, z0 + 2 * hh * t))
        for i in range(n_side):            # 上边：右 -> 左
            t = (i + 0.5) / n_side
            pts.append((x1 - 2 * hw * t, 0.0, z1))
        for i in range(n_side):            # 左边：上 -> 下
            t = (i + 0.5) / n_side
            pts.append((x0, 0.0, z1 - 2 * hh * t))
        return pts

    ring = perim_pts(5)
    n = len(ring)
    jag, mid = [], []
    for (px, _, pz) in ring:
        dx, dz = (px - cx), (pz - cz)
        # 白茬要窄（贴着矩形边），洞要黑要大：否则整块读成"浅色贴片"而不是被打穿
        f = 0.80 + 0.13 * abs(_h(px * 1.7 + pz * 2.3 + cfg["seed"]))
        jag.append((cx + dx * f, 0.18 + 0.24 * abs(_h(px * 3.1 + pz + cfg["seed"])),
                    cz + dz * f))
        f2 = 0.44 + 0.12 * _h(pz * 2.9 + px * 1.1 + cfg["seed"])
        mid.append((cx + dx * f2, 0.52, cz + dz * f2))
    for k in range(n):
        k2 = (k + 1) % n
        b.quad(ring[k], ring[k2], jag[k2], jag[k], "granite_break")  # 崩裂的白茬
        b.quad(jag[k], jag[k2], mid[k2], mid[k], "granite_dk")       # 往里收的暗壁
    b.poly(mid, "void")
    # 露出的钢筋：从破口上沿斜伸出来的短段（低多边形，只求剪影；不反光，避免夜里成白棍）
    for i in range(4):
        px = cx - 0.55 + i * 0.36
        pz = cz + hh * 0.45
        ang = -0.30 + i * 0.20
        ln = 0.75 + 0.3 * (i % 3)
        b.box_rot((px + ln * 0.22, 0.10, pz - ln * 0.20),
                  (0.032, 0.032, ln), "rebar",
                  rz=0.0, rx=math.radians(20) + ang * 0.2, ry=ang)

    stats = {"shell_holes": stats_shell, "bullet_holes": stats_bullets,
             "breach": 1, "breach_size_m": [round(x1 - x0, 2), round(z1 - z0, 2)]}
    return [b.finish(mats)], stats


def _h(x):
    """[-1,1] 的确定性伪随机（用于不规则轮廓）。"""
    v = math.sin(x * 12.9898 + 78.233) * 43758.5453
    return (v - math.floor(v)) * 2.0 - 1.0


def build_sandbags_rubble(cfg, mats):
    """墙脚沙袋垛（左边半开的铁门）与炮火落下的碎石。"""
    W, H = cfg["width"], cfg["height"]
    dmg = cfg["damage"]
    rng = random.Random(cfg["seed"] + 909)
    b = Builder("sandbags")
    # 门两侧各一垛，2 层
    for side in (-1, 1):
        x_base = side * (cfg["gate_w"] / 2 + 0.9)
        for course in range(2):
            for i in range(5):
                x = x_base + side * (i * 0.64 + rng.uniform(-0.04, 0.04))
                z = 0.16 + course * 0.30 + rng.uniform(-0.02, 0.02)
                b.box_rot((x, -0.30 - rng.uniform(0, 0.10), z),
                          (0.66, 0.40, 0.30), "sandbag",
                          rz=rng.uniform(-0.16, 0.16), rx=rng.uniform(-0.05, 0.05),
                          jitter=0.06, rng=rng)
    # 破洞下方与沿墙的碎石
    n_rub = int(10 + 14 * dmg)
    for i in range(n_rub):
        if i < 8:
            x = cfg["breach_x"] + rng.uniform(-2.6, 2.6)
        else:
            x = rng.uniform(-W / 2 + 1.0, W / 2 - 1.0)
        s = rng.uniform(0.18, 0.62)
        b.box_rot((x, -0.35 - rng.uniform(0, 0.9), s * 0.35),
                  (s, s * rng.uniform(0.6, 1.1), s * rng.uniform(0.45, 0.8)), "granite_lt",
                  rz=rng.uniform(0, 3.14), rx=rng.uniform(-0.3, 0.3),
                  jitter=0.22, rng=rng)
    return [b.finish(mats)], n_rub


def build_ground(cfg, mats):
    """墙脚地面（导出时排除，只在预览里挡一下背景）。"""
    b = Builder("ground_apron")
    b.box(-cfg["width"] / 2 - 8, cfg["width"] / 2 + 8, -14.0, 0.02, -0.12, 0.0, "ground")
    return [b.finish(mats)]


# --------------------------------------------------------------------------------------
# 6. 预览渲染（Cycles CPU）
# --------------------------------------------------------------------------------------
def setup_render(cfg):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"           # 硬约束：不占显存
    sc.cycles.samples = cfg["samples"]
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    try:
        sc.cycles.denoising_use_gpu = False
    except Exception:
        pass
    sc.cycles.max_bounces = 4
    for attr, val in (("diffuse_bounces", 2), ("glossy_bounces", 2),
                      ("transmission_bounces", 2), ("transparent_max_bounces", 2),
                      ("use_fast_gi", False), ("blur_glossy", 1.0)):
        try:
            setattr(sc.cycles, attr, val)
        except Exception:
            pass
    sc.render.resolution_x = cfg["res_x"]
    sc.render.resolution_y = cfg["res_y"]
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.render.film_transparent = False
    sc.render.filter_size = 1.6
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    for vt in ("AgX", "Filmic", "Standard"):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    for look in ("AgX - Medium High Contrast", "AgX - Base Contrast", "Medium High Contrast",
                 "None"):
        try:
            sc.view_settings.look = look
            break
        except Exception:
            continue
    sc.view_settings.exposure = cfg["exposure"]


def setup_lighting(cfg):
    sc = bpy.context.scene
    world = bpy.data.worlds.new("night")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = hex_linear(cfg["sky_hex"])
    bg.inputs[1].default_value = cfg["sky_strength"]
    sc.world = world

    def place_sun(name, travel_dir, energy, color_hex, angle_deg):
        """travel_dir = 光行进方向（不是入射点）。太阳沿自身 -Z 发光。"""
        d = Vector(travel_dir).normalized()
        lt = bpy.data.lights.new(name, type="SUN")
        lt.energy = energy
        lt.angle = math.radians(angle_deg)
        lt.color = hex_rgb(color_hex)
        ob = bpy.data.objects.new(name, lt)
        ob.rotation_euler = (-d).to_track_quat("Z", "Y").to_euler()
        sc.collection.objects.link(ob)
        return ob

    # 主光：画外左前上方一大片暖光（对岸灯火 / 远处火光）。用面光而不是太阳：
    # 面光有距离衰减，64 m 宽立面上会出现自然的明暗过渡，太阳是匀光、会把墙拍平。
    d = Vector((0.58, 0.70, -0.42)).normalized()
    key = bpy.data.lights.new("key_fire", type="AREA")
    key.shape = "RECTANGLE"
    key.size = cfg["key_size"]
    key.size_y = cfg["key_size"] * 0.62
    key.energy = cfg["key_energy"]
    key.color = hex_rgb("#F6DFC2")
    okey = bpy.data.objects.new("key_fire", key)
    okey.location = Vector(cfg["key_pos"])
    okey.rotation_euler = (d).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(okey)

    # 补光：极弱中性暖灰（雾的反照），不许青蓝
    place_sun("fill_haze", (-0.55, 0.62, -0.55), cfg["fill_energy"], "#A9A398", 14.0)

    # 叙事光：门缝里一点煤油灯（bible：夜晚只允许一点暖光）
    lamp = bpy.data.lights.new("kerosene", type="POINT")
    lamp.energy = cfg["lamp_energy"]
    lamp.color = hex_rgb("#FFB25E")
    lamp.shadow_soft_size = 0.22
    o3 = bpy.data.objects.new("kerosene", lamp)
    o3.location = (0.4, 1.15, 2.35)
    sc.collection.objects.link(o3)


def add_camera(name, loc, look, lens):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.sensor_width = 36.0
    cam.sensor_fit = "HORIZONTAL"
    cam.clip_start = 0.1
    cam.clip_end = 500.0
    ob = bpy.data.objects.new(name, cam)
    d = Vector(look) - Vector(loc)
    ob.location = loc
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(ob)
    return ob


def render_shot(scene, cam, path: Path):
    scene.camera = cam
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


# --------------------------------------------------------------------------------------
# 7. 导出
# --------------------------------------------------------------------------------------
def export_glb(obj_list, path: Path, cfg, stats):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in obj_list:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj_list[0]

    kwargs = dict(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=cfg["jpeg_quality"],
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=False,
        export_apply_modifiers=False,
    )
    # 只保留该版本实际存在的参数，跨版本稳妥
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    kwargs = {k: v for k, v in kwargs.items() if k in props}
    bpy.ops.export_scene.gltf(**kwargs)
    return path.stat().st_size


def inspect_glb(path: Path):
    """读 GLB 头 + JSON chunk，回报内嵌贴图格式与大小（验证 JPEG 内嵌是否生效）。"""
    data = path.read_bytes()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    jlen, jtype = struct.unpack_from("<II", data, off)
    off += 8
    js = json.loads(data[off:off + jlen])
    imgs = []
    for im in js.get("images", []):
        if "bufferView" not in im:
            imgs.append({"mimeType": im.get("mimeType", "uri"), "bytes": 0,
                         "name": im.get("uri", "?")})
            continue
        bv = js["bufferViews"][im["bufferView"]]
        imgs.append({"mimeType": im.get("mimeType", "?"), "bytes": bv["byteLength"],
                     "name": im.get("name", "")})
    prim = sum(len(m.get("primitives", [])) for m in js.get("meshes", []))
    # 独立复核三角面：glTF 里按 primitive 的 index 数 /3 统计（不依赖 Blender 内部计数）
    tris = 0
    for m in js.get("meshes", []):
        for p in m.get("primitives", []):
            if p.get("mode", 4) == 4 and "indices" in p:
                tris += js["accessors"][p["indices"]]["count"] // 3
    mats = []
    for mt in js.get("materials", []):
        pbr = mt.get("pbrMetallicRoughness", {})
        mats.append({
            "name": mt.get("name", ""),
            "baseColorTexture": "baseColorTexture" in pbr,
            "normalTexture": "normalTexture" in mt,
            "baseColorFactor": [round(c, 3) for c in pbr.get("baseColorFactor", [1, 1, 1, 1])],
            "metallic": pbr.get("metallicFactor"),
            "roughness": pbr.get("roughnessFactor"),
            "doubleSided": mt.get("doubleSided", False),
        })
    return {
        "glb_version": ver,
        "glb_bytes": total,
        "json_bytes": jlen,
        "images": imgs,
        "image_bytes": sum(i["bytes"] for i in imgs),
        "meshes": len(js.get("meshes", [])),
        "primitives": prim,
        "mesh_triangles": tris,
        "materials": len(js.get("materials", [])),
        "material_detail": mats,
        "nodes": len(js.get("nodes", [])),
        "accessors": len(js.get("accessors", [])),
        "generator": js.get("asset", {}).get("generator", ""),
    }


# --------------------------------------------------------------------------------------
# 8. main
# --------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser(
        prog="build_warehouse.py",
        description="四行仓库西墙外观 -> warehouse-ext.glb（Blender 4.2 无头）")
    p.add_argument("--seed", type=int, default=1937)
    p.add_argument("--damage", type=float, default=0.6, help="破损程度 0..1")
    p.add_argument("--width", type=float, default=64.0)
    p.add_argument("--height", type=float, default=25.0)
    p.add_argument("--depth", type=float, default=0.9, help="墙厚（米）")
    p.add_argument("--floors", type=int, default=5)
    p.add_argument("--bays", type=int, default=8)
    p.add_argument("--win-w", type=float, default=2.6)
    p.add_argument("--win-h", type=float, default=3.0)
    p.add_argument("--win-sill", type=float, default=1.35)
    p.add_argument("--win-head", type=float, default=4.35)
    p.add_argument("--gate-w", type=float, default=4.6)
    p.add_argument("--gate-h", type=float, default=4.3)
    p.add_argument("--parapet-h", type=float, default=1.35)
    p.add_argument("--reveal", type=float, default=0.55, help="窗洞内凹深度")
    p.add_argument("--bullet-holes", type=int, default=430)
    p.add_argument("--shell-holes", type=int, default=8)
    p.add_argument("--breach-x", type=float, default=-24.0)
    p.add_argument("--breach-z", type=float, default=12.5)
    p.add_argument("--breach-hw", type=float, default=1.55, help="破洞半宽（米）")
    p.add_argument("--breach-hh", type=float, default=1.75, help="破洞半高（米）")
    p.add_argument("--tex-granite-w", type=int, default=1024)
    p.add_argument("--tex-granite-h", type=int, default=640)
    p.add_argument("--tex-brick", type=int, default=512)
    p.add_argument("--normal-strength", type=float, default=2.2)
    p.add_argument("--jpeg-quality", type=int, default=86)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--res-x", type=int, default=1024)
    p.add_argument("--res-y", type=int, default=576)
    p.add_argument("--exposure", type=float, default=-0.6)
    p.add_argument("--key-energy", type=float, default=9e4)
    p.add_argument("--key-size", type=float, default=22.0)
    p.add_argument("--key-pos", type=str, default="-70,-42,24",
                   help="主光位置 x,y,z（面光，位置决定 64 m 立面明暗过渡）")
    p.add_argument("--fill-energy", type=float, default=0.25)
    p.add_argument("--lamp-energy", type=float, default=1200.0)
    p.add_argument("--sky-hex", type=str, default="#241F1A")
    p.add_argument("--sky-strength", type=float, default=0.5)
    p.add_argument("--blocks-per-row", type=int, default=6,
                   help="条石每 8 m 几块（8/6=1.33 m 长，接近真实条石）")
    p.add_argument("--render", dest="render", action="store_true", default=False)
    p.add_argument("--no-render", dest="render", action="store_false")
    p.add_argument("--quick", action="store_true", help="低分辨率低采样，仅用于迭代")
    p.add_argument("--save-blend", action="store_true")
    p.add_argument("--out-glb", type=str, default="public/models/warehouse-ext.glb")
    p.add_argument("--shots-dir", type=str, default="docs/report/blender-shots")
    p.add_argument("--tex-dir", type=str, default="tools/blender/tex")
    return p.parse_args(argv)


def main():
    t0 = time.time()
    cfg = vars(parse_args())
    if cfg["quick"]:
        cfg.update(samples=8, res_x=512, res_y=288, tex_granite_w=512, tex_granite_h=320,
                   tex_brick=256)
    cfg["floor_h"] = cfg["height"] / cfg["floors"]
    cfg["damage"] = max(0.0, min(1.0, cfg["damage"]))
    cfg["key_pos"] = [float(v) for v in cfg["key_pos"].split(",")]

    root = Path(__file__).resolve().parents[2]
    out_glb = (root / cfg["out_glb"]).resolve()
    shots = (root / cfg["shots_dir"]).resolve()
    texd = (root / cfg["tex_dir"]).resolve()
    texd.mkdir(parents=True, exist_ok=True)
    shots.mkdir(parents=True, exist_ok=True)
    out_glb.parent.mkdir(parents=True, exist_ok=True)

    print("\n" + "=" * 72)
    print(f"四行仓库西墙  hero asset  |  seed={cfg['seed']}  damage={cfg['damage']:.2f}")
    print(f"立面 {cfg['width']:.1f} x {cfg['height']:.1f} m, {cfg['floors']} 层,"
          f" {cfg['bays']} 开间, 墙厚 {cfg['depth']:.2f} m")
    print("=" * 72)

    # ---- 场景复位（可重复运行）----
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0

    # ---- 贴图 ----
    t = time.time()
    g = gen_granite_maps(cfg, texd)
    br = gen_brick_maps(cfg, texd)
    tex_time = time.time() - t
    print(f"[tex] granite {g['bytes']['base'] / 1024:.0f} KB + normal "
          f"{g['bytes']['normal'] / 1024:.0f} KB, brick {br['bytes'] / 1024:.0f} KB "
          f"({g['texel_per_m']:.0f} texel/m, {tex_time:.1f}s)")

    mats = {
        "granite": mat_textured("granite", g["base"], g["normal"], 0.86, 0.0,
                                *TEX_WORLD["granite"], cfg["normal_strength"]),
        "granite_lt": mat_flat("granite_light", PALETTE["granite_lt"], 0.82),
        "granite_break": mat_flat("granite_break", PALETTE["granite_break"], 0.88),
        "granite_dk": mat_flat("granite_dark", PALETTE["granite_dk"], 0.90),
        "brick": mat_textured("brick_infill", br["base"], None, 0.92, 0.0,
                              *TEX_WORLD["brick"]),
        "concrete": mat_flat("concrete", PALETTE["concrete"], 0.94),
        "iron": mat_flat("iron_rusted", PALETTE["iron"], 0.68, 0.35),
        "rebar": mat_flat("rebar", PALETTE["iron"], 0.92, 0.0),
        "scar": mat_flat("scar", PALETTE["scar"], 0.90),
        "sandbag": mat_flat("sandbag_cloth", PALETTE["sandbag"], 0.95),
        "void": mat_flat("interior_void", PALETTE["void"], 0.98),
        "ground": mat_flat("ground", PALETTE["ground"], 0.95),
    }

    # ---- 几何 ----
    t = time.time()
    objs = []
    stats = {}
    w_objs, wins, gate = build_wall(cfg, mats, stats)
    objs += w_objs
    objs += build_courses(cfg, mats)
    objs += build_parapet_roof(cfg, mats)
    objs += build_gate_leaves(cfg, mats)
    d_objs, dstats = build_damage(cfg, mats, wins, gate)
    objs += d_objs
    sr_objs, n_rub = build_sandbags_rubble(cfg, mats)
    objs += sr_objs
    ground_objs = build_ground(cfg, mats)
    geo_time = time.time() - t

    tris = tri_count(objs)
    all_tris = tri_count(objs + ground_objs)
    breakdown = [(o.name, int(o["tris"])) for o in objs]
    asset = join_objects(objs, "warehouse-ext")
    tris = tri_count([asset])
    print(f"[geo] 合并为 1 个 mesh（原 {len(objs)} 个对象）, {tris} tris "
          f"(含地面 {all_tris}), {geo_time:.1f}s")
    print("[geo] 分项： " + "  ".join(f"{n}={t}" for n, t in breakdown))
    print(f"      窗洞 {stats['windows']}（封砖 {stats['windows_bricked']}）, "
          f"弹孔 {dstats['bullet_holes']} + 炮弹孔 {dstats['shell_holes']}, "
          f"碎石 {n_rub}")

    # ---- 导出 GLB（先导出，渲染失败也不丢资产）----
    t = time.time()
    gbz = export_glb([asset], out_glb, cfg, stats)
    exp_time = time.time() - t
    info = inspect_glb(out_glb)
    print(f"[glb] {out_glb.relative_to(root)}  {gbz / 1024:.1f} KB  "
          f"(mesh {info['meshes']} / prim {info['primitives']} / "
          f"mat {info['materials']} / tex {len(info['images'])} imgs "
          f"{info['image_bytes'] / 1024:.0f} KB)  {exp_time:.1f}s")
    print(f"      glTF 内复核三角面 = {info['mesh_triangles']}（Blender 内计 {tris}）")
    for im in info["images"]:
        print(f"      - {im['mimeType']} {im['bytes'] / 1024:.0f} KB  {im['name']}")
    for mt in info["material_detail"]:
        flag = ("tex" if mt["baseColorTexture"] else "flat")
        flag += "+nrm" if mt["normalTexture"] else ""
        print(f"      * {mt['name']:<16} {flag:<8} rough={mt['roughness']} "
              f"metal={mt['metallic']} 2side={mt['doubleSided']}")

    result = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "seed": cfg["seed"],
        "damage": cfg["damage"],
        "facade": {"width_m": cfg["width"], "height_m": cfg["height"],
                   "depth_m": cfg["depth"], "floors": cfg["floors"], "bays": cfg["bays"]},
        "triangles": tris,
        "triangles_gltf_check": info["mesh_triangles"],
        "triangles_with_ground": all_tris,
        "triangles_breakdown": dict(breakdown),
        "objects": len(objs),
        "windows": stats["windows"],
        "windows_bricked": stats["windows_bricked"],
        "shell_holes": dstats["shell_holes"],
        "bullet_holes": dstats["bullet_holes"],
        "rubble_chunks": n_rub,
        "glb": str(out_glb.relative_to(root)).replace("\\", "/"),
        "glb_bytes": gbz,
        "glb_images": info["images"],
        "glb_primitives": info["primitives"],
        "glb_materials": info["materials"],
        "glb_material_detail": info["material_detail"],
        "timings_s": {"textures": round(tex_time, 1), "geometry": round(geo_time, 1),
                      "export": round(exp_time, 1)},
        "renders": [],
    }

    # ---- 预览 ----
    if cfg["render"]:
        setup_render(cfg)
        setup_lighting(cfg)
        sc = bpy.context.scene
        print(f"[render] engine={sc.render.engine} device={getattr(sc.cycles, 'device', '?')} "
              f"view={sc.view_settings.view_transform}/{sc.view_settings.look} "
              f"exposure={sc.view_settings.exposure:+.2f} spp={sc.cycles.samples}")
        shots_def = [
            ("01-west-wall-night.png",
             (-21.0, -79.0, 12.0), (0.0, 0.0, 13.2), 38.0),
            # 站姿人眼高度仰视：墙挡天，条石与破口沿透视斜退（bible §3「视线高度」）
            ("02-damage-detail.png",
             (-30.5, -8.5, 1.72), (-11.0, 0.0, 13.5), 24.0),
        ]
        for fname, loc, look, lens in shots_def:
            cam = add_camera(f"cam_{fname[:2]}", loc, look, lens)
            dt = render_shot(bpy.context.scene, cam, shots / fname)
            print(f"[render] {fname}  {dt:.1f}s  {cfg['res_x']}x{cfg['res_y']} "
                  f"@{cfg['samples']} spp (Cycles CPU)")
            result["renders"].append({
                "file": f"docs/report/blender-shots/{fname}",
                "seconds": round(dt, 1), "samples": cfg["samples"],
                "resolution": [cfg["res_x"], cfg["res_y"]],
                "camera": {"loc": list(loc), "look": list(look), "lens_mm": lens},
                "engine": "CYCLES", "device": "CPU",
            })
        result["timings_s"]["render_total"] = round(
            sum(r["seconds"] for r in result["renders"]), 1)

    # ---- 统计落盘 ----
    stats_path = shots / "warehouse-ext-stats.json"
    result["timings_s"]["total"] = round(time.time() - t0, 1)
    stats_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[out] {stats_path.relative_to(root)}")

    if cfg["save_blend"]:
        bp = root / "tools" / "blender" / "warehouse-ext.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(bp))
        print(f"[blend] {bp.relative_to(root)} {bp.stat().st_size / 1024:.0f} KB")

    print(f"[done] {time.time() - t0:.1f}s  tris={tris}  glb={gbz / 1024:.1f} KB")
    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
