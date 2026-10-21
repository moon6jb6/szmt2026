import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 3D 切片集成测试（App 内真实链路，不是验证页）
 *
 * 用法：
 *   node tools/test-3d.mjs [url] [sceneId] [--out <dir>]
 *   例：node tools/test-3d.mjs http://127.0.0.1:4173/ night1
 *
 * 验证：
 *  - 桌面：注入存档 → 点「继续上次」→ 点「3D 视角」→ 等首帧 → 采样 fps / draw calls / 三角面 → 截图
 *  - 首帧时延：点击时刻（页面内 performance.now）→ Scene3D 写入 data-ready 的时刻
 *  - GLB：记录网络状态码 / 传输字节 / 是否来自缓存（warehouse-ext 切片）
 *  - 回 2.5D：.scene3d 必须消失、canvas 归零、正文仍在
 *  - 二次进入：再点一次「3D 视角」，记录第二次首帧时延，判断是否重复加载
 *  - 移动端 390px：不应出现 3D 按钮（回退 2.5D）
 *
 * 产出：tools/3d/shots/review/ 下截图 + 同名 .json 指标；任一断言失败 exitCode=1
 */
const argv = process.argv.slice(2)
const flags = argv.filter((item) => item.startsWith('--'))
const positional = argv.filter((item) => !item.startsWith('--'))
const outIndex = argv.indexOf('--out')
const OUT_ARG = outIndex >= 0 ? argv[outIndex + 1] : null

const url = positional[0] ?? 'http://127.0.0.1:4173/'
const sceneId = positional[1] ?? 'night1'
const OUT = path.resolve(
  OUT_ARG ? path.resolve(OUT_ARG) : path.join(fileURLToPath(new URL('./3d/shots/review/', import.meta.url))),
)
await mkdir(OUT, { recursive: true })

const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId,
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60000,
  finishedAt: null,
}

const result = {
  when: new Date().toISOString(),
  url,
  sceneId,
  outDir: path.relative(path.resolve(fileURLToPath(new URL('../', import.meta.url))), OUT).replace(/\\/g, '/'),
  desktop: {
    toggleVisible: false,
    mounted: false,
    firstFrameMs: null,
    secondMountMs: null,
    metrics: null,
    canvas: null,
    glb: null,
    yawMoved: null,
    backTo25d: null,
  },
  mobile: { toggleVisible: null, threeDCanvas: null },
  errors: [],
  shots: [],
  pass: false,
}

const shot = async (page, name) => {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file })
  result.shots.push(path.relative(path.resolve(fileURLToPath(new URL('../', import.meta.url))), file).replace(/\\/g, '/'))
  return file
}

