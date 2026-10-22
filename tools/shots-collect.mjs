import { chromium } from 'playwright'
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'

/**
 * PPT 素材批量收集：真实运行截图（1920×1080 + 390×844），覆盖场景/交互/动画/页面。
 * 输出：D:\提交\截图素材\*.png + manifest.json
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = process.argv[3] ?? 'D:/提交/截图素材'
await mkdir(OUT, { recursive: true })

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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

async function makePage(p, state) {
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.evaluate(({ key, value, unlockKey, endings }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(unlockKey, JSON.stringify(endings))
  }, { key: LEDGER_KEY, value: state, unlockKey: UNLOCK_KEY, endings: ALL_ENDINGS })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  await p.getByRole('button', { name: '继续上次' }).click()
  await p.waitForTimeout(2500)
}

async function snapshot(p, name, meta = {}) {
  await p.waitForTimeout(250)
  const file = path.join(OUT, name)
  await p.screenshot({ path: file })
  manifest.push({ file: name, ...meta })
  console.log('shot', name)
}

async function sceneShot(p, sceneId, name) {
  await makePage(p, { ...base, sceneId })
  const hasChoice = (await p.locator('.choice:visible').count()) > 0
  const has3d = await p.getByRole('button', { name: /3D 视角|回到 2.5D/ }).isVisible().catch(() => false)
  const chips = await p.locator('.source-row button').count()
  const beats = await p.locator('.beats').count()
  await snapshot(p, name, { scene: sceneId, choice: hasChoice, view3d: has3d, chips, beats })
  return { hasChoice, has3d, chips, beats }
}

// A. 场景素材（尽量挑色彩丰富的）
const scenes = [
  ['v0-01', 'scene-v0-01-便条'],
  ['v0-04', 'scene-v0-04-烘笼'],
  ['v1-23', 'scene-v1-23-苏州河'],
  ['v1-25', 'scene-v1-25-铁门'],
  ['v2-43', 'scene-v2-43-桥头'],
  ['v2-45', 'scene-v2-45-南堍'],
  ['v3-01', 'scene-v3-01-三百五十五'],
  ['v3-03', 'scene-v3-03-点数'],
  ['v4-05', 'scene-v4-05-广播里的歌'],
  ['v5-04', 'scene-v5-04-六尺长四尺阔'],
]
for (const [id, name] of scenes) await sceneShot(page, id, `${name}.png`)

// B. 大图候选：需要有可见选项 + 3D 入口 + 史料 chip
const bigCandidates = ['v1-25', 'v2-43', 'v2-44', 'night4', 'v3-03', 'v5-04', 'v2-45']
for (const id of bigCandidates) {
  const info = await sceneShot(page, id, `big-candidate-${id}.png`)
  if (info.hasChoice && info.has3d) {
    console.log(`BIG OK: ${id} choice=${info.hasChoice} 3d=${info.has3d} chips=${info.chips}`)
  }
}

// C. 真 3D 视角
for (const [id, name] of [['v1-25', '3d-v1-25-铁门'], ['v2-43', '3d-v2-43-桥头'], ['night4', '3d-night4-桥']]) {
  await makePage(page, { ...base, sceneId: id })
  const btn = page.getByRole('button', { name: '3D 视角' })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(3200)
    await snapshot(page, `${name}.png`, { scene: id, view: '3d' })
  }
}

// D. 交互
await makePage(page, { ...base, sceneId: 'night1' })
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
}
await snapshot(page, 'interaction-灯下找名字-全找到.png', { feature: 'spotlight' })
await page.getByRole('button', { name: '跳过（Esc）' }).click().catch(() => {})

await makePage(page, { ...base, sceneId: 'night3' })
await snapshot(page, 'interaction-升旗.png', { feature: 'flag' })
await page.getByRole('button', { name: '跳过（Esc）' }).click().catch(() => {})

await makePage(page, { ...base, sceneId: 'v1-25' })
await page.getByRole('button', { name: '场景探索' }).click()
await page.waitForTimeout(1300)
const dot = page.locator('.sh-dot').nth(1)
if (await dot.isVisible().catch(() => false)) {
  await dot.click()
  await page.waitForTimeout(800)
}
await snapshot(page, 'interaction-场景探索-热点卡.png', { feature: 'hotspots' })
await page.keyboard.press('Escape')

await makePage(page, { ...base, sceneId: 'v0-01' })
for (let i = 0; i < 5; i += 1) {
  const nextBeat = page.getByRole('button', { name: /继续读/ })
  if (!(await nextBeat.isVisible().catch(() => false))) break
  await nextBeat.click()
  await page.waitForTimeout(900)
  const figure = await page.locator('.beats__figure').count()
  const mood = await page.locator('.scene').getAttribute('data-beat-mood')
  if (figure > 0 && mood?.startsWith('figure')) break
}
await snapshot(page, 'interaction-三段阅读-人物剪影.png', { feature: 'beats' })

await makePage(page, { ...base, sceneId: 'epilogue' })
const trayItem = page.locator('button[aria-label*="结局："]').nth(0)
if (await trayItem.isVisible().catch(() => false)) {
  await trayItem.click()
  await page.waitForTimeout(500)
}
await snapshot(page, 'interaction-尾声-交付托盘.png', { feature: 'carrytray' })

// E. 粒子（点击选项的瞬间）
const burstScenes = ['v1-23', 'v2-43', 'v3-03', 'v4-05', 'v5-04', 'v0-04']
let burstIndex = 0
for (const id of burstScenes) {
  await makePage(page, { ...base, sceneId: id })
  const choice = page.locator('.choice:visible').first()
  if (!(await choice.isVisible().catch(() => false))) continue
  const kind = await choice.getAttribute('data-kind')
  await choice.click()
  await page.waitForTimeout(230)
  burstIndex += 1
  await snapshot(page, `particle-${String(burstIndex).padStart(2, '0')}-${kind ?? 'x'}.png`, { scene: id, kind })
  await page.waitForTimeout(900)
}

// F. 墨幕 cover / hold（放慢 rAF 时间戳，便于截到中间态）
await makePage(page, { ...base, sceneId: 'v0-01' })
await page.evaluate(() => {
  const orig = window.requestAnimationFrame.bind(window)
  const t0 = performance.now()
  window.__origRaf = orig
  window.requestAnimationFrame = (cb) => orig((ts) => cb(t0 + (ts - t0) * 0.25))
})
const cont = page.locator('.continue:visible, .choice:visible').first()
if (await cont.isVisible().catch(() => false)) {
  await cont.click()
  await page.waitForTimeout(2200)
  await snapshot(page, 'anim-墨幕-cover.png', { feature: 'ink-cover' })
  await page.waitForTimeout(2600)
  await snapshot(page, 'anim-墨幕-hold.png', { feature: 'ink-hold' })
}
await page.evaluate(() => { if (window.__origRaf) window.requestAnimationFrame = window.__origRaf })

// G. 终极画面
await makePage(page, { ...base, sceneId: 'epilogue' })
const item = page.locator('button[aria-label*="结局："]').nth(0)
if (await item.isVisible().catch(() => false)) {
  await item.click()
  await page.waitForTimeout(500)
  const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()
  if (await commit.isVisible().catch(() => false)) await commit.click()
  await page.waitForTimeout(700)
}
const go = page.getByRole('button', { name: '把东西交出去' })
if (await go.isVisible().catch(() => false)) await go.click()
await page.waitForTimeout(3200)
await snapshot(page, 'finale-终极画面-1.png', { feature: 'finale' })
await page.waitForTimeout(1800)
await snapshot(page, 'finale-终极画面-2.png', { feature: 'finale' })

// H. 页面
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ unlockKey, endings }) => {
  localStorage.clear()
  localStorage.setItem(unlockKey, JSON.stringify(endings))
}, { unlockKey: UNLOCK_KEY, endings: ALL_ENDINGS })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await snapshot(page, 'page-主菜单.png')
for (const [btn, name] of [['结局一览', 'page-结局一览'], ['史料库', 'page-史料库'], ['人物志', 'page-人物志']]) {
  await page.getByRole('button', { name: btn }).click()
  await page.waitForTimeout(1000)
  await snapshot(page, `${name}.png`, { page: btn })
  await page.getByRole('button', { name: '返回' }).click().catch(() => {})
  await page.waitForTimeout(500)
}

// I. 手机竖屏 390×844
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
for (const [id, name] of [['v2-43', 'mobile-桥头'], ['night1', 'mobile-灯下找名字']]) {
  await makePage(mobile, { ...base, sceneId: id })
  await snapshot(mobile, `${name}.png`, { mobile: true, scene: id })
}
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(({ unlockKey, endings }) => {
  localStorage.clear()
  localStorage.setItem(unlockKey, JSON.stringify(endings))
}, { unlockKey: UNLOCK_KEY, endings: ALL_ENDINGS })
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(700)
await snapshot(mobile, 'mobile-主菜单.png', { mobile: true })

await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), errors, files: manifest }, null, 2), 'utf8')
console.log('total', manifest.length, 'errors:', errors.length ? errors.slice(0, 3) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
