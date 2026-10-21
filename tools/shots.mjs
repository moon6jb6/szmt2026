import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))
await mkdir(outDir, { recursive: true })

// 名册线：经过全部 12 个场景，最后到结局页
const route = [
  'p1', 'n1a', 'n1b-a', 'n2a', 'n2b-a', 'n3b', 'n3b-a', 'n4b', 'n4b-a', 'n5a', 'n5b-a', 'epi-roster',
]

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

const shots = []
const capture = async (name) => {
  await page.waitForTimeout(420)
  const file = `${String(shots.length).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: `${outDir}${file}` })
  shots.push(file)
  console.log('shot', file)
}

/** 等墨迹幕结束 */
const waitCurtain = async () => {
  await page.waitForTimeout(180)
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.ink-curtain')
        return !el || el.getAttribute('data-live') !== '1'
      },
      { timeout: 12000 },
    )
    .catch(() => {})
  await page.waitForTimeout(200)
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await capture('menu')

await page.getByRole('button', { name: '从头开始' }).click()
await waitCurtain()

let routeIndex = 0
let lastScene = null
let endingDone = false

for (let guard = 0; guard < 40; guard += 1) {
  if (await page.locator('.ending').isVisible().catch(() => false)) {
    await capture('ending')
    endingDone = true
    break
  }

  const sceneEl = page.locator('.scene')
  if (!(await sceneEl.isVisible().catch(() => false))) {
    await page.waitForTimeout(400)
    continue
  }

  const sceneId = await sceneEl.getAttribute('data-scene')
  if (sceneId && sceneId !== lastScene) {
    await capture(sceneId)
    lastScene = sceneId
  }

  const cont = page.locator('.continue')
  if (await cont.isVisible().catch(() => false)) {
    await cont.click()
    await waitCurtain()
    continue
  }

  const step = route[routeIndex]
  if (!step) break
  const choice = page.locator(`[data-choice="${step}"]`)
  if (await choice.isVisible().catch(() => false)) {
    await choice.click()
    routeIndex += 1
    await page.waitForTimeout(380)
  } else {
    console.log('choice not found:', step)
    break
  }
}

// 史料库页
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(600)
await capture('sources')

console.log('ending reached:', endingDone)
console.log('errors:', errors.length ? errors : 'none')
console.log('total shots:', shots.length)
await browser.close()
