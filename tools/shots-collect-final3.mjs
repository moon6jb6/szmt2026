import { chromium } from 'playwright'
import path from 'node:path'

/** 定稿补拍 3：2x 清晰整屏（幻灯片 7）+ 无文字的粒子特写（幻灯片 8 帧 3）。 */
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

async function run(dsf) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dsf })
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
  async function shot(name, options = {}) {
    await page.screenshot({ path: path.join(OUT, name), ...options })
    console.log('shot', name, dsf)
  }

  // 幻灯片 7：2x 清晰整屏
  await makePage({ ...base, sceneId: 'v0-03' })
  await beatThrough()
  await page.addStyleTag({ content: '.stage-content { zoom: 0.8; }' })
  await page.waitForTimeout(700)
  await page.evaluate(() => document.querySelector('.stage-content')?.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await shot('slide7-2x-v0-03.png')
  await makePage({ ...base, sceneId: 'v0-02' })
  await beatThrough()
  await page.addStyleTag({ content: '.stage-content { zoom: 0.8; }' })
  await page.waitForTimeout(700)
  await page.evaluate(() => document.querySelector('.stage-content')?.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await shot('slide7-2x-v0-02.png')

  // 粒子特写：只截选项上方的深色区域，不带正文
  for (const [id, tag] of [['v2-44', 'testimony'], ['v0-02', 'roster']]) {
    await makePage({ ...base, sceneId: id })
    await beatThrough()
    const choice = page.locator('.choice:visible').first()
    if (!(await choice.isVisible().catch(() => false))) continue
    const box = await choice.boundingBox()
    await page.evaluate(() => {
      const orig = window.requestAnimationFrame.bind(window)
      const t0 = performance.now()
      window.__origRaf = orig
      window.requestAnimationFrame = (cb) => orig((ts) => cb(t0 + (ts - t0) * 0.3))
    })
    await choice.click({ position: { x: 200, y: 18 } })
    for (const [delay, frame] of [[350, 'a'], [600, 'b'], [900, 'c']]) {
      await page.waitForTimeout(delay)
      const cx = box ? box.x + 200 : 900
      const cy = box ? box.y + 18 : 760
      await shot(`particle6-${tag}-${frame}.png`, {
        clip: { x: Math.max(0, cx - 330), y: Math.max(0, cy - 300), width: 660, height: 371 },
      })
    }
    await page.evaluate(() => { if (window.__origRaf) window.requestAnimationFrame = window.__origRaf })
  }
  await browser.close()
}

await run(2)
