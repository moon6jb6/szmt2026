import io
import os
import glob

# 1) 压暗减弱
A = "tools/ppt/build_deck.py"
src = io.open(A, encoding="utf8").read()
src = src.replace('A["left_scrim"] = L.left_scrim()', 'A["left_scrim"] = L.left_scrim(fade=0.52, peak=148)')
# P16 背景改回 wallhole（wounded 太跳）
src = src.replace('common(s, A, 16, "创新与差异", "四件别人不容易抄的事", A["wounded"], 44)',
                  'common(s, A, 16, "创新与差异", "四件别人不容易抄的事", A["wallhole"], 44)')
# P14 框体更亮、字更亮
src = src.replace('s.rect(x - 0.05, y0, 1.86, 1.92, fill=(28, 24, 20), line=(132, 108, 76), line_w=0.7, layer="L3", name="L3-阶段框")',
                  's.rect(x - 0.05, y0, 1.86, 1.92, fill=(38, 32, 26), line=(150, 122, 84), line_w=0.8, layer="L3", name="L3-阶段框")')
src = src.replace('s.text(x + 0.1, y0 + 0.62, 1.65, 0.9, model, 10, (212, 200, 180), line_spacing=1.2, name="L2-模型名")',
                  's.text(x + 0.1, y0 + 0.62, 1.65, 0.9, model, 10.5, (228, 216, 196), line_spacing=1.2, name="L2-模型名")')
# P13 框体更亮
src = src.replace('s.rect(x, 3.15, 2.55, 1.75, fill=(30, 26, 22), line=(132, 108, 76), line_w=0.9, layer="L3", name="L3-架构框")',
                  's.rect(x, 3.15, 2.55, 1.75, fill=(38, 32, 26), line=(150, 122, 84), line_w=1.0, layer="L3", name="L3-架构框")')
src = src.replace('s.text(x + 0.18, 3.75, 2.2, 0.95, sub, 9, (200, 188, 168), line_spacing=1.2, name="L2-框说明")',
                  's.text(x + 0.18, 3.72, 2.2, 1.0, sub, 9.5, (224, 212, 192), line_spacing=1.2, name="L2-框说明")')
# P7 标注更大更亮
src = src.replace('s.text(11.25, yy, 1.85, 0.7, note, 10.5, (206, 194, 176), line_spacing=1.15, name="L2-标注")',
                  's.text(11.25, yy, 1.9, 0.8, note, 11.5, (224, 212, 192), line_spacing=1.18, name="L2-标注")')
io.open(A, "w", encoding="utf8").write(src)

# 2) 把 L3 物件整体提亮（原始 raw 在 D:\AI大模型\ppt-work\objects 有备份）
from PIL import Image, ImageEnhance

for f in glob.glob("docs/deliverables/ppt-assets/objects/obj-*.png"):
    if f.endswith("-raw.png"):
        continue
    try:
        im = Image.open(f).convert("RGBA")
        rgb = ImageEnhance.Brightness(im.convert("RGB")).enhance(1.22)
        rgb = ImageEnhance.Contrast(rgb).enhance(1.04)
        rgb = ImageEnhance.Color(rgb).enhance(1.06)
        out = rgb.convert("RGBA")
        out.putalpha(im.split()[3])
        out.save(f)
        print("lit", os.path.basename(f))
    except Exception as exc:
        print("skip", f, exc)
print("patched")
