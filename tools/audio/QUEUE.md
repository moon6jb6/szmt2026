# QUEUE — 音效生成队列（tools/audio/generate.py 自动写入）

> GPU 纪律：同一时刻只有一个 python 进程占卡；开工前 `nvidia-smi` 确认无其他
> compute 进程；不运行 `tools/imagegen/gen.py`；发现卡被占用就停下报告，不抢占。

模型：`stabilityai/stable-audio-open-small`（本地 `D:\AI大模型\audio\stable-audio-open-small`） · 8 steps · pingpong sampler · cfg 1.0 · 44.1kHz

本轮完成 1 个 take，用时 0.1 min（模型加载 59.4s）。

| # | id | 组 | 轮次 | 状态 | 秒 | 耗时 s | 显存峰值 MiB |
|---|----|----|------|------|----|--------|--------------|
| 1 | `click-roster` | carrier | 1 | ↩︎ exists | 6.0 |  |  |
| 2 | `click-letters` | carrier | 1 | ↩︎ exists | 6.0 |  |  |
| 3 | `click-flag` | carrier | 1 | ↩︎ exists | 6.0 |  |  |
| 4 | `click-photo` | carrier | 1 | ✅ done | 6.0 | 3.33 | 2331 |
| 5 | `click-testimony` | carrier | 1 | ↩︎ exists | 6.0 |  |  |
| 6 | `click-message` | carrier | 1 | ↩︎ exists | 6.0 |  |  |
| 7 | `page-turn` | material | 1 | ↩︎ exists | 6.0 |  |  |
| 8 | `paper` | material | 1 | ↩︎ exists | 6.0 |  |  |
| 9 | `pen` | material | 1 | ↩︎ exists | 6.0 |  |  |
| 10 | `ink` | material | 1 | ↩︎ exists | 6.0 |  |  |
| 11 | `match` | material | 1 | ↩︎ exists | 6.0 |  |  |
| 12 | `footsteps` | material | 1 | ↩︎ exists | 7.0 |  |  |
| 13 | `distant-thud` | material | 1 | ↩︎ exists | 6.0 |  |  |
| 14 | `rain-light` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 15 | `rain-heavy` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 16 | `snow-wind` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 17 | `river` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 18 | `crowd-whisper` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 19 | `room-tone` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 20 | `tape-hiss` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 21 | `flag-flap` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 22 | `radio-static` | ambience | 2 | ↩︎ exists | 11.89 |  |  |
| 23 | `drone-ending-names` | drone | 2 | ↩︎ exists | 11.89 |  |  |
| 24 | `drone-ending-letters` | drone | 2 | ↩︎ exists | 11.89 |  |  |
| 25 | `drone-ending-flag` | drone | 2 | ↩︎ exists | 11.89 |  |  |
| 26 | `drone-ending-photo` | drone | 2 | ↩︎ exists | 11.89 |  |  |
| 27 | `drone-ending-testimony` | drone | 2 | ↩︎ exists | 11.89 |  |  |
| 28 | `drone-ending-message` | drone | 2 | ↩︎ exists | 11.89 |  |  |

进度：28/28 条已生成。

最后更新：2026-10-21 09:53:30
