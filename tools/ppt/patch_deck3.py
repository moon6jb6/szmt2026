import io

P = "tools/ppt/build_deck.py"
src = io.open(P, encoding="utf8").read()

# 修 P13/P14 图层顺序：框和文字同放 L2，避免 L3 框盖住 L2 文字
src = src.replace(
    's.rect(x, 3.15, 2.55, 1.75, fill=(38, 32, 26), line=(150, 122, 84), line_w=1.0, layer="L3", name="L3-架构框")',
    's.rect(x, 3.15, 2.55, 1.75, fill=(38, 32, 26), line=(150, 122, 84), line_w=1.0, layer="L2", name="L2-架构框")',
)
src = src.replace(
    's.rect(x - 0.05, y0, 1.86, 1.92, fill=(38, 32, 26), line=(150, 122, 84), line_w=0.8, layer="L3", name="L3-阶段框")',
    's.rect(x - 0.05, y0, 1.86, 1.92, fill=(38, 32, 26), line=(150, 122, 84), line_w=0.8, layer="L2", name="L2-阶段框")',
)

# P17 右侧说明移到空缺处
src = src.replace(
    's.text(9.0, 6.0, 3.2, 0.6, "还有名字没找到。", 12, (200, 120, 100), FONT_TITLE, spacing=2, align=PP_ALIGN.CENTER, name="L2-留白")',
    's.text(8.3, 6.72, 4.3, 0.4, "还有名字没找到。", 12, (222, 110, 88), FONT_TITLE, spacing=2, align=PP_ALIGN.CENTER, name="L2-留白")',
)
io.open(P, "w", encoding="utf8").write(src)
print("patched layer order")
