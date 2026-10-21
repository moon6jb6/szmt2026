# SceneBeats：长段落分三段读 + 卡片氛围随段落变化 + 人物剪影浮现

日期：2026-10-22
范围（全部新建）：`src/game/components/SceneBeats.tsx`、`src/game/components/beats.css`、`src/game/components/SilhouetteFigure.tsx`、`tools/beats-harness.html` + `tools/beats-harness.tsx`、`tools/beats-test.mjs`、本报告。
未触碰：`App.tsx`、`styles.css`、`audio.ts`、剧情数据（`src/game/content/**`）、`Scene3D.tsx`、卡片特效（`card-effects.css` 等）、`dist/`、4173 端口（玩家正在试玩）、5199 端口（别人的 dev server）。
测试自起 dev server（4301—4304 挑空闲端口，`hmr: false`），跑完即 `close()`；GPU 侧只用了 `--disable-gpu` 的软件光栅。

---

## 1. 做了什么

### 1.1 分组：最多 3 组，n ≤ 6 不动

| 段数 n | 分组 | 说明 |
| --- | --- | --- |
| ≤ 6 | 1 组（不分） | 保持现在的阅读节奏，不加点击、不出「继续读」、选项区直接出现 |
| 7 | 3 / 2 / 2 | 余数给前几组 |
| 8 | 3 / 3 / 2 | |
| 9 | 3 / 3 / 3 | |
| 10 | 4 / 3 / 3 | |
| 12 | 4 / 4 / 4 | |
| 15 | 5 / 5 / 5 | |
| 16 | 6 / 5 / 5 | |

公式：`base = ⌊n / 3⌋`，`rem = n mod 3`，前 `rem` 组各多 1 段（`groupParagraphs()`，纯函数）。

- **顺序不变、不丢段**：分组只是切片，拼回去与输入逐段一致；测试对 7/9/12/15 逐组读回后断言。
- **单段超长（> 220 字）先按句末标点切**：`。！？!?…；;` 都算句末，切块后累计到 ≤ 220 字。切完**必须能逐字拼回原文**，否则放弃切分（宁可不切，不许丢字）——测试用 273 字单段验证 `join('') === 原文`。
- **再数 n**：切完的块数决定分几组。例：8 段 × 约 300 字 → 每段切 2 块 → 16 块 → 6/5/5；反过来，单段 273 字切 2 块 → 2 ≤ 6 → 仍然 1 组（只是那一段被分成了两小段读）。
- **组间不自动翻**：只有读者点「继续读 ▸」（或 Enter / 空格）才走下一组；最后一组再点一次才把 `footer`（选项区）放出来。

### 1.2 判词：每组独立判「有没有人」「是不是回忆」

判定顺序（同一组只输出一种 mood）：

```
有人？ → figure-male / figure-female
没有人但像回忆？ → memory
都不是 → scene
```

关键词表（写在 `SceneBeats.tsx` 文件顶部注释里，改表即可扩展）：

| 类别 | 词 |
| --- | --- |
| 人物 · 具体人名 | 陈望生、李满仓、谢晋元、杨惠敏、陈树生、雷雄、韩宪元、杨瑞符、张柏亭、杨虎、上官志标、王金贵、老赵（取自 `chapter1.ts` / `volume*.ts` 里已出现的虚构与真实人物） |
| 人物 · 身份词 | 母亲、父亲、记者、护士、伤员、同乡、弟兄、士兵、班长、排长、营长、团长、媳妇、老人、老太太、姑娘、孩子、船夫、军官、哨兵、战友、先生、女士 |
| 人物 · 代词 + 落点 | 「他 / 她」**且同段**出现 脸、眼睛、眼、声音、背影、手、名字、肩、头、眉、嘴唇、眼神、额头、脖子 之一（判前先剔掉「其他 / 其它」，避免把「其他」当代词） |
| 回忆 | 记得、那年、从前、后来、想起、十年前、小时候、早年、那时候、旧年、回忆 |
| 性别 · 偏女 | 杨惠敏、母亲、护士、媳妇、姑娘、女人、女士、老太太、妇人、嫂子（各 3 分）、她（1 分／次，封顶 3 分） |
| 性别 · 偏男 | 陈望生、谢晋元、李满仓、陈树生、士兵、弟兄、班长、排长、营长、团长、军官、哨兵、战友、男人、父亲、先生（各 3 分）、兵（1 分）、他（1 分／次，封顶 3 分） |

