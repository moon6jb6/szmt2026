/**
 * 主包成分拆解（不改 src，用 rolldown 按同一套压缩设置单独量各成分）
 *
 * 用法：node tools/quality/bundle-split.mjs
 * 输出：控制台表格 + tools/quality/bundle-split.json
 *
 * 方法说明：
 * 1. dist 产物大小直接读 dist/assets（raw）与 zlib.gzipSync（level 9，Vite 报的 gzip 用同一库，数值可对齐）。
 * 2. 主包成分：把「数据模块」与「React 运行时」各自作为独立入口跑一遍 rolldown（esm + minify），
 *    得到它们在同一压缩器下的体积；应用组件 = 主包 − 数据 − React。
 *    因为三段是分开压缩，gzip 不可严格相加，报告里按「约」表述，并用 raw 做交叉校验。
 * 3. 数据入口全部 re-export，保证不被 tree-shake。
 */
import { gzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rolldown } from 'rolldown'

const ROOT = resolve(import.meta.dirname, '../..')
const DIST = join(ROOT, 'dist/assets')
// 十进制 kB，与 vite build 输出口径一致
const kb = (bytes) => Math.round((bytes / 1000) * 100) / 100
const gzip = (code) => gzipSync(Buffer.from(code)).length

const CONTENT_ALL = [
  'src/game/content/chapter1.ts',
  'src/game/content/volume0.ts',
  'src/game/content/volume1.ts',
  'src/game/content/volume2.ts',
  'src/game/content/volume3.ts',
  'src/game/content/volume4.ts',
  'src/game/content/volume5.ts',
  'src/game/content/endings.ts',
  'src/game/content/sources.ts',
  'src/game/content/sources.auto.ts',
  'src/game/content/sceneImages.ts',
  'src/game/content/scene3d.ts',
  'src/game/content/audioManifest.ts',
]

const VOLUMES = [
  ['chapter1.ts', '基础五夜 + 序章/尾声'],
  ['volume0.ts', '序卷'],
  ['volume1.ts', '卷一'],
  ['volume2.ts', '卷二'],
  ['volume3.ts', '卷三'],
  ['volume4.ts', '卷四（后来）'],
  ['volume5.ts', '卷五（人物志）'],
  ['endings.ts', '九结局'],
  ['sources.ts', '史料卡 76 张（含 sources.auto）'],
  ['sceneImages.ts', '场景图映射'],
]

const tmp = join(ROOT, 'tools/quality/.tmp')
mkdirSync(tmp, { recursive: true })
let seq = 0

async function measure(entrySource, name) {
  const file = join(tmp, `entry-${seq++}.tsx`)
  writeFileSync(file, entrySource, 'utf8')
  const bundle = await rolldown({ input: file, platform: 'browser' })
  const { output } = await bundle.generate({ format: 'esm', minify: true })
  let raw = 0
  let gz = 0
  for (const out of output) {
    if (out.type !== 'chunk') continue
    raw += Buffer.byteLength(out.code)
    gz += gzip(out.code)
  }
  await bundle.close()
  return { name, raw, gz }
}

function reexport(files) {
  const lines = files.map((f, i) => {
    const p = f.replace(/\.ts$/, '')
    return `export * as m${i} from ${JSON.stringify(join(ROOT, p))}`
  })
  return `${lines.join('\n')}\n`
}

// ---- 1. dist 产物 ----
const assets = readdirSync(DIST)
const pick = (prefix) => assets.find((f) => f.startsWith(prefix) && f.endsWith('.js'))
const jsMain = pick('index-')
const js3d = pick('Scene3D-')
const css = assets.find((f) => f.endsWith('.css'))
const distRow = (file) => {
  const path = join(DIST, file)
  const code = readFileSync(path)
  return { name: file, raw: code.length, gz: gzip(code) }
}

const dist = {
  main: distRow(jsMain),
  three: distRow(js3d),
  css: distRow(css),
  html: (() => {
    const code = readFileSync(join(ROOT, 'dist/index.html'))
    return { name: 'index.html', raw: code.length, gz: gzip(code) }
  })(),
}

