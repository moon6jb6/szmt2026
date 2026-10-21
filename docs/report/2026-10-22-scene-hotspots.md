# SceneHotspots：把「真 3D 场景」换成一张背景图 + 图上散布的热点

日期：2026-10-22
范围：新增 `src/game/components/SceneHotspots.tsx`、`src/game/components/sceneHotspots.css`、`public/scene-bg/`（5 张 JPG）、`tools/render-scene-bg.mjs`、`tools/scene-hotspots-test.mjs`、`tools/scene-hotspots-harness.html`
未触碰：`App.tsx`、`styles.css`、`audio.ts`、`Scene3D.tsx`、剧情/结局/选项数据、史料数据、`dist/`、4173 端口（用户正在试玩的进程没动）。
GPU：全程没有调用任何图像生成模型，也没有跑 python / nvidia-smi；背景图是**无头 Chrome（SwiftShader 软件渲染）**把现有 `Scene3D` 截下来的。

---

## 0. 一句话

> 3D 切片只解决「能转视角」，交互太弱。把 5 个切片各渲成一张 1920×1080 的背景图，把注意力交给图上的 **22 个可交互热点**：未发现是 6%—14% 呼吸的墨点，悬停/聚焦扩散成墨圈并浮出标签，点击从底部滑出窄卡，已发现变成淡金小印点，左上角计数「已发现 n / N」，全看完角落出现「都看过了」。

---

## 1. 为什么这么做（以及为什么不是别的做法）

| 做法 | 问题 |
|---|---|
| 继续用真 3D，把交互塞进 canvas | 命中测试要自己写射线拾取，键盘/读屏基本没法做；fps 预算还得继续守 |
| 生成 AI 背景图 | 与 3D 构图对不上，且本次明确禁用生图 |
| **Scene3D 渲成 JPG + DOM 热点层（本方案）** | 画面还是原来那套几何/光照（同一份源码、同一条渲染路径），但交互全部落在真实 `<button>` 上：Tab、Enter、Esc、aria、窄卡都好做，移动端也不掉帧 |

背景图怎么来的：`tools/render-scene-bg.mjs` 起一个 Vite dev server，用 `tools/scene-hotspots-harness.html?mode=bg&variant=…` 挂载**未修改的** `Scene3D`，等 `data-ready` 出现后再等 2.6 s（>2.5 s 要求），截 1920×1080 PNG，再用系统 `ffmpeg` 压成 JPG（按体积挑质量档）。

相机没有改：构图靠 harness 里的 CSS 后处理——把 canvas 放进一块比视口大的舞台，**平移 + 轻微放大**，把主体推到右下；再用 `filter: brightness/contrast/saturate` 提亮暗场景；最后叠两层程序化颗粒（overlay 加中间调结构、screen 抬一点黑场，压住 JPG 暗部色带）。这些参数都写在 harness 的 query 里，组件与 3D 源码一行没动。

---

## 2. 背景图清单（`public/scene-bg/`）

全部 1920×1080、ffmpeg `-q:v 2` + `yuv420p`，合计 **1006 KB / 2.5 MB 预算**（单张均落在 180—450 KB）。

| variant | 尺寸 | 体积 | 全图平均亮度 | 左上角平均亮度 | 主体位置（最亮区块 4×3） | 平移/放大（zoom, x, y） | 提亮（bright/contrast/sat） | 颗粒（grain/lift） |
|---|---|---|---|---|---|---|---|---|
| `warehouse-int` | 1920×1080 | **180 KB** | 35.9 | 13.4 | col1/row2（中下） | 1.08, +46, +30 | 1.80 / 1.06 / 1.02 | 0.42 / 0.85 |
| `warehouse-ext` | 1920×1080 | **256 KB** | 37.3 | 13.6 | col2/row1（中） | 1.14, +50, +36 | 1.62 / 1.16 / 1.08 | 0.42 / 0.85 |
| `rooftop` | 1920×1080 | **190 KB** | 79.4 | 139.3 | col3/row0（右上） | 1.18, +44, −86 | 0.98 / 1.05 / 1.03 | 0.68 / 1.00 |
| `bridge` | 1920×1080 | **191 KB** | 52.9 | 48.8 | col2/row1（中） | 1.08, +46, +30 | 1.16 / 1.06 / 1.02 | 0.50 / 0.92 |
| `office-1947` | 1920×1080 | **189 KB** | 45.1 | 13.4 | col2/row1（中） | 1.10, +42, +34 | 1.12 / 1.05 / 1.00 | 0.42 / 0.85 |

