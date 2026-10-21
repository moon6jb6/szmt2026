import { chromium } from 'playwright'

/**
 * 减少动效 / 紧凑视口下的降级验证：
 * - prefers-reduced-motion: reduce → 不出现 3D 按钮、粒子与转场降级，流程仍可走；
 * - 390px 移动端 → 不出现 3D 按钮，正文可读。
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'night1',
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60000,
  finishedAt: null,
}

const browser = await chromium.launch({ channel: 'chrome' })

async function runReducedMotion() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(1500)

  // 第一夜签名覆盖层：测试先跳过，再进入原断言
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
  }
  const toggle3d = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
  const sceneVisible = await page.locator('.scene').isVisible().catch(() => false)
  // 走一步，确认流程不被动效降级打断
  const hasChoice = await page.locator('.choice').first().isVisible().catch(() => false)
  if (hasChoice) {
    await page.locator('.choice').first().click()
    await page.waitForTimeout(800)
  }
  console.log('reduced-motion → scene visible:', sceneVisible, '| 3D toggle (expect false):', toggle3d, '| choice clicked:', hasChoice, '| errors:', errors.length ? errors.slice(0, 3) : 'none')
  await page.screenshot({ path: 'tools/shots/reduced-motion.png' })
  await context.close()
  return errors.length === 0 && !toggle3d && sceneVisible
}

async function runMobile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(1600)

  // 第一夜签名覆盖层：测试先跳过，再进入原断言
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
  }
  const toggle3d = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
  const textLength = (await page.locator('.scene').innerText().catch(() => '')).length
  console.log('mobile 390 → 3D toggle (expect false):', toggle3d, '| scene text length:', textLength)
  await page.screenshot({ path: 'tools/shots/mobile-reduced.png' })
  await context.close()
  return !toggle3d && textLength > 100
}

const okReduced = await runReducedMotion()
const okMobile = await runMobile()
await browser.close()
console.log('PASS:', okReduced && okMobile ? 'ok' : 'FAIL')
if (!okReduced || !okMobile) process.exitCode = 1
