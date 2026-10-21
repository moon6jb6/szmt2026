import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const logs = []
page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`))
page.on('pageerror', (error) => logs.push(`pageerror: ${error}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${outDir}17-sources-v2.png`, fullPage: false })
await page.screenshot({ path: `${outDir}18-sources-v2-full.png`, fullPage: true })

console.log('--- validation logs ---')
for (const line of logs.filter((item) => item.includes('史料卡校验'))) console.log(line)
console.log('--- errors ---')
for (const line of logs.filter((item) => item.includes('pageerror'))) console.log(line)

const text = await page.locator('.sources-page').innerText()
console.log('coverage line:', text.split('\n').find((line) => line.includes('当前')) ?? '(none)')
console.log('has needed section:', text.includes('待接入文献'))
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log('horizontal overflow:', overflow)
await browser.close()
