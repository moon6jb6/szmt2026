import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** v1.5 文档同步：场景探索/三段阅读/42 事件音效 + 新构建数字。 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const targets = []
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'trash', 'out-art', 'deliverables'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full)
    else if (entry.name.endsWith('.md')) targets.push(full)
  }
}
await walk(path.join(ROOT, 'docs'))
for (const name of ['README.md', 'docs/superpowers/active-context.md']) targets.push(path.join(ROOT, name))

const repl = [
  ['845.59', '906.07'],
  ['844.87', '906.07'],
  ['298.5 kB', '319.0 kB'],
  ['297.69', '319.0'],
  ['166.7', '171.1'],
  ['668.7', '670.2'],
  ['23.47', '24.59'],
  ['545 个文件', '550 个文件'],
  ['544 个文件', '550 个文件'],
  ['545 文件', '550 文件'],
  ['544 文件', '550 文件'],
  ['19.12 kB', '105.28 kB'],
  ['4.92 kB gzip', '22.3 kB gzip'],
  ['4.94 kB gzip', '22.3 kB gzip'],
  ['105.28 kB / gzip 22.3 kB', '105.28 kB / gzip 22.3 kB'],
]

let touched = 0
for (const file of targets) {
  let s
  try {
    s = await readFile(file, 'utf8')
  } catch {
    continue
  }
  const before = s
  for (const [a, b] of repl) if (s.includes(a)) s = s.split(a).join(b)
  if (s !== before) {
    await writeFile(file, s, 'utf8')
    touched += 1
  }
}

const append = async (rel, lines) => {
  const full = path.join(ROOT, rel)
  await writeFile(full, (await readFile(full, 'utf8')) + '\n' + lines.join('\n') + '\n', 'utf8')
}

await append('docs/deliverables/运行说明.md', [
  '',
  '## 十二、2026-10-22 新增交互（v1.5）',
  '',
  '| 位置 | 交互 | 说明 |',
  '|---|---|---|',
  '| 第一夜 | 灯下找名字 | 移动鼠标/手指当手电，找 3 个藏起来的名字；Tab+Enter 可直接点亮，右上角「跳过（Esc）」 |',
  '| 第三夜 | 升旗 | 按住旗面往上拖，风会周期回拽，到顶保持半秒；可跳过 |',
  '| 有 3D 的场景 | 场景探索 | 右上角「场景探索」：一张背景图 + 22 个可点热点（悬停墨圈、点开一句环境旁白、部分挂史料卡），Esc 两级退出 |',
  '| 长段落（>6 段） | 三段阅读 | 「继续读 ▸」/ Enter / 空格分组推进；有人物的组卡片背后会浮现男/女剪影，回忆组转暖褐旧纸；读完才出现选项 |',
  '| 尾声 | 交付托盘 | 9 个结局变成桌上 9 件实物，拖进匣子并按住 1 秒按手印；也可点两次 / 键盘 1—9 + Enter |',
  '| 声音 | 42 个事件 | 菜单、悬停、五种换场、六种载体、结局起势/收束、八类环境点缀；默认静音，右下角开启 |',
])

await append('docs/deliverables/测试记录.md', [
  '',
  '## 十三、2026-10-22 深夜 v1.5 新交互回归',
  '',
  '| 测试 | 结果 | 说明 |',
  '|---|---|---|',
  '| `node tools/verify-signature.mjs <url>` | PASS | night1 灯下找名字 / night3 升旗 / 尾声托盘均可出现、可跳过、无报错 |',
  '| `node tools/verify-carry.mjs <url>` | PASS | 尾声 9 件实物、键盘选中+交付、到达结局页 |',
  '| `node tools/verify-explore.mjs <url>` | PASS | 场景探索：背景图 200、热点可点、开卡/退出、无报错 |',
  '| `node tools/verify-beats.mjs <url>` | PASS | 长段落分 3 组、键盘不跳场、footer 选项、mood 与剪影切换 |',
  '| `node tools/audio/verify-events.mjs <dev-url>` | 32/32 PASS | 42 事件、28 条素材无死条、混音补偿、悬停限流、点缀冷却 |',
  '| `node tools/ending-test-v3.mjs <url>` | 9/9 PASS | 尾声已改 CarryTray 后重跑 |',
  '| `node tools/walk-test.mjs <url>` | PASS | 115 场景到「名册」0 错误（自动跳过签名覆盖层） |',
  '| `node tools/lead-audit.mjs <url>` | 11/11 PASS | 键盘/坏存档/图鉴/3D 泄漏/GLB 缓存/404 回退/localStorage 禁用 |',
  '| `node tools/test-deploy.mjs` / `test-degrade.mjs` / `test-3d-chunk-fail.mjs` / `test-3d.mjs` | PASS | 子目录部署 / 减少动效 / chunk 失败不白屏 / 5 切片 |',
  '| `node tools/quality/a11y-check.mjs <url>` | PASS | 对比度全 PASS、错误 none |',
  '',
  '新构建数字：dist **550 文件 / 24.59 MB**；主包 **906.07 kB（gzip 319.0 kB）**；3D 懒加载 **670.16 kB（gzip 171.1 kB）**；CSS **105.28 kB（gzip 22.3 kB）**。',
])

await append('docs/deliverables/成果状态.md', [
  '',
  '---',
  '',
  '## 2026-10-22 02:0x 更新（v1.5：交互强化）',
  '',
  '- ✅ **真 3D 场景 → 背景图 + 热点探索**：5 张 1920×1080 背景图、22 处热点（悬停墨圈/旁白窄卡/史料卡/发现计数/双层视差/键盘/390px/减少动效）。`verify-explore` PASS。',
  '- ✅ **长段落三段阅读 + 人物剪影**：>6 段自动分 3 组，mood 判定 scene/memory/figure-male/figure-female，卡片氛围与整页背景随组变化，人物组浮出剪影；键盘让位。`verify-beats` PASS。',
  '- ✅ **音效 42 事件重建并接回 App**：菜单/悬停/换场/载体/结局起势收束/8 类点缀/UI 回执；四总线+逐条补偿+卷积混响；`verify-events` 32/32。',
  '- ✅ **前序交互保留**：灯下找名字、升旗、尾声交付托盘（拖进匣子+按住 1 秒）、回顶修复。',
  '- ⚠️ 期间发生外部进程删除文件（源码与 .git 索引），已从 git 恢复、重建集成，并建立 `D:\\backups\\live` 每 2 分钟增量备份。',
  '- 🔄 仍待：正式重出 PDF、重新打包（新构建 550 文件 / 24.59 MB）、评审视频、报名/承诺书、文献回填。',
])

await append('docs/report/2026-10-22-interaction-vs-video.md', [
  '',
  '---',
  '',
  '## 落地结果（2026-10-22 深夜）',
  '',
  '- 没有做每场景视频；已落地的交互：尾声交付托盘、第一夜灯下找名字、第三夜升旗、3D 场景「背景图 + 22 热点」、长段落三段阅读 + 人物剪影。',
  '- 构建：主包 906.07 kB（gzip 319.0 kB）、3D 懒加载 171.1 kB gzip、CSS 22.3 kB gzip；断网与子目录部署仍通过。',
  '- 证据：`docs/report/2026-10-22-scene-hotspots.md`、`2026-10-22-scene-beats.md`、`2026-10-22-audio-restore.md`、`2026-10-22-carry-tray.md`、`2026-10-22-signature-interactions.md`。',
])

console.log('docs touched:', touched)
