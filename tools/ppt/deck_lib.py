#!/usr/bin/env python
"""PPT 版面引擎：四层（L1 渲染 / L2 文字 / L3 意象 / L4 特殊意象）与程序化素材。"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DELIV = os.path.join(ROOT, "docs", "deliverables")
ASSETS = os.path.join(DELIV, "ppt-assets")
L1_DIR = os.path.join(ASSETS, "L1")
GEN_DIR = os.path.join(ASSETS, "gen")
PREVIEW = os.path.join(ASSETS, "preview")
P1_DIR = os.path.join(ASSETS, "p1")
OBJ_DIR = os.path.join(ASSETS, "objects")
BG_DIR = os.path.join(ROOT, "public", "bg")
ART_DIR = os.path.join(ROOT, "public", "art")

INK = (22, 19, 15)
PAPER = (237, 230, 216)
RED = (163, 43, 43)
RED_BRIGHT = (224, 92, 68)
GOLD = (200, 160, 99)
MUTED = (168, 156, 136)

SW, SH = 1920, 1080
PAGE_W, PAGE_H = 13.333, 7.5

URL = "https://moon6jb6.github.io/szmt2026/"
FONT_TITLE = "宋体"
FONT_BODY = "微软雅黑"

for d in (L1_DIR, GEN_DIR, PREVIEW):
    os.makedirs(d, exist_ok=True)


def path(*parts):
    return os.path.join(*parts)


# ------------------------------------------------------------------ L1 渲染层
def _load_rgb(src):
    return Image.open(src).convert("RGB")


def _fit(img, w=SW, h=SH):
    """cover 裁切到 16:9。"""
    scale = max(w / img.width, h / img.height)
    nw, nh = int(img.width * scale + 0.5), int(img.height * scale + 0.5)
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


def _grade(img, mood="ink", dark=1.0, red_glow=None, vignette=1.0):
    img = img.convert("RGB")
    if mood == "ink":
        img = ImageEnhance.Color(img).enhance(0.5)
        img = ImageEnhance.Brightness(img).enhance(0.78)
        blend = Image.new("RGB", img.size, (24, 18, 13))
        img = Image.blend(img, blend, 0.2)
    elif mood == "warm":
        img = ImageEnhance.Color(img).enhance(0.8)
        img = ImageEnhance.Brightness(img).enhance(0.9)
        blend = Image.new("RGB", img.size, (46, 28, 16))
        img = Image.blend(img, blend, 0.18)
    elif mood == "paper":
        img = ImageEnhance.Color(img).enhance(0.3)
        img = ImageEnhance.Brightness(img).enhance(1.02)
        blend = Image.new("RGB", img.size, (232, 222, 203))
        img = Image.blend(img, blend, 0.35)
    elif mood == "night":
        img = ImageEnhance.Color(img).enhance(0.35)
        img = ImageEnhance.Brightness(img).enhance(0.62)
        blend = Image.new("RGB", img.size, (16, 14, 13))
        img = Image.blend(img, blend, 0.25)

    arr = np.asarray(img).astype(np.float32)
    arr *= dark
    if red_glow:
        cx, cy, strength, sigma = red_glow
        yy, xx = np.mgrid[0:SH, 0:SW]
        glow = np.exp(-(((xx - cx) / (SW * sigma)) ** 2 + ((yy - cy) / (SH * sigma)) ** 2))
        arr[..., 0] += glow * strength
        arr[..., 1] += glow * strength * 0.24
        arr[..., 2] += glow * strength * 0.14
    if vignette:
        yy, xx = np.mgrid[0:SH, 0:SW]
        r = np.sqrt(((xx - SW / 2) / (SW * 0.62)) ** 2 + ((yy - SH * 0.52) / (SH * 0.62)) ** 2)
        arr *= np.clip(1.1 - 0.6 * np.clip(r - 0.3, 0, None) ** 1.4 * vignette, 0.3, 1)[..., None]
    rng = np.random.default_rng(460737)
    arr += rng.normal(0, 2.6, arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def l1_from_bg(name, mood="ink", dark=1.0, red_glow=None, out=None):
    src = os.path.join(BG_DIR, name + ".jpg")
    img = _fit(_load_rgb(src))
    img = _grade(img, mood=mood, dark=dark, red_glow=red_glow)
    out = out or os.path.join(L1_DIR, f"L1-{name}-{mood}.jpg")
    img.save(out, quality=88)
    return out


def l1_from_file(src, out_name, mood="ink", dark=1.0, red_glow=None):
    img = _fit(_load_rgb(src))
    img = _grade(img, mood=mood, dark=dark, red_glow=red_glow)
    out = os.path.join(L1_DIR, out_name + ".jpg")
    img.save(out, quality=88)
    return out


def montage_l1(names, out_name, moods=("night", "ink", "warm")):
    """三联叠影：三个场景横排渐变拼接，做时间纵深。"""
    imgs = [_fit(_load_rgb(os.path.join(BG_DIR, n + ".jpg"))) for n in names]
    base = Image.new("RGB", (SW, SH))
    third = SW // len(imgs)
    grad = Image.linear_gradient("L").resize((third, SH))
    for i, im in enumerate(imgs):
        im = _grade(im, mood=moods[i % len(moods)], dark=0.6)
        tile = im.crop((0, 0, third, SH)) if i < len(imgs) - 1 else im.crop((SW - third, 0, SW, SH))
        mask = grad if i == 0 else grad.transpose(Image.FLIP_LEFT_RIGHT)
        base.paste(tile, (i * third, 0))
    # 横向暗角让拼接柔和
    arr = np.asarray(base).astype(np.float32)
    x = np.linspace(0, 1, SW)[None, :, None]
    arr *= (0.55 + 0.45 * np.sin(np.pi * np.clip(x, 0, 1)) ** 0.5)
    base = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    base = _grade(base, mood="ink", dark=0.82)
    out = os.path.join(L1_DIR, out_name + ".jpg")
    base.save(out, quality=88)
    return out


# ------------------------------------------------------------------ 程序化纹理
def paper_texture(seed=1947):
    rng = np.random.default_rng(seed)
    base = np.full((SH, SW, 3), (238, 231, 217), dtype=np.float32)
    fiber = rng.normal(0, 3.2, (SH, SW, 1))
    base += fiber
    # 大块不均匀
    for _ in range(40):
        cx, cy = rng.integers(0, SW), rng.integers(0, SH)
        r = rng.integers(120, 420)
        yy, xx = np.mgrid[0:SH, 0:SW]
        blob = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (r * r)))
        base -= blob[..., None] * rng.uniform(1.2, 4.0)
    # 暗角 + 边缘压暗
    yy, xx = np.mgrid[0:SH, 0:SW]
    rr = np.sqrt(((xx - SW / 2) / SW) ** 2 + ((yy - SH / 2) / SH) ** 2)
    base *= np.clip(1.04 - 0.35 * rr, 0.7, 1)[..., None]
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    out = os.path.join(L1_DIR, "L1-paper.jpg")
    img.save(out, quality=90)
    return out


def terminal_texture(seed=1937, title="build"):
    rng = np.random.default_rng(seed)
    arr = np.zeros((SH, SW, 3), dtype=np.float32)
    arr[..., :] = (13, 12, 11)
    img = Image.fromarray(arr.astype(np.uint8))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 15)
    tokens = ["content", "engine", "advance", "choice", "ledger", "cap", "sources", "scene", "{ }", "=>", "0 error", "9/9", "11/11"]
    for i in range(46):
        x = rng.integers(40, SW - 240)
        y = 40 + i * 22
        txt = " ".join(str(rng.choice(tokens)) for _ in range(rng.integers(2, 5)))
        d.text((x, y), txt, font=font, fill=(46, 44, 40))
    # 几行亮一点的
    for i in range(8):
        x = rng.integers(40, SW - 400)
        y = rng.integers(60, SH - 80)
        d.text((x, y), "> " + " ".join(str(rng.choice(tokens)) for _ in range(3)), font=font, fill=(112, 102, 88))
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img = _grade(img, mood="ink", dark=1.0)
    out = os.path.join(L1_DIR, f"L1-{title}.jpg")
    img.save(out, quality=88)
    return out


def grid_texture():
    img = Image.new("RGB", (SW, SH), (14, 12, 10))
    d = ImageDraw.Draw(img)
    for x in range(0, SW, 48):
        d.line([(x, 0), (x, SH)], fill=(28, 25, 21), width=1)
    for y in range(0, SH, 48):
        d.line([(0, y), (SW, y)], fill=(28, 25, 21), width=1)
    for _ in range(16):
        x, y = np.random.default_rng(7).integers(0, SW), np.random.default_rng(11).integers(0, SH)
    img = _grade(img, mood="ink", dark=1.0, vignette=0.6)
    out = os.path.join(L1_DIR, "L1-grid.jpg")
    img.save(out, quality=88)
    return out


def ink_wash_l1():
    """墨迹飞白背景。"""
    rng = np.random.default_rng(460737)
    base = np.full((SH, SW, 3), (18, 15, 13), dtype=np.float32)
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(90):
        cx, cy = rng.integers(-100, SW + 100), rng.integers(-100, SH + 100)
        r = rng.integers(30, 220)
        alpha = int(rng.integers(12, 55))
        pts = []
        n = rng.integers(9, 16)
        for k in range(n):
            a = 2 * math.pi * k / n
            rad = r * rng.uniform(0.5, 1.35)
            pts.append((cx + math.cos(a) * rad, cy + math.sin(a) * rad))
        d.polygon(pts, fill=(10, 9, 8, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(18))
    img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
    img.alpha_composite(layer)
    img = img.convert("RGB")
    img = _grade(img, mood="ink", dark=1.0, red_glow=(SW * 0.78, SH * 0.42, 34, 0.3))
    out = os.path.join(L1_DIR, "L1-ink.jpg")
    img.save(out, quality=88)
    return out


def waveform_l1():
    img = Image.new("RGB", (SW, SH), (17, 14, 12))
    d = ImageDraw.Draw(img)
    cy = SH // 2
    rng = np.random.default_rng(28)
    for layer, (color, amp, step, alpha) in enumerate(
        [((90, 34, 30), 120, 3, 255), ((150, 60, 45), 70, 5, 200), ((200, 155, 100), 36, 8, 150)]
    ):
        pts = []
        for x in range(0, SW, step):
            env = 0.35 + 0.65 * abs(math.sin(x / 180.0 + layer))
            y = cy + math.sin(x / (17 + layer * 9)) * amp * env * rng.uniform(0.85, 1.15)
            pts.append((x, y))
        d.line(pts, fill=color, width=1 + layer)
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    img = _grade(img, mood="ink", dark=0.9, vignette=0.8)
    out = os.path.join(L1_DIR, "L1-wave.jpg")
    img.save(out, quality=88)
    return out


# ------------------------------------------------------------------ L3/L4 程序化 PNG
def _alpha_composite_png(img, out):
    img.save(out)
    return out


def ink_splatter(out_name="L4-ink.png", color=(10, 9, 8), seed=460738, n=70, blur=2.0, max_alpha=180):
    rng = np.random.default_rng(seed)
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        cx, cy = rng.integers(0, SW), rng.integers(0, SH)
        r = rng.integers(4, 60)
        a = int(rng.integers(20, max_alpha))
        pts = []
        m = rng.integers(8, 14)
        for k in range(m):
            ang = 2 * math.pi * k / m
            rad = r * rng.uniform(0.4, 1.5)
            pts.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad))
        d.polygon(pts, fill=(*color, a))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return _alpha_composite_png(layer, os.path.join(GEN_DIR, out_name))


def wireframe(out_name="L3-wireframe.png", color=(200, 160, 99, 210)):
    W, H = 1400, 900
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 透视：立面 8 间 × 5 层，带一点斜投影
    x0, y0 = 120, 220
    w, h = 1050, 500
    dx, dy = 170, -90
    for i in range(9):
        x = x0 + w * i / 8
        d.line([(x, y0), (x, y0 + h)], fill=color, width=2)
        d.line([(x + dx, y0 + dy), (x + dx, y0 + h + dy)], fill=color[:3] + (90,), width=1)
    for j in range(6):
        y = y0 + h * j / 5
        d.line([(x0, y), (x0 + w, y)], fill=color, width=2)
        d.line([(x0 + dx, y + dy), (x0 + w + dx, y + dy)], fill=color[:3] + (90,), width=1)
    # 窗格
    for i in range(8):
        for j in range(5):
            wx = x0 + w * (i + 0.28) / 8
            wy = y0 + h * (j + 0.3) / 5
            ww, wh = w / 8 * 0.44, h / 5 * 0.42
            d.rectangle([wx, wy, wx + ww, wy + wh], outline=color[:3] + (150,), width=1)
    # 破洞标记
    d.ellipse([x0 + w * 0.60, y0 + h * 0.18, x0 + w * 0.60 + 60, y0 + h * 0.18 + 42], outline=(190, 70, 55, 230), width=3)
    d.line([(x0 + w * 0.60 - 40, y0 + h * 0.18 + 44), (x0 + w * 0.60 + 100, y0 + h * 0.18 - 10)], fill=(190, 70, 55, 150), width=1)
    return _alpha_composite_png(img, os.path.join(GEN_DIR, out_name))


def seal(text, out_name, size=560, color=(163, 43, 43, 240), font_size=None, vertical=False, rotate=-6):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([26, 26, size - 26, size - 26], radius=22, outline=color, width=14)
    d.rounded_rectangle([48, 48, size - 48, size - 48], radius=14, outline=color[:3] + (140,), width=4)
    fs = font_size or int(size * 0.32)
    font = ImageFont.truetype(r"C:\Windows\Fonts\simsun.ttc", fs)
    if vertical:
        chars = list(text)
        total = len(chars) * fs * 1.02
        y = (size - total) / 2
        for ch in chars:
            bb = d.textbbox((0, 0), ch, font=font)
            d.text(((size - (bb[2] - bb[0])) / 2 - bb[0], y - bb[1]), ch, font=font, fill=(237, 230, 216, 245))
            y += fs * 1.02
    else:
        bb = d.textbbox((0, 0), text, font=font)
        d.text(((size - (bb[2] - bb[0])) / 2 - bb[0], (size - (bb[3] - bb[1])) / 2 - bb[1] - 4), text, font=font, fill=(237, 230, 216, 245))
    arr = np.asarray(img).astype(np.int16)
    rng = np.random.default_rng(len(text) * 977 + 13)
    arr[..., :3] = np.clip(arr[..., :3] + rng.normal(0, 8, (size, size, 1)), 0, 255)
    alpha = arr[..., 3].astype(np.float32) * np.where(rng.random((size, size)) > 0.32, 1.0, 0.86)
    arr[..., 3] = np.clip(alpha, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8), "RGBA").rotate(rotate, resample=Image.BICUBIC)
    return _alpha_composite_png(img, os.path.join(GEN_DIR, out_name))


def red_rule_png(out_name="L4-red-rule.png", w=1600, h=8):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(h):
        a = int(255 * (1 - abs(i - h / 2) / (h / 2)))
        d.line([(0, i), (w, i)], fill=(*RED, a))
    return _alpha_composite_png(img, os.path.join(GEN_DIR, out_name))


def corner_lines(out_name="L4-corner.png", color=(*GOLD, 165)):
    img = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for ox, oy, sx, sy in [(74, 74, 1, 1), (SW - 74, 74, -1, 1), (74, SH - 74, 1, -1), (SW - 74, SH - 74, -1, -1)]:
        d.line([(ox, oy), (ox + sx * 230, oy)], fill=color, width=2)
        d.line([(ox, oy), (ox, oy + sy * 230)], fill=color, width=2)
    return _alpha_composite_png(img, os.path.join(GEN_DIR, out_name))


def top_scrim(out_name="L4-top-scrim.png", fade=0.52, peak=205):
    y = np.linspace(0, 1, SH)[:, None, None]
    a = peak * np.clip(1 - y / fade, 0, 1) ** 0.9
    arr = np.zeros((SH, SW, 4), dtype=np.uint8)
    arr[..., 0:3] = (10, 8, 6)
    arr[..., 3] = np.clip(a[..., 0], 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGBA")
    img.save(os.path.join(GEN_DIR, out_name))
    return os.path.join(GEN_DIR, out_name)


# ------------------------------------------------------------------ 版式/图层引擎
def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Slide:
    def __init__(self, prs):
        self.prs = prs
        self.slide = prs.slides.add_slide(prs.slide_layouts[6])
        self.layers = {"L1": [], "L2": [], "L3": [], "L4": []}

    # ---- 基础元素
    def pic(self, src, x, y, w, h, layer="L3", name=None, rotation=0, crop=None):
        p = self.slide.shapes.add_picture(src, Inches(x), Inches(y), Inches(w), Inches(h))
        if rotation:
            p.rotation = rotation
        if name:
            p.name = name
        self.layers[layer].append(p)
        return p

    def rect(self, x, y, w, h, fill=None, line=None, line_w=1.0, layer="L2", name=None, dash=None, shape=MSO_SHAPE.RECTANGLE, transparency=None, rotation=0):
        shp = self.slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
        if fill:
            shp.fill.solid()
            shp.fill.fore_color.rgb = RGBColor(*fill)
        else:
            shp.fill.background()
        if line:
            shp.line.color.rgb = RGBColor(*line)
            shp.line.width = Pt(line_w)
            if dash is not None:
                shp.line.dash_style = dash
        else:
            shp.line.fill.background()
        shp.shadow.inherit = False
        if rotation:
            shp.rotation = rotation
        if name:
            shp.name = name
        self.layers[layer].append(shp)
        return shp

    def text(
        self,
        x,
        y,
        w,
        h,
        text,
        size,
        color,
        font=FONT_BODY,
        bold=False,
        spacing=None,
        align=PP_ALIGN.LEFT,
        layer="L2",
        name=None,
        line_spacing=None,
        anchor=None,
    ):
        box = self.slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        if anchor is not None:
            tf.vertical_anchor = anchor
        lines = text.split("\n")
        for i, ln in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            if line_spacing:
                p.line_spacing = line_spacing
            run = p.add_run()
            run.text = ln
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.name = font
            run.font.color.rgb = RGBColor(*color)
            if spacing is not None:
                run._r.get_or_add_rPr().set("spc", str(int(spacing * 100)))
        if name:
            box.name = name
        self.layers[layer].append(box)
        return box

    def rich(self, x, y, w, h, segments, size, font=FONT_TITLE, spacing=1.0, layer="L2", name=None, align=PP_ALIGN.LEFT):
        """segments: [(text, color), ...] 同一段内多色。"""
        box = self.slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.alignment = align
        for seg, col in segments:
            r = p.add_run()
            r.text = seg
            r.font.size = Pt(size)
            r.font.name = font
            r.font.color.rgb = RGBColor(*col)
            r._r.get_or_add_rPr().set("spc", str(int(spacing * 100)))
        if name:
            box.name = name
        self.layers[layer].append(box)
        return box

    # ---- 常用版式元件
    def footer(self, page, total=19, dark=True):
        col = MUTED if dark else (110, 98, 80)
        self.text(0.85, 7.10, 6.0, 0.26, "把名字留下来 · 四行仓库　｜　作品 460737", 8.5, col, FONT_BODY, layer="L2", name="L2-页脚")
        self.text(11.9, 7.10, 0.6, 0.26, f"{page:02d} / {total:02d}", 8.5, col, FONT_BODY, align=PP_ALIGN.RIGHT, layer="L2", name="L2-页码")

    def kicker(self, text, x=0.85, y=0.52, color=None):
        self.text(x, y, 9.0, 0.3, text, 11.5, color or RED_BRIGHT, FONT_BODY, spacing=3.2, layer="L2", name="L2-眉标")

    def headline(self, text, x=0.85, y=0.92, size=44, w=11.6, color=None, spacing=2.0):
        self.text(x, y, w, size / 62.0, text, size, color or PAPER, FONT_TITLE, bold=True, spacing=spacing, layer="L2", name="L2-主标题")

    def red_rule(self, x=0.87, y=1.78, w=2.6):
        self.rect(x, y, w, 0.028, fill=RED, layer="L2", name="L2-红色标题线")

    def big_number(self, x, y, number, label, num_size=54, color=None, w=2.4, label_color=None):
        self.text(x, y, w, num_size / 48.0, number, num_size, color or PAPER, FONT_TITLE, bold=True, spacing=1.0, layer="L2", name="L2-大数字")
        self.text(x, y + num_size / 72.0 + 0.08, w, 0.34, label, 10.5, label_color or MUTED, FONT_BODY, spacing=2.0, layer="L2", name="L2-数字说明")

    def gold_hairline(self, x, y, w, alpha=170):
        self.rect(x, y, w, 0.012, fill=(GOLD[0], GOLD[1], GOLD[2]), layer="L4", name="L4-金线")

    def scrim(self, src_p1_scrim, strength=1.0):
        self.pic(src_p1_scrim, 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-压暗")

    def screenshot_placeholder(self, x, y, w, h, label, sub="1920 × 1080", layer="L3"):
        frame = self.rect(x, y, w, h, fill=None, line=GOLD, line_w=1.2, layer=layer, name="L3-截图占位框", dash=4)
        cx = x + w / 2
        self.text(cx - 1.6, y + h / 2 - 0.42, 3.2, 0.3, "此处放真实运行截图", 11, GOLD, FONT_BODY, align=PP_ALIGN.CENTER, layer=layer, name="L3-占位提示")
        self.text(cx - 1.6, y + h / 2 - 0.08, 3.2, 0.3, label, 13, RED_BRIGHT, FONT_BODY, align=PP_ALIGN.CENTER, layer=layer, name="L3-占位文件名")
        self.text(cx - 1.6, y + h / 2 + 0.24, 3.2, 0.26, sub, 10, MUTED, FONT_BODY, align=PP_ALIGN.CENTER, layer=layer, name="L3-占位尺寸")
        return frame

    # ---- 收尾：按 L1→L2→L3→L4 建组
    def finish(self):
        for key in ("L1", "L2", "L3", "L4"):
            shapes = self.layers[key]
            if shapes:
                g = self.slide.shapes.add_group_shape(shapes)
                g.name = {"L1": "L1 渲染层", "L2": "L2 文字层", "L3": "L3 意象层", "L4": "L4 特殊意象层"}[key]

def left_scrim(out_name="L4-left-scrim.png", fade=0.62, peak=215):
    """左侧压暗渐变（正文列在亮背景上也能读）。"""
    x = np.linspace(0, 1, SW)[None, :, None]
    a = peak * np.clip(1 - x / fade, 0, 1) ** 0.85
    arr = np.zeros((SH, SW, 4), dtype=np.uint8)
    arr[..., 0:3] = (10, 8, 6)
    arr[..., 3] = np.clip(a[..., 0], 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGBA")
    img.save(os.path.join(GEN_DIR, out_name))
    return os.path.join(GEN_DIR, out_name)