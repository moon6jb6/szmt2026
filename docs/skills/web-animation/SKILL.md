---
name: web-animation
description: 为叙事型网页（交互叙事、数字展陈、品牌长页、纪录式作品）设计并实现动效与转场，零依赖、可离线、遵守 prefers-reduced-motion。覆盖场景转场配方、2.5D 视差配方、粒子与氛围配方、性能红线与实测方法。触发词：网页动效、场景转场、2.5D 视差、粒子氛围、prefers-reduced-motion、动机动画、叙事节奏、墨迹转场、Canvas 转场。
version: 1.0.0
---

# 叙事型网页动效 Skill

> 本 skill 由四条来源合成，并按「单机静态站点、首屏 77 KB gzip、禁用重引擎」的工程约束裁剪：
> - [iart-ai/web-animation-skills](https://github.com/iart-ai/web-animation-skills)（MIT）· `60fps-animation` 的「昂贵属性→等价替换」与 `page-transition-animation` 的三段式转场结构
> - 本地 `frontend-slides/animation-patterns.md` 的「效果 → 情绪」映射
> - 本地 `guizang-ppt-skill` 的「低功耗 B 键」三段式降级
> - 本项目 [`docs/research/web-animation-skills.md`](../../research/web-animation-skills.md) 的实测数据与因子隔离结论
>
> 三者都没解决的一件事，本 skill 补齐：**「帧预算」如何变成可判定的数字红线，以及哪些做法实测真的更慢。**

---

## 〇、什么时候用 / 不用

**用**：单页叙事、多场景切换、需要「氛围」而非「信息传达」的网页；已有静态视觉但"点一下整块跳变"；需要在不引入 GSAP/Motion 的前提下把观感拉起来。

**不用**：后台管理、表单密集、地图/图表为主的应用界面——那里动效的价值远低于它带来的回归风险；也不要用于营销落地页的"每屏一个 wow"（那需要编排引擎，直接上 GSAP）。

---

## 一、叙事型网页的六条动效原则

这六条按「违反后的破坏力」排序。每条都能判定"做了 / 没做"，不要写成"要自然流畅"这种废话。

### 1. 动效服务于「换气」，不服务于「炫技」

叙事作品的节奏是**呼吸**：一段文字（吸）→ 一个停顿（屏住）→ 下一段（呼）。
判定标准：**每一处动效都能回答"它遮挡了什么 / 它给了我多少时间想上一句"**。答不上来就删。

### 2. 转场必须**遮挡换场的脏活**

换场瞬间会发生：背景图解码、字体度量、布局重排、React 重渲染。这些都会产生一帧级闪烁。
判定标准：**换场那一帧，屏幕上必须是不透明的东西**（纯色 / 墨 / 雨幕），不能是"新旧内容半透明叠加"。
→ 这就是「cover → swap → reveal」三段式存在的唯一理由，不是为了好看。

### 3. 情绪重的地方**慢**，信息重的地方**快**

| 场合 | 总时长 | 缓动 |
|---|---|---|
| 首屏进入 | 1.2–1.6 s | `ease-out`（快起慢收，像门被推开） |
| 普通换场 | 1.8–2.2 s | cover 用 `ease-out`，reveal 用 `ease-in` |
| 换章节 | 2.5–2.8 s | 同上，但 hold 加长 |
| 进结局 | 3.2–3.7 s | hold 600 ms（最长的黑） |
| 结局内文逐段 | 每段 900 ms，间隔 260 ms | `ease-out` |
| 按钮 / 卡片悬停 | 180–240 ms | `ease-out` |
| 选项按下回执 | 90–180 ms | `ease-out` |

判定标准：**同一个页面上不应同时出现 < 200 ms 和 > 2.5 s 的动效**，除非二者分属"交互反馈"和"叙事转场"两类。

### 4. 只动 `transform` 和 `opacity`（以及被证明免费的东西）

实测结论（详见研究报告 §7.3）：

| 属性 | 相对成本 | 结论 |
|---|---|---|
| `transform` / `opacity` | 1× | ✅ 默认手段 |
| **恒定** `filter: blur()`（元素 transform 不变） | ≈1× | ✅ **可以用，实测免费** |
| **逐帧改** `filter: blur(radius)` | **2.1×** | ❌ 禁止 |
| 每层各自逐帧改 `transform`（都是 2D） | **1.8×**（无 filter）/ **2.8×**（有 filter） | ❌ 改用父层变换 |
| `letter-spacing` / `width` / `height` / `top` | 触发 layout，且每字符重排 | ❌ 仅限首屏一次性 |
| 全屏 `mix-blend-mode` + 逐帧位移 | 合计约 15% 帧预算 | ❌ 面积收到 10% 以内 |

### 5. 动效必须**可被判死**

每处动效都要有"静态终态"：
- `prefers-reduced-motion: reduce` → 180 ms 交叉淡入或直接切；
- 低端机 / 连续丢帧 → 自动降级（见 §六）；
- 用户显式开关 → 完全静态。
判定标准：**把 JS 全停掉，页面必须仍然完整可读、可操作**。

### 6. 起点写 CSS，终点写 CSS，中间才写 JS

起始态若写在 inline style 或 JS 里，媒体查询压不住它，reduced-motion 下会留白。
```css
/* ✅ 起始态在 CSS 里，媒体查询能覆盖 */
.reveal { opacity: 0; animation: rise 900ms var(--ease) var(--d, 0ms) forwards; }

@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; animation: none; }   /* ★ 必须显式给终态 */
}
```

---

## 二、配方 A · 场景转场（墨迹幕 / 雨幕 / 推镜）

### A.1 结构

```
DOM 层：
  .viewport
    ├── .scene[data-active]  × N      ← 每个场景各自一层，只切换 data-active
    ├── canvas.ink-curtain            ← 幕布，静息时 opacity:0 + contain:strict
    └── .controls

时间轴（总 2.1 s）：
  0 ─────────── cover(900) ─────── hold(240) ─────── reveal(950) ───→
   墨从四边+中心长满        纯墨驻留，swap 发生在这里   墨被"吃掉"，新场景露出
   同时 --push: 1 → 1.045                        同时 --push: 1.04 → 1
```

### A.2 三条不可省的实现纪律

1. **纹理只生成一次**（离屏 canvas + `ctx.filter` 烘焙），运行时只 `drawImage`。
2. **换场只发生在 hold 段**，且只做一次（用 `swapped` 标志位）。
3. **进 reveal 用 `globalCompositeOperation = 'destination-out'`** 去"挖"墨，而不是把墨块缩小——挖出来的边缘保持同一条纹理，视觉上是"被撕开"，方向感对。

### A.3 完整代码（可直接落进项目）

```ts
// ---------- 纹理：一次生成，永久复用 ----------
const INK = '#16130f'

function makeInkTile(size = 512, blobs = 170): HTMLCanvasElement {
  const shape = document.createElement('canvas')
  shape.width = shape.height = size
  const sx = shape.getContext('2d')!
  sx.fillStyle = '#000'

  const c = size / 2
  sx.beginPath(); sx.arc(c, c, size * 0.30, 0, Math.PI * 2); sx.fill()

  // 外圈随机小圆 → 不规则墨边
  for (let i = 0; i < blobs; i++) {
    const a = Math.random() * Math.PI * 2
    const d = size * (0.30 + Math.random() * 0.13)
    const r = size * (0.014 + Math.random() * 0.05)
    sx.beginPath()
    sx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, Math.PI * 2)
    sx.fill()
  }
  // 内部留"呼吸"孔，墨不至于死板
  sx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2
    const d = Math.random() * size * 0.30
    const r = size * (0.008 + Math.random() * 0.03)
    sx.beginPath()
    sx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, Math.PI * 2)
    sx.fill()
  }
  sx.globalCompositeOperation = 'source-over'

  // ★ 只 blur 这一次（离屏），运行时不碰 filter
  const out = document.createElement('canvas')
  out.width = out.height = size
  const ox = out.getContext('2d')!
  try { ox.filter = `blur(${Math.round(size * 0.035)}px)` } catch { /* 老浏览器忽略 */ }
  ox.drawImage(shape, 0, 0)
  ox.filter = 'none'
  return out
}
```

```ts
// ---------- 幕布控制器 ----------
const ANCHORS = [
  { x: 0.00, y: 0.00 }, { x: 0.50, y: -0.06 }, { x: 1.00, y: 0.00 },
  { x: -0.05, y: 0.55 }, { x: 1.05, y: 0.50 },
  { x: 0.20, y: 1.05 }, { x: 0.82, y: 1.05 },
]
const easeOut3 = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn3  = (t: number) => t * t * t
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

type Opts = { cover?: number; hold?: number; reveal?: number; mode?: 'ink' | 'rain' }

async function playCurtain(
  canvas: HTMLCanvasElement,
  tiles: HTMLCanvasElement[],
  swap: () => void,
  opts: Opts = {},
): Promise<void> {
  const { cover = 900, hold = 240, reveal = 950, mode = 'ink' } = opts

  // ★ 无障碍短路：必须在最前面
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    swap()
    return
  }

  const ctx = canvas.getContext('2d', { alpha: true })!
  const dpr = Math.min(devicePixelRatio || 1, 2)          // ★ 上限 2，别让 4K 屏爆帧
  const W = canvas.width  = Math.round(canvas.clientWidth  * dpr)
  const H = canvas.height = Math.round(canvas.clientHeight * dpr)
  ctx.imageSmoothingEnabled = true

  const drawInk = (scaleMul: number, alpha: number) => {
    const base = Math.max(W, H) * 0.62 * scaleMul
    ctx.globalAlpha = alpha
    for (let i = 0; i < ANCHORS.length; i++) {
      const a = ANCHORS[i]
      const blob = base * (0.86 + ((i * 37) % 29) / 100)   // 每块体积错开
      ctx.drawImage(tiles[i % tiles.length], a.x * W - blob / 2, a.y * H - blob / 2, blob, blob)
    }
    ctx.globalAlpha = 1
  }

  canvas.dataset.live = '1'
  const root = canvas.parentElement as HTMLElement
  const t0 = performance.now()
  let swapped = false

  return new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const el = now - t0
      ctx.clearRect(0, 0, W, H)

      if (el < cover) {
        const p = easeOut3(el / cover)
        drawInk(lerp(0.10, 1.30, p), mode === 'rain' ? 0.94 : 1)
        root.style.setProperty('--push', String(1 + 0.045 * p))     // 推镜
        if (p > 0.999) { ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H) }
      } else if (el < cover + hold) {
        ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H)
        if (!swapped) { swap(); root.style.setProperty('--push', '1.04'); swapped = true }
      } else if (el < cover + hold + reveal) {
        const q = easeIn3((el - cover - hold) / reveal)
        ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H)
        ctx.globalCompositeOperation = 'destination-out'
        drawInk(lerp(0.55, 3.20, q), 1)
        ctx.globalCompositeOperation = 'source-over'
        root.style.setProperty('--push', String(lerp(1.04, 1, easeOut3(q))))
      } else {
        ctx.clearRect(0, 0, W, H)
        root.style.setProperty('--push', '1')
        canvas.dataset.live = '0'
        resolve()
        return
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}
```

```css
/* ---------- 幕布 ---------- */
.ink-curtain {
  position: fixed; inset: 0; z-index: 30;
  width: 100%; height: 100%;
  pointer-events: none;
  opacity: 0;                 /* 静息时不参与合成 */
  contain: strict;            /* 隔离布局/绘制/尺寸计算 */
}
.ink-curtain[data-live='1'] { opacity: 1; }

/* ---------- 推镜：只作用于包裹层，不动子层 ---------- */
.scene { transform: scale(var(--push, 1)); will-change: transform, opacity; }
.scene[data-active='1'] { opacity: 1; visibility: visible; }
.scene:not([data-active='1']) { opacity: 0; visibility: hidden; }
```

### A.4 雨幕变体

在墨之上再叠一层平移的雨线纹理（一次性预渲染成 640² 的 tile，运行时 `drawImage` 平铺）：

```ts
function makeRainTile(w = 640, h = 640) {
  const t = document.createElement('canvas')
  t.width = w; t.height = h
  const x = t.getContext('2d')!
  for (let i = 0; i < 90; i++) {
    const px = Math.random() * w, py = Math.random() * h
    x.strokeStyle = `rgba(198,214,226,${0.05 + Math.random() * 0.20})`
    x.lineWidth = 0.6 + Math.random() * 1.1
    x.beginPath(); x.moveTo(px, py); x.lineTo(px - 6, py + 18 + Math.random() * 70); x.stroke()
  }
  return t
}

// 用时：
ctx.globalCompositeOperation = 'lighter'   // 雨是"加光"，不是"盖色"
const s = RAIN.width * dpr
const off = (phase * 220 * dpr) % s
for (let y = -s; y < H + s; y += s)
  for (let x = -s; x < W + s; x += s)
    ctx.drawImage(RAIN, x, y + off, s, s)
ctx.globalCompositeOperation = 'source-over'
```

### A.5 参数速查

| 场合 | cover | hold | reveal | 备注 |
|---|---|---|---|---|
| 普通换场 | 900 | 240 | 950 | 约 2.1 s |
| 换章节 | 1200 | 320 | 1300 | 2.8 s，翻页感 |
| 进结局 | 1500 | **600** | 1600 | 3.7 s，最长的黑 |
| 首屏开场 | 800 | 120 | 700 | 1.6 s，可与首屏进场叠用 |
| 雨/雪场景 | +0 | +0 | +0 | 叠雨幕层，不改时序 |

### A.6 只在支持时使用的原生增强（0 KB）

```ts
// 信息页（史料库 / 结局一览 / 关于）的切换用它，剧情换场用墨迹幕——二选一，别叠
import { flushSync } from 'react-dom'

export function withViewTransition(update: () => void) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof document.startViewTransition !== 'function') {
    update(); return
  }
  document.startViewTransition(() => flushSync(update))   // ★ 必须同步，否则快照抓旧 DOM
}
```
```css
::view-transition-old(root) { animation: vtOut 220ms var(--ease) both; }
::view-transition-new(root) { animation: vtIn  260ms var(--ease) both; }
@keyframes vtOut { to { opacity: 0 } }
@keyframes vtIn  { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none }
}
```
浏览器支持（MDN BCD，2026-10 取）：Chrome **111** / Firefox **144** / Safari **18**。

---

## 三、配方 B · 2.5D 视差（纵深感的正确做法）

### B.1 唯一的正确形状：父层倾斜，子层静态

```
❌ 错的（也是大多数项目的默认写法）：
   .layer-far  { transform: scale(1.04) translate(calc(var(--px)*6px), …) }
   .layer-mid  { transform: scale(1.10) translate(calc(var(--px)*14px), …) }
   .layer-near { transform: scale(1.18) translate(calc(var(--px)*26px), …) }
   → 每层自己的 transform 每帧都变 → 每层的栅格/滤镜缓存全部失效

✅ 对的：
   .stage      { perspective: 1100px; perspective-origin: 50% 46%; }
   .stage-tilt { transform: rotateX(calc(var(--py) * -2.2deg))
                          rotateY(calc(var(--px) *  2.6deg));
                 transform-style: preserve-3d; }
   .layer-far  { transform: translateZ(-260px) scale(1.30); }   ← 恒定
   .layer-mid  { transform: translateZ( -60px) scale(1.14); }   ← 恒定
   .layer-near { transform: translateZ( 140px) scale(1.20); }   ← 恒定
   → 只有父层矩阵变，子层栅格被复用，只是重新投影
```

**实测差**（1600×1000，三层满屏，指针持续扫掠）：`16.9 fps`（错）→ `48.0 fps`（对）。而且"对"的那个纵深是真的——透视会连**尺度差 + 轻微梯形变形**一起给你，不需要手动算。

### B.2 完整代码

```html
<div class="stage" style="--background: warehouse">
  <div class="stage-tilt" aria-hidden="true">
    <div class="stage-layer layer-far"><div class="bg-image bg-warehouse"></div></div>
    <div class="stage-layer layer-mid"><div class="bg-image bg-warehouse"></div></div>
    <div class="stage-layer layer-near"><div class="bg-image bg-warehouse"></div></div>
  </div>
  <div class="stage-ambient" aria-hidden="true"></div>
  <div class="stage-vignette" aria-hidden="true"></div>
  <div class="stage-grain" aria-hidden="true"></div>
  <div class="stage-content"><!-- 正文 --></div>
</div>
```

```css
@property --px { syntax: '<number>'; inherits: true; initial-value: 0; }
@property --py { syntax: '<number>'; inherits: true; initial-value: 0; }
@property --glow { syntax: '<number>'; inherits: true; initial-value: 0; }

.stage {
  position: fixed; inset: 0; overflow: hidden;
  background: var(--ink);
  perspective: 1100px;
  perspective-origin: 50% 46%;
  contain: strict;
}

/* 倾斜层：整台"摄影机" */
.stage-tilt {
  position: absolute; inset: 0;
  transform-style: preserve-3d;
  transform: rotateX(calc(var(--py) * -2.2deg)) rotateY(calc(var(--px) * 2.6deg));
  will-change: transform;
}

/* 三层：transform 恒定，永不在运行时改 */
.stage-layer {
  position: absolute;
  inset: -6%;                       /* 配合下面的 scale，倾斜时不露边 */
  transform-style: preserve-3d;
  will-change: transform;
}
.layer-far  { transform: translateZ(-260px) scale(1.30); }
.layer-mid  { transform: translateZ( -60px) scale(1.14); }
.layer-near { transform: translateZ( 140px) scale(1.20); }

/* ★ filter 放在"不会动的内层"，一次栅格化后免费 */
.layer-far  .bg-image { filter: blur(3.4px) brightness(.66) saturate(.82); opacity: .92; }
.layer-mid  .bg-image { filter: blur(1.1px) brightness(.88);                     opacity: .80; }
.layer-near .bg-image { filter: brightness(1.04);                                opacity: .42; }

.bg-image {
  position: absolute; inset: 0;
  background-position: center; background-size: cover; background-repeat: no-repeat;
}

/* 指针微光：面积收到 inset:10%，不用全屏 mix-blend */
.stage-ambient {
  position: absolute; inset: 10%;
  pointer-events: none;
  opacity: calc(.10 + var(--glow) * .14);
  background: radial-gradient(
    30% 26% at calc(50% + var(--px) * 34%) calc(50% + var(--py) * 34%),
    rgba(255, 214, 150, .55), transparent 70%);
  will-change: opacity;
}

.stage-vignette {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(120% 90% at 50% 45%, transparent 38%, rgba(5,4,3,.74) 100%),
    linear-gradient(180deg, rgba(5,4,3,.55), transparent 22%, transparent 74%, rgba(5,4,3,.84));
}

@media (prefers-reduced-motion: reduce) {
  .stage-tilt { transform: none; }
  .stage-ambient { opacity: .12; }
}
```

```ts
// 驱动：单一写入口，每帧只写根节点 3 个变量
function mountParallax(root: HTMLElement) {
  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)')
  let reduce = reduceQuery.matches
  reduceQuery.addEventListener('change', (e) => { reduce = e.matches })

  let target = { x: 0, y: 0 }
  let cur = { x: 0, y: 0 }
  let prev = { x: 0, y: 0 }
  let vel = 0
  let last = performance.now()

  root.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect()
    target.x = ((e.clientX - r.left) / r.width - 0.5) * 2
    target.y = ((e.clientY - r.top) / r.height - 0.5) * 2
  })
  root.addEventListener('pointerleave', () => { target.x = 0; target.y = 0 })

  const loop = (now: number) => {
    const dt = Math.min(64, now - last); last = now
    // 帧率无关的阻尼：60fps 与 120fps 手感一致
    const k = 1 - Math.exp(-dt / (reduce ? 42 : 140))
    const tx = reduce ? 0 : target.x
    const ty = reduce ? 0 : target.y
    cur.x += (tx - cur.x) * k
    cur.y += (ty - cur.y) * k

    const d = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    prev.x = cur.x; prev.y = cur.y
    vel += (Math.min(1, d * 26) - vel) * 0.10

    root.style.setProperty('--px', cur.x.toFixed(4))
    root.style.setProperty('--py', cur.y.toFixed(4))
    root.style.setProperty('--glow', vel.toFixed(3))
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
```

### B.3 参数建议

| 层 | `translateZ` | `scale` | 视觉模糊 | 亮度 | opacity |
|---|---|---|---|---|---|
| far（天/远景） | −260 px | 1.30 | 3.4 px | 0.66 | 0.92 |
| mid（主体建筑） | −60 px | 1.14 | 1.1 px | 0.88 | 0.80 |
| near（前景遮挡） | +140 px | 1.20 | 0 | 1.04 | 0.42 |

- **倾斜幅度上限 ±2.6°**：超过 3° 会让人察觉"画面在整体转动"，而不是"我在里面看"。
- **`perspective` 建议 900–1300 px**：太小（<800）透视夸张、边角拉丝；太大（>1600）几乎看不出纵深。
- **`inset: -6%` 是安全边**：`scale(1.30)` × 倾斜 2.6° 时不会露黑边。若把 scale 降到 1.10，要改成 `inset: -10%`。

### B.4 常见错误

| 错误 | 症状 | 修法 |
|---|---|---|
| `transition: transform 120ms` 叠在 rAF 阻尼上 | 拖尾、松手后还在动、额外样式失效 | 删掉 transition，阻尼只由 rAF 负责 |
| `filter` 放在会动的层上且逐帧改半径 | 帧率腰斩（实测 48 → 22.7） | 半径恒定，filter 挪到静止子元素 |
| 全屏 `mix-blend-mode: screen` 逐帧动 | 掉约 15% 帧率 | 面积收到 `inset: 10%` 内，或换 opacity |
| 每层写 `translate(calc(var(--px) * Npx))` | 帧率 16.9 | 父层旋转 + `translateZ` |
| 用 `translateZ` 但父层没 `preserve-3d` | 没有纵深，只有缩放 | `.stage-tilt` 和 `.stage-layer` 都要 `transform-style: preserve-3d` |

---

## 四、配方 C · 粒子与氛围

### 4.1 氛围的四个层次（按图层顺序，从后到前）

| 层 | 实现 | 成本 | 什么时候用 |
|---|---|---|---|
| ① 环境光 | 一个 `opacity` 驱动的径向渐变，`inset:10%`，26 s 缓动漂移 | ≈0 | 永远有，给画面"呼吸" |
| ② 景深 | 静态 `filter: blur()` + brightness，挂在各层的静止子元素上 | ≈0（烘焙） | 2.5D 场景必配 |
| ③ 颗粒 | 一张 SVG/canvas 噪声贴图，`opacity .12–.16`，`mix-blend-mode: overlay` | 低（不动） | 胶片感、遮 banding |
| ④ 天气粒子 | Canvas 2D，见下 | 中（唯一持续重绘的层） | 雨 / 灰 / 烟 / 雪 / 雾 |

### 4.2 粒子预算表（按天气类型定参数，不要一套参数走天下）

| 天气 | 数量 | 速度 | 形状 | 混合 | 生命周期 |
|---|---|---|---|---|---|
| 雨 | 90–130 | vy 6–16 px/帧 | 线段（长 10–40） | 普通，`alpha .15–.70` | 循环，出下边界重生 |
| 雪 | 60–100 | vy 0.6–2.2 + 正弦横摆 | 圆 r 0.8–2.0 | 普通 | 循环 |
| 灰（灰烬） | 50–80 | vy 0.3–1.2，**向上飘** | 圆 r 0.6–1.4 | `lighter` | 循环，`alpha` 随高度衰减 |
| 烟 | 30–45 | vy 0.2–0.8，带横向扩散 | 大圆 r 8–26，`alpha .05–.15` | `lighter` | 循环，半径随时间增大 |
| 雾 | 6–10 条 | 极慢横向 | 大椭圆渐变 | `lighter` | 循环 |

判定标准：**粒子总数 ≤ 130，且只在 ④ 这一层做 `clearRect`**。其他三层一律不动。

### 4.3 代码模板（DPR 上限 + 离屏纹理 + 零 filter）

```ts
type Weather = 'rain' | 'ash' | 'smoke' | 'snow' | 'fog' | 'none'

const PRESET: Record<Weather, { count: number; vy: [number, number]; size: [number, number]; alpha: [number, number] }> = {
  rain:  { count: 110, vy: [6, 16],  size: [0.6, 1.8], alpha: [0.15, 0.70] },
  snow:  { count:  80, vy: [0.6, 2.2], size: [0.8, 2.0], alpha: [0.20, 0.70] },
  ash:   { count:  70, vy: [0.3, 1.2], size: [0.6, 1.4], alpha: [0.12, 0.50] },
  smoke: { count:  40, vy: [0.2, 0.8], size: [8, 26],    alpha: [0.05, 0.15] },
  fog:   { count:   8, vy: [0.05, 0.2], size: [120, 240], alpha: [0.03, 0.08] },
  none:  { count:   0, vy: [0, 0],    size: [0, 0],     alpha: [0, 0] },
}

export function mountParticles(canvas: HTMLCanvasElement, weather: Weather) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  const ctx = canvas.getContext('2d', { alpha: true })!
  const dpr = Math.min(devicePixelRatio || 1, 2)      // ★ 上限 2
  let W = 0, H = 0, raf = 0, running = false

  const resize = () => {
    W = canvas.width  = Math.round(canvas.clientWidth  * dpr)
    H = canvas.height = Math.round(canvas.clientHeight * dpr)
  }
  resize()

  const cfg = PRESET[weather] ?? PRESET.none
  const rand = (a: number, b: number) => a + Math.random() * (b - a)
  const ps = Array.from({ length: cfg.count }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    vy: rand(cfg.vy[0], cfg.vy[1]) * dpr,
    vx: rand(-0.35, 0.35) * dpr,
    r: rand(cfg.size[0], cfg.size[1]) * dpr,
    a: rand(cfg.alpha[0], cfg.alpha[1]),
    phase: Math.random() * Math.PI * 2,
  }))

  const tick = () => {
    ctx.clearRect(0, 0, W, H)
    for (const p of ps) {
      p.phase += 0.01
      p.x += p.vx + Math.sin(p.phase) * 0.3 * dpr
      p.y += p.vy
      if (p.y > H + 8) { p.y = -8; p.x = Math.random() * W }
      if (weather === 'rain') {
        ctx.strokeStyle = `rgba(198,214,226,${p.a})`
        ctx.lineWidth = p.r * 0.5
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - 10 * dpr - p.r * 4); ctx.stroke()
      } else {
        ctx.fillStyle = weather === 'snow' ? `rgba(240,238,230,${p.a})`
                      : weather === 'ash'  ? `rgba(196,178,150,${p.a})`
                      :                      `rgba(120,112,100,${p.a * 0.35})`
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      }
    }
    raf = requestAnimationFrame(tick)
  }

  const start = () => { if (!running && !reduce.matches && weather !== 'none') { running = true; tick() } }
  const stop  = () => { running = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H) }

  const onVis = () => (document.hidden ? stop() : start())
  reduce.addEventListener('change', () => (reduce.matches ? stop() : start()))
  document.addEventListener('visibilitychange', onVis)
  addEventListener('resize', resize)
  start()

  return () => {
    stop()
    reduce.removeEventListener('change', start)
    document.removeEventListener('visibilitychange', onVis)
    removeEventListener('resize', resize)
  }
}
```

### 4.4 粒子的三条纪律

1. **`reduceMotion` 时不是"少画"，是"完全不画"** —— 并且要 `clearRect`，否则会留下冻结的一帧被误认为"雾气太重"。
2. **`dpr` 上限 2**。3× 或 4× 屏会让填充面积翻 2–4 倍，画质提升不可见、帧率损失显著。
3. **`document.hidden` 时必须停**。rAF 本身会暂停，但 `resize` 监听、计时器不会，切回标签页会看到粒子"瞬移"。

---

## 五、性能与无障碍红线（可勾选清单）

### 5.1 数字红线

| 指标 | 红线 | 测量方式 |
|---|---|---|
| 首屏 JS（gzip） | ≤ 250 KB | `node -e "gzipSync(fs.readFileSync(...))"` |
| 单次转场 p95 帧时长 | ≤ 20 ms | rAF 差分（见 §七） |
| 单次转场掉帧率（>20 ms） | ≤ 15% | 同上 |
| 持续视差运动 avgFps | ≥ 45（1600×1000 有头） | 同上 |
| 4× CPU 降频后 avgFps | ≥ 50 | Playwright CDP `Emulation.setCPUThrottlingRate` |
| 单个 `filter` 元素面积 | ≤ 1.5× 视口 | 目测 CSS |
| 全屏 `mix-blend-mode` 元素 | 0 个（逐帧动的） | grep `mix-blend-mode` |
| 粒子上限 | ≤ 130 | 常量 |

### 5.2 提交前必查

- [ ] `grep -n "filter" styles.css` —— 每个 `filter` 所在的元素，其 `transform` 是否恒定？
- [ ] `grep -n "mix-blend-mode" styles.css` —— 是否有全屏且逐帧变化？
- [ ] `grep -n "letter-spacing" src/` —— 是否有 `@keyframes` 里在动它？
- [ ] `grep -n "animation-timeline\|scroll-timeline" styles.css` —— 若用了，Firefox 稳定版会失效，必须有静态回退
- [ ] 每个 `opacity: 0` 的起始态，`@media (prefers-reduced-motion: reduce)` 里是否有 `opacity: 1`？
- [ ] 每个 raf 循环，`prefers-reduced-motion` 变 true 时是否真的停了？（`matchMedia` 的 `change` 事件要监听，不能只读一次）
- [ ] `document.hidden` 时粒子 / 视差是否停止？
- [ ] 关闭 JS 后，页面是否仍完整可读？
- [ ] Tab 键走一遍：焦点环是否被 `::before` 装饰层遮住？（装饰层必须 `pointer-events: none`）

### 5.3 `prefers-reduced-motion` 的三层实现

**只做 CSS 那一层是不够的**——本项目最容易漏的是 JS 直写的 CSS 变量：

```css
/* 第一层：CSS 全局兜底 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-delay: 0ms !important;
    transition-duration: .001ms !important;
  }
}
```

```ts
// 第二层：JS 侧的 rAF 分支（CSS 管不到 style.setProperty 写入的变量）
const q = matchMedia('(prefers-reduced-motion: reduce)')
let reduce = q.matches
q.addEventListener('change', (e) => { reduce = e.matches })
// 循环里： target = reduce ? { x: 0, y: 0 } : pointerTarget
```

```ts
// 第三层：进转场前短路
if (reduce) { swap(); return }        // 不做任何 canvas 绘制
```

---

## 六、低功耗 / 降级（三件事一起停）

借 `guizang-ppt-skill` 的「B 键」模式。降级不是"少画一点"，而是**一次停三样**：

```ts
export function engageLowPower() {
  document.body.dataset.lowPower = '1'

  // ① 停所有 raf
  stopParallax(); stopParticles()

  // ② 取消进行中的 Web Animations（CSS 动画与 WAAPI）
  document.getAnimations().forEach((a) => { try { a.cancel() } catch {} })

  // ③ 把所有"半透明中途态"直接推到终点，避免留下模糊/半透明的残影
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    el.style.opacity = '1'
    el.style.transform = 'none'
    el.style.filter = 'none'
  })
}
```

```css
body[data-low-power='1'] .particles,
body[data-low-power='1'] .stage-ambient,
body[data-low-power='1'] .stage-grain { display: none; }

body[data-low-power='1'] .stage-layer .bg-image { filter: none; }  /* 景深退化为纯 scale */
```

**自动触发**（帧预算守卫）：

```ts
let slow = 0
let last = performance.now()
const guard = (now: number) => {
  const dt = now - last; last = now
  slow = dt > 22 ? slow + 1 : Math.max(0, slow - 1)
  if (slow > 45) engageLowPower()        // 连续约 3 秒不达标
  requestAnimationFrame(guard)
}
```

**手动触发**：在「关于」页放一个"省电模式（关闭动效）"按钮——这同时满足 WCAG 2.2.2「超过 5 s 的动画必须可暂停」。

---

## 七、怎么量（别靠眼睛）

眼睛只能判断"顺不顺"，判断不了 16.9 与 48.0 的差别。必须有数字。

```js
// 页面内埋点：rAF 时间戳差分
const rec = []
let last = 0
const sample = (ts) => {
  if (last) rec.push(ts - last)
  last = ts
  requestAnimationFrame(sample)
}
requestAnimationFrame(sample)

// 统计
function stats(list) {
  const s = [...list].sort((a, b) => a - b)
  const sum = list.reduce((a, b) => a + b, 0)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return {
    avgFps: +(1000 / (sum / list.length)).toFixed(1),
    p50ms: +q(.5).toFixed(2),
    p95ms: +q(.95).toFixed(2),
    maxMs: +s[s.length - 1].toFixed(2),
    longFrames: list.filter((d) => d > 20).length,
    droppedPct: +((list.filter((d) => d > 20).length / list.length) * 100).toFixed(1),
  }
}
```

```js
// 用 Playwright 驱动真浏览器（★ 必须有头，无头走软件光栅会差 3 倍）
const browser = await chromium.launch({ headless: false })   // ← 关键
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }) // 低端机模拟
```

**测前必做**：
1. **统一预热**（≥1.5 s 的同等运动），否则前 2–3 个配置会被跑序系统性低估（本次实测漂移达 **±4.4 fps**）；
2. **同一配置测两次、首尾各一次**，差值就是噪声，只信差值 > 8 fps 的对比；
3. **只用有头数据下结论**。同一 demo：无头 21.8 fps，有头 67.2 fps。

---

## 八、反模式速查

| 反模式 | 为什么错 | 改成 |
|---|---|---|
| 换场用 `opacity` 交叉淡 | 新内容在旧内容之上半透明 → 字压字、图片解码闪 | 不透明幕布遮挡后 swap |
| `transition` 与 rAF 阻尼共存 | 双重平滑、松手还在飘、额外样式失效 | 只留一个 |
| 逐帧改 `filter: blur()` | 实测 2.1× 成本 | 半径恒定，烘焙到离屏纹理 |
| 每层各自 `translate()` 做视差 | 实测 2.8× 成本，且无真纵深 | 父层旋转 + 子层 `translateZ` |
| 全屏 `mix-blend-mode` 加光 | 约 15% 帧预算 | 收面积 / 换 opacity |
| `letter-spacing` 动画 | 每帧重排每个字 | 一次离散跳变，或 `scale` 模拟 |
| 用 `height` 做展开 | Layout 每帧 | grid `0fr → 1fr`，或 `scaleY` + FLIP |
| 只看 `prefers-reduced-motion` 的 CSS | 管不到 JS 写的变量 | 三层实现（§5.3） |
| 无头浏览器测帧率 | 软件光栅，差 3 倍 | 有头 + CPU 降频两档都测 |
| 无预热就开始测 | 前几组被系统性低估 | 统一预热 + 首尾复测 |

---

## 九、文件清单（本 skill 配套的可运行验证）

| 文件 | 作用 | 体积 |
|---|---|---|
| `tools/anim-lab/01-ink-transition.html` | 墨迹/雨幕转场 + 推镜，双模式可切换，自带 FPS HUD 与 `?bench` | gzip 7,489 B |
| `tools/anim-lab/02-parallax-stage.html` | 2.5D 视差因子隔离实验（tilt / blur / ambient / glow / backdrop 五个开关） | gzip 6,321 B |
| `tools/anim-lab/bench.mjs` | Playwright 驱动，输出帧率统计 + 能力探测 + gzip 体积 | — |
| `docs/research/web-animation-skills.md` | 调研报告、候选清单、实测原始数据、8 条改造建议 | — |

```bash
node tools/anim-lab/bench.mjs --headed          # 真 GPU
node tools/anim-lab/bench.mjs --headed --cpu=4  # 低端机
```
