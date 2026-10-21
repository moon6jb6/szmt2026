/**
 * 把现有 three.js 场景渲染成「背景图」（不调用任何图像生成模型）
 *
 * 用法：
 *   node tools/render-scene-bg.mjs                    # 5 张全渲染
 *   node tools/render-scene-bg.mjs --only rooftop     # 只渲染一张
 *   node tools/render-scene-bg.mjs --port 4292
 *
 * 做法：
 *  1. 自己起一个 Vite dev server（默认 4292，独立 cacheDir，不碰 4173/dist/5199）；
 *  2. 打开 tools/scene-hotspots-harness.html?mode=bg&variant=… —— harness 把真实 Scene3D
 *     铺在一块比视口略大的画布上，用 CSS 做平移（把主体挪到右/下）、提亮、加对比；
 *  3. 等首帧稳定（data-ready 出现后再等 2.5s；warehouse-ext 还要等 GLB 加载完）；
 *  4. 截 1920×1080 PNG，ffmpeg 转 JPG（按体积在 180—450 KB 之间挑质量）；
 *  5. 在另一个空白页里解码 JPG，算整体/左上角平均亮度与最亮区块，验证「文字区留白」。
 *
 * 输出：
 *   public/scene-bg/{variant}.jpg          5 张成品（总 ≤2.5 MB）
 *   tools/shots/scene-hotspots/bg-raw/*.png 渲染原图（备案）
 *   tools/shots/scene-hotspots/bg-report.json 尺寸/体积/亮度/构图数据
 *
 * GPU 纪律：无头 Chrome 走 SwiftShader 软件渲染，不占 GPU、不碰 nvidia-smi。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const execFileAsync = promisify(execFile)

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'public/scene-bg')
const SHOTS = join(ROOT, 'tools/shots/scene-hotspots')
const RAW_DIR = join(SHOTS, 'bg-raw')

const portArg = process.argv.indexOf('--port')
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.SCENE_BG_PORT ?? 4292)
const onlyArg = process.argv.indexOf('--only')
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1] : null
/** 只量现有的 JPG（不重开 3D）：检查尺寸/体积/亮度，并把结果并回 bg-report.json */
const ANALYZE_ONLY = process.argv.includes('--analyze-only')
/** 临时调参用：--bright 1.8 --contrast 1.1（覆盖 CONFIG 里的同名值，不改文件） */
const overrideArg = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  if (at < 0) return null
  const value = Number(process.argv[at + 1])
  return Number.isFinite(value) ? value : null
}
const OVERRIDE = {
  bright: overrideArg('bright'),
  contrast: overrideArg('contrast'),
  sat: overrideArg('sat'),
  zoom: overrideArg('zoom'),
  grain: overrideArg('grain'),
  lift: overrideArg('lift'),
}

const W = 1920
const H = 1080
const MIN_BYTES = 180 * 1024
const MAX_BYTES = 450 * 1024
const TOTAL_BYTES = 2.5 * 1024 * 1024

/**
 * 每个切片的构图参数（相机是 Scene3D 的，这里只用 CSS 平移/调色，不改源码）：
 *  - zoom > 1：画布比视口大，留出平移余量，同时像素更密；
 *  - x / y：画布相对视口的偏移，正数把画面往右下推，给左上角留标题位；
 *  - bright / contrast / sat：截图前的 CSS filter，暗场景在这里提亮；
 *  - grain / lift：harness 里铺程序化颗粒（overlay）与抬黑（screen），给暗部一点结构、压住 JPG 色带。
 */
const CONFIG = {
  'warehouse-int': { zoom: 1.08, x: 46, y: 30, bright: 1.8, contrast: 1.06, sat: 1.02, grain: 0.42, lift: 0.85 },
  'warehouse-ext': { zoom: 1.14, x: 50, y: 36, bright: 1.62, contrast: 1.16, sat: 1.08, grain: 0.42, lift: 0.85 },
  rooftop: { zoom: 1.18, x: 44, y: -86, bright: 0.98, contrast: 1.05, sat: 1.03, grain: 0.68, lift: 1.0 },
  bridge: { zoom: 1.08, x: 46, y: 30, bright: 1.16, contrast: 1.06, sat: 1.02, grain: 0.5, lift: 0.92 },
  'office-1947': { zoom: 1.1, x: 42, y: 34, bright: 1.12, contrast: 1.05, sat: 1.0, grain: 0.42, lift: 0.85 },
}

