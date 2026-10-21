#!/usr/bin/env python
"""构建 PPT 封面 P1（四层：L1 渲染 / L2 文字 / L3 意象 / L4 特殊意象）+ 截图占位模板页。

产物：
  docs/deliverables/汇报PPT_模板_v1.pptx
  docs/deliverables/ppt-assets/p1/*.png|jpg   （每层素材）
  docs/deliverables/ppt-assets/preview/p1.png  （1920x1080 预览）
"""
import json
import math
import os
import shutil

import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = r"D:\AI大模型\ppt-work\p1"
ASSETS = os.path.join(ROOT, "docs", "deliverables", "ppt-assets", "p1")
PREVIEW = os.path.join(ROOT, "docs", "deliverables", "ppt-assets", "preview")
OUT_PPTX = os.path.join(ROOT, "docs", "deliverables", "汇报PPT_模板_v1.pptx")
URL = "https://moon6jb6.github.io/szmt2026/"

INK = (22, 19, 15)
PAPER = (237, 230, 216)
RED = (163, 43, 43)
GOLD = (200, 160, 99)
MUTED = (154, 143, 124)

SW, SH = 1920, 1080


def ensure_dirs():
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)


# ---------------------------------------------------------------- L1
def make_l1():
    img = Image.open(os.path.join(WORK, "p1-bg.png")).convert("RGB")
    img = img.resize((SW, SH), Image.LANCZOS)
    # 冷灰 → 暖墨：降饱和 + 压暗 + 暖色混合
    img = ImageEnhance.Color(img).enhance(0.45)
    img = ImageEnhance.Brightness(img).enhance(0.72)
    img = ImageEnhance.Contrast(img).enhance(1.12)
    warm = Image.new("RGB", img.size, (26, 20, 14))
    img = Image.blend(img, warm, 0.22)

    arr = np.asarray(img).astype(np.float32)
    # 左侧压暗给标题，右侧轻微压暗给二维码
    x = np.linspace(0, 1, SW)[None, :, None]
    left = 0.28 + 0.72 * np.clip(x / 0.62, 0, 1) ** 0.8
    arr *= left
    # 顶部/底部渐暗
    y = np.linspace(0, 1, SH)[:, None, None]
    arr *= (0.55 + 0.45 * np.clip(y / 0.18, 0, 1)) * (0.6 + 0.4 * np.clip((1 - y) / 0.2, 0, 1))
    # 暗角
    yy, xx = np.mgrid[0:SH, 0:SW]
    cx, cy = SW / 2, SH * 0.52
    r = np.sqrt(((xx - cx) / (SW * 0.62)) ** 2 + ((yy - cy) / (SH * 0.62)) ** 2)
    arr *= np.clip(1.08 - 0.55 * np.clip(r - 0.35, 0, None) ** 1.4, 0.35, 1)[..., None]
    # 细颗粒
    rng = np.random.default_rng(460737)
    arr += rng.normal(0, 3.2, arr.shape)
    # 右侧偏下加一层极淡的暖红光（像远处火光映在建筑上）
    yy, xx = np.mgrid[0:SH, 0:SW]
    glow = np.exp(-(((xx - SW * 0.86) / (SW * 0.20)) ** 2 + ((yy - SH * 0.62) / (SH * 0.26)) ** 2))
    arr[..., 0] += glow * 62
    arr[..., 1] += glow * 16
    arr[..., 2] += glow * 10
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=55, threshold=3))
    path = os.path.join(WORK, "p1-L1.jpg")
    img.save(path, quality=90)
    return img, path


# ---------------------------------------------------------------- L3
def make_l3():
    img = Image.open(os.path.join(WORK, "p1-roster.png")).convert("RGB")
    img = ImageEnhance.Color(img).enhance(0.82)
    img = ImageEnhance.Brightness(img).enhance(0.92)
    img = ImageEnhance.Contrast(img).enhance(1.05)
    warm = Image.new("RGB", img.size, (30, 22, 15))
    img = Image.blend(img, warm, 0.16)
    img = ImageEnhance.Brightness(img).enhance(0.62)
    # 圆角羽化 alpha
    mask = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([6, 6, img.width - 6, img.height - 6], radius=54, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(14))
    img.putalpha(mask)
    path = os.path.join(ASSETS, "L3-roster.png")
    img.save(path)
    return img, path


