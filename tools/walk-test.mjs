import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * 全流程走路测试：从 v0-01 开始，每步选第一个选项 / 点继续，
 * 一直走到结局页。验证扩写后 140+ 场景的主链不断、无运行时报错。
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '从头开始' }).click()
await page.waitForTimeout(400)

const scenes = new Set()
let steps = 0
let endingTitle = ''
let struck = null
const started = Date.now()

for (let guard = 0; guard < 900; guard += 1) {
  if (await page.locator('.ending').isVisible().catch(() => false)) {
    endingTitle = await page.locator('.ending h1').innerText().catch(() => '')
    break
  }

  const sceneEl = page.locator('.scene')
  if (await sceneEl.isVisible().catch(() => false)) {
    const id = await sceneEl.getAttribute('data-scene')
    if (id) scenes.add(id)
    const count = await page.locator('.choice').count()
    const continueCount = await page.locator('.continue').count()
    if (count === 0 && continueCount === 0 && id) {
      // 无选项、无继续 = 死路
      struck = { scene: id, reason: 'no choices / no continue' }
      break
    }
  }

  const cont = page.locator('.continue')
  if (await cont.isVisible().catch(() => false)) {
    await cont.click()
    await page.waitForTimeout(160)
    steps += 1
    continue
  }

  const choice = page.locator('.choice').first()
  if (await choice.isVisible().catch(() => false)) {
    await choice.click()
    await page.waitForTimeout(160)
    steps += 1
    continue
  }

  await page.waitForTimeout(250)
}

await page.screenshot({ path: `${outDir}walk-ending.png` })
const seconds = Math.round((Date.now() - started) / 1000)
console.log('steps:', steps)
console.log('unique scenes visited:', scenes.size)
console.log('ending:', endingTitle || '(未到达结局)')
if (struck) console.log('struck:', JSON.stringify(struck))
console.log('elapsed seconds:', seconds)
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (!endingTitle) process.exitCode = 1
