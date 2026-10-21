# CarryTray：把尾声的 9 个结局改成「在桌上拖物件、交进匣子」

日期：2026-10-22
范围：`src/game/components/CarryTray.tsx`、`src/game/components/carryTray.css`、`tools/carry-tray-test.mjs`（+ harness 两件套）
未触碰：`App.tsx`、`audio.ts`、`Scene3D.tsx`、其它组件、剧情数据、`public/`、`dist/`、4173 与 5199 端口。

---

## 1. 做了什么

把《把名字留下来》尾声的「9 个结局选择」从竖排按钮列表，换成**一张 1947 年冬夜的桌子 + 一只旧木匣**：

1. **桌面物件（9 件实物，纯 CSS 形状/纹理/阴影，不用图片、不用 emoji）**
   - 6 个主结局按记忆载体区分：名册（厚册/深褐、右侧纸口）、家书（米白信封 + 暗红邮票 + 三角封口）、旗（红布、布纹、撕边、补丁）、照片（灰白相纸、暗调小像、**两个圈**）、口述（墨绿磁带、两个轮、标签纸）、口信（撕过的纸条 + 几道手写线）。
   - 3 个合成结局：**两件叠在一起**（名册+口述 / 家书+照片 / 旗样+那句話），右上角挂「组合」小标签。
   - 每件标 1—9 的编号（做成一枚压印小方章）+ 短标签（`label` 前 8 字）；**完整 label + hint 悬停/聚焦浮出**。
   - 摆位错落：旋转 −2.7°~2.8°、竖向错位 0~18px，按 index 固定（不随机抖动）。

2. **拖拽交付**
   - 按住物件拖动：8px 阈值内算点击（不误触）；越过后物件跟手，带轻微倾斜（`dx * 0.045`，夹在 ±5°）、放大 1.05、投影加深。
   - 匣子 = 掀开的盖（两枚铜铰链）+ 开口（缝底压着旧墨迹 + 一点露出的稿纸边）+ 木纹箱体 + 一方「抗战史料 · 暂存」小纸条 + 铜扣。拖进匣子范围后：匣子提亮、cue 文案隐去、**进度环**浮出。
   - **长按 1 秒按手印**：进匣子范围才开始计时，`conic-gradient` 进度环填满 1000ms 才落定；中途松手/移出 → 立刻清零并退回。
   - 落定：物件缩小飞入匣口（`--sink-x/--sink-y`）、一圈暖金细边的**墨晕**扩散、铜扣亮起，**400ms 后**回调 `onChoose(id, 'drag')`。
   - 匣子外松手：260ms 弹性回位，不触发选择、也不顺手把物件选中。
   - 层级小设计：拖到匣子上方时物件在匣子**前**（看得见自己拿着什么），进度环在物件**上**（不被挡住）；落定那一帧匣子抬到物件**之上**，看起来是"东西被收进箱子"。

3. **点击 / 键盘回退路径（自动化与无障碍的主路径）**
   - 点一下物件 → 选中态（抬起 4px + 金色边框 + 投影），底部出现「交出去」按钮；1 秒内再点同一件 → 直接交付（`gesture: 'click'`）。
   - 键盘：`1`—`9` 选中并把焦点移过去，`Enter` 交付（`gesture: 'keyboard'`），`Esc` 放下。
   - 每件都是真实 `<button type="button">`，`aria-label` 形如 `3 · 交旗的图样（结局：旗）`（序号 + 完整 label + 结局名），`aria-pressed` 表示选中；Tab 顺序即 1—9。
   - `role="status" aria-live="polite"` 播报「拿起了…」「到匣子上了：按住一秒」「没按满一秒：东西退回桌面」等。

4. **降级（prefers-reduced-motion / `reduceMotion`）**
   - 倾斜、墨晕、落匣过渡全部关掉（`data-reduce="true"`）；进度环只作为静态进度条保留（功能必需）；交付变成 140ms 后的瞬时状态切换。
   - 拖拽 + 长按仍然可用（有测试覆盖），点击两次也可用。