# ---------------------------------------------------------------- L4
def bezier(p0, p1, p2, p3, n=120):
    pts = []
    for i in range(n):
        t = i / (n - 1)
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def ribbon_layer(width, height, path_pts, thickness, color, path, alpha=235, seed=1):
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 计算法线，构造带宽
    left, right = [], []
    for i, (x, y) in enumerate(path_pts):
        x2, y2 = path_pts[min(i + 1, len(path_pts) - 1)]
        x1, y1 = path_pts[max(i - 1, 0)]
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        w = thickness * (0.65 + 0.35 * math.sin(i / len(path_pts) * math.pi))
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    poly = left + right[::-1]
    d.polygon(poly, fill=(*color, alpha))
    # 折光：沿中心线画一条亮边
    d.line(path_pts, fill=(*RED, 0), width=1)
    d.line([(x, y) for x, y in path_pts], fill=(220, 120, 90, 90), width=max(2, int(thickness * 0.18)))
    # 织物噪点
    rng = np.random.default_rng(seed)
    arr = np.asarray(layer).astype(np.int16)
    noise = rng.normal(0, 7, (height, width, 1))
    arr[..., :3] = np.clip(arr[..., :3] + noise, 0, 255)
    layer = Image.fromarray(arr.astype(np.uint8), "RGBA")
    layer = layer.filter(ImageFilter.GaussianBlur(0.6))
    layer.save(path)
    return layer, path


def make_l4(img_ribbon_path, L1):
    # 朱红绸带：从右上角斜穿到画面中部
    pts = bezier((2140, -120), (1830, 240), (1650, 640), (1500, 1180))
    ribbon_path = os.path.join(ASSETS, "L4-ribbon.png")
    ribbon = ribbon_layer(SW, SH, pts, 23, RED, ribbon_path, 205, seed=460737)
    pts2 = bezier((2010, 260), (1800, 520), (1700, 820), (1620, 1180))
    ribbon2_path = os.path.join(ASSETS, "L4-ribbon-2.png")
    ribbon_layer(SW, SH, pts2, 7, (200, 62, 48), ribbon2_path, 165, seed=460739)

    # 金色细角线
    lines = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(lines)
    for ox, oy, sx, sy in [(78, 78, 1, 1), (SW - 78, 78, -1, 1)]:
        d.line([(ox, oy), (ox + sx * 250, oy)], fill=(*GOLD, 170), width=2)
        d.line([(ox, oy), (ox, oy + sy * 250)], fill=(*GOLD, 170), width=2)
    lines.save(os.path.join(ASSETS, "L4-gold-lines.png"))

    # 尘埃
    dust = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dust)
    rng = np.random.default_rng(1937)
    for _ in range(160):
        x, y = rng.integers(0, SW), rng.integers(0, SH)
        r = rng.uniform(0.4, 1.7)
        a = int(rng.uniform(18, 70))
        dd.ellipse([x - r, y - r, x + r, y + r], fill=(210, 180, 130, a))
    dust.save(os.path.join(ASSETS, "L4-dust.png"))

    # 左下压暗（让名册上的文字可读）
    yy, xx = np.mgrid[0:SH, 0:SW]
    dist = np.sqrt(((xx - 0) / (SW * 0.55)) ** 2 + ((yy - SH) / (SH * 0.55)) ** 2)
    alpha = np.clip(255 * np.exp(-3.2 * dist**1.6), 0, 235)
    scrim = np.zeros((SH, SW, 4), dtype=np.uint8)
    scrim[..., 0:3] = (10, 8, 6)
    scrim[..., 3] = alpha.astype(np.uint8)
    scrim_path = os.path.join(ASSETS, "L4-scrim.png")
    Image.fromarray(scrim, "RGBA").save(scrim_path)

    # 二维码（纸白底、墨色模块）
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=1)
    qr.add_data(URL)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color=(22, 19, 15), back_color=PAPER).convert("RGB")
    qr_img = qr_img.resize((520, 520), Image.NEAREST)
    qr_img.save(os.path.join(ASSETS, "L4-qr.png"))

    return {
        "ribbon": ribbon_path,
        "ribbon2": ribbon2_path,
        "gold": os.path.join(ASSETS, "L4-gold-lines.png"),
        "dust": os.path.join(ASSETS, "L4-dust.png"),
        "qr": os.path.join(ASSETS, "L4-qr.png"),
        "scrim": scrim_path,
    }


# ---------------------------------------------------------------- PPTX
def add_pic(shapes, path, left, top, width, height, name=None, rotation=0):
    pic = shapes.add_picture(path, Inches(left), Inches(top), Inches(width), Inches(height))
    if name:
        pic.name = name
    if rotation:
        pic.rotation = rotation
    return pic


def add_text(shapes, left, top, width, height, text, size, color, font="宋体", bold=False, spacing=None, align=PP_ALIGN.LEFT, name=None):
    box = shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = font
    run.font.color.rgb = RGBColor(*color)
    if spacing is not None:
        rPr = run._r.get_or_add_rPr()
        rPr.set("spc", str(int(spacing * 100)))
    if name:
        box.name = name
    return box


