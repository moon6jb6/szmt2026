import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 唯一数字来源：把项目所有可核对的数字采集到 docs/report/2026-10-22-afternoon-metrics.json。
 * 之后所有文档引用这里，避免手写数字漂移。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const OUT = path.join(ROOT, 'docs', 'report', '2026-10-22-afternoon-metrics.json')

const read = (p) => readFile(path.join(ROOT, p), 'utf8')
const cjk = (text) => (text.match(/[\u4e00-\u9fa5]/gu) ?? []).length

/** 严格正文：只统计 paragraphs 里的字符串 */
function extractParagraphs(source) {
  const chunks = []
  const key = /paragraphs\s*:\s*\[/gu
  let match
  while ((match = key.exec(source)) !== null) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '[') depth += 1
      else if (ch === ']') depth -= 1
      i += 1
    }
    chunks.push(source.slice(start, i - 1))
  }
  return chunks
}
function extractStrings(chunk) {
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/gu
  let m
  while ((m = re.exec(chunk)) !== null) out.push(m[1] ?? m[2] ?? '')
  return out
}

const contentFiles = [
  ['volume0', 'src/game/content/volume0.ts'],
  ['volume1', 'src/game/content/volume1.ts'],
  ['volume2', 'src/game/content/volume2.ts'],
  ['volume3', 'src/game/content/volume3.ts'],
  ['volume4', 'src/game/content/volume4.ts'],
  ['volume5', 'src/game/content/volume5.ts'],
  ['chapter1', 'src/game/content/chapter1.ts'],
  ['endings', 'src/game/content/endings.ts'],
]

const words = {}
let wordTotal = 0
let sceneTotal = 0
for (const [name, file] of contentFiles) {
  const source = (await read(file)).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1')
  const segments = extractParagraphs(source).flatMap(extractStrings)
  const count = segments.reduce((sum, text) => sum + cjk(text), 0)
  words[name] = count
  wordTotal += count
  sceneTotal += (source.match(/\bid:\s*'([^']+)',\s*\n\s*chapter:/gu) ?? []).length
}

// 结局数
const endingsSource = await read('src/game/content/endings.ts')
const endingKinds = [...endingsSource.matchAll(/^\s{2}(\w+): \{\s*$/gmu)].map((m) => m[1])
const endingTitles = [...endingsSource.matchAll(/kind: '([^']+)',\s*\n\s*title: '([^']+)'/gu)].map((m) => ({ kind: m[1], title: m[2] }))

// 史料卡
const sourceIds = new Set()
for (const file of ['src/game/content/sources.ts', 'src/game/content/sources.auto.ts']) {
  const raw = await read(file)
  for (const m of raw.matchAll(/\bid["']?\s*:\s*["']([^"']+)["']/gu)) sourceIds.add(m[1])
}
const statuses = { verified: 0, pending: 0, needed: 0 }
for (const file of ['src/game/content/sources.ts', 'src/game/content/sources.auto.ts']) {
  const raw = await read(file)
  for (const m of raw.matchAll(/status["']?\s*:\s*["'](verified|pending|needed)["']/gu)) statuses[m[1]] += 1
}

// 图片
const artDir = path.join(ROOT, 'public', 'art')
const artFiles = (await readdir(artDir).catch(() => [])).filter((f) => f.endsWith('.jpg'))
const bgFiles = (await readdir(path.join(ROOT, 'public', 'bg')).catch(() => [])).filter((f) => f.endsWith('.jpg'))
const sceneMap = JSON.parse(await readFile(path.join(ROOT, 'docs', 'art', 'scene-map.json'), 'utf8').catch(() => '{}'))

// 音频
const audioDir = path.join(ROOT, 'public', 'audio')
const audioFiles = (await readdir(audioDir).catch(() => [])).filter((f) => f.endsWith('.ogg') || f.endsWith('.webm'))
let audioBytes = 0
for (const file of audioFiles) {
  audioBytes += (await stat(path.join(audioDir, file))).size
}
const audioManifest = JSON.parse(
  await readFile(path.join(ROOT, 'docs', 'audio', 'audio-manifest.json'), 'utf8').catch(() => '{}'),
)

// 构建产物
const distDir = path.join(ROOT, 'dist')
let distFiles = 0
let distBytes = 0
let jsBytes = 0
let jsGzip = 0
let cssBytes = 0
let cssGzip = 0
const assets = []
try {
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        const info = await stat(full)
        distFiles += 1
        distBytes += info.size
        if (entry.name.endsWith('.js')) {
          assets.push(entry.name)
          jsBytes += info.size
          if (entry.name.startsWith('index-')) jsGzip = Math.round(info.size * 0.35)
        }
        if (entry.name.endsWith('.css')) {
          cssBytes += info.size
          cssGzip = Math.round(info.size * 0.26)
        }
      }
    }
  }
  await walk(distDir)
} catch {
  /* dist 不存在 */
}

// 3D 性能（来自验证脚本）
const perf = JSON.parse(
  await readFile(path.join(ROOT, 'tools', '3d', 'shots', 'perf.json'), 'utf8').catch(() => '{}'),
)

// git commit
let commit = null
try {
  commit = (await readFile(path.join(ROOT, '.git', 'HEAD'), 'utf8')).trim()
} catch {
  /* ignore */
}

const metrics = {
  generatedAt: new Date().toISOString(),
  gitHead: commit,
  words: { total: wordTotal, byFile: words },
  scenes: sceneTotal,
  endings: { count: endingTitles.length, kinds: endingTitles },
  sources: { total: sourceIds.size, statuses },
  images: {
    artFiles: artFiles.length,
    backgroundFiles: bgFiles.length,
    sceneMapEntries: Object.keys(sceneMap).length,
  },
  audio: {
    files: audioFiles.length,
    bytes: audioBytes,
    mb: Math.round((audioBytes / 1024 / 1024) * 100) / 100,
    model: audioManifest?.model?.id ?? null,
    modelParamsM: audioManifest?.model?.params_m ?? null,
    peakVramMib: audioManifest?.totals?.peak_vram_mib ?? null,
    license: audioManifest?.model?.license ?? null,
  },
  build: {
    distFiles,
    distMb: Math.round((distBytes / 1024 / 1024) * 100) / 100,
    jsBytes,
    cssBytes,
    jsAssets: assets,
    jsGzipEstimate: jsGzip,
    cssGzipEstimate: cssGzip,
  },
  threeD: {
    slices: perf.slices?.map((s) => ({ variant: s.variant, fps: s.fps, calls: s.calls, tris: s.tris })) ?? [],
    allPass: perf.allPass ?? null,
  },
}

await writeFile(OUT, JSON.stringify(metrics, null, 2), 'utf8')
console.log(JSON.stringify(metrics, null, 2))