5. **性能（硬指标）**
   - 拖拽期间**不写 React state**：位移直接写元素 inline `transform`，由 rAF 合帧；长按进度写 CSS 变量 `--hold`；进/出匣子只改 `data-*` 与 classList。只有「选中 / 落定 / 取消」才 `setState`。
   - 测试用 `<Profiler>` 计数证明：拖拽全过程（含进出匣子）**React commit = 0**。
   - 卸载时清理：window `pointermove/pointerup/pointercancel/keydown/blur/visibilitychange` 监听、rAF、两处定时器。

6. **移动端**：pointer events 统一处理 mouse/touch/pen（`touch-action: none` 只加在物件上）；390px 下 3 行排布、物件缩到 0.78、无横向溢出（`docScrollWidth === 390`）。

---

## 2. 文件清单

| 文件 | 说明 |
| --- | --- |
| `src/game/components/CarryTray.tsx` | 组件本体（新建，约 720 行） |
| `src/game/components/carryTray.css` | 样式（新建，独立引入，类名全部 `carry-` 前缀，不依赖也不污染 `styles.css`） |
| `tools/carry-tray-test.mjs` | Playwright 单页验收（自起 Vite dev server，默认 4290） |
| `tools/carry-tray-harness.html` | harness 页面（**只给测试用**，App 不引用） |
| `tools/carry-tray-harness.tsx` | harness 入口（真实 `buildEpilogue(ledger)` 数据 + `<Profiler>` 计数 + `window.__carryTray` 钩子） |
| `tools/shots/carry-tray/*.png`、`report.json` | 截图与结构化结果 |

> harness 需要两个文件的原因：组件是 `.tsx` + `.css`，Node 里直接 import 跑不起来；用 Vite dev server 托管一页是最短的可行路径，页面里必须有一个模块入口才能写 JSX。它不参与正式渲染，`src/App.tsx` 一行都没改。

---

## 3. 组件 API

```tsx
import { CarryTray } from './game/components/CarryTray'
import type { CarryGesture, CarryTrayProps } from './game/components/CarryTray'

type CarryGesture = 'drag' | 'click' | 'keyboard'

type CarryTrayProps = {
  choices: Choice[]                                        // 尾声 choices（6 主 + 最多 3 合成，顺序即 1—9）
  onChoose: (choiceId: string, gesture: CarryGesture) => void
  onSound?: (soundId: string) => void                      // 可选音效回执（见下表）
  reduceMotion?: boolean                                   // 不传则读 prefers-reduced-motion
  holdMs?: number                                          // 默认 1000
  commitDelayMs?: number                                   // 落定到回调，默认 400
  busy?: boolean                                           // 父级处理中时锁住
  className?: string
}
```

**`gesture` 语义**：只有真正落进匣子才回调。

| gesture | 触发路径 |
| --- | --- |
| `drag` | 拖进匣子 + 按住满 `holdMs`（默认 1s） |
| `click` | 点一次选中 → 1s 内再点一次，或点「交出去」 |
| `keyboard` | `1`—`9` 选中 → `Enter`；或聚焦物件/按钮后按 Enter/Space（`event.detail === 0`） |

**`onSound` 回执 id**（与 `audio.ts` 的 `AudioEvent` 同名，组件本身**不 import** audio.ts，可直接 `playEvent(id)`）：

| id | 时机 |
| --- | --- |
| `carrier:roster` … `carrier:message`、`carrier:archive/relics/wordofmouth` | 拿起 / 点击选中（按载体区分） |
| `accent:ink` | 进入匣子范围、落定 |
| `ui:back` | 松手退回桌面 |

**DOM 观测点**（测试与调试用，不承诺长期稳定）：`.carry-tray[data-reduce|data-dragging|data-over|data-busy]`、`.carry-bin[data-over|data-holding|data-lit]`、`.carry-item[data-choice|data-kind|data-committed]`、`.carry-item.is-dragging|.is-over|.is-selected|.is-sinking`、`.carry-ring` 上的 CSS 变量 `--hold`（0~1）。

