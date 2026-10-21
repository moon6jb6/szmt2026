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
await page.waitForTimeout(2200)

/** 换场幕可能盖住按钮：点击失败就等一会重试，最多 3 次，再不行 force */
async function safeClick(locator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await locator.click({ timeout: 2500 })
      return true
    } catch {
      await page.waitForTimeout(400)
    }
  }
  try {
    await locator.click({ force: true, timeout: 1500 })
    return true
  } catch {
    return false
  }
}

const scenes = new Set()
let steps = 0
let endingTitle = ''
let struck = null
const started = Date.now()

for (let guard = 0; guard < 900; guard += 1) {
  // 签名时刻覆盖层：走测试统一跳过
  const sigOverlay = page.locator('.signature-overlay')
  if (await sigOverlay.isVisible().catch(() => false)) {
    const skip = page.getByRole('button', { name: '跳过（Esc）' })
    if (await skip.isVisible().catch(() => false)) {
      await skip.click()
      await page.waitForTimeout(500)
    }
    continue
  }
  if (await page.locator('.ending').isVisible().catch(() => false)) {
    endingTitle = await page.locator('.ending h1').innerText().catch(() => '')
    break
  }

  const sceneEl = page.locator('.scene')
  if (await sceneEl.isVisible().catch(() => false)) {
    const id = await sceneEl.getAttribute('data-scene')
    if (id) scenes.add(id)
    let count = await page.locator('.choice').count()
    let continueCount = await page.locator('.continue').count()
    // 换场幕/入场动画期间 DOM 可能还没长出按钮：给最多 1.8s，别误判死路
    for (let retry = 0; retry < 6 && count === 0 && continueCount === 0; retry += 1) {
      await page.waitForTimeout(300)
      count = await page.locator('.choice').count()
      continueCount = await page.locator('.continue').count()
    }
    const hasTray = await page.locator('.carry-tray').isVisible().catch(() => false)
    if (count === 0 && continueCount === 0 && !hasTray && id) {
      // 无选项、无继续 = 死路
      struck = { scene: id, reason: 'no choices / no continue' }
      break
    }
  }

  // 尾声：CarryTray 桌上 9 件实物（选第一件 + 交出去）
  const tray = page.locator('.carry-tray')
  if (await tray.isVisible().catch(() => false)) {
    const trayItem = page.locator('button[aria-label*="结局："]').first()
    if (await trayItem.isVisible().catch(() => false)) {
      await trayItem.click()
      await page.waitForTimeout(350)
      const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()
      if (await commit.isVisible().catch(() => false)) await commit.click()
      await page.waitForTimeout(600)
      steps += 1
      continue
    }
  }

  const cont = page.locator('.continue')
  if (await cont.isVisible().catch(() => false)) {
    await safeClick(cont)
    await page.waitForTimeout(180)
    steps += 1
    continue
  }

  const choice = page.locator('.choice').first()
  if (await choice.isVisible().catch(() => false)) {
    await safeClick(choice)
    await page.waitForTimeout(180)
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
