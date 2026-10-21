# 当前有效上下文（只保留重要设定与危险提示）

> 用途：给后续任何 agent / 会话一个「只读这一页也不跑偏」的简报。
> 更新时间：2026-10-22 01:0x。过期细节不要回填到这里，写进各自的 report。

## 一、作品与截止

- 作品：**《把名字留下来：四行仓库·苏州河北岸的四百余个名字》**，作品编号 **460737**。
- 赛事：2026 第十四届全国大学生数字媒体科技作品及创意竞赛，红色之旅·追梦铸魂；**截止 2026-10-23 23:59:59**。
- 形态：纯前端静态站点（React 19 + TS + Vite 8），无后端/CDN/外部字体；`base:'./'` 子目录可部署；断网可跑。
- 当前规模：**140 场景 / 113,048 字 / 9 结局（6 主 + 3 合成） / 76 张史料卡 / 496 张插画 / 28 条音效 / 5 个真 3D 场景**。
- Playwright 已改为项目 devDependency；测试命令在 README 与 `docs/deliverables/测试记录.md`。

## 二、设计基调（不可漂移）

1. **不做战斗、不做杀敌数、不做守失评分**；结局只改变「哪种记忆被留下」。
2. 真实人物只以可查证事实出现，**零自编台词**；未核史实不进正文。
3. 视觉语言：1947 年冬夜 · 纸 / 墨 / 红 / 金 / 旧木；不用 emoji、不用发光现代按钮。
4. 默认**静音**（评审现场不能自动出声），右下角开关；音频事件 42 个（`src/game/audio.ts`）。
5. 无障碍：键盘全流程、`prefers-reduced-motion` 全量降级、对比度全 PASS、移动端可用。
6. 交互方向（已定）：**不做每场景视频**，钱投在交互上——结局交付手势（CarryTray）、第一夜灯下找名字、第三夜升旗、3D 场景改「背景图+热点」、长段落三段分割+人物剪影。

## 三、当前正在进行（2026-10-22 凌晨）

| 任务 | 状态 |
|---|---|
| 音效扩展（42 事件、28 条全接、配平） | ✅ 已并入构建 |
| 结局交付手势 CarryTray | ✅ 已接入尾声并测通 |
| 灯下找名字 SpotlightFind / 升旗 FlagRaise | ✅ 已接入 night1 / night3 覆盖层，Esc 可跳过 |
| 剧情树（HTML/PNG/MD） | ✅ `docs/report/剧情树.*` |
| 全站 37 类卡片特效 | ✅ `src/card-effects.css` |
| 回顶修复 | ✅ 换场/换页/开卡回顶 + 结果段落平滑回顶 |
| 3D → 背景图 + 热点（SceneHotspots） | 🚧 agent 进行中 |
| 长段落三段分割 + 人物剪影（SceneBeats） | 🚧 agent 进行中 |
| P1 五夜过河 | ⏳ 未开始（视时间，可砍） |

## 四、危险提示（Priority）

1. **GPU 单任务**：另一个任务 `tools/ppt/build_deck.py` 正在跑；在它结束前**不要启动任何 GPU 生成**（SDXL/音频/其他）。开跑前 `nvidia-smi` 必须 0 MiB 且无 python 推理进程，写完 `tools/audio/QUEUE.md` / 图像队列再跑。
2. **用户正在 4173 试玩**：不要重启 4173、不要动 `dist/`；改完源码由 Lead 统一 `npm run build`，用户刷新即可。
3. **不要删除文件**：临时文件移入 `trash/<项目>-<日期>/`，不要 `rm -rf`。
4. **根文件曾被外部进程误删**（package.json / tsconfig* / vite.config / index.html / README / .gitignore）：每次提交/构建前先核对根文件存在；发现缺失从 git 恢复并重装依赖。
5. **测试脚本要兼容新交互**：尾声已不是 `.choice` 按钮（CarryTray），night1/night3 有覆盖层（`.signature-overlay`，右上角「跳过（Esc）」）；walk/ending/lead-audit/a11y 脚本已适配，新脚本注意。
6. **不要同时改 App.tsx**：音频/交互 agent 曾并行改同一文件；所有 App 接线由 Lead 统一做，agent 只交独立组件 + 接入示例。
7. **打包**：`node tools/package.mjs --name "把名字留下来_四行仓库·苏州河北岸的四百余个名字_460737"`；PDF 必须先重出（旧 PDF 会触发阻断）。
8. **截止前不要做**：全项目 3D 化、按屏 lazy 拆包、Service Worker、每场景视频、重写文风。

## 五、关键命令

```bash
npm run dev / npm run build / npm run preview
node tools/metrics.mjs                 # 唯一数字源
node tools/count-words-strict.mjs      # 113,048
node tools/check-volumes.mjs           # 140 场景
node tools/walk-test.mjs <url>         # 115 场景到结局
node tools/ending-test-v3.mjs <url>    # 9/9（已适配 CarryTray）
node tools/lead-audit.mjs <url>        # 键盘/存档/图鉴/3D 泄漏
node tools/test-signature-live.mjs <url>
node tools/test-carry-live.mjs <url>
node tools/test-scroll-top.mjs <url>
node tools/test-deploy.mjs / test-degrade.mjs / test-3d-chunk-fail.mjs
node tools/story-tree.mjs --shots      # 重出剧情树
node tools/package.mjs --dry-run       # 打包体检
```

## 六、关键文件

- 入口与编排：`src/App.tsx`（音频/3D/签名时刻/回顶都在这里接线）
- 叙事：`src/game/content/{chapter1,volume0—5,endings,sources}.ts`、`src/game/engine.ts`（账本封顶 5/5/1/1/5/1）
- 交互组件：`components/{CarryTray,SpotlightFind,FlagRaise,Scene3D,InkCurtain,ChoiceBurst,EndingFinale}.tsx`
- 声音：`src/game/audio.ts` + `docs/audio/README.md`
- 美术/音频/审计/复审报告：`docs/{art,audio,audit,report}/`
- 交付物：`docs/deliverables/`（PDF / 截图 / 打包说明 / 提交清单）
- 剧情树：`docs/report/剧情树.html`（可双击打开）
