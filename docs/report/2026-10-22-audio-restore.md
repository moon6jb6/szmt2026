# 2026-10-22 音效扩展层恢复（audio restore）

> 事故：`src/game/audio.ts` 被外部进程回滚成旧版（8 个事件、三总线、无补偿/无混响/无换场/无点缀），
> 但设计文档存活。本报告记录**按文档重建扩展层**的过程、实现要点与验证结果。
>
> 范围：`src/game/audio.ts`（重建）、`tools/audio/verify-events.mjs`（新增，最小验证）、
> 本报告。**没有改** `src/App.tsx`、`src/styles.css`、其他组件、`dist/`、4173 —— App 接线由 Lead 负责，
> 清单见 §五。

## 一、结论先说

| 项 | 结果 |
|---|---|
| 事件表 | **42 个事件**全部重建，事件名与 `docs/audio/README.md` §二 逐字一致（脚本逐条比对，0 缺 0 多） |
| 素材覆盖 | 54 条 layer，引用 28 条素材中的 22 条；余下 6 条是结局 drone（`droneForEnding`）→ **28 条无死条** |
| 四总线 | master 0.900 / sfx 0.600 / ambience 0.625 / drone 0.882 / accent 0.279，`master → tanh 软削波 → destination` |
| 逐条补偿 | 15 条循环素材按 `audit-loudness.json` 的 `trims_db` 补齐（room-tone +3.2、radio-static +6.2、tape-hiss +10.2、drone-ending-message +3.0，其余 ≈0） |
| 混响 | sfx 并联 0.5s 衰减噪声 IR（`ConvolverNode`，程序化生成，湿声 0.14） |
| 验证 | `npx tsc -p tsconfig.app.json --noEmit` **0 错误**；`node tools/audio/verify-events.mjs` **32/32 通过**；旧脚本 `node tools/test-audio.mjs` **exit 0 / 无控制台错误** |
| 实测 | 连续床 -37.3…-35.4 dBFS、drone -37.3…-34.1 dBFS（AnalyzerNode 长时平均），静音后 master -120 dBFS |
| 需要 Lead 做的 | 只接线（§五 22 条调用点）；`audio.ts` 的所有旧导出都保留，App 不改也能编译/运行 |

## 二、回滚现场与重建依据

被回滚后的 `audio.ts` 只剩：8 个事件（6 个 `click-*` + `page-turn` + `paper`）、三条总线
（0.34 / 0.26 的体积参数）、70ms 单条限流、无补偿、无混响、无换场、无点缀。

重建依据**只取现存文档**，不靠记忆：

| 来源 | 取用内容 |
|---|---|
| `docs/audio/README.md` §二 | 42 事件映射表（事件名、素材、音量、延迟、截断） |
| `docs/audio/README.md` §三 | 四总线数值、逐条补偿、混音决定（淡入淡出/混响/限流/软削波） |
| `docs/audio/README.md` §二「环境床」 | `ambienceForScene` / `ambienceForScreen` 的九条判定 |
| `docs/audio/README.md` §二「环境点缀」 | 8 条关键词规则与命中顺序、三道闸门 |
| `docs/audio/audit-loudness.json` | `trims_db`（床 9 条 / drone 6 条），与 README 表一致 |
| `docs/audio/audio-manifest.json` | 28 条 id、时长、loop、group |
| `docs/report/2026-10-22-audio-expansion.md` | 设计意图、闸门顺序、验收口径 |

> 注意：当前 `src/game/content/audioManifest.ts` 是**旧版生成物**（没有 `rmsDbfs` / `peakDbfs` 字段），
> 所以补偿表直接内嵌在 `audio.ts`（`LEVEL_TRIM_DB`），并保留一条兜底：
> 若清单将来带上 `rmsDbfs`，`levelTrimDb()` 会按组基准（床 -32 / drone -34）反推。

## 三、实现要点

### 1. 事件表（42）

```
菜单/UI（16）  menu:enter menu:click ui:hover ui:click ui:back ui:3d:on ui:3d:off
              ui:source:open ui:source:close ui:gallery ui:sources ui:people ui:later
              ui:person:open ui:later:open ui:audio:on
正文/载体（10） page:advance carrier:roster/letters/flag/photo/testimony/message
              carrier:archive/relics/wordofmouth
换场（5）      transition:ink/rain/snow/ash/smoke
结局（3）      ending:enter ending:finale:start ending:finale:end
点缀（8）      accent:radio/flag/crowd/thud/steps/match/ink/pen
```