- 性别只在「有人」的组里算；**女分 > 男分才判 female，平手判 male**（判不出来默认男性）。
- 「他 / 她」单出现不算人物 —— 否则这个文本里几乎每一段都会浮剪影，剪影就失去信息量了。

4 个样例（harness 第二栏，测试逐条断言）：

| 样例 | 文本 | mood |
| --- | --- | --- |
| 人名 + 回忆 | 「陈望生想起那年冬天，李满仓蹲在城隍庙门口啃甘蔗，露出一颗缺了的门牙。」 | `figure-male` |
| 含「她」 | 「她把脸别过去，声音低下去：「你们吃吧，我不饿。」」 | `figure-female` |
| 纯环境 | 「夜里落了一场雨，仓库的铁皮顶响了一夜。天亮时水还在往沙袋缝里渗。」 | `scene` |
| 纯回忆 | 「那年冬天，雪下得很早，河面结了薄冰，冰上有脚印一直走到对岸。」 | `memory` |

### 1.3 视觉：卡片上三层，全部在正文下面

| 层 | 触发 | 做法 |
| --- | --- | --- |
| `.beats__atmos` | `memory`（含「人物组里也有回忆词」） | 暖褐 radial + linear 渐变 + 两道 `repeating-linear-gradient` 纸纹（α 0.024—0.032，极淡）；560ms 淡入 |
| 卡片底色 | `figure-male` / `figure-female` | `--beats-card-alpha` 从 0.78 → **0.84**（半透明加深 6%），`@property` 注册后 520ms 过渡 |
| `.beats__figure` | `hasPerson` | 右下方上半身剪影：`opacity` 0.14（男）/ 0.12（女），`blur(1.5px)`，0 → 目标 **800ms** + 向左下漂移 6px，底部 mask 让躯干淡出 |
| `.beats__scrim` | `hasPerson` | 正文区一层 `linear-gradient(94deg, rgba(10,8,6,.44) → 透明)` 的压深底，560ms 淡入 |

不挡字的三重保证（测试逐条验证）：

1. 剪影 `z-index: 0`、正文 `z-index: 1`（`.beats__stage` 自成层叠上下文，scrim 在正文之下、剪影之上）；
2. 剪影 `pointer-events: none`，正文 12 个采样点做 `elementFromPoint` 命中测试，全部落在 `<p>` 上；
3. 人物组多一层压深 scrim → 正文对比度只升不降（正文仍是 `#ede6d8`，底色更暗）。

剪影尺寸按高度定（`height: min(72%, 300px)` + `aspect-ratio: 200/260`），卡片矮就跟着缩，永远不越过卡片下沿；躯干本来就在 viewBox 底边被裁，落地后正好是「半个躯干」。

### 1.4 交互与状态

| 事件 | 行为 |
| --- | --- |
| 点「继续读 ▸」 | 旧组 220ms 墨色擦除（淡出 + 一道墨带横扫）→ 新组逐段错峰淡入（每段 60ms，上限 240ms，单段 520ms） |
| 最后一组再点一次 | `finished = true`：按钮收起，`footer(done=true)` 出现（420ms 淡入） |
| 只有 1 组（≤ 6 段） | 按钮根本不渲染，`footer(done=true)` 立刻出现 |
| 连点 / 连按 | `ADVANCE_LOCK_MS = 300` 锁：一次手势只走一组。测试同步连发 8 次点击、以及鼠标双击，都只前进 1 组 |
| Enter / 空格 | 焦点在卡片内（含按钮）或焦点在 body 上都可推进；焦点在按钮上时交给浏览器原生点击，避免一次按键走两组 |
| 多实例共存 | 焦点在谁里面就归谁；焦点在 body 上时归「最近点过」的实例，一个都没点过归最先挂载的（真实 App 只有一个实例，不受影响） |
| 换场景 | `paragraphs` 内容签名一变就回到第一组（用内容而不是数组引用做依赖，App 每帧新建数组也不会把进度重置掉） |

