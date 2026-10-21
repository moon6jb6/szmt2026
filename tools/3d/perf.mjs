/**
 * 3D 切片性能取样（Playwright）
 *
 * 用法：
 *   node tools/3d/perf.mjs                     # 自己起 vite（127.0.0.1:5399），跑 4 个切片
 *   node tools/3d/perf.mjs --url http://127.0.0.1:5199   # 复用已经在跑的 dev server
 *   node tools/3d/perf.mjs --seconds 5 --headed --keep   # 更长的采样 / 开有头窗口 / 跑完不关服务
 *
 * 取样方式：
 *   - FPS 用页面内的 requestAnimationFrame 计数（不依赖组件自报，避免自欺）
 *   - draw calls / triangles 读 renderer.info.render 的帧峰值（由 Scene3D 写到 data-* 上）
 *   - 顺带验证 DPR 上限：deviceScaleFactor=3 时 canvas 缓冲区不应超过 CSS 尺寸的 2 倍
 *
 * 产出：tools/3d/shots/<variant>.png、warehouse-int-look-left.png、perf.json
 */

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const shotsDir = resolve(here, 'shots')
const PORT = 5399
const VIEW = { width: 1600, height: 1000 }
const BUDGET = { calls: 25, tris: 6000, fps: 55 }
const VARIANTS = ['warehouse-int', 'rooftop', 'bridge', 'office-1947']

const argv = process.argv.slice(2)
const has = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const seconds = Number(opt('seconds', 3))
const headed = has('headed')
const keep = has('keep')
const baseUrl = opt('url', `http://127.0.0.1:${PORT}`).replace(/\/$/, '')
const pageUrl = `${baseUrl}/tools/3d/proto.html`

let server = null

async function reachable(url, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((done) => setTimeout(done, 400))
  }
  return false
}

async function ensureServer() {
  if (await reachable(pageUrl, 1500)) {
    console.log(`复用已在运行的服务：${baseUrl}`)
    return
  }
  console.log(`启动 vite：${baseUrl}`)
  // Windows 上 npx 是 .cmd，Node 22+ 直接 spawn 会 EINVAL，统一走 shell
  server = spawn(`npx vite --port ${PORT} --strictPort --host 127.0.0.1`, {
    cwd: root,
    stdio: 'ignore',
    shell: true,
  })
  if (!(await reachable(pageUrl, 45000))) throw new Error('vite 没起来，先手动跑 `npm run dev` 再带 --url')
}

function stopServer() {
  if (!server || keep) return
  if (process.platform === 'win32') {
    // 只 kill 会留下 vite 子进程，得连进程树一起收
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    server.kill('SIGTERM')
  }
  server = null
}

const measureFps = (page, span) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        let frames = 0
        const started = performance.now()
        const tick = () => {
          frames += 1
          const elapsed = performance.now() - started
          if (elapsed < ms) requestAnimationFrame(tick)
          else done(frames / (elapsed / 1000))
        }
        requestAnimationFrame(tick)
      }),
    span * 1000,
  )

async function waitReady(page) {
  const goroutine = () => page.waitForFunction(() => window.__proto && window.__proto.ready, null, { timeout: 15000 })
  try {
    await goroutine()
  } catch {
    // 首次访问会触发依赖预构建 + 自动刷新，重载一次再等
    await page.reload({ waitUntil: 'load' })
    await goroutine()
  }
}

