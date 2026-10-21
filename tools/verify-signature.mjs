import { chromium } from 'playwright'

/** 签名时刻真实接入验收：night1 灯下找名字、night3 升旗、epilogue 托盘。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const base = {
  ledger: { roster: 2, letters: 2, flag: 1, photo: 1, testimony: 2, message: 1 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 60000, finishedAt: null,
}
const errors = []
const browser = await chromium.launch({ channel: 'chrome' })
const results = []

async function openAt(sceneId) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: { ...base, sceneId } })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(2600)
  return page
}

{
  const page = await openAt('night1')
  const spot = await page.locator('.sig-spot').count()
  await page.getByRole('button', { name: '跳过（Esc）' }).click()
  await page.waitForTimeout(700)
  const gone = (await page.locator('.signature-overlay').count()) === 0
  const text = (await page.locator('.scene').innerText().catch(() => '')).length
  results.push({ name: 'night1 SpotlightFind', ok: spot > 0 && gone && text > 200, detail: `text=${text}` })
  await page.close()
}
{
  const page = await openAt('night3')
  const flag = await page.locator('.sig-flag').count()
  await page.getByRole('button', { name: '跳过（Esc）' }).click()
  await page.waitForTimeout(700)
  const gone = (await page.locator('.signature-overlay').count()) === 0
  results.push({ name: 'night3 FlagRaise', ok: flag > 0 && gone })
  await page.close()
}
{
  const page = await openAt('epilogue')
  const slots = await page.locator('.carry-slot').count()
  const legacy = await page.locator('.choices .choice').count()
  results.push({ name: 'epilogue CarryTray 九件', ok: slots === 9 && legacy === 0, detail: `slots=${slots}` })
  await page.close()
}

await browser.close()
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none')
if (results.some((r) => !r.ok) || errors.length) process.exitCode = 1
