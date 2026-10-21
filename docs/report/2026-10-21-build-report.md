# 2026-10-21/22 构建与验收报告（最终）

> 2026-10-21 凌晨完成扩写与出图；2026-10-22 下午完成 9 结局、交互、真 3D、音效与打包形态修复。
> 所有数字可用仓库内脚本复现；唯一数字源：`docs/report/2026-10-22-afternoon-metrics.json`。

## 一、交付指标（硬指标逐项）

| 指标 | 要求 | 实际 | 状态 |
|---|---|---|---|
| 正文严格字数 | ≥ 100,000 | **113,138** | ✅ |
| 场景数 | ≥ 128（规划） | **140** | ✅ |
| 结局数 | ≥ 6 | **9**（6 主 + 3 合成），**9/9 可达** | ✅ |
| 单周目时长 | 1—2 小时（原始要求） | **2—3 小时**；全部内容约 6 小时 | ✅ 超 |
| 史料卡 | 可插拔 | **76 张**（已核 63 / 待核 7 / 待接入 6） | ✅ |
| 生成图 | 「照着五百张来」 | **500 条总谱，落盘 496 张**；入屏 158 张逐张 VLM 质检，95.6% 可用 | ✅ |
| 音效 | 本地小模型生成 | **28 条 / 4.88 MB**（Stable Audio Open Small 497M，峰值 3.4 GB） | ✅ |
| 真 3D | 加深 3D 效果 | **4 个切片**（仓库内景/楼顶/桥/1947 厢房），lazy 151.76 KB gzip，87—120 fps | ✅ |
| 双轨审计 | 史实 P0=0，文学均分 ≥4.0 | 史实 **P0=0 / P1=0**；文学 **P0=0、不合格 0/146、加权 4.59**（覆盖 6 主结局；新增内容为自查，见 `docs/audit/2026-10-22-post-audit-addendum.md`） | ✅ |
| 构建 | 零报错 | tsc + vite 通过 | ✅ |
| 主链可达 | 走到结局 | **307 步 / 115 场景 / 0 错误 / 151 秒** | ✅ |
| 结局可达 | ≥6 | **9/9 PASS**（存档注入法，0 错误） | ✅ |
| 扩展页面 | 人物志/后来/史料库 | 10 篇 / 15 篇 / 76 张卡，UI 冒烟全绿 | ✅ |
| 打包形态 | 子目录起服务可用 | `test-deploy`：0 failed requests、0 错误 | ✅ |
| 降级 | 减少动效 / 移动端 | 3D 按钮自动隐藏，流程可走完 | ✅ |

## 二、产物

| 产物 | 位置 | 大小 / 数量 |
|---|---|---|
| 构建产物 | `dist/` | 544 文件 / 22.93 MB（主包 JS 844.87 kB → gzip 299.81 kB；3D chunk 151.76 kB gzip；CSS 4.94 kB gzip） |
| 场景插画 | `public/art/`、`dist/art/` | 496 张 / 124 场景挂载 + 6 结局插画 |
| 音效 | `public/audio/`、`dist/audio/` | 28 条 OGG / 4.88 MB + manifest |
| 真 3D | lazy chunk + `tools/3d/` | 4 切片，程序化几何，无外部模型 |
| 交付截图 | `docs/deliverables/screenshots/` | 10 张（含 2.5D、真 3D、九结局、终极画面、人物志、后来、史料库、移动端） |
| 交付 PDF | `docs/deliverables/*.pdf` | 12 份（新增成果状态） |
| 审计报告 | `docs/audit/` | FINAL×2 + 分卷 + 覆盖边界 addendum + 工具 |
| 美术/音频文档 | `docs/art/`、`docs/audio/` | manifest / qa-report / visual-bible；audio-manifest + 复现脚本 |
| 写作与规划 | `docs/superpowers/specs/`、`docs/report/` | 扩写规划、3D/音频规划、下午执行计划、metrics |

## 三、验证命令与结果

```text
node tools/metrics.mjs                     唯一数字源（字数/场景/结局/图/音频/dist/3D）
node tools/count-words-strict.mjs          严格正文 113,138 字（只算 paragraphs）
node tools/check-volumes.mjs               140 场景；next 328 条全部有效；sources 381 条全部存在
node tools/walk-test.mjs <url>             307 步、115 场景、结局「名册」、0 错误
node tools/ending-test-v3.mjs <url>        9/9 PASS（6 主 + 3 合成）
node tools/ui-smoke.mjs <url>              10 人物志 / 15 后来 / 76 史料卡 / 插画 768px，0 错误
node tools/test-3d.mjs <url>               3D 87.3fps / 16 calls / 3,093 tris；移动端无按钮
node tools/test-audio.mjs <dev-url>        默认静音、开关生效、场景与结局声音正确、状态持久化
node tools/test-deploy.mjs                 子目录 + HTTP：0 failed requests、0 错误
node tools/test-degrade.mjs <url>          减少动效与 390px 降级 PASS
npm run build                              ✓（tsc 0 错误）
```

## 四、如实记录的取舍与遗留

1. **volume3 / volume4 未达规划体量**（12,816 / 4,148 字 vs 20,000 / 12,000）：总量达标后取消补写，质量优先。
2. **volume4 扩写版曾在 01:08 被覆盖回退**：两版均过审计，交付的是去重后旧版。
3. **volume2 文学评分**为全量扫描 + 6 场代表抽读，未逐场五维。
4. **图片**：500 张总谱中 496 张落盘；逐张 VLM 只覆盖 158 张入屏图（95.6% 可用），其余 342 张为素材，仅人工抽查；4 个场景因图被剔除而使用渐变回退。
5. **8GB 显存限制**：UNet 常驻方案峰值 10.9 GiB 不可行，最终 CPU offload + 768×432 + fast 模式（5.48 GiB，11—15 秒/张）。
6. **音频/3D 的选择**：不做全项目 3D 化（UI/角色/相机全重写，2 天不可控），只做 4 个 hero 场景切片；音频默认静音，避免评审现场突然出声。
7. **审计覆盖边界**：3 个合成结局（约 3,118 字）、交互层、3D、音效在双轨审计冻结后新增，只有人工自查；已在 AI 使用说明与 `docs/audit/2026-10-22-post-audit-addendum.md` 中如实披露。
8. **单周目 2—3 小时**与原始「1—2 小时」的差异：为满足 10 万字硬指标而扩展，已如实更新到全部对外文档。

## 五、下一步（不阻塞本次交付）

- 录制评审视频（≤5 分钟，脚本已按九结局/终极画面/3D/音效更新）
- 报名系统填写与承诺书盖章
- 打包 ZIP（目录结构见 `docs/deliverables/提交清单.md`；可脚本化）
- 文献检索结果回来后回填史料卡（请求单 `docs/research/文献检索请求-2026-10-22.json`）
- 可选：补齐 4 个缺图场景、给新增 3 结局补一轮独立审计