/** 页面内 rAF 计数（不依赖组件自报，避免自欺） */
const measureFps = (page, ms) =>
  page.evaluate(
    (span) =>
      new Promise((done) => {
        let frames = 0
        const started = performance.now()
        const tick = () => {
          frames += 1
          const elapsed = performance.now() - started
          if (elapsed < span) requestAnimationFrame(tick)
          else done(Number((frames / (elapsed / 1000)).toFixed(1)))
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )

const readStats = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('.scene3d')
    if (!host) return null
    const canvas = host.querySelector('canvas')
    return {
      fps: Number(host.dataset.fps ?? 0),
      calls: Number(host.dataset.calls ?? 0),
      tris: Number(host.dataset.tris ?? 0),
      glb: host.dataset.glb ?? null,
      variant: host.dataset.variant ?? null,
      mounted: Number(host.dataset.mounted ?? 0),
      ready: Number(host.dataset.ready ?? 0),
      gl: host.dataset.gl ?? null,
      dpr: Number(window.devicePixelRatio || 1),
      buffer: canvas ? { width: canvas.width, height: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight } : null,
      canvasesInPage: document.querySelectorAll('canvas').length,
    }
  })

const browser = await chromium.launch({ channel: 'chrome' })
const errors = []
const glbResponses = []

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

// 用 CDP 的 Network 事件判断「真的走了网络」还是「内存/磁盘缓存」
let glbRequests = 0
const cdp = await page.context().newCDPSession(page)
await cdp.send('Network.enable')
const glbById = new Map()
cdp.on('Network.responseReceived', (event) => {
  if (!event.response.url.includes('.glb')) return
  glbById.set(event.requestId, event.response)
})
cdp.on('Network.loadingFinished', (event) => {
  const response = glbById.get(event.requestId)
  if (!response) return
  glbResponses.push({
    url: new URL(response.url).pathname,
    status: response.status,
    mime: response.mimeType,
    encodedBytes: event.encodedDataLength,
    fromDiskCache: Boolean(response.fromDiskCache),
    fromMemoryCache: Boolean(response.fromMemoryCache) || response.fromPrefetchCache === true,
  })
})
cdp.on('Network.requestWillBeSent', (event) => {
  if (event.request.url.includes('.glb')) glbRequests += 1
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2200)

  // 第一夜签名覆盖层：测试先跳过，再进入原断言
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
  }
// 基线 canvas 数（Particles / ChoiceBurst / InkCurtain 各自一张）：在「已进场景、未进 3D」时取，
// 否则菜单页和场景页的 canvas 数本来就不同，回退断言会误报
const baselineCanvases = await page.evaluate(() => document.querySelectorAll('canvas').length)

const toggle = page.getByRole('button', { name: '3D 视角' })
const hasToggle = await toggle.isVisible().catch(() => false)
result.desktop.toggleVisible = hasToggle
result.desktop.baselineCanvases = baselineCanvases
console.log('desktop toggle visible:', hasToggle, 'baseline canvases:', baselineCanvases)

if (hasToggle) {
  // 在页面内点击并打点：避免 CDP 往返误差污染「首帧时延」
  const t0 = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('3D 视角'))
    if (!button) return -1
    window.__click3d = performance.now()
    button.click()
    return window.__click3d
  })
  await page.waitForFunction(() => {
    const host = document.querySelector('.scene3d')
    return host && Number(host.dataset.ready ?? 0) > 0
  }, null, { timeout: 20000 })
  // 等两轮自报（≥0.5s）后再采样
  await page.waitForTimeout(1800)
  result.desktop.mounted = true
  const stats = await readStats(page)
  result.desktop.firstFrameMs = stats ? Number((stats.ready - t0).toFixed(0)) : null
  result.desktop.mountChunkMs = stats ? Number((stats.mounted - t0).toFixed(0)) : null
  result.desktop.glInitMs = stats ? Number((stats.ready - stats.mounted).toFixed(0)) : null
  result.desktop.gl = stats?.gl ?? null
  result.desktop.canvas = stats?.buffer ?? null
  result.desktop.glb = stats?.glb ?? null
  const fps = await measureFps(page, 2500)
  const stats2 = await readStats(page)
  result.desktop.metrics = {
    fpsMeasured: fps,
    fpsSelfReported: stats2?.fps ?? 0,
    calls: stats2?.calls ?? 0,
    tris: stats2?.tris ?? 0,
    variant: stats2?.variant ?? null,
    dpr: stats2?.dpr ?? 1,
    canvasesInPage: stats2?.canvasesInPage ?? 0,
  }
  console.log('3D metrics:', result.desktop.metrics)
  console.log('firstFrame:', result.desktop.firstFrameMs, 'ms (chunk', result.desktop.mountChunkMs, '+ gl', result.desktop.glInitMs, ') glb:', result.desktop.glb)
  await shot(page, `3d-${sceneId}.png`)

  // 净画面：把正文卡片藏掉再截一次，才能看清朝向 / 构图 / 落地（只改测试里的 DOM，不动源码）
  await page.evaluate(() => {
    const content = document.querySelector('.stage-content')
    if (content) content.style.visibility = 'hidden'
    const hint = document.querySelector('.scene-3d-hint')
    if (hint) hint.style.visibility = 'hidden'
  })
  await page.waitForTimeout(600)
  await shot(page, `3d-${sceneId}-plate.png`)
  await page.evaluate(() => {
    const content = document.querySelector('.stage-content')
    if (content) content.style.visibility = ''
    const hint = document.querySelector('.scene-3d-hint')
    if (hint) hint.style.visibility = ''
  })

  // 拖动/移动改变视角：左右两端各一张，用于证明 yaw 真的动且被夹住
  await page.mouse.move(30, 500)
  await page.waitForTimeout(900)
  await shot(page, `3d-${sceneId}-left.png`)
  await page.mouse.move(1570, 400)
  await page.waitForTimeout(900)
  await shot(page, `3d-${sceneId}-right.png`)

  // 回 2.5D
  await page.getByRole('button', { name: '回到 2.5D' }).click()
  await page.waitForTimeout(900)
  result.desktop.backTo25d = await page.evaluate(() => ({
    scene3dGone: !document.querySelector('.scene3d'),
    canvases: document.querySelectorAll('canvas').length,
    sceneBody: Boolean(document.querySelector('.scene-body')),
    sceneImage: Boolean(document.querySelector('.scene-image img')),
  }))
  console.log('back to 2.5D:', result.desktop.backTo25d)

  // 二次进入：验证是否重复加载 / 首帧是否退化
  const requestsBefore = glbRequests
  const t1 = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('3D 视角'))
    if (!button) return -1
    button.click()
    return performance.now()
  })
  await page.waitForFunction(() => {
    const host = document.querySelector('.scene3d')
    return host && Number(host.dataset.ready ?? 0) > 0
  }, null, { timeout: 20000 })
  const stats3 = await readStats(page)
  result.desktop.secondMountMs = stats3 ? Number((stats3.ready - t1).toFixed(0)) : null
  result.desktop.secondMountMetrics = { calls: stats3?.calls ?? 0, tris: stats3?.tris ?? 0 }
  result.desktop.glbRequestsOnSecondMount = glbRequests - requestsBefore
  console.log('second mount firstFrameMs:', result.desktop.secondMountMs, 'glb requests:', result.desktop.glbRequestsOnSecondMount)
  await shot(page, `3d-${sceneId}-second-mount.png`)
}