**关键时序**：8px 阈值 · 1000ms 长按 · 400ms 落定后回调（降级 140ms）· 260ms 弹回 · 420ms 落匣过渡 · 1000ms 双击窗口。

---

## 4. 测试

命令（自己起 dev server，绝不动 4173 / 5199 / dist）：

```bash
cd frontend/2026数字媒体
node tools/carry-tray-test.mjs            # 默认 4290，自动挑空闲端口
node tools/carry-tray-test.mjs --port 4291
```

- 服务：`vite.createServer({ root, cacheDir: node_modules/.vite-carry-tray, port: 4290 })`，跑完 `server.close()` + `browser.close()`。
- 数据：harness 里用真实 `buildEpilogue({roster:2,letters:2,flag:2,photo:2,testimony:2,message:2})` → 恰好 9 个选项，不是假数据。
- 浏览器：`chromium.launch({ channel: 'chrome' })`（与仓库其它测试一致）。
- 输出：控制台 PASS/FAIL + `tools/shots/carry-tray/report.json` + 7 张截图。

**结果：24/24 通过，单轮约 23s；连跑 3 轮全绿（含一次刻意制造的慢机器竞态修复后复跑）。**

| # | 验收项 |
| --- | --- |
| 1 | 9 件物件渲染，且都是真实 `<button type=button>` |
| 2 | `aria-label` 含「序号 + 完整 label + 结局名」，短标签=前 8 字，序号 1—9 |
| 3 | 6 主 + 3 合成：3 个「组合」标签、每个组合叠两件 |
| 4 | Tab 顺序按 1—9（第三次 Tab 落在第 3 件） |
| 5 | 阈值 8px：移动 5px 不进拖拽，松手当点击选中 |
| 6 | 数字键 5 选中第 5 件并聚焦，Enter 回调 `gesture=keyboard` |
| 7 | 悬停显示完整 label（含 hint） |
| 8 | 第一次点击只选中（不回调），1s 内再点一次 → `gesture=click` |
| 9 | 选中后点「交出去」→ `gesture=click`（走合成结局物件） |
| 10 | 拖到匣子外松手：不触发选择、弹回原位、不顺手选中 |
| 11 | 进入匣子范围：`data-over` + 长按进度环出现（`--hold` 在涨） |
| 12 | 匣子上方松手不满 1s：不回调、退回原位 |
| 13 | 按住中未满 1s 不回调 |
| 14 | 拖进匣子 + 按住 1s → 落定，0.4s 后回调 `gesture=drag` |
| 15 | 落定瞬间有落匣动画（`is-sinking`）与匣子亮点 |
| 16 | 音效回执按 AudioEvent 口径回传（`carrier:roster` + `accent:ink`） |
| 17 | **拖拽期间 React commit = 0**（位移/进度/进出匣子只写 DOM） |
| 18 | 390px 无横向溢出（doc/body scrollWidth ≤ 视口，桌面内没有元素越界） |
| 19 | 390px 物件换行排布（≥2 行） |
| 20 | 390px 触摸（pointer events）点两次也能交付 → `gesture=click` |
| 21 | reduced-motion：`data-reduce=true`，墨晕/过渡关掉 |
| 22 | reduced-motion：无 `is-sinking` 动画类，但点击两次仍能交付 |
| 23 | reduced-motion：拖拽 + 按住 1s 仍可落定（`gesture=drag`） |
| 24 | 无 console error / pageerror |

另：`npx tsc --noEmit -p tsconfig.app.json` 通过（strict）。

**截图**（`tools/shots/carry-tray/`）

