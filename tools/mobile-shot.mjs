import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.screenshot({ path: `${outDir}15-mobile-menu.png`, fullPage: false })
await page.getByRole('button', { name: '从头开始' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${outDir}16-mobile-scene.png`, fullPage: false })

// 检查横向溢出
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log('horizontal overflow px:', overflow)
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
