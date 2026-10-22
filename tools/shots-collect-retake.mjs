import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 补拍：真 3D 多场景、终极画面多帧、粒子多帧、墨幕更准的 cover/hold。 */
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
const manifest = []
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

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
async function shot(p, name, meta = {}) {
  await p.screenshot({ path: path.join(OUT, name) })
  manifest.push({ file: name, ...meta })
  console.log('shot', name)
}

// 1) 多场景真 3D
for (const [id, name] of [['v2-44', '3d-v2-44-桥'], ['night3', '3d-night3-楼顶'], ['v0-02', '3d-v0-02-厢房'], ['v2-03', '3d-v2-03-仓库内']]) {
  await makePage(page, { ...base, sceneId: id })
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
  }
  const btn = page.getByRole('button', { name: '3D 视角' })
  if (!(await btn.isVisible().catch(() => false))) {
    console.log('no 3d toggle for', id)
    continue
  }
  await btn.click()
  await page.waitForTimeout(3600)
  await page.mouse.move(1200, 600)
  await page.waitForTimeout(600)
  await shot(page, `${name}.png`, { scene: id, view: '3d' })
}

// 2) 终极画面多帧
await makePage(page, { ...base, sceneId: 'epilogue' })
const item = page.locator('button[aria-label*="结局："]').nth(0)
if (await item.isVisible().catch(() => false)) {
  await item.click()
  await page.waitForTimeout(500)
  const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()
  if (await commit.isVisible().catch(() => false)) await commit.click()
  await page.waitForTimeout(800)
}
const go = page.getByRole('button', { name: '把东西交出去' })
if (await go.isVisible().catch(() => false)) await go.click()
for (const [delay, name] of [[1200, 'finale-帧1-1.2s'], [1400, 'finale-帧2-2.6s'], [1500, 'finale-帧3-4.1s'], [1500, 'finale-帧4-5.6s']]) {
  await page.waitForTimeout(delay)
  await shot(page, `${name}.png`, { feature: 'finale' })
}

// 3) 粒子帧：v4-05（名册）多时刻
for (const [id, label] of [['v4-05', 'roster'], ['v3-03', 'archive'], ['v2-43', 'testimony']]) {
  for (const [delay, tag] of [[130, 'a'], [300, 'b']]) {
    await makePage(page, { ...base, sceneId: id })
    const choice = page.locator('.choice:visible').first()
    if (!(await choice.isVisible().catch(() => false))) continue
    await choice.click()
    await page.waitForTimeout(delay)
    await shot(page, `particle2-${label}-${tag}.png`, { scene: id, kind: label, delay })
    await page.waitForTimeout(800)
  }
}

// 4) 墨幕 cover / hold（更慢）
await makePage(page, { ...base, sceneId: 'v0-01' })
await page.evaluate(() => {
  const orig = window.requestAnimationFrame.bind(window)
  const t0 = performance.now()
  window.__origRaf = orig
  window.requestAnimationFrame = (cb) => orig((ts) => cb(t0 + (ts - t0) * 0.15))
})
const cont = page.locator('.continue:visible, .choice:visible').first()
if (await cont.isVisible().catch(() => false)) {
  await cont.click()
  await page.waitForTimeout(4500)
  await shot(page, 'anim2-墨幕-cover.png', { feature: 'ink-cover' })
  await page.waitForTimeout(2300)
  await shot(page, 'anim2-墨幕-hold.png', { feature: 'ink-hold' })
}
await page.evaluate(() => { if (window.__origRaf) window.requestAnimationFrame = window.__origRaf })

await writeFile(path.join(OUT, 'manifest-retake.json'), JSON.stringify({ errors, files: manifest }, null, 2), 'utf8')
console.log('total', manifest.length, 'errors', errors.slice(0, 3))
await browser.close()
