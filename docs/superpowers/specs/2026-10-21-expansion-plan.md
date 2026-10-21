# 《把名字留下来》扩写总规划 v1.0

> 目标时间：2026-10-21 06:00 前「差不多」。当前 00:50。
> 硬指标：**正文 ≥ 100,000 汉字**、**生成图约 500 张（每张过质检）**、**每段有具体细节、每个画面过审**。
> 角色：Lead（我）= 架构 + 集成 + 终审；写作、美术、审计全部由独立 agent 分区完成。

---

## 0. 一条必须先说清的冲突

旧要求「整体游玩 1—2 小时」与「10 万字」在物理上冲突：10 万字按 300 字/分钟要读 5.5 小时。
**处理方式**：

- **主线单周目 ≈ 2—2.5 小时**（约 4.5—5 万字，含五夜与结局）；
- **全内容 10 万字以上**：支线、人物志、档案、孤军营卷、六个结局扩写、史料卡正文；
- 作品介绍里分别写「单周目 2—2.5 小时 / 全集约 5—6 小时」，不再虚报。

---

## 1. 内容体量分配（目标 110,000 字，留 10% 余量）

| 卷 | 内容 | 场景数 | 抉择 | 目标字数 | 负责人 | 文件 |
|---|---|---|---|---|---|---|
| 序卷 | 1947 冬 · 造册前夜；陈望生其人 | 8 | 16 | 8,000 | writer-a | `volume0.ts` |
| 卷一 | 1937.8—10 · 通城整编、开拔、初到上海 | 25 | 70 | 22,000 | writer-a | `volume1.ts` |
| 卷二 | 1937.10.26—31 · 四行五夜（含夜后） | 45 | 130 | 38,000 | writer-b | `volume2.ts` + 扩写 `chapter1.ts` |
| 卷三 | 1937.11—1941.4 · 孤军营四年 | 25 | 70 | 20,000 | writer-c | `volume3.ts` |
| 卷四 | 1941—2025 · 造册、寻访、八十七人、英名墙、六结局 | 15 | 40 | 12,000 | writer-c | `volume4.ts` |
| 支线 | 人物志：杨瑞符、杨惠敏、陈树生、记者、同乡会、通城兵群像 | 10 | 0 | 10,000 | writer-d | `volume5.ts` |
| **合计** | | **128** | **326** | **110,000** | | |

六个结局每篇从约 800 字扩到 **2,000—2,500 字**，计入卷四。

---

## 2. 叙事圣经（所有写作者的共同约束）

### 2.1 一句话

一个通城的年轻文书，在四行仓库的五天里和之后的四十年里，反复面对同一个问题：**名字只能留下一样东西，你留哪样。**

### 2.2 声音

- 第三人称限知，贴着陈望生的感官写。不写全知评论，不写「历史告诉我们」。
- 句子偏短。一段只做一件事：一个动作、一个物件、一个声音。
- 数字必须具体：几个人、几发炮弹、几点钟、几步路。
- 情绪靠物件和动作承载，不直接命名情绪（不写「他很悲伤」）。

### 2.3 意象系统（贯穿全书，反复变奏）

名册与墨 / 苏州河与雾 / 雪 / 灯 / 旗与竹竿 / 鞋底的纸 / 报纸与铅字 / 空椅子。

### 2.4 每段合格线（写作时自查）

1. 有至少一个**可触的具体物**（纸的脆、血的锈味、竹竿的毛刺、干粮的硬）。
2. 有至少一个**具体动作**，不是心理概述。
3. **没有一句 AI 套话**（见禁用清单）。
4. 若涉及史实数字，必须能对应到 `sources.auto.ts` 里某张卡。
5. 读完这段，读者能说出「刚才发生了什么」。

### 2.5 禁用清单（审计直接扣分）

**01:55 裁决（硬线）**：
- 正文与**抉择结果**一律第三人称限知（陈望生 / 他），**禁止第二人称「你」**；选项 label 保留祈使句，不算叙述人称。
- 已在 chapter1 night2—night5b 与 endings.ts 中的第二人称，由 writer-b / writer-c 在扩写时一并转换。
- **真实人物禁止直接引语**：只写动作与 sources.auto.ts 里已核 excerpt 的引文（加引号并注明出处），不得自编台词。
- **正文不写敌我伤亡数字**：数字只留在史料卡原文里，正文用动作与场面替代。
- **禁止解释性旁白**：删掉「后来他才知道」「这一幕深深印在他心里」这类替读者总结的句子。
- **三处声音样板**（auditor-literary r0 认定，全书向此看齐）：
  1. night1b 改名字：「这个字错了。是"发"，不是"法"。」
  2. night4 铅笔：「他握着一支铅笔。铅笔很轻。可他举不起来。」
  3. night5b 鞋底：「纸页硌着脚心。他走得很慢，像怕踩着谁。」