渲染记录（首帧 / draw calls / 三角面，均来自 `Scene3D` 的 `data-*`）：`warehouse-int` 2439 ms / 16 / 3093、`warehouse-ext` 1662 ms（GLB 就绪后截）/ 13 / 4734、`rooftop` 1398 ms / 12 / 2096、`bridge` 2418 ms / 11 / 2176、`office-1947` 3231 ms / 15 / 828。原始 PNG 留在 `tools/shots/scene-hotspots/bg-raw/`（`tools/shots/` 已在 `.gitignore`）。

**构图说明（每张都按「左上/顶部留给标题与卡片文字」摆过）**

- `warehouse-int`（底楼西头往东）：煤油灯与沙袋垛压在画面中下，木箱、破洞在左下，右上方两排方柱收边；上三分之一是未点亮的顶棚（亮度 13），左上角正好放计数。
- `warehouse-ext`（Blender 西墙 GLB）：立面斜跨画面中右，弹孔、铁门、沙袋、檐口都在右半边；左三分之一与顶部是夜空，标题区不用压暗就够黑。
- `rooftop`（楼顶升旗）：旗在右上三分点，女儿墙与沙袋横在腰线以下，探照灯在右侧。**这张是唯一「亮背景」**：原图左上角均值 139（晨光天空），所以不靠压图、靠组件那层 grade 解决——合成后左上角实测亮度 25.8，纸色白字对比度足够（测试里有断言）。
- `bridge`（雾里的桥）：桥面透视线收在画面中线偏下，桥栏在左下与右下，灯柱成对分列；标题区落在雾最淡的地方，grade 之后是 10。
- `office-1947`（1947 造册厢房）：桌案占中下，窗在左上中部（雪景过曝区正好避开右上按钮），吊灯在右上角；左上角是全图最暗的一块（13.4）。

---

## 3. 热点文案（5 景 22 处）

规则：只写**环境/物件旁白**，1—2 句，一句 20—45 字（只数汉字与数字，不数标点）；不写新剧情、不改结局、不新增史实断言；**不挂没把握的史料卡**（22 处里挂 10 处，全部 `status: 'verified'`）。套话黑名单（仿佛/好像/宛如/似乎/不禁/令人）在测试里逐条体检，0 命中。

### warehouse-int（仓库底楼内景，5 处）

| # | id | label | x / y（%） | body（环境旁白） | sourceId |
|---|---|---|---|---|---|
| 1 | `wi-lamp` | 煤油灯 | 30.6 / 51 | 柱子上挂着一盏煤油灯，铁皮罩子烤出一圈焦黄；灯芯压得很低，光只铺满脚下半步。 | `auto-b-04` |
| 2 | `wi-bag` | 沙袋垛 | 38.5 / 66 | 沙袋码到齐胸高，麻布上落了一层灰；靠外一侧被坐塌过一个窝，还没人来得及拍平。 | — |
| 3 | `wi-pillar` | 方柱 | 78 / 48 | 两排方柱一路撑到顶棚，柱身的灰浆剥落了几块；靠近门口的那几根，下缘被蹭得发亮。 | — |
| 4 | `wi-crate` | 木箱 | 47.5 / 74 | 两只木箱摞在沙袋边上，箱盖的钉子松了一角；侧面用粉笔写过的字，已经擦不干净。 | — |
| 5 | `wi-breach` | 西墙破洞 | 17.5 / 48 | 西墙塌了一角，砖茬露在外面；冷光从破洞斜着进来，在地上摊开一片，边沿很硬。 | — |

