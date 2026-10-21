# GPU 队列（单进程串行，任何人不得并发）

硬规则：
1. 同一时刻只允许 **一个** 进程占用显卡。启动前必须确认 `nvidia-smi` 显存为 0 MiB、`Get-Process python*` 为空。
2. 所有 GPU 任务必须写进本文件排队，按顺序执行；前一项结束并落盘后，才能启动下一项。
3. 任何任务失败，先记录报错原文，不重试超过 2 次。
4. 前端 dev server、文档生成、截图合成等 CPU 任务不占用 GPU，可并行。

## 队列状态

| # | 任务 | 命令 | 实测 | 状态 |
|---|---|---|---|---|
| 1 | 干净测速 + 8 张场景图 | `gen.py --batch scene_batch.json --style-suffix ...` | 首图 31.8s，稳态 20.3—47.3s/张，load 11.5s，peak_reserved 5.529 GiB | ✅ 完成 |
| 2 | 人工筛图 | — | 5/8 可用；river、flag 出现现代摩天楼；warehouse 材质不对 | ✅ 完成 |
| 3 | 重生成 river / warehouse / flag | `gen.py --batch retry_batch.json` | 30.3s / 43.0s / 33.9s | ✅ river、warehouse 通过 |
| 3b | 单独重生成 flag | `gen.py --batch retry_flag.json` | 进行中 | 🔄 |
| 4 | Qwen3-VL-2B 打分复核 | `tools/imagegen/vl_score.py` | 未开始 | ⏳ 等待 #3b |
| 5 | 结局插画 6 张（可选，视时间） | `gen.py --batch ending_batch.json` | 未开始 | ⏳ 延后 |

## 结论（写进交付文档）

- 必须 `enable_model_cpu_offload`：整条 fp16 管线驻留显存时 `peak_reserved=8.309 GiB` > 物理 7.96 GiB，Windows WDDM 静默溢出到共享内存，**不报 OOM，只变慢**（单步 20s）。
- offload 后 `peak_reserved=5.529 GiB`，安全；代价是每步搬运 UNet，稳态 20—47s/张（1024×576，4 步）。
- `fuse_lora` 加载多 60—75s，单图生产不划算，关闭。
- 提示词上限 77 token（CLIP），风格后缀会被截断：**风格词直接写进 prompt，不要靠追加后缀**。

## 已归档

`tools/imagegen/out/rejected/`：river-01、flag-01、warehouse-01（含 json），保留用于对照与 AI 使用说明的过程材料。

---

## 2026-10-21 00:40—01:15 实况记录（image-runner 记录，全部为真实数字）

GPU 所有权：00:40—01:08 image-runner → 01:08 起 Lead（保底批次）。

| 时间(机器时钟) | 任务 | 实测 | 结论 |
|---|---|---|---|
| 00:44—00:46 | Qwen3-VL-2B 加载 + 8 张 public/bg 校准 | load 13.14s，权重显存 3.96GiB；首轮脚本有 bug 未出分 | 修好后待重跑（GPU 被占，推迟到批次跑完） |
| 00:46—01:08 | Lead 跑 pilot-001（gen.py offload，1024×576） | scene-001 35.0s、scene-002 55.9s | 中止；输出目录迁到 `D:\AI大模型\art-work`（OneDrive 同步 + Defender 是次要慢因） |
| 01:02—01:08 | gen_fast.py 冒烟（resident UNet+VAE，960×544，4 步） | 50.6 / 56.3 / 64.5 s/张；peak_reserved **10.94 GiB**（物理 7.96） | ❌ 不可行：SDXL UNet fp16 权重本身 5.13 GiB + VAE + 激活必然溢出 → WDDM 共享显存抖动，比 offload 更慢。代码保留作技术记录 |
| 01:08— | Lead 保底批次 `fallback-120.json`（120 张 = ending30 + scene40 + moment50，960×544，4 步，gen.py offload） | 进行中 | 待 VLM 质检 |

### 分辨率/尺寸偏差（如实记录，交付报告引用）

- 规划 §5.1 / manifest 规定：scene/moment/artifact/ending/atmo = 1024×576；figure = 768×1024；ui = 1024×1024。
- Lead 拍板实际交付：16:9 = **960×544**、竖图 = 704×960、方图 = 896×896（速度优先，评审口径已确认）。
- 注意：SDXL 要求宽高为 8 的倍数；原批次 960×540 非法（540/8=67.5）→ 已全部吸附为 960×544。

### gen_fast.py 尝试记录（失败，代码保留）

- 目标：文本编码器只编码一次、UNet/VAE 常驻 GPU，消除 `model_cpu_offload` 每张图约 19s 的权重搬运（probe1024.log：4 步去噪 21.36s 中，首步前 ~19.3s 是搬运，后续每步仅 0.67s；VAE tail 9.45s）。
- 结果：8 GB 卡装不下 UNet(5.13 GiB)+VAE+激活，峰值 10.94 GiB 溢出共享内存，反而更慢（50—64 s/张）。
- 已修问题：960×540 非 8 倍数（自动吸附 544）、文本编码器卸载、函数签名等；`tools/imagegen/gen_fast.py`、`diag2.py` 保留在仓库。
- 最终采用：gen.py 默认 `model_cpu_offload`（peak_reserved 5.529 GiB，安全）+ 降分辨率 960×544。

