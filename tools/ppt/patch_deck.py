import io
import re

P = "tools/ppt/build_deck.py"
src = io.open(P, encoding="utf8").read()

OVERRIDES = '''# ================================================================ 版面二轮修订
def _left_scrim(s, A):
    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")


def page05_structure(prs, A):
    s = L.Slide(prs)
    common(s, A, 5, "故事结构", "六幕，一百四十个场景", A["montage"], 44)
    s.text(0.9, 2.05, 10.8, 0.8, "一个人的十年，藏在一本册子的夹层里。\\n从 1937 到 2025，一场关于「谁被记住」的漫长寻访。", 15, (218, 206, 188), spacing=1.2, line_spacing=1.3, name="L2-说明")
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
        ("数据层", "content\\n140 场景 / 9 结局 / 76 卡", 0.95),
        ("状态机", "engine\\nchoose / advance / 账本封顶", 3.98),
        ("编排层", "App\\n屏幕切换 / 存档 / 音频", 7.01),
        ("表现层", "Stage · Scene3D\\nInkCurtain · ChoiceBurst", 10.04),
    ]
    for i, (title, sub, x) in enumerate(boxes):
        s.rect(x, 3.15, 2.55, 1.75, fill=(30, 26, 22), line=(132, 108, 76), line_w=0.9, layer="L3", name="L3-架构框")
        s.text(x + 0.18, 3.3, 2.2, 0.32, f"0{i+1}  {title}", 13, RED_BRIGHT if i in (0, 3) else PAPER, FONT_TITLE, spacing=1.5, name="L2-框标题")
        s.text(x + 0.18, 3.75, 2.2, 0.95, sub, 9, (200, 188, 168), line_spacing=1.2, name="L2-框说明")
        if i < 3:
            s.rect(x + 2.6, 3.92, 0.34, 0.03, fill=RED_BRIGHT, layer="L4", name="L4-流程线")
    s.text(0.95, 5.35, 11.5, 0.4, "数据 → 状态机 → 编排 → 表现：四层单向依赖，全部可静态构建；无接口请求、无数据库。", 11.5, (216, 204, 186), spacing=0.6, name="L2-说明")
    stats = [("298.5 kB", "主包 gzip"), ("171.1 kB", "3D 懒加载 gzip"), ("23.47 MB", "dist 总体积"), ("0", "后端 / CDN 依赖")]
    for i, (num, label) in enumerate(stats):
        x = 0.95 + i * 3.05
        s.text(x, 5.95, 2.6, 0.5, num, 22, PAPER, FONT_TITLE, bold=True, spacing=0.6, name="L2-体积数字")
        s.text(x, 6.38, 2.6, 0.3, label, 9.5, MUTED, spacing=2, name="L2-体积说明")
    _left_scrim(s, A)
    s.pic(A["seal_number"], 11.55, 1.72, 0.9, 0.9, layer="L4", name="L4-编号印章")
    s.finish()


def page14_pipeline(prs, A):
    s = L.Slide(prs)
    common(s, A, 14, "AI 生产管线", "AI 是产能，不是免责", A["grid"], 44)
    s.text(0.9, 1.95, 9.0, 0.4, "模型、seed、参数、质检记录、审计边界——全部在仓库里。", 12.5, (212, 200, 182), spacing=0.6, name="L2-说明")
    stages = [
        ("文本", "分区写作\\n双轨审计"), ("插画", "SDXL\\n+Lightning"), ("质检", "Qwen3-VL\\n四维打分"),
        ("音频", "Stable Audio\\nOpen Small"), ("3D", "Blender\\n无头 bpy"), ("审计", "史实 / 文学\\n补审"),
    ]
    x0, y0, step = 0.95, 3.35, 2.06
    s.rect(x0, y0 + 1.98, step * 5 + 0.2, 0.016, fill=GOLD, layer="L3", name="L3-管线")
    for i, (name, model) in enumerate(stages):
        x = x0 + i * step
        s.rect(x - 0.05, y0, 1.86, 1.92, fill=(28, 24, 20), line=(132, 108, 76), line_w=0.7, layer="L3", name="L3-阶段框")
        s.text(x + 0.1, y0 + 0.12, 1.65, 0.4, name, 15, RED_BRIGHT if i in (0, 5) else PAPER, FONT_TITLE, spacing=2, name="L2-阶段名")
        s.text(x + 0.1, y0 + 0.62, 1.65, 0.9, model, 10, (212, 200, 180), line_spacing=1.2, name="L2-模型名")
        s.text(x + 0.1, y0 + 1.5, 1.6, 0.3, f"0{i+1}", 9, (150, 138, 118), spacing=1, name="L2-阶段号")
    s.text(0.9, 5.95, 11.8, 0.8, "插画 500 条总谱 → 496 张落盘，入屏 158 张逐张 VLM 质检（95.6% 可用）；音效 28 条；3D 资产 4,732 三角面。", 11, (198, 186, 168), line_spacing=1.2, name="L2-产出")
    _left_scrim(s, A)
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


'''

src = src.replace("PAGES = [\n    page01_cover", OVERRIDES + "PAGES = [\n    page01_cover")

# 小改：亮背景下补左压暗 + 换 P16 背景
src = src.replace(
    '    s.pic(A["seal_checked"], 9.55, 2.25, 1.15, 1.15, layer="L4", name="L4-已核印章")',
    '    s.pic(A["seal_checked"], 9.55, 2.25, 1.15, 1.15, layer="L4", name="L4-已核印章")\n    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")',
)
src = src.replace(
    '    s.pic(A["ink_splat"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-墨迹")',
    '    s.pic(A["ink_splat"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-墨迹")\n    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")',
)
src = src.replace(
    '    s.pic(A["seal_pass"], 10.55, 2.05, 1.0, 1.0, layer="L4", name="L4-合格印章")',
    '    s.pic(A["seal_pass"], 10.55, 2.05, 1.0, 1.0, layer="L4", name="L4-合格印章")\n    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")',
)
src = src.replace(
    '    s.pic(A["seal_checked"], 11.05, 2.05, 1.05, 1.05, layer="L4", name="L4-已核印章")',
    '    s.pic(A["seal_checked"], 11.05, 2.05, 1.05, 1.05, layer="L4", name="L4-已核印章")\n    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")',
)
src = src.replace(
    '    s.pic(A["seal_checked"], 10.95, 2.15, 0.95, 0.95, layer="L4", name="L4-已核印章")',
    '    s.pic(A["seal_checked"], 10.95, 2.15, 0.95, 0.95, layer="L4", name="L4-已核印章")\n    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")',
)
src = src.replace(
    '    s.text(9.0, 6.0, 3.2, 0.6, "还有名字没找到。", 12, (200, 120, 100), FONT_TITLE, spacing=2, align=PP_ALIGN.CENTER, name="L2-留白")',
    '    s.text(9.0, 6.0, 3.2, 0.6, "还有名字没找到。", 12, (200, 120, 100), FONT_TITLE, spacing=2, align=PP_ALIGN.CENTER, name="L2-留白")\n    s.pic(A["left_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-左压暗")',
)
src = src.replace(
    'common(s, A, 16, "创新与差异", "四件别人不容易抄的事", A["wallhole"], 44)',
    'common(s, A, 16, "创新与差异", "四件别人不容易抄的事", A["wounded"], 44)',
)

io.open(P, "w", encoding="utf8").write(src)
print("patched build_deck.py:", len(src), "bytes")
