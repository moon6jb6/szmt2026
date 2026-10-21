import glob
import io
import os
import shutil

from PIL import Image, ImageEnhance

OBJ = "docs/deliverables/ppt-assets/objects"
# 1) 把抠好的 *-raw.png 复制成 obj-x.png（生成脚本输出命名问题）
for f in glob.glob(os.path.join(OBJ, "obj-*-raw.png")):
    base = os.path.basename(f).replace("-raw.png", ".png")
    dst = os.path.join(OBJ, base)
    shutil.copyfile(f, dst)
    print("alias", base)

# 2) 提亮
for f in glob.glob(os.path.join(OBJ, "obj-*.png")):
    if f.endswith("-raw.png"):
        continue
    im = Image.open(f).convert("RGBA")
    rgb = ImageEnhance.Brightness(im.convert("RGB")).enhance(1.22)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.04)
    rgb = ImageEnhance.Color(rgb).enhance(1.06)
    out = rgb.convert("RGBA")
    out.putalpha(im.split()[3])
    out.save(f)

# 3) P2 忘记 finish()
P = "tools/ppt/build_deck.py"
s = io.open(P, encoding="utf8").read()
s = s.replace('    s.text(10.5, 4.9, 2.0, 0.3, "moon6jb6.github.io/szmt2026", 8.5, (120, 105, 82), align=PP_ALIGN.CENTER, name="L2-网址")\n    s.footer(2, dark=False)',
              '    s.text(10.5, 4.9, 2.0, 0.3, "moon6jb6.github.io/szmt2026", 8.5, (120, 105, 82), align=PP_ALIGN.CENTER, name="L2-网址")\n    s.footer(2, dark=False)\n    s.finish()')

# 4) P13 架构图整体归入 L3（框 + 框内文字）
s = s.replace('s.rect(x, 3.15, 2.55, 1.75, fill=(38, 32, 26), line=(150, 122, 84), line_w=1.0, layer="L2", name="L2-架构框")',
              's.rect(x, 3.15, 2.55, 1.75, fill=(38, 32, 26), line=(150, 122, 84), line_w=1.0, layer="L3", name="L3-架构框")')
s = s.replace('s.text(x + 0.18, 3.3, 2.2, 0.32, f"0{i+1}  {title}", 13, RED_BRIGHT if i in (0, 3) else PAPER, FONT_TITLE, spacing=1.5, name="L2-框标题")',
              's.text(x + 0.18, 3.3, 2.2, 0.32, f"0{i+1}  {title}", 13, RED_BRIGHT if i in (0, 3) else PAPER, FONT_TITLE, spacing=1.5, layer="L3", name="L3-框标题")')
s = s.replace('s.text(x + 0.18, 3.72, 2.2, 1.0, sub, 9.5, (224, 212, 192), line_spacing=1.2, name="L2-框说明")',
              's.text(x + 0.18, 3.72, 2.2, 1.0, sub, 9.5, (224, 212, 192), line_spacing=1.2, layer="L3", name="L3-框说明")')
io.open(P, "w", encoding="utf8").write(s)
print("patched objects + page02 + page13 layers")
