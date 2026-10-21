/**
 * 对 tools/3d/proto.html（独立验证页）逐个切片截图，用来把「场景内」和「切片本身」分开看。
 * 用法：node tools/3d/proto-shot.mjs [devServerUrl]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = (process.argv[2] ?? 'http://127.0.0.1:5199').replace(/\/$/, '')
const shots = path.join(here, 'shots/review')
await mkdir(shots, { recursive: true })

const VARIANTS = ['warehouse-int', 'warehouse-ext', 'rooftop', 'bridge', 'office-1947']
const browser = await chromium.launch({ channel: 'chrome' })
const results = []
for (const variant of VARIANTS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 200))
  })
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`)
  })
  await page.goto(`${base}/tools/3d/proto.html?variant=${variant}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__proto?.stats?.calls > 0, null, { timeout: 30000 })
  // warehouse-ext 要等 GLB 落地才算数
  if (variant === 'warehouse-ext') {
    await page.waitForFunction(
      () => {
        const host = document.querySelector('.scene3d')
        return host && ['ready', 'failed'].includes(host.dataset.glb)
      },
      null,
      { timeout: 30000 },
    )
  }
  await page.waitForTimeout(1500)
  const stats = await page.evaluate(() => ({
    calls: Number(document.querySelector('.scene3d')?.dataset.calls ?? 0),
    tris: Number(document.querySelector('.scene3d')?.dataset.tris ?? 0),
    glb: document.querySelector('.scene3d')?.dataset.glb ?? null,
    fps: Number(document.querySelector('.scene3d')?.dataset.fps ?? 0),
  }))
  await page.screenshot({ path: path.join(shots, `proto-${variant}.png`) })
  results.push({ variant, ...stats, errors })
  console.log(`${variant.padEnd(15)} calls=${String(stats.calls).padStart(3)} tris=${String(stats.tris).padStart(5)} glb=${stats.glb ?? '-'} fps=${stats.fps} errors=${errors.length}`)
  for (const error of errors) console.log(`   ! ${error}`)
  await page.close()
}
await browser.close()
