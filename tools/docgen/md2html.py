#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 docs/deliverables 下的 Markdown 转成打印用 HTML。

用法：
    python md2html.py                 # 转换 deliverables 下全部 .md
    python md2html.py a.md b.md       # 只转指定文件
"""
import os
import re
import sys
import markdown

BASE = os.path.dirname(os.path.abspath(__file__))
DELIV = os.path.abspath(os.path.join(BASE, "..", "..", "docs", "deliverables"))

PRINT_CSS = """
@page { size: A4; margin: 20mm 17mm 18mm 17mm; }
* { box-sizing: border-box; }
body {
  font-family: "Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 10.5pt; line-height: 1.8; color: #1b1b1b; margin: 0;
}
h1 {
  font-family: "Source Han Serif SC", "Noto Serif SC", "SimSun", serif;
  font-size: 22pt; line-height: 1.35; margin: 0 0 6mm; color: #16130f;
  border-bottom: 2px solid #a32b2b; padding-bottom: 3mm; letter-spacing: 0.04em;
}
h2 {
  font-family: "Source Han Serif SC", "Noto Serif SC", "SimSun", serif;
  font-size: 15pt; margin: 7mm 0 2.5mm; color: #8a2b22; letter-spacing: 0.03em;
  page-break-after: avoid;
}
h3 { font-size: 12pt; margin: 5mm 0 2mm; color: #2a2a2a; page-break-after: avoid; }
p { margin: 0 0 3.2mm; text-align: justify; text-justify: inter-ideograph; }
ul, ol { margin: 0 0 3.5mm; padding-left: 7mm; }
li { margin-bottom: 1.2mm; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0 4mm; font-size: 9.5pt; }
th, td { border: 1px solid #cfc7b8; padding: 2mm 2.5mm; vertical-align: top; text-align: left; }
th { background: #f3eee4; font-weight: 600; }
blockquote {
  margin: 3mm 0; padding: 2.5mm 4mm; border-left: 3px solid #a32b2b;
  background: #faf7f1; color: #3a3a3a;
}
blockquote p:last-child { margin-bottom: 0; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f2f0ea; padding: 0.4mm 1.2mm; }
pre { background: #f6f4ee; border: 1px solid #e2dccf; padding: 3mm; overflow-x: auto; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
hr { border: none; border-top: 1px solid #d8d0c1; margin: 6mm 0; }
strong { font-weight: 700; }
a { color: #8a2b22; text-decoration: none; }
.sheet { max-width: 100%; }
.doc-meta {
  font-size: 9pt; color: #6b6358; letter-spacing: 0.06em;
  margin: 0 0 8mm; padding-bottom: 2mm; border-bottom: 1px solid #e2dccf;
}
"""

TEMPLATE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{title}</title>
<style>{css}</style>
</head><body><div class="sheet">
{meta}
{body}
</div></body></html>
"""


def convert(md_path: str) -> str:
    with open(md_path, "r", encoding="utf-8") as fh:
        text = fh.read()

    html = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        output_format="html5",
    )

    # 第一个 h1 作为标题
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    title = re.sub(r"<[^>]+>", "", match.group(1)) if match else os.path.splitext(os.path.basename(md_path))[0]

    meta = (
        f'<div class="doc-meta">2026 年第十四届全国大学生数字媒体科技作品及创意竞赛'
        f' · 红色之旅 追梦铸魂 · 《把名字留下来》</div>'
    )

    out_path = os.path.splitext(md_path)[0] + ".html"
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(TEMPLATE.format(title=title, css=PRINT_CSS, meta=meta, body=html))
    print(f"[html] {os.path.basename(out_path)}")
    return out_path


def main() -> int:
    targets = sys.argv[1:]
    if not targets:
        targets = [
            os.path.join(DELIV, name)
            for name in sorted(os.listdir(DELIV))
            if name.endswith(".md")
        ]
    if not targets:
        print("[warn] 没有找到 Markdown 文件")
        return 1
    for path in targets:
        convert(os.path.abspath(path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