### warehouse-ext（四行仓库西墙，4 处）

| # | id | label | x / y（%） | body（环境旁白） | sourceId |
|---|---|---|---|---|---|
| 1 | `we-holes` | 西墙弹孔 | 54.2 / 39 | 西墙上的弹孔密成一片，大的能塞进拳头；孔口边缘的砖烧成焦黑，摸上去发脆。 | `auto-e-01` |
| 2 | `we-gate` | 铁门 | 50.4 / 75.4 | 底层铁门的两扇门扇都关着，缝里塞过麻布；门轴上的锈迹一直拖到门槛上。 | `s-four-banks` |
| 3 | `we-cornice` | 檐口 | 41 / 22.5 | 檐口那一圈水泥抹得比墙身平，雨水在底下冲出几道深色的痕；砖缝里还留着旧灰。 | — |
| 4 | `we-sandbag` | 沙袋工事 | 24 / 77 | 墙脚堆着沙袋工事，麻袋口一律朝内，绳子还没解开；最上面一层被雨压得发硬。 | `auto-b-03` |

### rooftop（楼顶升旗，4 处）

| # | id | label | x / y（%） | body（环境旁白） | sourceId |
|---|---|---|---|---|---|
| 1 | `rt-flag` | 旗面 | 65.4 / 18 | 旗面是机织布，边角已经抽丝；一鼓风，褶子就从杆子那头一路荡到尾端。 | `auto-b-05` |
| 2 | `rt-pole` | 竹竿旗杆 | 60.9 / 32 | 两根竹竿接起来当旗杆，接口处缠了几圈铁丝；风一紧，能听见竹节互相磕碰。 | `s-flag-raise` |
| 3 | `rt-parapet` | 女儿墙 | 41 / 55.5 | 女儿墙只有齐腰高，水泥面上全是踩出来的鞋印；墙头压着半块砖，位置挪过好几次。 | — |
| 4 | `rt-beam` | 探照灯方向 | 83 / 62 | 对岸的探照灯隔一阵扫过来一次，光柱掠过楼顶时，沙袋的影子先动，墙上的白灰跟着亮。 | `auto-b-06` |

### bridge（雾里的桥，4 处）

| # | id | label | x / y（%） | body（环境旁白） | sourceId |
|---|---|---|---|---|---|
| 1 | `br-rail` | 桥栏 | 29.5 / 67 | 铁栏的漆掉了大半，横杆上有一道被绳子磨出来的亮痕；摸过去，比看上去要凉。 | `auto-b-10` |
| 2 | `br-water` | 河面反光 | 88 / 70 | 河面上浮着灯影碎成的亮点，风一过就散，过一会儿又慢慢聚回原处。 | — |
| 3 | `br-stone` | 湿石板 | 44 / 86 | 桥面石板被雨浸透，接缝里积着一线水；走快了会打滑，得压着步子过。 | — |
| 4 | `br-bank` | 对岸仓库轮廓 | 58 / 48 | 对岸那片楼在雾里只剩轮廓，窗户一扇一扇都是黑的；只有最东头亮着一格。 | `auto-e-04` |

### office-1947（1947 造册厢房，5 处）

| # | id | label | x / y（%） | body（环境旁白） | sourceId |
|---|---|---|---|---|---|
| 1 | `of-inkstone` | 缺角砚台 | 65.3 / 61.5 | 砚台缺了一角，余墨干在池底；边上有一圈洗不掉的墨痕，比桌面深一个色。 | — |
| 2 | `of-paper` | 毛边纸 | 47 / 61 | 一叠毛边纸，纸边裁得不齐；最上面那张写了几行又划掉，墨还没干透。 | — |
| 3 | `of-lattice` | 窗棂 | 58.5 / 51 | 窗棂是四格的杉木，窗纸糊了两层；外层边角被风掀起，后来又用浆糊按了回去。 | — |
| 4 | `of-lamp` | 吊灯 | 83 / 15 | 吊灯的灯罩是铁皮的，内侧熏黑，绳子上系了个结，把灯压到刚好照见桌面的高度。 | — |
| 5 | `of-ledger` | 旧册子 | 28 / 53.5 | 柜上摞着几本旧册子，脊上的墨字褪成灰黄；最下面那本受了潮，书角卷起来。 | `s-49` |