`AUDIO_EVENT_MAP: Record<AudioEvent, AudioLayer[]>` 是唯一真源；`AudioEvent` 联合类型让 TS 强制
42 个键齐全。layer 字段：`id / volume / channel? / delayMs? / maxMs? / durationMs? / fadeInMs? / fadeOutMs? / loop?`。

几处按 README 原文实现的细节：

- `ui:hover`：`ink` 前 120ms（`maxMs: 120`）@0.09，240ms 限流；
- `ui:source:close`：`ink` 截 320ms；
- `ui:3d:on`：`ink` 0.50 + `match` 0.16（`delayMs: 70`）；
- 合成结局：主载体 0.85 + 副载体 0.45—0.55（archive=roster+testimony、relics=letters+photo、
  wordofmouth=flag+message，按 `COMPOSITE_REQUIRES` 配）；
- 换场：`distant-thud`（墨合拢）+ 跟 `InkCurtain` variant 一一对应的天气层
  （rain-light 1.10 / 2.4s、snow-wind 1.15 / 2.6s、radio-static 1.20 / 2.2s、crowd-whisper 0.95 / 2.4s），
  天气层走 ambience 总线、0.35—1.0s 淡入 / 0.8—1.0s 淡出、2.2—2.6s 随幕退开；
  `transition:ink` 没有天气，用 `paper` 0.45（+90ms）当幕的替代；
- `ending:finale:start` 除了两层音，还会 `rampDrone(1.0, 2800)`；`ending:finale:end` 落回 0.82（1800ms）。

### 2. 四总线 + 软削波

```
master 0.900 ── WaveShaper(tanh, 拐点 -1 dBFS, oversample 2x) ── analyser ── destination
├─ sfxBus      0.600 ── dry ────────────────────────────────┬─ master
│                    └─ Convolver(0.5s IR) ─ wet 0.14 ──────┘
├─ ambienceBus 0.625 ── analyser ── master
├─ droneBus    0.882 ── analyser ── master
└─ accentBus   0.279 ── analyser ── master
```

软削波曲线：`|x| ≤ 0.891`（-1 dBFS）线性，以上 `knee + room·tanh((|x|-knee)/room)`，
0 dBFS 输入 → 约 -0.23 dBFS 输出。正常电平碰不到，只防叠层削顶。

### 3. 逐条响度补偿

`levelTrimDb(id)` 把交付实测 rms 拉回组基准，再交给总线（床 → -37、drone → -36 到达 destination）：

| 素材 | trim | 素材 | trim |
|---|---|---|---|
| rain-light | +0.4 | room-tone | **+3.2** |
| rain-heavy | -0.9 | flag-flap | -0.9 |
| snow-wind | 0 | radio-static | **+6.2** |
| river | +0.1 | tape-hiss | **+10.2** |
| crowd-whisper | -0.6 | drone-ending-message | **+3.0** |

其余 5 条 drone 为 0；单次音（`carrier` / `material`）**不套补偿**，只吃 -0.9 dB 母线
（它们的峰值已贴 -1 dBFS，硬拉会削波）。补偿只在 `ambience` / `drone` 分组上生效：
`layerGain(id, volume) = volume × 10^(trim/20)`。

### 4. sfx 并联混响

`buildRoomImpulse()` 用 xorshift32 白噪声 × `(1-t)^2.6` 生成 0.5s 立体声 IR，
`ConvolverNode.normalize = true`，湿声 0.14 走独立 `GainNode` 并在 master 前汇入。
**不加载任何额外文件**，两声道噪声种子不同（去相关）。

### 5. 淡入淡出与限流

| 项 | 值 |
|---|---|
| 床 | 1.2s 进 / 0.9s 出（`setAmbience`） |
| drone | 1.6s 进（终极画面 3.0s：`setDrone(id, { fadeInMs: 3000 })`）/ 1.2s 出 |
| 换场天气层 | 0.35—1.0s 进 / 0.8—1.0s 出，总长 2.2—2.6s |
| 点缀 | 1.2—2.2s 进，8—10s 长，1.2s 出 |
| 同 id | 70ms（`startOneShot`） |
| 事件 | 60ms；悬停 240ms、翻页 90ms、换场 400ms |
| 单槽 | 换场 / 点缀各一条；新的进来先把上一条 250ms 收掉 |

点缀闸门顺序（与报告一致）：关键词命中（录音→旗→河→炮→脚步→灯→墨→笔）→
`hash(sceneId:event) % 3 === 0`（FNV-1a，同场景结果固定）→ 20s 冷却（全局 + 同 id）→ 单槽空闲。

### 6. 保持不变的部分

