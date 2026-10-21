import { chromium } from 'playwright'

/**
 * 六结局可达性测试（扩写后主线 140 场景）：
 * 每次清空存档，从 v0-01 一路选第一个选项走到 epilogue，
 * 在 epilogue 选择第 k 个结局选项，验证结局页可达且六个结局互不相同。
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})

const results = []
const started = Date.now()

for (let k = 0; k < 6; k += 1) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '从头开始' }).click()
  await page.waitForTimeout(300)

  let title = ''
  let usedEpilogueChoice = false
  for (let guard = 0; guard < 900; guard += 1) {
    if (await page.locator('.ending').isVisible().catch(() => false)) {
      title = (await page.locator('.ending h1').innerText().catch(() => '')).trim()
      break
    }
    const sceneId = await page.locator('.scene').getAttribute('data-scene').catch(() => null)
    const choices = page.locator('.choice')
    const count = await choices.count()
    if (sceneId === 'epilogue' && count > k) {
      try {
        await choices.nth(k).click({ timeout: 2500 })
      } catch {
        /* 墨迹幕换场时元素可能被 detach，重试下一轮 */
      }
      usedEpilogueChoice = true
      await page.waitForTimeout(220)
      continue
    }
    if (count > 0) {
      try {
        await choices.first().click({ timeout: 2500 })
      } catch {
        /* 同上 */
      }
      await page.waitForTimeout(160)
      continue
    }
    const cont = page.locator('.continue')
    if (await cont.isVisible().catch(() => false)) {
      try {
        await cont.click({ timeout: 2500 })
      } catch {
        /* 同上 */
      }
      await page.waitForTimeout(160)
      continue
    }
    await page.waitForTimeout(200)
  }
  results.push({ index: k + 1, title, usedEpilogueChoice })
  console.log(`route ${k + 1}: ${title || '(未到达)'} ${usedEpilogueChoice ? '' : '[警告：未走到 epilogue 选择]'}`)
}

const ok = results.every((item) => item.title) && new Set(results.map((item) => item.title)).size === 6
console.log('\nPASS:', ok ? '6/6' : 'FAIL')
console.log('endings:', results.map((item) => item.title).join(' / '))
console.log('elapsed seconds:', Math.round((Date.now() - started) / 1000))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (!ok || errors.length) process.exitCode = 1