const VARIANTS = ['warehouse-int', 'warehouse-ext', 'rooftop', 'bridge', 'office-1947']
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

const kb = (bytes) => Math.round(bytes / 1024)

/** 在空白页里解码 JPG，算亮度分区（不碰 WebGL 画布，避免 preserveDrawingBuffer 的坑） */
async function analyze(auxPage, buffer) {
  const base64 = buffer.toString('base64')
  return auxPage.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/jpeg;base64,${data}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const g = canvas.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    const { data: px, width, height } = g.getImageData(0, 0, canvas.width, canvas.height)

    const lum = (index) => 0.2126 * px[index] + 0.7152 * px[index + 1] + 0.0722 * px[index + 2]
    let sum = 0
    let count = 0
    let tlSum = 0
    let tlCount = 0
    const tlLums = []
    // 4×3 分块：找最亮的那块，近似「主体落在哪」
    const COLS = 4
    const ROWS = 3
    const blockSum = new Array(COLS * ROWS).fill(0)
    const blockCount = new Array(COLS * ROWS).fill(0)

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const value = lum((y * width + x) * 4)
        sum += value
        count += 1
        if (x < width * 0.38 && y < height * 0.26) {
          tlSum += value
          tlCount += 1
          tlLums.push(value)
        }
        const col = Math.min(COLS - 1, Math.floor((x / width) * COLS))
        const row = Math.min(ROWS - 1, Math.floor((y / height) * ROWS))
        const slot = row * COLS + col
        blockSum[slot] += value
        blockCount[slot] += 1
      }
    }

    tlLums.sort((a, b) => a - b)
    const blocks = blockSum.map((value, slot) => ({
      col: slot % COLS,
      row: Math.floor(slot / COLS),
      mean: Number((value / Math.max(1, blockCount[slot])).toFixed(1)),
    }))
    const brightest = blocks.reduce((best, block) => (block.mean > best.mean ? block : best), blocks[0])

    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      mean: Number((sum / Math.max(1, count)).toFixed(1)),
      topLeftMean: Number((tlSum / Math.max(1, tlCount)).toFixed(1)),
      topLeftP95: Math.round(tlLums[Math.floor(tlLums.length * 0.95)] ?? 0),
      blocks,
      brightest,
    }
  }, base64)
}

/** PNG → JPG：挑一个体积落在 180—450 KB 的质量档（体积最接近 320 KB 的优先） */
async function encodeJpeg(pngPath, jpgPath) {
  let best = null
  for (const q of [2, 3, 4, 5, 6, 7, 8, 9]) {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', pngPath, '-q:v', String(q), '-pix_fmt', 'yuv420p', jpgPath])
    const { size } = await stat(jpgPath)
    if (size > MAX_BYTES) continue
    const distance = Math.abs(size - 320 * 1024)
    if (!best || distance < best.distance) best = { q, size, distance }
  }
  if (!best) {
    // 连 q=9 都超 450 KB（几乎不会）：退一步取最小体积档
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', pngPath, '-q:v', '12', '-pix_fmt', 'yuv420p', jpgPath])
    const { size } = await stat(jpgPath)
    best = { q: 12, size, distance: 0 }
  } else {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', pngPath, '-q:v', String(best.q), '-pix_fmt', 'yuv420p', jpgPath])
  }
  return best
}

async function launchBrowser() {
  const swiftshader = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-watchdog',
    '--disable-features=Vulkan',
  ]
  try {
    return await chromium.launch({ channel: 'chrome', args: swiftshader })
  } catch (error) {
    console.warn(`swiftshader 启动失败（${error.message}），回退默认参数`)
    return chromium.launch({ channel: 'chrome' })
  }
}

await mkdir(OUT_DIR, { recursive: true })
await mkdir(SHOTS, { recursive: true })
await mkdir(RAW_DIR, { recursive: true })

