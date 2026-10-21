# anim-lab · 网页动效可行性实验台

> 研究用沙盒。**不参与打包、不 import 进 `src/`、不改 `package.json`。**
> 目的：在真实浏览器里量出「转场」与「2.5D 视差」两种方案到底跑得动跑不动。

## 两个 demo（双击 HTML 即可打开，无需服务器、无需联网）

| 文件 | 验证什么 | gzip |
|---|---|---|
| `01-ink-transition.html` | Canvas 2D「墨迹幕」转场：cover → swap → reveal + 推镜；可切「雨幕」变体 | 7,489 B |
| `02-parallax-stage.html` | 2.5D 视差：父层 `perspective` 倾斜 vs 每层 2D 位移；烘焙 vs 逐帧 `filter`；呼吸光 / 微光 / 毛玻璃的代价 | 6,321 B |

背景图走相对路径 `../../public/bg/*.jpg`，与主项目共用素材；载入失败会自动回落到 CSS 渐变（不会白屏）。

## 交互

**01**
- `切到下一场` / `Enter` / `空格` — 触发一次转场
- `墨迹` / `雨幕` — 换幕布质感

**02**
- `3D 倾斜` — 父层 `rotateX/rotateY`（默认开）vs 每层各自 2D 位移
- `逐帧模糊` — 每帧改 `filter: blur()` 半径（对照，会明显掉帧）
- `呼吸光` / `指针微光` / `毛玻璃` — 三个开销因子逐个开关
- `自动摆镜` — 程序化指针扫掠（人手抖动的对照）

两个 demo 右上角都有实时 FPS / p95 / 长帧计数。

## 自动取数

```bash
cd frontend/2026数字媒体

node tools/anim-lab/bench.mjs --headed           # ← 报告采用的口径（真 GPU 合成）
node tools/anim-lab/bench.mjs                    # 无头（软件光栅，数字仅供参考，会低约 3 倍）
node tools/anim-lab/bench.mjs --headed --cpu=4   # 4 倍 CPU 降频，模拟低端机
node tools/anim-lab/bench.mjs --headed --only=02 # 只跑一个
```

`bench.mjs` 依赖工作区根目录的 `playwright`（`C:\Users\26298\OneDrive\Desktop\全栈开发\node_modules\playwright`），
浏览器用 `ms-playwright` 缓存里的 Chromium；**不会**往本项目装任何依赖。

输出是 JSON，字段：

```
demos.<id>.report.overall | perRun | results   ← 帧率统计
demos.<id>.report.supports                     ← startViewTransition / animation-timeline / @property 等能力探测
demos.<id>.report.canvas|viewport              ← 实际绘制尺寸与 dpr
demos.<id>.size.raw|gzip                       ← demo 文件本身的体积
```

## 口径警告

- **必须用 `--headed` 下结论。** 同一个 `01` demo：无头 **21.8 fps**，有头 **67.2 fps**（1600×1000 / dpr 1 / Chromium 148）。无头走 SwiftShader 软件光栅，不具参考价值。
- `02` 是「3 层满屏 + 指针持续扫掠」的**极端压测**。主项目里指针静止时各层 `transform` 不再变化，合成器无需重绘，日常不会这么糟；但用户持续移动鼠标时会落到压测区间。
- 测量有 **±4.4 fps 的跑序漂移**。`02` 的首测（W）与末测（H）是同一配置，用来校准；只采信差值 > 8 fps 的对比。

完整数据与结论见 [`docs/research/web-animation-skills.md`](../../docs/research/web-animation-skills.md) §7。