**两处与参考物件的偏差（按画面里真实存在的物件改）**

- `warehouse-int` 没有「铁门」几何体（大厅尽头是一面暗墙），改成 **木箱** —— 画面中下确有两只箱子，热点落在箱盖上。
- `warehouse-ext` 的「屋顶旗杆」在取景里看不见（`data-glb=ready` 后屋顶以上没有任何杆体，放大天空做过确认），改成 **檐口** —— 热点落在立面上沿那一圈水泥带，不再是悬空的点。
- `office-1947` 的参考物件「炭盆」在这一版切片里没有建，换成画面里确实存在的 **吊灯**。

**xPct / yPct 是「容器百分比」**，按 16:9 背景图量的；背景图 `object-fit: cover` 居中裁切，所以容器越接近 16:9，点越贴物件（测试在 1600×900 = 16:9 下截图核对，见 `tools/shots/scene-hotspots/*-map.png`）。

### 挂上的 10 张史料卡（全部 `status: 'verified'`）

| sourceId | 卡片出处 | 与热点的关系 |
|---|---|---|
| `auto-b-04` | 《八百壮士之营长杨瑞符（〈静海县志〉记载解读）》 河北省档案馆 | 断电 → 只剩煤油灯；同页也写守军堆沙袋 |
| `auto-e-01` | 《「八百壮士」守四行》新华网（西墙图注） | 西墙 8 个炮弹孔、420 多个枪弹孔 |
| `s-four-banks` | 《独家：谢团长，宁愿死，不投降》参考消息 2015（谢继民） | 四行仓库是四家银行储蓄会合建的仓库 —— 铁门是这栋楼的门 |
| `auto-b-03` | 《追忆上海四行仓库保卫战》上海党史网 | 日军从东西两侧进攻、炮弹打在厚墙上 |
| `auto-b-05` | 《父亲和「八百壮士」的最终结局》环球人物 2013（引《申报》1937-10-29） | 10 月 29 日清晨楼顶升旗 |
| `s-flag-raise` | 同上系列，参考消息 2015（谢继民） | 市商会送特大国旗一面、**长竹竿两根**、旗绳一根 |
| `auto-b-06` | 环球人物 2013（引杨瑞符《孤军奋斗四日记》） | 日军以探照灯照射夜袭 |
| `auto-b-10` | 《英雄烈士谱｜谢晋元等「八百壮士」》国防部网站（转新华社） | 10 月 31 日凌晨经新垃圾桥撤入租界 |
| `auto-e-04` | 《那些孔洞，就像历史的伤口》中国网（转新华网） | 苏州河南岸眺望四行仓库的历史照片（隔河对峙） |
| `s-49` | 《淞沪会战「八百壮士」半数是湖北通城人》新华社 2015 | 1947 年通城县参议会编《通城县抗战史料》收四十九壮士姓名表 |

测试会从 `VERIFIED_SOURCES` 里取全部 id 做白名单，逐个断言 `sourceId ∈ verified`（漏一个就 FAIL）。

---

## 4. 组件实现要点

**结构**（`SceneHotspots.tsx`）

```
.sh                          ← 容器：position:relative; overflow:hidden; 背景墨色
├── .sh-bgwrap > img.sh-bg   ← 背景图，外扩 12px 防视差露边
├── .sh-grade                ← 墨色/暗角 grade（保护白字）
├── button.sh-exit           ← 右上「返回正文」（DOM 里排第一，Tab 从它出发）
├── p.sh-count               ← 左上「已发现 n / N」（aria-live=polite）
├── p.sh-done                ← 全发现后的「都看过了」（不弹窗）
├── .sh-fg                   ← 热点层（视差幅度 0.45 倍）
│   └── button.sh-dot ×N     ← 真实 button，aria-label = label，aria-expanded = 是否开卡
│       ├── span.sh-spot     ← 呼吸墨点 / 墨圈 / 淡金印点（同一个元素换样式）
│       ├── span.sh-ripple   ← 点击时墨圈荡开（key 变化即重播）
│       └── span.sh-label    ← 点上方标签，-webkit-line-clamp: 2
└── aside.sh-card            ← 底部滑出的窄卡（280—340px）
```

