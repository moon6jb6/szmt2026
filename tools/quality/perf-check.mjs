/**
 * 首屏性能实测（无头 Chrome / Playwright），不改 src。
 *
 * 用法：node tools/quality/perf-check.mjs [url]
 *   url 默认 http://127.0.0.1:4173/（先 npm run preview -- --port 4173）
 * 输出：控制台表格 + tools/quality/perf.json + tools/quality/shots/perf-*.png
 *
 * 指标口径：
 *   FCP / LCP / CLS / TBT —— 页面内 PerformanceObserver（buffered）采集，等价 Lighthouse 口径
 *   菜单可用时刻 menuAt —— MutationObserver 看到 .menu .title 的 performance.now()，即「用户能读到首屏」的时刻
 *   4× CPU 限速 —— CDP Emulation.setCPUThrottlingRate，模拟中端笔记本/手机解析执行这段 845 kB 主包
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'tools/quality/shots')
mkdirSync(SHOTS, { recursive: true })

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/'
const NAV_TIMEOUT = 30000

const INIT = () => {
  const qa = (window.__qa = {
    lcp: 0,
    lcpEl: '',
    cls: 0,
    longTasks: [],
    paint: {},
    menuAt: 0,
    sceneAt: 0,
    errors: [],
  })
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      qa.lcp = e.startTime
      const el = e.element
      qa.lcpEl = el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}` : e.url || ''
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) qa.cls += e.value
  }).observe({ type: 'layout-shift', buffered: true })
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) qa.longTasks.push({ at: Math.round(e.startTime), dur: Math.round(e.duration) })
  }).observe({ type: 'longtask', buffered: true })
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) qa.paint[e.name] = Math.round(e.startTime)
  }).observe({ type: 'paint', buffered: true })
  const watch = () => {
    const mo = new MutationObserver(() => {
      if (!qa.menuAt && document.querySelector('.menu .title')) qa.menuAt = Math.round(performance.now())
      if (!qa.sceneAt && document.querySelector('.scene h1')) qa.sceneAt = Math.round(performance.now())
    })
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch)
  else watch()
}

const r2 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n)

async function collect(page) {
  return page.evaluate(() => {
    const qa = window.__qa
    const nav = performance.getEntriesByType('navigation')[0]
    const res = performance.getEntriesByType('resource').map((e) => ({
      name: e.name.split('/').slice(-1)[0],
      type: e.initiatorType,
      start: Math.round(e.startTime),
      dur: Math.round(e.duration),
      transfer: e.transferSize,
      encoded: e.encodedBodySize,
      decoded: e.decodedBodySize,
    }))
    const tbt = qa.longTasks.reduce((sum, t) => sum + Math.max(0, t.dur - 50), 0)
    return {
      fcp: qa.paint['first-contentful-paint'] ?? null,
      fp: qa.paint['first-paint'] ?? null,
      lcp: Math.round(qa.lcp),
      lcpEl: qa.lcpEl,
      cls: Math.round(qa.cls * 1000) / 1000,
      menuAt: qa.menuAt,
      tbt: Math.round(tbt),
      longTasks: qa.longTasks,
      ttfb: nav ? Math.round(nav.responseStart) : null,
      dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      legacy: performance.timing
        ? {
            navigationStart: performance.timing.navigationStart,
            firstPaint: performance.timing.responseStart - performance.timing.navigationStart,
            domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
            loadEnd: performance.timing.loadEventEnd - performance.timing.navigationStart,
          }
        : null,
      resources: res,
      transferTotal: res.reduce((sum, r) => sum + (r.transfer || 0), 0),
      jsDecoded: res.filter((r) => r.name.endsWith('.js')).reduce((sum, r) => sum + (r.decoded || 0), 0),
      heapMB: performance.memory ? Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
    }
  })
}

async function run({ label, viewport, cpuRate = 1, reducedMotion = 'no-preference', shots = [] }) {
  const context = await browser.newContext({
    viewport,
    reducedMotion,
    deviceScaleFactor: 1,
  })
  await context.addInitScript(INIT)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  let cdp = null
  if (cpuRate !== 1) {
    cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  }
  const t0 = Date.now()
  await page.goto(URL, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  await page.waitForTimeout(1500) // 等 LCP 稳定
  const data = await collect(page)
  data.label = label
  data.viewport = `${viewport.width}x${viewport.height}`
  data.cpuRate = cpuRate
  data.reducedMotion = reducedMotion
  data.wallClockNavMs = Date.now() - t0
  data.errors = errors

  for (const shot of shots) {
    await page.screenshot({ path: join(SHOTS, shot), fullPage: false })
  }

  // 进入第一屏：点「从头开始」，量幕布换场到正文出现的时间 + 这一屏新下载的图片量
  if (shots.length > 0) {
    const before = await page.evaluate(() => performance.getEntriesByType('resource').length)
    const start = Date.now()
    await page.evaluate(() => {
      window.__qa.sceneAt = 0
    })
    await page.getByRole('button', { name: '从头开始' }).click()
    await page.waitForSelector('.scene h1', { timeout: 15000 })
    const sceneDomMs = Date.now() - start
    await page.waitForTimeout(2600)
    const sceneAssets = await page.evaluate((from) => {
      const list = performance.getEntriesByType('resource').slice(from)
      return {
        count: list.length,
        bytes: list.reduce((sum, e) => sum + (e.transferSize || 0), 0),
        names: list.map((e) => `${e.name.split('/').slice(-1)[0]}:${e.transferSize}`),
      }
    }, before)
    data.firstScene = {
      sceneDomMs,
      sceneAt: await page.evaluate(() => window.__qa.sceneAt),
      sceneId: await page.locator('.scene').getAttribute('data-scene'),
      proseChars: (await page.locator('.scene .prose').innerText()).length,
      newAssets: sceneAssets,
    }
    if (shots.includes('perf-scene.png') === false) {
      await page.screenshot({ path: join(SHOTS, 'perf-scene.png') })
    }
  }

  if (cdp) await cdp.detach()
  await context.close()
  return data
}

const browser = await chromium.launch({ channel: 'chrome' })

const runs = []
// 1) 桌面冷启动 —— 3 次取中位数
for (let i = 0; i < 3; i += 1) {
  runs.push(
    await run({
      label: `desktop-cold-${i + 1}`,
      viewport: { width: 1440, height: 900 },
      shots: i === 0 ? ['perf-menu.png', 'perf-scene.png'] : [],
    }),
  )
}
// 2) 桌面 + 4× CPU 限速（模拟中端设备）—— 5 次取中位数（本机有后台负载，单次波动大）
for (let i = 0; i < 5; i += 1) {
  runs.push(await run({ label: `desktop-cpu4x-${i + 1}`, viewport: { width: 1440, height: 900 }, cpuRate: 4 }))
}
// 3) 移动端 390 + 4× CPU
runs.push(
  await run({
    label: 'mobile-390-cpu4x',
    viewport: { width: 390, height: 844 },
    cpuRate: 4,
    shots: ['perf-mobile-menu.png'],
  }),
)
// 4) 减少动效（桌面）
runs.push(
  await run({
    label: 'desktop-reduced-motion',
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    shots: ['perf-reduced-menu.png'],
  }),
)

await browser.close()

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const desktop = runs.filter((r) => r.label.startsWith('desktop-cold'))
const throttled = runs.filter((r) => r.label.startsWith('desktop-cpu4x'))
const withScene = runs.filter((r) => r.firstScene)
const pick = (list, key) => median(list.map((r) => r[key]))
const summary = {
  generatedAt: new Date().toISOString(),
  url: URL,
  chrome: browser.version?.() ?? 'Chrome (channel=chrome)',
  desktopCold: {
    fcp: median(desktop.map((r) => r.fcp)),
    lcp: median(desktop.map((r) => r.lcp)),
    menuAt: median(desktop.map((r) => r.menuAt)),
    dcl: median(desktop.map((r) => r.dcl)),
    load: median(desktop.map((r) => r.load)),
    tbt: median(desktop.map((r) => r.tbt)),
    cls: median(desktop.map((r) => r.cls)),
    jsDecodedKB: Math.round(median(desktop.map((r) => r.jsDecoded)) / 1000),
    heapMB: median(desktop.map((r) => r.heapMB)),
    firstSceneDomMs: withScene.length ? median(withScene.map((r) => r.firstScene.sceneDomMs)) : null,
  },
  desktopCpu4x: {
    runs: throttled.length,
    fcp: pick(throttled, 'fcp'),
    lcp: pick(throttled, 'lcp'),
    menuAt: pick(throttled, 'menuAt'),
    tbt: pick(throttled, 'tbt'),
    tbtRange: [Math.min(...throttled.map((r) => r.tbt)), Math.max(...throttled.map((r) => r.tbt))],
    longestTask: Math.max(...throttled.flatMap((r) => r.longTasks.map((t) => t.dur))),
  },
  runs,
}
writeFileSync(join(ROOT, 'tools/quality/perf.json'), JSON.stringify(summary, null, 2), 'utf8')

console.log('\n=== 首屏实测（无头 Chrome，本地 preview，无网络延迟）===')
console.log('场景'.padEnd(24), 'FCP'.padEnd(8), 'LCP'.padEnd(8), '菜单可读'.padEnd(10), 'DCL'.padEnd(8), 'TBT', 'JS解码KB', 'heapMB')
for (const r of runs) {
  console.log(
    r.label.padEnd(24),
    String(r.fcp).padEnd(8),
    String(r.lcp).padEnd(8),
    String(r.menuAt).padEnd(10),
    String(r.dcl).padEnd(8),
    String(r.tbt).padEnd(4),
    String(Math.round(r.jsDecoded / 1000)).padEnd(8),
    r.heapMB,
  )
}
console.log('\n桌面冷启动中位数：', JSON.stringify(summary.desktopCold))
console.log('\n资源时序（desktop-cold-1）:')
for (const res of runs[0].resources) {
  console.log(' ', res.name.padEnd(28), 'start', String(res.start).padStart(4), 'ms  dur', String(res.dur).padStart(4), 'ms  transfer', res.transfer, 'decoded', res.decoded)
}
console.log('\n第一屏（点「从头开始」→ 正文 DOM 就绪）:', runs[0].firstScene)
console.log('错误：', runs.map((r) => `${r.label}:${r.errors.length}`).join(' '))
console.log('JSON → tools/quality/perf.json\n')
