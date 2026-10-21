import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * 扩展页面冒烟测试：
 * 1. 人物志清单 10 条 → 点开第一篇 → 返回；
 * 2. 后来清单 15 条 → 点开第 15 篇 → 返回；
 * 3. 史料库打开并显示卡数；
 * 4. 场景插画：若 /art/ 有图，首屏应出现 figure.scene-image。
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
await page.waitForTimeout(300)

const report = {}

// 人物志
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(400)
report.peopleCards = await page.locator('.people-card').count()
await page.locator('.people-card').first().click()
await page.waitForTimeout(400)
report.peopleTitle = await page.locator('.person-reader h1').innerText()
report.peopleParagraphs = await page.locator('.person-reader .prose p').count()
await page.screenshot({ path: `${outDir}people-reader.png` })
await page.getByRole('button', { name: '返回人物志' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(300)

// 后来
await page.getByRole('button', { name: '后来' }).click()
await page.waitForTimeout(400)
report.laterCards = await page.locator('.people-card').count()
await page.locator('.people-card').last().click()
await page.waitForTimeout(400)
report.laterTitle = await page.locator('.person-reader h1').innerText()
await page.screenshot({ path: `${outDir}later-reader.png` })
await page.getByRole('button', { name: '返回「后来」' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(300)

// 史料库
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(400)
report.sourceGroups = await page.locator('.source-group').count()
report.sourceCards = await page.locator('.source-card, .source-entry, .chip').count()
await page.screenshot({ path: `${outDir}sources-library.png` })

// 开始游戏，看场景插画是否挂载
await page.getByRole('button', { name: '返回' }).click().catch(() => {})
await page.waitForTimeout(400)
await page.getByRole('button', { name: '从头开始' }).click().catch(() => {})
await page.waitForTimeout(2600)
report.sceneImage = await page.locator('.scene-image img').count()
if (report.sceneImage > 0) {
  await page
    .waitForFunction(() => {
      const img = document.querySelector('.scene-image img')
      return img && img.complete && img.naturalWidth > 0
    }, { timeout: 8000 })
    .catch(() => {})
  const natural = await page.locator('.scene-image img').first().evaluate((img) => img.naturalWidth)
  report.firstImageWidth = natural
}
await page.screenshot({ path: `${outDir}scene-with-art.png` })

console.log(JSON.stringify(report, null, 2))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (errors.length || report.peopleCards !== 10 || report.laterCards !== 15) process.exitCode = 1
