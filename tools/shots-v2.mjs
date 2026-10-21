import { chromium } from 'playwright'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 最终交付截图（10 张，1600×1000；移动端 390×844 也算一张）。
 * 顺序：菜单 / 2.5D 序卷 / 3D 仓库内景 / 尾声九结局 / 结局终极画面 / 结局页 / 人物志 / 后来 / 史料库 / 移动端菜单
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = path.join(fileURLToPath(new URL('../', import.meta.url)), 'docs', 'deliverables', 'screenshots')
await mkdir(OUT, { recursive: true })

const SAVE_KEY = 'names-ledger-v1'
const base = {
  ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 3_600_000,
  finishedAt: null,
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})

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
  await page.waitForTimeout(2200)
}

const shots = []
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
  shots.push(name)
}

// 0 菜单
await clearSave()
await shot('00-menu.png')

// 1 2.5D 序卷（带插画）
await inject({ ...base, sceneId: 'v0-01' })
await shot('01-scene-2.5d.png')

// 2 真 3D：第一夜仓库内景
await inject({ ...base, sceneId: 'v1-25' })
const toggle = page.getByRole('button', { name: '3D 视角' })
if (await toggle.isVisible().catch(() => false)) {
  await toggle.click()
  await page.waitForTimeout(2800)
}
await shot('02-scene-3d.png')

// 3 尾声：9 个结局选项
await inject({ ...base, sceneId: 'epilogue' })
await page.locator('.choices').scrollIntoViewIfNeeded().catch(() => {})
await page.waitForTimeout(700)
await shot('03-epilogue-choices.png')

// 4 结局终极画面（名册）
await page.locator('.choice').first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '把东西交出去' }).click()
await page.waitForTimeout(5200)
await shot('04-finale.png')

// 5 结局页
await page.locator('.finale').click({ position: { x: 400, y: 300 } }).catch(() => {})
for (let i = 0; i < 30; i += 1) {
  if (await page.locator('.ending').isVisible().catch(() => false)) break
  await page.waitForTimeout(250)
}
await page.waitForTimeout(500)
await shot('05-ending.png')

// 6 人物志
await clearSave()
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(700)
await shot('06-people.png')

// 7 后来
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '后来' }).click()
await page.waitForTimeout(700)
await shot('07-later.png')

// 8 史料库
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(700)
await shot('08-sources.png')

// 9 移动端菜单
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(() => localStorage.clear())
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(900)
await mobile.screenshot({ path: path.join(OUT, '09-mobile-menu.png') })
shots.push('09-mobile-menu.png')

// 清理不在清单里的旧截图
const keep = new Set(shots)
for (const file of await readdir(OUT)) {
  if (file.endsWith('.png') && !keep.has(file)) await unlink(path.join(OUT, file))
}

console.log('shots:', shots.length)
console.log(shots.join('\n'))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
