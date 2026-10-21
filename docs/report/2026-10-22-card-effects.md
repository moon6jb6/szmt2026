# 卡片专属效果层 · card-effects.css

- 日期：2026-10-22
- 范围：`frontend/2026数字媒体`（《把名字留下来》）
- 交付物：`src/card-effects.css`（新增，1715 行）+ `src/main.tsx` 顶部一行 `import './card-effects.css'`
- 结论一句话：**37 类卡片各有一种专属手法，全部只加 CSS、不动任何组件/剧情/音频**；逐页 76 张截图与硬指标复测全绿（无横向溢出、无 console error、hover 态与常态对比度全部 PASS、reduced-motion 静态可用、长页滚动帧时间 p95 8.4ms）。

---

## 0. 改动清单（就这些）

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `src/card-effects.css` | 新增 | 全部效果，按页面区块分 12 组注释 |
| `src/main.tsx` | +1 行 | 第 1 行 `import './card-effects.css'`，其余未动 |
| `tools/card-effects-check.mjs` | 新增 | 逐页截图 + 溢出/对比度/帧率/不抖/reduced-motion 检查 |
| `tools/card-effects-a11y-diff.mjs` | 新增 | 对比度回归（同算法同选择器比 `tools/quality/a11y.json` 基线） |

未动：`App.tsx`、`styles.css`、任何组件、内容卷、`audio.ts`、`Scene3D.tsx`、`dist/`，没重启 4173。

### 层叠顺序带来的一个实现约束（重要）

`card-effects.css` 在 `main.tsx` 顶部，**先于** `styles.css` 载入（已用 CSSOM 实测确认：sheet 0 = 本文件，sheet 1 = styles.css）。因此同特异性下 `styles.css` 会赢，凡是需要覆盖已有声明的属性，本文件一律把选择器提到「两个类」：

- `.stage-content > .scene`、`.stage-content > .ending` —— 纸纹（压过 `.scene { background: … }` 简写）
- `.scene-image.scene-image::after` —— 暗角（压过原有底部渐变，双写类名只为提特异性）
- `.source-entry .badge`、`.source-panel .badge`（含 `.ok/.pending` 变体）—— 印章描边
- `.app-shell .source-panel` —— 浮层改成「从上方抽出」，本文件唯一一处覆盖入场动画
- `.scene-head .view3d-toggle` —— 给右侧「转面」小方留出 padding
- `.source-row:hover .eyebrow` —— 台账行编号转红

另外：**凡是自身带入场动画、被 `animation-fill-mode: both` 拿住 `transform` 的元素，悬停位移一律改用 `translate` / `rotate` 独立属性**（与 `transform` 叠加而非互相覆盖，`styles.css` 里 `.choice` 那段注释踩过同一个坑）。整卡位移都控制在 1—3px。

---

## 1. 卡片清单与效果（37 类）

「态」列：H = hover，F = focus-visible，A = active/按下，E = 进入动画，— = 该卡片不可交互（无 F/A），用「随页/随卡」间接触发。

### 一、菜单

| 页面 | 类名 | 卡片用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 菜单 | `.menu > .eyebrow` | 卷首题签 | 卷首题签（红漆竖条，悬停长粗） | H F | `01-menu.png` `07-menu-focus-primary.png` |
| 菜单 | `.menu .title` | 主标题 | 题名落款（题下金线自左长出，线尾一枚红印，悬停按下） | H E | `05-menu-detail-title.png` |
| 菜单 | `.subtitle` | 副题 | 铅字压线（题下短规线，悬停延长） | H | `01-menu.png` |
| 菜单 | `.menu-lead` | 导语 | 书脊压线（左侧渐变纸边，悬停拉满） | H | `01-menu.png` |
| 菜单 | `.menu-facts li` | 四条事实 | 墙钉纸条（左端墙钉，悬停以钉为轴转 0.35°/0.3°、抬 1px、字提亮） | H | `02-menu-hover-fact.png` `03-menu-detail-fact.png` |
| 菜单 | `.content-note` | 内容提示 | 页边批注（左侧虚线淡入） | H | `01-menu.png` |