def build_pptx(L1_path, l3_path, l4):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    # ---------- L1 渲染层 ----------
    l1_shapes = []
    bg = slide.shapes.add_picture(L1_path, 0, 0, prs.slide_width, prs.slide_height)
    bg.name = "L1-渲染底图"
    l1_shapes.append(bg)
    g1 = slide.shapes.add_group_shape(l1_shapes)
    g1.name = "L1 渲染层"

    # ---------- L3 意象层（先建，最后统一 group 顺序会按创建顺序叠加） ----------
    l3_shapes = []
    roster = add_pic(slide.shapes, l3_path, left=-1.30, top=6.52, width=2.85, height=2.85, name="L3-名册", rotation=-8)
    l3_shapes.append(roster)
    g3 = slide.shapes.add_group_shape(l3_shapes)
    g3.name = "L3 意象层"

    # ---------- L2 文字层 ----------
    l2_shapes = []
    l2_shapes.append(
        add_text(slide.shapes, 1.02, 1.62, 8.9, 0.42, "1937 · 四行仓库 · 上海", 15, (198, 88, 68), font="宋体", spacing=3, name="L2-眉标")
    )
    l2_shapes.append(
        add_text(slide.shapes, 0.98, 2.02, 9.2, 1.75, "把名字留下来", 92, PAPER, font="宋体", bold=True, spacing=6, name="L2-主标题")
    )
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.05), Inches(3.62), Inches(3.3), Pt(1.8))
    line.fill.solid()
    line.fill.fore_color.rgb = RGBColor(*RED)
    line.line.fill.background()
    line.name = "L2-红色标题线"
    l2_shapes.append(line)
    l2_shapes.append(
        add_text(slide.shapes, 1.05, 3.86, 8.8, 0.55, "四行仓库 · 苏州河北岸的四百余个名字", 25, PAPER, font="宋体", spacing=2, name="L2-副标题")
    )
    l2_shapes.append(
        add_text(
            slide.shapes,
            1.05,
            5.42,
            8.2,
            0.42,
            "四百二十余人守了四天四夜。",
            16,
            (224, 213, 197),
            font="宋体",
            spacing=1,
            name="L2-引语1",
        )
    )
    # 第二行：「八十七个」用朱红强调
    quote2 = slide.shapes.add_textbox(Inches(1.05), Inches(5.78), Inches(8.2), Inches(0.42))
    quote2.name = "L2-引语2"
    tf2 = quote2.text_frame
    tf2.word_wrap = True
    tf2.margin_left = tf2.margin_right = tf2.margin_top = tf2.margin_bottom = 0
    p2 = tf2.paragraphs[0]
    for seg, col in [("他们的名字，后来只找回来", (208, 198, 182)), ("八十七个", (232, 104, 78)), ("。", (208, 198, 182))]:
        r = p2.add_run()
        r.text = seg
        r.font.size = Pt(16)
        r.font.name = "宋体"
        r.font.color.rgb = RGBColor(*col)
        r._r.get_or_add_rPr().set("spc", "100")
    l2_shapes.append(quote2)
    l2_shapes.append(
        add_text(
            slide.shapes,
            1.05,
            6.34,
            8.2,
            0.36,
            "2026 第十四届全国大学生数字媒体科技作品及创意竞赛　·　命题：红色之旅 追梦铸魂",
            11,
            (196, 184, 164),
            font="微软雅黑",
            name="L2-赛事信息",
        )
    )
    l2_shapes.append(
        add_text(
            slide.shapes,
            1.05,
            6.68,
            8.2,
            0.34,
            "作品编号 460737　｜　网页交互叙事 · 2.5D + 真 3D　｜　线上试玩：moon6jb6.github.io/szmt2026",
            10.5,
            (212, 199, 178),
            font="微软雅黑",
            name="L2-作品信息",
        )
    )
    g2 = slide.shapes.add_group_shape(l2_shapes)
    g2.name = "L2 文字层"

    # ---------- L4 特殊意象层 ----------
    l4_shapes = []
    scrim_pic = add_pic(slide.shapes, l4["scrim"], 0, 0, 13.333, 7.5, name="L4-左下压暗")
    l4_shapes.append(scrim_pic)
    ribbon_pic = add_pic(slide.shapes, l4["ribbon"], 0, 0, 13.333, 7.5, name="L4-朱红绸带")
    l4_shapes.append(ribbon_pic)
    ribbon2_pic = add_pic(slide.shapes, l4["ribbon2"], 0, 0, 13.333, 7.5, name="L4-朱红细带")
    l4_shapes.append(ribbon2_pic)
    seal_pic = add_pic(slide.shapes, os.path.join(ASSETS, "L4-seal.png"), 9.52, 2.30, 1.02, 1.02, name="L4-朱红印章")
    l4_shapes.append(seal_pic)
    gold_pic = add_pic(slide.shapes, l4["gold"], 0, 0, 13.333, 7.5, name="L4-金线")
    l4_shapes.append(gold_pic)
    dust_pic = add_pic(slide.shapes, l4["dust"], 0, 0, 13.333, 7.5, name="L4-尘埃")
    l4_shapes.append(dust_pic)

    # 二维码卡
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(11.35), Inches(5.18), Inches(1.45), Inches(1.45))
    card.fill.solid()
    card.fill.fore_color.rgb = RGBColor(*PAPER)
    card.line.color.rgb = RGBColor(*RED)
    card.line.width = Pt(1.1)
    card.name = "L4-二维码卡"
    l4_shapes.append(card)
    qr_pic = add_pic(slide.shapes, l4["qr"], 11.47, 5.30, 1.2, 1.2, name="L4-二维码")
    l4_shapes.append(qr_pic)
    l4_shapes.append(
        add_text(slide.shapes, 11.12, 6.72, 1.9, 0.3, "扫码试玩", 9, (222, 206, 184), font="微软雅黑", align=PP_ALIGN.CENTER, name="L4-二维码说明")
    )
    g4 = slide.shapes.add_group_shape(l4_shapes)
    g4.name = "L4 特殊意象层"

    # ---------- 模板第 2 页：实机截图占位 ----------
    s2 = prs.slides.add_slide(prs.slide_layouts[6])
    bg2 = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg2.fill.solid()
    bg2.fill.fore_color.rgb = RGBColor(*INK)
    bg2.line.fill.background()
    bg2.name = "L1 背景"
    add_text(s2.shapes, 0.85, 0.55, 8.6, 0.5, "实机整屏 · 截图占位页", 26, PAPER, font="宋体", bold=True, name="L2-标题")
    add_text(
        s2.shapes,
        0.87,
        1.06,
        9.6,
        0.34,
        "模板示意：真实运行截图从线上定稿版抓取（1920×1080），替换下方虚线框内图片即可；框位不变。",
        10.5,
        MUTED,
        font="微软雅黑",
        name="L2-说明",
    )
    frame = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.85), Inches(1.50), Inches(9.80), Inches(5.51))
    frame.fill.background()
    frame.line.color.rgb = RGBColor(*GOLD)
    frame.line.width = Pt(1.1)
    frame.line.dash_style = 4  # MSO_LINE.DASH
    frame.name = "L3-截图占位框（10.4×5.85in / 16:9）"
    add_text(s2.shapes, 4.15, 4.05, 3.2, 0.6, "shot-03-choices.png\n1920 × 1080", 14, GOLD, font="微软雅黑", align=PP_ALIGN.CENTER, name="L3-占位说明")
    add_pic(s2.shapes, l4["qr"], 11.55, 5.35, 1.15, 1.15, name="L4-二维码")
    add_text(s2.shapes, 11.3, 6.62, 1.7, 0.3, "扫码试玩", 9, MUTED, font="微软雅黑", align=PP_ALIGN.CENTER, name="L4-说明")
    add_text(s2.shapes, 0.85, 7.14, 12.0, 0.3, "以上为模板骨架：每页 4 个命名图层（L1 渲染 / L2 文字 / L3 意象 / L4 特殊意象），在「开始 → 选择窗格」可逐层开关。", 9.5, MUTED, font="微软雅黑", name="L2-页脚")

    prs.save(OUT_PPTX)
    return OUT_PPTX


# ---------------------------------------------------------------- 导出预览
def export_preview(pptx_path):
    import win32com.client

    app = win32com.client.Dispatch("PowerPoint.Application")
    app.Visible = 1
    pres = app.Presentations.Open(pptx_path, WithWindow=False)
    try:
        for idx, name in [(1, "p1"), (2, "template-placeholder")]:
            out = os.path.join(PREVIEW, name + ".png")
            pres.Slides(idx).Export(out, "PNG", 1920, 1080)
            print("[preview]", out)
    finally:
        pres.Close()
        app.Quit()


def main():
    ensure_dirs()
    L1, L1_path = make_l1()
    _, l3_path = make_l3()
    l4 = make_l4(None, L1)
    # 把每层素材复制到交付目录
    for src, dst in [
        (L1_path, "L1-cover.jpg"),
        (l4["ribbon"], "L4-ribbon.png"),
    ]:
        tgt = os.path.join(ASSETS, dst)
        if os.path.abspath(src) != os.path.abspath(tgt):
            shutil.copyfile(src, tgt)
    pptx_path = build_pptx(L1_path, l3_path, l4)
    print("[pptx]", pptx_path)
    export_preview(pptx_path)
    print("[done]")


if __name__ == "__main__":
    main()