时长预算（都在 `beats.css` / 组件常量里，改一处即可）：

```
擦除 220ms · 错峰 60ms/段（≤240ms）· 单段淡入 520ms · 墨带 220ms
剪影浮现 800ms · 卡片加深 520ms · 氛围/scrim 560ms · 选项区 420ms · 连点锁 300ms
```

### 1.5 无障碍

- 卡片 `role="group" aria-label="正文，分三段阅读"`；`role="progressbar"` 的墨点带 `aria-valuemin/max/now`；另有 `aria-live="polite"` 的「第 N 组，共 M 组」。
- 三枚墨点本身 `aria-hidden`（不是三个按钮，不抢 Tab）。
- 剪影 `aria-hidden="true"` + `focusable="false"`：它是氛围，不是内容。
- 「继续读」是真实 `<button type="button">`，`focus-visible` 用金色描边（跟全局 `:focus-visible` 一致）。

### 1.6 降级（prefers-reduced-motion / `reduceMotion`）

- 不传 `reduceMotion` 时跟随系统 `matchMedia`；传了就覆盖。
- 降级时：段落 `animation: none; opacity: 1`（直接替换）、不渲染擦除层与墨带、卡片无过渡、剪影 `transform: none` 但**保留**目标透明度。
- 测试覆盖：`animationName === 'none'`、`opacity === 1`、`transitionDuration === 0s`、仍能推进、走完三组仍出 footer。

### 1.7 移动端（≤ 640px）

- 剪影挪到右下角、`height: min(56%, 240px)`、`right: -6%`（出血被 `.beats__stage` 裁掉）、`--fig-scale: 0.82` 让透明度再低一档（0.14 → 0.115），上下双向 mask 淡出。
- 压深底改成上下渐变（0.34 → 0.62），正文更稳。
- 390×844：`document.scrollWidth === 390`、卡片 `scrollWidth === clientWidth`、正文字号 16px、首段 `opacity 1`。

---

## 2. 文件清单

| 文件 | 说明 |
| --- | --- |
| `src/game/components/SceneBeats.tsx` | 组件本体 + 分组/判词纯函数（约 470 行，含顶部关键词表与规则注释） |
| `src/game/components/beats.css` | 样式（自带 token 兜底，可独立跑；类名全部 `.beats*` / `.silhouette*`，不污染 `styles.css`） |
| `src/game/components/SilhouetteFigure.tsx` | 人物剪影（纯内联 SVG：士兵 / 挽发女性，三层错位叠印做毛边） |
| `tools/beats-harness.html` / `.tsx` | 验证页（五栏：主线七段 / 判词样例 / 分组矩阵 / 边界 / 扁平接入），App 不引用 |
| `tools/beats-test.mjs` | Playwright 验收（自起 dev server，4301—4304，关 HMR） |
| `tools/shots/beats/*.png` + `summary.json` | 18 张截图与结构化结果 |

> harness 为什么是两件套：组件是 `.tsx` + `.css`，Node 直接 import 跑不起来；用 Vite dev server 托管一页是最短路径。它不参与正式渲染。

---

## 3. 组件 API

```tsx
import { SceneBeats } from './game/components/SceneBeats'
import type { Mood, BeatChangeInfo, SceneBeatsProps } from './game/components/SceneBeats'

type Mood = 'scene' | 'memory' | 'figure-male' | 'figure-female'

type BeatChangeInfo = {
  index: number      // 当前第几组（0 起）
  total: number      // 一共几组
  mood: Mood
  hasPerson: boolean
}

type SceneBeatsProps = {
  paragraphs: string[]
  footer?: (done: boolean) => ReactNode      // 只有 done 之后才会被渲染
  onBeatChange?: (info: BeatChangeInfo) => void
  onSound?: (cue: 'paper' | 'ink') => void
  reduceMotion?: boolean
  className?: string
}
```

