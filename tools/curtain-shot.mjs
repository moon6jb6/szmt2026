import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)

await page.getByRole('button', { name: '从头开始' }).click()

// 墨迹幕 cover 阶段中段
await page.waitForTimeout(620)
await page.screenshot({ path: `${outDir}curtain-cover.png` })
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}curtain-hold.png` })
await page.waitForTimeout(900)
await page.screenshot({ path: `${outDir}curtain-reveal.png` })

console.log('curtain frames captured')
await browser.close()