### 二、按钮

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 全站 | `.primary-button` | 主按钮 | 落章按压（悬停外圈浮出印边，按下内压出墨坑） | H F A | `04-menu-hover-primary.png` `47-ending-focus-primary.png` |
| 全站 | `.quiet-button` | 次按钮 | 铅笔划线（断续铅笔线自左扫过） | H F A | `01-menu.png` `88-sources-focus-back.png` |
| 浮层 | `.text-button` | 关闭 | 反向擦线（细点线自右向左擦回） | H F A | `90-source-panel.png` |

### 三、场景页

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 场景 | `.scene` | 正文卡片 | 墨线开卷（顶部墨线随进入展开 + 右下纸角微卷 + 悬停纸页抬 2px + 暗纤维纸纹） | H E | `10-scene-prologue.png` `17-scene-bottom.png` `18-scene-detail-corner-curl.png` |
| 场景 | `.scene-head::after` / `.chapter` | 章节卡 | 场次铅条（红金细线自中展开 + 章节前立短红条） | E | `10-scene-prologue.png` |
| 场景 | `.scene-image` | 插画 | 四角相片夹（四条金角夹住相纸，悬停相纸转 0.35°、四角张开、暗角加深） | H | `20-scene-image.png` `21-scene-hover-image.png` `22-scene-detail-image-corner.png` |
| 场景 | `.quote-card` | 史实引文 | 红绳缝线（左侧红虚线缝上去，悬停线被拉紧） | H E | `30-scene-quote.png` `31-scene-hover-quote.png` `32-scene-detail-quote-thread.png` |
| 场景 | `.choice` | 普通抉择卡 | 纸条被挑起（右下角 24px 折角翘起 + 墨色更沉 + 按下压印） | H F A E | `11-scene-hover-choice.png` `12-scene-detail-choice-corner.png` `16-scene-focus-choice.png` |
| 场景 | `.continue` | 继续 | 续页推进（底边墨线自左推满） | H F A | `33-scene-hover-continue.png` `34-scene-detail-continue.png` `35-scene-focus-continue.png` |
| 场景 | `.chip` | 史料小标签 | 贴纸翘角（外浮红章环 + 右端贴纸边探出 + 抬 1px） | H F A | `12c-scene-hover-chip.png` `12d-scene-detail-chip-hover.png` `15-scene-detail-chip.png` |
| 场景 | `.source-row` | 史料台账行 | 台账行（编号转红 `#e0785a` + 行底墨线扫过 + 行抬 1px） | H | `13-scene-hover-sourcerow.png` |
| 场景/浮层 | `.source-warn` | 待补提示 | 缺页折角（左侧断线 + 右上折角张开） | H | `85-sources-hover-warn.png` `86-sources-detail-warn.png` |
| 场景 | `.scene-aside` | 页脚小注 | 边注菱（上沿起头压一枚红菱，随卡片悬停翻 45°→135°） | 随卡 H | `23-scene-detail-aside.png` |

### 四、结局页

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 结局 | `.ending` | 结局卡片 | 终章双线（顶部金线压红线自左展开 + 底部中央落红菱 + 旧信纸抄写线 + 悬停抬 2px） | H E | `42-ending.png` `48-ending-detail-topline.png` |
| 结局 | `.ending-echo` | 余波 | 回声三线（一道实线拖两道渐隐影线） | H E | `42-ending.png` |
| 结局 | `.ending-coda` | 收束句 | 落款收束（居中短线，悬停向两侧撑开） | H | `43-ending-detail-coda.png` |
| 结局 | `.afterword` | 后记·史实 | 胶带斜纹（上沿一段斜纹胶带，悬停纸纹滑动） | H | `44-ending-hover-afterword.png` `45-ending-detail-afterword.png` |
| 结局 | `.ledger li` | 你带出来的 | 行李签（悬停右移 2px + 点线拉出） | H | `46-ending-detail-ledger.png` |
| 结局 | `.finale` / `.finale-canvas` 容器 | 终极画面 | 印边框（16px 内框浮出 + 四角暗光，`pointer-events:none` 不挡跳过） | E | `40-finale.png` `41-finale-detail-frame.png` |