- **新增禁用**：三连排比（「是租界，是缴械，是不知道多久的软禁」）、一切第二人称叙述、一切解释性旁白。

- 「仿佛」「似乎」「不禁」「渐渐地」「在这个……的时代」「让我们」「值得注意的是」「总而言之」
- 三连排比、空洞排比（「是……是……是……」堆形容词）
- 情绪直呼（「他悲痛欲绝」「无比震撼」）
- 解释性旁白（「这一幕深深印在了他的心里」）
- 大词（「伟大」「壮烈」「可歌可泣」）直接形容我方，除非是引文

### 2.6 史实红线

- 真实人物（谢晋元、杨瑞符、杨惠敏、陈树生、周福其）**不虚构台词**；引文必须来自 `sources.auto.ts` 已核卡片。
- 虚构人物（陈望生及通城兵群像）可写，但首次出场标注「复合型虚构角色」。
- 不写暴行细节、不写杀敌计数、不做「失败=更多人死」的奖惩。
- 每个场景结尾挂 `sources: ['s-xxx', 'auto-x-xx']`，只挂已核对卡。

---

## 3. 技术约定（写作者必须遵守）

- 场景类型见 `src/game/types.ts`：`Scene = { id, chapter, title, date?, location?, background, weather, paragraphs, choices?, aside?, sources? }`。
- 每个文件 `export const VOLUME_X: Scene[] = [...]`；id 用 `v0-01`、`v2-13`、`v3-07` 这类稳定命名。
- `next` 指向下一场景 id，允许分支；结局场景 id 固定为 `ending_names/letters/flag/photo/testimony/message`。
- 新字段：`image?: string`（场景插画 id，对应 `public/art/<id>.jpg`）、`imageCaption?: string`。
- 写作者**只写自己的文件**，不改 `App.tsx` / `types.ts` / `engine.ts` / `sources*.ts`（Lead 负责集成）。
- 每个文件末尾自报字数（CI 会核）。

---

## 4. 审计体系（双轨、独立、可迭代）

### 4.1 审计员编制

| 审计 | 关注 | 工具/依据 | 通过线 |
|---|---|---|---|
| auditor-fact（史实与逻辑） | 每条史实是否有 `sources.auto.ts` 依据；时间线、番号、人数是否一致；红线是否触碰 | 56 条回填数据 + 3 条已逐字核对的引文 | 事实错误 = 0；时间线冲突 = 0；未挂源史实 ≤ 0 |
| auditor-literary（文学与灵魂） | 是否「每一段有灵魂」：具体物/动作、无套话、节奏、意象、结尾力度 | 本文件 §2.4 §2.5 + `humanize-chinese` 的 AI 味检测 | 5 维 0—5 分，均分 ≥ 4.0 且无单项 < 3 |

### 4.2 迭代流程

```
writer 交稿 → Lead 技术校验（TS 编译 + 字数）→ auditor-fact → auditor-literary
   ↑                                                        │
   └────────────── 修改清单（逐条编号，必须逐条回应）←────────┘
```
同一文件最多 3 轮；3 轮仍不合格，Lead 接管该文件重写。

### 4.3 审计产出格式

`docs/audit/<file>-audit-r<N>.md`：总分、逐场景问题（场景 id + 原句 + 问题类型 + 修改建议 + 严重度 P0/P1/P2）。

---

## 5. 图片体系（500 张）

### 5.1 分类与数量

| 类别 | 数量 | 用途 | 尺寸 |
|---|---|---|---|
| 场景插画 `scene-*` | 128 | 每个场景一张 16:9 横幅 | 1024×576 |
| 关键瞬间 `moment-*` | 100 | 抉择点/催泪点插图 | 1024×576 |
| 文物档案 `artifact-*` | 80 | 名册页、家书、报纸、军服、旗帜、照片 | 1024×576 |
| 人物剪影 `figure-*` | 60 | 背影/剪影，不出现清晰面孔 | 768×1024 |
| 结局插画 `ending-*` | 30 | 六结局 × 5 变体 | 1024×576 |
| 界面与纹理 `ui-*` | 60 | 纸纹、墨迹、印章、地图、分隔 | 1024×1024 |
| 氛围空镜 `atmo-*` | 42 | 雨、雪、烟、河、灯 | 1024×576 |
| **合计** | **500** | | |

### 5.2 命名与落盘

