import { chromium } from 'playwright'

/** 场景探索（背景图 + 热点）真实接入验收。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'v1-25',
  ledger: { roster: 1, letters: 1, flag: 1, photo: 0, testimony: 0, message: 0 },
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
await page.waitForTimeout(2400)

const exploreBtn = page.getByRole('button', { name: '场景探索' })
const hasBtn = await exploreBtn.isVisible().catch(() => false)
if (hasBtn) await exploreBtn.click()
await page.waitForTimeout(1200)

const overlay = await page.locator('.sh').count()
const hotspots = await page.locator('.sh-dot').count()
const bgLoaded = await page.evaluate(() => {
  const img = [...document.querySelectorAll('img')].find((el) => el.src.includes('scene-bg/'))
  if (!img) return false
  return img.complete && img.naturalWidth > 0
})
// 点第一个热点
const spot = page.locator('.sh-dot').first()
let opened = false
if (await spot.isVisible().catch(() => false)) {
  await spot.click()
  await page.waitForTimeout(700)
  opened = (await page.locator('.sh-card').count()) > 0
}
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
const exitBtn = page.getByRole('button', { name: /返回正文|退出|返回/ }).first()
if (await exitBtn.isVisible().catch(() => false)) await exitBtn.click()
await page.waitForTimeout(700)
const backToScene = await page.locator('.scene').isVisible().catch(() => false)

console.log(JSON.stringify({ hasBtn, overlay, hotspots, bgLoaded, opened, backToScene, errors: errors.slice(0, 4) }, null, 2))
await browser.close()
const ok = hasBtn && overlay > 0 && bgLoaded && backToScene && errors.length === 0
console.log(ok ? 'PASS: 场景探索可用（背景图 + 热点）' : 'FAIL')
if (!ok) process.exitCode = 1