| 回调 | 语义 |
| --- | --- |
| `onBeatChange` | 首组在挂载后立即回调一次，之后每次换组回调一次。`mood` 直接喂给 Stage 换整页背景；`hasPerson` 可以给天气/音效做分支 |
| `onSound('paper')` | 翻到**普通叙事组**（`scene`）→ 接 `playSfx('page-turn')`（`playSfx` 已在本项目 `audio.ts` 导出，App 里已在用，不用改 import） |
| `onSound('ink')` | 翻到**回忆 / 人物组** → 接 `playSfx('ink')`（`audio/page-turn.ogg`、`audio/ink.ogg` 都在 manifest 里，是第 9、10 号素材）。最后一组点「读完」时回 `paper`（合上这一页） |
| `footer(done)` | 选项区。实现上只在 `done === true` 时渲染，所以传进来的 `done` 恒为 `true`——签名留着是为了将来允许「读的时候也显示灰态选项」 |

导出的纯函数（诊断 / 预计算 / 写测试都能用，不依赖 React）：

```ts
buildBeats(paragraphs): Beat[]                 // 分组 + 判词，一次到位
groupParagraphs(paragraphs): string[][]
classifyBeat(paragraphs): { mood, hasPerson, memory }
splitLongParagraph(text, limit = 220): string[]
paragraphHasPerson(paragraph): boolean
genderOf(text): 'male' | 'female'
```

**DOM 观测点**（测试与调试用，不承诺长期稳定）：
`.beats[data-mood|data-has-person|data-memory|data-beat-index|data-beat-total|data-done|data-reduce-motion]`、
`[data-testid="beats"|"beats-next"|"beats-footer"]`、`.beats__beat--current .beats__para`、`.beats__dot[data-current]`、
`.beats__figure[data-opacity]`、`.silhouette[data-variant]`。

---

## 4. 测试

```bash
cd frontend/2026数字媒体
node tools/beats-test.mjs            # 自起 dev server（4301 起），82 项 / 17 图
node tools/beats-test.mjs appcss     # 再挂一次 App 的 styles.css，85 项 / 18 图
node tools/beats-test.mjs http://127.0.0.1:5199/tools/beats-harness.html   # 对着已有 server 跑
```

- 浏览器：`chromium.launch({ channel: 'chrome', args: ['--disable-gpu', '--disable-software-rasterizer'] })`，走 CPU 光栅（不碰 GPU）。
- dev server：`vite.createServer({ root, cacheDir: 'node_modules/.vite-beats', server: { port: 4301—4304, strictPort: true, hmr: false } })`——独立 cacheDir 不与 5199 抢依赖缓存，`hmr: false` 保证测试页不会被整页重载。
- 每个页面都挂 `framenavigated` 计数并断言 `navigations ≤ 1`：仓库里同时有别人在改文件，一旦 HMR 整页重载，状态会被清空、后面的断言全不作数——这条会直接把它抓出来（自起 server 关掉 HMR 之后恒为 1）。
- 输出：控制台 `PASS/FAIL` + `tools/shots/beats/summary.json`。

**结果：默认 82/82、挂 App CSS 85/85，单轮约 33—40s；连跑 4 轮全绿。**

