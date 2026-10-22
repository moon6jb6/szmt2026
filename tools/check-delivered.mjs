import { chromium } from 'playwright'
import path from 'node:path'

/** 只检查交付包：从「解压目录」当评委拿到的包，走一遍索引、页面、游戏与 3D。 */
const rootName = '参赛材料（解压目录）'
const pkgName = '把名字留下来_四行仓库·苏州河北岸的四百余个名字_460737'
const appName = '01_作品及成果文件'
const url = process.argv[2] ?? `http://127.0.0.1:8097/${encodeURIComponent(rootName)}/${encodeURIComponent(pkgName)}/${encodeURIComponent(appName)}/`
const shotDir = 'D:/backups/delivery-check'
const LEDGER_KEY = 'names-ledger-v1'
const UNLOCK_KEY = 'names-endings-v1'
const ALL = ['roster', 'letters', 'flag', 'photo', 'testimony', 'message', 'archive', 'relics', 'wordofmouth']
const base = {
  ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
  flags: [], pendingOutcome: null, pendingNext: null, picked: {}, ending: null,
  startedAt: Date.now() - 3_600_000, finishedAt: null,
}
const results = []
const errors = []
const failedRequests = []
const ok = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('response', (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`)
})
page.on('requestfailed', (req) => failedRequests.push(`FAILED ${req.url()} ${req.failure()?.errorText ?? ''}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
ok('页面加载', (await page.locator('.app-shell').count()) === 1)
ok('无绝对路径 404', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '))
await page.screenshot({ path: path.join(shotDir, '01-menu.png') })

// 菜单索引
for (const [btn, sel, expected, back] of [
  ['结局一览', '.gallery-card', 9, '返回'],
  ['史料库', '.source-entry', 76, '返回'],
  ['人物志', '.people-card', 10, '返回'],
  ['后来', '.later-card, .people-card, .card', null, '返回'],
  ['关于与史料', '.about', null, '返回'],
]) {
  const b = page.getByRole('button', { name: btn }).first()
  ok(`菜单入口：${btn}`, await b.isVisible().catch(() => false))
  if (!(await b.isVisible().catch(() => false))) continue
  await b.click()
  await page.waitForTimeout(900)
  const count = sel ? await page.locator(sel).count() : 0
  ok(`${btn} 内容`, expected === null ? count > 0 : count === expected, `count=${count}`)
  await page.screenshot({ path: path.join(shotDir, `02-${btn}.png`) })
  const r = page.getByRole('button', { name: back }).first()
  ok(`${btn} 可返回`, await r.isVisible().catch(() => false))
  if (await r.isVisible().catch(() => false)) {
    await r.click()
    await page.waitForTimeout(600)
  }
}
ok('返回后是主菜单', await page.locator('.menu').isVisible().catch(() => false))

// 人物志点开一篇
await page.getByRole('button', { name: '人物志' }).first().click()
await page.waitForTimeout(700)
const firstPerson = page.locator('.people-card').first()
if (await firstPerson.isVisible().catch(() => false)) {
  await firstPerson.click()
  await page.waitForTimeout(800)
  ok('人物志：点开一篇', (await page.locator('.scene-title, h1').count()) > 0)
  await page.screenshot({ path: path.join(shotDir, '03-人物志-一篇.png') })
  const back = page.getByRole('button', { name: /返回/ }).first()
  if (await back.isVisible().catch(() => false)) await back.click()
  await page.waitForTimeout(500)
}

// 从头开始 → 选项 → 换场
await page.getByRole('button', { name: '返回' }).first().click().catch(() => {})
await page.waitForTimeout(500)
await page.getByRole('button', { name: '从头开始' }).first().click()
await page.waitForTimeout(2600)
ok('进入游戏', await page.locator('.scene').isVisible().catch(() => false))
await page.screenshot({ path: path.join(shotDir, '04-游戏首屏.png') })
for (let i = 0; i < 3; i += 1) {
  const beat = page.getByRole('button', { name: /继续读/ })
  if (await beat.isVisible().catch(() => false)) {
    await beat.click()
    await page.waitForTimeout(800)
  }
}
const choice = page.locator('.choice:visible').first()
if (await choice.isVisible().catch(() => false)) {
  await choice.click()
  await page.waitForTimeout(900)
  ok('选择后出现结果', (await page.locator('.continue, .beats').count()) > 0)
  const cont = page.locator('.continue:visible').first()
  if (await cont.isVisible().catch(() => false)) {
    await cont.click()
    await page.waitForTimeout(2800)
  }
  ok('换场后仍是场景', await page.locator('.scene').isVisible().catch(() => false))
}
await page.screenshot({ path: path.join(shotDir, '05-一次选择后.png') })

// 注入存档：检查 3D、场景探索、史料卡、长段落
async function inject(sceneId) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(({ key, value, unlockKey, endings }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(unlockKey, JSON.stringify(endings))
  }, { key: LEDGER_KEY, value: { ...base, sceneId }, unlockKey: UNLOCK_KEY, endings: ALL })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '继续上次' }).first().click()
  await page.waitForTimeout(2600)
}

await inject('v0-02')
const toggle3d = page.getByRole('button', { name: '3D 视角' }).first()
ok('3D 入口存在', await toggle3d.isVisible().catch(() => false))
if (await toggle3d.isVisible().catch(() => false)) {
  await toggle3d.click()
  await page.waitForTimeout(3500)
  ok('3D 场景可加载', (await page.locator('canvas').count()) > 0)
  await page.screenshot({ path: path.join(shotDir, '06-3D.png') })
  await page.getByRole('button', { name: /回到 2.5D/ }).first().click().catch(() => {})
  await page.waitForTimeout(500)
}

await inject('v1-25')
const explore = page.getByRole('button', { name: '场景探索' }).first()
ok('场景探索入口存在', await explore.isVisible().catch(() => false))
if (await explore.isVisible().catch(() => false)) {
  await explore.click()
  await page.waitForTimeout(1400)
  ok('场景探索背景图加载', (await page.locator('.sh').count()) > 0)
  const dot = page.locator('.sh-dot').first()
  if (await dot.isVisible().catch(() => false)) {
    await dot.click()
    await page.waitForTimeout(700)
    ok('热点可点开', (await page.locator('.sh-card').count()) > 0)
  }
  await page.screenshot({ path: path.join(shotDir, '07-场景探索.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /返回正文/ }).first().click().catch(() => {})
}

await inject('v0-01')
const beats = await page.locator('.beats').count()
ok('长段落分段组件存在', beats > 0, `beats=${beats}`)
if (beats > 0) {
  const next = page.getByRole('button', { name: /继续读/ }).first()
  if (await next.isVisible().catch(() => false)) {
    await next.click()
    await page.waitForTimeout(900)
    ok('可继续读下一段', (await page.locator('.beats').count()) > 0)
  }
}

const chips = await page.locator('.source-row button').count()
ok('史料 chip 存在（当前场景）', chips > 0, `chips=${chips}`)

// 资源加载与 DOM 里的失败
const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name))
const bad = resources.filter((u) => u.includes('/assets/') && !u.includes('.'))
ok('静态资源请求正常', failedRequests.length === 0, failedRequests.slice(0, 4).join(' | '))
ok('无控制台/页面错误', errors.length === 0, errors.slice(0, 3).join(' | '))

const summary = { url, pass: results.filter((r) => r.ok).length, total: results.length, failedRequests, errors }
console.log(JSON.stringify(summary, null, 2))
await browser.close()
if (results.some((r) => !r.ok) || failedRequests.length || errors.length) process.exitCode = 1