- 默认静音（`localStorage` 不是 `'0'` 就是静音）；未点「声音」不创建 `AudioContext`；
- 首次用户手势才 `unlockAudio()`；`visibilitychange` 隐藏 `suspend`、回来 `resume`；
- 静音 = `master.gain → 0`，循环节点保留（取消静音接回原位）；
- 加载/解码失败静默降级；`window.__audio` 探针只在 `import.meta.env.DEV` 挂载；
- 旧导出全部保留：`unlockAudio / isAudioUnlocked / isMuted / setMuted / playSfx / setAmbience /
  setDrone / stopAudio / clickSoundFor / droneForEnding / ambienceForScene / ambienceForScreen`。

### 7. 新增导出

| 导出 | 用途 |
|---|---|
| `playEvent(event)` | 播 42 事件之一（返回是否发声；限流/静音/未知事件 → false） |
| `playTransition(variant)` | `'ink'｜'rain'｜'snow'｜'ash'｜'smoke'`，400ms 限流 + 天气单槽 |
| `carrierEvent(kind)` | 记忆载体 / 合成结局 → `carrier:*` 事件名 |
| `playAccentForScene(sceneId, text)` | 关键词 + 三道闸门；返回命中的 `accent:*` 或 `null` |
| `accentForScene(text)` / `accentGate(sceneId, event)` | 纯规则 / 纯确定性闸门（便于测试与调试） |
| `uiEventForScreen(screen)` | 页面 → `menu:enter` / `ui:gallery` / `ui:sources` / `ui:people` / `ui:later` |
| `setDrone(id, { fadeInMs })` | 结局 drone，淡入可调（终极画面 3000） |
| `rampDrone(factor, ms)` | drone 包络倍数（起势 1.0 / 收束 0.82） |
| `levelTrim(id)` / `levelTrimDb(id)` | 补偿查询（线性 / dB） |
| `AUDIO_EVENT_MAP` / `AUDIO_EVENT_NAMES` / `AUDIO_ACCENT_RULES` / `MIX` / `TRANSITION_VARIANTS` / `DRONE_FINALE_FADE_IN_MS` | 数据与常量 |

## 四、验证

### 1. 类型

```
npx tsc -p tsconfig.app.json --noEmit      → 0 错误
```

（`App.tsx` 目前用的仍是旧导出；旧导出一个没少，所以不需要为 App 补任何东西。）

### 2. 事件表/参数验证脚本（新增）

原 `tools/test-audio.mjs` 确实被回滚成旧版（只验「默认静音 / ctx / 床 / drone」6 项，
不含 42 事件断言），因此按 README 补了 `tools/audio/verify-events.mjs`：

```
node tools/audio/verify-events.mjs --static                  # 19/19
node tools/audio/verify-events.mjs http://127.0.0.1:5199/    # 32/32
```

静态 19 条（读源码 + 清单）：42 成员联合类型、事件名与 README 逐字一致、map 覆盖 42、
每事件非空 layer（54 层）、引用 id 全在 28 条清单、28 条无死条、四总线数值、tanh 2x、
0.5s IR / 湿声 0.14、淡入淡出常数、五条限流常数、四条关键补偿、补偿表 15 条、
五种换场（总线/时长/淡入区间）、八种点缀（顺序 + 关键词）、三道闸门、新导出齐全、
旧导出齐全、默认静音/手势/隐藏 suspend/DEV 探针。

浏览器 13 条（用 `window.__audio` 探针，验证**编译后的**代码）：

```
PASS  探针在（dev only）
PASS  AUDIO_EVENT_MAP = 42 事件、每事件非空、id 全在清单 — 54 层 / 28 条素材
PASS  28 条素材无死条 — 事件表 22 + 床选择器 6 + drone 6
PASS  混音 / 补偿 / 混响参数 — master 0.9 / wet 0.14 / IR 0.5s / tanh 2x
PASS  默认静音，点「声音」后解锁 running
PASS  悬停限流 8 → 1
PASS  transition:rain 起声 — 单槽占用 + rain-light 已解码 + ambience 总线 -31.9 dBFS
PASS  点缀 30 个场景只响 1 次（accent:crowd）+ 9 条关键词映射正确
PASS  carrier:roster/archive + page:advance + ending:finale:start（drone 1.0 倍）
PASS  15 条循环素材的节点增益 = 逐条补偿（9 床 + 6 drone 全部匹配，含 tape-hiss +10.2）
PASS  连续床 / drone 实测电平 — 床 -37.3…-35.4、drone -37.3…-34.1 dBFS
PASS  静音后 master -120 dBFS，刷新仍静音
PASS  无控制台错误
```

