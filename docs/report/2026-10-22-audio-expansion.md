# 2026-10-22 网页音效扩做与验收（audio expansion）

> 范围：`src/game/audio.ts`、`src/App.tsx`（仅音频接线）、`src/game/content/audioManifest.ts`（脚本生成）、
> `tools/audio/`、`docs/audio/`、`docs/report/`、`docs/deliverables/运行说明.md`。
> 未改剧情文本、Scene3D、动画组件、打包脚本、ZIP、`dist/`；未重启 4173。
> 全程在 dev 5199 上开发验证。

## 一、结论先说

| 项 | 结果 |
|---|---|
| 新增/接线的声音事件 | **0 个新素材**，把现有 28 条接到 **42 个事件**上（原来 App 里只有 4 处音频调用点：点载体 / 继续 / 环境声 / 结局 drone，9 条素材从未响过） |
| 死素材 | 从 **9 条**（pen / ink / match / footsteps / distant-thud / crowd-whisper / tape-hiss / flag-flap / radio-static）降到 **0** |
| 响度 | ambience 床从 -41.4…-52.5 统一到 **-37.0 dBFS RMS**（八条床原来差 11.1 dB，现在 0 dB）；结局 drone 从 -46.6…-49.6 提到 **-36 dBFS RMS** |
| 实测（浏览器 AnalyserNode 长时平均） | 床 **-38.4 dBFS**、drone **-36.5 dBFS**、峰值 -21.5 / -7.7 dBFS（不削顶） |
| 验收 | `node tools/test-audio.mjs http://127.0.0.1:5199/` → **44/44 通过**；`test-3d`（3D 回归）PASS；`test-degrade`（减少动效 / 390px）PASS |
| 默认静音 | 不变：未点「声音」前不创建 AudioContext，点「从头开始」也不会偷跑；刷新后仍静音 |
| 需要 Lead 做的 | **重新构建**（`npm run build`）并让 4173 加载新 dist；见 §七 |

## 二、审计（先听/先测，再改）

工具：`tools/audio/audit-delivered.mjs`（新）——ffmpeg 解码 28 条 ogg 到 48 kHz 交错 f32，
自写 radix-2 FFT 算频谱，量 RMS / 最响 100ms / 峰值 / 峰值因数 / 尾巴 / 频谱重心 / 循环接缝，
再按总线折算「实际听到的电平」。产出 `docs/audio/audit-loudness.json`。

口径注意：**必须按原声道数解码**。`ffmpeg -ac 1` 对双声道是直接求和，不相关的双声道会被量高
约 +3 dB（第一版审计就是这么把清单 -32 读成 -29.3 的），所以统计一律跨声道取均方，与 `post.py` 一致。

### 发现 1：九条素材从来没被调用过

原来 App 只用到 6 个 `click-*`、`page-turn`、`paper` 和四条床、六条 drone。
`pen`、`ink`、`match`、`footsteps`、`distant-thud`、`crowd-whisper`、`tape-hiss`、`flag-flap`、
`radio-static` 全部躺在 `public/audio/` 里没人播。

### 发现 2：环境床偏轻，而且八条之间差 11 dB

按原来 0.34 的 ambience 总线折算，实际到 destination 只有：

| 床 | 文件 RMS | 原链实际 | 目标 |
|---|---|---|---|
| rain-light | -32.4 | -42.6 | -37 |
| rain-heavy | -31.1 | -41.4 | -37 |
| snow-wind | -32.0 | -42.2 | -37 |
| river | -32.1 | -42.4 | -37 |
| crowd-whisper | -31.4 | -41.6 | -37 |
| room-tone | -35.2 | -45.5 | -37 |
| flag-flap | -31.1 | -41.4 | -37 |
| radio-static | -38.2 | -48.5 | -37 |
| tape-hiss | -42.2 | -52.5 | -37 |

整体轻 5—15 dB，且 room-tone 比 rain 轻 4 dB、tape-hiss 轻 11 dB —— 换场时音量会「掉一下」。

### 发现 3：结局 drone 几乎听不见