**视觉**

- 背景 `object-fit: cover` + 外扩 + `scale(1.012)`；`--sh-bgx/--sh-bgy` 由指针位置算出，**背景 ±8px**、热点层 **±3.6px（0.45 倍）** → 两层不同幅度，转动手机/移动鼠标时有一点纵深，不再是死图。
- grade：径向暗角（从 32% 起渐黑）+ 顶部 0.54 / 底部 0.64 的竖向压暗 + 左侧 0.44 横向压暗。实测合成后左上角亮度：6 / 5.8 / 25.8 / 10 / 5.8（≤60 断言通过）。
- 未发现的点 = 10px 径向渐变 + `sh-breathe 4.6s` 呼吸 `opacity .06 → .14`；外面一圈极弱的墨底（`box-shadow`），保证在楼顶那种亮天空上也看得见。点子做成 10px 而不是 8px，是因为 8px 在亮背景上 10% 的亮度差基本读不出来（透明度仍严格压在 6%—14%）。
- 悬停/`focus-visible`/已打开 → 28px 墨圈（半透明墨底 + 1px 纸色边 + 内阴影）+ 标签浮出（`opacity` + 上移 4px），`transition 160—180ms`。
- 已发现 → 6px 淡金圆角印点（`data-found="1"`，`animation: none`），悬停时仍然有墨圈和标签。
- 点击 → `.sh-ripple` 从 8px 扩到 6.5 倍并淡出（620ms）；窄卡 `translateY(16px) → 0` 滑出 260ms，左边 2px 红边 + 红菱形标题 + 金边「查看史料卡」。
- 字体/颜色全部走 `var(--ink/--paper/--paper-dim/--red/--gold/--serif/--sans/--ease)`，`styles.css` 没动；没有任何 emoji，红菱形与墨圈都是 CSS 形状。

**交互与键盘**

- 点击打开；**再点同一点关闭**；窄卡里也有「关闭」。
- `Esc`：有卡先关卡（`window` 监听，焦点在卡里也生效），再按一次 `onExit()`。
- Tab 顺序 = DOM 顺序 = 数据顺序；每点都是 `<button type="button">`，`:focus-visible` 2px 金色 outline + offset 3px。
- `onSound`：开卡 `'ink'`、关卡 `'paper'`（App 里 `playSfx('ink') / playSfx('paper')` 是现成 id）；`'thud'` 预留给接入方做「第一次发现」的音。
- 计数与「都看过了」都是 `pointer-events:none` 的文本，不挡热点、不打断。

**移动端（≤480px）**

- `--sh-hit: 38px`（要求 ≥36px；桌面 32px），标签 `max-width: 132px`。
- 窄卡改底部通栏：`left/right: 0; bottom: 0; width: 100%`，`line-height`、`env(safe-area-inset-bottom)` 都留了。

**reduced motion**

- `reduceMotion` 为真时：不注册 pointermove（视差整段不跑，`translate` 恒为 0）、不渲染 ripple、`data-reduce="1"` 关掉呼吸/过渡/卡片动画。
- CSS 里另有 `@media (prefers-reduced-motion: reduce)` 兜底：即使使用方忘了传 prop，动画也不动。

**性能/卸载**：视差用 rAF 合帧、位移写 CSS 变量（不动 React state）；`pointermove` 是 `{ passive: true }`；卸载时摘掉 window/host 监听、取消 rAF；`<img>` 加载失败 `onError` → `data-bg="fail"`，换成墨色渐变底，不留黑洞。

---