> 为什么「节点增益」和「实测电平」两条都要：`tape-hiss` / `flag-flap` 是稀疏纹理，
> 几十毫秒的分析窗会读低 5—12 dB（README §五 也记了 `flag-flap` 的接缝问题），
> 所以补偿的**精确性**由「设定到 GainNode 的目标增益」断言保证，**响度**由「连续床/drone 的长时平均」保证。

### 3. 旧验收脚本

```
node tools/test-audio.mjs http://127.0.0.1:5199/    → exit 0，errors: none
```

- 默认静音 / 点「声音」→ `running` / 场景有 ambience / 刷新仍静音：全过；
- 唯一 `WARN: no ending drone detected` 是该脚本**自身过期**：它注入 `sceneId: 'epilogue'` 的旧存档
  再点「继续上次」，现在的剧情树里这个存档落不到结局页，因此它没真正走到 `screen === 'ending'`。
  这条链路改由 `verify-events.mjs` 直接验（`setDrone` 六条 + `ending:finale:start` 起势）。

### 4. 复现

```bash
cd "C:\Users\26298\OneDrive\Desktop\全栈开发\frontend\2026数字媒体"
npx tsc -p tsconfig.app.json --noEmit
node tools/audio/verify-events.mjs --static
npm run dev -- --host 127.0.0.1 --port 5199 --strictPort     # 5199 已在跑时直接复用
node tools/audio/verify-events.mjs http://127.0.0.1:5199/
node tools/test-audio.mjs http://127.0.0.1:5199/
```

> 本轮 5199 **已被占用**（另一个 dev server 正在服务同一个工程，`--strictPort` 拒绝重复启动），
> 直接复用它验证，没有另起第二个 server、没有动 4173/`dist/`。
> 验证期间工作区里其他 agent 在改 `App.tsx` 等文件，HMR 会整页刷新，脚本已加 `ensureAudio()` +
> 一次重试，不影响结论。

## 五、给 Lead：App 里要接哪些调用（逐条）

> `audio.ts` 已经就绪，App 现在**不接也能跑**（旧导出兜底），但下面 22 处接上才有完整听感。
> 位置按当前 `src/App.tsx` 的结构给（行号仅供定位，以实际文件为准）。

**A. import（第 26—33 行的 audio 具名导入里补）**

```ts
import {
  ambienceForScene, ambienceForScreen, carrierEvent, droneForEnding,
  isAudioUnlocked, isMuted, playAccentForScene, playEvent, playSfx, playTransition,
  setAmbience, setDrone, setMuted, unlockAudio,
} from './game/audio'
```

