# 生成图质检报告（image-qa-report.md）

> 质检对象：**入屏图**（scene-001…128 + ending-001…030，共 158 张）。其余 342 张为美术总谱素材（moment/artifact/figure/atmo/ui），本轮不全部上屏，未做逐张 VLM 复核，仅做人工抽查。
> 质检模型：Qwen3-VL-2B-Instruct（本地，bf16），四维 0—5 分：prompt 符合度 / 时代准确性 / 画面瑕疵 / 危险元素（清晰人脸、可读文字、现代物、旗帜图案错误）。
> 判定：pass 入库；retry 换 seed 重生成；reject 废弃并记录。

## 一、总览

| 项 | 数值 |
|---|---|
| 入屏图初检 | 158 张 |
| 初检 pass | **147** |
| 初检 retry | 4 |
| 初检 reject | 7 |
| 初检通过率 | **93.0%** |
| 重生成（seed +1000） | 8 张（4 个 retry + 4 个 reject，含 ending-002） |
| 重生成后 pass | 4（scene-062 / scene-070 / scene-085 / ending-002） |
| **最终可用** | **151 / 158 = 95.6%** |
| 剔除（无图，走渐变回退） | 4 个场景：v2-23（scene-056）、v2-27（scene-060）、v4-07（scene-110）、v5-05（scene-123） |

四维均分（初检 158 张）：prompt 符合度 **4.01**、时代准确性 **3.93**、画面瑕疵 **4.72**、危险元素 **4.94**。
失败类型分布：prompt_fit_low 10、period_fit_low 7、cleanliness_low 5、safety_low 2。

## 二、最终进入交付的图

| 类别 | 数量 | 说明 |
|---|---|---|
| 场景插画 | **124 张**（128 个场景中 4 个缺图） | 经 `docs/art/scene-map.json` 映射到 v0-01…v5-10，由 `src/game/content/sceneImages.ts` 自动挂载 |
| 结局插画 | **6 张** | ending-001…006 分别用于名册/家书/旗/照片/口述/口信 |
| 美术总谱素材 | 496 − 124 − 6 = **366 张** | moment/artifact/figure/atmo/ui 与结局变体，随 `public/art/` 一起交付，供后续扩展 |
| 合计落盘（public/art） | **496 张** | 4 张被剔除后不再进入 dist |

## 三、抽查与红线

- 人工抽查见 `docs/art/spot-check.md`（每 50 抽 10；重点：清晰人脸、可读文字、现代物、旗帜图案错误）。
- r1—r6 六轮 prompt 迭代全部由抽查触发：r1 曾出现清晰人脸与人群，r2 把护栏前置并加暖调锚定，r3 按实测 tokenizer 重裁，r4 按真实场景重写，r5 改 moment 句型（物为主语），r6 清掉诱发手/人的词。
- 已知遗留：少数场景类图存在弱时代线索（如远处电线、现代感的金属件），已按「不承担史实表述」处理，不出现在以史实为核心的画面里；4 个缺图场景用渐变背景回退，不影响叙事。

## 四、复现方式

```bash
# 生成（8GB 显存，CPU offload + fast 模式，约 11—15 秒/张）
python tools/imagegen/gen.py --batch tools/imagegen/batches-run/run-001.json --mem-mode fast

# 质检（Qwen3-VL-2B 本地）
python tools/imagegen/vl_score.py --images "D:/AI大模型/art-work/*.jpg" --only scene,ending \
  --merge --out out-art/reports/screen-images.json --max-side 640 --max-new-tokens 220

# 重生成失败图（seed +1000）
node tools/imagegen/make-retry.mjs scene-056 scene-060 scene-070 scene-085
python tools/imagegen/gen.py --batch tools/imagegen/retry-ui.json --mem-mode fast
```

## 五、如实说明

- 500 张总谱中，逐张 VLM 质检覆盖的是 **158 张入屏图**；其余素材只做人工抽查，未逐张过模型——这是时间取舍，报告不隐瞒。
- 8GB 显存下「UNet 常驻」方案峰值 10.9 GiB 不可行（实测 50—56 秒/张），最终采用 CPU offload + 768×432 降分辨率 + fast 模式（`peak_reserved 5.48 GiB`，稳态 11—15 秒/张），图片在 UI 中显示为 340px 高横幅，分辨率足够。
- 图片为生成素材，不承担史实表述，不用于还原历史现场，不出现真实人物面孔。