| 组 | 项数 | 覆盖 |
| --- | --- | --- |
| 首屏 | 6 | 7 段分 3 组 / 首组判 scene / 三枚墨点且第一个实心 / 有按钮无 footer / `onBeatChange` 首帧 / Stage 拿到 scene |
| 换组 | 8 | memory 组判词与纸纹 / 无人不出剪影 / 墨点跟随 / Stage 换底色 / 人物组判词 / 剪影出现 / 男/女变体 |
| 剪影 | 8 | computed opacity ∈ [0.08,0.2]、`data-opacity` ∈ [0.10,0.16]、blur 1—2px、`aria-hidden`、`pointer-events:none`、z-index 在正文下、卡片 α 0.84 |
| 正文 | 2 | 12 个采样点命中测试都不是剪影；正文仍是纸白 + 多一层压深 scrim |
| 收尾 | 6 | `done=true`、footer 出现且 `data-done=true`、按钮收起、三次回执、音效 `ink ink paper`、页面未重载 |
| 分组矩阵 | 16 | 7/9/12/15 各 4 项：分 3 组、组大小 3-2-2/3-3-3/4-4-4/5-5-5、逐组读回顺序不变不丢段、读完收起按钮 |
| 判词样例 | 6 | 4 个样例 mood 逐个断言 + 女性剪影变体 + 女性 opacity 区间 |
| 边界 | 5 | ≤6 段只 1 组/直接 done/无按钮/选项区立刻出现；273 字单段切 2 段且逐字不丢、不额外分组 |
| 键盘 | 3 | Enter 推进（不必先聚焦按钮）、空格再推进、只推进当前实例 |
| 连点 | 2 | 同步连发 8 次只前进 1 组；鼠标双击只前进 1 组 |
| 降级 | 9 | 跟随系统 + 强制开启两条路径：标记、无动画、直接可见、无过渡、仍能推进、无擦除层、footer 正常 |
| 390px | 7 | 页面/卡片无横向溢出、正文可读、剪影出血 ≤9% 且被 stage 裁切、底部淡出 mask、移动端透明度更低、剪影仍在 |
| 扁平接入 | 4 | 仍分 3 组、无第二层卡片（无底色/边框/内边距）、宽度跟随 `.scene` 内容盒、人物组照样出剪影 |
| 过渡 | 1 | 切组瞬间擦除层 + 墨带 + 新组三层同屏（舞台高度锁 162px） |
| 接入 App CSS | 3 | 挂上 `styles.css` 后卡片仍 ≤760px、无横向溢出、剪影仍在 |
| 全局 | 2 | 两次 `navigations ≤ 1`；全程无 console error / pageerror |

另：`npx tsc -b`（strict，含 `src` 全部文件）**通过，零错误**。

**截图**（`tools/shots/beats/`，按最终一轮 `appcss` 存档，18 张）

| 文件 | 内容 |
| --- | --- |
| `01-harness-top.png` | 验证页首屏：Stage 模拟层 + 第一组（scene）+ 判词样例 |
| `02-stage-scene.png` / `03-card-scene.png` | scene：冷灰夜色 stage，卡片无额外氛围 |
| `04-stage-memory.png` / `05-card-memory.png` | **memory：暖褐 stage + 卡片旧纸纸纹** |
| `06-stage-figure-male.png` / `07-card-figure-male.png` | **figure-male：stage 加深 + 卡片右下方士兵剪影** |
| `08-card-done-footer.png` | 读完三组：按钮收起、选项区出现、剪影仍在背后 |
| `09-matrix-grid.png` | 分组矩阵 7/9/12/15 → 3-2-2 / 3-3-3 / 4-4-4 / 5-5-5 |
| `10-card-figure-female.png` | 含「她」的组：挽发女性剪影（opacity 0.12） |
| `11-card-long-paragraph.png` | 273 字单段按句号切成 2 段 |
| `12-reduced-motion-done.png` | reduced-motion 走完三组的静态状态 |
| `13/14/15-mobile-390-*.png` | 390×844：scene 卡 / 人物组卡 / 整页（无横向滚动） |
| `16-with-app-css.png` | 挂上 App `styles.css` 之后的同一张卡（无样式污染） |
| `17-flat-inside-scene.png` | `beats--flat` 嵌进模拟的 `.scene` 卡片：没有「卡中卡」 |
| `18-transition-inflight.png` | 过渡中间帧（把动画放慢 6 倍抓的一帧）：旧组淡出 + 新组错峰淡入 |

---

## 5. App 接入（Lead 用，4 处改动 + 2 个可选）

> 行号对应当前 `src/App.tsx`（1298 行版本）。建议只在**主线场景**（`renderScene`）里用；结局页 / 人物志 / 后来页（`renderParagraphs` 的另外三处调用）保持原样，节奏不变。

**① 引入 + 一个 mood 状态**（文件顶部 import 区、`App()` 内）：

