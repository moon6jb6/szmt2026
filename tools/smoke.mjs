import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}${name}.png` })
  console.log('shot', name)
}

await shot('01-menu')

const menuText = await page.locator('body').innerText()
console.log('menu has title:', menuText.includes('把名字留下来'))

await page.getByRole('button', { name: '从头开始' }).click()
await page.waitForTimeout(900)
await shot('02-prologue')

// 走一遍第一条分支，验证状态机
for (let i = 0; i < 8; i += 1) {
  const choice = page.locator('.choice').first()
  if (await choice.isVisible().catch(() => false)) {
    await choice.click()
    await page.waitForTimeout(450)
    const cont = page.locator('.continue')
    if (await cont.isVisible().catch(() => false)) {
      await cont.click()
      await page.waitForTimeout(650)
    }
  } else {
    const cont = page.locator('.continue')
    if (await cont.isVisible().catch(() => false)) {
      await cont.click()
      await page.waitForTimeout(650)
    }
  }
}

await shot('03-after-flow')

// 检查是否走到结局
const bodyText = await page.locator('body').innerText()
console.log('reached ending:', bodyText.includes('还有一百多个名字'))
console.log('body sample:', bodyText.slice(0, 160).replace(/\n/g, ' | '))

console.log('errors:', errors.length ? errors : 'none')
await browser.close()
