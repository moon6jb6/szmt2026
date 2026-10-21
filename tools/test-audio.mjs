import { chromium } from 'playwright'

/**
 * 声音系统验收（在 dev server 上跑，才能用 window.__audio 探针）：
 * 1. 默认静音、AudioContext 未创建；
 * 2. 点开头不创建（因为静音），点「声音」后 running；
 * 3. 场景切换有 ambience；
 * 4. 结局有 drone；
 * 5. 静音状态刷新后保持；
 * 6. 无控制台错误。
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const SAVE_KEY = 'names-ledger-v1'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const probe = () => page.evaluate(() => (window.__audio ? {
  state: window.__audio.getState(),
  muted: window.__audio.isMuted(),
  unlocked: window.__audio.isUnlocked(),
  ambience: window.__audio.ambience(),
  drone: window.__audio.drone(),
  buffered: window.__audio.buffered(),
} : null))

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)

console.log('initial:', await probe(), '| button:', await page.locator('.audio-toggle').innerText())

await page.getByRole('button', { name: '从头开始' }).click()
await page.waitForTimeout(1800)
console.log('after start (should still be muted/no ctx):', await probe())

await page.locator('.audio-toggle').click()
await page.waitForTimeout(2000)
const enabled = await probe()
console.log('after enable:', enabled)

if (enabled?.state !== 'running' || enabled.muted) {
  console.log('FAIL: audio context not running after enable')
  process.exitCode = 1
}

// 场景 ambience
await page.waitForTimeout(800)
console.log('scene ambience:', await probe())
// 点第一个抉择
const choice = page.locator('.choice').first()
if (await choice.isVisible().catch(() => false)) {
  await choice.click()
  await page.waitForTimeout(900)
  await page.locator('.continue').click().catch(() => {})
  await page.waitForTimeout(1500)
}
console.log('after choice/advance:', await probe())

// 结局 drone：注入 epilogue 存档并重载
const endState = {
  sceneId: 'epilogue',
  ledger: { roster: 1, letters: 1, flag: 1, photo: 0, testimony: 0, message: 0 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60000,
  finishedAt: null,
}
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: endState })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2200)
const endingChoices = page.locator('.choice')
if ((await endingChoices.count()) > 0) {
  await endingChoices.first().click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '把东西交出去' }).click()
  await page.waitForTimeout(4000)
}
const endingProbe = await probe()
console.log('ending probe:', endingProbe)
if (!endingProbe?.drone) {
  console.log('WARN: no ending drone detected')
}

// 刷新后静音状态保持
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
console.log('after reload button:', await page.locator('.audio-toggle').innerText(), '| muted:', (await probe())?.muted)

console.log('errors:', errors.length ? errors.slice(0, 6) : 'none')
await browser.close()
if (errors.length) process.exitCode = 1