```tsx
import { SceneBeats } from './game/components/SceneBeats'
import type { Mood } from './game/components/SceneBeats'

const [beatMood, setBeatMood] = useState<Mood>('scene')
// 换场景/换结果页先把氛围归零，避免上一场景的剪影跟着新场景闪一下
useEffect(() => setBeatMood('scene'), [sceneId, state.pendingOutcome])
```

**② 正文换成 SceneBeats**（第 630—631 行，`.scene-body` 里的第一行）：

```tsx
<div className="scene-body">
  <SceneBeats
    className="beats--flat"                                  // 去掉自己的卡片层，避免卡中卡
    paragraphs={hasOutcome ? state.pendingOutcome!.paragraphs : scene.paragraphs}
    onBeatChange={(info) => setBeatMood(info.mood)}          // ← ③ 用这个换背景
    onSound={(cue) => { if (audioOn) playSfx(cue === 'ink' ? 'ink' : 'page-turn') }}
    footer={() => (
      <>
        {/* 原来的引文卡、选项区、继续按钮，原样搬进来 */}
        {hasOutcome && state.pendingOutcome?.quote && <blockquote className="quote-card">…</blockquote>}
        {!hasOutcome && scene.choices && scene.choices.length > 0 && (
          scene.id === 'epilogue'
            ? <CarryTray choices={scene.choices} onChoose={(id) => onChoose(id)} onSound={…} />
            : <div className="choices">…原来的按钮…</div>
        )}
        {hasOutcome && (
          <button className="primary-button continue" onClick={(event) => { fireBurst('continue', event.clientX, event.clientY); onAdvance() }}>
            {state.ending ? '把东西交出去' : '继续'}
          </button>
        )}
      </>
    )}
  />
</div>
```

搬进 `footer` 的东西会在**读完最后一组之后**才出现；如果想让引文卡一直可见，把它留在 `footer` 之前（`.scene-body` 里、`<SceneBeats>` 上面）。

**③ 把 mood 传给 Stage**（第 1191—1194 行）：

```tsx
<Stage
  background={beatMood === 'memory' ? 'dawn' : (scene?.background ?? 'warehouse')}   // 回忆偏暖，其余沿用场景
  weather={beatMood === 'memory' ? 'ash' : (scene?.weather ?? 'none')}               // 可选：回忆落灰
  mode3d={show3d}
  scene3d={…}
>
```

`Stage` 只认 6 个已有背景键（`office/warehouse/river/flag/bridge/dawn`，未知键回退 warehouse）。想给三类 mood 各自的整页底色，最省事的做法是**不动 Stage**：给一个包裹层加属性，用 CSS 调 `.stage-grade`：

```tsx
<Stage background={…} weather={…}>{(
  <div className="scene-shell" data-beat-mood={beatMood}>{renderScene()}</div>
)}</Stage>
```

```css
/* styles.css 追加（Lead 侧改动，不是本次交付内容） */
.scene-shell[data-beat-mood='memory'] ~ .stage .stage-grade,
.app-shell[data-beat-mood='memory'] .stage-grade { background: radial-gradient(120% 90% at 50% 0%, rgba(122, 62, 46, .5), transparent 62%); }
.app-shell[data-beat-mood='figure-male'] .stage-grade,
.app-shell[data-beat-mood='figure-female'] .stage-grade { background: rgba(10, 8, 6, .38); }
```

（验证页 `tools/beats-harness.html` 里的 `.stageMock[data-mood]` 就是这套映射的可运行样例，`02/04/06-stage-*.png` 是它的三种样子。）

**④ 必须让出键盘**（第 460—466 行）：`pendingOutcome` 现在由 SceneBeats 分段读，App 的全局 Enter/空格会和组件的推进打架——一次按键走两下（先推进一组，又直接进下一场景）。改成：

```tsx
if (pending) {
  // 结果页正文已经交给 SceneBeats 分段：Enter/空格先在组内推进，读完由 footer 里的「继续」走下一步
  return
}
```

（如果不想动这段，也可以让组件 `reduceMotion` + `footer` 里自己收键盘，但那是两套键盘归属，容易再打架，不推荐。）

