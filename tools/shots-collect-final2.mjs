import { chromium } from 'playwright'
import path from 'node:path'

/** 定稿补拍：整页缩放后的实机整屏（含选项/史料 chip/3D 入口）+ 粒子特写。 */
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

async function makePage(state) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value, unlockKey, endings }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(unlockKey, JSON.stringify(endings))
  }, { key: LEDGER_KEY, value: state, unlockKey: UNLOCK_KEY, endings: ALL })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(2400)
}
async function beatThrough() {
  for (let i = 0; i < 6; i += 1) {
    const b = page.getByRole('button', { name: /继续读/ })
    if (!(await b.isVisible().catch(() => false))) break
    await b.click()
    await page.waitForTimeout(650)
  }
}
async function shotFile(name, options = {}) {
  await page.screenshot({ path: path.join(OUT, name), ...options })
  console.log('shot', name)
}

// 整页缩放：让标题、正文、选项、史料 chip 同屏
for (const [id, zoom] of [['v0-02', 0.8], ['v0-02', 0.72], ['v0-03', 0.8], ['v1-24', 0.75]]) {
  await makePage({ ...base, sceneId: id })
  await beatThrough()
  await page.addStyleTag({ content: `.stage-content { zoom: ${zoom}; }` })
  await page.waitForTimeout(700)
  await page.evaluate(() => document.querySelector('.stage-content')?.scrollTo(0, 0))
  await page.waitForTimeout(500)
  const choices = await page.locator('.choice:visible').count()
  const chips = await page.locator('.source-row button').count()
  console.log(id, zoom, { choices, chips })
  await shotFile(`slide7-zoom-${id}-${String(zoom).replace('.', '')}.png`)
}

// 粒子特写：慢放 + 以点击点为中心的裁切
for (const [id, tag] of [['v0-02', 'roster'], ['v2-44', 'testimony']]) {
  await makePage({ ...base, sceneId: id })
  await beatThrough()
  const choice = page.locator('.choice:visible').first()
  if (!(await choice.isVisible().catch(() => false))) continue
  const box = await choice.boundingBox()
  await page.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window)
    const t0 = performance.now()
    window.__origRaf = orig
    window.requestAnimationFrame = (cb) => orig((ts) => cb(t0 + (ts - t0) * 0.25))
  })
  await choice.click({ position: { x: 220, y: 22 } })
  for (const [delay, frame] of [[500, 'a'], [800, 'b'], [1100, 'c']]) {
    await page.waitForTimeout(delay)
    const cx = box ? box.x + 220 : 900
    const cy = box ? box.y + 22 : 700
    await shotFile(`particle5-${tag}-${frame}.png`, {
      clip: { x: Math.max(0, cx - 330), y: Math.max(0, cy - 190), width: 660, height: 380 },
    })
  }
  await page.evaluate(() => { if (window.__origRaf) window.requestAnimationFrame = window.__origRaf })
}

await browser.close()
