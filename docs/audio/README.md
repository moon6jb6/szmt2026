# 声音：素材、事件映射与混音

《把名字留下来》的全部声音都是**本地生成**的：Stable Audio Open Small（497.2M，权重在
`D:\AI大模型\audio\stable-audio-open-small`）出 44.1 kHz 素材，EQ / 响度 / 循环接缝 /
48 kHz 重采样全部由 `tools/audio/post.py` 里的经典 DSP 完成，没有第二个模型、没有版权音乐、
没有人声配音。共 **28 条 · 4.88 MB**，清单见 [audio-manifest.json](audio-manifest.json)。

前端系统在 `src/game/audio.ts`：Web Audio 单例、**默认静音**、右下角开关、首次手势解锁、
单条循环床 + 单条 drone、隐藏 suspend、点击限流、加载失败静默降级。

> 本文覆盖三件事：**哪一声在什么时候响**（事件映射）、**每一层多响**（电平/混音）、
> **怎么复现和再生成**（命令与 GPU 纪律）。

---

## 一、28 条素材

| 组 | id | 时长 | 用途 |
|---|---|---|---|
| 载体 | `click-roster` | 1.1s | 名册：厚册页翻开合上，闷、沉 |
| 载体 | `click-letters` | 0.9s | 家书：薄信纸，干、脆、轻 |
| 载体 | `click-flag` | 1.0s | 旗：棉布拍一下 + 麻绳磨竹竿 |
| 载体 | `click-photo` | 0.5s | 照片：硬相纸边缘咔一声 |
| 载体 | `click-testimony` | 0.85s | 口述：铅笔划两道，沙、涩 |
| 载体 | `click-message` | 0.8s | 口信：小纸条抽出展开 |
| 材料 | `page-turn` | 1.2s | 册页一页翻过、纸滑、落定 |
| 材料 | `paper` | 1.0s | 单张薄纸拿起抖一下 |
| 材料 | `pen` | 1.1s | 钢笔尖在纸上写短句 |
| 材料 | `ink` | 0.7s | 笔尖蘸墨一下，湿、短 |
| 材料 | `match` | 1.6s | 火柴划着、火起 |
| 材料 | `footsteps` | 3.2s | 水泥地上三步，慢、闷 |
| 材料 | `distant-thud` | 2.0s | 墙外的一记闷响，不写战斗细节 |
| 环境床 | `rain-light` | 21.1s | 细雨：水泥与窗玻璃 |
| 环境床 | `rain-heavy` | 20.3s | 密雨：砸在院子和铁皮上 |
| 环境床 | `snow-wind` | 30.0s | 雪风：细风带雪，不嚎 |
| 环境床 | `river` | 20.4s | 苏州河：夜里的水贴着石阶 |
| 环境床 | `crowd-whisper` | 21.0s | 隔河的一团人声，听不清字 |
| 环境床 | `room-tone` | 21.4s | 空仓库的夜，室内底噪 |
| 环境床 | `tape-hiss` | 20.1s | 录音带 A-017 的底（点缀层） |
| 环境床 | `flag-flap` | 29.9s | 楼顶的风把旗一遍遍掀开（点缀层） |
| 环境床 | `radio-static` | 20.3s | 短波杂音，间歇（点缀层） |
| 结局 drone | `drone-ending-names` | 20.3s | 一九四七年的厢房：炭盆、砚、毛边纸 |
| 结局 drone | `drone-ending-letters` | 29.5s | 煤油灯、纸、糨子 |
| 结局 drone | `drone-ending-flag` | 20.2s | 旗没了，尺寸还在：风、绳、空 |
| 结局 drone | `drone-ending-photo` | 21.4s | 十一个人，认出九个：静、玻璃、纸 |
| 结局 drone | `drone-ending-testimony` | 20.4s | 录音带 A-017 的转动与底噪 |
| 结局 drone | `drone-ending-message` | 30.0s | 一句话传了四代：门开着，气在动 |

---

## 二、事件映射（`AUDIO_EVENT_MAP`）

`src/game/audio.ts` 里的 `AUDIO_EVENT_MAP` 是**唯一真源**：42 个事件、每个事件至少一条
非空素材 id；反向也保证 28 条素材没有一条是死的。App 里只调 `playEvent(event)`。