### 五、图鉴

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 图鉴 | `.gallery-card.open` | 已解锁 | 相框金角（四角包金，悬停抬起、金角变长） | H E | `50-gallery.png` `51-gallery-hover-open.png` `52-gallery-detail-open.png` |
| 图鉴 | `.gallery-card.locked` | 未解锁 | 档案袋（45° 斜纹铺底 + 上沿红封条 + 右上十字绳扣，悬停斜纹滑动） | H E | `54-gallery-detail-locked.png` |
| 图鉴 | `.gallery-card.composite` | 合成结局 | 叠影双框（一实一虚两层错开，悬停错得更开） | H E | `55-gallery-hover-composite.png` `56-gallery-detail-composite.png` |

### 六、人物志 / 后来

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 人物志 | `.people-card`（10 张） | 档案卡 | 抽出档案卡（抬 2px + 顶部标签条自左滑过 + 左侧红栏立起） | H F A E | `60-people.png` `61-people-hover.png` `62-people-detail-card.png` `63-people-focus-card.png` |
| 后来 | `.people-card`（15 张） | 多年后的信 | 信封口（V 形封盖翻起 + 右下压一枚红邮戳） | H F A E | `70-later.png` `71-later-hover.png` `72-later-detail-card.png` |

> 两类列表共用同一个类名（`App.tsx` 里没有区分），这里用 `:has(> .people-card:nth-child(10|15):last-child)` 按张数分流。**建议 Lead 换成 data 属性，见第 4 节。**

### 七、史料库

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 史料库 | `.source-entry` | 76 张史料卡 | 索引轨 + 装订孔（悬停左侧红轨立起、卡身右移 3px、纸色微亮） | H | `80-sources.png` `81-sources-hover-entry.png` `82-sources-detail-entry.png` |
| 史料库/浮层 | `.badge` | 已核对/待补 徽标 | 印章（方角、红边、内压细红环、印泥横纹，外圈一道 -8° 偏心印边；悬停印边提亮） | H E | `83-sources-detail-badge.png` `92-source-panel-detail-badge.png` |

### 八、史料卡浮层

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 浮层 | `.source-panel` | 档案袋 | 档案袋抽出（从上方抽出 340ms + 顶部红封条压边 + 左侧装订孔） | E | `90-source-panel.png` `91-source-panel-detail-seal.png` |
| 浮层/史料库 | `.source-quote` | 引文 | 揭幕（上沿红线自左揭开 + 右下引号角收紧） | H E | `93-source-panel-hover-quote.png` `94-contrast-panel-quote-bg.png` |

### 九、关于页 / 页首导语

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 关于 | `.about h2` | 小标题 | 碑额菱（左侧红菱；悬停由实心菱空心化成一圈 1.5px 印边并放大 1.15×） | H | `66-about-hover-h2.png` `67-about-detail-h2.png` |
| 关于 | `.about p` | 内容块 | 条目立边（悬停左侧浮出一道金边） | H | `68-about-hover-p.png` `69-about-detail-p.png` |
| 关于 | `.about .quiet-button` | 返回 | 复用次按钮「铅笔划线」 | H F A | `6A-about-focus-back.png` |
| 全站页首 | `p.gallery-lead` | 导语 | 小引（前置一小段红线，悬停长出一截） | H | `50-gallery.png` `60-people.png` `80-sources.png` |

### 十、固定控件

| 页面 | 类名 | 用途 | 效果名 | 态 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 全站 | `.audio-toggle` | 声音开关 | 声纹环（悬停浮出金圈，开启时右上角亮红点） | H F A | `A0-mobile-menu.png` `01-menu.png` |
| 场景 | `.view3d-toggle` | 3D 开关 | 转面（右侧小方，悬停转 45° 成菱形，`.on` 常亮） | H F A | `20-scene-image.png` |