// 移动端：不应显示 3D 按钮
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('pageerror', (e) => errors.push(`[mobile] ${String(e)}`))
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(400)
await mobile.getByRole('button', { name: '继续上次' }).click()
await mobile.waitForTimeout(2000)
  if (await mobile.locator('.signature-overlay').isVisible().catch(() => false)) {
    await mobile.keyboard.press('Escape')
    await mobile.waitForTimeout(900)
  }
result.mobile.toggleVisible = await mobile.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
result.mobile.threeDCanvas = await mobile.evaluate(() => document.querySelectorAll('canvas').length)
console.log('mobile 3D toggle visible (expect false):', result.mobile.toggleVisible)
await shot(mobile, `mobile-2.5d-${sceneId}.png`)

result.errors = errors.slice(0, 10)
result.glbResponses = glbResponses
console.log('glb responses:', JSON.stringify(glbResponses))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')

// 断言：入口存在、真的挂上、无控制台/页面错误、回退干净、GLB（若有）200
const glbOk = glbResponses.every((r) => r.status === 200)
const back = result.desktop.backTo25d
const backOk = back ? back.scene3dGone && back.canvases === baselineCanvases : true
result.pass =
  hasToggle &&
  result.desktop.mounted &&
  errors.length === 0 &&
  glbOk &&
  backOk &&
  result.mobile.toggleVisible === false
if (!backOk) console.log('fallback assert failed:', back, 'baseline', baselineCanvases)

await writeFile(path.join(OUT, `3d-${sceneId}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log('pass:', result.pass)
await browser.close()
if (!result.pass) process.exitCode = 1
