import { chromium } from 'playwright'

/** 回顶修复验证：换场/换页/开卡回顶。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'v0-01',
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 60000, finishedAt: null,
}
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const stageTop = () => page.evaluate(() => document.querySelector('.stage-content')?.scrollTop ?? -1)
const winTop = () => page.evaluate(() => window.scrollY)

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2600)
await page.evaluate(() => { const el = document.querySelector('.stage-content'); if (el) el.scrollTop = el.scrollHeight })
await page.waitForTimeout(300)
const scrolled = await stageTop()
const choice = page.locator('.choice').first()
if (await choice.isVisible().catch(() => false)) {
  await choice.click()
  await page.waitForTimeout(1200)
}
check('场景滚到底', scrolled > 200, `${scrolled}`)
check('选择后结果回顶', (await stageTop()) < 80, `${await stageTop()}`)
const cont = page.locator('.continue')
if (await cont.isVisible().catch(() => false)) {
  await page.evaluate(() => { const el = document.querySelector('.stage-content'); if (el) el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(250)
  await cont.click()
  await page.waitForTimeout(2800)
}
check('换场后回顶', (await stageTop()) < 80, `${await stageTop()}`)

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(1300)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(600)
const peopleScrolled = await winTop()
await page.locator('.people-card').first().click().catch(() => {})
await page.waitForTimeout(900)
check('人物志可滚动', peopleScrolled > 200, `${peopleScrolled}`)
check('点开人物卡后回顶', (await winTop()) < 80, `${await winTop()}`)
const back = page.getByRole('button', { name: '返回' })
if (await back.isVisible().catch(() => false)) await back.click()
await page.waitForTimeout(700)
check('返回后回顶', (await winTop()) < 80, `${await winTop()}`)

await browser.close()
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none')
if (results.some((r) => !r.ok) || errors.length) process.exitCode = 1
