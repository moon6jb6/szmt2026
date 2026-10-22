# 2026-10-22 质量终审：性能 / 无障碍 / 健壮性

> 对象：`dist/` 构建（13:08 构建，550 文件 / 24.58 MB；与工作区 `src/` 的差异见 [§3.5](#35-构建)），提交形态为「本地目录 + 子目录 HTTP」。
> 方法：无头 Chrome 155（Playwright `channel=chrome`）+ CDP 4× CPU 限速 + 真实渲染像素采样；**只读审计，未改 `src/`**。
> 数字源：`tools/quality/{bundle-split,perf,a11y,robust,reduced-motion}.json`；截图 `tools/quality/shots/`。
> 严重度：P0 阻断交付 / P1 核心路径受损或合规风险、建议截止前修 / P2 记录、不阻塞。

## 0. 结论

**判定：有风险（可交付）。** 性能与健壮性 PASS；无障碍 2 个 P1（语义）、打包流程 1 个 P1（dist 落后于 src），都建议截止前处理；其余 P2 不要动。

| 维度 | 判定 | 关键证据 | P0/P1/P2 |
|---|---|---|---|
| 性能 | **PASS** | 首屏 LCP 228 ms（4× CPU 664 ms）、TBT 1 ms（4× 396 ms）、CLS 0；主包 845 kB 中 71% 是正文数据，非组件 | 0/0/1 |
| 无障碍 | **有风险** | 选项按钮被 `role="listitem"` 覆盖，无障碍树里 name 为空；换场不播报、焦点掉回 `body` | 0/2/3 |
| 健壮性 | **PASS** | 非本地请求 0、断网可玩；localStorage 禁用可通关；连点账本只加一次；390px 无横向溢出 | 0/0/3 |
| 交付一致性 | **有风险** | `dist/` 落后于工作区 `src/`（13:08 vs 13:20），提交前必须重建 | 0/1/0 |

截止前建议修 3 项、合计约 20 分钟：见 [§4](#4-截止前修什么)。

**另有一个流程问题（P1）**：审计发现 `dist/`（13:08 构建）落后于工作区 `src/`——`chapter1.ts`、`endings.ts` 在 13:20/13:21 被改过。体积实测无差异（主包仍 897.96 kB），但**提交前必须重建**，详见 [§3.5](#35-构建)。

## 1. 性能

### 1.1 包体（`npm run build` 原始输出，kB = 1000 B）

| 产物 | raw | gzip | 说明 |
|---|---|---|---|
| `assets/index-*.js` 主包 | **897.96 kB** | **299.81 kB** | 一次拉全，含全部 140 场景数据 |
| `assets/Scene3D-*.js` | 591.99 kB | 151.76 kB | **lazy**：只有点「3D 视角」才下载 |
| `assets/index-*.css` | 18.75 kB | 4.94 kB | — |
| `index.html` | 1.00 kB | 0.68 kB | — |

首屏实际传输（实测 `transferSize`）：主包 297,989 B + CSS 5,223 B + html ≈ 1 kB；进入第一屏再要 2 个图（dawn.jpg 40.2 kB + scene-001.jpg 34.7 kB = **74.9 kB**）。**首屏没有 Scene3D、没有音频、没有字体请求。** dist 里 16.24 MB 插画与 4.88 MB 音频全部按需/懒加载，不参与首屏。

### 1.2 主包为什么是 845 kB

用同一套压缩器（rolldown esm+minify）单独量各成分（[bundle-split.mjs](../../tools/quality/bundle-split.mjs)）：

| 成分 | raw | gzip | 占主包 raw |
|---|---|---|---|
| 内容数据（场景/结局/史料/映射） | **602.83 kB** | 220.20 kB | **71.4%** |
| React 19 + ReactDOM 运行时 | 191.34 kB | 59.43 kB | 22.6% |
| 应用组件/引擎（App、Stage、粒子、帘幕、audio、engine） | **50.71 kB** | 18.05 kB | **6.0%** |

**结论：不是组件写得大，是文本数据大。** 正文 113,138 字按 UTF-8 每字 3 B ≈ **340 kB**，占内容数据的 56%；其余是九结局 55.78 kB、史料卡 76 张（含自动回填）85.63 kB、场景图映射 3.67 kB、音频清单+3D 映射 ≈4 kB。逐卷：

| 数据块 | raw | gzip | 数据块 | raw | gzip |
|---|---|---|---|---|---|
| 卷二 volume2 | 154.02 kB | 55.45 kB | 九结局 endings | 55.78 kB | 22.22 kB |
| 卷一 volume1 | 90.20 kB | 34.70 kB | 史料卡 sources | 85.63 kB | 29.59 kB |
| 卷三 volume3 | 65.68 kB | 25.62 kB | 基础五夜 chapter1 | 53.02 kB | 22.53 kB |
| 卷五 volume5（人物志） | 40.84 kB | 17.79 kB | 序卷 volume0 | 31.59 kB | 13.81 kB |
| 卷四 volume4（后来） | 18.46 kB | 8.29 kB | 首屏只需 chapter1+v0 | **84.46 kB** | **34.72 kB** |

### 1.3 首屏实测（本地 preview，无网络延迟；桌面 1440×900）

| 场景 | FCP | LCP | 菜单可读 | TBT | 长任务 |
|---|---|---|---|---|---|
| 桌面冷启动（3 次中位） | **228 ms** | **228 ms** | 125 ms | 1 ms | — |
| 桌面 + 4× CPU（5 次中位） | **664 ms** | 664 ms | 296 ms | **396 ms**（296–433） | 最长 341 ms |
| 移动 390 + 4× CPU | 756 ms | 756 ms | 381 ms | 489 ms | — |
| 桌面 + reduced-motion | 212 ms | — | 131 ms | 10 ms | — |

CLS = 0（所有场景）；LCP 元素是右下角「声音」按钮（最大已绘制元素），不是标题，说明首屏是一次性绘制、无渐进加载抖动。点「从头开始」→ 正文 DOM 就绪 **1444 ms**，其中 1200 ms 是墨迹幕的设计值（`CURTAIN_CHAPTER.coverMs`），不是性能问题。

### 1.4 判断：要不要把 content 数据拆成按屏 lazy？

**不建议（P2）。** 数字上收益明确、工程上不划算：

- 收益上限：首屏只需 326.5 kB（React 191.34 + 组件 50.71 + 首屏数据 84.46），拆干净可省 **518 kB raw / 185 kB gzip（约占主包 62%）**；4× CPU 下主线程峰值预计从 341 ms 降到 ~150–200 ms。
- 但不划算：① 首屏已经 **228 ms / 4× 664 ms**，LCP 门槛 2.5 s，拆包省的是「已经够快」的那部分；② `getScene()` 是**同步查表**（`registry.ts` 把 6 卷拼成一张 `SCENES`），按屏 lazy 必须把它改成异步 + 每个换场加 Suspense，动的是主链核心，还要重跑 `walk-test` / `ending-test-v3` / `ui-smoke`；③ 收益只在首次加载，之后 6 小时内都在读同一份数据。
- 若一定要拆，**最小可行方案**是只摘卷四/卷五（`volume4` 18.46 + `volume5` 40.84 = 59.3 kB raw / 26 kB gzip）：我核过 `src/game/content/*`，主线没有任何 `next`/`continueTo` 指向 `v4-*`/`v5-*`，它们只被「人物志」「后来」两个独立页面用。但要接受 `SCENE_COUNT` 从 140 变 115（卷四 15 篇 + 卷五 10 篇），与首页「一百四十个场景」文案及已交付 PDF 冲突——**这就是不改的真正理由**。

**性能侧 P2**：构建日志有 6 条 `../bg/*.jpg didn't resolve at build time`（warehouse/office/dawn/river/flag/bridge）——这是 CSS 里运行时拼的路径，`dist/bg/` 里文件都在、实测能加载（首屏就加载了 dawn.jpg），只是这些图不会被 hash、也无法加 preload。

## 2. 无障碍

### 2.1 键盘完整走查（1440×900）

| 项 | 结果 |
|---|---|
| 菜单 Tab 顺序 | 从头开始 → 结局一览 → 史料库 → 人物志 → 后来 → 关于与史料 → 打开声音 → 循环；与视觉顺序一致，7 个停点 |
| 焦点可见性 | 7/7 停点均为 `2px solid rgb(200,160,99)`（`--gold`），`outline-offset:3px`，全部在视口内 → [焦点截图](../../tools/quality/shots/a11y-focus-menu.png) |
| 场景内 Tab | 选项 1 → 选项 2 → 史料卡 chip ×2 → 打开声音 → 循环 |
| 数字键 1–4 | **有效**：按 `1` 直接选中并进结果页 |
| Enter / 空格 | **有效且不跳场**：期望 `v0-02`，实际 `v0-02`；有选项时按空格不会误触发 |
| 换场后焦点 | **失效 → `body`**（进入游戏、点继续都一样），见 P1-2 |

### 2.2 语义 / ARIA

| 检查 | 结果 |
|---|---|
| 标题层级 | 每屏唯一 `h1`：菜单/场景/结局/人物志/关于 ✓；结局一览 `h1+h2×9` ✓；史料库 `h1→h2→h3` ✓。**例外**：史料卡弹层里的 `h3` 在 `h1` 之后（跳级，P2） |
| 图片 alt | 全部有 alt（= 场景标题，如「半本册子」），`naturalWidth>0` 实测加载成功 |
| `aria-pressed` | 「声音」与「3D 视角」都有，且状态随点击翻转（`3D 视角=false` → `回到 2.5D=true`，同时 3D canvas 挂上） |
| `aria-label` | 「声音」用 `aria-label` 表达动作（打开/关闭声音），文案「声音 开/关」另作视觉；3D 按钮用文案切换 |
| `aria-live` | **0 个**：换场、结局抵达都不播报（P1-2） |
| 选项语义 | **`role="listitem"` 覆盖了 button**：无障碍树里 2 个 `listitem`，`name=""`，按钮角色消失（P1-1） |
| 弹层 | `role="dialog" aria-modal="false" aria-label="史料卡"` ✓；但焦点不进入、`Esc` 不关闭（P2） |
| 终极画面 | `role="presentation"`、`tabIndex=-1`、0 个可聚焦元素；只有全局 Enter/空格/Esc 能跳过（P2）→ [截图](../../tools/quality/shots/a11y-finale.png) |
| 地标 | `main` / `header` / `footer` 存在 |

**P1-1（无障碍树证据）**：`.choice` 是 `<button role="listitem">`，AX 树实测 `role=listitem, name=""`，按钮角色被覆盖、可访问名丢失。读屏用户听到「列表项」而非「按钮」，无法判断可操作。改法：删掉 `.choices` 的 `role="list"` 与每个选项的 `role="listitem"`（原生 button 自带按钮语义和键盘行为），或改成 `<ul><li><button>`。**不涉及任何游戏逻辑。**

**P1-2（焦点/播报）**：`App.tsx` 换场只改 state，没有把焦点移到新场景标题、也没有 live region。键盘用户每次换场都要从 `body` 重新 Tab 5 次；读屏用户不知道场景变了。改法：给 `.scene h1` 加 `tabIndex={-1}` + `ref.focus()`（换场后），或给标题容器加 `aria-live="polite"`。

### 2.3 对比度（真实合成背景像素采样）

方法：取计算样式的前景色，隐藏全部文字（含 `::first-letter`）后截该元素矩形，回灌 canvas 逐像素算 WCAG 比值，报 p05 / 中位。背景因此包含插画、半透明卡片、雪粒、3D 画面——不是按色值推算。

| 屏 | 抽样 | 结果 |
|---|---|---|
| 菜单 | 标题、导语、四条事实、内容提示、主/次按钮、eyebrow、声音 | p05 **5.48–14.09**，全 PASS |
| 场景 | h1、章、元信息、正文、选项标题/提示、chip、史料 eyebrow | p05 **5.36–12.91**，全 PASS |
| 3D 场景 | 3D 开关、3D 提示、透出 3D 背景的正文 | p05 **7.87 / 12.20 / 15.33**，全 PASS（`rgba(11,9,7,.46)` 卡片在暗 3D 场景下仍够） |
| 结局 | h1、正文、coda | p05 **5.26 / 11.49 / 10.33**，全 PASS |
| 史料库 | claim、引文、badge | p05 **5.35–11.60**，全 PASS |

25 个抽样点**全部达到 WCAG AA**（正文需 4.5、大字号需 3），最低 p05 = 5.26（`.ending-coda`）。唯一 <阈值的像素占比：badge 2.7%、chip 0.4%、coda 0.6%，来自 1px 描边与圆角抗锯齿（已内缩 2px 仍残留），不是文字背景。

### 2.4 `prefers-reduced-motion` 降级（四项全过）

| 项 | 实测 |
|---|---|
| 3D | 不渲染：`canvas3d=false`、按钮不出现（`toggle3dVisible=false`） |
| 粒子 | 天气粒子 canvas 已绘制像素 **0**；点击爆发 `.choice-burst` `display:none` 且点击后像素仍为 0 |
| 转场 | 所有 `animation/transition-duration` = **1e-06s**，正文 `opacity=1` 立即可读 |
| 终极画面 | canvas `display:none`，只画最后一帧后自动进正文：点「继续」到结局页 **1320 ms**（正常模式约 6.2 s+） |

实测无控制台错误，结局标题正确（名册）。截图：[rm-scene](../../tools/quality/shots/rm-scene.png)、[rm-finale](../../tools/quality/shots/rm-finale.png)、[rm-ending](../../tools/quality/shots/rm-ending.png)。`tools/quality/reduced-motion-check.mjs` 覆盖了 `tools/test-degrade.mjs` 原有的 3D/390 两项，另加粒子、转场时长与终极画面三项。

### 2.5 其余 P2

- 史料卡弹层：`Esc` 不关闭（`escClosed=false`），焦点留在 chip 上不进面板；关闭按钮要再 Tab 数下才到 → 建议加 `onKeyDown` Esc + 打开时 `focus()` 面板。
- 终极画面整屏 canvas 对读屏是空的，跳过提示只是 `<span>`；键盘可跳、读屏读不到 → 建议 `<button class="finale-skip">`。
- 弹层 `h3` 与页面 `h1` 之间没有 `h2`（跳级）。

## 3. 健壮性

### 3.1 断网（abort 所有非本地请求）→ PASS

`context.route` 拦掉一切非 `127.0.0.1/localhost` 请求后完整进入游戏：

```
非本地请求数：0
场景链：v0-01(870 字, 2 选项, 插画 768px) → v0-02(937 字) → v0-03(904 字)
史料库：76 张卡
错误：0   失败请求：0
```

即：**零外部依赖**，字体走系统栈、无 CDN、无后端。

补充（P2，如实记录）：把整站彻底离线（`setOffline`，连本地资源也断）后，**新场景的插画与背景加载失败**（`office.jpg`、`scene-002.jpg` 报 `ERR_INTERNET_DISCONNECTED`，控制台 2 条资源错误），正文仍可读、流程不中断。静态站没有 Service Worker，属预期；交付形态是本地目录，不构成风险。

### 3.2 localStorage 被禁用 → PASS

`Object.defineProperty(window,'localStorage',{get(){throw}})`（等价 Safari 无痕/策略拦截）：

```
菜单 7 个按钮正常；进入 v0-01 → 选选项出结果页 → 继续到 v0-02（937 字，插画 ok）
错误：0
```

`engine.ts` 的 `save/load/clearSave` 与 `App` 的解锁表都包了 try/catch，写入失败静默降级——**能玩，只是不存档**。

### 3.3 快速连点 → PASS

| 操作 | 结果 |
|---|---|
| 连点「从头开始」×5 | 正常进入 v0-01，无重复渲染异常 |
| 连点同一选项 ×6 | 账本 = `{roster:1}`，与单点一次的基线**完全一致**（`choose()` 的 `picked` 守卫生效）；结果页只有 1 个「继续」 |
| 连点「继续」×6 | 期望 `v0-02`，实际 `v0-02`，**没有跳场**，错误 0 |

### 3.4 缩到 390px → 布局 PASS，3D 策略 P2

冷启动 390：`scrollWidth == innerWidth == 390`（无横向溢出）、3D 开关不出现、正文 870 字可读、声音按钮在视口内 → [截图](../../tools/quality/shots/robust-390-cold.png)。

桌面开着 3D 再缩到 390：**3D 仍保持开启**（按钮仍显示「回到 2.5D」、canvas 自动变成 390×844、`aria-pressed=true`），要等换场重新渲染才收起（换场后 `toggleVisible=false`、`canvas3d=false`）。原因是 `canUse3D()` 只在渲染时读 `window.innerWidth`，没有 resize 监听。无布局破坏、文字可读 → **P2**（窄屏多跑 WebGL 的电量/发热代价）。→ [截图](../../tools/quality/shots/robust-390-after-3d.png)

另：390px 下固定的「声音」按钮压住正文最后一行约 1 行高度（`audioOverlapsScene=true`），滚动可避开 → **P2**（给卡片加 `padding-bottom` 或移动端收成图标即可）。

### 3.5 构建

`npm run build`：tsc 0 错误、vite 通过，只有 chunk>500 kB 提示与 6 条 `../bg/*.jpg` 运行时解析提示（见 §1.4 P2）。

**构建一致性（P1，需在提交前处理）**：审计的是 `dist/`（构建于 13:08）。审计结束前发现工作区 `src/game/content/chapter1.ts`、`src/game/content/endings.ts` 在 13:20/13:21 被改过（`git diff`：endings +107/−98 行、chapter1 22 行），**dist 已落后于工作区**。我用 `npx vite build --outDir tools/quality/dist-probe` 单独重建量过当前工作区的体积：主包 897.96 kB（gzip 299.87）、CSS 18.75 kB、Scene3D 591.98 kB —— **与审计版完全相同**，所以性能/包体结论不受影响；但交付前必须正式重跑一次 `npm run build`，否则提交的 `dist/` 里结局文案是旧版。

## 4. 截止前修什么

| # | 项 | 严重度 | 改哪里 | 估时 | 建议 |
|---|---|---|---|---|---|
| 1 | 选项按钮补回 button 语义 | **P1** | `src/App.tsx` 的 `.choices`：删 `role="list"` 与每个 `.choice` 的 `role="listitem"` | 5 min | **修**：读屏可访问名与可操作角色直接恢复，零逻辑改动 |
| 2 | 换场播报 + 焦点归位 | **P1** | `src/App.tsx` `renderScene`：给 `.scene h1` 加 `tabIndex={-1}` + `useEffect` 里 `focus()`；或标题容器加 `aria-live="polite"` | 10 min | **修**：键盘用户少按 5 次 Tab，读屏能知道换场 |
| 3 | 史料卡 `Esc` 关闭 | P2 | `renderSourcePanel` 加 `onKeyDown`（或打开时 focus 面板） | 5 min | 顺手修；不改也不阻塞 |
| 4 | 3D 缩到 <700px 自动收起 | P2 | `App.tsx` 加 `resize` 监听把 `view3d` 置 false | 10 min | 不修也可（换场即恢复） |
| 5 | 390px 声音按钮压字 | P2 | `styles.css` 移动端断点给卡片加 `padding-bottom` | 5 min | 不修也可 |
| 6 | content 按屏 lazy | P2 | `registry.ts` 异步化 + Suspense | 半天+回归 | **不做**（§1.4） |
| 7 | Service Worker 离线缓存 | P2 | 新增 SW | 半天 | **不做**（交付形态无需） |
| 8 | 重建 `dist/` 并重跑本报告脚本 | **P1** | `npm run build`，再跑 §5 五条命令 | 2 min + 5 min | **必须做**：当前 dist 的结局文案是旧版（§3.5） |

只改 1、2 两项即可把「无障碍」从「有风险」拉到 PASS，且不触碰存档、场景、3D、音频任何逻辑。改完照 `§5` 跑一遍 `a11y-check.mjs` 即可复核（期望：AX 里选项变 `button` 且有名字；换场后 `activeElement` 是 `h1`）。第 8 项与代码改动无关，是打包流程：**重建 → 重跑五条脚本 → 再打包 ZIP**。

## 5. 复现

```bash
npm run build
npm run preview -- --port 4173 --strictPort        # 另开一个终端

node tools/quality/bundle-split.mjs                # 包体 + 主包成分（rolldown 同参数量）
node tools/quality/perf-check.mjs                  # FCP/LCP/CLS/TBT，含 4×CPU 与 390 移动端
node tools/quality/a11y-check.mjs                  # 键盘/AX/对比度（像素采样）/标题层级
node tools/quality/reduced-motion-check.mjs        # 3D/粒子/转场/终极画面四项降级
node tools/quality/robust-check.mjs                # 断网 / localStorage 禁用 / 连点 / 390px
```

脚本只读 `dist/` 与运行中的页面，产物写入 `tools/quality/*.json` 与 `tools/quality/shots/*.png`，不写 `src/`。

## 6. 边界（本次没做的）

- **没有真机**：全部在桌面无头 Chrome + CDP 4× CPU 限速下测；真实中低端手机的 GPU/解码会更慢，性能结论应看作乐观下界。
- **没有启动真读屏软件**：无障碍结论基于 Chromium AX 树（`Accessibility.getFullAXTree`）、计算样式与键盘事件，不是 NVDA/VoiceOver 实测口播。
- **没有碰 GPU 性能**：按要求未对 3D 帧率/显存做压测，3D 数据沿用 [2026-10-22-3d-slices.md](2026-10-22-3d-slices.md) 的 87–136 fps 结论（本次只验证了「点开关才加载、`reduced-motion` 下不渲染、缩窗不崩」三点）。
- **审计机有后台负载**（系统 CPU 占用约 48%，另有浏览器进程）：4× CPU 组的 5 次样本已取中位并给出区间（FCP 560–720 ms、TBT 296–433 ms），单次读数不宜直接引用。

---

## 7. v1.3 修复记录（Lead，2026-10-22 13:5x）

- **P1-1 已修**：删除 `.choices` 的 `role="list"` 与每个选项的 `role="listitem"`，原生 button 语义与可访问名恢复。
- **P1-2 已修**：`.scene-title` 加 `tabIndex={-1}`，换场后 280ms 将焦点交给标题；场景页新增 `aria-live="polite"` 播报（章节 + 标题）。
- **P2 顺手修**：史料卡浮层支持 Esc 关闭；窗口缩到 <700px 自动退出 3D；移动端声音按钮下移并给正文留 72px 底部间距。
- 修复后 `dist` 已重建（本轮 897.96 kB / gzip 316.6 kB），并由 `tools/quality/a11y-check.mjs` 复跑复核。
- 未做（按你的建议）：按屏 lazy 拆包、Service Worker。
