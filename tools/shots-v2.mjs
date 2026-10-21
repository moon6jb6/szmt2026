import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 交付版截图（10 张，1600×1000）。
 * 通过 localStorage 注入 GameState 直达指定场景；结局一段走完整流程，先拍"终极画面"，再拍结局页。
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
  await page.waitForTimeout(400)
}

async function inject(state) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(2400)
}

const shots = []
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
  shots.push(name)
}

// 00 菜单
await clearSave()
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

// 04 尾声（造册，9 个结局选项）—— 滚到选项处截图
await inject({ ...base, sceneId: 'epilogue' })
await page.locator('.choices').scrollIntoViewIfNeeded().catch(() => {})
await page.waitForTimeout(700)
await shot('04-epilogue-choices.png')

// 05 结局终极画面：从尾声选第一个结局，点"把东西交出去"，抓拍画面后段（名字落成册页）
await page.locator('.choice').first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '把东西交出去' }).click()
await page.waitForTimeout(5200)
await shot('05-finale-roster.png')

// 06 结局页（跳过终极画面后）
await page.locator('.finale').click({ position: { x: 400, y: 300 } }).catch(() => {})
for (let i = 0; i < 30; i += 1) {
  if (await page.locator('.ending').isVisible().catch(() => false)) break
  await page.waitForTimeout(250)
}
await page.waitForTimeout(500)
await shot('06-ending-names.png')

// 07 人物志
await clearSave()
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(600)
await shot('07-people.png')

// 08 后来
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '后来' }).click()
await page.waitForTimeout(600)
await shot('08-later.png')

// 09 史料库
await page.getByRole('button', { name: '返回' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(600)
await shot('09-sources.png')

// 10 移动端菜单
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(() => localStorage.clear())
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(800)
await mobile.screenshot({ path: path.join(OUT, '10-mobile-menu.png') })
shots.push('10-mobile-menu.png')

console.log('shots:', shots.length)
console.log(shots.join('\n'))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
