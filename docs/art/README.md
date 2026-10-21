# docs/art — 图片体系交付清单

《把名字留下来》500 张生成图的总谱与验收资料。**art-director 维护，image-runner 执行，Lead 集成。**

## 文件用途（一句话版）

| 文件 | 用途 | 消费者 |
|---|---|---|
| `image-manifest.json` | **500 条总谱**（顶层数组）：id / category / width / height / prompt / negative / seed / steps / guidance / usage / scene / tokens / file / out / rev。是唯一权威图源，prompt 可直接喂 `tools/imagegen/gen.py`。 | image-runner、Lead |
| `batches/batch-001…010.json` | manifest 按出图优先级切成的 10 批，每批 50 条，格式可直接 `gen.py --batch`。批次顺序：scene → moment → ending → atmo → artifact → figure → ui。 | image-runner |
| `scene-map.json` | **128 条「场景 id → 插画」映射**：`{"v2-13": {"image": "public/art/scene-046.jpg", "id": "scene-046", "usage": "卷二·…"}}`。Lead 在 `Scene.image` 字段直接查表接入。 | Lead |
| `visual-bible.md` | **视觉圣经**：色板（旗红/铁锈/沙金/烟黑/纸白）、光线规则、镜头语言、人物/文物规则、禁止项、prompt 结构与版本记录（r1—r6）、negative 词表、尺寸/批次/id 规范、「灵魂五问」验收标准。 | 全体 |
| `spot-check.md` | **人工抽查记录**：每 50 张抽 10 张的逐张判定（A/B/C/R）、系统性问题台账（问题→根因→修复→验证）、分批台账。 | Lead 终审 |
| `image-manifest-r2-pretrim.json` | r2 预裁版留档（token 重标定前的历史快照，仅供回溯，不用于生成）。 | 归档 |
| `../tools/imagegen/build-manifest.mjs` | **总谱生成器**：解析 `src/game/content/volume*.ts` + `chapter1.ts` 场景表，应用 `SCENE_OVERRIDES`（真实场景 prompt）/`MOMENT_OVERRIDES`（moment 句型），统一风格前缀 + 类别护栏 + token 裁剪，输出 manifest / batches / scene-map。场景表更新后跑 `node tools/imagegen/build-manifest.mjs` 即可刷新。 | art-director |

## 生成规格（最终口径）

- 尺寸：**768×432**（16:9 类，UI 里横幅最高显示 340px，足够）、768×768（文物/纹理）、576×768（人物剪影）。
  - 曾经尝试 960×544 与「UNet 常驻」以提速，但 8GB 显存 + 16GB 内存在多任务下抖动，最终选 768×432 + CPU offload + `--mem-mode fast`：`peak_reserved 5.48 GiB`，稳态 11—15 秒/张。
- 模型：SDXL base 1.0 fp16 + SDXL-Lightning 4-step LoRA，`steps=4, guidance=0`。
- 落盘：生成期写 `D:/AI大模型/art-work/<id>.jpg`（避开 OneDrive 同步与 Defender 扫描），质检通过后拷入 `public/art/`；同名 `.json` 记录 prompt/seed/耗时/显存。
- **id 已冻结**：`scene-001…128 / moment-001…100 / artifact-001…80 / figure-001…60 / ending-001…30 / ui-001…60 / atmo-001…42`，合计 500，永不改名。
- **最终结果**：落盘 496 张（4 张质检不合格被剔除）；入屏图 158 张逐张 VLM 质检，初检 93.0% pass，重生成后 95.6% 可用。详见 `image-qa-report.md`。

## 五条红线（VLM + 人工双查）

1. 无清晰人脸 / 人群（人物只允许剪影、背影；`figure-*` 类专属）。
2. 无可读文字 / 英文字母 / 汉字（文物纸面只允许虚焦墨迹；报纸虚焦）。
3. 无现代物（高楼/霓虹/汽车/手机/塑料/现代路牌等）。
4. 旗帜只出现布料/针脚/竹竿/逆光剪影，**不出现任何徽记图案**，避免旗帜图案错误。
5. 无血腥暴行细节，不做苦难消费、不做杀敌计数。

> 注意：`gen.py` 在 `guidance=0` 时**不会把 negative 传给 pipeline**（CFG 关闭），所以红线的第一道防线是 prompt 里的**类别护栏前置**（`empty scene, no people, no faces, no text` 等）+ VLM 质检；negative 字段保留给「调高 guidance 重试」。详见 `visual-bible.md` §8。

## 版本与状态

- prompt 版本 **r6（冻结）**：r1 初版 → r2 护栏前置+暖调 → r3 token 重标定（估 ≤66 / 真实 ≤72）→ r4 scene 按 writers 真实场景表重写+时代中性前缀 → r5 moment 100 条改「物为主语+动作结果」→ r6 清 9 处诱发手/人的词。
- `scene-*` 覆盖卷零—卷五全部 128 个新场景；`chapter1.ts` 现有 12 场景继续用 `public/bg/` 8 张已筛基准图，不重复生成。
- 抽查进行中：见 `spot-check.md`。