async function main() {
  await mkdir(shotsDir, { recursive: true })
  await ensureServer()

  let browser = null
  const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu']
  try {
    // 优先用本机 Chrome（有真 GPU），没有就退回 Playwright 自带 chromium
    browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: gpuArgs })
  } catch {
    browser = await chromium.launch({ headless: !headed, args: gpuArgs })
  }

  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 })
  const results = []
  const failures = []

  for (const variant of VARIANTS) {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`${pageUrl}?variant=${variant}`, { waitUntil: 'load' })
    await waitReady(page)
    await page.waitForTimeout(1200) // 预热：让材质/着色器编译稳定下来
    const fps = await measureFps(page, seconds)
    const stats = await page.evaluate(() => window.__proto.stats)
    const canvas = await page.evaluate(() => {
      const el = document.querySelector('.scene3d canvas')
      return el ? { width: el.width, height: el.height, clientWidth: el.clientWidth } : null
    })
    await page.screenshot({ path: resolve(shotsDir, `${variant}.png`) })

    // 单独给仓库一个「往左看」的截图：证明 yaw 真的动、且被夹在 ±18°
    let lookShot = null
    if (variant === 'warehouse-int') {
      await page.mouse.move(20, 60)
      await page.waitForTimeout(900)
      lookShot = resolve(shotsDir, 'warehouse-int-look-left.png')
      await page.screenshot({ path: lookShot })
    }

    if (canvas) await page.close()

    const passCalls = stats.calls <= BUDGET.calls
    const passTris = stats.tris <= BUDGET.tris
    const passFps = fps >= BUDGET.fps
    const row = {
      variant,
      fps: Number(fps.toFixed(1)),
      calls: stats.calls,
      tris: stats.tris,
      dpr: stats.dpr,
      gpu: stats.gpu,
      pass: passCalls && passTris && passFps,
      failures: [
        passCalls ? null : `draw calls ${stats.calls} > ${BUDGET.calls}`,
        passTris ? null : `triangles ${stats.tris} > ${BUDGET.tris}`,
        passFps ? null : `fps ${fps.toFixed(1)} < ${BUDGET.fps}`,
      ].filter(Boolean),
      screenshot: `tools/3d/shots/${variant}.png`,
      lookScreenshot: lookShot ? 'tools/3d/shots/warehouse-int-look-left.png' : null,
      errors,
    }
    if (!row.pass) failures.push(row)
    results.push(row)
    console.log(
      `  ${variant.padEnd(16)} ${String(row.fps).padStart(6)} fps  ${String(row.calls).padStart(3)} calls  ${String(row.tris).padStart(5)} tris  ${row.pass ? 'PASS' : 'FAIL'}`,
    )
  }

  // DPR 上限验证：deviceScaleFactor=3 时缓冲区仍应被夹在 2 倍
  const hidpi = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 3 })
  const hiPage = await hidpi.newPage()
  await hiPage.goto(`${pageUrl}?variant=bridge`, { waitUntil: 'load' })
  await waitReady(hiPage)
  await hiPage.waitForTimeout(600)
  const dprCheck = await hiPage.evaluate(() => {
    const el = document.querySelector('.scene3d canvas')
    if (!el) return null
    return {
      devicePixelRatio: window.devicePixelRatio,
      ratio: el.width / el.clientWidth,
    }
  })
  await hidpi.close()

  const summary = {
    when: new Date().toISOString(),
    url: pageUrl,
    viewport: `${VIEW.width}x${VIEW.height}`,
    headed,
    seconds,
    budget: BUDGET,
    gpu: results[0]?.gpu ?? 'unknown',
    slices: results,
    dprCap: dprCheck,
    dprCapPass: !!dprCheck && dprCheck.ratio <= 2.001,
    allPass: results.every((row) => row.pass) && !!dprCheck && dprCheck.ratio <= 2.001,
  }
  await writeFile(resolve(shotsDir, 'perf.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log('')
  console.log(`GPU：${summary.gpu}`)
  console.log(
    `DPR 上限：devicePixelRatio=${dprCheck?.devicePixelRatio ?? '?'} → 缓冲区 ${dprCheck?.ratio?.toFixed(2) ?? '?'}× ${summary.dprCapPass ? 'PASS' : 'FAIL'}`,
  )
  console.log(`截图：${shotsDir}`)
  console.log(`数据：${resolve(shotsDir, 'perf.json')}`)
  if (failures.length) {
    console.log('')
    console.log('未达标项：')
    for (const row of failures) console.log(`  - ${row.variant}: ${row.failures.join(' / ')}`)
  }

  await browser.close()
  return summary
}

let code = 0
try {
  const summary = await main()
  code = summary.allPass ? 0 : 1
} catch (error) {
  console.error(error)
  code = 2
} finally {
  stopServer()
}
process.exit(code)
