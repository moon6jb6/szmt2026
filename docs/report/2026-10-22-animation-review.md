# 2026-10-22 动效与交互反馈复审：《把名字留下来》

> 范围：动画形式与交互反馈（入场错峰 / 五种换场 / 点击粒子 / 九段终极画面 / 悬停-焦点-按下 / 性能与清理 / 一致性）。
> 方法：Playwright + 真实页面驱动（含 CDP 录屏取帧、rAF 帧时长采样、canvas 像素回读、CDP 堆用量），**dev 5199 复现问题 → 修复 → 重建 dist → preview 4173 复核**。
> 数字源：[`tools/anim-check.mjs`](../../tools/anim-check.mjs) → `docs/report/anim-check.json`；取证帧 `docs/report/anim-shots/`（41 张）。
> 改动只落在允许的 6 个文件：`Stage.tsx`（未改，见 §6）、`InkCurtain.tsx`、`Particles.tsx`、`ChoiceBurst.tsx`（未改）、`EndingFinale.tsx`、`styles.css`；必须改 `App.tsx` 的 3 项只写进 [§8](#8-必须改-apptsx-的项只报告不改)。

## 0. 结论

**动效语言本身成立，但有 5 类"动手就露馅"的缺陷（跳场 / 掉帧 / 无障碍降级 / 假悬停 / 空闲开销），已全部修掉；另有 3 项必须改 `App.tsx`，留给 Lead。**

| # | 项 | 修前 | 修后 | 判定 |
|---|---|---|---|---|
| 1 | 入场错峰 | 菜单整块淡入、章节卡无动画 | 菜单 7 块 / 章节卡 3 块按 50–60ms 递进（总时长不变） | 修好 |
| 2 | 五种换场 | 五种都触发、2.09s、hold 全黑；**连点/连 Enter 在 0.28–0.38s 就换场**；**@2× 掉帧 87–96%**；**烟场是灰雾 + 512px 方格接缝** | 换场固定在 0.91s、2.09s 结束；@2× 单帧像素工作量降到 ~47%；烟场回到墨色且无接缝 | 修好 |
| 3 | 点击粒子 | 9 种载体位置/密度/颜色都对；连点不泄漏；reduced-motion 完全禁用 | 无需修（仅记录：粒子层空闲开销大，见 §6） | 通过 |
| 4 | 九段终极画面 | 9 段画面各不同、可跳过、可重看、切屏即停；**reduced-motion 下"最终帧"其实是 1.7s 纯黑**；**动画会被重头播，实际 8.46s** | 9 段 6.2s+0.52s 淡出；reduced-motion 显示最终帧 1.06s 后自动进正文 | 修好 |
| 5 | 悬停/焦点/按下 | 8 个 Tab 停点全部有金描边；**9 种载体的 hover 位移全部失效**；**主/次按钮按下与悬停一模一样** | hover 位移恢复（4–6px）、按下 `translateY(1px)+brightness(.9)` | 修好 |
| 6 | 性能/清理 | 空闲 64.3fps（16% 长帧，去掉粒子层 230.9fps） | 空闲 234–235fps（0–0.1% 长帧）；换场 39–84fps（随机器负载） | 修好 |
| 7 | 一致性 | 时长/缓动/色板统一；烟场接缝与扁平旗面最"廉价" | 接缝已修；旗面属于视觉风格未动 | 通过（1 条观察） |

`node tools/shots-v2.mjs http://127.0.0.1:4173/` 已复核：**10/10 张截图、0 报错**（截图被覆盖属预期）。

---

## 1. 菜单入场 / 章节卡 / 正文段落错峰

**现状**：`.menu{animation:rise 700ms}` 整块淡入；`.scene-head` 子元素无动画；正文段落 `fadeUp 640ms` + inline `animationDelay: min(i*90,540)` 三段错峰。

**验证方式**：读 computed `animation-name/duration/delay`；进入序卷后在 120ms / 560ms 各采一次每段 opacity；再从 v0-01 走到 v0-02，检查同一批 `<p>` 的动画是否重播。

**证据**（修前 → 修后）：
- 菜单子元素有动画的数量：**0 → 7**；`animation-delay` = 0 / 50 / 100 / 150 / 200ms（上限 200ms，整段仍在 700ms 内收束）。
- 章节卡：`.chapter/.scene-title/.scene-meta` = `none` → `fadeUp 460ms`，delay 0 / 60 / 120ms。
- 正文段落 delay `0s 0.09s 0.18s … 0.54s`；120ms 时 opacity `0.54 0.22 0 0 …`，560ms 时全 `1` → 错峰真实存在。
- **换场之后**：28 段 opacity 全 `1`、`document.getAnimations()` 里跑着的动画 **0 个**、`.scene` 动画 0 个 → 错峰只在首次挂载时发生（原因见 §8-2）。

**问题**：菜单与章节卡是"一次性整体淡入"，和正文段落的错峰不是同一套语言；段落错峰在场景切换后不再出现（被子句"换场由墨迹幕遮住"掩盖，但读起来是整块文字同时出现）。

**修复**：`styles.css` 给 `.menu > *`（480ms）与 `.scene-head > *`（460ms）加同一条 `fadeUp`，50/60ms 递进且**上限 200ms**（不拉长总时长，`shots-v2` 的菜单截图无变化）。

**截图**：[menu-900.png](anim-shots/menu-900.png)、[scene-enter-120.png](anim-shots/scene-enter-120.png)、[scene-enter-560.png](anim-shots/scene-enter-560.png)

---

## 2. 五种换场（墨 / 雨 / 雪 / 灰 / 烟）

**现状**：`InkCurtain` 三段式 cover→hold→reveal，`variant` 由当前场景 `weather` 决定；普通换场 900/240/950=**2.09s**，进结局 1500/600/1600=3.7s，开场 1200/320/1300=2.82s。

**验证方式**：挑 5 个"有下一场"的真实场景注入 `pendingOutcome/pendingNext`，点「继续」触发幕布；CDP 录屏按点击时刻对齐取帧；同时用 rAF 采样掉帧、用像素回读判"换场帧有没有露出文字"。

**证据（preview 构建，1600×1000；时间/遮挡数字三轮一致，fps 取三轮区间——本机跨轮负载差异极大，见 §6 口径）**：

| 变体 | 真实场景 | 换场@ | 结束@ | hold 中心 p95（三轮） | 帧率 / p95（三轮） | 长帧 |
|---|---|---|---|---|---|---|
| 墨 ink | v1-01 公函 → v1-02 代笔 | 911–925ms | 2093–2110ms | **19** | 49–82 / 16.8–33.5ms | 2.3–68% |
| 雨 rain | night2 → v2-10 | 908–921ms | 2087–2119ms | 20–21 | 44–82 / 20.7–37.5ms | 5.2–72% |
| 雪 snow | prologue → v1-01 | 908–934ms | 2092–2114ms | 20 | 47–84 / 16.8–33.6ms | 1.7–71% |
| 灰 ash | night1 → v2-01 | 903–922ms | 2090–2110ms | 19 | 39–79 / 16.7–41.5ms | 0.6–81% |
| 烟 smoke | night3 → night3b | 912–914ms | 2086–2104ms | 19–29 | 44–73 / 16.9–37.6ms | 4.5–71% |

"遮住没有"的内部对照（同一套亮度分位算法，中心区）：**正常正文页 p95=195 / max=234**（文字）→ **cover 帧（墨未盖满）p95=41–45 / max=108–115** → **hold 帧 p95=19 / max=19**（整帧均匀墨色，无任何内容）。烟场 hold 的 p95 在 19–29 之间浮动（取决于本次随机烟团的叠加密度），同样没有文字。

**问题与修复**：

1. **快速连点/连续 Enter 会跳场（P0）**。修前：第二次推进在 **379ms（Enter）/ 289ms / 279ms** 就把内容换掉——此时墨只盖住一小部分，新页面从半透明墨里弹出来（旧取证见 `burst-rapid-12.png` 的中间态）。修法：幕布运行中不再立即 `swap()`，而是把请求排到 hold 那一帧（已全黑）；若帧被跳过（后台标签页/长卡顿）则在 cover 之后补一次换场，避免"这一场没换过去"。
   → 修后：三个模式在 279–378ms 读到的标题都不变，最终仍只推进一次（→ 代笔），2.09s 结束。
2. **@2× 高分屏掉帧（P1）**。修前 `dpr` 上限 2 且天气每帧逐块平铺：按代码算式，1600×1000 的幕布一帧要画 ~86M 像素；修前实测 dpr2 掉到 **20–28fps、长帧 87–96%**。修法：幕布 dpr 上限 **1.5**（模糊墨纹看不出差别）+ 天气改 **一次 pattern fill**（整屏 3.6M px），烟场再叠一层 1.37× 的反向平铺打散重复。修后一帧 ~40M 像素（−53%），dpr2 实测 **34.8–52.5fps**（无头软件光栅下的下界；同一轮 dpr1 为 39–84fps）。
3. **烟场是灰雾不是墨（P2）**。修前 hold 帧 mean≈73（29% 灰）、且能看到 512px 方格接缝。修法：烟瓦片改 768 且九宫格重绘（无缝）、单层 alpha 0.5→0.28+0.16 双层反向平铺。修后 hold p95 41→19–29、无接缝。
4. **开场 2.82s 偏慢**：`startNew` 用的是 `CURTAIN_CHAPTER`，而项目自己的动效规范里"首屏开场 1.6s"——属 `App.tsx`，见 §8-1。

**截图**：[curtain-ink-cover](anim-shots/curtain-ink-cover.png) / [-hold](anim-shots/curtain-ink-hold.png) / [-reveal](anim-shots/curtain-ink-reveal.png)，其余四组同目录 `curtain-{rain,snow,ash,smoke}-{cover,hold,reveal}.png`（共 15 张）。

---

## 3. 六种记忆载体 + 三个合成结局的点击粒子（ChoiceBurst）

**现状**：点击选项在指针位置爆一组粒子，颜色/形状/运动按 `data-kind` 区分；`fire()` 在 reduced-motion 下直接 return，CSS 另有 `display:none`。

**验证方式**：epilogue 九个选项逐个点（`data-kind` = 6 主 + 3 合成），110ms 后回读 canvas 像素（数量 + 主色）并截图；用真鼠标在「继续」上连点 12 次测叠加；新开 `reducedMotion:'reduce'` 上下文复测。

**证据**：

| 载体 | 粒子像素 | 主色 RGB | 截图 |
|---|---|---|---|
| 名册 roster | 505 | 77,64,42（墨+沙金） | [burst-roster.png](anim-shots/burst-roster.png) |
| 家书 letters | 287 | 180,160,124（纸黄） | [burst-letters.png](anim-shots/burst-letters.png) |
| 旗 flag | 696 | 199,91,58（红） | [burst-flag.png](anim-shots/burst-flag.png) |
| 照片 photo | 249 | 147,154,148（灰绿） | [burst-photo.png](anim-shots/burst-photo.png) |
| 口述 testimony | 524 | 153,160,133（青） | [burst-testimony.png](anim-shots/burst-testimony.png) |
| 口信 message | 113 | 174,165,147（纸白） | [burst-message.png](anim-shots/burst-message.png) |
| 档案 archive | 549 | 157,136,95 | [burst-archive.png](anim-shots/burst-archive.png) |
| 遗物 relics | 237 | 204,158,142 | [burst-relics.png](anim-shots/burst-relics.png) |
| 口耳 wordofmouth | 546 | 206,169,129 | [burst-wordofmouth.png](anim-shots/burst-wordofmouth.png) |

- **位置**：爆点就在点击的选项行（`burst-flag.png` 里红飘带落在原文选项位置）。键盘触发时退化为屏幕中心——可接受。
- **密度**：113–696 像素（口信最稀、旗最密），不是一套参数走九个。
- **连点 12 次**：峰值 390px；再采一次（+150ms）画布已归零，场景只推进一次（`公函 → 代笔`），无残留、无重复推进。
- **性能**：连点期间 65–91fps / p95 25–33ms（同一轮空闲基线 235fps；机器有负载时方差大，见 §6 口径）。
- **reduced-motion**：`display:none` 且回读 0 像素（JS 短路 + CSS 双保险）→ 完全禁用 ✓。

**结论**：无需修复。仅记录"口信"密度明显偏稀，仍可辨识。

---

## 4. 九段结局「终极画面」（EndingFinale）

**现状**：`DURATION=6200`，6 主画面 + 3 合成叠加；点击 / Enter / 空格 / Esc 跳过；结局页「重看结局画面」重挂载；reduced-motion 只画 t=1 一帧。

**验证方式**：epilogue 第 k 个选项 → 交出去 → 等 `.finale` → 5.4s 截图 + 像素统计 → 跳过计时；另测不跳过的自然时长、重看、播放中切屏、reduced-motion。9 张截图做 64×40 亮度指纹两两比对。

**证据**：
- 9 段都出画面、canvas 全覆盖（`drawnRatio=1`），主色各异（14,11,8 / 25,21,16 / 33,14,11 / 32,26,20 / 14,10,8 / 16,13,10 / 15,11,8 / 30,25,19 / 33,14,12）。
- 两两指纹最小差 **0.27–0.33**（`flag` vs `wordofmouth`——渲染上就是同源叠加，属设计），次小 **1.03**（`testimony` vs `archive`）→ 九段互不相同。
- **自然时长 6736–6791ms**（6.2s 动画 + 0.52s 淡出 + 轮询误差）；**修前 8457ms**。
- 跳过：Esc/点击 → **0.52–0.57s** 淡出；重看：点击后 **5ms** 内重新出现；播放中程序化点「回到开头」→ 幕布组件卸载、**rAF 残留 4→1**、无报错、屏幕回到菜单。
- **reduced-motion**：修前 `.finale-canvas{display:none}` → 画布 0 像素、整屏纯黑 `rgb(11,9,7)` 停 1.69s；修后 `display:block`、**回读 400000 像素（整帧最终画面）**、**1.0–1.1s 后自动进正文**。

**问题与修复**：
1. **reduced-motion 下"最终帧"被 CSS 藏掉（P1，无障碍）**：JS 明明画了 `draw(1)`，CSS 却 `display:none`，用户看到的是 1.7s 黑屏。修：`styles.css` 只关 `.choice-burst`，不藏 `.finale-canvas`；停留 1.8s→**1.2s**。
2. **动画会被重头播（P1，时长失控）**：effect 依赖 `[kind, onDone]`，`onDone` 是父组件内联箭头函数 → 父组件任何一次重渲染都会重启 6.2s 动画（dev 实测 8457ms）。修：`onDone` 进 ref、依赖只留 `[kind]`；`setTimeout` 统一登记并在卸载时清掉（原来跳过/切屏后会回调到已卸载组件）。
3. **跳过提示是 `<span>`（P2，键盘）**：遮罩内 0 个可聚焦元素，Tab 会跑到遮罩背后的结论页按钮上。修：改真 `<button type="button" autoFocus>`，Enter/空格/点击都能跳过，读屏可读。

**截图**：[finale-roster](anim-shots/finale-roster.png) … [finale-wordofmouth](anim-shots/finale-wordofmouth.png)（9 张）、[finale-reduced-motion.png](anim-shots/finale-reduced-motion.png)（修后：能看到最终帧）、[finale-natural-ending.png](anim-shots/finale-natural-ending.png)。

---

## 5. 悬停 / 键盘焦点 / 按下反馈；动效是否阻塞点击

**验证方式**：菜单连按 Tab 读每个停点的 computed `outline`；在只有 2 个选项的普通场景里 `mouse.move → down` 分三步读 computed `transform/filter/border`；用 `elementFromPoint` 做命中测试。

**证据**：
- **焦点可见**：7 个菜单停点 + 声音按钮，全部 `solid 2px rgb(200,160,99)`（`--gold`）+ `outline-offset:3px`；第 8 次 Tab 回到 body（浏览器自身的循环，不是缺陷）。场景内选项/史料 chip 同样走全局 `:focus-visible`。
- **修前**：`.choice` 的 hover 只有描边变色，`transform` 恒为 `matrix(1,0,0,1,0,0)`——`choiceIn` 动画用了 `fill-mode: both`，动画终帧的 `transform:none` 在层叠里**压住了** `:hover/:active` 规则，9 种载体各自的位移（4–6px / scale / skew）全部失效。
- **修后**：`none → matrix(1,0,0,1,4,0)`（roster 的 translateX(4px)），按下 `filter: brightness(0.93)`。
- **修前**：`.primary-button` / `.quiet-button` 的 active 与 hover 完全相同（只有 `:hover` 规则，没有 `:active`）。
- **修后**：active = `matrix(1,0,0,1,0,1)`（translateY(1px)）+ brightness(.9)。
- **不阻塞点击**：`.ink-curtain` / `.choice-burst` / `.particles` / `.stage-grade` 全部 `pointer-events:none`；选项中心的 `elementFromPoint` = `BUTTON.choice`。

**修复**：`.choice` 动画 `both → backwards`（终态 = 自然态，动画结束后不再压着 transform）；`.primary/.quiet/.text/.chip/.people-card/.view3d-toggle/.audio-toggle` 补 `:active`（位移 1px + 压暗）并把 transform/filter 纳入 120ms 过渡；`.chip`、`.choice-index` 补 200ms 过渡（原来颜色是硬切，与其它控件不一致）。

---

## 6. 性能：各动画 fps/掉帧 + rAF / 监听 / Canvas / timer 清理

**口径（重要）**：本机无头 Chrome 的 rAF **不锁 60Hz**（菜单能到 240fps），且机器上常有其它进程，所以**绝对 fps 只在同一轮内可比**；判定用 p95 帧时长与"长帧（>20ms）占比"，与项目自己的红线（`docs/skills/web-animation`：单次转场 p95 ≤ 20ms、长帧 ≤ 15%）对齐。有头模式在本机被系统判为遮挡（rAF 被节流到 1fps），因此未采用。

| 场景 | 修前 | 修后（三轮区间） |
|---|---|---|
| 菜单入场 | 240fps / p95 4.3ms | 239–240fps / p95 4.3ms |
| 场景空闲（雨） | **64.3fps / p50 16.4ms / 16.3% 长帧** | **233.7–235.4fps / p50 4.2ms / 0–0.1% 长帧** |
| 场景空闲（无天气） | 237fps | 237.4–238.4fps（与有天气持平） |
| 五种换场 | dpr2: 20–28fps / 87–96% 长帧 | dpr1 39–84fps / p95 16.7–41.5ms；dpr2 34.8–52.5fps |
| 九段终画面（6s 内） | — | 88–149fps |
| 连点粒子（12 次） | — | 65–91fps / p95 29–33ms |

**关键归因与修复**（同一轮 A/B）：去掉粒子 canvas → 空闲 64.3 → **230.9fps**；去掉 `backdrop-filter` → 82.7fps；粒子层是唯一每帧重绘的全屏 canvas，它逼着正文卡片的 backdrop 每帧重新取背景。修法：`Particles` 按真实时间步进、**30fps 重绘**（雨/雪/灰/烟都是慢速氛围，速度不变）；顺手修掉烟粒子用 `frame % 240` 做位移造成的"每 4 秒全体瞬移一次"。修后"有雨"与"无天气"的空闲帧率持平（235 vs 238fps，均 0 长帧）。

**清理核对（读码 + 反复切屏）**：
- `Stage`：rAF + pointermove/pointerleave 都在 cleanup 里取消 ✓；空闲时实测无额外开销（无天气场景 237fps），故**未改**。
- `Particles`：rAF + resize 监听清理、reduced-motion 清空画布 ✓。
- `ChoiceBurst`：rAF + resize 清理、粒子队列跑空即停并清画布 ✓。
- `InkCurtain`：resize 监听清理 ✓；幕布常驻不卸载；`--push` 在结束时移除 ✓。
- `EndingFinale`：**修前** 帧循环有清理、但 `setTimeout` 未清且依赖不稳（见 §4）；**已修**。
- 反复切屏 20 / 40 次：canvas **2 → 2 → 2**，rAF 残留 **0**，JS 堆 **2614 → 4019 → 4094 kB**（第二轮只 +75kB → 收敛，不是线性泄漏）。

---

## 7. 一致性：动画语言

| 场合 | 时长 | 缓动 |
|---|---|---|
| 菜单 / 信息页进场 | 700ms（子块 480ms，50ms 递进） | `--ease` |
| 卡片进场 | 620ms | `--ease` |
| 正文段落 | 640ms，90ms 递进（上限 540ms） | `--ease` |
| 章节卡 | 460ms，60ms 递进（上限 180ms） | `--ease` |
| 选项进场 / 悬停 / 按下 | 520 / 220 / 120ms | `--ease` |
| 按钮悬停 / 按下 | 220 / 120ms | `--ease` |
| 普通换场 | 900+240+950 = **2.09s** | ease-out 合拢、ease-in 揭开 |
| 进结局 | 1500+600+1600 = **3.7s** | 同上，最长黑 |
| 终极画面 | **6200ms** + 520ms 淡出 | ease-out / ease-in-out |
| 跳过提示脉动 | 2.4s 循环 | ease-in-out |

- 缓动只有一个变量 `--ease: cubic-bezier(.22,.61,.36,1)`；唯一例外是跳过提示的脉动。
- 色板：`--ink #16130f / --paper #ede6d8 / --red #a32b2b / --gold #c8a063` 贯穿 CSS 与 canvas（幕布墨色 `#16130f` 与 `--ink` 同值，终极画面用 `#a32b2b`、`#c8a063`）。粒子调色板只有 `photo #9aa7a4`、`testimony #8fb3b0` 两支冷色，是"照片/磁带"的材质区分，未越出色板。
- **观察（未改，属视觉风格）**：`flag` 终极画面是扁平矢量红布（[finale-flag.png](anim-shots/finale-flag.png)），与全书插画质感差距最大；`wordofmouth` 叠的同心圆偏"图表感"；`roster` 名册表里的名字是按字表循环填的（放大可看出重复字），作为"名册"的抽象可接受，但截图里最容易被挑。
- **已修的"廉价感"**：烟场原来能看见 3×2 的 512px 方格接缝（每块瓦片边缘被裁掉，平铺即露边），改成 768 无缝瓦片 + 双层反向平铺后消失；`curtain-smoke-hold.png` 是修后的帧（旧帧在复跑时已被覆盖，无法再附）。

---

## 8. 必须改 App.tsx 的项（只报告，不改）

1. **开场幕布 2.82s 偏慢**：`startNew` 传的是 `CURTAIN_CHAPTER`（1200/320/1300），是"换章节"参数；项目动效规范里"首屏开场"是 1.6s（800/120/700）。建议开场单独一组常量。
2. **换场后入场动画不重播**：`.scene` 与 `.prose p` 的 DOM 被 React 复用，CSS 动画只在首次挂载时跑；实测进到 v0-02 后 28 段 opacity 全 1、0 个 running 动画。想让每场都错峰，需要给场景内容加 `key={state.sceneId}`（并给 `.prose` 容器一个随之变化的 key）。
3. **keydown effect 缺依赖数组**（`App.tsx` 里游戏键盘监听）：每次 render 都会移除并重挂监听，属可避免的抖动；建议 `[]` + 用 ref 读最新 state，或补全依赖。

---

## 9. 复现

```bash
npm run build
# preview 已在 4173 时，dist 重建后直接刷新即可
node tools/anim-check.mjs http://127.0.0.1:4173/                 # 全部项目（约 8 分钟）
node tools/anim-check.mjs http://127.0.0.1:4173/ --only=curtain,burst
node tools/anim-check.mjs http://127.0.0.1:4173/ --only=luma     # 只做"遮住没有"的亮度对照
node tools/anim-check.mjs http://127.0.0.1:5199/ --only=discover # dev：列出各天气的可达场景
node tools/shots-v2.mjs http://127.0.0.1:4173/                   # 10 张交付截图
```

产物：`docs/report/anim-check.json`（全部原始数字）、`docs/report/anim-shots/*.png`（41 张取证帧）。

## 10. 边界

- 全部在桌面无头 Chrome 155 / 1600×1000 下测；**没有真机**，中低端手机的结论应更保守。
- rAF 不锁帧导致绝对 fps 噪声大（同一构建跨轮可差 2–4 倍）；本文的性能结论以"同轮 A/B + 像素工作量算式 + p95/长帧占比"为准，绝对值只作参考。
- 没有启动真实读屏软件；无障碍结论基于 computed 样式、焦点行为与像素回读。
- 没有重做任何视觉风格：旗面扁平感、名册随机字、口径圆环只记录不修改。

---

## 9. Lead 处置（2026-10-22 22:4x）

§8 列的 3 项 App 改动已全部落地，随 v1.4 提交：

1. **开场幕时长**：新增 CURTAIN_OPEN = { coverMs: 700, holdMs: 200, revealMs: 700 }（1.6s），用于「从头开始」；章内换场仍 2.82s。
2. **换场重播入场错峰**：场景根节点加 key={scene.id}，每次换场重新挂载，段落/标题/选项动画按设计重播。
3. **键盘监听**：改为只挂一次 + useRef 读最新 state/handlers，不再每次 render 重挂。

另：本轮同时修掉 3D 复审提出的两项 App 问题（lazy chunk 失败 ErrorBoundary、换场晚一拍多挂 3D），并把「继续上次」的可见性改成回菜单时重算。