// ---- 2. 成分 ----
const content = await measure(reexport(CONTENT_ALL), '内容数据（全部卷/结局/史料/映射）')
const react = await measure(
  `export { default as React } from "react";\nexport { createRoot, hydrateRoot } from "react-dom/client";\n`,
  'React 19 + ReactDOM 运行时',
)
const firstScreenDataFiles = ['src/game/content/chapter1.ts', 'src/game/content/volume0.ts']
const firstScreen = await measure(reexport(firstScreenDataFiles), '首屏所需数据（chapter1 + volume0）')

// 逐卷
const perVolume = []
for (const [file, label] of VOLUMES) {
  const row = await measure(
    reexport([`src/game/content/${file}`]),
    file,
  )
  perVolume.push({ file, label, raw: row.raw, gz: row.gz })
}

rmSync(tmp, { recursive: true, force: true })

const appCode = {
  raw: dist.main.raw - content.raw - react.raw,
  gz: dist.main.gz - content.gz - react.gz,
}

const result = {
  generatedAt: new Date().toISOString(),
  method: 'rolldown esm+minify 同参数量各成分；gzip zlib level 9；gzip 非严格可加',
  dist: {
    main: { rawKB: kb(dist.main.raw), gzipKB: kb(dist.main.gz) },
    three: { rawKB: kb(dist.three.raw), gzipKB: kb(dist.three.gz) },
    css: { rawKB: kb(dist.css.raw), gzipKB: kb(dist.css.gz) },
    html: { rawKB: kb(dist.html.raw), gzipKB: kb(dist.html.gz) },
  },
  mainBundleSplit: {
    contentData: { rawKB: kb(content.raw), gzipKB: kb(content.gz), shareRawPct: Math.round((content.raw / dist.main.raw) * 1000) / 10 },
    reactRuntime: { rawKB: kb(react.raw), gzipKB: kb(react.gz), shareRawPct: Math.round((react.raw / dist.main.raw) * 1000) / 10 },
    appCode: { rawKB: kb(appCode.raw), gzipKB: kb(appCode.gz), shareRawPct: Math.round((appCode.raw / dist.main.raw) * 1000) / 10 },
  },
  firstScreenData: { rawKB: kb(firstScreen.raw), gzipKB: kb(firstScreen.gz) },
  perVolume: perVolume.map((v) => ({
    ...v,
    rawKB: kb(v.raw),
    gzipKB: kb(v.gz),
    shareOfContentPct: Math.round((v.raw / content.raw) * 1000) / 10,
  })),
}

writeFileSync(join(ROOT, 'tools/quality/bundle-split.json'), JSON.stringify(result, null, 2), 'utf8')

// ---- 3. 打印 ----
const pad = (s, n) => String(s).padEnd(n, ' ')
console.log('\n[dist 产物]')
console.log(pad('文件', 30), pad('raw KB', 10), 'gzip KB')
for (const key of ['main', 'three', 'css', 'html']) {
  const row = dist[key]
  console.log(pad(row.name, 30), pad(kb(row.raw), 10), kb(row.gz))
}

console.log('\n[主包 845 KB 拆解]')
const split = result.mainBundleSplit
console.log(pad('成分', 34), pad('raw KB', 10), pad('gzip KB', 10), '占主包 raw')
console.log(pad('内容数据', 34), pad(split.contentData.rawKB, 10), pad(split.contentData.gzipKB, 10), split.contentData.shareRawPct + '%')
console.log(pad('React 运行时', 34), pad(split.reactRuntime.rawKB, 10), pad(split.reactRuntime.gzipKB, 10), split.reactRuntime.shareRawPct + '%')
console.log(pad('应用组件/引擎', 34), pad(split.appCode.rawKB, 10), pad(split.appCode.gzipKB, 10), split.appCode.shareRawPct + '%')

console.log('\n[数据按卷]')
console.log(pad('模块', 18), pad('说明', 26), pad('raw KB', 9), 'gzip KB')
for (const v of result.perVolume) {
  console.log(pad(v.file, 18), pad(v.label, 26), pad(v.rawKB, 9), v.gzipKB)
}
console.log('\n首屏所需数据（chapter1 + volume0）:', result.firstScreenData.rawKB, 'KB raw /', result.firstScreenData.gzipKB, 'KB gzip')
console.log('JSON → tools/quality/bundle-split.json\n')