**合计 37 类**（目标 ≥18），其中 15 类有完整 H/F/A/E 四态，其余为不可交互卡片（无 F/A，改用「随卡/随页」间接触发，已在表里标注）。

---

## 2. 测试结论

测试入口：`node tools/card-effects-check.mjs http://127.0.0.1:4310/`
（自己起 Vite dev 4310 端口测试；4173 与 `dist/` 全程未碰）

### 2.1 截图（76 张）

`tools/shots/card-effects/` —— 菜单 / 序卷（有选项）/ 有插画场景 / 引文+继续 / 结局 / 终极画面 / 图鉴 / 人物志 / 后来 / 关于 / 史料库 / 史料卡浮层 / 移动端 390px，每屏「常态 + hover + focus-visible」各一张，另附关键卡片局部特写与对比度取样背景图。

**最出彩的五类**（建议优先看这几张）：

1. `.gallery-card` 三态 —— 同一张网格里并置「相框金角 / 档案袋斜纹+红封条 / 两件叠影」，三种手法同屏对照，最能把「一件东西一种手法」说出来：`50-gallery.png`、`53-gallery-hover-locked.png`、`55-gallery-hover-composite.png`。
2. 人物志 ↔ 后来 —— 同一个类名、同样 10/15 张卡，一边「抽出档案卡」，一边「信封口翻起 + 邮戳」，是这一轮叙事性最强的一组：`62-people-detail-card.png` 对 `72-later-detail-card.png`。
3. `.scene-image` 四角相片夹 —— 四条金角夹 + 悬停相纸微转 + 暗角加深，最像「实物」：`22-scene-detail-image-corner.png`。
4. `.quote-card` 红绳缝线 —— 左侧红虚线 + 线结，悬停线被拉紧，细节最耐看：`32-scene-detail-quote-thread.png`。
5. `.choice` 纸条折角 + `.badge` 印章 —— 一个「纸被挑起」，一个「章被盖下」，是全场点击频率最高的两处：`12-scene-detail-choice-corner.png`、`92-source-panel-detail-badge.png`。

### 2.2 横向溢出：17 个页面/视口全部 PASS

`documentElement.scrollWidth == clientWidth`（1440 与 390 两档），`.app-shell` / `.stage-content` / `.menu` / `.gallery` / `.people` / `.sources-page` 的 `scrollWidth == clientWidth`，且越界元素扫描为空。手机 390×844 下的菜单 / 场景 / 图鉴 / 人物志 / 史料库均已验（含 hover 态）。

### 2.3 console / pageerror：none

### 2.4 文字对比度：不动（这次是重点验证过的）

同一页面状态、同一元素，**开/关 `card-effects.css` 各取一次真实背景像素**（藏字后截图回灌 canvas，算法与 `tools/quality/a11y-check.mjs` 完全一致），31 个采样点：

- **31/31 PASS**（≥4.5，大字 ≥3）
- 最大降幅 **−0.51**（`.source-claim` / `.source-quote`，且该差异来自关掉本文件后页首导语复位导致的取样位置偏移，不是文字颜色变化）
- 多项反而**升高**：`.chip` +2.6、`.choice` 悬停 +7.1、`.badge` +0.3、`.scene-meta` +0.3
- 唯一真实的设计性代价已消除：`.scene` 的纸纤维最初用「提亮」写法，实测正文 p05 从 12.9 掉到 10.6，**改成压暗纤维后反升到 11.8**（`rgba(0,0,0,.055)`，纸里的杂质而非高光）

另外单独测了 **hover 态**（常态脚本测不到的那部分），11 个点全部 PASS：

| 采样点 | 字号 | p05 | 阈值 |
| --- | --- | --- | --- |
| `.menu-facts li`（悬停、字提亮） | 14px | 6.85 | 4.5 |
| `.choice-text strong`（悬停） | 17px | 9.26 | 4.5 |
| `.chip`（悬停、红章环+翘角） | 12px | 5.02 | 4.5 |
| `.source-row .eyebrow`（悬停转红 `#e0785a`） | 12px | 5.66 | 4.5 |
| `.badge`（印章态） | 11px | 5.58 | 4.5 |
| `.source-warn`（悬停） | 12px | 7.74 | 4.5 |
| `.source-panel .badge` | 11px | 7.36 | 4.5 |
| `.source-quote p` | 15.5px | 14.41 | 4.5 |
| `.scene .prose p`（悬停） | 17px | 10.30 | 4.5 |

