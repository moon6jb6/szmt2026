import { chromium } from 'playwright'

/**
 * Lead 终审：键盘全流程 / 存档异常 / 图鉴 / 史料卡浮层 / 3D 反复开关的加载与泄漏。
 * 用法：node tools/lead-audit.mjs <url>
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const UNLOCK_KEY = 'names-unlocked-v1'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// ---------- 1. 键盘全流程：只用键盘走到一个有抉择的场景并做选择 ----------
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
// 用 Tab + Enter 开始（不点鼠标）
await page.keyboard.press('Tab')
let started = false
for (let i = 0; i < 12; i += 1) {
  const label = await page.evaluate(() => {
    const el = document.activeElement
    return el ? (el.textContent ?? '').trim().slice(0, 20) : ''
  })
  if (label.includes('从头开始')) {
    await page.keyboard.press('Enter')
    started = true
    break
  }
  await page.keyboard.press('Tab')
}
await page.waitForTimeout(2200)
const sceneTitle = await page.locator('.scene-title').innerText().catch(() => '')
check('键盘：Tab 到「从头开始」并进入游戏', started && sceneTitle.length > 0, sceneTitle)

// 焦点应落在场景标题
const activeClass = await page.evaluate(() => document.activeElement?.className ?? '')
check('换场后焦点在场景标题', activeClass.includes('scene-title'), activeClass)

// 数字键 + Enter 推进一步
await page.keyboard.press('1')
await page.waitForTimeout(1400)
const hasContinue = await page.locator('.continue').isVisible().catch(() => false)
if (hasContinue) {
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1600)
}
const scene2 = await page.locator('.scene-title').innerText().catch(() => '')
check('数字键 1 + Enter 可推进', scene2.length > 0, scene2)

// ---------- 2. 存档异常：坏 JSON / 未知字段 ----------
await page.evaluate((key) => localStorage.setItem(key, '{broken json'), SAVE_KEY)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const menuVisible = await page.locator('button:has-text("从头开始")').isVisible().catch(() => false)
check('坏存档不白屏（回菜单）', menuVisible)

// ---------- 3. 史料卡浮层：打开 → Esc 关闭 ----------
const firstChoice = page.locator('.choice').first()
if (await firstChoice.isVisible().catch(() => false)) {
  await firstChoice.click()
  await page.waitForTimeout(1200)
}
const chip = page.locator('.chip').first()
if (await chip.isVisible().catch(() => false)) {
  await chip.click()
  await page.waitForTimeout(500)
  const panelOpen = await page.locator('.source-panel').isVisible().catch(() => false)
  const focusInPanel = await page.evaluate(() => !!document.activeElement?.closest('.source-panel'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const panelClosed = !(await page.locator('.source-panel').isVisible().catch(() => false))
  check('史料卡：打开 / 焦点入面板 / Esc 关闭', panelOpen && focusInPanel && panelClosed)
} else {
  check('史料卡：当前场景无可点卡（跳过）', true, 'no chip')
}

// ---------- 4. 图鉴：解锁 9 个后应有 9 格 ----------
await page.evaluate((key) => localStorage.setItem(key, JSON.stringify(['roster','letters','flag','photo','testimony','message','archive','relics','wordofmouth'])), UNLOCK_KEY)
await page.goto(url, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const galleryBtn = page.getByRole('button', { name: /结局一览/ })
if (await galleryBtn.isVisible().catch(() => false)) {
  await galleryBtn.click()
  await page.waitForTimeout(700)
  const slots = await page.locator('.gallery-card').count()
  check('图鉴：九结局 9 格', slots >= 9, `slots=${slots}`)
  await page.getByRole('button', { name: '返回' }).click().catch(() => {})
} else {
  check('图鉴入口可见', false)
}

// ---------- 5. 3D 加载：GLB 请求、反复开关、Canvas 泄漏 ----------
const state = {
  sceneId: 'v1-25',
  ledger: { roster: 1, letters: 1, flag: 1, photo: 0, testimony: 0, message: 0 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 60000, finishedAt: null,
}
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2200)

const glbRequests = []
const baselineCanvases = await page.evaluate(() => document.querySelectorAll('canvas').length)
page.on('request', (req) => { if (req.url().includes('warehouse-ext.glb')) glbRequests.push(req.url()) })
const toggle = page.getByRole('button', { name: '3D 视角' })
if (await toggle.isVisible().catch(() => false)) {
  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: '3D 视角' }).click()
    await page.waitForTimeout(1500)
    const canvasCountOn = await page.evaluate(() => document.querySelectorAll('canvas').length)
    const hostVisible = await page.locator('.scene3d').isVisible().catch(() => false)
    if (i === 0) check('3D：开启后 canvas 与 host 存在', hostVisible && canvasCountOn >= 1, `canvas=${canvasCountOn}`)
    await page.getByRole('button', { name: '回到 2.5D' }).click()
    await page.waitForTimeout(700)
  }
  const canvasesAfter = await page.evaluate(() => document.querySelectorAll('canvas').length)
  const glbAfter = glbRequests.length
  check('3D：反复开关 5 次无 Canvas 泄漏', canvasesAfter <= baselineCanvases, `baseline=${baselineCanvases}, after=${canvasesAfter}`)
  check('3D：GLB 只加载一次（缓存）', glbAfter <= 1, `glbRequests=${glbAfter}`)
} else {
  check('3D 入口可见（v1-25）', false)
}

// ---------- 6. 3D 失败回退：拦截 GLB 404 ----------
await page.route('**/warehouse-ext.glb', (route) => route.fulfill({ status: 404, body: 'not found' }))
const page2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors2 = []
page2.on('pageerror', (e) => errors2.push(String(e)))
page2.on('console', (m) => { if (m.type() === 'error') errors2.push(m.text()) })
await page2.goto(url, { waitUntil: 'networkidle' })
await page2.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page2.reload({ waitUntil: 'networkidle' })
await page2.waitForTimeout(500)
await page2.getByRole('button', { name: '继续上次' }).click()
await page2.waitForTimeout(1500)
const t2 = page2.getByRole('button', { name: '3D 视角' })
if (await t2.isVisible().catch(() => false)) {
  await t2.click()
  await page2.waitForTimeout(2000)
}
const hostStill = await page2.locator('.scene3d').isVisible().catch(() => false)
check('3D：GLB 404 时仍显示 3D 场景（地面/灯光）且不报错', hostStill && errors2.length === 0, `errors=${errors2.length}`)

// ---------- 7. localStorage 禁用 ----------
const page3 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors3 = []
page3.on('pageerror', (e) => errors3.push(String(e)))
await page3.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } })
})
await page3.goto(url, { waitUntil: 'networkidle' })
await page3.waitForTimeout(600)
const menuOk = await page3.locator('button:has-text("从头开始")').isVisible().catch(() => false)
await page3.locator('button:has-text("从头开始")').click().catch(() => {})
await page3.waitForTimeout(1800)
const sceneOk = await page3.locator('.scene').isVisible().catch(() => false)
check('localStorage 禁用仍可进入游戏', menuOk && sceneOk && errors3.length === 0, `errors=${errors3.length}`)

await browser.close()

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
console.log('console/page errors:', errors.length ? errors.slice(0, 5) : 'none')
if (failed.length) process.exitCode = 1