| # | 事件 | 建议位置 | 说明 |
|---|---|---|---|
| 1 | `menu:enter` | 回到菜单的地方（`setScreen('menu')`，含从结局/图鉴返回） | 纸 0.5；首次进入菜单也算 |
| 2 | `menu:click` | `startNew` / `resume` 开头（第 335、347 行附近） | 「从头开始」「继续上次」 |
| 3 | `ui:audio:on` | `toggleAudio` 开声成功处（第 214—218 行，`void unlockAudio()` 之后） | 一声纸确认「真的有声音」 |
| 4 | `ui:hover` | 在 `.app-shell` 上做**委托式** `mouseover`/`pointerover`（冒泡），命中 `button, .choice, .chip` 再发；先判 `event.pointerType !== 'touch'` | 240ms 限流已内置，触屏不响 |
| 5 | `ui:click` | 「安静」类点击的兜底（没有专门音效的按钮） | |
| 6 | `ui:back` | 「返回人物志」「返回『后来』」（第 1156 行等返回按钮） | 翻页 0.4 |
| 7 | `ui:3d:on` / `ui:3d:off` | `view3d-toggle` 的 onClick（第 587—589 行），按 `current === sceneId ? off : on` | 3D 开：墨 + 火柴（+70ms） |
| 8 | `ui:source:open` | 史料卡 chip 的 onClick（第 551 行 `renderChips`） | |
| 9 | `ui:source:close` | 关卡片按钮（第 508 行）与 Esc（第 340 行） | 墨截 320ms |
| 10 | `ui:gallery` / `ui:sources` / `ui:people` / `ui:later` | 进入对应页面的入口按钮 | 也可统一用 `uiEventForScreen(screen)` 在页切 effect 里发 |
| 11 | `ui:person:open` / `ui:later:open` | 打开一篇人物志 / 一篇「后来」的 onClick | 薄信纸 0.4 |
| 12 | `page:advance` | `onAdvance`（第 377 行） | 替换现在的 `playSfx('page-turn')`，音量 0.75 |
| 13 | `carrier:roster … message` / `carrier:archive/relics/wordofmouth` | `onChoose`（第 366—369 行）：`playEvent(carrierEvent(burstKind))` | 合成结局两层叠响；`carrierEvent` 已按 `COMPOSITE_REQUIRES` 配好 |
| 14 | `transition:ink/rain/snow/ash/smoke` | `runCurtain(swap, opts)` 开头（第 300—306 行）：`if (audioOn) playTransition(weatherVariant())`；`weatherVariant()` 在第 1163 行 | 跟着幕布起落，别在 swap 之后发 |
| 15 | `ending:enter` | `advanceScene` 里置 `setScreen('ending')` 之后（第 437 行附近） | |
| 16 | `ending:finale:start` | `beginFinale()`（第 294—297 行）或 `EndingFinale` 挂载处（第 1202—1204 行） | 自带 `rampDrone(1.0, 2800)` |
| 17 | `ending:finale:end` | `<EndingFinale onDone={() => { setFinaleDone(true); playEvent('ending:finale:end') }} />` | 自带 `rampDrone(0.82, 1800)` |
| 18 | drone 淡入时长 | 结局页 effect 里（第 370—371 行）：`setDrone(droneForEnding(state.ending), { fadeInMs: finaleDone ? 1600 : 3000 })` | 终极画面在播时 3.0s |
| 19 | `playAccentForScene(sceneId, text)` | 场景切换 effect（第 320—333 行的 ambience effect，或单独一个 effect）：`if (audioOn) playAccentForScene(scene.id, [scene.title, scene.chapter, scene.location, ...scene.paragraphs, ...(scene.choices ?? []).map(c => c.label)].join(''))` | 三道闸门都在 audio.ts 内，App 不用判 |
| 20 | `setMuted` | 已接（`toggleAudio` 第 216 行） | 不用改 |
| 21 | `setAmbience(ambienceForScene(...))` / `setAmbience(ambienceForScreen(...))` | 已接（第 366—373 行） | 行为有变：菜单/图鉴/关于/史料库现在都返回 `room-tone`（README §二「菜单的低音垫」），结局页返回 `null` |
| 22 | hover 的触屏豁免 | 见 #4 | 触屏完全不触发 |

接线时的两个坑：

1. **别在 `runCurtain` 之后发换场音**——那时幕已经盖上了，声音会晚半拍；
2. **`ending:finale:start` / `end` 已经内含 drone 包络**，App 不要再额外调 `rampDrone`，否则会叠两次。

## 六、未做 / 风险

- **没有主观听测**：电平与增益是测量值，湿声 0.14、悬停 0.09 这两个手感参数建议试玩确认
  （一行可调：`REVERB_WET`、`AUDIO_EVENT_MAP['ui:hover']`）。
- **App 未接线**：上面 22 处没动，所以现在试玩只能听到旧的 4 个调用点 + 菜单垫 + 换场（接线后才有）。
- **`audioManifest.ts` 没有重生成**：它仍是旧生成物（无 `rmsDbfs`/`peakDbfs`），补偿表因此内嵌在
  `audio.ts` 并用兜底逻辑兼容将来重生成；若要恢复「清单带实测响度」的链路，
  需给 `tools/audio/build-audio-manifest.mjs` 加两个字段后重跑（本次未改生成脚本，避免与 Lead 的构建冲突）。
- **`tools/test-audio.mjs` 仍是旧版**：本次没有改它（避免覆盖别人的脚本），42 事件断言在新脚本里；
  等 Lead 收口时可以把它合并或替换。
- **5199 上跑的验证**：另一个 dev server 持续服务同一工程，验证期间有 HMR 整页刷新，脚本已加重试；
  若 CI 化跑，建议给 5199 独占端口。

## 七、变更文件

| 文件 | 改了什么 |
|---|---|
| `src/game/audio.ts` | **重建扩展层**：42 事件表、四总线 + tanh 软削波、逐条补偿、程序化 0.5s IR 混响、换场天气层、点缀引擎、床/drone/单次音播放原语、限流与单槽、探针扩展（events/map/gains/trims/mix/levels/slots/log）；旧导出全保留 |
| `tools/audio/verify-events.mjs` | 新增：32 条断言（静态 19 + 浏览器 13） |
| `docs/report/2026-10-22-audio-restore.md` | 本报告 |

未改：`src/App.tsx`、`src/styles.css`、`src/game/components/*`、`src/game/content/*`、`dist/`、4173。