`public/art/<类别>-<三位序号>.jpg`；同名 `.json` 记录 prompt / seed / 参数 / 耗时 / VLM 评分。
`docs/art/image-manifest.json` 由 art-director 生成，image-runner 只按 manifest 执行。

### 5.3 视觉圣经

- 色板：旗红 `#A32B2B`、铁锈 `#7A3E2E`、沙金 `#C8A063`、烟黑 `#16130F`、纸白 `#EDE6D8`
- 统一尾缀：`cinematic film still, 1937 China, muted desaturated palette, volumetric haze, painterly realism, no people, no faces, no text, no Chinese characters, no watermark, no modern elements`
- 绝对禁止：现代高楼/摩天轮/霓虹/汽车/英文字母/旗帜图案错误（如星条旗）/清晰人脸
- 人物一律剪影或背影；文物一律平铺俯拍；报纸一律虚焦处理

### 5.4 图片质检（每张都过）

1. **VLM 自动初筛**（本地 Qwen3-VL-2B，8GB 显存内）：
   - prompt 符合度、时代准确性、画面瑕疵、是否有人脸/文字/现代物；
   - 输出 JSON 评分（0—5 四维）+ 判定 `pass / retry / reject`。
2. **人工抽查**（art-director）：每 50 张抽 10 张；重点看「有没有灵魂」——是否只是空镜、是否有具体叙事信息。
3. `retry` 换 seed 重生成，最多 2 次；`reject` 记录原因并换 prompt 重来。
4. 产出 `docs/art/image-qa-report.md`：通过率、重生成率、失败类型分布。

---

## 6. Agent 编制与写权限

| Agent | 角色 | 写权限（只允许这些路径） |
|---|---|---|
| Lead（我） | 架构、集成、类型、构建、终审 | `src/App.tsx`、`src/game/types.ts`、`src/game/engine.ts`、`src/game/content/registry.ts`、`src/styles.css`、`docs/` |
| writer-a | 序卷 + 卷一（30k） | `src/game/content/volume0.ts`、`volume1.ts` |
| writer-b | 卷二（38k） | `src/game/content/volume2.ts`、`src/game/content/chapter1.ts` |
| writer-c | 卷三 + 卷四（32k） | `src/game/content/volume3.ts`、`volume4.ts` |
| writer-d | 支线人物志（10k） | `src/game/content/volume5.ts` |
| auditor-fact | 史实与逻辑审计 | `docs/audit/*-fact-*.md` |
| auditor-literary | 文学与灵魂审计 | `docs/audit/*-literary-*.md` |
| art-director | 500 张 manifest + 视觉圣经 + 人工抽查 | `docs/art/`、`tools/imagegen/manifest*` |
| image-runner | 唯一 GPU 所有者：生成 + VLM 质检 | `public/art/`、`tools/imagegen/out-art/`、`docs/art/image-qa-report.md` |

**GPU 纪律**：只有 image-runner 能碰显卡；启动前必须确认 `nvidia-smi` 为 0 MiB、无 python 进程；一次只跑一个进程；所有批次写进 `tools/imagegen/QUEUE.md`。

---

## 7. 时间表（到 06:00）

| 时间 | 事项 | 负责 |
|---|---|---|
| 00:50—01:10 | 规划、建任务板、写叙事圣经（本文件）、spawn 写作与美术 | Lead |
| 01:10—01:40 | writers 交卷首（1 场景样例）+ 卷纲；art-director 交 manifest v0（60 张先跑） | writers / art |
| 01:40—02:00 | 样例审计 + 统一声音；image-runner 启动第一批 60 张 | auditors / runner |
| 02:00—03:30 | 三大卷并行写作；GPU 持续出图（目标 300 张） | writers / runner |
| 03:30—04:10 | 第一轮双轨审计；writer 按清单修改 | auditors / writers |
| 04:10—05:00 | 第二轮审计 + Lead 集成（registry/App/类型）+ 构建 | all |
| 05:00—05:40 | 图片质检收尾、重生成、字数量化、回归测试 | runner / Lead |
| 05:40—06:00 | 终审报告：字数、图片数、审计结论、遗留问题 | Lead |

---

## 8. 集成方案（Lead 负责）

1. `types.ts`：`Scene` 增加 `image?`、`imageCaption?`；`SceneId` 放宽为 `string`（保留结局 id 常量）。
2. 新增 `src/game/content/registry.ts`：合并 `chapter1` + `volume0..5`，导出 `SCENES` 与 `getScene(id)`。
3. `App.tsx`：场景渲染增加 `<figure class="scene-image">`；场景页脚史料卡保留；`getScene` 改走 registry。
4. `styles.css`：`.scene-image` 样式（横幅、暗角、渐变遮罩）。
5. `tools/count-words.mjs`：统计 CJK 字数并按卷输出，CI 用。
6. `tools/check-volumes.mjs`：校验所有 `next` 指向存在、所有场景可达、史料卡 id 存在。

