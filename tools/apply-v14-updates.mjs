import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** v1.4 收尾：把三轮复审后的字数/体积/测试口径同步进文档，并追加复审结论。 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const targets = []
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'trash' || entry.name === 'out-art') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full)
    else if (entry.name.endsWith('.md')) targets.push(full)
  }
}
await walk(path.join(ROOT, 'docs'))
targets.push(path.join(ROOT, 'README.md'))

const replacements = [
  ['113,161', '113,048'],
  ['845.59', '847.26'],
  ['844.87', '847.26'],
  ['298.0 kB', '298.5 kB'],
  ['297.69', '298.5'],
  ['150.66', '171.1'],
  ['166.7', '171.1'],
  ['668.7', '670.2'],
  ['22.93', '23.47'],
  ['23.46', '23.47'],
  ['544 文件', '545 文件'],
  ['308 步 / 115 场景 / 151 秒到「名册」', '115 场景到「名册」/ 0 错误'],
  ['308 步 / 115 场景 / 151 秒', '115 场景到「名册」/ 0 错误（自动化点击含过渡重试）'],
  ['308 步、115 场景、结局「名册」、0 错误', '115 场景、结局「名册」、0 错误'],
  ['308 步到结局', '115 场景到结局'],
  ['308 步到「名册」/0 错误', '到「名册」/0 错误'],
  ['308 步 / 115 场景', '115 场景到结局'],
  ['复跑为 308 步', '复跑 115 场景到「名册」、0 错误'],
  ['全流程走路测试（308 步到结局）', '全流程走路测试（115 场景到结局）'],
  ['| v1.3（全本版', '| v1.4（全本版'],
  ['版本：v1.3', '版本：v1.4'],
  ['装在开发机全局，未列入 `package.json`', '已列入 `package.json` devDependencies（`npm i` 后可直接跑）'],
  ['`docs/deliverables/*.pdf` **12 份**（12:58:32—12:59:01）', '`docs/deliverables/*.pdf` **13 份**（含打包说明）'],
  ['PDF **12 份**', 'PDF **13 份**'],
]

let touched = 0
for (const file of targets) {
  let source
  try {
    source = await readFile(file, 'utf8')
  } catch {
    continue
  }
  let next = source
  for (const [from, to] of replacements) {
    if (next.includes(from)) next = next.split(from).join(to)
  }
  if (next !== source) {
    await writeFile(file, next, 'utf8')
    touched += 1
  }
}

const append = async (rel, lines) => {
  const full = path.join(ROOT, rel)
  await writeFile(full, (await readFile(full, 'utf8')) + '\n' + lines.join('\n') + '\n', 'utf8')
}

await append('docs/report/2026-10-22-story-rules-review.md', [
  '---',
  '',
  '## 九、Lead 处置（2026-10-22 22:4x）',
  '',
  '- **resumeAvailable 陈旧**：已改 toMenu() 回菜单时重算 hasSave()，结局页「回到开头」后会出现「继续上次」。',
  '- **单篇字数 <2,000**（letters 1,903 / message 1,998）：接受。总量 113,048 > 10 万是硬指标；这两篇删掉的是断句孤句与时间倒序段，不补回，已在测试记录「已知限制」注明。',
  '- **未修 8 条**：全部保留并在报告 §四列明；其中「第一夜时间重叠/报数三遍」属 base 场 + 扩写场双写的结构性取舍，改动需重排主链 10 场，截止前不动，已如实记录。',
  '- 本轮改动进入 v1.4：words 113,048；账本封顶、照片/家书保管链等行为已由 ending-test-v3（9/9）与 walk（115 场景）覆盖。',
])

await append('docs/report/2026-10-22-animation-review.md', [
  '---',
  '',
  '## 9. Lead 处置（2026-10-22 22:4x）',
  '',
  '§8 列的 3 项 App 改动已全部落地，随 v1.4 提交：',
  '',
  '1. **开场幕时长**：新增 CURTAIN_OPEN = { coverMs: 700, holdMs: 200, revealMs: 700 }（1.6s），用于「从头开始」；章内换场仍 2.82s。',
  '2. **换场重播入场错峰**：场景根节点加 key={scene.id}，每次换场重新挂载，段落/标题/选项动画按设计重播。',
  '3. **键盘监听**：改为只挂一次 + useRef 读最新 state/handlers，不再每次 render 重挂。',
  '',
  '另：本轮同时修掉 3D 复审提出的两项 App 问题（lazy chunk 失败 ErrorBoundary、换场晚一拍多挂 3D），并把「继续上次」的可见性改成回菜单时重算。',
])

await append('docs/report/2026-10-22-3d-loading-review.md', [
  '---',
  '',
  '## 十、Lead 处置（2026-10-22 22:4x）',
  '',
  '报告「六、A/B」两项 App 侧问题已随 v1.4 修复：',
  '',
  '1. **P0 白屏**：新增 Scene3DBoundary（class ErrorBoundary，getDerivedStateFromError + componentDidCatch → 回退 2.5D 并清空 3D 状态）。回归脚本 tools/test-3d-chunk-fail.mjs 实测：拦截 Scene3D-*.js 后点「3D 视角」→ 正文仍在（1,285 字）、自动回 2.5D、页面不崩。',
  '2. **换场多挂一次 3D**：view3d 布尔改为 view3dScene（记住场景 id），换场后 show3d 自然为 false，删掉晚一拍的 effect；3D 入口/卸载由 show3d 单点派生。',
  '',
  '追加回归：五切片 test-3d 全 pass；GLB 子目录 200；404 回退 0 报错；反复开关 canvas 回基线（baseline 3 → after 3）；二次进入 GLB 请求 0 次。',
])

await append('docs/deliverables/测试记录.md', [
  '',
  '## 十二、2026-10-22 夜间复审轮（v1.4）',
  '',
  '三份独立复审报告：docs/report/2026-10-22-story-rules-review.md、2026-10-22-animation-review.md、2026-10-22-3d-loading-review.md。',
  '',
  '| 轮次 | 结论 | 关键修复 | 证据 |',
  '|---|---|---|---|',
  '| 剧情/规则 | P0=0；死路 0；存档续玩通过 | 照片/家书保管链三方矛盾、旗样方位、名册保管链、账本封顶（roster 84→5）、13 处文本硬伤 | 18 处修改；check-volumes / 9 结局 9/9 / walk 115 场景 |',
  '| 动画/交互 | 5 类缺陷全修 | 墨幕连点跳场、@2× 换场掉帧（单帧像素 −53%）、reduced-motion 终极画面黑屏、终极画面 8.46s→6.2s、9 种 hover 失效、空闲 64→234fps | 41 张取证帧 + docs/report/anim-check.json |',
  '| 3D 加载 | GLB 链路干净；App 侧 2 项已修 | GLB 比例 −9.8%、context lost 永久黑屏、GLB/贴图泄漏、重复请求（二次 0 请求）、lazy chunk 失败白屏（ErrorBoundary） | tools/3d/shots/review/ 51 张 + 5 切片 test-3d 全 pass |',
  '',
  '最终回归：lead-audit 11/11（键盘/存档异常/图鉴 9 格/3D 反复开关无泄漏/GLB 缓存/404 回退/localStorage 禁用）；test-3d-chunk-fail PASS；子目录部署 0 failed；减少动效/390px PASS；对比度全 PASS。',
])

console.log('docs updated: ' + touched + ' files')
