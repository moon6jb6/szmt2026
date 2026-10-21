#!/usr/bin/env python
"""构建 19 页汇报 PPT（四层结构；截图位置留空框）。"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import deck_lib as L  # noqa: E402
from deck_lib import (  # noqa: E402
    GEN_DIR, L1_DIR, OBJ_DIR, P1_DIR, PREVIEW, RED, RED_BRIGHT, GOLD, PAPER, INK, MUTED,
    FONT_BODY, FONT_TITLE, PAGE_W, PAGE_H, SW, SH,
)

OUT_PPTX = os.path.join(L.DELIV, "汇报PPT_把名字留下来_460737.pptx")
ART = L.ART_DIR


# ================================================================ 素材准备
def ensure_assets():
    A = {}
    A["scrim"] = os.path.join(P1_DIR, "L4-scrim.png")
    A["gold_lines"] = os.path.join(P1_DIR, "L4-gold-lines.png")
    A["dust"] = os.path.join(P1_DIR, "L4-dust.png")
    A["qr"] = os.path.join(P1_DIR, "L4-qr.png")
    A["ribbon"] = os.path.join(P1_DIR, "L4-ribbon.png")
    A["ribbon2"] = os.path.join(P1_DIR, "L4-ribbon-2.png")
    A["seal_liuming"] = os.path.join(P1_DIR, "L4-seal.png")
    A["roster"] = os.path.join(P1_DIR, "L3-roster.png")

    A["paper"] = L.paper_texture()
    A["terminal"] = L.terminal_texture(1937, "terminal")
    A["terminal2"] = L.terminal_texture(460737, "terminal2")
    A["grid"] = L.grid_texture()
    A["ink"] = L.ink_wash_l1()
    A["wave"] = L.waveform_l1()

    A["river"] = L.l1_from_bg("river", mood="night", dark=0.95, red_glow=(SW * 0.82, SH * 0.6, 42, 0.32))
    A["warehouse_warm"] = L.l1_from_bg("warehouse", mood="warm", dark=0.9, red_glow=(SW * 0.36, SH * 0.62, 40, 0.2))
    A["warehouse_night"] = L.l1_from_bg("warehouse", mood="night", dark=1.0, red_glow=(SW * 0.76, SH * 0.5, 40, 0.3))
    A["office"] = L.l1_from_bg("office", mood="warm", dark=0.82, red_glow=(SW * 0.7, SH * 0.45, 34, 0.25))
    A["dawn"] = L.l1_from_bg("dawn", mood="ink", dark=0.82)
    A["wallhole"] = L.l1_from_bg("wallhole", mood="night", dark=0.95, red_glow=(SW * 0.52, SH * 0.45, 52, 0.22))
    A["flagbg"] = L.l1_from_bg("flag", mood="night", dark=0.95, red_glow=(SW * 0.72, SH * 0.4, 40, 0.28))
    A["wounded"] = L.l1_from_bg("wounded", mood="night", dark=0.95)
    A["montage"] = L.montage_l1(["dawn", "river", "flag"], "L1-montage")
    A["blender"] = L.l1_from_file(os.path.join(L.ROOT, "docs", "report", "blender-shots", "01-west-wall-night.png"), "L1-blender", mood="night", dark=0.9, red_glow=(SW * 0.8, SH * 0.55, 36, 0.3))

    A["wireframe"] = L.wireframe()
    A["seal_checked"] = L.seal("已核", "L4-seal-checked.png", font_size=170, rotate=-5)
    A["seal_pass"] = L.seal("通过", "L4-seal-pass.png", font_size=170, rotate=6)
    A["seal_number"] = L.seal("460737", "L4-seal-number.png", font_size=150, rotate=-4)
    A["seal_mute"] = L.seal("静音", "L4-seal-mute.png", font_size=160, rotate=-6)
    A["left_scrim"] = L.left_scrim(fade=0.52, peak=148)
    A["top_scrim"] = L.top_scrim()
    A["red_rule"] = L.red_rule_png()
    A["corner"] = L.corner_lines()
    A["ink_splat"] = L.ink_splatter("L4-ink-splat.png", seed=1937)
    A["red_splat"] = L.ink_splatter("L4-red-splat.png", color=(120, 30, 26), seed=460737, max_alpha=120)

    # 美术拼贴 L1
    art_files = [os.path.join(ART, f"scene-{i:03d}.jpg") for i in (1, 7, 23, 45, 66, 88, 101, 119)]
    art_files = [p for p in art_files if os.path.exists(p)]
    A["art_collage"] = make_collage(art_files)
    A["art_cards"] = [p for p in art_files if os.path.exists(p)][:3]
    return A


def make_collage(files, cols=4, rows=2):
    cell_w, cell_h = SW // cols, SH // rows
    canvas = Image.new("RGB", (SW, SH), (14, 12, 10))
    for i, f in enumerate(files[: cols * rows]):
        im = Image.open(f).convert("RGB")
        scale = max(cell_w / im.width, cell_h / im.height)
        im = im.resize((int(im.width * scale) + 1, int(im.height * scale) + 1), Image.LANCZOS)
        left = (im.width - cell_w) // 2
        top = (im.height - cell_h) // 2
        tile = im.crop((left, top, left + cell_w, top + cell_h))
        canvas.paste(tile, ((i % cols) * cell_w, (i // cols) * cell_h))
    arr = np.asarray(canvas).astype(np.float32) * 0.55
    rng = np.random.default_rng(496)
    arr += rng.normal(0, 2.0, arr.shape)
    canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    arr = np.asarray(canvas).astype(np.float32)
    yy, xx = np.mgrid[0:SH, 0:SW]
    r = np.sqrt(((xx - SW / 2) / (SW * 0.6)) ** 2 + ((yy - SH / 2) / (SH * 0.6)) ** 2)
    arr *= np.clip(1.1 - 0.55 * np.clip(r - 0.28, 0, None) ** 1.3, 0.3, 1)[..., None]
    canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    out = os.path.join(L1_DIR, "L1-art-collage.jpg")
    canvas.save(out, quality=86)
    return out


# ================================================================ 页面
def common(s, A, page, kicker, headline, bg, headline_size=42, footer=True):
    s.pic(bg, 0, 0, PAGE_W, PAGE_H, layer="L1", name="L1-渲染底图")
    s.pic(A["corner"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-金线角")
    s.pic(A["dust"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-尘埃")
    s.kicker(kicker)
    s.headline(headline, size=headline_size)
    s.red_rule()
    if footer:
        s.footer(page)


def page01_cover(prs, A):
    s = L.Slide(prs)
    s.pic(os.path.join(P1_DIR, "L1-cover.jpg"), 0, 0, PAGE_W, PAGE_H, layer="L1", name="L1-渲染底图")
    s.pic(A["roster"], -1.30, 6.52, 2.85, 2.85, layer="L3", name="L3-名册", rotation=-8)
    s.text(1.02, 1.62, 8.9, 0.42, "1937 · 四行仓库 · 上海", 15, RED_BRIGHT, FONT_TITLE, spacing=3, name="L2-眉标")
    s.text(0.98, 2.02, 9.2, 1.75, "把名字留下来", 92, PAPER, FONT_TITLE, bold=True, spacing=6, name="L2-主标题")
    s.rect(1.05, 3.62, 3.3, 0.025, fill=RED, layer="L2", name="L2-红色标题线")
    s.text(1.05, 3.86, 8.8, 0.55, "四行仓库 · 苏州河北岸的四百余个名字", 25, PAPER, FONT_TITLE, spacing=2, name="L2-副标题")
    s.text(1.05, 5.42, 8.2, 0.42, "四百二十余人守了四天四夜。", 16, (224, 213, 197), FONT_TITLE, spacing=1, name="L2-引语1")
    s.rich(1.05, 5.78, 8.2, 0.42, [("他们的名字，后来只找回来", (224, 213, 197)), ("八十七个", RED_BRIGHT), ("。", (224, 213, 197))], 16, spacing=1.0, name="L2-引语2")
    s.text(1.05, 6.34, 8.2, 0.36, "2026 第十四届全国大学生数字媒体科技作品及创意竞赛　·　命题：红色之旅 追梦铸魂", 11, (196, 184, 164), name="L2-赛事信息")
    s.text(1.05, 6.68, 8.2, 0.34, "作品编号 460737　｜　网页交互叙事 · 2.5D + 真 3D　｜　线上试玩：moon6jb6.github.io/szmt2026", 10.5, (212, 199, 178), name="L2-作品信息")
    s.pic(A["scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左下压暗")
    s.pic(A["ribbon"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-朱红绸带")
    s.pic(A["ribbon2"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-朱红细带")
    s.pic(A["seal_liuming"], 9.52, 2.30, 1.02, 1.02, layer="L4", name="L4-朱红印章")
    s.pic(A["gold_lines"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-金线")
    s.pic(A["dust"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-尘埃")
    s.rect(11.35, 5.18, 1.45, 1.45, fill=PAPER, line=RED, line_w=1.1, layer="L4", name="L4-二维码卡")
    s.pic(A["qr"], 11.47, 5.30, 1.2, 1.2, layer="L4", name="L4-二维码")
    s.text(11.12, 6.72, 1.9, 0.3, "扫码试玩", 9, (222, 206, 184), align=PP_ALIGN.CENTER, layer="L4", name="L4-二维码说明")
    s.finish()


def page02_info(prs, A):
    s = L.Slide(prs)
    s.pic(A["paper"], 0, 0, PAGE_W, PAGE_H, layer="L1", name="L1-档案纸")
    s.rect(0.85, 0.85, 10.4, 0.012, fill=(120, 105, 82), layer="L4", name="L4-细线")
    s.kicker("作品信息", color=RED)
    s.headline("一个现在就能打开的作品", size=40, color=INK, spacing=2.5)
    s.rect(0.87, 1.94, 2.6, 0.028, fill=RED, layer="L2", name="L2-红色标题线")
    rows = [
        ("作品名称", "把名字留下来：四行仓库·苏州河北岸的四百余个名字"),
        ("作品编号", "460737"),
        ("参赛命题", "红色之旅 · 追梦铸魂"),
        ("作品形式", "网页交互叙事　2.5D + 真 3D　本地 AI 生产管线"),
    ]
    y = 2.35
    for label, value in rows:
        s.text(0.9, y, 1.5, 0.3, label, 11, (120, 105, 82), spacing=2.2, name="L2-信息标签")
        s.text(2.5, y - 0.03, 7.6, 0.42, value, 15, INK, FONT_TITLE, spacing=0.6, name="L2-信息值")
        s.rect(0.9, y + 0.52, 8.9, 0.008, fill=(190, 176, 154), layer="L4", name="L4-分隔线")
        y += 0.78
    s.text(0.9, 5.72, 7.9, 1.0, "在线试玩　https://moon6jb6.github.io/szmt2026/\n仓库源码　https://github.com/moon6jb6/szmt2026", 11.5, (96, 82, 64), spacing=0.4, name="L2-链接")
    s.pic(A["seal_liuming"], 10.55, 1.45, 1.15, 1.15, layer="L3", name="L3-留名印章")
    s.text(10.52, 2.75, 2.0, 0.3, "扫 码 即 玩", 9.5, (120, 105, 82), spacing=4, align=PP_ALIGN.CENTER, name="L2-扫码提示")
    s.rect(10.62, 3.12, 1.65, 1.65, fill=PAPER, line=RED, line_w=1.0, layer="L4", name="L4-二维码卡")
    s.pic(A["qr"], 10.74, 3.24, 1.42, 1.42, layer="L4", name="L4-二维码")
    s.text(10.5, 4.9, 2.0, 0.3, "moon6jb6.github.io/szmt2026", 8.5, (120, 105, 82), align=PP_ALIGN.CENTER, name="L2-网址")
    s.footer(2, dark=False)
    s.finish()


def page03_history(prs, A):
    s = L.Slide(prs)
    common(s, A, 3, "史实底座", "四百二十余人，八十七个名字", A["river"], 44)
    s.big_number(0.9, 2.35, "420+", "实际守军（约）", num_size=50)
    s.big_number(3.5, 2.35, "87", "后来查实姓名", num_size=50)
    s.big_number(6.1, 2.35, "76", "可点开的史料卡", num_size=50)
    s.text(0.9, 3.9, 7.4, 1.2, "每一条史实都能点开，看到原句、作者与出处。\n真实人物零自编台词；未核史实不进正文。", 15, (214, 202, 184), spacing=1.2, name="L2-说明")
    s.pic(A["roster"], 7.75, 3.15, 4.6, 4.6, layer="L3", name="L3-名册", rotation=-5)
    photo = os.path.join(OBJ_DIR, "obj-photo.png")
    if os.path.exists(photo):
        s.pic(photo, 6.35, 2.9, 2.5, 2.5, layer="L3", name="L3-黑白合影", rotation=4)
    s.pic(A["seal_checked"], 9.55, 2.25, 1.15, 1.15, layer="L4", name="L4-已核印章")
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")
    s.text(9.4, 3.45, 1.9, 0.3, "已核 63 张", 9.5, (222, 206, 184), align=PP_ALIGN.CENTER, name="L2-已核说明")
    s.finish()


def page04_intent(prs, A):
    s = L.Slide(prs)
    common(s, A, 4, "创作立意", "这不是一个打仗的游戏", A["warehouse_warm"], 46)
    items = [("01", "不做杀敌计数"), ("02", "不做胜负评分"), ("03", "只问：什么被留下")]
    y = 2.55
    for num, text in items:
        s.text(0.9, y, 0.8, 0.5, num, 18, RED_BRIGHT, FONT_TITLE, bold=True, spacing=1, name="L2-序号")
        s.text(1.72, y - 0.02, 6.6, 0.5, text, 22, PAPER, FONT_TITLE, spacing=1.5, name="L2-断言")
        s.rect(0.9, y + 0.62, 7.0, 0.008, fill=(90, 78, 62), layer="L4", name="L4-细分隔")
        y += 0.95
    s.text(0.9, 5.62, 7.4, 0.8, "四天四夜之后，唯一还能带出去的，是名字。", 17, (220, 208, 188), FONT_TITLE, spacing=1.2, name="L2-结语")
    lamp = os.path.join(OBJ_DIR, "obj-lamp.png")
    if os.path.exists(lamp):
        s.pic(lamp, 8.35, 3.05, 3.7, 3.7, layer="L3", name="L3-煤油灯")
    s.pic(A["ink_splat"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-墨迹")
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")
    s.pic(A["seal_liuming"], 10.95, 2.1, 0.95, 0.95, layer="L4", name="L4-留名印章")
    s.finish()


def page05_structure(prs, A):
    s = L.Slide(prs)
    common(s, A, 5, "故事结构", "六幕，一百四十个场景", A["montage"], 44)
    stages = [
        ("1947", "造册前夜"), ("1937 · 8", "通城整编"), ("1937 · 10", "四行五夜"),
        ("1937—41", "孤军营四年"), ("1947", "造册"), ("1980—2025", "九结局"),
    ]
    x0, y0, step = 0.95, 4.62, 2.05
    s.rect(x0, y0, step * 5 + 0.3, 0.018, fill=GOLD, layer="L3", name="L3-时间轴")
    for i, (year, name) in enumerate(stages):
        x = x0 + i * step
        col = RED_BRIGHT if i in (2, 5) else GOLD
        s.rect(x - 0.045, y0 - 0.075, 0.09, 0.09, fill=col, layer="L3", name="L3-节点", shape=1)
        s.text(x - 0.85, y0 - 0.72, 1.7, 0.28, year, 11.5, col, spacing=2.0, align=PP_ALIGN.CENTER, name="L2-年份")
        s.text(x - 0.85, y0 + 0.22, 1.7, 0.3, name, 13, PAPER, FONT_TITLE, spacing=1.2, align=PP_ALIGN.CENTER, name="L2-幕名")
    s.text(0.95, 2.15, 10.9, 0.9, "一个人的十年，藏在一本册子的夹层里。\n从 1937 到 2025，一场关于「谁被记住」的漫长寻访。", 16, (218, 206, 188), spacing=1.2, name="L2-说明")
    note = os.path.join(OBJ_DIR, "obj-note.png")
    if os.path.exists(note):
        s.pic(note, 9.05, 1.55, 1.6, 1.6, layer="L3", name="L3-纸条", rotation=6)
    ledger = os.path.join(OBJ_DIR, "obj-ledger-closed.png")
    if os.path.exists(ledger):
        s.pic(ledger, 10.75, 0.95, 2.1, 2.1, layer="L3", name="L3-合上的名册", rotation=-5)
    s.pic(A["red_splat"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-朱砂")
    s.finish()


def page06_gameplay(prs, A):
    s = L.Slide(prs)
    common(s, A, 6, "核心玩法", "五个夜晚，每一次只能带一样东西过河", A["warehouse_night"], 38)
    carriers = ["名册", "家书", "旗", "照片", "口述", "口信"]
    x, y = 0.9, 3.15
    for i, name in enumerate(carriers):
        s.text(x + i * 1.42, y, 1.3, 0.42, name, 19, PAPER, FONT_TITLE, spacing=2, align=PP_ALIGN.CENTER, name="L2-载体")
        s.text(x + i * 1.42, y + 0.46, 1.3, 0.26, f"0{i+1}", 9, MUTED, align=PP_ALIGN.CENTER, name="L2-载体编号")
    s.rect(0.9, 4.02, 8.6, 0.02, fill=RED, layer="L3", name="L3-苏州河线")
    s.text(9.75, 3.92, 2.6, 0.3, "苏州河", 10, (206, 120, 100), spacing=3, name="L2-河名")
    s.text(0.9, 4.35, 7.4, 1.0, "你带出去什么，什么就活下来。\n两样同时带走，才解锁第三个结局。", 16, (218, 206, 188), spacing=1.2, name="L2-说明")
    letter = os.path.join(OBJ_DIR, "obj-letter.png")
    if os.path.exists(letter):
        s.pic(letter, 8.15, 5.05, 2.15, 2.15, layer="L3", name="L3-家书", rotation=4)
    flag = os.path.join(OBJ_DIR, "obj-flag.png")
    if os.path.exists(flag):
        s.pic(flag, 10.15, 4.85, 2.35, 2.35, layer="L3", name="L3-旗", rotation=-4)
    s.pic(A["scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左下压暗")
    s.pic(A["seal_liuming"], 11.85, 5.55, 0.9, 0.9, layer="L4", name="L4-留名印章")
    s.finish()


def page07_screenshot(prs, A):
    s = L.Slide(prs)
    common(s, A, 7, "实机画面", "实机整屏", A["ink"], 42)
    s.text(0.9, 1.98, 6.0, 0.34, "真实运行截图（线上定稿版），1920×1080", 11, MUTED, spacing=1.2, name="L2-说明")
    s.screenshot_placeholder(0.85, 2.45, 9.8, 5.51, "shot-03-choices.png")
    notes = ["场景正文：宋体正文 + 史料 chip", "选项：数字键 1—9 可选", "右上：3D 视角入口", "右下：声音开关（默认静音）"]
    for i, note in enumerate(notes):
        yy = 2.55 + i * 1.02
        s.rect(10.95, yy + 0.12, 0.18, 0.012, fill=RED_BRIGHT, layer="L4", name="L4-引出线")
        s.text(11.25, yy, 1.9, 0.8, note, 11.5, (224, 212, 192), line_spacing=1.18, name="L2-标注")
    s.pic(A["seal_checked"], 10.95, 6.45, 0.9, 0.9, layer="L4", name="L4-已核印章")
    s.finish()


def page08_animation(prs, A):
    s = L.Slide(prs)
    common(s, A, 8, "交互与动画", "每一次选择，都有各自的回响", A["ink"], 40)
    lines = [
        ("六 种", "记忆载体的点击粒子：墨点 / 纸片 / 红绸 / 白闪 / 声波 / 上浮的字"),
        ("五 种", "天气换场：墨 / 雨 / 雪 / 灰 / 烟，2.09s 全黑帧换内容"),
        ("九 段", "六秒终极画面：可跳过、可重看，减少动效自动降级"),
    ]
    y = 2.3
    for tag, desc in lines:
        s.text(0.9, y, 1.2, 0.4, tag, 20, RED_BRIGHT, FONT_TITLE, bold=True, spacing=1, name="L2-标签")
        s.text(2.15, y + 0.04, 4.9, 0.7, desc, 12.5, (212, 200, 182), line_spacing=1.2, name="L2-描述")
        y += 1.18
    s.text(0.9, 5.95, 5.7, 0.6, "没有游戏引擎，也没有动画库。每一帧都是手写的。", 13, (200, 188, 170), FONT_TITLE, spacing=0.6, name="L2-结语")
    for i, (label, sub) in enumerate([("动效帧 01", "墨幕 cover"), ("动效帧 02", "墨幕 hold"), ("动效帧 03", "粒子 · 名册"), ("动效帧 04", "终极画面")]):
        gx = 7.05 + (i % 2) * 2.95
        gy = 2.35 + (i // 2) * 2.15
        s.screenshot_placeholder(gx, gy, 2.65, 1.49, label, sub)
    s.finish()


def page09_3d(prs, A):
    s = L.Slide(prs)
    common(s, A, 9, "真 3D 场景", "五个 hero 场景，把纵深用在看得见的地方", A["blender"], 36)
    s.big_number(0.9, 2.15, "4,732", "三角面（仓库西墙 GLB）", num_size=42, w=2.6)
    s.big_number(3.55, 2.15, "469.6KB", "GLB 体积", num_size=42, w=2.6)
    s.big_number(6.35, 2.15, "≤25", "draw calls 预算", num_size=42, w=2.2)
    s.text(0.9, 3.72, 6.1, 1.2, "西墙：Blender 无头建模导出；\n其余四场：底楼 / 楼顶 / 桥 / 1947 厢房，程序化几何。", 13.5, (212, 200, 182), line_spacing=1.25, name="L2-说明")
    s.text(0.9, 5.15, 6.1, 1.0, "无 WebGL、开启减少动效、窗口 <700px：\n自动回退 2.5D，正文永远可读。", 13, (200, 188, 170), line_spacing=1.25, name="L2-回退")
    s.screenshot_placeholder(7.15, 2.05, 5.2, 2.93, "shot-04-3d.png")
    s.pic(A["wireframe"], 7.35, 4.92, 3.35, 2.15, layer="L3", name="L3-GLB 线框")
    s.pic(A["seal_number"], 10.75, 5.35, 0.95, 0.95, layer="L4", name="L4-编号印章")
    s.finish()


def page10_sound(prs, A):
    s = L.Slide(prs)
    common(s, A, 10, "声音设计", "28 条声音，默认静音", A["wave"], 44)
    s.big_number(0.9, 2.2, "28", "条本地生成音效", num_size=46)
    s.big_number(3.15, 2.2, "4.88MB", "OGG 总体积", num_size=46, w=2.4)
    s.big_number(5.55, 2.2, "497M", "Stable Audio Open Small", num_size=46, w=2.8)
    s.text(0.9, 3.85, 6.6, 1.2, "场景按天气与地点切换；结局有专属低音。\n默认静音，首次手势解锁，右下角可关，状态记忆。", 14, (212, 200, 182), line_spacing=1.3, name="L2-说明")
    s.text(0.9, 5.35, 6.4, 0.8, "声音不是惊吓。\n它只是让你相信，那个夜晚真的存在。", 14, (200, 188, 170), FONT_TITLE, spacing=0.5, line_spacing=1.3, name="L2-结语")
    rec = os.path.join(OBJ_DIR, "obj-recorder.png")
    if os.path.exists(rec):
        s.pic(rec, 8.15, 2.55, 3.6, 3.6, layer="L3", name="L3-录音机", rotation=-3)
    s.rect(0.9, 1.72, 3.0, 0.02, fill=RED, layer="L4", name="L4-红线")
    s.pic(A["seal_mute"], 11.15, 2.15, 1.0, 1.0, layer="L4", name="L4-静音印章")
    s.finish()


def page11_art(prs, A):
    s = L.Slide(prs)
    common(s, A, 11, "美术与质检", "496 张插画，一张一张过质检", A["art_collage"], 42)
    s.big_number(0.9, 2.2, "500", "条生成总谱", num_size=44)
    s.big_number(3.15, 2.2, "496", "张落盘", num_size=44)
    s.big_number(5.4, 2.2, "95.6%", "入屏质检可用率", num_size=44, w=2.8)
    s.text(0.9, 3.85, 6.2, 1.0, "入屏 158 张逐张 VLM 质检：\nprompt 符合 / 时代准确 / 画面瑕疵 / 危险元素。", 13.5, (212, 200, 182), line_spacing=1.25, name="L2-说明")
    for i, art in enumerate(A["art_cards"]):
        gx = 7.0 + (i % 3) * 1.95
        gy = 4.55
        s.pic(art, gx, gy, 1.8, 1.8, layer="L3", name=f"L3-插画{i+1}", rotation=(-5 + i * 5))
        s.rect(gx, gy, 1.8, 1.8, fill=None, line=GOLD, line_w=0.75, layer="L4", name="L4-画框")
    s.pic(A["seal_pass"], 10.55, 2.05, 1.0, 1.0, layer="L4", name="L4-合格印章")
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")
    s.finish()


def page12_text(prs, A):
    s = L.Slide(prs)
    common(s, A, 12, "文本与审计", "113,048 字，每一句都敢让人查", A["office"], 40)
    s.big_number(0.9, 2.15, "113,048", "严格正文（只算读到的段落）", num_size=46, w=3.0)
    s.big_number(4.35, 2.15, "140", "个场景", num_size=46, w=1.8)
    s.big_number(6.15, 2.15, "P0=0", "史实审计红线", num_size=46, w=2.2)
    s.text(0.9, 3.8, 6.6, 1.4, "双轨审计：史实 P0=0；文学 146 单元加权 4.59。\n新增 3 个合成结局补审：史实 P0 4→0，文学 3.99→4.35。", 13.5, (212, 200, 182), line_spacing=1.3, name="L2-说明")
    s.text(0.9, 5.55, 6.6, 0.9, "写得多不难。难的是，每一句都敢让人查。", 16, (218, 206, 188), FONT_TITLE, spacing=0.8, name="L2-结语")
    ledger = os.path.join(OBJ_DIR, "obj-ledger-empty.png")
    if os.path.exists(ledger):
        s.pic(ledger, 8.0, 3.55, 4.35, 4.35, layer="L3", name="L3-空白册页", rotation=-4)
    note = os.path.join(OBJ_DIR, "obj-note.png")
    if os.path.exists(note):
        s.pic(note, 7.15, 2.7, 1.7, 1.7, layer="L3", name="L3-纸条", rotation=7)
    s.pic(A["seal_checked"], 11.05, 2.05, 1.05, 1.05, layer="L4", name="L4-已核印章")
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")
    s.finish()


def page13_arch(prs, A):
    s = L.Slide(prs)
    common(s, A, 13, "技术架构", "纯静态站点：无后端、无 CDN、断网可跑", A["terminal"], 38)
    s.text(0.9, 2.0, 6.4, 0.8, "React 19 + TypeScript 7 + Vite 8　｜　纯函数状态机 + localStorage 存档", 12, (204, 192, 174), spacing=0.8, name="L2-副线")
    boxes = [
        ("数据层", "content · 140 场景 / 9 结局 / 76 卡", 0.95, 3.05),
        ("状态机", "engine · choose / advance / 账本封顶", 2.9, 4.35),
        ("编排层", "App · 屏幕切换 / 存档 / 音频", 4.85, 5.65),
        ("表现层", "Stage(2.5D) · Scene3D · InkCurtain", 6.8, 6.95),
    ]
    for title, sub, x, y in boxes:
        s.rect(x - 0.12, y - 0.18, 3.1, 1.02, fill=(30, 26, 22), line=(126, 104, 74), line_w=0.75, layer="L3", name="L3-架构框")
        s.text(x, y - 0.08, 2.8, 0.3, title, 13, PAPER, FONT_TITLE, spacing=2, name="L2-框标题")
        s.text(x, y + 0.24, 2.85, 0.45, sub, 9, (188, 176, 156), line_spacing=1.0, name="L2-框说明")
    for i in range(3):
        x1 = [3.0, 4.95, 6.9][i]
        y1 = [3.75, 5.05, 6.35][i]
        s.rect(x1, y1, 0.85, 0.014, fill=RED_BRIGHT, layer="L4", name="L4-流程线", rotation=-22)
    stats = [("298.5 kB", "主包 gzip"), ("171.1 kB", "3D 懒加载 gzip"), ("23.47 MB", "dist 总体积")]
    for i, (num, label) in enumerate(stats):
        s.text(9.35, 2.35 + i * 1.15, 3.0, 0.5, num, 24, PAPER, FONT_TITLE, bold=True, spacing=0.6, name="L2-体积数字")
        s.text(9.35, 2.78 + i * 1.15, 3.0, 0.3, label, 10, MUTED, spacing=2, name="L2-体积说明")
    s.pic(A["seal_number"], 11.55, 5.75, 1.0, 1.0, layer="L4", name="L4-编号印章")
    s.finish()


def page14_pipeline(prs, A):
    s = L.Slide(prs)
    common(s, A, 14, "AI 生产管线", "AI 是产能，不是免责", A["grid"], 44)
    s.text(0.9, 2.0, 8.6, 0.5, "模型、seed、参数、质检记录、审计边界——全部在仓库里。", 13.5, (212, 200, 182), spacing=0.8, name="L2-说明")
    stages = [
        ("文本", "分区写作\n双轨审计"), ("插画", "SDXL\n+Lightning"), ("质检", "Qwen3-VL\n四维打分"),
        ("音频", "Stable Audio\nOpen Small"), ("3D", "Blender\n无头 bpy"), ("审计", "史实 / 文学\n补审"),
    ]
    x0, y0, step = 0.95, 3.45, 2.02
    s.rect(x0, y0 + 0.72, step * 5 + 0.55, 0.016, fill=GOLD, layer="L3", name="L3-管线")
    for i, (name, model) in enumerate(stages):
        x = x0 + i * step
        s.rect(x - 0.12, y0 - 0.28, 1.62, 1.9, fill=(28, 24, 20), line=(126, 104, 74), line_w=0.6, layer="L3", name="L3-阶段框")
        s.text(x, y0 - 0.18, 1.45, 0.4, name, 15, RED_BRIGHT if i in (0, 5) else PAPER, FONT_TITLE, spacing=2, name="L2-阶段名")
        s.text(x, y0 + 0.22, 1.45, 0.8, model, 9, (192, 180, 160), line_spacing=1.15, name="L2-模型名")
        s.text(x, y0 + 1.78, 1.45, 0.3, f"0{i+1}", 9, MUTED, spacing=1, name="L2-阶段号")
    s.text(0.92, 6.0, 11.6, 0.6, "插画 500 条总谱 → 496 张落盘；入屏 158 张逐张 VLM 质检，95.6% 可用。音效 28 条；3D 资产 4,732 三角面。", 12, (200, 188, 170), line_spacing=1.2, name="L2-产出")
    s.pic(A["seal_checked"], 11.4, 5.4, 0.95, 0.95, layer="L4", name="L4-已核印章")
    s.finish()


def page15_quality(prs, A):
    s = L.Slide(prs)
    common(s, A, 15, "工程质量", "能玩、能跑、能查", A["terminal2"], 46)
    items = [("9/9", "结局可达"), ("11/11", "终审断言"), ("115", "场景 0 错误"), ("0", "部署失败请求")]
    for i, (num, label) in enumerate(items):
        x = 0.9 + i * 2.45
        s.text(x, 2.3, 2.2, 0.62, num, 40, PAPER, FONT_TITLE, bold=True, spacing=0.5, name="L2-结果数字")
        s.text(x, 2.98, 2.2, 0.32, label, 10.5, MUTED, spacing=2, name="L2-结果说明")
    s.text(0.9, 3.95, 7.4, 1.0, "子目录部署 / 减少动效 / 390px 移动端 / 对比度 WCAG AA\n全部实测通过；断网、坏存档、localStorage 禁用仍可玩。", 13, (212, 200, 182), line_spacing=1.3, name="L2-说明")
    s.text(0.9, 5.5, 7.0, 0.8, "不是「在我电脑上能跑」。\n是「在评委的电脑上也能跑」。", 15, (218, 206, 188), FONT_TITLE, spacing=0.5, line_spacing=1.25, name="L2-结语")
    s.screenshot_placeholder(9.55, 1.55, 2.35, 5.16, "shot-10-mobile.png", "390 × 844")
    s.pic(A["seal_pass"], 12.1, 5.9, 0.9, 0.9, layer="L4", name="L4-通过印章")
    s.pic(A["top_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-顶压暗")
    s.finish()


def page16_innovation(prs, A):
    s = L.Slide(prs)
    common(s, A, 16, "创新与差异", "四件别人不容易抄的事", A["wallhole"], 44)
    rows = [
        ("01", "史实可核到原句", "76 张史料卡可点开：原句 + 作者 + 出处 + 定位"),
        ("02", "结局按「留下什么」", "不按杀敌与胜负排名，只回答哪一种记忆被留下"),
        ("03", "全离线、任意静态目录", "无后端、无 CDN、无外部字体，子目录部署可跑"),
        ("04", "AI 使用全透明", "模型、seed、参数、质检、审计边界全部可查"),
    ]
    y = 2.3
    for num, title, desc in rows:
        s.text(0.9, y, 0.9, 0.5, num, 20, RED_BRIGHT, FONT_TITLE, bold=True, spacing=1, name="L2-序号")
        s.text(1.75, y - 0.04, 5.2, 0.42, title, 20, PAPER, FONT_TITLE, spacing=1.5, name="L2-标题")
        s.text(1.75, y + 0.44, 5.6, 0.4, desc, 10.5, (196, 184, 166), line_spacing=1.15, name="L2-说明")
        s.rect(0.9, y + 1.0, 6.5, 0.008, fill=(86, 74, 58), layer="L4", name="L4-分隔线")
        y += 1.18
    ledger = os.path.join(OBJ_DIR, "obj-ledger-closed.png")
    if os.path.exists(ledger):
        s.pic(ledger, 8.55, 3.85, 3.0, 3.0, layer="L3", name="L3-合上的名册", rotation=-6)
    s.text(8.3, 3.6, 4.2, 0.7, "我们拼的不是体量。\n是「经得起追问」。", 14, (214, 202, 184), FONT_TITLE, spacing=0.5, line_spacing=1.25, name="L2-结语")
    s.pic(A["seal_checked"], 10.95, 2.15, 0.95, 0.95, layer="L4", name="L4-已核印章")
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")
    s.finish()


def page17_boundary(prs, A):
    s = L.Slide(prs)
    common(s, A, 17, "边界与下一步", "我们知道它还不完美", A["wallhole"], 44)
    items = [
        "3 个合成结局为后补：已补独立审计（P0=0 / 4.35）",
        "4 个场景无插画：走渐变回退，不硬凑",
        "评审视频待录；文献检索结果待回填",
        "全库不出现学校 / 姓名 / 指导教师",
    ]
    y = 2.5
    for i, text in enumerate(items):
        s.rect(0.9, y + 0.1, 0.16, 0.016, fill=RED_BRIGHT, layer="L4", name="L4-短横")
        s.text(1.25, y, 7.2, 0.42, text, 14.5, (214, 202, 184), spacing=1.0, name="L2-条目")
        y += 0.92
    s.text(0.9, 6.15, 7.4, 0.7, "把没做到的地方写出来，和把做到的写出来，一样重要。", 14, (200, 188, 170), FONT_TITLE, spacing=0.5, name="L2-结语")
    blank = os.path.join(OBJ_DIR, "obj-ledger-empty.png")
    if os.path.exists(blank):
        s.pic(blank, 8.3, 2.65, 4.0, 4.0, layer="L3", name="L3-空白名册", rotation=-3)
    s.text(8.3, 6.72, 4.3, 0.4, "还有名字没找到。", 12, (222, 110, 88), FONT_TITLE, spacing=2, align=PP_ALIGN.CENTER, name="L2-留白")
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")
    s.finish()


def page18_data(prs, A):
    s = L.Slide(prs)
    s.pic(A["paper"], 0, 0, PAGE_W, PAGE_H, layer="L1", name="L1-档案纸")
    s.rect(0.85, 0.85, 10.4, 0.012, fill=(120, 105, 82), layer="L4", name="L4-细线")
    s.kicker("数据总表", color=RED)
    s.headline("一页看完", size=42, color=INK, spacing=3)
    s.rect(0.87, 1.98, 2.6, 0.028, fill=RED, layer="L2", name="L2-红色标题线")
    data = [
        ("113,048", "严格正文字数"), ("140", "场景"), ("9", "结局（6 主 + 3 合成）"),
        ("76", "史料卡（63 已核）"), ("496", "张插画"), ("28", "条音效"),
        ("5", "个真 3D 场景"), ("500", "条图片总谱"), ("95.6%", "入屏质检可用率"), ("0", "后端依赖"),
    ]
    for i, (num, label) in enumerate(data):
        col = i % 2
        row = i // 2
        x = 0.9 + col * 4.65
        y = 2.34 + row * 0.87
        s.text(x, y, 1.9, 0.52, num, 30, INK, FONT_TITLE, bold=True, spacing=0.5, name="L2-数据数字")
        s.text(x + 1.95, y + 0.1, 2.45, 0.34, label, 10.5, (110, 96, 76), spacing=1.2, name="L2-数据说明")
        s.rect(x, y + 0.66, 4.3, 0.008, fill=(182, 168, 146), layer="L4", name="L4-分隔线")
    s.text(0.9, 6.55, 9.2, 0.4, "所有数字都可以在仓库里复现（tools/metrics.mjs）。", 10.5, (120, 105, 82), spacing=1.0, name="L2-脚注")
    s.pic(A["seal_number"], 10.55, 1.35, 1.55, 1.55, layer="L3", name="L3-编号印章")
    s.footer(18, dark=False)


def page19_closing(prs, A):
    s = L.Slide(prs)
    s.pic(L.l1_from_bg("flag", mood="night", dark=0.72, red_glow=(SW * 0.3, SH * 0.6, 40, 0.3)), 0, 0, PAGE_W, PAGE_H, layer="L1", name="L1-渲染底图")
    s.text(0.95, 2.15, 9.0, 1.4, "把名字留下来", 76, PAPER, FONT_TITLE, bold=True, spacing=6, name="L2-主标题")
    s.rect(1.0, 3.62, 3.1, 0.026, fill=RED, layer="L2", name="L2-红色标题线")
    s.text(1.0, 3.9, 8.6, 0.5, "四百二十余人守了四天四夜。他们的名字，后来只找回来八十七个。", 15, (216, 204, 186), FONT_TITLE, spacing=0.6, name="L2-引语")
    s.text(1.0, 5.25, 8.6, 0.4, "在线试玩　https://moon6jb6.github.io/szmt2026/", 13, (222, 206, 184), spacing=0.8, name="L2-网址")
    s.text(1.0, 5.75, 8.6, 0.4, "作品编号 460737　｜　2026 第十四届全国大学生数字媒体科技作品及创意竞赛", 11, MUTED, spacing=0.6, name="L2-赛事")
    s.text(1.0, 6.55, 8.6, 0.6, "谢 谢", 22, PAPER, FONT_TITLE, spacing=10, name="L2-谢谢")
    ledger = os.path.join(OBJ_DIR, "obj-ledger-closed.png")
    if os.path.exists(ledger):
        s.pic(ledger, 8.7, 4.55, 3.6, 3.6, layer="L3", name="L3-合上的名册", rotation=-8)
    s.pic(A["scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左下压暗")
    s.pic(A["ribbon"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-朱红绸带", rotation=6)
    s.pic(A["gold_lines"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-金线")
    s.rect(10.35, 1.55, 2.15, 2.15, fill=PAPER, line=RED, line_w=1.2, layer="L4", name="L4-二维码卡")
    s.pic(A["qr"], 10.5, 1.7, 1.85, 1.85, layer="L4", name="L4-二维码")
    s.text(10.3, 3.82, 2.3, 0.3, "扫码试玩", 10, (222, 206, 184), spacing=2, align=PP_ALIGN.CENTER, name="L2-扫码")
    s.finish()


# ================================================================ 版面二轮修订
def _left_scrim(s, A):
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")


def page05_structure(prs, A):
    s = L.Slide(prs)
    common(s, A, 5, "故事结构", "六幕，一百四十个场景", A["montage"], 44)
    s.text(0.9, 2.05, 10.8, 0.8, "一个人的十年，藏在一本册子的夹层里。\n从 1937 到 2025，一场关于「谁被记住」的漫长寻访。", 15, (218, 206, 188), spacing=1.2, line_spacing=1.3, name="L2-说明")
    stages = [
        ("1947", "造册前夜"), ("1937 · 8", "通城整编"), ("1937 · 10", "四行五夜"),
        ("1937—41", "孤军营四年"), ("1947", "造册"), ("1980—2025", "九结局"),
    ]
    x0, y0, step = 1.05, 4.55, 2.28
    s.rect(x0, y0, step * 5, 0.016, fill=GOLD, layer="L3", name="L3-时间轴")
    for i, (year, name) in enumerate(stages):
        x = x0 + i * step
        hot = i in (2, 5)
        col = RED_BRIGHT if hot else GOLD
        s.rect(x - 0.06, y0 - 0.05, 0.12, 0.12, fill=col, layer="L3", name="L3-节点", shape=1)
        s.text(x - 0.95, y0 - 0.62, 1.9, 0.28, year, 11, col, spacing=2.2, align=PP_ALIGN.CENTER, name="L2-年份")
        s.text(x - 0.95, y0 + 0.26, 1.9, 0.32, name, 14 if hot else 13, PAPER if hot else (216, 204, 186), FONT_TITLE, spacing=1.2, align=PP_ALIGN.CENTER, name="L2-幕名")
    s.text(1.05, 6.35, 10.8, 0.4, "主链 115 个场景可走通；另有 25 个场景在人物志 / 后来 / 史料库中展开。", 10.5, (188, 176, 158), spacing=0.8, name="L2-脚注")
    _left_scrim(s, A)
    s.pic(A["red_splat"], 9.4, 1.2, 3.9, 2.2, layer="L4", name="L4-朱砂")
    s.finish()


def page13_arch(prs, A):
    s = L.Slide(prs)
    common(s, A, 13, "技术架构", "纯静态站点：无后端、无 CDN、断网可跑", A["terminal"], 38)
    s.text(0.9, 1.95, 8.6, 0.4, "React 19 + TypeScript 7 + Vite 8　｜　纯函数状态机 + localStorage 存档", 11.5, (204, 192, 174), spacing=0.6, name="L2-副线")
    boxes = [
        ("数据层", "content\n140 场景 / 9 结局 / 76 卡", 0.95),
        ("状态机", "engine\nchoose / advance / 账本封顶", 3.98),
        ("编排层", "App\n屏幕切换 / 存档 / 音频", 7.01),
        ("表现层", "Stage · Scene3D\nInkCurtain · ChoiceBurst", 10.04),
    ]
    for i, (title, sub, x) in enumerate(boxes):
        s.rect(x, 3.15, 2.55, 1.75, fill=(38, 32, 26), line=(150, 122, 84), line_w=1.0, layer="L3", name="L3-架构框")
        s.text(x + 0.18, 3.3, 2.2, 0.32, f"0{i+1}  {title}", 13, RED_BRIGHT if i in (0, 3) else PAPER, FONT_TITLE, spacing=1.5, layer="L3", name="L3-框标题")
        s.text(x + 0.18, 3.72, 2.2, 1.0, sub, 9.5, (224, 212, 192), line_spacing=1.2, layer="L3", name="L3-框说明")
        if i < 3:
            s.rect(x + 2.6, 3.92, 0.34, 0.03, fill=RED_BRIGHT, layer="L4", name="L4-流程线")
    s.text(0.95, 5.35, 11.5, 0.4, "数据 → 状态机 → 编排 → 表现：四层单向依赖，全部可静态构建；无接口请求、无数据库。", 11.5, (216, 204, 186), spacing=0.6, name="L2-说明")
    stats = [("298.5 kB", "主包 gzip"), ("171.1 kB", "3D 懒加载 gzip"), ("23.47 MB", "dist 总体积"), ("0", "后端 / CDN 依赖")]
    for i, (num, label) in enumerate(stats):
        x = 0.95 + i * 3.05
        s.text(x, 5.95, 2.6, 0.5, num, 22, PAPER, FONT_TITLE, bold=True, spacing=0.6, name="L2-体积数字")
        s.text(x, 6.38, 2.6, 0.3, label, 9.5, MUTED, spacing=2, name="L2-体积说明")
    _left_scrim(s, A)
    s.pic(A["top_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-顶压暗")
    s.pic(A["seal_number"], 11.55, 1.72, 0.9, 0.9, layer="L4", name="L4-编号印章")
    s.finish()


def page14_pipeline(prs, A):
    s = L.Slide(prs)
    common(s, A, 14, "AI 生产管线", "AI 是产能，不是免责", A["grid"], 44)
    s.text(0.9, 1.95, 9.0, 0.4, "模型、seed、参数、质检记录、审计边界——全部在仓库里。", 12.5, (212, 200, 182), spacing=0.6, name="L2-说明")
    stages = [
        ("文本", "分区写作\n双轨审计"), ("插画", "SDXL\n+Lightning"), ("质检", "Qwen3-VL\n四维打分"),
        ("音频", "Stable Audio\nOpen Small"), ("3D", "Blender\n无头 bpy"), ("审计", "史实 / 文学\n补审"),
    ]
    x0, y0, step = 0.95, 3.35, 2.06
    s.rect(x0, y0 + 1.98, step * 5 + 0.2, 0.016, fill=GOLD, layer="L3", name="L3-管线")
    for i, (name, model) in enumerate(stages):
        x = x0 + i * step
        s.rect(x - 0.05, y0, 1.86, 1.92, fill=(38, 32, 26), line=(150, 122, 84), line_w=0.8, layer="L2", name="L2-阶段框")
        s.text(x + 0.1, y0 + 0.12, 1.65, 0.4, name, 15, RED_BRIGHT if i in (0, 5) else PAPER, FONT_TITLE, spacing=2, name="L2-阶段名")
        s.text(x + 0.1, y0 + 0.62, 1.65, 0.9, model, 10.5, (228, 216, 196), line_spacing=1.2, name="L2-模型名")
        s.text(x + 0.1, y0 + 1.5, 1.6, 0.3, f"0{i+1}", 9, (150, 138, 118), spacing=1, name="L2-阶段号")
    s.text(0.9, 5.95, 11.8, 0.8, "插画 500 条总谱 → 496 张落盘，入屏 158 张逐张 VLM 质检（95.6% 可用）；音效 28 条；3D 资产 4,732 三角面。", 11, (198, 186, 168), line_spacing=1.2, name="L2-产出")
    _left_scrim(s, A)
    s.pic(A["top_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-顶压暗")
    s.pic(A["seal_checked"], 11.45, 1.72, 0.9, 0.9, layer="L4", name="L4-已核印章")
    s.finish()


def page18_data(prs, A):
    s = L.Slide(prs)
    s.pic(A["paper"], 0, 0, PAGE_W, PAGE_H, layer="L1", name="L1-档案纸")
    s.rect(0.85, 0.85, 11.4, 0.012, fill=(150, 132, 104), layer="L4", name="L4-细线")
    s.kicker("数据总表", color=RED)
    s.headline("一页看完", size=42, color=INK, spacing=3)
    s.rect(0.87, 1.98, 2.6, 0.028, fill=RED, layer="L2", name="L2-红色标题线")
    data = [
        ("113,048", "严格正文字数"), ("140", "场景"), ("9", "结局（6 主 + 3 合成）"),
        ("76", "史料卡（63 已核）"), ("496", "张插画"), ("28", "条音效"),
        ("5", "个真 3D 场景"), ("500", "条图片总谱"), ("95.6%", "入屏质检可用率"), ("0", "后端依赖"),
    ]
    for i, (num, label) in enumerate(data):
        col = i % 2
        row = i // 2
        x = 0.9 + col * 5.5
        y = 2.32 + row * 0.86
        s.text(x, y, 2.3, 0.5, num, 28, INK, FONT_TITLE, bold=True, spacing=0.5, name="L2-数据数字")
        s.text(x + 2.42, y + 0.09, 2.6, 0.32, label, 10.5, (110, 96, 76), spacing=1.0, name="L2-数据说明")
        s.rect(x, y + 0.64, 4.9, 0.008, fill=(182, 168, 146), layer="L4", name="L4-分隔线")
    s.text(0.9, 6.62, 9.6, 0.4, "所有数字都可以在仓库里复现（tools/metrics.mjs）。", 10.5, (120, 105, 82), spacing=1.0, name="L2-脚注")
    s.pic(A["seal_number"], 10.75, 1.30, 1.5, 1.5, layer="L3", name="L3-编号印章")
    s.footer(18, dark=False)
    s.finish()


PAGES = [
    page01_cover, page02_info, page03_history, page04_intent, page05_structure,
    page06_gameplay, page07_screenshot, page08_animation, page09_3d, page10_sound,
    page11_art, page12_text, page13_arch, page14_pipeline, page15_quality,
    page16_innovation, page17_boundary, page18_data, page19_closing,
]


# ================================================================ 渲染
def render(pptx_path):
    import win32com.client

    app = win32com.client.Dispatch("PowerPoint.Application")
    app.Visible = 1
    pres = app.Presentations.Open(pptx_path, WithWindow=False)
    try:
        for i in range(1, pres.Slides.Count + 1):
            out = os.path.join(PREVIEW, f"p{i:02d}.png")
            pres.Slides(i).Export(out, "PNG", 1920, 1080)
        print("[preview]", pres.Slides.Count, "slides")
    finally:
        pres.Close()
        app.Quit()


def contact_sheet():
    files = sorted(f for f in os.listdir(PREVIEW) if f.startswith("p") and f.endswith(".png"))
    files = [f for f in files if f[1:3].isdigit()]
    cols, rows = 4, 5
    tw, th = 480, 270
    sheet = Image.new("RGB", (cols * tw, rows * th), (12, 10, 8))
    for idx, f in enumerate(files[: cols * rows]):
        im = Image.open(os.path.join(PREVIEW, f)).convert("RGB").resize((tw, th), Image.LANCZOS)
        sheet.paste(im, ((idx % cols) * tw, (idx // cols) * th))
    out = os.path.join(PREVIEW, "contact-sheet.png")
    sheet.save(out)
    print("[sheet]", out)
    return out


def main():
    A = ensure_assets()
    prs = Presentation()
    prs.slide_width = Inches(PAGE_W)
    prs.slide_height = Inches(PAGE_H)
    for fn in PAGES:
        fn(prs, A)
    prs.save(OUT_PPTX)
    print("[pptx]", OUT_PPTX)
    render(OUT_PPTX)
    contact_sheet()


if __name__ == "__main__":
    main()
