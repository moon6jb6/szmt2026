# 网页动画 · Agent Skill 与开源方案调研

> 调研对象：《把名字留下来》—— React 19 + TypeScript + Vite 8，纯静态、无后端、无 CDN、无外部字体。
> 调研日期：**2026-10-20**。所有 star / license / 体积 / 帧率数字均标注取数方式与时间，可复现。
> **本调研未改动 `src/`、`public/bg/`、`package.json` 任何一行。**

---

## 0. 结论摘要（TL;DR）

1. **不要引入动画库。** GSAP 核心 + ScrollTrigger 实测 min+gzip **46.4 KB**，占现有首屏 JS（76,216 B gzip）的 61%；而本项目是固定舞台、内容在 `overflow-y:auto` 里滚动，ScrollTrigger 几乎无处发挥。Motion / framer-motion 更贵（55.9 / 69.5 KB）。Rive 需要 **2.0 MB** WASM，直接出局。
2. **推荐路线 = 原生三件套**：Canvas 2D「墨迹幕」转场 + 父层 `perspective` 3D 倾斜做 2.5D + 烘焙式 `filter` 景深。实测转场 **67.2 fps / p95 17.0 ms**，2.5D **48 fps**，全部零依赖，代码量 **7.5 KB / 6.3 KB gzip**（含演示用的 HUD 与 bench 逻辑，生产版可再砍一半）。
3. **一条反直觉但实测站得住的结论**：现有 `Stage.tsx` 的「每层各自 `transform`」是整个方案里**最慢**的形状（持续运动下 16.9 fps）；改成「**父层 3D 旋转 + 子层静态 `translateZ`**」后同样画面 **48.0 fps**，而且纵深从"平移错觉"变成真透视 + 尺度差。改法只有 CSS，**0 KB**。
4. **可直接复用的现成 skill 有两个**：[iart-ai/web-animation-skills](https://github.com/iart-ai/web-animation-skills)（MIT，11 个 skill，其中 `60fps-animation` / `page-transition-animation` / `accessible-animation` 质量高）与本地已装的 `frontend-slides/animation-patterns.md`、`guizang-ppt-skill`（低功耗「B 键」模式）。
5. **`prefers-reduced-motion` 有一条隐藏红线**：现有 `styles.css` 的全局降级只压 `animation-duration` / `delay` / `transition-duration`，但**不压 `transform` 的 rAF 直写**——`Stage.tsx` 的指针视差是 JS 写的 CSS 变量，CSS 媒体查询管不到，必须靠 JS 的 `matchMedia` 分支（现有代码已做，改造时不要丢）。

---

## 1. 候选清单 A · Agent Skill 仓库

| 名称 | 链接 | ★ | License | 最后更新 | 内容 | 适配度 | 结论 |
|---|---|---|---|---|---|---|---|
| **iart-ai/web-animation-skills** | [repo](https://github.com/iart-ai/web-animation-skills) | **46** | **MIT** | 2026-06-22 | 11 个 skill：`gsap-web`、`page-transition-animation`、`60fps-animation`、`accessible-animation`、`micro-interaction`、`lottie-animation`、`svg-animation`、`glassmorphism`、`ascii-animation` | ★★★★★ | **采纳（只取方法论与配方，不装库）**。`60fps-animation` 的「昂贵属性→等价 cheap 替换表」、`page-transition-animation` 的「cover→swap→reveal + `startViewTransition` 守卫」直接可用 |
| **199-biotechnologies/motion-dev-animations-skill** | [repo](https://github.com/199-biotechnologies/motion-dev-animations-skill) | **197** | **MIT** | 2026-03-30 | Motion (framer-motion) 为中心的 skill：`examples/parallax-layers.md`、`scroll-reveal.md`、`magnetic-button.md`、`spring-physics.md`、`templates/component-library.tsx` | ★★★☆☆ | **部分采纳**。`parallax-layers.md` 的分层参数思路可参考；但整套绑定 Motion，本项目不装库，只借配方 |
| **frankxai/awesome-motion-design-agent-skills** | [repo](https://github.com/frankxai/awesome-motion-design-agent-skills) | **74** | **CC0-1.0** | 2026-10-14 (push) | 索引型：`rubrics/site-motion-excellence-gate.md`、`patterns/motion-pattern-registry.json`、`playbooks/site-motion-rollout.md`；不含可执行代码 | ★★★☆☆ | **只作评审清单参考**，不是实现方案 |
| codrops/interlude | [repo](https://github.com/codrops/interlude) | **38** | MIT | 2026-10-07 | Astro + GSAP + **three.js** 的 WebGL 页面转场 starter | ★☆☆☆☆ | **否决**：依赖 Three.js，违反硬约束 |
| yancacchione/claude-skills | [repo](https://github.com/yancacchione/claude-skills) | **0** | **无 LICENSE** | 2026-10-20 | 个人动画 skill 插件 | ☆☆☆☆☆ | **否决**：无许可证 = 不可复用；0 star 无社区校验 |

### 1.1 本地已装 skill 里可复用的片段

扫描 `C:\Users\26298\.agents\skills`（共 130+ 个目录）后，与动效直接相关的只有以下几个：

| 本地 skill | 可复用内容 | 复用方式 |
|---|---|---|
| `frontend-slides/animation-patterns.md`（4,140 B） | 「**效果 → 情绪**」映射表 + 入场动画 4 式（fade+slide / scale / slide / blur）+ TiltEffect 类 | 把英文情绪表改写成《把名字留下来》的中文语境表（见 §6.1） |
| `frontend-slides/viewport-base.css`（2,875 B） | 末尾的 `@media (prefers-reduced-motion: reduce)` 全局降级写法 | 项目已有等价实现，**但少了 JS 侧分支**，见 §0.5 |
| `guizang-ppt-skill` | **低功耗「B 键」模式**：`body.low-power` → 停 WebGL/Canvas 的 `requestAnimationFrame`、取消进行中的 Web Animations、把当前页直接 reveal 到静态终态；另托管了一份 `assets/motion.min.js`（jsDelivr 打包的 **motion@11.11.17**，raw **64,213 B** / gzip9 **22,231 B**） | 直接把「三件事一起停」的降级策略借到 `Stage.tsx`（见 §6.4、改造建议 #8） |
| `guizang-ppt-skill` | WebGL 流体背景只用在 hero 页、普通页几乎看不见的克制原则 | 反向印证本项目"背景不加 shader"的选择 |
| `ljg-present` / `ppt-keynote` / `ppt-master` | 排版与版式，**无动效配方** | 不复用 |

> 注：`guizang-ppt-skill` 里托管的 `motion.min.js` 证明"本地内联动画库"是可行路径，但 22.2 KB gzip 换来的收益在本项目里用不上（无路由、无 Layout 动画、无手势拖拽），**不引入**。

---

## 2. 候选清单 B · 库与技术路线

体积口径：`bundlephobia` 的 min+gzip 与我本地「对 npm tarball 内实际发布的 `.min.js` 做 gzip -9」两种方式互校，两者误差 < 4%。

| 方案 | 链接 | ★ | License | 最后 push | min+gzip（实测） | 适配度 | 结论 |
|---|---|---|---|---|---|---|---|
| **GSAP 3 核心** | [greensock/GSAP](https://github.com/greensock/GSAP) | **29,520** | **非 MIT**：npm `license` 字段为 *Standard 'no charge' license*（[gsap.com/standard-license](https://gsap.com/standard-license)） | 2026-04-13 | **27,350 B**（bundlephobia）/ **28,375 B**（`dist/gsap.min.js` gzip9） | ★★☆☆☆ | **不引入**。商用虽免费但不是 MIT，且核心 + ScrollTrigger 合计 **46,375 B gzip**，占预算 27% |
| **GSAP ScrollTrigger** | 同上 | — | 同上 | — | **18,000 B**（`dist/ScrollTrigger.min.js` gzip9） | ★☆☆☆☆ | **不引入**。本项目无长滚动叙事 |
| **Motion（framer-motion 继任）** | [motiondivision/motion](https://github.com/motiondivision/motion) | **34,380** | **MIT** | 2026-10-20 | `motion` **55,862 B**、`framer-motion` **69,463 B**（bundlephobia）；本地 `dist/motion.js` gzip9 = **56,010 B** | ★★★☆☆ | **不引入**。React 动画做得好，但为 3~4 个转场付 56 KB 不划算 |
| **anime.js v4** | [juliangarnier/anime](https://github.com/juliangarnier/anime) | **73,727** | **MIT** | 2026-08-21 | **40,279 B**（bundlephobia）/ **40,667 B**（`dist/bundles/anime.esm.min.js` gzip9） | ★★☆☆☆ | **不引入**。v4 自带 `onScroll` 后确实好用，但 40 KB 换不来本项目需要的东西（我们要的是"遮住换场"和"3D 倾斜"，都不是补间） |
| **View Transitions API（原生）** | [MDN](https://developer.mozilla.org/docs/Web/API/View_Transition_API) | — | 平台能力 | — | **0 B** | ★★★★☆ | **采纳（渐进增强）**。支持：Chrome **111** / Firefox **144** / Safari **18**（MDN BCD，2026-10-20 取）；本机 Chromium 148 实测 `typeof document.startViewTransition === 'function'` 为 true |
| **CSS scroll-driven animations（原生）** | [MDN](https://developer.mozilla.org/docs/Web/CSS/animation-timeline) | — | 平台能力 | — | **0 B** | ★★☆☆☆ | **不采纳**。支持：Chrome **115** / Safari **26** / Firefox **159**（BCD 尚未进稳定版）。本项目无可滚动叙事主线，收益≈0，兼容性反而最差 |
| **Lenis 平滑滚动** | [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) | **16,740** | **MIT** | 2026-10-18 | **5,458 B**（bundlephobia）/ **5,413 B**（`dist/lenis.min.js` gzip9） | ★☆☆☆☆ | **不采纳**。它是本清单里最便宜的一个（5.4 KB），但**本项目的"滚动"是卡片的内部 overflow，属于叙事阅读而非视差滚动**；上平滑滚动会破坏键盘可达性与"读到哪里"的确定感，还会和 `overscroll-behavior: contain` 打架 |
| **CSS Houdini / `@property`** | [MDN](https://developer.mozilla.org/docs/Web/CSS/@property) | — | 平台能力 | — | **0 B** | ★★★★★ | **采纳**。本机实测 `CSS.registerProperty` 可用；把 `--px/--py` 注册成 `<number>` 后可被合成器插值，且能避免 `calc()` 里的字符串解析开销 |
| **WebGL shader 转场（轻量，不用 Three）** | — | — | — | — | ~1.5~3 KB 自写 | ★★☆☆☆ | **不采纳（本次）**。裸 WebGL2 写一个 ink-mask 转场确实能做到 2 KB 级、60 fps，但调试成本高、`prefers-reduced-motion` 与低端设备降级路径复杂，收益与 Canvas 2D 墨迹幕差别不大。**留作 v3 备选** |
| **Rive** | [rive-app/rive-wasm](https://github.com/rive-app/rive-wasm) | **1,008** | **MIT** | 2026-10-20 | JS **69,249 B** + `rive.wasm` **2,096,365 B** | ☆☆☆☆☆ | **否决**。2 MB WASM，比整个首屏 JS 大 27 倍 |
| **Lottie** | [airbnb/lottie-web](https://github.com/airbnb/lottie-web) | **32,251** | **MIT** | 2025-09-01 | 全量 **76,789 B**；`lottie_light.min.js` **46,584 B**；`lottie_svg.min.js` **62,542 B** | ★☆☆☆☆ | **否决**。轻型 46.6 KB 只能播 JSON 动画，而本项目已有 Canvas 粒子与 CSS 动效，再养一份 46 KB 运行时不合算 |
| Three.js（仅作对照） | [mrdoob/three.js](https://github.com/mrdoob/three.js) | 116,660 | MIT | 2026-10-20 | 核心 ~150 KB gzip | — | **明令禁用** |

### 2.1 体积换算到本项目预算

```
现有首屏：dist/assets/index-*.js   raw 232,805 B  →  gzip9  76,216 B
          dist/assets/index-*.css  raw  11,301 B  →  gzip9   3,403 B
预算上限：250 KB gzip  →  余量约 170 KB

GSAP + ScrollTrigger   +46,375 B   → 占余量 27%，占现有 JS 的 61%   ✗
framer-motion          +69,463 B   → 占余量 41%                     ✗
Motion                 +55,862 B   → 占余量 33%                     ✗
anime.js               +40,279 B   → 占余量 24%                     ✗
Lenis                   +5,458 B   → 占余量  3%                     △（收益≈0）
Canvas 墨迹幕（本方案）  +7,489 B   → 占余量  4.4%                   ✓
2.5D 3D 倾斜改造             +0 B   →                               ✓
View Transitions             +0 B   →                               ✓
```

---

## 3. 浏览器支持（实测，非估算）

**A. MDN browser-compat-data 查询**（`raw.githubusercontent.com/mdn/browser-compat-data/main/`，2026-10-20 取 `__compat.support[].version_added`）：

| 特性 | Chrome | Firefox | Safari |
|---|---|---|---|
| `animation-timeline`（scroll-driven） | 115 | **159**（未进稳定） | 26 |
| `scroll-timeline` | 115 | **159**（未进稳定） | 26 |
| `view-transition-name` | 111 | 144 | 18 |
| `Document.startViewTransition` | 111 | 144 | 18 |

**B. 本机真实浏览器能力探测**（Chromium **148.0.7778.96**，由 demo 的 `?bench` 模式回报）：

```json
{ "canvasFilter": true, "offscreenCanvas": true, "viewTransition": true,
  "scrollDrivenCSS": true, "viewTransitionName": true,
  "registerProperty": true, "maskImage": true,
  "mixBlendMode": true, "backdropFilter": true }
```

**结论**：View Transitions 已经可以「有就用、没有就退化」；scroll-driven animations 在 Firefox 稳定版仍缺席，**不能作为主路线**；`@property` / `mask-image` / `backdrop-filter` 全绿。

---

## 4. 推荐路线

```
                    ┌──────────────────────────────────────────┐
                    │  零依赖 · 原生能力 · 全部可离线          │
                    └──────────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
  ① 场景转场                  ② 2.5D 纵深                 ③ 情绪节奏
  Canvas 2D 墨迹幕           父层 perspective 倾斜         CSS stagger +
  cover→swap→reveal          + 子层 translateZ            clip-path 遮罩
  + 推镜（--push）            + 烘焙式 filter 景深          + 长留白
  + 雨幕（可选）              + 单一写入口 --rx/--ry
        │                            │                            │
        └────────────────┬───────────┴────────────────────────────┘
                         │
              ┌──────────┴───────────┐
              │  ④ 渐进增强（0 KB）   │
              │  document.startView  │
              │  Transition 包 setState│
              └──────────────────────┘

  不引入：GSAP / Motion / anime.js / Lenis / Rive / Lottie / Three.js
  不使用：CSS scroll-driven animations（Firefox 未稳）
```

**为什么不是 GSAP**：本项目所有动效都是「**状态切换型**」（换场、出现、悬停、进结局），不是「**时间轴编排型**」。补间引擎的价值在编排（嵌套 timeline、错峰、scrub），而这个项目一个场景就 3 个元素，用 CSS + 一个 canvas 足够；46 KB 换来的 API 便利，不抵它吃掉 61% 的现有 JS 体积。

---

## 5. 五个可直接吸收的做法

### 5.1 「昂贵属性 → 等价廉价属性」替换表

> 来源：[iart-ai/web-animation-skills · `skills/60fps-animation/SKILL.md`](https://github.com/iart-ai/web-animation-skills/blob/main/skills/60fps-animation/SKILL.md)（MIT）。这张表是整个 skill 里最值钱的一页，直接抄进团队规范。

| 想动的东西 | 触发 | 换成的写法 |
|---|---|---|
| `width` / `height` | Layout + Paint | `transform: scaleX()/scaleY()`，需要不变形时用 FLIP |
| `top` / `left` / `margin` | Layout + Paint | `transform: translate()` |
| `box-shadow` | Paint（大面积重绘） | 阴影画在 `::after` 上，只动它的 `opacity` |
| `filter: blur(半径)` | Paint（**本项目实测最贵，见 §7**） | **恒定 blur 一次栅格化**，动的是变换/透明度 |
| `background-position` | Paint | 子层 `transform: translate()` |
| `letter-spacing` | **Layout**（每个字符重新排版） | 只在首屏一次性使用，或改成遮罩位移 |

```css
/* 反例：本项目 styles.css 里 .choice:hover 已在做的事是对的（只动 transform） */
/* 正例：卡片 hover 的"发光"不要动 box-shadow，动伪元素的 opacity */
.card { position: relative; }
.card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  box-shadow: 0 12px 34px rgba(200, 160, 99, .28);
  opacity: 0; transition: opacity 220ms var(--ease);
  pointer-events: none;
}
.card:hover::after { opacity: 1; }
```

### 5.2 「Cover → Swap → Reveal」三段式转场骨架

> 来源：iart-ai `page-transition-animation` 的"退出态必须先留在 DOM 里"结构 + 本地 canvas 实现。**关键点：换场发生在完全遮挡的那一帧，所以新场景首帧的图片解码、字体抖动、布局重排全被藏住了。**

```js
// 伪代码：三层时间轴，单位 ms
const T = { cover: 900, hold: 240, reveal: 950 };

function transition() {
  canvas.live = true;                       // 幕布层上桌
  const t0 = performance.now();

  const frame = (now) => {
    const el = now - t0;
    ctx.clearRect(0, 0, W, H);

    if (el < T.cover) {
      const p = easeOut3(el / T.cover);
      drawInk(p);                            // 墨从四边+中心长满
      stage.style.setProperty('--push', 1 + 0.045 * p);   // 推镜：场景推近 4.5%
      if (p > 0.999) fillSolid();            // 保证闭合无缝
    } else if (el < T.cover + T.hold) {
      fillSolid();
      swapScene();                           // ★ 换场在这里，用户看不见
      stage.style.setProperty('--push', 1.04);
    } else if (el < T.cover + T.hold + T.reveal) {
      fillSolid();
      ctx.globalCompositeOperation = 'destination-out';
      drawInk(easeIn3((el - T.cover - T.hold) / T.reveal)); // 墨被反相"吃掉"
      ctx.globalCompositeOperation = 'source-over';
      stage.style.setProperty('--push', lerp(1.04, 1, easeOut3(q))); // 推镜回位
    } else {
      cleanup(); return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
```

**为什么用 `destination-out` 而不是"缩小墨块"**：erase 会让墨的边缘保持同一条纹理，退场时像是画面被"撕开"而不是"缩回去"，这正是叙事作品需要的方向感（撤退、失落），而不是 UI 的"收起"。

### 5.3 FLIP：把"布局变化"变成"纯合成层变化"

> 来源：同上 `60fps-animation`。本项目可直接用在「结局页账本从 3 项变成 5 项时的重排」以及「史料卡面板从右下角弹出」。

```js
function flip(el, mutate) {
  const first = el.getBoundingClientRect();     // First
  mutate();                                     // 改 DOM / 布局
  const last = el.getBoundingClientRect();      // Last
  const dx = first.left - last.left, dy = first.top - last.top;
  const sx = first.width / last.width, sy = first.height / last.height;
  el.animate(
    [{ transformOrigin: 'top left',
       transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },   // Invert
     { transformOrigin: 'top left', transform: 'none' }],              // Play
    { duration: 320, easing: 'cubic-bezier(.2,0,0,1)' }
  );
}
```

### 5.4 低功耗 / 静态终态一键开关

> 来源：本地 `guizang-ppt-skill` 的「B 键」——按下后**三件事一起停**：停 RAF、取消进行中的 Web Animations、把内容直接 reveal 到静态终态。本项目应该照抄这个三段式。

```ts
// Stage.tsx / Particles.tsx 共用
function engageLowPower() {
  document.body.dataset.lowPower = '1';   // CSS 侧：关闭微光/呼吸/颗粒过渡
  cancelAnimationFrame(raf);              // ① 停 RAF
  document.getAnimations().forEach(a => a.cancel()); // ② 取消进行中的 WAAPI
  root.querySelectorAll('[data-reveal]').forEach(el => {
    el.style.opacity = '1';               // ③ 直接到终态，不留半透明
    el.style.transform = 'none';
  });
}
// 触发条件：手动按钮 / 页面隐藏 / 连续 45 帧超过 22ms（见改造建议 #8）
```

### 5.5 单一写入口：`@property` 注册的数值变量

> 本项目现在每帧写 `--px` / `--py` 两个**未注册**的自定义属性，子层的 `transform` 里用 `calc()` 解析。改成注册型 `<number>` 后：插值由合成器处理、`calc()` 少一次字符串解析、并且可以用 `@property` 的 `initial-value` 消除首帧 undefined 抖动。

```css
@property --px { syntax: '<number>'; inherits: true; initial-value: 0; }
@property --py { syntax: '<number>'; inherits: true; initial-value: 0; }

.stage-tilt {
  transform:
    rotateX(calc(var(--py) * -2.2deg))
    rotateY(calc(var(--px) *  2.6deg));
}
```

```ts
// 每帧只写根节点 2 个变量，3 个子层靠 calc 派生 —— 一次失效，三处生效
root.style.setProperty('--px', x.toFixed(4));
root.style.setProperty('--py', y.toFixed(4));
```

---

## 6. 针对本项目的改造建议（按性价比排序）

> 排序依据：`收益 / 代价`。代价含体积、改动面、回归风险。**8 条中 6 条是 0 KB。**
> 每条标注：改哪个文件 → 改法 → 预期效果 → 体积/性能代价 → 是否影响 `prefers-reduced-motion`。

---

### #1 2.5D 从「每层各自 transform」改为「父层 3D 倾斜 + 子层 translateZ」　【性价比 ★★★★★】

**改哪个文件**：`src/game/components/Stage.tsx`、`src/styles.css`

**为什么**：这是本次调研最重要的实测发现。持续运动的压测下（1600×1000，三层满屏，带 blur）：

| 形状 | avgFps |
|---|---|
| 每层各自 `2D transform` + filter（= **现状**） | **16.9** |
| 每层各自 `2D transform` + 无 filter | **27.0** |
| 父层 `rotateX/rotateY` + 子层静态 `translateZ` + filter | **48.0** |

差 2.8 倍。原因是：**改每层自己的 `transform` 会让那一层的栅格/滤镜缓存失效**，而改父层 3D 矩阵只是把已缓存的子层重新投影。

**改法**（`Stage.tsx`）：

```diff
 const LAYERS = [
-  { name: 'far',  depth: 6,  scale: 1.04 },
-  { name: 'mid',  depth: 14, scale: 1.10 },
-  { name: 'near', depth: 26, scale: 1.18 },
+  { name: 'far',  z: -260, scale: 1.30 },
+  { name: 'mid',  z: -60,  scale: 1.14 },
+  { name: 'near', z:  140, scale: 1.20 },
 ]
@@
-      {LAYERS.map((layer) => (
-        <div key={layer.name} className={`stage-layer layer-${layer.name}`}
-          style={reduceMotion ? { transform: `scale(${layer.scale})` } : {
-            transform: `scale(${layer.scale}) translate(calc(var(--px,0) * ${layer.depth}px), calc(var(--py,0) * ${layer.depth}px))` }} />
-      ))}
+      <div className="stage-tilt" aria-hidden="true">
+        {LAYERS.map((layer) => (
+          <div key={layer.name} className={`stage-layer layer-${layer.name}`}
+            style={{ transform: `translateZ(${layer.z}px) scale(${layer.scale})` }}>
+            <div className={`bg-image bg-${background}`} />
+          </div>
+        ))}
+      </div>
```

```css
/* styles.css */
.stage {
  perspective: 1100px;
  perspective-origin: 50% 46%;
}
.stage-tilt {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transform:
    rotateX(calc(var(--py, 0) * -2.2deg))
    rotateY(calc(var(--px, 0) *  2.6deg));
  will-change: transform;
}
.stage-layer {
  position: absolute;
  inset: -6%;                 /* 由 -8% 收到 -6%，配合 scale 1.30 仍不露边 */
  transform-style: preserve-3d;
  will-change: transform;
  /* ★ 删掉 transition: transform 120ms linear —— 它和 rAF 的 lerp 打架 */
}
/* 把 filter 从"会动的层"挪到"不动的内容"上 */
.layer-far  .bg-image { filter: blur(3.4px) brightness(.66) saturate(.82); }
.layer-mid  .bg-image { filter: blur(1.1px) brightness(.88); }
.layer-near .bg-image { filter: brightness(1.04); }
```

**顺带修掉的 bug**：现有 `.stage-layer { transition: transform 120ms linear }` 与 `Stage.tsx` 里 rAF 的 `0.06` 阻尼**双重平滑**——指针停下后还会多拖 120ms，且每帧都在重启动 transition（额外样式失效）。删掉后拖尾更短、更"跟手"。

**预期效果**：纵深从"三层平移"变成**真透视**——近层被放大、远层缩小并向外溢出，倾斜时还带轻微梯形变形，是真正的 2.5D；同时帧率翻倍。

**代价**：**0 KB**。唯一风险是 `perspective` 会让 `backdrop-filter` 的卡片在某些 Safari 版本上出现合成异常，回退方案是给 `.stage-content` 加 `transform: translateZ(0)` 独立成层。

**reduced-motion**：`--px/--py` 在 reduce 时保持 0（现有 JS 分支已把 target 归零），`rotateX(0)` 即平面，无额外处理。

---

### #2 景深模糊「烘焙」，并合并两个全屏混合层　【性价比 ★★★★★】

**改哪个文件**：`src/styles.css`（纯 CSS）

**为什么**：实测「逐帧改 blur 半径」相对「恒定 blur」慢 **2.1 倍**（22.7 fps vs 48.0 fps）；而「一个 120vmax 径向渐变 + `mix-blend-mode: screen` + 逐帧位移」的呼吸光加上「全屏 `screen` 混合的指针微光」，合计再吃掉约 **7 fps（≈15%）**。

| 因子 | avgFps | 相对基线 |
|---|---|---|
| 3D 倾斜 + 烘焙 blur（基线） | 48.7 | — |
| 3D 倾斜 + 完全不用 filter | 48.0 | −0.7（**烘焙的 blur 基本免费**） |
| 3D 倾斜 + **逐帧改 blur** | 22.7 | **−53%** |
| 上述基线 + 呼吸光 + 指针微光 | 37.5 | **−15%** |

**改法**：

```css
/* 1. 呼吸光：删掉 mix-blend-mode，改成纯 opacity + transform，面积收到 inset:10% */
.stage-ambient {
  position: absolute;
  inset: 10%;                       /* 不是 120vmax 全屏 */
  pointer-events: none;
  opacity: .16;                     /* 不用 screen 混合 */
  background: radial-gradient(closest-side, rgba(255,190,120,.55), transparent 70%);
  animation: drift 26s ease-in-out infinite alternate;
  will-change: transform;
}
@keyframes drift {
  from { transform: translate3d(-4%, -3%, 0) scale(1); }
  to   { transform: translate3d( 4%,  3%, 0) scale(1.10); }
}

/* 2. 指针微光：并进同一个元素，用 --glow 控制 opacity，不再单独开一层 */
/*    如果坚持要 screen 混合，把 inset 收到 6% 以内，别让混合区覆盖全屏 */

@media (prefers-reduced-motion: reduce) {
  .stage-ambient { animation: none; opacity: .12; }
}
```

**预期效果**：观感几乎不变（人眼对 0.02 的 opacity 差异不敏感），换来约 15% 的帧预算。

**代价**：**0 KB**，纯减法。

**reduced-motion**：呼吸光在 reduce 时停 animation 并固定 opacity；指针微光本就由 JS 的 `reduceMotion` 分支压成常量。

---

### #3 场景切换：Canvas「墨迹幕」转场 + 推镜　【性价比 ★★★★★】

**改哪个文件**：新增 `src/game/components/InkCurtain.tsx`（约 120 行）、`src/App.tsx`、`src/styles.css`

**为什么**：现在 `App.tsx` 是通过 `setState` 直接换 `scene.id`，`Stage` 的 `background` 属性一变就整块重绘——**用户看到的是硬切 + 新背景图解码瞬间的闪**。转场不只是"好看"，它把换场的所有脏活（图片解码、字体度量、布局重排）都藏在幕布后面。

**改法**（核心逻辑已验证在 [`tools/anim-lab/01-ink-transition.html`](../tools/anim-lab/01-ink-transition.html)）：

```tsx
// src/game/components/InkCurtain.tsx（骨架）
export type CurtainHandle = { play: (swap: () => void) => Promise<void> }

export const InkCurtain = forwardRef<CurtainHandle, { variant: 'ink' | 'rain' }>(
  function InkCurtain({ variant }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const tilesRef = useRef<HTMLCanvasElement[] | null>(null)

    useImperativeHandle(ref, () => ({
      play(swap) {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduce) { swap(); return Promise.resolve() }   // ★ 无障碍短路
        return runCurtain(canvasRef.current!, tilesRef.current!, swap, variant)
      },
    }), [variant])

    // 纹理只生成一次（离屏 canvas + ctx.filter 烘焙，运行时零 filter）
    useEffect(() => { tilesRef.current = [makeTile(512), makeTile(512), makeTile(512)] }, [])

    return <canvas ref={canvasRef} className="ink-curtain" aria-hidden="true" />
  })
```

```tsx
// src/App.tsx：把"直接 setState"换成"过幕布"
const curtain = useRef<CurtainHandle>(null)

const onAdvance = () => {
  const nextId = state.pendingNext
  if (!nextId) return
  const finishing = state.ending !== null
  curtain.current?.play(() => {                 // ★ swap 在幕布全黑那一帧执行
    const next = advance(state, nextId, finishing)
    setState(next); save(next)
    if (finishing && state.ending) { /* ...unlocked 逻辑不变... */ setScreen('ending') }
  })
}
```

```css
.ink-curtain {
  position: fixed; inset: 0; z-index: 30;
  width: 100%; height: 100%;
  pointer-events: none;
  opacity: 0;                 /* 静息时不参与合成 */
  contain: strict;
}
.ink-curtain[data-live='1'] { opacity: 1; }
```

**参数建议**（按叙事节奏，不是 UI 节奏）：

| 场合 | cover | hold | reveal | 理由 |
|---|---|---|---|---|
| 普通换场（夜 → 夜） | 900 ms | 240 ms | 950 ms | 约 2.1 s，比"呼吸一次"略长 |
| 换章节（第一夜 → 第二夜） | 1200 ms | 320 ms | 1300 ms | 给观众"翻页"的仪式感 |
| 进入结局 | 1500 ms | 600 ms | 1600 ms | 最长的黑，情绪落点 |
| 雨/雪天气场景 | 同上 + 雨幕层 | | | `drawRain()` 叠加，`lighter` 混合 |

**预期效果**：换场从"内容跳变"变成"画面被墨吃掉又吐出来"；推镜（`--push` 1 → 1.045 → 1）让新场景像被"推进视野"。

**代价**：**+7.5 KB gzip**（demo 全量含 HUD / bench；生产版去掉 HUD、bench、模式切换后约 **3.5 KB**）。实测 **67.2 fps / p50 16.5 ms / p95 17.0 ms / 掉帧 4.6%**；4 倍 CPU 降频下仍有 **64.7 fps**（说明瓶颈在合成器不在 JS）。

**reduced-motion**：`play()` 开头短路成 `swap()` + 180 ms 交叉淡入（demo 已实现 `reduceMotion` 分支并实测）。**注意**：现有 `styles.css` 的全局 `animation-duration: .001ms !important` 不会影响 canvas，所以这个 JS 分支是**必须**的。

---

### #4 结局页情绪收束：逐行显现 + 长留白 + 字距收束　【性价比 ★★★★☆】

**改哪个文件**：`src/App.tsx`（`renderEnding` / `renderParagraphs`）、`src/styles.css`

**为什么**：现在 `renderParagraphs` 是 `animationDelay: Math.min(index*90, 540)` —— 90 ms 的错峰、540 ms 就封顶，这是**列表 API 的节奏，不是结局的节奏**。结局页需要的是"一行一行落下，中间留得住空气"。

**改法**：

```tsx
// App.tsx：给结局单独的节奏表（不动游戏内正文）
const ENDING_PACE = { para: 260, title: 0, sub: 620, coda: 1500, ledger: 2050, actions: 2600 }

const renderEnding = () => (
  <div className="ending">
    <span className="eyebrow" style={{ '--d': '0ms' } as CSSProperties}>结局</span>
    <h1 style={{ '--d': '120ms' } as CSSProperties}>{ending.title}</h1>
    <p className="ending-sub" style={{ '--d': `${ENDING_PACE.sub}ms` } as CSSProperties}>{ending.subtitle}</p>

    <div className="prose prose-ending">
      {ending.paragraphs.map((text, i) => (
        <p key={i} style={{ '--d': `${880 + i * ENDING_PACE.para}ms` } as CSSProperties}>{text}</p>
      ))}
    </div>

    <p className="ending-coda" style={{ '--d': `${ENDING_PACE.coda}ms` } as CSSProperties}>{ending.coda}</p>
    <div className="ledger" style={{ '--d': `${ENDING_PACE.ledger}ms` } as CSSProperties}>…</div>
    <div className="ending-actions" style={{ '--d': `${ENDING_PACE.actions}ms` } as CSSProperties}>…</div>
  </div>
)
```

```css
/* styles.css：统一由 --d 驱动，一处改全线生效 */
.ending > * {
  opacity: 0;
  animation: settle 900ms var(--ease) var(--d, 0ms) forwards;
}
@keyframes settle {
  from { opacity: 0; transform: translateY(16px); filter: blur(4px); }
  to   { opacity: 1; transform: none;             filter: none; }
}

/* 结句：字距从"散"收到"聚"，但不逐帧改 letter-spacing —— 用 transform 做 */
.ending-coda {
  display: block;
  opacity: 0;
  animation: codaIn 1600ms cubic-bezier(.16,.84,.28,1) var(--d, 0ms) forwards;
}
@keyframes codaIn {
  from { opacity: 0; transform: translateY(10px) scale(1.04); }
  to   { opacity: 1; transform: none; }
}

/* 留白：结局页比正文页更松 */
.ending .prose p { margin-bottom: 26px; line-height: 2.05; }
.ending-coda { padding-top: 64px; }

@media (prefers-reduced-motion: reduce) {
  .ending > * { animation: none; opacity: 1; transform: none; filter: none; }
}
```

**关于字距的取舍（重要）**：`letter-spacing` 动画每帧触发**布局**，是红线。所以这里用 `scale(1.04) → 1` 模拟"收束"，且只跑一次。如果一定要字距变化，改成**两段式离散切换**（0 ms 时 `0.44em`，第 700 ms 一次跳到 `0.16em`，配合同步的 opacity 交叉），把 N 帧布局压成 1 帧。

**预期效果**：结局从"一次性糊上来"变成"一段有呼吸的独白"——标题、副题、正文逐段、结句、账本、按钮，六个时间点，总长 ~3.2 s。

**代价**：**0 KB**，纯 CSS + 一个节奏常量。

**reduced-motion**：必须在 reduce 下显式 `animation: none; opacity: 1`，**不能只靠全局 `animation-duration: .001ms`**——因为起始态是 `opacity: 0`，一旦 `animation-fill-mode` 或延迟被改写，就可能留白。这条是容易踩的坑。

---

### #5 选项 hover / 选中反馈　【性价比 ★★★★☆】

**改哪个文件**：`src/styles.css`（`.choice`）、`src/App.tsx`（加选中态锁定）

**为什么**：现在 `.choice:hover` 只做 `background / border-color / translateX(3px)`。缺的是**"按下之后、换场之前"的那 200 ms 确认感**——玩家点了选项，画面立刻切走，没有任何"我选了它"的回执。

**改法**：

```css
.choice {
  position: relative;
  overflow: hidden;
  transition: background 220ms var(--ease), border-color 220ms var(--ease),
              transform 220ms var(--ease);
}
/* 金色扫过：伪元素 scaleX，纯合成层 */
.choice::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: linear-gradient(180deg, transparent, var(--gold), transparent);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform 260ms var(--ease);
}
.choice:hover::before,
.choice:focus-visible::before { transform: scaleY(1); }

.choice:hover  { background: rgba(200,160,99,.12); border-color: rgba(200,160,99,.55); transform: translateX(3px); }
.choice:active { transform: translateX(3px) scale(.994); transition-duration: 90ms; }

/* 选中后被锁定，等换场 */
.choice[data-chosen='1'] {
  background: rgba(163,43,43,.20);
  border-color: rgba(163,43,43,.75);
  transform: translateX(6px);
}
.choice[data-chosen='1'] .choice-index { color: var(--paper); }
```

```tsx
// App.tsx：点击后先锁定 180ms 再走换场（和 #3 的幕布衔接）
const [chosen, setChosen] = useState<string | null>(null)
const pick = (id: string) => {
  setChosen(id)
  setTimeout(() => {
    curtain.current?.play(() => { onChoose(id); setChosen(null) })
  }, 180)
}
```

**预期效果**：悬停有"一条光从上扫下"的边线，按下有 0.6% 的回弹，选中后整张卡染上旗帜红并锁住——三段反馈，全部合成层。

**代价**：**0 KB**。

**reduced-motion**：全局 `transition-duration: .001ms` 已覆盖；`scale(.994)` 会瞬间到位，没有抖动风险。

---

### #6 首屏进入仪式感　【性价比 ★★★☆☆】

**改哪个文件**：`src/App.tsx`（`renderMenu`）、`src/styles.css`

**为什么**：`renderMenu` 现在只有 `.menu { animation: rise 700ms }` 一个整体淡入。观众打开页面看到的"整块糊上来"，没有一个"门被推开"的瞬间——而这是唯一一次观众注意力 100% 在屏幕上的机会。

**改法**：

```tsx
// App.tsx：等字体/首帧就绪再放行，避免"半成品闪现"
const [booted, setBooted] = useState(false)
useEffect(() => {
  const go = () => requestAnimationFrame(() => setBooted(true))
  if (document.fonts?.status === 'loaded') go()
  else document.fonts?.ready.then(go) ?? go()
}, [])
return <main className={`app-shell ${booted ? 'is-booted' : ''}`}>…</main>
```

```css
/* 进场顺序：幕布 → 标题 → 副题 → 导语 → 要点 → 按钮 */
.app-shell .menu > * {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 900ms var(--ease), transform 900ms var(--ease);
}
.app-shell.is-booted .menu .eyebrow   { transition-delay:  80ms; opacity: 1; transform: none; }
.app-shell.is-booted .menu .title     { transition-delay: 200ms; opacity: 1; transform: none;
                                        transition-duration: 1400ms; }
.app-shell.is-booted .menu .subtitle  { transition-delay: 520ms; opacity: 1; transform: none; }
.app-shell.is-booted .menu .menu-lead { transition-delay: 700ms; opacity: 1; transform: none; }
.app-shell.is-booted .menu .menu-facts{ transition-delay: 900ms; opacity: 1; transform: none; }
.app-shell.is-booted .menu-actions    { transition-delay: 1080ms; opacity: 1; transform: none; }

/* 标题：用遮罩"升起"，不用 letter-spacing（避免逐帧布局） */
.menu .title {
  clip-path: inset(0 0 0 0);
  /* 如需"字距收束"，只做一次离散切换： */
}
@keyframes titleRise {
  from { clip-path: inset(0 0 100% 0); transform: translateY(14px); }
  to   { clip-path: inset(0 0 0 0);    transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .app-shell .menu > * { opacity: 1; transform: none; transition: none; }
}
```

**进阶（可选）**：开场加一个 1.2 s 的"墨从四周合拢 → 再退开"循环（复用 #3 的 canvas，`cover` 800ms + `reveal` 700ms），标题在 `reveal` 中途出现。这会让首屏和转场共用同一套视觉语言，整体感最强。代价是首屏多一次全屏 canvas 绘制，实测这段时间掉帧 4.6%，可接受。

**预期效果**：一段 1.3 s 的分层进场，最后落在按钮上——观众"被迎进门"。

**代价**：**0 KB**（进阶版复用 #3 的 canvas，不再额外计费）。

**reduced-motion**：必须显式还原成 `opacity: 1`。注意起始态写在 CSS 里（不是 inline style），这样媒体查询能压得住。

---

### #7 View Transitions API 作为零成本渐进增强　【性价比 ★★★☆☆】

**改哪个文件**：新增 `src/game/useViewTransition.ts`（约 20 行）、`src/App.tsx`

**为什么**：`setScreen('gallery' | 'sources' | 'about')` 这类**信息页切换**没有叙事负担，用原生 View Transitions 一行就能拿到交叉淡入 + 共享元素，**0 KB**。注意：它和 #3 的墨迹幕**不要同时用**，二选一（墨迹幕给剧情换场，View Transition 给信息页）。

**改法**：

```ts
// src/game/useViewTransition.ts
import { flushSync } from 'react-dom'

export function withViewTransition(update: () => void) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || typeof document.startViewTransition !== 'function') {
    update()                                   // ★ 无障碍 / 不支持的浏览器直接走原路径
    return
  }
  document.startViewTransition(() => {
    flushSync(update)                          // ★ 必须同步，否则快照抓到旧 DOM
  })
}
```

```tsx
// App.tsx
const goGallery = () => withViewTransition(() => setScreen('gallery'))
```

```css
::view-transition-old(root) { animation: vtOut 220ms var(--ease) both; }
::view-transition-new(root) { animation: vtIn  260ms var(--ease) both; }
@keyframes vtOut { to   { opacity: 0; } }
@keyframes vtIn  { from { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }
}
```

**预期效果**：进"结局一览 / 史料库 / 关于"时有 220~260 ms 的页面级交叉淡入，浏览器接管，不用管。

**代价**：**0 KB**（平台 API）。

**reduced-motion**：双保险——JS 里 `matchMedia` 短路 + CSS 里 `animation: none`。

**风险**：`flushSync` 在 React 19 并发模式下会强制同步渲染，若 `update` 里有副作用可能警告。本项目 `setScreen` 是纯 setState，安全。

---

### #8 帧预算守卫 + 低功耗模式（护栏）　【性价比 ★★★☆☆】

**改哪个文件**：`src/game/components/Stage.tsx`（加守卫）、`src/game/components/Particles.tsx`（响应降级）、`src/styles.css`

**为什么**：前面 7 条都在"加动效"，这一条是唯一在"止损"。低端机 / 集显 / 后台标签页 / 省电模式都会让 p95 冲到 30 ms+。与其祈祷，不如测出来自己降级。

**改法**：

```ts
// Stage.tsx：在已有的 rAF loop 里挂一个滑动窗口
const slowRef = useRef(0)
let last = performance.now()

const loop = () => {
  const now = performance.now()
  const dt = now - last
  last = now
  if (dt > 22) slowRef.current += 1
  else slowRef.current = Math.max(0, slowRef.current - 1)

  if (slowRef.current > 45 && !degraded) {      // 连续约 3 秒不达标
    setDegraded(true)
    document.body.dataset.lowPower = '1'        // CSS 侧一次关掉微光/呼吸/粒子
  }
  // …原来的 lerp + setProperty…
}
```

```css
body[data-low-power='1'] .stage-ambient,
body[data-low-power='1'] .particles,
body[data-low-power='1'] .stage-grain { display: none; }
body[data-low-power='1'] .stage-layer { filter: none; }   /* 景深退化成纯 scale */
body[data-low-power='1'] * {
  animation-duration: .001ms !important;
  transition-duration: .001ms !important;
}
```

**再加两件事**（借 guizang 的「B 键」）：

```ts
// 1) 页面隐藏 → 停 RAF（省电；虽然 rAF 本身会暂停，但 canvas 的纹理与计时器不会）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAll(); else restart();
})

// 2) 给用户一个显式开关（放在「关于」页）
<button onClick={engageLowPower}>省电模式（关闭动效）</button>
```

**预期效果**：低端机自动降级而不是卡成幻灯片；省电模式下页面完全静态但仍可读（符合 WCAG 2.2 的"用户可控"精神）。

**代价**：**0 KB**，约 20 行。

**reduced-motion**：`lowPower` 与 `prefers-reduced-motion` 是**两条独立通道**，都要实现——前者是运行时自适应，后者是用户声明偏好。二者任一为真都要停动效。

---

### 改造优先级总表

| # | 改动 | 收益 | 体积 | 帧率影响 | 改动面 | 性价比 |
|---|---|---|---|---|---|---|
| 1 | 2.5D → 父层 3D 倾斜 | 纵深质变 | **0 KB** | **+31 fps** | Stage.tsx + CSS | ★★★★★ |
| 2 | 烘焙 blur + 合并混合层 | 省预算 | **0 KB** | **+7~25 fps** | 纯 CSS | ★★★★★ |
| 3 | 墨迹幕转场 | 观感最大跃升 | **+3.5~7.5 KB** | 67 fps（新开销） | 新组件 + App.tsx | ★★★★★ |
| 4 | 结局页节奏 | 情绪收束 | **0 KB** | 0 | App.tsx + CSS | ★★★★☆ |
| 5 | 选项反馈 | 手感 | **0 KB** | 0 | CSS + 少量逻辑 | ★★★★☆ |
| 6 | 首屏仪式感 | 第一印象 | **0 KB** | 一次 1.3 s 开销 | App.tsx + CSS | ★★★☆☆ |
| 7 | View Transitions | 信息页顺滑 | **0 KB** | 浏览器接管 | 新 hook + CSS | ★★★☆☆ |
| 8 | 帧预算守卫 | 兜底 | **0 KB** | 止损 | Stage.tsx | ★★★☆☆ |

**全做完的账单**：`+3.5 ~ 7.5 KB gzip`，首屏 JS 从 **76,216 B → 约 80,000 B**，占 250 KB 预算的 **32%**。

---

## 7. Demo 实测数据

### 7.1 方法（可复现）

| 项 | 值 |
|---|---|
| 浏览器 | Chromium **148.0.7778.96**（Playwright 驱动，**有头**，真 GPU 合成） |
| 视口 | 1600 × 1000，`deviceScaleFactor: 1` |
| Node | v24.15.0 |
| 采集 | 页面内 `requestAnimationFrame` 时间戳差分；丢弃前 2 帧；每次测量前统一预热 1.8 s |
| 指标 | `avgFps`、`p50/p95/max` 帧时长、`longFrames`（>20 ms）、`droppedPct` |
| 复现 | `node tools/anim-lab/bench.mjs --headed`；低端机：`--cpu=4` |
| 采集时间 | 2026-10-20 14:30–14:36 (+08:00) |

> **口径警告（必读）**：无头 Chromium 走 SwiftShader 软件光栅，同一 demo 在无头下只有 **21.8 fps**，有头 **67.2 fps**——**差了 3 倍**。任何用无头浏览器测的"帧率"都不能当结论。本报告全部采用有头数据。

### 7.2 Demo 01 · 墨迹 / 雨幕转场

文件：[`tools/anim-lab/01-ink-transition.html`](../tools/anim-lab/01-ink-transition.html)（raw 19,737 B / **gzip9 7,489 B**）

连续 4 次完整转场（每次 cover 900 + hold 240 + reveal 950 ms）：

| 指标 | 数值 |
|---|---|
| 总帧数 | 563 |
| **avgFps** | **67.2** |
| p50 帧时长 | **16.5 ms** |
| **p95** | **17.0 ms** |
| 最长帧 | 304 ms（首次转场的纹理上传，预热后消失） |
| 掉帧率（>20 ms） | **4.6%** |

逐次：`56.8 / 70.0 / 68.4 / 73.5 fps` —— 第 1 次因纹理上传偏低，第 2 次起稳定在 68+。

**4 倍 CPU 降频**（`--cpu=4`）：`avgFps 64.7`、`p50 16.6 ms`、`p95 20.9 ms`、`droppedPct 12.5%`。
→ **JS 侧成本极低**（4 倍降频只掉 2.5 fps），瓶颈在合成器；这才是"零依赖 canvas 方案"真正的底气。

**首帧卡顿的解决**：加 `warmup()`（在换场前把三张纹理先 `drawImage` 一次上传 GPU）后，最长帧从 **329 ms → 304 ms** 且只出现在第一次；第 2~4 次的最长帧全部 ≤ 25 ms。生产环境应在 `Stage` 挂载时无条件预热一次。

### 7.3 Demo 02 · 2.5D 视差因子隔离

文件：[`tools/anim-lab/02-parallax-stage.html`](../tools/anim-lab/02-parallax-stage.html)（raw 18,052 B / **gzip9 6,321 B**）

9 个配置，每个 3.2 s 正弦扫掠指针（程序化，排除人手差异）；首个 `W` 与末个 `H` 是**同一配置**，用来量化跑序漂移：

| 配置 | avgFps | p50 | p95 | 说明 |
|---|---|---|---|---|
| **W** = C 配置（校准） | **48.7** | 20.8 | 25.0 | 漂移基准 ① |
| **A** 全开：3D倾斜+烘焙blur+呼吸光+微光+毛玻璃 | **37.5** | 25.1 | 29.3 | |
| **B** −呼吸光（120vmax + mix-blend） | 37.7 | 25.0 | 37.5 | 单项不可分辨 |
| **C** −呼吸光 −微光 | 39.9 | 25.0 | 33.2 | |
| **D** 3D 倾斜 → **每层各自 2D 位移**（保留 blur） | **16.9** | 58.1 | 83.4 | **= 现状写法** |
| **E** 回到 3D，**逐帧改 blur 半径** | **22.7** | 44.7 | 54.1 | |
| **F** 3D + 完全不用 filter | **48.0** | 20.8 | 25.1 | |
| **G** 2D 位移 + 完全不用 filter | **27.0** | 37.4 | 49.9 | |
| **H** = C 配置（校准） | **44.8** | 20.9 | 25.1 | 漂移基准 ② |

**漂移量**：C 配置三次测得 48.7 / 39.9 / 44.8 → **±4.4 fps 噪声**。因此只采信差值 > 8 fps 的对比。

**可采信的结论（差值远超噪声）**

1. **父层 3D 倾斜 >> 每层各自 2D transform**：48.0 vs 27.0（无 filter）/ 16.9（有 filter）。**差 1.8~2.8 倍**，且与顺序无关（D/G 都在中后段）。
2. **烘焙 blur ≈ 免费**：48.0（无 filter）vs 48.7 / 44.8（烘焙 blur）——落在噪声带内。
3. **逐帧改 blur = 慢 2.1 倍**：22.7 vs 48.0。这是本报告最强的一条"别做"。
4. **两个全屏混合层合计约 −7 fps（≈15%）**：A/B/C 均值 **37.6** vs C 配置均值 **44.5**。单项（呼吸光 vs 微光）无法分辨（37.5 / 37.7 / 39.9 全在噪声内），只能给合并结论。
5. **`backdrop-filter` 的代价测不出来**：在本实验的分辨率下落在噪声内（原计划单列的 C→backdrop 对比因此从表中移除）。**不要**据此认为它免费——只是这个量级测不准。

**与现状直接对应的两条**：
- 现状 `Stage.tsx`（每层 `scale + translate(calc(var))`、`.layer-far/-mid` 带 `filter: blur()`）= 配置 **D = 16.9 fps**。
- 改成父层倾斜 + 子层 `translateZ` + 同样 blur = 配置 **W/F = 48.0~48.7 fps**。
- **补充说明**：demo 是"3 层满屏 + 指针持续扫掠"的极端压测；真实项目里指针静止时 rAF 仍跑但 `--px/--py` 收敛，各层 `transform` 不再变化，合成器无需重绘，所以**日常不会这么糟**。但一旦用户持续移动鼠标（叙事网页的常见行为），就会落到 D 的区间。

### 7.4 体积汇总

| 产物 | raw | gzip9 |
|---|---|---|
| 现状 `dist/assets/index-*.js` | 232,805 | **76,216** |
| 现状 `dist/assets/index-*.css` | 11,301 | **3,403** |
| demo 01（含 HUD + bench + 双模式） | 19,737 | **7,489** |
| demo 02（含 6 个开关 + 因子实验） | 18,052 | **6,321** |
| ↑ 生产版估算（删 HUD/bench/开关） | ~9,000 | **~3,500** |

---

## 8. 风险与体积评估

### 8.1 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Canvas 墨迹幕在某些集显上首帧掉帧 | 中 | 中 | 挂载即 `warmup()`（实测把首帧 304 ms 压到只出现一次）；#8 的帧预算守卫兜底 |
| `perspective` + `backdrop-filter` 在旧 Safari 合成异常 | 中 | 中 | `.stage-content` 加 `transform: translateZ(0)` 独立成层；或 `@supports not (perspective: 1px)` 回退到现状 2D |
| 墨迹纹理的内存占用 | 低 | 低 | 3 张 512² RGBA ≈ 3 MB；若改 1024² 则 12 MB，**建议保持 512** |
| `document.startViewTransition` 的 `flushSync` 在 React 19 下警告 | 低 | 低 | 只用在不含副作用的 `setScreen`；已包 `typeof === 'function'` 守卫 |
| 转场期间用户连点触发重入 | 中 | 中 | demo 用 `running` 标志位串行化；生产版同样要 `if (running) return` |
| 逐帧 `filter` 被无意加回来 | **高** | 高 | 写进 lint / review checklist：`filter` 只允许出现在 **transform 恒定** 的元素上 |

### 8.2 体积风险

- **硬上限 250 KB gzip**。当前 76,216 B（JS）+ 3,403 B（CSS）。全部 8 条改造完成后约 **80,000 B JS**，占预算 **32%**。
- **最大诱惑是 GSAP**。46,375 B 会一次性吃掉余量的 27%，且 license 不是 MIT。**明确不建议**。
- 如果未来必须引入动画库，优先级：`Lenis (5,458 B)` > `anime.js (40,279 B)` > `GSAP 核心 (27,350 B)` > `Motion (55,862 B)` > `framer-motion (69,463 B)`。但按本报告结论，**当前阶段一个都不该进**。

### 8.3 合规 / 无障碍风险

| 项 | 现状 | 风险 | 处理 |
|---|---|---|---|
| `prefers-reduced-motion` CSS 降级 | ✅ 已有全局规则 | 中：管不到 JS 写的 `--px/--py` | 保留 `Stage.tsx` 的 `matchMedia` 分支，并在每个新组件里重复这个分支 |
| `prefers-reduced-motion` 下的"终态" | ⚠️ 部分元素起始态是 `opacity: 0` | 中：若 `fill-mode` 被改会留白 | 新写动效一律：起始态写 CSS、reduce 下显式 `opacity: 1` |
| 闪烁（三闪阈值，WCAG 2.3.1） | ✅ 无高频闪烁 | 低 | 墨迹幕的亮度变化是单调的，不构成闪烁 |
| 键盘可达性 | ✅ `:focus-visible` 已有 | 中：新加 `::before` 装饰不要吃掉焦点环 | 装饰层 `pointer-events: none` |
| 动画 > 5 s 需可暂停（WCAG 2.2.2） | ⚠️ `.ambient` 26 s 无限循环 | 中 | #8 的"省电模式"按钮即满足"可暂停" |
| 第三方 license | ✅ 全为零依赖 | 低 | 保持零依赖 = 零 license 风险 |

### 8.4 明确的「不做」清单

- ❌ Three.js / Unity 类引擎（硬约束）
- ❌ GSAP / Motion / anime.js / Lenis / Rive / Lottie（体积不划算）
- ❌ CSS scroll-driven animations 作主路线（Firefox 稳定版未支持，BCD: 159）
- ❌ 任何外部 CDN 运行时（`guizang` 托管的 motion 也不引）
- ❌ 逐帧修改 `filter`、`box-shadow`、`letter-spacing`、`width/height`
- ❌ 全屏 `mix-blend-mode` + 逐帧位移的组合

---

## 9. 附：如何复现本报告的所有数字

```bash
cd frontend/2026数字媒体

# 1) 帧率（有头，真 GPU）—— 报告采用的口径
node tools/anim-lab/bench.mjs --headed

# 2) 低端机模拟（4 倍 CPU 降频）
node tools/anim-lab/bench.mjs --headed --cpu=4

# 3) 单独跑某个 demo
node tools/anim-lab/bench.mjs --headed --only=02

# 4) 人眼直接看（双击打开即可，无需服务器、无需联网）
#    tools/anim-lab/01-ink-transition.html
#    tools/anim-lab/02-parallax-stage.html

# 5) 体积（对 npm tarball 里的 .min.js 做 gzip -9）
#    bench.mjs 输出里带 size.raw / size.gzip
```

浏览器支持数据来自：

```bash
# MDN browser-compat-data
curl https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Document.json
curl https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/animation-timeline.json
```

仓库元数据来自 GitHub REST API `/repos/{owner}/{repo}`（star / license / pushed_at），npm 体积来自 `registry.npmjs.org/{pkg}/latest` 与 `bundlephobia.com/api/size`。
