import { chromium } from 'playwright'
import path from 'node:path'

/** 补拍 2：真正的墨幕 cover/hold、粒子多帧。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = process.argv[3] ?? 'D:/提交/截图素材'
const LEDGER_KEY = 'names-ledger-v1'
const UNLOCK_KEY = 'names-endings-v1'
const ALL_ENDINGS = ['roster', 'letters', 'flag', 'photo', 'testimony', 'message', 'archive', 'relics', 'wordofmouth']
const base = {
  ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 3_600_000, finishedAt: null,
}
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

async function makePage(p, state) {
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.evaluate(({ key, value, unlockKey, endings }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(unlockKey, JSON.stringify(endings))
  }, { key: LEDGER_KEY, value: state, unlockKey: UNLOCK_KEY, endings: ALL_ENDINGS })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.getByRole('button', { name: '继续上次' }).click()
  await p.waitForTimeout(2400)
}
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
  console.log('shot', name)
}

// 墨幕：先选选项变成结果页，再点「继续」触发换场
await makePage(page, { ...base, sceneId: 'v0-01' })
const choice = page.locator('.choice:visible').first()
if (await choice.isVisible().catch(() => false)) {
  await choice.click()
  await page.waitForTimeout(900)
}
const cont = page.locator('.continue:visible').first()
if (await cont.isVisible().catch(() => false)) {
  await page.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window)
    const t0 = performance.now()
    window.__origRaf = orig
    window.requestAnimationFrame = (cb) => orig((ts) => cb(t0 + (ts - t0) * 0.15))
  })
  await cont.click()
  await page.waitForTimeout(2600)
  await shot('ink-cover.png')
  await page.waitForTimeout(3800)
  await shot('ink-hold.png')
  await page.waitForTimeout(2500)
  await shot('ink-reveal.png')
  await page.evaluate(() => { if (window.__origRaf) window.requestAnimationFrame = window.__origRaf })
}

// 粒子多帧
for (const [id, label] of [['v4-05', 'roster'], ['v2-43', 'testimony'], ['v3-03', 'archive']]) {
  await makePage(page, { ...base, sceneId: id })
  const c = page.locator('.choice:visible').first()
  if (!(await c.isVisible().catch(() => false))) {
    console.log('no choice', id)
    continue
  }
  await c.click()
  for (const [i, delay] of [[1, 70], [2, 140], [3, 240], [4, 420]]) {
    await page.waitForTimeout(delay - (i > 1 ? [0, 70, 140, 240][i - 2] : 0))
    await shot(`particle3-${label}-${i}.png`)
  }
  await page.waitForTimeout(800)
}

await browser.close()