---

## 9. 风险与取舍

| 风险 | 应对 |
|---|---|
| 10 万字写不完 | 先保主线 45k + 结局 12k；支线与人物志按时间追加；06:00 报实际字数，不虚报 |
| 「灵魂」无法量化 | 用可操作代理指标：具体物/动作密度、套话零容忍、审计均分 ≥4.0；最终由你在早上验收 |
| 500 张图 GPU 时间不够 | 稳态约 20 s/张 → 500 张约 2.8 h；若超时，优先保场景 128 + 关键瞬间 100 + 结局 30，其余降级 |
| 多 agent 文件冲突 | 一人一文件，写权限表硬约束；Lead 只改集成文件 |
| 审计与写作互锁卡死 | 每轮审计 30 分钟内出结论；3 轮不合格 Lead 接管 |

---

## 11. 接线决议（01:25 定死，所有 writer 以此为准）

### 11.1 主线路由

```
v0-01 … v0-08（1947 造册前夜）
  → prologue（chapter1，参议员推纸）
  → prologue 三个 choice 的 next 全部改为 v1-01
  → v1-01 … v1-25（1937.8—10 通城整编→蒲圻/武昌→开拔→初到上海→10/26 深夜受命）
  → v1-25.next = night1
  → chapter1 五夜：nightN 的 choices.next → v2 对应段首
       night1 → v2-01…v2-09 → night1b
       night2 → v2-10…v2-18 → night2b
       night3 → v2-19…v2-27 → night3b
       night4 → v2-28…v2-36 → night4b
       night5 → v2-37…v2-45 → night5b
  → night5b 的 choices.next **改为 v3-01**（不再是 epilogue）
  → v3-01 … v3-25（孤军营 1937.11—1941.4）
  → v3-25.next = epilogue（chapter1，1947 造册）
  → epilogue 六选一 → ending_*（六结局）
  → 结局页后渲染「后来」：v4-01 … v4-15（读者页，不进状态机）
```

### 11.2 文件归属与改动授权

| 文件 | 归属 | 允许谁改 |
|---|---|---|
| volume0.ts / volume1.ts | writer-a | writer-a |
| volume2.ts / chapter1.ts | writer-b | writer-b |
| volume3.ts / volume4.ts / endings.ts | writer-c | writer-c（endings.ts 扩写授权已加） |
| volume5.ts | writer-d | writer-d |
| types/engine/registry/App/styles/sources* | Lead | 仅 Lead |
| registry.ts | Lead | 仅 Lead |

### 11.3 人称与结果页

- **全篇统一第三人称限知**：叙事与抉择结果都用「陈望生 / 他」，不再用「你」。
- writer-b 负责把 chapter1 现有结果页的「你」统一改成第三人称。
- writer-a/b/c/d 新写内容全部第三人称。

### 11.4 v4「后来」的定位

- v4 是**结局之后的读者页**（类似人物志），由 App 在结局页渲染，不经过 engine 状态机、不挂 choices。
- v4 时间线从 1949 之后开始（抗战胜利、1980 修县志、1991/2009/2013 寻访、2005 周福其、2015/2023 英名墙），**不重复 epilogue 的 1947 造册**。

### 11.5 待补的史料卡（Lead 负责，30 分钟内）

- `s-four-banks`：四行仓库为金城、大陆、盐业、中南四家银行储蓄会合建（出自新华网转载谢继民文，已人工核对）。
- 加好后 writer-a/b 都可挂它；在它加好之前，正文可先写该事实但不挂 source，等卡到位再补 id。

### 11.6 校验

每卷交付后 Lead 依次跑：`tsc -b`（构建）→ `node tools/count-words.mjs` → `node tools/check-volumes.mjs`，三条全绿才进入审计。


1. 正文 CJK ≥ 100,000（`tools/count-words.mjs` 可复现）。
2. 128+ 场景全部可达，`next` 无断链，六结局仍 6/6 PASS。
3. 双轨审计：史实 P0 错误 0；文学均分 ≥ 4.0 且无单项 < 3。
4. 图片 ≥ 400 张落盘，VLM 通过率 ≥ 85%，人工抽查无「现代物/人脸/文字」硬伤。
5. 构建通过，dist ≤ 25 MB（含图片），首屏 JS ≤ 400 KB gzip。
6. 交付一份 `docs/report/2026-10-21-build-report.md`：字数、图片、审计、回归、遗留问题，全部真实数字。