> 顺带一条经验：**不要给带 1px 亮描边的小元素加旋转**。`.badge` 一开始整块转 -8°，1px 金边被转进取景框，p05 从 5.6 掉到 2.98（假回归）；改成「标签本体不转、外圈印边 -8° 转在盒外」，p05 回到 5.58。

### 2.5 prefers-reduced-motion：静态可用

`reducedMotion: 'reduce'` 下：`.scene::before/::after`、`.scene-head::after`、`.scene-image::before`、`.scene-aside::before` 的 `animation-name` 全部 `none`、`transform: none`，装饰以「已经画完」的静态样子出现；整卡的 `translate/rotate` 悬停位移被取消（含 `.chip`、`.gallery-card` 叠影、`.scene-image` 相纸微转）；卡片 `opacity: 1`、可读。截图 `96-reduced-motion-scene.png` / `97-reduced-motion-hover.png`。

### 2.6 连续 hover 不抖

悬停 500ms 后采样：`getAnimations()` 运行中动画 **0 个**，`.chip` 位置漂移 `dx 0 / dy 0`。所有效果都是「一次性过渡 + 静止终态」，没有常驻循环动画（`skipPulse` 之类是原有行为，未新增）。

### 2.7 滚动性能

| 场景 | 帧数 | 平均帧 | p95 帧 | 最长帧 | 60fps 预算 16.7ms |
| --- | --- | --- | --- | --- | --- |
| 场景页连续滚动（2530px，安静时） | 304 | 4.75ms | **8.4ms** | 16.7ms | ✅ |
| 史料库 76 张卡长页（27846px） | 403 | 4.21ms | **4.3ms** | 9.9ms | ✅ |

（headless 不受 60Hz 限帧，所以按「帧时间预算」判断；两趟取较好的一趟。）

**关于同机负载，必须说明**：测试后半程同机有 3 个以上并行 agent 的 Chrome 任务在跑，同一页的 p95 会在 **8.4ms ↔ 25ms** 之间大幅浮动；用「开/关本文件」各测三趟，开 24.9/25.2/33.3ms、关 16.8/20.9/24.9ms，**区间重叠**，且「开」那趟总是紧跟在重新启用样式表之后（会强制一次整卡重栅格），所以这组 A/B 不能用来归因。
可以确定的是：本文件里**没有任何逐帧运算**——没有 `filter: blur` 参与 hover、没有 `will-change`、没有常驻循环动画，滚动时页面上的新增内容只是若干静态伪元素与一层 `background-image`（纸纹），它们的绘制发生在进入页面那一次。2.5D 分层 + 粒子 + `backdrop-filter` 这些大头都在 `styles.css` / `Stage.tsx` 里，未改动。

---

## 3. 我特意「不做」的地方（附原因）

| 目标 | 原因 |
| --- | --- |
| `.ink-curtain`（换场 canvas 容器） | 墨幕由 JS 逐帧绘制、按 `data-live` 控制显隐；CSS 再叠框/滤镜会和墨迹遮罩互相打架 |
| `.stage` / `.stage-tilt` / `.stage-layer` | `Stage.tsx` 每帧写 `--px/--py` 做 2.5D；加 CSS 过渡等于双重平滑（`styles.css` 里已有同样的注释警告） |
| `.finale-skip` | 终局画面上唯一的退出提示，故意保持极淡，保持原有 hover 提亮即可 |
| `.prose p` 正文段 | 不单独做效果，避免干扰长文阅读 |
| `.source-origin` / `.source-note` / `.source-tag` / `.source-scenes` / `.people-meta` / `.people-preview` / `.playtime` / `.work-meta` | 纯文本标签，做了只会降对比度 |
| 3D 模式下的 `.scene` 纸纹 | `.stage-3d .scene` 在 `styles.css` 里把 `background` 改回半透明简写，纸纹被覆盖 —— **有意保留**，3D 下应该更透 |

