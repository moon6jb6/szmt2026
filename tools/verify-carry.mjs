import { chromium } from 'playwright'

/** 尾声 CarryTray 真实接入验收（preview 构建）。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'epilogue',
  ledger: { roster: 2, letters: 2, flag: 1, photo: 1, testimony: 2, message: 1 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 60000, finishedAt: null,
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2600)

const slots = await page.locator('.carry-slot').count()
const legacy = await page.locator('.choices .choice').count()
await page.keyboard.press('1')
await page.waitForTimeout(300)
const selected = await page.locator('[data-selected="true"], [aria-pressed="true"]').count()
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
const outcomeVisible = await page.locator('.continue').isVisible().catch(() => false)
if (outcomeVisible) {
  await page.locator('.continue').click()
  await page.waitForTimeout(5200)
}
const endingVisible = await page.locator('.ending').isVisible().catch(() => false)
const endingTitle = endingVisible ? await page.locator('.ending h1').innerText().catch(() => '') : ''

console.log(JSON.stringify({ slots, legacy, selected, outcomeVisible, endingVisible, endingTitle, errors: errors.slice(0, 4) }, null, 2))
await browser.close()
const ok = slots === 9 && legacy === 0 && selected >= 1 && outcomeVisible && endingVisible && errors.length === 0
console.log(ok ? 'PASS: CarryTray 已接入尾声，键盘可交付并到达结局' : 'FAIL')
if (!ok) process.exitCode = 1
