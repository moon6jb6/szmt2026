import { chromium } from 'playwright'

/**
 * 3D lazy chunk 拉取失败时的白屏回归测试：
 * 拦截 Scene3D-*.js → 点「3D 视角」→ 应用不应崩溃，正文应仍在，并自动回 2.5D。
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'night1',
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 60000, finishedAt: null,
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.route('**/Scene3D-*.js', (route) => route.abort('failed'))
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2000)

  // 第一夜签名覆盖层：测试先跳过，再进入原断言
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
  }

const toggle = page.getByRole('button', { name: '3D 视角' })
const canToggle = await toggle.isVisible().catch(() => false)
if (canToggle) await toggle.click()
await page.waitForTimeout(2500)

const sceneVisible = await page.locator('.scene').isVisible().catch(() => false)
const bodyText = (await page.locator('.scene').innerText().catch(() => '')).length
const buttonBack = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
const stage3d = await page.locator('.stage-3d').count()
const has3dHost = await page.locator('.scene3d').count()

console.log(JSON.stringify({
  canToggle,
  sceneVisible,
  textLength: bodyText,
  revertedTo25D: buttonBack && stage3d === 0 && has3dHost === 0,
  errors: errors.slice(0, 4),
}, null, 2))

await browser.close()
const ok = canToggle && sceneVisible && bodyText > 200 && buttonBack && stage3d === 0
console.log(ok ? 'PASS: chunk 失败不白屏，自动回 2.5D' : 'FAIL')
if (!ok) process.exitCode = 1
