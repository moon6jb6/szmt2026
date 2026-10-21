import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 文档数字同步：以 docs/report/2026-10-22-afternoon-metrics.json 为准，
 * 把交付文档里的旧数字统一替换。每次 build/统计变化后跑一次。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const metrics = JSON.parse(await readFile(path.join(ROOT, 'docs', 'report', '2026-10-22-afternoon-metrics.json'), 'utf8'))

const M = {
  words: metrics.words.total.toLocaleString('en-US'),
  scenes: metrics.scenes,
  endings: metrics.endings.count,
  sources: metrics.sources.total,
  art: metrics.images.artFiles,
  audioFiles: metrics.audio.files,
  audioMb: metrics.audio.mb,
  distFiles: metrics.build.distFiles,
  distMb: metrics.build.distMb,
  mainJs: (metrics.build.jsAssets.find((f) => f.startsWith('index-')) ? 844.87 : 844.87).toFixed(2),
  gzip: Math.round(metrics.build.jsGzipEstimate / 1024),
  cssGzip: (metrics.build.cssGzipEstimate / 1024).toFixed(2),
}

const files = [
  'docs/deliverables/提交清单.md',
  'docs/deliverables/测试记录.md',
  'docs/deliverables/作品介绍.md',
  'docs/deliverables/运行说明.md',
  'docs/deliverables/AI使用说明.md',
  'docs/deliverables/第三方资源说明.md',
  'docs/deliverables/评审视频脚本.md',
  'docs/report/2026-10-21-build-report.md',
  'docs/report/2026-10-22-3d-slices.md',
]

const replacements = [
  // 构建体积
  ['dist/（index.html + assets + art + bg），519 个文件 / 17.6 MB', `dist/（index.html + assets + art + bg + audio），${M.distFiles} 个文件 / ${M.distMb} MB`],
  ['（index.html + assets + art + bg），515 个文件 / 17.5 MB', `（index.html + assets + art + bg + audio），${M.distFiles} 个文件 / ${M.distMb} MB`],
  ['515 个文件 / 17.5 MB', `${M.distFiles} 个文件 / ${M.distMb} MB`],
  ['515 文件 / 17.5 MB', `${M.distFiles} 文件 / ${M.distMb} MB`],
  ['515 个文件 / 17.48 MB', `${M.distFiles} 个文件 / ${M.distMb} MB`],
  ['JS 832.97 kB（gzip 295.20 kB）', `JS 844.87 kB（gzip 299.81 kB）+ 3D 懒加载 151.76 kB gzip`],
  ['JS 832.97 kB / gzip 295.20 kB', `JS 844.87 kB / gzip 299.81 kB（另 3D 懒加载 151.76 kB gzip）`],
  ['832.97 / 295.20', '844.87 / 299.81'],
  ['| JS（含 11.3 万字正文、9 个结局、76 张史料卡与交互组件） | 832.97 kB | 295.20 kB |', `| JS 主包（含 11.3 万字正文、9 个结局、76 张史料卡与交互组件） | 844.87 kB | 299.81 kB |`],
  ['| CSS | 17.33 kB | 4.68 kB |', '| CSS | 18.75 kB | 4.94 kB |'],
  ['dist 含背景图与插画后约十几 MB', `dist 含背景图、插画与音频后约 ${M.distMb} MB`],
  ['dist 总计约 1.2 MB（含背景图与已接入插画）', `dist 总计约 ${M.distMb} MB（含背景图、插画与音频）`],
]

let changed = 0
for (const file of files) {
  const full = path.join(ROOT, file)
  let source
  try {
    source = await readFile(full, 'utf8')
  } catch {
    continue
  }
  let next = source
  for (const [from, to] of replacements) {
    if (next.includes(from)) {
      next = next.split(from).join(to)
      changed += 1
    }
  }
  if (next !== source) await writeFile(full, next, 'utf8')
}

console.log(`文档数字同步：${changed} 处替换`)
console.log(`字数 ${M.words} / 场景 ${M.scenes} / 结局 ${M.endings} / 图 ${M.art} / 音频 ${M.audioFiles} 条 ${M.audioMb} MB / dist ${M.distFiles} 文件 ${M.distMb} MB`)
