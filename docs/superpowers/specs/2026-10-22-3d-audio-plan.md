# 2026-10-22 3D / 音频 / 文献 / 交付缺口 规划

> 约束：比赛截止 2026-10-23 23:59:59；仅剩约 2 天；8GB 显存笔记本；纯静态站点、离线可跑。
> 用户要求：每做一步先想「是否真的需要」；先规划再开多个 agent；GPU 不得同时跑两个任务。

## 一、3D 决策（重要）

**不做全项目 3D 化。** 理由：

1. 全 3D 意味着 App 外壳、卡片、按钮、相机、角色移动全部改成 Three.js 场景树，等于重写 UI 层；2 天内无法稳定。
2. 140 个场景、113,138 字正文的体验核心是阅读；全 3D 会把渲染预算花在非重点上，手机端直接崩。
3. 现有 2.5D 已实测 48fps，是真透视，继续作为默认。

**做 4 个「真 3D 场景切片」：**

| 切片 | 对应场景 | 表现 |
|---|---|---|
| warehouse-int | night1 点名、v2 若干内景 | 柱、沙袋、木箱、煤油灯、西墙破洞；相机受限 yaw/pitch |
| rooftop | night3 升旗、night3b | 女儿墙、竹竿旗杆、旗面顶点动画、探照灯扫过 |
| bridge | night5b 渡河 | 桥面、铁栏、河面反光、雾 |
| office-1947 | 序卷/尾声造册 | 厢房、桌、砚台、纸堆、窗棂、灯 |

- 技术：`three` + GLTFLoader（GS3D 资产可选，程序化几何兜底），独立 lazy chunk，主包不增大。
- 相机：指针驱动受限 yaw ±18° / pitch ±14°，阻尼 0.08；滚轮不改缩放（避免劫持页面滚动）。
- 回退：`WebGL` 不可用 / `prefers-reduced-motion` / 屏幕 < 700px → 只显示 2.5D；3D 是增强，不是必需。
- 性能预算：每切片 ≤ 6k 三角面、≤ 25 draw calls、DPR 上限 2；组件卸载必须 dispose（geometry/material/renderer）。
- Blender：仅在拿到 blender.exe 路径时，用无头 bpy 生成 hero GLB；拿不到就用程序化几何 + `public/art` 生成图做贴图。

## 二、音频（GPU 唯一任务）

目标：18—22 个音效/氛围循环，总大小 < 8 MB，OGG/WebM，可循环；无音乐版权问题（本地生成）。

候选小模型（agent 先核实显存与许可，再决定）：
- Stable Audio Open Small（约 341M，官方有小型版）— 首选
- AudioGen / AudioLDM2-small — 备选
- MusicGen-small（300M）— 仅在需要短氛围乐句时

产出：
- `public/audio/*.ogg|webm`（按 id 命名）
- `docs/audio/audio-manifest.json`：id / 用途 / 时长 / loop / 提示词 / seed / 模型 / 许可
- `docs/audio/README.md`：复现命令、显存峰值、失败记录
- 集成由 Lead 做（Web Audio：首次交互后解锁播放、静音开关、场景淡入淡出），agent 不改 `src/`。

**GPU 纪律（硬性）**：同一时刻只允许一个 python 进程占卡；启动前 `nvidia-smi` 无 compute 进程；每次生成写 `tools/audio/QUEUE.md`；不运行 `tools/imagegen/gen.py`。

## 三、文献 JSON（交给搜索 AI）

产出 `docs/research/文献检索请求-2026-10-22.json`：把 7 张待核对 + 6 张待接入，加上新增需求（谢晋元日记、孤军营升旗细节、1947 造册原件、杨惠敏送旗说法、四行仓库结构、英名墙 354 名单等）写成结构化请求：

```json
{
  "id": "req-01",
  "topic": "谢晋元日记中孤军营升旗的原始记载",
  "why": "补 v3-05/v3-11 的已核卡，目前只有转述",
  "priority": "P1",
  "preferred_sources": ["人民网党史频道", "新华网", "上海地方志", "中华书局/团结出版社"],
  "acceptable": "权威媒体转述亦可，但必须给出可定位的原文片段",
  "deliverable": {"quote": "原文≤120字", "locator": "书名/章节/页码或 URL+日期", "work": "", "author": "", "year": 0}
}
```

同时给一份人读的 `docs/research/文献检索请求-2026-10-22.md`（一页说明 + 输出格式 + 禁止编造）。

## 四、交付缺口审计

产出 `docs/deliverables/成果状态.md`：逐项列出 14 项提交材料 + 内部产物状态（✅/🔄/⏳/❌）、缺什么、谁做、下一步。
同时处理：`作品介绍.pdf` 被占用问题（重试替换）、PDF 是否最新、截图数量、dist、git 状态。

## 五、Agent 编制与写权限

| Agent | 职责 | 写权限 | GPU |
|---|---|---|---|
| threejs-slice | 4 个 3D 切片原型 + 性能测量 + 组件 | `src/game/components/Scene3D.tsx`、`src/game/content/scene3d.ts`、`tools/3d/` | 不用 |
| audio-owner | 模型选型/下载/生成/质检/清单 | `tools/audio/`、`public/audio/`、`docs/audio/`、`D:/AI大模型/audio/` | **唯一 owner** |
| literature-scout | 文献检索请求 JSON + MD | `docs/research/` | 不用 |
| delivery-auditor | 成果状态 dashboard + PDF/截图/清单核对 | `docs/deliverables/成果状态.md`、`docs/deliverables/*.pdf` | 不用 |

Lead：规划、集成 App、把 3D/音频接入、最终构建与测试、push。

## 六、时间表（到 10-22 晚）

| 时间 | 事项 |
|---|---|
| 现在—+40min | 4 个 agent 出 v0（3D 原型可看、音频模型选定、文献 JSON v0、状态 dashboard v0） |
| +40—+120min | 3D 接入 App + 音频 18 条生成 + 文献 JSON 定稿 + 缺口修复 |
| +120—+180min | 构建/回归/性能/截图，更新文档 |
| +180—+240min | 评审视频与打包等其他缺口，push |