## 5. 验收

```bash
node tools/render-scene-bg.mjs            # 5 张背景图（约 2 min，含起 dev server）
node tools/render-scene-bg.mjs --analyze-only   # 只重量现有 JPG 并并回报告（约 5 s）
node tools/scene-hotspots-test.mjs        # 124 项断言（约 70—85 s）
```

两个脚本各自起一个 Vite dev server（4292 / 4293，独立 `cacheDir`），跑完就关；不碰 4173 / 5199 / `dist`；热点模式里没有 3D，纯静态图，不需要 GPU。

**结果：124 / 124 全过，0 console error / pageerror。** 断言分布：

| 组 | 覆盖 |
|---|---|
| 背景资产（6） | 5 张存在、HTTP 200、尺寸 1920×1080、单张 180—450 KB、合计 ≤2.5 MB |
| 每景 ×5（共 109 项：22+22+22+22+21） | 热点数 3—5 且与数据一致 · 背景图 `naturalWidth/Height` · 全部真实 `<button>` 且 aria-label = label 且顺序一致 · 计数初值 · 「返回正文」 · **文案体检**（1—2 句、每句 20—45 字、无套话） · sourceId ∈ verified · 悬停墨圈 ≥24px + 标签浮出且在点上方 + ≤2 行 · 呼吸 opacity 落在 6%—14% 且有起伏 · 视差 背景 7.99px / 热点层 3.60px（比值 0.45） · 开卡（宽 280—340、标题正文一致、`aria-expanded=true`） · 计数 +1 且 `data-found=1` · `ink` 音效 · 有卡才有「查看史料卡」且回调 id 正确 · 再点关闭（`paper` 音） · Tab 顺序无跳点 · 焦点 outline 可见 · Enter 开卡 / Esc 关卡不退出 / 再 Esc 退出 · 全部发现 → 计数到顶 + 「都看过了」 · 左上角合成亮度 ≤60 · 无 console error |
| 390px（6） | `warehouse-ext` / `office-1947`：无横向溢出（root 与 document 双查、所有点在视口内） · 点击区 38×38 ≥36 · 窄卡宽 390、贴底、不溢出 |
| reduced-motion（2） | `animationName: none`、`transition 0s`、卡片无动画；指针移动后 `translate` 仍为 0 |
| 全局（1） | 全流程 0 console error / pageerror |

**截图（`tools/shots/scene-hotspots/`，23 张，已被 `.gitignore` 覆盖）**

- 每景 4 张：`*-wide`（全景）、`*-card`（热点打开）、`*-allfound`（全发现）、`*-map`（定位核对：把点放大到 16px 并常显标签，人眼核对是否落在物件上）
  - `*-wide` 是在墨点呼吸到接近峰值（约 13%）时截的：呼吸最低谷是 6%，随机相位截图会正好落在低谷，看上去像「页面上没有点」。这一步只是**等相位**，没有改任何样式（`waitForFunction` 轮询 computed opacity ≥ 0.128 后立即截图）。
  - `*-map` 用测试注入的一份临时样式（不是组件样式）把点放大常显，用来核对落点；正常游戏里看不到这个状态。
- `*-390-card`（2 张，移动端通栏）＋ `reduced-motion`
- `bg-raw/*.png`（5 张渲染原图）＋ `bg-report.json`（尺寸/体积/亮度/参数）＋ `report.json`（124 项断言明细）

---

## 6. 接入 App 的示例（Lead 用）

组件对外只有 6 个 prop，数据在 `SCENE_HOTSPOTS` 里（想搬家就整块搬到 `src/game/content/sceneHotspots.ts`，组件不用改）。

### A. 最小改动：把「3D 视角」那块的插槽换成它

App 现有 `view3dScene` / `show3d` / `scene3dSpec`（`App.tsx:226`）可以直接复用，只改渲染的部分：