**可选 A：选项区出现后再压暗剪影。** 现在读完后剪影仍留在选项背后（`08-card-done-footer.png` 那样）。想更退一层，加一条：

```css
.beats[data-done='true'] .beats__figure { opacity: calc(var(--fig-opacity) * var(--fig-scale) * .6); }
```

注意别改 `.beats__figure` 的 `animation`（浮现动画用 `fill-mode: both` 锁着 opacity，普通声明会被动画盖掉）。

**可选 B：不要卡片层。** 不传 `className="beats--flat"` 时组件自带 `min(760px, 100%)` 的卡片（底色/边框/backdrop-filter/投影，参数与 `.scene` 一致）——适合独立成页或预览；嵌进 `.scene` 时用 `--flat`，就不会出现双层卡。`--flat` 下「人物组底色 +6%」由 scrim 代偿，纸纹/剪影/工具条都还在。

---

## 6. 已知风险 / 边界

1. **键盘归属必须由 App 让路**（见 ④）：不改 App 的全局 Enter/空格，结果页会「一按两跳」。这是接入前唯一必须处理的一项。
2. **`≤ 6 段不分` 是硬规则**：140 个场景里有不少 4—6 段的长场景，它们不会出现「继续读」。想按字数而不是段数触发，改 `groupParagraphs()` 一处即可（现在只有 `expanded.length > 6` 一条判断）。
3. **单段切分是「保守切」**：`splitLongParagraph` 只在能逐字拼回原文时才切；遇到没有句末标点的长段（意识流、排比）会原样返回，那一段就仍然很长。
4. **判词是关键词表，不是语义模型**：「后来」「那年」在叙事里也常出现 → 会被判成 `memory`（暖褐纸纹）。这是刻意选的保守方向（宁可多一点旧纸感，不要漏掉回忆），要收紧就把 `MEMORY_WORDS` 里的「后来」去掉。
5. **人名表来自当前正文**（陈望生、李满仓、谢晋元…）。新增人物只在正文里出现、没进表时，靠「身份词」或「代词 + 落点」兜底；两者都没有就不会浮剪影。扩展点就是文件顶部那几张表。
6. **剪影是「氛围」不是「肖像」**：士兵与挽发女性两个变体，用于区分「这一段里有个他 / 她」，不对应具体人物；`data-variant` 只有 `male`/`female` 两值。
7. **`.silhouette` 类名比较通用**：`beats.css` 里的样式都限定在 `.beats__figure .silhouette` 之下，但若将来别的组件也叫 `.silhouette`，建议改成 `beats__silhouette`（测试里的断言选择器要同步）。
8. **多实例键盘规则**：同一页同时挂两个 SceneBeats（比如验证页），焦点在 body 上时按键只推进「最近点过」的那个实例；真实 App 只有一个实例，不受影响。
9. **`position: sticky` 与父级 `overflow`**：工具条靠 sticky 贴底，所以 `.beats` **没有** `overflow: hidden`（有的话 sticky 失效）。剪影的裁切交给 `.beats__stage`（`overflow: hidden`）。如果 Lead 给 `.scene` 或 `.scene-body` 加 `overflow: hidden`，sticky 会退化成普通流——功能不受影响，只是工具条不再贴底。
10. **`?appcss=1` 的判定**：文件不存在时 dev server 会回 SPA 的 `index.html`（200 + text/html），所以验证页用 `link.sheet` 判断「真的解析成了样式表」，不能只看 `onload`。

---

## 7. 复现 / 复看

```bash
cd frontend/2026数字媒体
node tools/beats-test.mjs            # 82/82 + 17 张图 + summary.json
node tools/beats-test.mjs appcss     # 85/85（多一张 with-app-css.png）
npx tsc -b                           # 零错误
```

打开验证页（二选一）：

```bash
npm run dev -- --host 127.0.0.1 --port 5198      # 自己起，不碰 4173
# 然后访问 http://127.0.0.1:5198/tools/beats-harness.html
```

验证页右上角可以强制 `reduceMotion`、点「重开」重置；五栏从上到下就是本报告的五个结论：分组 → 判词 → 矩阵 → 边界 → 扁平接入。