### 菜单 / UI

| 事件 | 触发点 | 素材 · 音量 |
|---|---|---|
| `menu:enter` | 进入菜单（含从结局/图鉴回菜单） | `paper` 0.50 |
| `menu:click` | 「从头开始」「继续上次」 | `paper` 0.65 |
| `ui:hover` | 鼠标掠过按钮（**240ms 限流**，只取 `ink` 前 120ms） | `ink` 0.09 |
| `ui:click` | 「安静」类点击的兜底 | `paper` 0.55 |
| `ui:back` | 返回人物志 / 返回「后来」 | `page-turn` 0.40 |
| `ui:3d:on` | 切到 3D 视角 | `ink` 0.50 + `match` 0.16（+70ms） |
| `ui:3d:off` | 回到 2.5D | `paper` 0.50 |
| `ui:source:open` | 点开史料卡 | `click-letters` 0.55 |
| `ui:source:close` | 关史料卡（含 Esc） | `ink` 0.40（截 320ms） |
| `ui:gallery` / `ui:sources` / `ui:people` / `ui:later` | 进入对应页面 | `page-turn` 0.40—0.45 |
| `ui:person:open` / `ui:later:open` | 打开一篇人物志 / 后来 | `click-letters` 0.40 |
| `ui:audio:on` | 点「声音 开」并解锁成功 | `paper` 0.50 |

### 正文与换场

| 事件 | 触发点 | 素材 · 音量 |
|---|---|---|
| `page:advance` | 「继续」/ Enter / 空格 | `page-turn` 0.75 |
| `carrier:roster` … `carrier:message` | 点六个记忆载体 | 对应 `click-*` 1.0 |
| `carrier:archive` / `relics` / `wordofmouth` | 合成结局的载体 | 两层（主载体 0.85 + 副载体 0.45—0.55） |
| `transition:ink` | 换场·墨（无天气） | `distant-thud` 0.50 + `paper` 0.45（+90ms） |
| `transition:rain` | 换场·雨 | `distant-thud` 0.42 + `rain-light` 2.4s @1.10 |
| `transition:snow` | 换场·雪 | `distant-thud` 0.40 + `snow-wind` 2.6s @1.15 |
| `transition:ash` | 换场·灰 | `distant-thud` 0.50 + `radio-static` 2.2s @1.20 |
| `transition:smoke` | 换场·烟 | `distant-thud` 0.45 + `crowd-whisper` 2.4s @0.95 |

换场的「幕」是一个统一体：低频的 `distant-thud` 是墨合拢，天气层跟 `InkCurtain` 的
`variant` 一一对应，走 ambience 总线、0.35—1.0s 淡入 / 0.8—1.0s 淡出，跟着幕布一起起落。
天气层在幕布期间是 **1.1—1.2 倍床电平**（幕布遮住整屏，这里要能听见「这一场是雨/雪/灰/烟」），
2.2—2.6s 内随幕退开。墨/雨/雪/灰/烟五种都在；「灰」用短波嘶声、「烟」用隔河人声，都是现成素材。

### 结局

| 事件 | 触发点 | 素材 · 音量 |
|---|---|---|
| `ending:enter` | 进入结局页 | `paper` 0.45 + `ink` 0.25 |
| `ending:finale:start` | 终极画面开始（含「重看结局画面」） | `distant-thud` 0.32 + `paper` 0.40；**drone 2.8s 涨到 1.0 倍** |
| `ending:finale:end` | 终极画面收束 | `paper` 0.30；**drone 1.8s 落到 0.82 倍** |
| （drone） | 结局页 | `droneForEnding()` 六条之一，淡入 1.6s（终极画面在播时 3.0s） |

起势/收束复用现有 drone 的增益包络（`rampDrone`），没有新建素材。倍数会乘上该 drone 自己的
电平补偿（例如 `drone-ending-message` 补偿 +3 dB），所以六条结局的起势幅度一致。

### 环境点缀（只在特定的夜出现）