---

## 4. 需要 Lead 接手的 DOM 类名（如果有）

按影响从大到小：

1. **`.people-card` 需要区分「人物志 / 后来」**（必做，否则有隐患）
   两类列表同一个类名，现在靠 `:has(> .people-card:nth-child(10):last-child)` / `…(15):last-child` 按**张数**分流。
   - 建议：`<div className="people" data-volume="5">` / `data-volume="4"`（或给卡片加 `people-card--later`），我就能改成 `.people[data-volume="4"] .people-card`。
   - 风险：卷四/卷五增删篇目后，两种效果会静默互换。

2. **`.badge` 想做成「整块真旋转 -8°」的印章，需要一层内层元素**
   现状：标签本体不转、-8° 印边转在盒外。若想整块转，需要一个不参与 a11y 取样的内层（如 `<span class="badge"><span class="badge-ink">已核对</span></span>`），否则 1px 亮描边会被转进 2px 内缩取景框，`a11y-check.mjs` 的 `.badge` p05 会从 5.6 掉到 ~3.0（假回归）。

3. **（可选）`main.app-shell[data-screen="menu|game|ending|gallery|sources|people|later"]`**
   现在页面级效果全靠结构（`:has()`、类名组合）推断；有 `data-screen` 后每屏都能安全分组，也方便后续再加卡片。

4. **（可选）`.source-row` 的编号拆成 `.source-row-index`**
   现在「史料卡 · 2」是 eyebrow 整段文本；拆出来后编号可以单独做效果，不必为了「编号变红」去改文字颜色（也就不用为了对比度把红色提到 `#e0785a`）。

---

## 5. 已知风险 / 并行冲突

- **并行 agent 正在改 `App.tsx`**：本次测试期间（23:52–23:59）陆续出现 `CarryTray`、`SpotlightFind`、`FlagRaise`、`signature-overlay` 等新组件，尾声页已从 `.choice` 改成托盘交互。本报告的截图是**该时刻的快照**；我的效果层只针对既有类名，与新类名（`carry-*` / `sig-*`）无交叉，也不影响它们。测试脚本里结局页已改成「注入 `finishedAt` + `ending` 直接落结局页」的稳定路径，不再依赖尾声实现。
- **`tools/quality/a11y-check.mjs` 目前跑不完**：并行 agent 加的 `.signature-overlay` 会拦截 `night1` 场景里的点击，脚本在第 2 段「真 3D」超时退出（与本文件无关；`tools/quality/a11y.json` 全程未被改写，已用文件哈希核对）。所以对比度回归改用 `tools/card-effects-a11y-diff.mjs`（同算法、同选择器、只跑没被浮层遮住的四屏）+ 第 2.4 节的开关 A/B。
- `.source-panel` 覆盖了 `styles.css` 的 `rise` 入场动画（改为 `cfx-panel-out`，同样 340ms）。这是本文件唯一一处覆盖入场动画；如果后面有人想保留 `rise`，删掉 `.app-shell .source-panel` 那一条即可，其余不受影响。
- `.view3d-toggle` 加了 `padding-right: 26px`（宽 +20px）。700px 窄屏下 3D 按钮只在 ≥700px 出现，实测没有压到标题，但若后续标题变长需要复看。
- `:has()` 需要 Chrome/Safari 105+；不支持时只是退回 `.people-card` 的基础效果，不会报错（选择器整条被丢弃）。

---

## 6. 复跑

```powershell
cd frontend\2026数字媒体
npm run dev -- --host 127.0.0.1 --port 4310 --strictPort   # 或任意非 4173 端口
node tools/card-effects-check.mjs http://127.0.0.1:4310/   # 76 张截图 + report.json
node tools/card-effects-a11y-diff.mjs http://127.0.0.1:4310/  # 对比度回归 vs tools/quality/a11y.json
```

输出：`tools/shots/card-effects/*.png`、`report.json`、`a11y-diff.json`。
