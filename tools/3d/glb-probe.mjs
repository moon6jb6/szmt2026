/**
 * 跑 tools/3d/glb-probe.html，把体检结果与成片存下来。
 * 用法：node tools/3d/glb-probe.mjs [devServerUrl]   （默认 http://127.0.0.1:5199）
 * 需要 vite dev server（页面里是 `import 'three'` 裸模块）。
 */
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = (process.argv[2] ?? 'http://127.0.0.1:5199').replace(/\/$/, '')
const pageUrl = `${base}/tools/3d/glb-probe.html`
const shots = path.join(here, 'shots/review')
await mkdir(shots, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 300))
})
await page.goto(pageUrl, { waitUntil: 'load' })
await page.waitForFunction(() => window.__result?.stage === 'done', null, { timeout: 60000 })
const result = await page.evaluate(() => window.__result)
result.errors = errors
await page.screenshot({ path: path.join(shots, 'glb-probe.png') })
await writeFile(path.join(shots, 'glb-probe.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ counts: result.counts, materialLut: result.materialLut, grounded: result.grounded, zFight: result.zFight, errors }, null, 2))
await browser.close()