| 事件 | 素材 | 关键词（先命中先用） | 形态 |
|---|---|---|---|
| `accent:radio` | `radio-static` 0.90 + `tape-hiss` 0.55 | 录音 / 口述 / 磁带 / 收音 / 短波 / 广播 / A-017 | 9s，1.4—2.2s 淡入 |
| `accent:flag` | `flag-flap` 1.00 | 升旗 / 旗 / 楼顶 / 屋顶 | 8s，1.2s 淡入 |
| `accent:crowd` | `crowd-whisper` 1.00 | 河 / 桥 / 渡 / 苏州 / 对岸 / 租界 | 10s，1.8s 淡入 |
| `accent:thud` | `distant-thud` 0.45 | 炮 / 枪 / 轰 / 震 / 闷响 / 墙外 / 爆炸 / 射击 | 单次 |
| `accent:steps` | `footsteps` 0.50 | 走廊 / 楼梯 / 巡 / 脚步 / 走过 / 岗哨 | 单次 |
| `accent:match` | `match` 0.40 | 煤油灯 / 火柴 / 点灯 / 灯芯 / 火光 / 烧 | 单次 |
| `accent:ink` | `ink` 0.35 | 蘸墨 / 研墨 / 砚 / 墨 | 截 500ms |
| `accent:pen` | `pen` 0.40 | 写名字 / 记名字 / 记下名字 / 抄名 / 登记 / 造册 / 录名 / 名单 | 单次 |

规则命中后还有三道闸门：**确定性 1/3**（`hash(sceneId:event) % 3 === 0`，同一场景结果固定）+
**20s 冷却** + **单槽**（同一时刻只有一条点缀）。所以不会场场都响，也不会叠成两层。

### 环境床（`ambienceForScene` / `ambienceForScreen`）

| 条件 | 床 |
|---|---|
| 章节/地点含 河 / 桥 / 苏州 / 渡（且不是雪天） | `river` |
| 雨，且地点含 四行 / 仓库 / 夜 / 巷 | `rain-heavy` |
| 雨，其他 | `rain-light` |
| 雪 | `snow-wind` |
| 烟，且地点含 街 / 租界 / 对岸 / 人群 | `crowd-whisper` |
| 其他场景 | `room-tone` |
| 菜单 / 图鉴 / 关于 / 史料库 / 人物志 / 后来 | `room-tone`（菜单的「低音垫」） |
| 结局页 | `null`（只留 drone） |

`tape-hiss` / `radio-static` / `flag-flap` **不当床**：前两条是点缀纹理，`flag-flap` 的循环接缝
有 4.5 dB 电平跳变（见 §五），当床会听见泵动，只按 8s 一段带淡入淡出地播。

---

## 三、电平与混音

### 目标（到 destination 的 RMS，dBFS）

| 通道 | 目标 | 实测（浏览器 AnalyserNode 长时平均） |
|---|---|---|
| ambience 床 | **-37.0** | -38.4 … -37.0（风雪/雨有阵，短窗会偏低） |
| drone | **-36.0** | -36.5 … -36.6 |
| accent 点缀 | -44.0（比床低 7 dB） | — |
| 单次音（载体/翻页） | 瞬态 -25 … -31（只比床高 6—12 dB） | 见 `audit-loudness.json` |

### 总线

```
master 0.900 (-0.9 dB) ── softClip ── destination
├─ sfxBus      0.600 (-4.4 dB) ── conv(reverb wet 0.14)
├─ ambienceBus 0.625 (-4.1 dB) ── analyser
├─ droneBus    0.882 (-1.1 dB) ── analyser
└─ accentBus   0.279 (-11.1 dB)
```

### 逐条电平补偿

清单里每条素材都带交付实测 `rms_dbfs`（`post.py` 口径：跨声道均方）。前端在
`levelTrim()` 里把它拉回组基准，再交给总线：

- ambience 基准 **-32 dBFS**：`rain-light +0.4 / rain-heavy -0.9 / snow-wind 0 / river +0.1 /
  crowd-whisper -0.6 / room-tone +3.2 / flag-flap -0.9 / radio-static +6.2 / tape-hiss +10.2`（dB）
