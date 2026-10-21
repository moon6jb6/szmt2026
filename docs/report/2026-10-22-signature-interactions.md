# 签名时刻交互：灯下找名字 / 升旗（2026-10-22）

> 两个独立 React 组件，供《把名字留下来》在剧情里插入「签名时刻」。
> **没有改 App.tsx / styles.css / audio.ts / Scene3D / 剧情数据 / public / dist，也没有重启 4173。**
> 独立验证页跑在 Vite dev（5173），由 `tools/signature-test.mjs` 做 Playwright 验收：**36 / 36 通过，0 console error**。

## 一、交付物

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/game/components/SpotlightFind.tsx` | 424 | 第一夜「灯下找名字」 |
| `src/game/components/FlagRaise.tsx` | 452 | 第三夜「升旗」 |
| `src/game/components/signature.css` | 1689 | 两个组件的全部样式（37.4 KB，gzip 8.9 KB） |
| `tools/signature-harness.html` + `tools/signature-harness.tsx` | 189 + 142 | 独立验证页（按钮 / 回调计数 / seed / reduceMotion 开关） |
| `tools/signature-test.mjs` | 478 | Playwright 验收（约 33 秒跑完） |
| `tools/shots/signature/` | 16 张 PNG + `summary.json` | 截图与断言明细 |

两个组件共用一份 CSS，随组件 `import` 进包；样式全部锁在 `.sig-spot` / `.sig-flag` 前缀下，颜色和字体走项目已有的 `--ink / --paper / --red / --gold / --serif / --sans`（带兜底值，所以验证页不加载 `styles.css` 也正常）。

## 二、SpotlightFind（第一夜 · 灯下找名字）

1937-10-26 深夜，四行仓库底楼，只有一盏煤油灯。CSS 画的货架、木箱、白铁皮文件箱、墙钉、麻袋、枪架、空弹壳；一块 16:9 场景，一个跟着鼠标/手指走的手电光圈。

**做法**

- 光圈是**一层遮挡 + CSS `mask` 开孔**：`--lx / --ly / --lr` 三个变量由 rAF 写，`mask-image: radial-gradient(circle var(--lr) at var(--lx) var(--ly), …)`。没有 canvas 逐帧绘制，遮罩只画一张渐变。
- 三个热点**随机但固定**：三处物件（货架木牌 / 木箱侧板 / 墙钉纸角）是固定锚点，`seed` 只在锚点附近抖动位置（±3%）并轮换名册顺序，所以同一 `seed` 永远同一布局、换 `seed` 位置和名字都会变。
- 只有光圈靠近才显形：每个 `<button>` 由 rAF 算「光圈中心 → 热点」距离，写 `--near`（0—1），`opacity: calc(.035 + .965 * var(--near))`；距离阈值随场景宽度缩放（`--lr` 的 0.42—1.2 倍做 smoothstep）。
- 点中后该处浮出「李满仓 / 十九岁 / 通城 沙堆」，名册行 +1（右上角三道铅笔行记点亮），触发 `onSound?.('paper')`。
- 三个找齐：整间屋子亮一层（遮挡层 0.95 → 0.28），出现「把名字描下来 →」，点它 `onSound?.('pen')` + `onComplete()`。

**API**

```ts
type SpotlightFindProps = {
  onComplete: () => void                              // 点「把名字描下来」后调用
  onSound?: (cue: 'paper' | 'pen') => void            // paper=找到一处，pen=描名字
  reduceMotion?: boolean                              // 不传则跟随 prefers-reduced-motion
  seed?: number                                       // 默认 1；决定热点位置与名册顺序
}
```

**键盘与无障碍**

- 三个热点是真实 `<button>`，`aria-label="找到第 N 个名字"`，Tab 顺序即 1→2→3；`aria-pressed` 表示是否已点亮。
- Enter / 空格直接点亮，**不要求光圈先照到**（键盘触发的 click `detail === 0`，不走距离判定）。
- 名册行数变化走 `role="status" aria-live="polite"`（「名册行 1 / 3。货架第二层的木牌：李满仓，十九岁。」）。
- 焦点落在热点上时，光圈自动移过去，键盘用户也能看见自己选中了哪一处。
- `prefers-reduced-motion`（或 `reduceMotion`）下：光圈不跟随、直接去掉 mask 显示全屋，三个热点给虚线轮廓 + 中心铅笔点。

**手机**

触摸拖动移动光圈（`touch-action: none`，`pointerdown` 时把光圈瞬移到指尖）；点击判定用「指针到热点中心距离 ≤ 热点尺寸」兜住「点一下热点附近」。

## 三、FlagRaise（第三夜 · 升旗）

1937-10-28 夜，楼顶。竹竿接的旗杆（竹节、绳绑的杆脚）、女儿墙、沙袋、楼梯间、探照灯、南岸灯。旗面从杆底出发，按住往杆顶送。

**手法**

- 拖拽是**相对位移**：按下时记住起点，`进度 = 起点进度 + (起点 Y − 当前 Y) / travel`，`travel = 杆高 − 旗面高`（ResizeObserver 量出来的 px，写进 `--travel` 与 `data-travel`）。抓旗面中间还是抓角，手感一致，触摸端不跳。
- **风阻**：拖动/按住时，显示进度 = 目标进度 − `0.05 × |sin(now/300)|`。也就是往上送的过程中，旗会周期性地被风往回拽一点；松手立刻停。
- **松手下滑**：`进度 −= 0.1`，靠 `transition: transform 420ms` 滑下去（拖动时 `data-dragging="1"` 关掉过渡，所以跟手不粘）。
- **判定**：显示进度 ≥ 90% 且目标进度 ≥ 90%，保持 **300ms** 才算成功；杆上画了一道「九成」粉笔刻度，玩家看得见目标。成功 → 旗面 `scaleX(0.46 → 1.06 → 1)` 展开 + 之后缓慢飘动，`onSound?.('cloth')`，**900ms 后** `onComplete()`（reduced-motion 60ms）。
- **跳过**：右上角「跳过」永远在，`onSkip?.()`，不调 `onComplete`，不卡流程。

**API**

```ts
type FlagRaiseProps = {
  onComplete: () => void                              // 到顶 + 保持 300ms + 展开后调用
  onSound?: (cue: 'rope' | 'cloth') => void           // rope=开始拖，cloth=展开
  reduceMotion?: boolean                              // 不传则跟随 prefers-reduced-motion
  onSkip?: () => void                                 // 跳过：由 Lead 决定走哪一支
}
```

**键盘与无障碍**

- 旗面是 `role="slider"` + `tabIndex={0}`，`aria-valuemin/max/now` + `aria-valuetext`（「旗面升到 62%」/「旗面已到杆顶，96%」），`aria-orientation="vertical"`。
- Tab 聚焦后**按住 ↑ 或空格**累积进度（rAF 计时，不靠 keydown 重复），↓ 回落，Home 回杆底；松开也会下滑一点。
- 焦点环只在**键盘输入**时出现：`data-input="keyboard"` 才画虚线框，鼠标拖完不会留一圈虚线（这条靠 document 上的输入模态监听实现）。
- 状态文字走 `role="status" aria-live="polite"`：「还没有到杆顶。」→「到顶了，攥住别松。」→「旗升到杆顶。风把旗展开，又卷住。」
- `prefers-reduced-motion`：无风阻（`data-wind="0"`，拖到顶就是 100%）、无展开/飘动动画、无探照灯扫光。

**手机**

`touch-action: none` + pointer capture；390px 下旗面 92—117px 宽、travel ≈ 200px；场景高度 `clamp(320px, 54vh, 420px)`。

## 四、测试

**环境**：`npx vite --port 5173 --strictPort`（我起的后台进程，未碰 4173）；Playwright 1.64.1，`channel: 'chrome'`（失败回退自带 chromium），视口 1280×1000 / 390×844，`reducedMotion` 用 `browser.newPage({ reducedMotion: 'reduce' })` 真模拟。

```bash
node tools/signature-test.mjs                      # 默认 http://127.0.0.1:5173/tools/signature-harness.html
node tools/signature-test.mjs <harness-url>
```

**结果：36 / 36 通过，0 console error / pageerror，约 33 秒。** 明细见 `tools/shots/signature/summary.json`。

| 组 | 断言 | 实测 |
|---|---|---|
| Spotlight | 3 个热点、真实 `<button>`、`找到第 N 个名字` | count=3，标签顺序正确 |
| Spotlight | Tab + Enter 点亮 3 个 | `data-found=3` |
| Spotlight | 找齐后出现「把名字描下来」 | 可见且文案正确 |
| Spotlight | 点完成 → `onComplete` 一次；`onSound` 有 paper/pen | `paper paper paper pen` |
| Spotlight | 鼠标点中三处 | `data-found=3` |
| Spotlight | 同一 seed 布局固定 / 换 seed 变化 | 同 seed 完全一致；seed 1→2 位置与名册顺序都变 |
| Spotlight | reduced-motion：`data-reduce=1`、热点 opacity=1、`mask-image: none`、可完成 | opacity=1,1,1 / mask=none |
| Spotlight | 390px 无横向溢出、场景有高度、可点完 | scrollWidth=390 / h=236 |
| Flag | 鼠标拖到顶 + 保持 520ms → `phase=raised` | progress=99（风阻中） |
| Flag | `onComplete` 一次、`onSound` rope+cloth、`aria-valuenow=100` | 全部满足 |
| Flag | 拖到 45% 松手会下滑 | 拖到 42 → 松手 35 → 落定 35 |
| Flag | 跳过可用且不触发完成、phase=skipped | onSkip=1 / onComplete=0 |
| Flag | 旗面可 Tab 聚焦、按住 ↑ 可完成 | progress=100、aria=100 |
| Flag | 键盘聚焦保留焦点环（`data-input=keyboard`） | 满足 |
| Flag | reduced-motion：`data-wind=0`、拖到顶 100%、可完成 | progress=100 |
| Flag | 风阻在拖动中把进度往回拽 | 采样 80,82,83,85,83,82,81,80,80,81,82（phase=idle） |
| Flag | 390px 无横向溢出、场景 420px 高、可拖到一半 | scrollWidth=390 |
| 接入 | 加载 `styles.css` 后两组件仍可完成 | 都在 |
| 全局 | 两组件无 console error / pageerror | 0 |

验证页支持 `?appcss=1`，会额外 `import('../src/styles.css')`，用来模拟真实接入后的全局样式污染（最后一组断言就是这个）。

**截图**（`tools/shots/signature/`）

| 文件 | 内容 |
|---|---|
| `01-harness-full.png` | 验证页整体（两个组件 + 回调计数） |
| `02-spot-idle.png` | 灯下找名字 · 初始（只有煤油灯和一个光圈） |
| `03-spot-keyboard-found.png` | 键盘点亮 3 个后的名册与按钮 |
| `04-spot-complete.png` | 点完「把名字描下来」 |
| `05-spot-two-lit.png` / `06-spot-three-lit.png` | 鼠标点亮过程中的两态 |
| `07-spot-reduced-motion.png` | 减少动效：全屋可见 + 虚线热点 |
| `08-spot-390.png` / `09-spot-390-done.png` | 390px 初始 / 完成 |
| `10-flag-raised.png` | 旗到杆顶（展开后） |
| `11-flag-half-release.png` | 拖到一半松手（35%） |
| `12-flag-skipped.png` | 跳过后 |
| `13-flag-keyboard.png` | 键盘完成（可见焦点环） |
| `14-flag-reduced-motion.png` | 减少动效：无风阻到顶 |
| `15-flag-390.png` | 390px |
| `16-spot-with-app-css.png` | 加载 App `styles.css` 后的效果 |

![灯下找名字（点亮 3 个）](../../tools/shots/signature/06-spot-three-lit.png)

![升旗（到杆顶）](../../tools/shots/signature/10-flag-raised.png)

![灯下找名字 reduced-motion](../../tools/shots/signature/07-spot-reduced-motion.png)

![升旗 390px](../../tools/shots/signature/15-flag-390.png)

## 五、接入 App（3—5 行示例）

音效沿用现有资产：`paper / pen / ink / flag-flap` 都在 `public/audio/`，`playSfx(id)` 直接可用。

```tsx
// 第一夜：场景正文之后、抉择之前
{scene.id === 'night1' && (
  <SpotlightFind
    seed={4}
    onSound={(cue) => playSfx(cue)}                                   // paper → paper.ogg，pen → pen.ogg
    onComplete={() => addFlag('signature_night1')}                    // 只记标记，流程仍由「继续」推进
  />
)}
```

```tsx
// 第三夜：升旗这一场
{scene.id === 'night3' && (
  <FlagRaise
    onSound={(cue) => playSfx(cue === 'rope' ? 'ink' : 'flag-flap')}
    onComplete={() => { playEvent('carrier:flag'); addFlag('signature_night3') }}
    onSkip={() => addFlag('signature_night3_skipped')}                // 跳过不卡流程，也不给「旗」载体
  />
)}
```

两行要点：

- `onComplete` 里**不要立刻切场景**：升旗的展开动画还没走完，建议只置标记，等玩家点「继续」再推进（第一夜同理）。
- 音效是纯回调，组件不认识 `audio.ts`，也不 import 它，方便你先接 `/sfx` 的 hover/click 再替换。

## 六、已知风险

1. **名字是虚构的**。「李满仓 / 王金贵 / 赵二柱」沿用正文里已出现的虚构通城兵（chapter1、volume1），年龄也是虚构。要换成 1947 年四十九壮士的真实姓名，必须同时挂史料卡，否则违反设计基线「未核实不进正文」。
2. **旗面没有徽记**。只做红布 + 左下角补丁（对应正文「旗角上有一小块补丁，针脚很密」）+ 尺寸标注「长六尺 阔四尺」，不画任何徽记。这是审美和合规上的主动取舍；若评审要求更写实的旗面，需要先定清楚画什么。
3. **390px 不是严格 16:9**。严格 16:9 只有 219px 高，名册行 + 名字小字放不下，所以窄屏给了 `min-height: 236px`（≈1.55:1）。要严格 16:9 就去掉这条，代价是字更挤。
4. **光圈依赖 pointermove**。没有做自动扫光；触屏第一次落指才移动光圈（`pointerdown` 已即时对位，不等阻尼）。真机低端安卓的 `mask` 性能未实测——桌面 Chrome 三档视口 60fps、无 console error。若 Lead 发现掉帧，可以把 `.sig-spot__dark` 的 mask 换成两层 radial-gradient（`--lr / --lx / --ly` 已经留好）。
5. **FlagRaise 在 `document` 上挂了 keydown / pointerdown 监听**（判断输入模态，决定要不要画焦点环），卸载时移除。它不劫持方向键——只在旗面聚焦时处理 ↑↓/空格/Home。
6. **成功回调有延迟**：升旗 `onComplete` 在展开动画后 900ms（reduced-motion 60ms）触发；第一夜在点「把名字描下来」的瞬间触发。
7. **未接入、未重建**。`App.tsx` / `dist` 没动，4173 的试玩包看不到这两个组件；接入后需要 `npm run build` 重新出包（`tsc -b` 已单独跑过 `npx tsc -p tsconfig.app.json --noEmit`，无报错）。
8. **验证页依赖 Vite dev**。`tools/signature-harness.html` 里的 `.tsx` 由 Vite 编译，直接双击 HTML 打不开；本轮的 5173 dev server 是我起的后台进程，Lead 复跑测试前确认它还在（或自己 `npm run dev`）。
