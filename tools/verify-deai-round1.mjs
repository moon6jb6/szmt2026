import { chromium } from 'playwright'

/** 去 AI 味第 1 轮验收：玩家可见文本里不再有网址/流程词/生硬句。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)

// 史料库：全部备注
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(1200)
const sourcesText = await page.locator('body').innerText()
const urls = (sourcesText.match(/https?:\/\//g) ?? []).length
const badWords = ['不臆测', 'confidence', 'not_found', 'accept 列', 'web.fetch', '逐字核得', '复合型虚构']
const hits = badWords.filter((w) => sourcesText.includes(w))
const entries = await page.locator('.source-entry').count()

// 场景脚注
const state = {
  sceneId: 'v0-01',
  ledger: { roster: 0, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 60000, finishedAt: null,
}
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2600)
const aside = await page.locator('.scene-aside').first().innerText().catch(() => '')
const asideBad = ['复合型虚构', '叙事重构', 'auto-', 's-'].filter((w) => aside.includes(w))
const bodyText = await page.locator('body').innerText()
const pageHits = badWords.filter((w) => bodyText.includes(w))

// 打开一张史料卡看备注
let note = ''
const chip = page.locator('.source-row button').first()
if (await chip.isVisible().catch(() => false)) {
  await chip.click()
  await page.waitForTimeout(700)
  note = await page.locator('.source-note').first().innerText().catch(() => '')
}
await page.keyboard.press('Escape')

console.log(JSON.stringify({ entries, urls, hits, aside, asideBad, pageHits, note: note.slice(0, 80), errors: errors.slice(0, 3) }, null, 2))
await browser.close()
const ok = entries > 40 && urls === 0 && hits.length === 0 && asideBad.length === 0 && pageHits.length === 0 && errors.length === 0
console.log(ok ? 'PASS: 第 1 轮去 AI 味验收通过' : 'FAIL')
if (!ok) process.exitCode = 1
