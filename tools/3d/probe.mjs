/**
 * 单点调试：在给定 url 上进场景 → 点 3D → 打印 8 秒内发生的所有事件
 * 用法：node tools/3d/probe.mjs <url> [sceneId]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const sceneId = process.argv[3] ?? 'v1-25'
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId,
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60000,
  finishedAt: null,
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const t0 = Date.now()
const stamp = () => `+${String(Date.now() - t0).padStart(5)}ms`
page.on('pageerror', (e) => console.log(stamp(), 'PAGEERROR', String(e).slice(0, 300)))
page.on('console', (m) => console.log(stamp(), `CONSOLE[${m.type()}]`, m.text().slice(0, 240)))
page.on('requestfailed', (r) => console.log(stamp(), 'REQFAIL', r.url().slice(0, 140), r.failure()?.errorText))
page.on('response', (r) => {
  if (r.status() >= 400 || r.url().includes('.glb') || r.url().includes('Scene3D')) {
    console.log(stamp(), 'RESP', r.status(), r.url().slice(0, 140))
  }
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2400)
const hasToggle = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
console.log(stamp(), 'toggle visible:', hasToggle)
if (hasToggle) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('3D 视角'))
    button.click()
  })
  for (let i = 0; i < 16; i += 1) {
    await page.waitForTimeout(500)
    const snapshot = await page.evaluate(() => {
      const host = document.querySelector('.scene3d')
      return {
        host: Boolean(host),
        ready: host?.dataset.ready ?? null,
        glb: host?.dataset.glb ?? null,
        gl: host?.dataset.gl ?? null,
        canvases: document.querySelectorAll('canvas').length,
        appShell: Boolean(document.querySelector('.app-shell')),
      }
    })
    console.log(stamp(), JSON.stringify(snapshot))
    if (snapshot.ready) break
  }
}
await page.screenshot({ path: 'tools/3d/shots/review/probe.png' })
await browser.close()
