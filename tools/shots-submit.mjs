import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 提交用运行截图：10 张，功能覆盖 + 画面尽量丰富。1920×1080。 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = process.argv[3] ?? 'D:/提交/运行截图'
await mkdir(OUT, { recursive: true })

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
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const done = []

async function reset() {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ unlockKey, endings }) => {
    localStorage.clear()
    localStorage.setItem(unlockKey, JSON.stringify(endings))
  }, { unlockKey: UNLOCK_KEY, endings: ALL_ENDINGS })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
}

async function inject(state) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value, unlockKey, endings }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(unlockKey, JSON.stringify(endings))
  }, { key: LEDGER_KEY, value: state, unlockKey: UNLOCK_KEY, endings: ALL_ENDINGS })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(2600)
}

async function shot(name) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, name) })
  done.push(name)
  console.log('shot', name)
}

// 01 主菜单
await reset()
await shot('01-主菜单.png')

// 02 2.5D 桥头（河景）
await inject({ ...base, sceneId: 'v2-43' })
await shot('02-2.5D场景-桥头.png')

// 03 第一夜 灯下找名字（点亮三个）
await inject({ ...base, sceneId: 'night1' })
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
}
await shot('03-灯下找名字.png')
await page.getByRole('button', { name: '跳过（Esc）' }).click().catch(() => {})

// 04 第三夜 升旗
await inject({ ...base, sceneId: 'night3' })
await shot('04-第三夜-升旗.png')
await page.getByRole('button', { name: '跳过（Esc）' }).click().catch(() => {})

// 05 场景探索（仓库外墙 + 热点卡片）
await inject({ ...base, sceneId: 'v1-25' })
const explore = page.getByRole('button', { name: '场景探索' })
if (await explore.isVisible().catch(() => false)) {
  await explore.click()
  await page.waitForTimeout(1300)
  const dot = page.locator('.sh-dot').nth(1)
  if (await dot.isVisible().catch(() => false)) {
    await dot.click()
    await page.waitForTimeout(800)
  }
}
await shot('05-场景探索-仓库外墙.png')
await page.keyboard.press('Escape')

// 06 长段落三段阅读 + 人物剪影
await inject({ ...base, sceneId: 'v0-01' })
for (let i = 0; i < 5; i += 1) {
  const nextBeat = page.getByRole('button', { name: /继续读/ })
  if (!(await nextBeat.isVisible().catch(() => false))) break
  await nextBeat.click()
  await page.waitForTimeout(900)
  const figure = await page.locator('.beats__figure').count()
  const mood = await page.locator('.scene').getAttribute('data-beat-mood')
  if (figure > 0 && mood?.startsWith('figure')) break
}
await shot('06-长段落阅读-人物剪影.png')

// 07 尾声 交付托盘
await inject({ ...base, sceneId: 'epilogue' })
await page.waitForTimeout(700)
const trayItem = page.locator('button[aria-label*="结局："]').nth(0)
if (await trayItem.isVisible().catch(() => false)) {
  await trayItem.click()
  await page.waitForTimeout(500)
}
await shot('07-尾声-交付托盘.png')

// 08 结局一览（九个结局全解锁）
await reset()
await page.getByRole('button', { name: '结局一览' }).click()
await page.waitForTimeout(900)
await shot('08-结局一览.png')

// 09 人物志
await reset()
await page.getByRole('button', { name: '人物志' }).click()
await page.waitForTimeout(900)
await shot('09-人物志.png')

// 10 史料库（76 张史料卡）
await reset()
await page.getByRole('button', { name: '史料库' }).click()
await page.waitForTimeout(1100)
await shot('10-史料库.png')

await writeFile(path.join(OUT, '截图说明.md'), [
  '# 运行截图（10 张，1920×1080）',
  '',
  '| 文件 | 对应功能 |',
  '|---|---|',
  '| 01-主菜单.png | 标题页：红色之旅·追梦铸魂，继续/从头开始/结局一览/史料库/人物志/后来 |',
  '| 02-2.5D场景-桥头.png | 2.5D 多层视差正文（苏州河北岸桥头） |',
  '| 03-灯下找名字.png | 第一夜交互：手电光圈里找名字 |',
  '| 04-第三夜-升旗.png | 第三夜交互：把旗升到杆顶 |',
  '| 05-场景探索-仓库外墙.png | 3D 场景的「背景图 + 热点」探索，点开环境旁白 |',
  '| 06-长段落阅读-人物剪影.png | 长段落分三段读，人物组背后浮现剪影 |',
  '| 07-尾声-交付托盘.png | 尾声：九件实物拖进匣子、按住手印 |',
  '| 08-结局一览.png | 九个结局（6 主 + 3 合成） |',
  '| 09-人物志.png | 十篇人物志 |',
  '| 10-史料库.png | 76 张史料卡，可按文献分组查看出处与原文 |',
  '',
  '说明：页面为本地静态站点，无外部请求；截图来自最终构建产物。',
].join('\n'), 'utf8')

console.log('errors:', errors.length ? errors.slice(0, 4) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
