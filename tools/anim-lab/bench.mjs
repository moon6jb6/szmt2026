/**
 * tools/anim-lab/bench.mjs
 *
 * 用真实 Chromium 跑 anim-lab 的两个 demo，取真实帧率数据。
 * 不入 src、不改 package.json，纯研究用。
 *
 * 用法：
 *   node tools/anim-lab/bench.mjs                 # 无头，默认
 *   node tools/anim-lab/bench.mjs --headed        # 有头（走真实 GPU 合成，数字更接近真机）
 *   node tools/anim-lab/bench.mjs --cpu=4         # 4 倍 CPU 降频，看最差情况
 *   node tools/anim-lab/bench.mjs --only=02       # 只跑一个 demo
 *
 * 注意：无头 Chromium 的合成器是软件光栅（SwiftShader），
 * 帧率绝对值会偏低，请当作「相对比较」而不是真机绝对值。
 * 报告里的数字同时给了 --headed 与无头两组。
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const headed = args.includes('--headed')
const cpuArg = args.find((a) => a.startsWith('--cpu='))
const onlyArg = args.find((a) => a.startsWith('--only='))
const cpuRate = cpuArg ? Number(cpuArg.split('=')[1]) : 1
const only = onlyArg ? onlyArg.split('=')[1] : null

const DEMOS = [
  { id: '01', file: '01-ink-transition.html', param: '?bench=4', timeout: 90_000 },
  { id: '02', file: '02-parallax-stage.html', param: '?bench=1&ms=3200', timeout: 90_000 },
].filter((d) => !only || d.id === only)

function gzipSize(file) {
  const buf = readFileSync(join(here, file))
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length }
}

const browser = await chromium.launch({
  headless: !headed,
  args: ['--force-color-profile=srgb', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})

const out = {
  meta: {
    headed,
    cpuThrottle: cpuRate,
    chromiumVersion: browser.version(),
    nodeVersion: process.version,
    ranAt: new Date().toISOString(),
  },
  demos: {},
}

for (const demo of DEMOS) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  })
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  const cdp = await page.context().newCDPSession(page)
  if (cpuRate > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  }

  const url = pathToFileURL(join(here, demo.file)).href + demo.param
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__report !== undefined, null, { timeout: demo.timeout })
  const report = await page.evaluate(() => window.__report)

  out.demos[demo.id] = {
    file: demo.file,
    url: demo.param,
    wallMs: Date.now() - t0,
    size: gzipSize(demo.file),
    report,
    errors: consoleErrors,
  }
  await page.close()
}

await browser.close()
console.log(JSON.stringify(out, null, 2))
