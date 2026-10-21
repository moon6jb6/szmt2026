import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 交付版截图（10 张，1600×1000）。
 * 通过 localStorage 注入 GameState 直达指定场景，避免每次从头走。
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

async function inject(state) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '继续上次' }).click().catch(() => {})
  await page.waitForTimeout(2400)
}

async function clearAndMenu() {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
}

const shots = []
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
  shots.push(name)
}

// 00 菜单
await clearAndMenu()
await shot('00-menu.png')

// 01 序卷第一场（带插画）
await inject({ ...base, sceneId: 'v0-01' })
await shot('01-scene-v0-01.png')

// 02 第一夜（点名）
await inject({ ...base, sceneId: 'night1' })
await shot('02-scene-night1.png')

// 03 第三夜（升旗）
await inject({ ...base, sceneId: 'night3' })
await shot('03-scene-night3.png')

// 04 第五夜后（缴械前）
await inject({ ...base, sceneId: 'night5b' })
await shot('04-scene-night5b.png')

// 05 结局页（名册）
await inject({ ...base, sceneId: 'epilogue', ending: 'roster', finishedAt: Date.now() - 60_000 })
await page.waitForTimeout(1200)
await shot('05-ending-names.png')

// 06 人物志清单
await clearAndMenu()
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(600)
await shot('06-people.png')

// 07 后来清单
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '后来' }).click()
await page.waitForTimeout(600)
await shot('07-later.png')

// 08 史料库
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(600)
await shot('08-sources.png')

// 09 人物志正文
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(500)
await page.locator('.people-card').first().click()
await page.waitForTimeout(800)
await shot('09-people-reader.png')

// 10 移动端菜单（390×844）
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(() => localStorage.clear())
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(900)
await mobile.screenshot({ path: path.join(OUT, '10-mobile-menu.png') })
shots.push('10-mobile-menu.png')

console.log('shots:', shots.length)
console.log(shots.join('\n'))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
