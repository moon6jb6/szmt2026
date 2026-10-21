import { chromium } from 'playwright'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 最终交付截图（10 张）：菜单 / 2.5D 序卷 / 场景探索（背景+热点） / 灯下找名字 /
 * 尾声交付托盘 / 终极画面 / 结局页 / 长段落三段+人物剪影 / 人物志 / 移动端
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = path.join(fileURLToPath(new URL('../', import.meta.url)), 'docs', 'deliverables', 'screenshots')
await mkdir(OUT, { recursive: true })
const SAVE_KEY = 'names-ledger-v1'
const base = {
  ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 3_600_000, finishedAt: null,
}
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

async function clearSave() {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}
async function inject(state) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(2600)
}
const shots = []
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
  shots.push(name)
}

// 00 菜单
await clearSave()
await shot('00-menu.png')

// 01 2.5D 序卷
await inject({ ...base, sceneId: 'v0-01' })
await shot('01-scene-2.5d.png')

// 02 场景探索：背景图 + 热点
await inject({ ...base, sceneId: 'v1-25' })
const explore = page.getByRole('button', { name: '场景探索' })
if (await explore.isVisible().catch(() => false)) {
  await explore.click()
  await page.waitForTimeout(1400)
  // 点开一处热点，让窄卡与墨圈出现在镜头里（展示交互）
  const dot = page.locator('.sh-dot').nth(1)
  if (await dot.isVisible().catch(() => false)) {
    await dot.click()
    await page.waitForTimeout(900)
  }
}
await shot('02-scene-explore.png')
await page.keyboard.press('Escape')
await page.waitForTimeout(600)

// 03 第一夜：灯下找名字（键盘点亮 3 个）
await inject({ ...base, sceneId: 'night1' })
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
}
await page.waitForTimeout(500)
await shot('03-signature-spotlight.png')
await page.getByRole('button', { name: '跳过（Esc）' }).click().catch(() => {})
await page.waitForTimeout(600)

// 04 尾声交付托盘
await inject({ ...base, sceneId: 'epilogue' })
await page.waitForTimeout(900)
await shot('04-epilogue-carrytray.png')

// 05 终极画面
const trayItem = page.locator('button[aria-label*="结局："]').first()
if (await trayItem.isVisible().catch(() => false)) {
  await trayItem.click()
  await page.waitForTimeout(400)
  const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()
  if (await commit.isVisible().catch(() => false)) await commit.click()
  await page.waitForTimeout(600)
}
const cont = page.getByRole('button', { name: '把东西交出去' })
if (await cont.isVisible().catch(() => false)) await cont.click()
await page.waitForTimeout(5200)
await shot('05-finale.png')

// 06 结局页
await page.locator('.finale').click({ position: { x: 400, y: 300 } }).catch(() => {})
for (let i = 0; i < 30; i += 1) {
  if (await page.locator('.ending').isVisible().catch(() => false)) break
  await page.waitForTimeout(250)
}
await page.waitForTimeout(600)
await shot('06-ending.png')

// 07 长段落三段阅读 + 人物剪影
await inject({ ...base, sceneId: 'v0-01' })
for (let i = 0; i < 4; i += 1) {
  const nextBeat = page.getByRole('button', { name: /继续读/ })
  if (!(await nextBeat.isVisible().catch(() => false))) break
  await nextBeat.click()
  await page.waitForTimeout(900)
  const figure = await page.locator('.beats__figure').count()
  const mood = await page.locator('.scene').getAttribute('data-beat-mood')
  if (figure > 0 && mood && mood.startsWith('figure')) break
}
await shot('07-beats-figure.png')

// 08 人物志
await clearSave()
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(800)
await shot('08-people.png')

// 09 移动端菜单
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(() => localStorage.clear())
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(1000)
await mobile.screenshot({ path: path.join(OUT, '09-mobile-menu.png') })
shots.push('09-mobile-menu.png')

const keep = new Set(shots)
for (const file of await readdir(OUT)) {
  if (file.endsWith('.png') && !keep.has(file)) await unlink(path.join(OUT, file))
}
console.log('shots:', shots.length)
console.log(shots.join('\n'))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
