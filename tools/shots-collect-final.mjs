import { chromium } from 'playwright'
import path from 'node:path'

/** 定稿候选：v0-02（1947 厢房，有 3D + 名册选项）用于实机整屏；粒子用慢放抓。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = process.argv[3] ?? 'D:/提交/截图素材'
const LEDGER_KEY = 'names-ledger-v1'
const UNLOCK_KEY = 'names-endings-v1'
const ALL = ['roster', 'letters', 'flag', 'photo', 'testimony', 'message', 'archive', 'relics', 'wordofmouth']
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
  }, { key: LEDGER_KEY, value: state, unlockKey: UNLOCK_KEY, endings: ALL })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.getByRole('button', { name: '继续上次' }).click()
  await p.waitForTimeout(2400)
}
async function beatThrough(p) {
  for (let i = 0; i < 6; i += 1) {
    const b = p.getByRole('button', { name: /继续读/ })
    if (!(await b.isVisible().catch(() => false))) break
    await b.click()
    await p.waitForTimeout(700)
  }
}
async function shot(p, name) {
  await p.screenshot({ path: path.join(OUT, name) })
  console.log('shot', name)
}

// 候选场景信息
for (const id of ['v0-02', 'v0-03', 'v1-24', 'v2-44']) {
  await makePage(page, { ...base, sceneId: id })
  await beatThrough(page)
  const choices = await page.locator('.choice:visible').count()
  const chips = await page.locator('.source-row button').count()
  const threeD = await page.getByRole('button', { name: /3D 视角|回到 2.5D/ }).isVisible().catch(() => false)
  console.log(id, { choices, chips, threeD })
  if (choices > 0 && threeD) {
    await page.evaluate(() => document.querySelector('.stage-content')?.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await shot(page, `slide7-cand-${id}-top.png`)
    await page.evaluate(() => {
      const el = document.querySelector('.stage-content')
      if (el) el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(600)
    await shot(page, `slide7-cand-${id}-bottom.png`)
  }
}

// 粒子慢放：v0-02 的选项
await makePage(page, { ...base, sceneId: 'v0-02' })
await beatThrough(page)
const rosterChoice = page.locator('.choice:visible').first()
if (await rosterChoice.isVisible().catch(() => false)) {
  await page.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window)
    const t0 = performance.now()
    window.__origRaf = orig
    window.requestAnimationFrame = (cb) => orig((ts) => cb(t0 + (ts - t0) * 0.2))
  })
  await rosterChoice.click()
  for (const [delay, tag] of [[700, 'a'], [900, 'b'], [1200, 'c'], [1600, 'd']]) {
    await page.waitForTimeout(delay)
    await shot(page, `particle4-roster-slow-${tag}.png`)
  }
  await page.evaluate(() => { if (window.__origRaf) window.requestAnimationFrame = window.__origRaf })
}

await browser.close()