| 文件 | 内容 |
| --- | --- |
| `01-desk-1440.png` | 1440×900 桌面全貌（桌 + 匣 + 9 件，5/4 两行） |
| `02-tray-detail.png` | 组件本体特写（木纹、匣子、物件细节） |
| `03-hover-full-label.png` | 悬停浮出完整 label + hint |
| `04-drag-over-bin-holding.png` | 拖到匣子上方 + 长按进度环 |
| `05-sinking-into-bin.png` | 落定瞬间：落匣 + 墨晕 + 铜扣亮起 |
| `06-mobile-390.png` | 390×844（3 行、无溢出） |
| `07-reduced-motion.png` | reduced-motion 交付后的静态状态 |

---

## 5. App 接入（Lead 只需改 2 处）

**① 尾声用 CarryTray 替掉按钮列表**（`src/App.tsx` 约 652—674 行的 `.choices` 块）：

```tsx
{!hasOutcome && scene.choices && scene.choices.length > 0 &&
  (scene.id === 'epilogue' ? (
    <CarryTray
      choices={scene.choices}
      onChoose={(id) => onChoose(id)}            // 不传 gesture：App 的第二参是坐标
      onSound={(id) => audioOn && playEvent(id as AudioEvent)}
    />
  ) : (
    <div className="choices">…原样…</div>
  ))}
```

**② 必须让出键盘**（同一个文件约 471—475 行，App 的全局 `1—9` 仍然直接 `onChoose`，会和组件的"只选中、Enter 才交"打架）：

```tsx
const index = Number.parseInt(event.key, 10)
if (scene.id === 'epilogue') return        // 尾声的 1—9/Enter 交给 CarryTray
if (!Number.isNaN(index) && index >= 1 && …
```

可选：想让点击粒子从匣子里冒出来，把 ① 的回调换成
`onChoose={(id) => { const r = document.querySelector('.carry-bin')?.getBoundingClientRect(); onChoose(id, r ? { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } : undefined) }}`
（不传则 App 的 `fireBurst` 回退到视口 50%/62%，也能看）。

组件宽度自适应父容器（`.scene` 是 `min(760px, 100%)`），在 760px 卡片内自然排成 5/4 两行；不需要任何外层容器样式。

---

## 6. 已知风险 / 边界

1. **键盘冲突（已在上文标注）**：不改 App 的全局 keydown，尾声按 `1` 会立刻定结局且不弹回车确认 —— 这是接入前必须处理的一项。
2. **浮层不裁剪**：完整 label 浮层在窄屏（≤430px）贴边物件聚焦时可能探出视口 20—40px（只是瞬时焦点态；静态布局已用 `display:none` 保证零溢出）。宁可探出也不裁剪，避免文字被切。
3. **物件投影/倾斜会被父级 `overflow` 裁掉**：若将来有人给 `.scene-body` 加 `overflow: hidden`，拖拽时探出桌沿的物件会被切；组件本身没设 `overflow`。
4. **`--sink-x/--sink-y` 在落定那一刻用 `getBoundingClientRect` 算一次**：如果落定瞬间有页面滚动/布局变化（比如父级同时在折叠其它面板），物件的飞行终点会有偏差（有 400ms 缓冲，肉眼通常看不出）。
5. **多指/多指针**：只跟踪第一个 pointerId，第二个指针会被忽略（不冲突、不叠加）。
6. **触屏滚动取舍**：物件上 `touch-action: none`，所以在物件上竖向滑动不会滚页面（拖拽需要）；桌面区域之外照常滚动。
7. **`busy` 语义**：`busy=true` 会禁用所有物件与「交出去」。App 目前不需要传（交付后场景就切走了），留着给"需要等服务端/转场"的场合。
8. **未做**：拖拽自动滚屏、物件飞入时的路径曲线、`aria-live` 逐帧进度播报（按 1s 只播事件点，避免刷屏）。

---

## 7. 复现 / 复看

```bash
cd frontend/2026数字媒体
node tools/carry-tray-test.mjs       # 24/24 + 截图 + report.json
npx tsc --noEmit -p tsconfig.app.json
```

干净程度：未改 `dist/`、未重启 4173、未占用 5199；测试用的 Vite 实例独立 `cacheDir`，跑完即关。
