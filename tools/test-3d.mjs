import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 3D 切片集成测试：
 * - 桌面：night1 注入存档 → 点「3D 视角」→ 等待 Scene3D 挂载 → 读 fps/calls/tris → 截图
 * - 拖动鼠标改变视角，对比画面（截图）
 * - 移动端 390px：不应出现 3D 按钮（回退 2.5D）
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const OUT = path.join(fileURLToPath(new URL('./shots/', import.meta.url)))
await mkdir(OUT, { recursive: true })
const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'night1',
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
const errors = []
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2200)

const toggle = page.getByRole('button', { name: '3D 视角' })
const hasToggle = await toggle.isVisible().catch(() => false)
console.log('desktop toggle visible:', hasToggle)
if (hasToggle) {
  await toggle.click()
  await page.waitForTimeout(2500)
  const metrics = await page.evaluate(() => {
    const host = document.querySelector('.scene3d')
    return host ? { fps: host.dataset.fps, calls: host.dataset.calls, tris: host.dataset.tris } : null
  })
  console.log('3D metrics:', metrics)
  await page.screenshot({ path: path.join(OUT, '3d-night1.png') })
  // 拖动改变视角
  await page.mouse.move(400, 500)
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, '3d-night1-left.png') })
  await page.mouse.move(1300, 400)
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, '3d-night1-right.png') })
  // 切回 2.5D
  await page.getByRole('button', { name: '回到 2.5D' }).click()
  await page.waitForTimeout(900)
  const back2d = await page.locator('.scene-image img').first().isVisible().catch(() => false)
  console.log('back to 2.5D image visible:', back2d)
}

// 移动端：不应显示 3D 按钮
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await mobile.reload({ waitUntil: 'networkidle' })
await mobile.waitForTimeout(400)
await mobile.getByRole('button', { name: '继续上次' }).click()
await mobile.waitForTimeout(2000)
const mobile3d = await mobile.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
console.log('mobile 3D toggle visible (expect false):', mobile3d)
await mobile.screenshot({ path: path.join(OUT, 'mobile-2.5d.png') })

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (!hasToggle || errors.length) process.exitCode = 1