- drone 基准 **-34 dBFS**：`drone-ending-message +3.0`，其余 0
- 单次音不动增益（只补 -0.9 dB 的母线）；它们的峰值已经贴着 -1 dBFS，硬拉会削波

这一步把八条床原来 **11.1 dB 的落差**压到 **0 dB**：以前 tape-hiss 比 rain 轻 10 dB，
现在两者在总线上同响度，靠音色而不是靠电平区分。

### 其它混音决定

| 项 | 值 | 为什么 |
|---|---|---|
| 淡入淡出 | 床 1.2s 进 / 0.9s 出；换场天气层 0.35—1.0s；drone 1.6s（终极画面 3.0s）；点缀 1.2—2.2s | 床与换场层在需求区间 700—1200ms 内；drone/点缀刻意更长，低频与纹理突然切断会「抽」 |
| 房间尾巴 | 0.5s 衰减噪声 IR，湿声 **0.14**（只挂在 sfx 总线） | 审计发现 `page-turn` / `click-flag` / `click-message` 尾巴 -31…-32 dB（太干），补一点空间但不加混响感 |
| 悬停 tick | `ink` 前 120ms @0.09，240ms 限流，只在鼠标 | 有回执但不吵；触屏完全不触发 |
| 连点限流 | 同 id 70ms；事件 60ms（悬停 240ms、翻页 90ms、换场 400ms） | 防连点叠成一团 |
| 软削波 | `tanh` 拐点 -1 dBFS，`oversample 2x` | 只当保险：正常电平碰不到，叠层时不至于数字削顶 |
| 静音开关 | master 直接置 0（循环节点保留） | 默认静音策略不变；取消静音立刻接上原来的位置 |

`tape-hiss` 的峰值只有 -6.7 dBFS，**只在 accent 总线上用**（-12 dB 链路），
所以表里它 +10.2 dB 的补偿不会顶到削波。

---

## 四、怎么验

```bash
# 1) 素材审计：解码 28 条 ogg，量 RMS/瞬态/峰值因数/尾巴/频谱重心/循环接缝
#    产出 docs/audio/audit-loudness.json
node tools/audio/audit-delivered.mjs

# 2) 清单 → TypeScript（改了 audio-manifest.json 才需要跑）
node tools/audio/build-audio-manifest.mjs

# 3) 端到端验收（必须跑在 dev 上：探针 window.__audio 只在 DEV 挂）
npm run dev -- --port 5199
node tools/test-audio.mjs http://127.0.0.1:5199/
```

`test-audio.mjs` 的 44 条断言里，与「映射完整」直接相关的有：

- 每个映射事件都有非空音频 id（42 个事件）
- 事件引用的 id 全部存在于清单（28 条）
- 28 条素材没有一条是死的（都被事件 / 床 / drone 引用）
- 点缀关键词映射正确（旗 / 炮 / 录音 / 河 / 脚步 / 笔 / 无命中）
- 六条床补偿后都落在 -37±1 dBFS、六条 drone 落在 -36±1 dBFS
- 实测：床 -38.4 dBFS、drone -36.6 dBFS、峰值不削顶
- 五种换场、九种载体、八种点缀、菜单/图鉴/人物志/后来/史料卡/3D 开关都有声
- 床与 drone 都真的解码进了 `buffered`（读 `window.__audio.buffered`）
- 悬停连发 8 次只响 1 声；静音后 master = 0；刷新后仍静音

---

## 五、已知保留问题（都是刻意的取舍）

| 现象 | 数据 | 处理 |
|---|---|---|
| `click-photo` / `ink` 偏轻 | 峰值 -0.8 / -1.2 dBFS，峰值因数 30 / 33 dB，`post.py` 的 -1 dBFS 限幅把它们压到 -31 / -31 dBFS | **不提升**：再拉就削波。照片本来就是最轻的载体 |
| `flag-flap` 接缝泵动 | 首尾 50ms 电平差 -4.5 dB | 不当床，只做 8s 点缀（淡入淡出盖住接缝） |
| `drone-ending-message` 接缝靠边 | 步进在 98.9 分位、电平差 2.8 dB | 在 -36 dBFS 的低频 drone 上接近底噪边缘；**未做主观听测**，若试玩觉得有「咔」就改成双源交叠循环 |
| 没有音乐 / 没有人声 | 28 条全是环境与动作 | 明确取舍：这是阅读器，不是配乐作品 |
| `click-letters` 与 `click-photo` 频谱相近 | 余弦 0.9955 | 时长（0.9s vs 0.5s）与响度差把两者分开了，实听可辨 |

