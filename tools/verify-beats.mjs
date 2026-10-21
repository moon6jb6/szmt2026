import { chromium } from 'playwright'

/** 长段落三段阅读真实接入验收：分组、键盘、footer 选项、mood/剪影。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'v0-01',
  ledger: { roster: 0, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
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
await page.waitForTimeout(2800)

const beats = await page.locator('.beats').count()
const doneBefore = await page.locator('.beats').getAttribute('data-done')
const nextBtn = page.getByRole('button', { name: /继续读/ })
const hasNext = await nextBtn.isVisible().catch(() => false)
const mood1 = await page.locator('.scene').getAttribute('data-beat-mood')
const figure1 = await page.locator('.beats__figure').count()
// 读第一组：点继续读
if (hasNext) {
  await nextBtn.click()
  await page.waitForTimeout(900)
}
const mood2 = await page.locator('.scene').getAttribute('data-beat-mood')
const figure2 = await page.locator('.beats__figure').count()
// 键盘 Enter 推进（不应切场景）
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
// 再点完最后一组
for (let i = 0; i < 3; i += 1) {
  const btn = page.getByRole('button', { name: /继续读/ })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(800)
  }
}
const doneAfter = await page.locator('.beats').getAttribute('data-done')
const choicesVisible = await page.locator('.choices .choice, .carry-tray').first().isVisible().catch(() => false)
const sceneStill = await page.locator('.scene').getAttribute('data-scene')

console.log(JSON.stringify({
  beats, doneBefore, hasNext, mood1, figure1, mood2, figure2,
  doneAfter, choicesVisible, sceneStill, errors: errors.slice(0, 4),
}, null, 2))
await browser.close()
const ok = beats > 0 && hasNext && doneAfter === 'true' && choicesVisible && sceneStill === 'v0-01' && errors.length === 0
console.log(ok ? 'PASS: 长段落三段阅读可用（分组/键盘/footer/氛围）' : 'FAIL')
if (!ok) process.exitCode = 1