const startedAt = Date.now()
const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.ts'),
  cacheDir: join(ROOT, 'node_modules/.vite-scene-bg'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: PORT, strictPort: false },
})
await server.listen()
const address = server.httpServer?.address()
const resolvedPort = typeof address === 'object' && address ? address.port : PORT
const baseUrl = `http://127.0.0.1:${resolvedPort}/tools/scene-hotspots-harness.html`
console.log(`harness: ${baseUrl}`)

const browser = await launchBrowser()
const results = []
const problems = []

/** 上一版报告（--only / --analyze-only 时把没重跑的切片原样带过来） */
let previous = {}
try {
  const prior = JSON.parse(await readFile(join(SHOTS, 'bg-report.json'), 'utf8'))
  for (const item of prior.images ?? []) previous[item.variant] = item
} catch {
  /* 第一次跑，没有旧报告 */
}

try {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`)
  })

  const auxContext = await browser.newContext()
  const auxPage = await auxContext.newPage()
  await auxPage.goto('about:blank')

  for (const variant of VARIANTS) {
    if (ONLY && ONLY !== variant) continue
    const cfg = { ...CONFIG[variant] }
    if (OVERRIDE.bright !== null) cfg.bright = OVERRIDE.bright
    if (OVERRIDE.contrast !== null) cfg.contrast = OVERRIDE.contrast
    if (OVERRIDE.sat !== null) cfg.sat = OVERRIDE.sat
    if (OVERRIDE.zoom !== null) cfg.zoom = OVERRIDE.zoom
    if (OVERRIDE.grain !== null) cfg.grain = OVERRIDE.grain
    if (OVERRIDE.lift !== null) cfg.lift = OVERRIDE.lift
    const jpgPath = join(OUT_DIR, `${variant}.jpg`)
    console.log(`\n--- ${variant} ---`)

    let encoded
    let pngBytes = null
    let firstFrame = null
    let glInfo = null
    let shotConsoleErrors = []

    if (ANALYZE_ONLY) {
      const { size } = await stat(jpgPath)
      encoded = { q: null, size }
      const old = previous[variant]
      pngBytes = old?.pngBytes ?? null
      firstFrame = old?.firstFrameMs ?? null
      glInfo = old?.gl ?? null
      shotConsoleErrors = consoleErrors.slice()
      console.log('  （--analyze-only：只量现有 JPG）')
    } else {
      const url = `${baseUrl}?mode=bg&variant=${encodeURIComponent(variant)}&zoom=${cfg.zoom}&x=${cfg.x}&y=${cfg.y}&bright=${cfg.bright}&contrast=${cfg.contrast}&sat=${cfg.sat}&grain=${cfg.grain}&lift=${cfg.lift}`
      console.log(`  url: ${url}`)

      const t0 = Date.now()
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForSelector('.scene3d[data-ready]', { timeout: 30000 })
      firstFrame = Date.now() - t0
      if (variant === 'warehouse-ext') {
        await page
          .waitForSelector('.scene3d[data-glb="ready"]', { timeout: 30000 })
          .catch(() => problems.push(`${variant}: GLB 未就绪（data-glb 不是 ready），截图里可能缺墙`))
      }
      // 首帧之后还要等动画/贴图稳住：≥2.5s
      await wait(2600)

      glInfo = await page.evaluate(() => {
        const host = document.querySelector('.scene3d')
        return {
          gl: host?.dataset.gl ?? null,
          ready: host?.dataset.ready ?? null,
          glb: host?.dataset.glb ?? null,
          fps: host?.dataset.fps ?? null,
          calls: host?.dataset.calls ?? null,
          tris: host?.dataset.tris ?? null,
          canvas: (() => {
            const c = document.querySelector('.scene3d canvas')
            return c ? { w: c.width, h: c.height } : null
          })(),
        }
      })
      if (glInfo.gl === 'unavailable') problems.push(`${variant}: WebGL 不可用，截到的是空白底`)
      if (!glInfo.canvas) problems.push(`${variant}: 没找到 canvas`)

      const rawPng = join(RAW_DIR, `${variant}.png`)
      const pngBuffer = await page.screenshot({ type: 'png', path: rawPng })
      pngBytes = pngBuffer.length
      encoded = await encodeJpeg(rawPng, jpgPath)
      shotConsoleErrors = consoleErrors.slice()
    }

    const finalBuffer = await readFile(jpgPath)
    const info = await analyze(auxPage, finalBuffer)

    if (info.width !== W || info.height !== H) problems.push(`${variant}: 尺寸 ${info.width}×${info.height}，不是 ${W}×${H}`)
    if (encoded.size > MAX_BYTES) problems.push(`${variant}: ${kb(encoded.size)} KB 超过 450 KB`)
    if (encoded.size < MIN_BYTES) problems.push(`${variant}: ${kb(encoded.size)} KB 低于 180 KB（画面暗，压缩率高）`)

    const item = {
      variant,
      file: `public/scene-bg/${variant}.jpg`,
      width: info.width,
      height: info.height,
      bytes: encoded.size,
      kb: kb(encoded.size),
      ffmpegQ: encoded.q,
      source: {
        zoom: cfg.zoom,
        offsetX: cfg.x,
        offsetY: cfg.y,
        brightness: cfg.bright,
        contrast: cfg.contrast,
        saturate: cfg.sat,
        grain: cfg.grain,
        lift: cfg.lift,
      },
      firstFrameMs: firstFrame,
      pngBytes,
      gl: glInfo,
      light: {
        mean: info.mean,
        topLeftMean: info.topLeftMean,
        topLeftP95: info.topLeftP95,
        brightestBlock: info.brightest,
        blocks: info.blocks,
      },
      consoleErrors: shotConsoleErrors,
    }
    results.push(item)

    console.log(
      `  ${info.width}×${info.height}  ${kb(encoded.size)} KB (q=${encoded.q ?? '未重压'})  mean=${info.mean}  ` +
        `左上均值=${info.topLeftMean}  最亮块=col${info.brightest.col}/row${info.brightest.row}`,
    )
    if (!ANALYZE_ONLY) {
      console.log(
        `  首帧 ${firstFrame} ms  gl=${glInfo.gl} canvas=${glInfo.canvas ? `${glInfo.canvas.w}×${glInfo.canvas.h}` : '无'}  fps=${glInfo.fps}`,
      )
    }
  }

  if (consoleErrors.length) problems.push(`控制台报错 ${consoleErrors.length} 条：${consoleErrors.slice(0, 3).join(' | ')}`)

  await auxContext.close()
  await context.close()
} finally {
  await browser.close()
  await server.close()
}

/** --only / --analyze-only 时把没跑到的切片从旧报告带过来，保证报告始终是五张齐全的 */
const merged = VARIANTS.map((variant) => results.find((item) => item.variant === variant) ?? previous[variant]).filter(Boolean)
const missing = VARIANTS.filter((variant) => !merged.some((item) => item.variant === variant))

const totalBytes = merged.reduce((sum, item) => sum + item.bytes, 0)
const totalKb = kb(totalBytes)
if (totalBytes > TOTAL_BYTES) problems.push(`五张合计 ${totalKb} KB，超过 2.5 MB`)
if (missing.length) console.log(`\n（缺 ${missing.join(' / ')} 的数据，合计只算了 ${merged.length} 张：${totalKb} KB）`)

const report = {
  renderedAt: new Date().toISOString(),
  elapsedMs: Date.now() - startedAt,
  viewport: { width: W, height: H },
  totalBytes,
  totalKb,
  budgetBytes: TOTAL_BYTES,
  images: merged,
  missing,
  problems,
}
await writeFile(join(SHOTS, 'bg-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`\n合计 ${totalKb} KB / 2.5 MB 预算   用时 ${Math.round((Date.now() - startedAt) / 1000)}s`)
if (problems.length) {
  console.log('\n需要注意：')
  for (const problem of problems) console.log(` - ${problem}`)
  process.exitCode = 1
} else {
  console.log('\n全部达标：尺寸 1920×1080、单张 180—450 KB、合计 ≤2.5 MB、左上角可用作标题区。')
}
console.log(`报告：${join(SHOTS, 'bg-report.json')}`)
