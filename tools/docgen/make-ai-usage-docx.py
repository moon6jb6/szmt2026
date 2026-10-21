#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把《人工智能工具使用情况说明》生成为与赛事参考模板同结构的 DOCX。

用法：
    python tools/docgen/make-ai-usage-docx.py

读取 docs/deliverables/人工智能工具使用情况说明.md 里的事实口径，按模板 8 个部分输出：
  一、作品基本信息与 AI 使用状态（表）
  二、主要 AI 工具及使用情况（表）
  三、代表性 AI 使用过程（3 个环节，表）
  四、最终成果中的 AI 生成或辅助内容（表）
  五、学生原创贡献说明
  六、代表性过程材料（按需）
  七、资源来源与合规说明
  八、填写确认与提交提示
"""
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "deliverables" / "人工智能工具使用情况说明_460737.docx"

doc = Document()

# 中文字体
style = doc.styles["Normal"]
style.font.name = "SimSun"
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia", "SimSun"
)

INK = RGBColor(0x1A, 0x1A, 0x1A)


def heading(text, level=1):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(15 if level == 1 else 12)
    run.font.color.rgb = INK
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(6)
    return p


def body(text, bold=False, indent=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(10.5)
    run.font.color.rgb = INK
    if indent:
        p.paragraph_format.first_line_indent = Pt(21)
    p.paragraph_format.line_spacing = 1.35
    p.paragraph_format.space_after = Pt(4)
    return p


def bullet(text):
    p = doc.add_paragraph(text, style="List Bullet")
    for run in p.runs:
        run.font.size = Pt(10.5)
        run.font.name = "SimSun"
    p.paragraph_format.line_spacing = 1.3
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        run = p.add_run(h)
        run.bold = True
        run.font.size = Pt(10)
        run.font.name = "SimSun"
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            run = p.add_run(value)
            run.font.size = Pt(9.5)
            run.font.name = "SimSun"
            run.font.color.rgb = INK
            p.paragraph_format.line_spacing = 1.25
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Pt(w)
    doc.add_paragraph()
    return t


# ---------- 标题 ----------
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = title.add_run("2026年第十四届全国大学生数字媒体科技作品及创意竞赛")
r.bold = True
r.font.size = Pt(15)
r.font.name = "SimSun"
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run("人工智能工具使用情况说明")
r.bold = True
r.font.size = Pt(17)
r.font.name = "SimSun"
note = doc.add_paragraph()
note.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = note.add_run("（参赛团队按参考模板填写 · 作品编号 460737）")
r.font.size = Pt(10)
r.font.name = "SimSun"

body("作品名称：把名字留下来：四行仓库·苏州河北岸的四百余个名字", bold=True)
body("作品编号：460737", bold=True)
body("参赛赛道／赛项：本科及以上学历赛道 · 指定命题「红色之旅 追梦铸魂」（以报名系统为准）", bold=True)
body("AI 使用情况：☑ 已使用    □ 未使用", bold=True)
body("说明：按赛事匿名化要求，本文件不填写学校、团队成员和指导教师等可识别身份的信息；身份材料由报名系统另行管理。")

# ---------- 一 ----------
heading("一、作品基本信息与 AI 使用状态")
table(
    ["项目", "填写内容"],
    [
        ["作品名称", "把名字留下来：四行仓库·苏州河北岸的四百余个名字"],
        ["作品编号", "460737"],
        ["参赛赛道／赛项", "本科及以上学历赛道 · 指定命题「红色之旅 追梦铸魂」"],
        ["AI 使用情况", "☑ 已使用"],
    ],
    widths=[150, 430],
)
body(
    "本作品在正文创作辅助、插画生成、音效生成、代码与测试辅助、文档整理等环节使用了人工智能工具；"
    "选题、叙事结构、人物设定、结局机制、交互设计、史料取舍与最终验收由团队完成。"
    "全部 AI 生成或辅助生成内容均经过人工筛选、修改与核验，正文中的史实断言以可核查史料卡为准。"
)

# ---------- 二 ----------
heading("二、主要 AI 工具及使用情况")
body("仅填写对作品形成具有实际影响的主要工具或模型；一般性资料查询未列入。")
table(
    ["工具／模型", "使用环节", "AI 主要用途或产出", "学生后续处理"],
    [
        [
            "对话式大语言模型（DeepSeek 等，通过 AI 编程与写作工具调用）",
            "正文创作辅助、史实／文学审计辅助、代码开发、测试与文档",
            "分卷初稿与改写建议；审计报告初稿；React/TypeScript/three.js 代码与测试脚本；文档整理",
            "团队确定选题、结构、人物与结局机制；逐段删改重写；事实以史料卡核验；代码逐行审阅后集成；执行禁用词扫描与朗读审校",
        ],
        [
            "SDXL base 1.0 fp16 + SDXL-Lightning 4-step LoRA（本地部署，RTX 5070 Laptop 8GB）",
            "场景插画、结局插画、背景与素材生成",
            "500 条图片总谱，落盘 496 张；其中入屏 158 张逐张质检",
            "团队制定视觉圣经与分镜、写提示词与 seed；逐张 VLM 质检与人工抽查；重生成 8 张、剔除 4 张，对应场景改走渐变回退",
        ],
        [
            "Qwen3-VL-2B-Instruct（本地部署）",
            "生成图逐张质检",
            "四维打分（prompt 符合度／时代准确性／画面瑕疵／危险元素），输出 pass／retry／reject",
            "团队制定评分口径与红线；每 50 张人工抽 10 张复核；据此决定重生成或剔除",
        ],
        [
            "Stable Audio Open Small（497M，本地部署）",
            "环境音与交互音效生成",
            "28 条 OGG 音效（雨／雪／河水／脚步／旗面／人群低语／结局低音等）",
            "团队逐条写用途与质感描述、固定 seed；经典 DSP 后处理（EQ／响度归一／循环交叉淡化／48kHz）；逐条试听筛选",
        ],
        [
            "Blender 4.2.3（bpy 脚本由对话式大语言模型辅助编写，本地无头运行）",
            "四行仓库西墙 3D 资产",
            "4,732 三角面 / 469.6 KB GLB（窗洞、弹孔、沙袋、铁门）",
            "团队确定比例、破洞与弹孔的取舍；脚本人工审阅；渲染核对后接入 three.js",
        ],
    ],
    widths=[120, 110, 170, 180],
)

# ---------- 三 ----------
heading("三、代表性 AI 使用过程")
body("结合实际选择 3 个对最终成果影响较大的环节，说明「使用目的—主要输入—AI 输出—人工处理—最终应用」。")

heading("3.1 正文创作与双轨审计", level=2)
table(
    ["项目", "内容"],
    [
        ["使用环节及目的", "113,048 字正文的分区写作与修改；史实与文学双轨审计辅助"],
        ["主要工具／模型", "对话式大语言模型"],
        ["主要输入或素材来源", "团队编写的叙事圣经、分卷规划、人物设定；76 张史料卡（已核 63 张）；禁用词与红线清单"],
        ["AI 主要输出", "分卷初稿与扩写建议、审计意见初稿、可疑表述清单"],
        [
            "学生筛选、修改或再创作",
            "逐段删改与重写（删除解释性旁白、AI 套话与重复句式）；史实断言逐条回到卡片原文核对；"
            "运行禁用词量化扫描；由独立审计流程复评（史实 P0=0、文学加权 4.59）",
        ],
        ["最终成果中的应用位置", "正文 140 个场景、9 个结局、10 篇人物志、15 篇「后来」"],
        ["可核验材料", "docs/audit/ 双轨审计报告、字数统计脚本"],
    ],
    widths=[130, 450],
)

heading("3.2 场景插画生成与逐张质检", level=2)
table(
    ["项目", "内容"],
    [
        ["使用环节及目的", "为 124 个场景与 6 个结局配图，统一视觉语言"],
        ["主要工具／模型", "SDXL base 1.0 + SDXL-Lightning LoRA；Qwen3-VL-2B 质检"],
        [
            "主要输入或素材来源",
            "团队编写的视觉圣经、场景分镜、色板与红线（无现代物、无清晰人脸、无真实人物肖像）",
        ],
        ["AI 主要输出", "500 条图片总谱 → 496 张落盘；入屏 158 张"],
        [
            "学生筛选、修改或再创作",
            "逐条设计提示词与 seed 并多轮迭代；VLM 四维质检 pass/retry/reject；重生成 8 张、剔除 4 张；"
            "人工每 50 抽 10 复核；构图裁切与层级适配",
        ],
        ["最终成果中的应用位置", "public/art/ 496 张、public/bg/ 16 张分层背景；场景页与结局页"],
        ["可核验材料", "docs/art/image-manifest.json、image-qa-report.md、spot-check.md、批次参数 JSON"],
    ],
    widths=[130, 450],
)

heading("3.3 环境音生成与 Web Audio 接入", level=2)
table(
    ["项目", "内容"],
    [
        ["使用环节及目的", "28 条环境音与动作音，接入 42 个声音事件"],
        ["主要工具／模型", "Stable Audio Open Small（497M，本地）"],
        ["主要输入或素材来源", "每条音效的用途与质感文字描述、固定 seed、循环 22 秒要求"],
        ["AI 主要输出", "28 条 44.1kHz 原始音频"],
        [
            "学生筛选、修改或再创作",
            "逐条试听与频谱检查；DSP 做 EQ、响度归一、循环点交叉淡化、48kHz 重采样；八条环境床响度配平；"
            "Web Audio 总线、限流、淡入淡出与默认静音由团队实现",
        ],
        ["最终成果中的应用位置", "public/audio/ 28 条；src/game/audio.ts 的 42 个声音事件"],
        ["可核验材料", "docs/audio/audio-manifest.json、README.md、audit-loudness.json、verify-events.mjs"],
    ],
    widths=[130, 450],
)

# ---------- 四 ----------
heading("四、最终成果中的 AI 生成或辅助内容")
table(
    ["内容／成果", "AI 生成或辅助部分", "学生修改与整合", "最终使用位置"],
    [
        [
            "正文 113,048 字",
            "AI 用于初稿、扩写建议与审计辅助；成稿由团队逐段改写",
            "逐段删改重写、事实核验、禁用词清理；未逐句统计 AI 原句占比，不使用无法核实的百分比",
            "140 个场景、9 个结局、人物志与「后来」",
        ],
        [
            "插画 496 张、背景 16 张",
            "全部由本地 SDXL 生成（非手绘）",
            "提示词／seed 设计、VLM 质检、重生成、剔除、裁切与适配",
            "场景页、结局页、2.5D 分层背景",
        ],
        ["音效 28 条", "全部由本地音频模型生成", "试听筛选、DSP 后处理、映射到 42 个声音事件", "环境声、交互音、结局低音"],
        [
            "代码／交互组件",
            "AI 辅助编写 React、TypeScript、three.js 与测试脚本",
            "团队设计交互、架构与集成、逐行审阅、回归测试",
            "src/ 全部模块",
        ],
        [
            "四行仓库西墙 GLB",
            "AI 辅助编写 Blender bpy 建模脚本",
            "团队确定比例、破损取舍、渲染核对与接入",
            "v1-24 / v1-25 场景的 3D 视角",
        ],
        ["剧情树、测试、文档", "AI 辅助生成与整理", "团队核对数字、复跑测试、修订口径", "docs/report/、docs/deliverables/"],
    ],
    widths=[95, 135, 175, 110],
)

# ---------- 五 ----------
heading("五、学生原创贡献说明")
body("学生自主完成的核心工作：", bold=True)
for item in [
    "核心创意：以「一个识字的兵，每一夜只能带一样东西过苏州河」的记忆载体机制替代战斗叙事；9 个结局（6 主 + 3 合成）不排名、不按死亡人数评分，只回答「哪一种记忆被留下」。",
    "叙事与结构：序卷（1947 造册）→ 卷一（通城整编到上海）→ 四行五夜 → 孤军营 → 尾声九结局；140 个场景、113,048 字；人物志 10 篇、「后来」15 篇。",
    "史实工作：76 张史料卡（已核 63 张），真实人物零自编台词，未核史实不进正文；全部史实断言可回到卡片原句与出处。",
    "交互设计：结局交付手势（拖入匣子 + 按住 1 秒按手印）、第一夜灯下找名字、第三夜升旗拖拽、3D 场景「背景图 + 22 个热点」、长段落三段阅读与人物剪影、点击粒子与五种天气换幕。",
    "工程实现：纯前端静态站点（React + TypeScript + three.js），无后端、无外部字体／CDN，断网可跑，base:'./' 子目录可部署；键盘全流程、减少动效降级、对比度全 PASS。",
    "测试与验收：全流程 115 场景到结局、九结局 9/9、键盘／存档／图鉴／3D 泄漏 11/11、子目录部署与减少动效、无障碍对比度全部通过。",
]:
    bullet(item)
body("AI 与学生工作的边界：", bold=True)
for item in [
    "AI 不参与最终决策、不署名、不替代史料核对；AI 生成内容一律按实际情况披露，不表述为手绘或独立原创。",
    "正文中保留的 AI 辅助内容均经过团队逐段删改；图像与音效为 AI 生成素材，由团队完成筛选、后处理与整合。",
    "不使用 AI 生成真实人物肖像、不生成伤亡细节、不编造真实人物台词。",
]:
    bullet(item)
body(
    "可核查过程材料：git 提交记录、docs/audit/ 双轨审计报告、docs/art/image-manifest.json、"
    "docs/audio/audio-manifest.json、tools/metrics.mjs 数字基线、各测试脚本与 docs/deliverables/测试记录.md。"
)

# ---------- 六 ----------
heading("六、代表性过程材料（按需）")
body("以下材料可随参赛包提供，不含完整对话记录：")
for item in [
    "插画生成参数：docs/art/image-manifest.json（prompt、seed、尺寸、步数、耗时）+ 质检报告与人工抽查记录；",
    "音效生成参数：docs/audio/audio-manifest.json（prompt、seed、采样率、峰值显存）+ 响度审计 JSON；",
    "文本审计：史实／文学双轨审计报告、禁用词扫描结果、字数统计脚本输出；",
    "测试记录：全流程走路、九结局、键盘与无障碍、子目录部署与减少动效的脚本与结果。",
]:
    bullet(item)
body("涉及内部提示词与历史对话的部分仅保留能说明 AI 作用与学生贡献的必要片段，其余不提交。")

# ---------- 七 ----------
heading("七、资源来源与合规说明")
for item in [
    "图片与音视频素材：作品内插画、背景、音效均为本地 AI 生成素材，非第三方图库、非影视截图、非真实人物照片；生成工具与模型、生成环节、筛选修改情况及最终位置见本说明第二至四部分。人物的表现一律为剪影或背影，不出现清晰人脸。",
    "历史人物与史料：真实历史人物只以可公开查证的事实出现，不虚构台词；史料引自公开出版物与地方志，游戏内「史料库」逐条注明出处，正文只引用短句，不复制整页图像。",
    "第三方模型与开源库许可：SDXL base 1.0（CreativeML Open RAIL++-M）、SDXL-Lightning（随模型卡声明）、Qwen3-VL-2B-Instruct（Apache-2.0）、Stable Audio Open Small（Stability AI Community License，非商业学生竞赛使用）、three.js（MIT）、React／Vite／TypeScript（MIT／Apache-2.0）；完整清单见 docs/deliverables/第三方资源说明.md。",
    "字体与运行环境：仅使用系统字体，不内嵌外部字体；无外部 CDN 请求；断网可运行。",
    "AI 生成内容审核：所有 AI 生成图片经 VLM 四维质检与人工抽查，音效经逐条试听与频谱检查；不符合历史语境、出现现代物或清晰人脸、画面畸变的素材已剔除或重生成。",
]:
    bullet(item)

# ---------- 八 ----------
heading("八、填写确认与提交提示")
body(
    "团队确认：本说明真实反映 AI 工具使用情况、学生自主工作与最终成果状态；未虚构使用过程，"
    "未将 AI 或第三方成果表述为学生独立原创；真实性、原创性与知识产权承诺按本届统一《参赛承诺书》执行。"
)
body(
    "本说明作为材料清单 AI 使用补充材料，按第 6 项参赛打包文件的要求归档；"
    "匿名化要求已按赛事规定处理，不包含学校、成员与指导教师信息。"
)

# ---------- 附 ----------
heading("附：数据口径说明")
for item in [
    "正文严格字数 113,048（只统计玩家读到的正文段落，tools/count-words-strict.mjs 可复现）；",
    "场景 140、结局 9（6 主 + 3 合成）、史料卡 76（已核 63／待核 7／待接入 6）；",
    "插画 496 张落盘、入屏 158 张逐张 VLM 质检（初检 93.0%，重生成后 95.6% 可用）；",
    "音效 28 条 / 4.88 MB，声音事件 42 个；",
    "5 个真 3D 场景（西墙 GLB 4,732 三角面 / 469.6 KB + 4 个程序化切片）；",
    "以上数字与 docs/report/2026-10-22-afternoon-metrics.json 一致。",
]:
    bullet(item)

doc.save(OUT)
print(f"saved: {OUT} ({OUT.stat().st_size} bytes)")
