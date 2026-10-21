import io

# ---- deck_lib: 更暗的终端纹理 + 顶部压暗 + 标题字距默认收紧 ----
P = "tools/ppt/deck_lib.py"
s = io.open(P, encoding="utf8").read()
s = s.replace('d.text((x, y), txt, font=font, fill=(70, 68, 62))', 'd.text((x, y), txt, font=font, fill=(46, 44, 40))')
s = s.replace('d.text((x, y), "> " + " ".join(str(rng.choice(tokens)) for _ in range(3)), font=font, fill=(150, 138, 116))',
              'd.text((x, y), "> " + " ".join(str(rng.choice(tokens)) for _ in range(3)), font=font, fill=(112, 102, 88))')
s = s.replace('def headline(self, text, x=0.85, y=0.92, size=44, w=11.6, color=None, spacing=3.0):',
              'def headline(self, text, x=0.85, y=0.92, size=44, w=11.6, color=None, spacing=2.0):')
s = s.replace('# ------------------------------------------------------------------ 版式/图层引擎',
'''def top_scrim(out_name="L4-top-scrim.png", fade=0.52, peak=205):
    y = np.linspace(0, 1, SH)[:, None, None]
    a = peak * np.clip(1 - y / fade, 0, 1) ** 0.9
    arr = np.zeros((SH, SW, 4), dtype=np.uint8)
    arr[..., 0:3] = (10, 8, 6)
    arr[..., 3] = np.clip(a, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr, "RGBA")
    img.save(os.path.join(GEN_DIR, out_name))
    return os.path.join(GEN_DIR, out_name)


# ------------------------------------------------------------------ 版式/图层引擎''')
io.open(P, "w", encoding="utf8").write(s)

# ---- build_deck: 注册 top_scrim，P13/P14/P15 使用 ----
P2 = "tools/ppt/build_deck.py"
b = io.open(P2, encoding="utf8").read()
b = b.replace('    A["left_scrim"] = L.left_scrim(fade=0.52, peak=148)',
              '    A["left_scrim"] = L.left_scrim(fade=0.52, peak=148)\n    A["top_scrim"] = L.top_scrim()')
# P13 在 seal 前加顶部压暗
b = b.replace('    _left_scrim(s, A)\n    s.pic(A["seal_number"], 11.55, 1.72, 0.9, 0.9, layer="L4", name="L4-编号印章")\n    s.finish()',
              '    _left_scrim(s, A)\n    s.pic(A["top_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-顶压暗")\n    s.pic(A["seal_number"], 11.55, 1.72, 0.9, 0.9, layer="L4", name="L4-编号印章")\n    s.finish()')
# P14 顶压暗
b = b.replace('    _left_scrim(s, A)\n    s.pic(A["seal_checked"], 11.45, 1.72, 0.9, 0.9, layer="L4", name="L4-已核印章")\n    s.finish()',
              '    _left_scrim(s, A)\n    s.pic(A["top_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-顶压暗")\n    s.pic(A["seal_checked"], 11.45, 1.72, 0.9, 0.9, layer="L4", name="L4-已核印章")\n    s.finish()')
# P15 顶压暗
b = b.replace('    s.pic(A["seal_pass"], 12.1, 5.9, 0.9, 0.9, layer="L4", name="L4-通过印章")\n    s.finish()',
              '    s.pic(A["seal_pass"], 12.1, 5.9, 0.9, 0.9, layer="L4", name="L4-通过印章")\n    s.pic(A["top_scrim"], 0, 0, PAGE_W, PAGE_H, layer="L4", name="L4-顶压暗")\n    s.finish()')
io.open(P2, "w", encoding="utf8").write(b)
print("patched top scrim + terminal dim + spacing")