```tsx
// 顶部
import SceneHotspots, { SCENE_HOTSPOTS } from './game/components/SceneHotspots'

// Stage 的 scene3d 插槽（现在传的是 <Scene3D variant={scene3dSpec.variant} />）
scene3d={
  show3d && scene3dSpec ? (
    <SceneHotspots
      variant={scene3dSpec.variant}
      hotspots={SCENE_HOTSPOTS[scene3dSpec.variant]}
      reduceMotion={window.matchMedia('(prefers-reduced-motion: reduce)').matches}
      onSound={(cue) => {
        if (audioOn) playSfx(cue === 'thud' ? 'distant-thud' : cue) // 'ink' / 'paper' 都是现成 id
      }}
      onOpenSource={(sourceId) => setSourcePanel(sourceId)}        // App 已有 sourcePanel 状态
      onExit={() => setView3dScene(null)}
    />
  ) : null
}
```

按钮文案建议 `3D 视角 / 回到 2.5D` → `细看这间屋子 / 回到正文`（`.view3d-toggle` 那段在 `App.tsx:584`）。

### B. 满屏覆盖（想要「沉浸一层」时）

```tsx
const [hotspotVariant, setHotspotVariant] = useState<SceneHotspotsVariant | null>(null)

{hotspotVariant && createPortal(
  <div className="hotspot-overlay">
    <SceneHotspots
      variant={hotspotVariant}
      hotspots={SCENE_HOTSPOTS[hotspotVariant]}
      reduceMotion={reduce}
      onSound={(cue) => { if (audioOn) playSfx(cue === 'thud' ? 'distant-thud' : cue) }}
      onOpenSource={(id) => setSourcePanel(id)}
      onExit={() => setHotspotVariant(null)}
    />
  </div>,
  document.body,
)}
```

```css
/* styles.css 里加三行即可（组件自己铺满父容器） */
.hotspot-overlay { position: fixed; inset: 0; z-index: 40; background: var(--ink); }
```

### 两点接入注意

1. **Esc 会双响**：`App.tsx` 已有两个 window 级 `Escape` 处理（`:264` 收签名时刻、`:340` 关史料卡面板）。组件内的 Esc 也挂在 window 上（`stopPropagation` 拦不住同一 target 上的另一个监听器），所以接入时给这两个处理各加一句守卫（比如 `if (hotspotVariant) return`），把 Esc 让给热点层。
2. **焦点归还**：`onExit` 之后把焦点还给打开它的那个按钮（`view3d-toggle`），否则键盘用户会掉回 `body`。组件内部关窄卡时不动焦点（焦点留在原热点上），这一步只需要在 `onExit` 里做。

---

## 7. 已知限制 / 后续

1. **竖屏手机的 cover 裁切**：390×844 时背景图只露出中间约 42% 的宽度（`1500×844` 居中裁切），所以 `warehouse-int` 的「西墙破洞（17.5%）」「方柱（78%）」在手机上落点会偏到别处——点仍然可点、计数与窄卡都正常（测试覆盖），只是不再正对物件。要彻底解决，需要按断点给第二套热点坐标，或补一张竖版背景图（都要新素材，这轮没做）。
2. **背景图是「定格」的**：3D 里旗面飘动、水面流、煤油灯闪都没了 —— 这是「一张图 + 热点」这个形态的固有代价，换回来的是可交互性与无障碍。
3. **热点数据暂时放在组件文件里**（`SCENE_HOTSPOTS`），因为本轮只允许新建这几个文件；后续搬到 `src/game/content/` 时组件零改动。
4. **热点「很淡」是按要求做的**：6%—14% 的呼吸在暗场里是一枚能看见的光斑，在楼顶那种亮天空/红旗上要等它呼吸到峰值才明显（运动本身是最强的提示）。如果试玩反馈「找不着」，改一个数就行：`sceneHotspots.css` 里 `@keyframes sh-breathe` 的峰值 `0.14`（连同测试里 6%—14% 的断言一起改），不要动别的。
5. **没做的**：热点之间的连线/逐步揭示、发现进度写入存档（`engine` 侧的 `ledger`）、热点配图。要做的话，`Hotspot` 加字段即可，组件不用改结构。