---

## 六、复现 / 再生成

### 现状

28 条已全部交付，**本轮音效扩做没有新生成任何素材**（0 个 take，GPU 未启动）：
现有素材已覆盖全部事件，且本机已找不到当时那套 Python 3.12 + CUDA torch +
`stable_audio_tools` 环境（`C:\Program Files\python` 是 torch 2.4.1+**cpu**，
Anaconda 是 3.7 + numpy 1.15，都没有 `stable_audio_tools`）。

### 需要新素材时

GPU 纪律（硬性）：**全局同一时刻只允许一个 python 进程占卡**。

```bash
# 0) 确认卡是空的（0 MiB、没有别人的 compute 进程；火绒 HipsDaemon 是 0 MiB 的系统守护，忽略）
nvidia-smi --query-gpu=memory.used --format=csv
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv

# 1) 环境（当时用的版本，Python 3.12）
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install stable-audio-tools einops numpy scipy

# 2) 把新条目加进 tools/audio/jobs.py（id / group / loop / gen_seconds / seed / prompt / use）
#    8 步、pingpong、cfg 1.0；循环素材要两条不同 seed 的 take（脚本自动 +7919）

# 3) 生成（单进程；会自动写 tools/audio/QUEUE.md）
python tools/audio/generate.py --only ui-tick,curtain-ink

# 4) 后处理：EQ / 响度 / 循环接缝 / 48 kHz / OGG，并重写 docs/audio/audio-manifest.json
python tools/audio/post.py

# 5) 清单进前端 + 审计 + 验收
node tools/audio/build-audio-manifest.mjs
node tools/audio/audit-delivered.mjs
node tools/test-audio.mjs http://127.0.0.1:5199/
```

新增素材后要做的三件事：把 id 加进 `AUDIO_EVENT_MAP` 的某个事件（否则
`test-audio.mjs` 的「没有死素材」断言会红）、在本文的表里补一行、
在 `tools/audio/QUEUE.md` 记下显存峰值与耗时。

### 素材规格（与现有 28 条一致）

| 项 | 值 |
|---|---|
| 采样率 / 格式 | 48 kHz · OGG Vorbis（单次音 q6、循环 q5） |
| 声道 | 单次音强制 mono（手机喇叭上不抵消）；循环保留 stereo，声道相关性 < 0.15 时折叠 |
| 循环长度 | 20—30s，循环点用 1.2s 等功率 wrap 交叉淡化 |
| 单次音响度 | 最响 100ms RMS -20/-21 dBFS，峰值 ≤ -1 dBFS |
| 循环响度 | 全文件 RMS -32（床）/ -34（drone）/ -42（tape-hiss 这类纹理） |
| 峰值 | ≤ -1 dBFS |
| 提示词 | 英文、≤64 token、结尾固定 `no music, no voices` |
| 许可 | Stability AI Community License（非商业 / 年收入 <$1M 可用） |

---

## 七、文件

```
docs/audio/
├─ README.md                  # 本文
├─ audio-manifest.json        # 28 条素材 + prompt/seed/响度/接缝（post.py 生成）
└─ audit-loudness.json        # 交付实测 + 混音折算（audit-delivered.mjs 生成）
src/game/
├─ audio.ts                   # 事件表 / 总线 / 混音 / 探针
└─ content/audioManifest.ts   # 清单的类型化副本（build-audio-manifest.mjs 生成）
tools/audio/
├─ generate.py · post.py · jobs.py · audio_lib.py   # 生成与后处理
├─ audit-delivered.mjs        # 素材审计（ffmpeg 解码 + 自写 FFT）
├─ build-audio-manifest.mjs   # JSON → TS
└─ QUEUE.md                   # GPU 队列记录
tools/test-audio.mjs          # 端到端验收（Playwright + window.__audio）
public/audio/*.ogg            # 28 条交付素材
```