六条 drone 文件 RMS -34（message -37），原来总线 0.26，实际只有 **-46.6…-49.6 dBFS RMS**。
结局页只有 drone，等于整个结局几乎是静音。

### 发现 4：单次音偏干、峰值因数偏大

- 尾巴：`page-turn` / `click-flag` / `click-message` 最后 300ms 比最响 100ms 低 31—32 dB（很干）。
- 峰值因数：`ink` 32.7 dB、`match` 32.3 dB、`click-photo` 30.3 dB、`page-turn` 28.6 dB。
- 后果：`ink` / `click-photo` 被 `post.py` 的 -1 dBFS 限幅压到 -31 dBFS，比别的载体轻 6 dB。

### 发现 5：两条循环不能当床

- `flag-flap` 首尾 50ms 电平差 **-4.5 dB**（30s 循环，会听见泵动）。
- `drone-ending-message` 接缝步进在 98.9 分位（低频 drone 上不明显，但也不适合再拉响）。

### 发现 6：近重复

`click-letters` 与 `click-photo` 频段分布余弦 **0.9955**（都偏薄纸）。时长 0.9s vs 0.5s、
响度差 5 dB，实听可辨，保留。

## 三、扩做：事件映射

新增 `AUDIO_EVENT_MAP`（`src/game/audio.ts`，42 个事件）作为唯一真源；App 只调
`playEvent(event)` / `playTransition(variant)` / `playAccentForScene(id, text)`。全表见
[docs/audio/README.md](../audio/README.md#二事件映射audio_event_map)，这里只列**新补的类别**：

| 类别 | 新补事件 | 素材 | 设计意图 |
|---|---|---|---|
| 菜单 | `menu:enter`、`menu:click`、`ui:audio:on` | `paper` | 进入菜单有纸声；菜单床用 `room-tone` 当低音垫 |
| 悬停 | `ui:hover` | `ink` 前 120ms @0.09 | 240ms 限流、只在鼠标；连发 8 次只响 1 声 |
| 五天气换场 | `transition:ink/rain/snow/ash/smoke` | `distant-thud` + `paper` / `rain-light` / `snow-wind` / `radio-static` / `crowd-whisper` | 统一的「幕」低频 + 跟幕布 variant 对应的天气层 |
| 结局 | `ending:enter`、`ending:finale:start`、`ending:finale:end` | `paper`、`ink`、`distant-thud` + drone 包络 | 终极画面起势 2.8s 涨、收束 1.8s 落（复用现有 drone） |
| UI 联动 | `ui:3d:on/off`、`ui:source:open/close`、`ui:gallery/sources/people/later`、`ui:person:open`、`ui:later:open`、`ui:back` | `ink`/`paper`/`match`/`click-letters`/`page-turn` | 3D 开关、史料卡开合、图鉴/人物志/后来翻页都有回执 |
| 环境点缀 | `accent:crowd/thud/radio/flag/steps/pen/ink/match` | 8 条原本闲置的素材 | 关键词规则 + 确定性 1/3 + 20s 冷却 + 单槽 |

点缀的闸门：`ACCENT_RULES` 规则按「录音 → 旗 → 河 → 炮 → 脚步 → 灯 → 墨 → 笔」顺序命中，
再用 `hash(sceneId:event) % 3` 决定这一场响不响；同一时刻只允许一条（`accent:radio` 的两层
纹理共享同一次调用，可以叠，但不算两条床）。

三通道不变量保持不变：**同一时刻 ≤1 条 ambience 床 + ≤1 条 drone + ≤1 条点缀**；换场的天气层
另占一个单槽（新的一条进来先把上一条 250ms 收掉）。

## 四、混音与体验参数

```
master 0.900 (-0.9 dB) ── softClip(tanh, 拐点 -1 dBFS, 2x) ── destination
├─ sfxBus      0.600 (-4.4 dB) ── conv(0.5s 房间 IR, 湿声 0.14)
├─ ambienceBus 0.625 (-4.1 dB)
├─ droneBus    0.882 (-1.1 dB)
└─ accentBus   0.279 (-11.1 dB，比床低 7 dB)
```

- **逐条电平补偿**：清单里交付实测 `rms_dbfs` → `levelTrim()` 拉回组基准（bed -32 / drone -34），
  再由总线推到目标（bed -37 / drone -36）。八条床的落差因此从 11.1 dB 归零。
  补偿量：`room-tone +3.2`、`radio-static +6.2`、`tape-hiss +10.2`、`drone-ending-message +3.0`，其余 ≈0。
- **淡入淡出**：床 1.2s 进 / 0.9s 出；换场天气层 0.35—1.0s —— 都落在需求给的 700—1200ms 区间内；
  drone 1.6s（终极画面期间 3.0s）、点缀 1.2—2.2s 刻意更长：低频与纹理突然切断会「抽」，慢一点才自然。
- **不干的处理**：给 sfx 总线并联一条 0.5s 衰减噪声 IR 的卷积混响，湿声 0.14。
  只补空间，不做「混响感」；悬停 tick 0.09 的音量下湿声几乎为零。
- **限流**：同 id 70ms；事件 60ms（悬停 240ms、翻页 90ms、换场 400ms）。
- **软削波**：`WaveShaper` tanh，拐点 -1 dBFS，2x 过采样。正常电平碰不到，只防叠层削顶。
  最接近拐点的是 `drone-ending-names` 峰值 **-3.8 dBFS**。
- **默认静音 / 开关**：行为一字未改（未解锁不建 ctx、master 置 0、刷新保持），只是开声后
  多了一声很轻的 `paper` 让用户确认「真的有声音」。
- **单次音不抬**：`click-photo` / `ink` 峰值已贴 -1 dBFS，抬就削波，因此保留它们「更轻」的
  载体个性；`click-photo` 实测 -31.4 dBFS 瞬态，仍比 -37 的床高 5.6 dB，听得见。

## 五、新生成素材

**0 条。本轮没有开 GPU。**

- 28 条现有素材已覆盖全部所需事件（9 条闲置素材这次全部接上），不需要新素材。
- 本机已无当时那套生成环境：`C:\Program Files\python` 是 Python 3.8 + torch 2.4.1+**cpu**，
  缺 `stable_audio_tools` / `einops` / `soundfile`；`C:\Users\26298\Anaconda3` 是 Python 3.7 +
  numpy 1.15。重新装一套 CUDA torch 再下载 497M 权重不划算，也不该在试玩前动。
- GPU 状态：`nvidia-smi` 内存 **0 MiB**、利用率 0%，无 python 进程；唯一登记的 compute 进程是
  火绒 `HipsDaemon`（0 MiB 的系统守护，`audio_lib.py` 里本来就列为忽略项）。
- `tools/audio/QUEUE.md` 已追加「本轮 0 个 take」的记录。

## 六、验收

```
node tools/test-audio.mjs http://127.0.0.1:5199/     # 44/44 通过
node tools/test-3d.mjs  http://127.0.0.1:5199/ night1  # PASS（fps 98.3 / 16 calls / 3093 tris）
node tools/test-degrade.mjs http://127.0.0.1:5199/   # PASS（减少动效 + 390px）
node tools/audio/audit-delivered.mjs                 # 28 条全部量到，问题清单见 json
```

`test-audio.mjs` 里与「映射完整」直接相关的断言：

1. **每个映射事件都有非空音频 id**（42 个事件）；
2. 事件引用的 id 全部存在于清单（28 条）；
3. **28 条素材没有一条是死的**（都被事件 / 床 / drone 引用）；
4. 六条床补偿后都落在 -37±1、六条 drone 落在 -36±1；
5. 五种换场、九种载体、八种点缀、菜单/图鉴/人物志/后来/史料卡/3D 开关逐一触发并检查日志；
6. 悬停连发 8 次只响 1 声；任意采样点三通道都是单条合法 id；
7. 静音后 master = 0（drone 读到 -180 dBFS）；刷新后仍静音；无控制台错误。

## 七、给 Lead：需要重建发布

`public/audio/` 与 `dist/` **都没有新增文件**，但 `src/game/audio.ts`、`src/App.tsx`、
`src/game/content/audioManifest.ts` 变了，**4173 现在跑的是旧构建，听不到这套东西**。

```bash
cd "C:\Users\26298\OneDrive\Desktop\全栈开发\frontend\2026数字媒体"
npm run build          # 覆盖 dist/（我没有动过 dist/）
```

然后让 4173 加载新产物：

- `vite preview` 是从磁盘读 `dist/`，**重建后刷新页面即可**（必要时 Ctrl+Shift+R 去缓存）；
- 若你的 4173 进程带了缓存或需要重启，重启它 —— 我没有动 4173，也没有动 ZIP；
- 若要重新出 ZIP，按原打包脚本走一遍即可，`public/audio/` 未变，包体不会变大。

试玩路径：打开页面 → 点右下角「声音 关」→ 听到一声纸（确认解锁）→ 菜单有很轻的室内垫 →
「从头开始」有幕声 → 换场按天气有雨/雪/灰/烟层 → 点选项有对应载体的纸/布/铅笔声 →
结局先看终极画面（低频先到、drone 涨起来）→ 结局正文只有 drone。

## 八、变更文件

| 文件 | 改了什么 |
|---|---|
| `src/game/audio.ts` | 重写：事件表（42）、四总线、逐条电平补偿、换场天气层、点缀引擎、合成房间 IR、软削波、探针扩展（events/beds/drones/log/levels/manifest/mix） |
| `src/App.tsx` | **只动音频相关行**：import、开声回执、页面进入音、委托式 hover tick、换场幕声、载体/翻页事件、3D 开关、史料卡开合、人物志/后来卡片与返回、终极画面起势/收束、drone 淡入时长 |
| `src/game/content/audioManifest.ts` | 由脚本重生，新增 `rmsDbfs` / `peakDbfs` 两个字段 |
| `tools/audio/build-audio-manifest.mjs` | 把清单里的实测响度带进 TS |
| `tools/audio/audit-delivered.mjs` | 新增：交付素材审计（ffmpeg + FFT，零新依赖） |
| `tools/test-audio.mjs` | 重写：44 条断言，含「每个事件都有非空 id」「没有死素材」「实测电平」 |
| `docs/audio/README.md` | 新增：素材表、事件映射表、混音参数、验收与再生成 |
| `docs/audio/audit-loudness.json` | 新增：实测数据 |
| `docs/deliverables/运行说明.md` | 声音一节改写（事件、电平、Q&A） |
| `tools/audio/QUEUE.md` | 追加本轮记录（0 take） |

> 注意：同一工作区里还有其他 agent 的未提交改动（`src/main.tsx` 引入 `card-effects.css`、
> `src/game/components/CarryTray.tsx` / `FlagRaise.tsx` / `SpotlightFind.tsx` 等）。那些不是本次
> 音效改动的产物，我没有修改它们；`npx tsc -b` 与 `vite build`（临时目录 `.tmp-audio-build`，
> 已删）在整个工作区上都能过，`dist/` 没有被写过（时间戳仍是 10-21 23:06）。

## 九、风险与未做

- **没有主观听测**：本报告的电平/接缝结论来自测量与浏览器分析器，不是耳朵。混响湿声 0.14、
  悬停 0.09 这两个「手感」参数建议试玩时确认，一行可调（`audio.ts` 里 `reverbGain.gain.value`
  与 `AUDIO_EVENT_MAP['ui:hover']`）。
- **循环接缝**：`flag-flap` 只做点缀，`drone-ending-message` 仍在 98.9 分位，若要更稳需要
  双源交叠循环（改动较大，未做）。
- **片段级电平波动**：风雪/雨有阵，短窗测量会低 1—2 dB（实测床 -38.4 vs 目标 -37），
  属材料本身动态，不是链路问题。
- **没有新增素材**：若之后想加「幕」的专属 whoosh 或更短的 UI tick，需要先恢复 Python 3.12 +
  CUDA torch 环境，再按 README §六 的队列跑，注意单进程占卡。
