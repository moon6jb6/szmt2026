import { chromium } from 'playwright'
import { mkdir, cp } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 真实打包形态验证：
 * 把 dist 拷进 `deploy-test/pkg/01_files/`（模拟「作品名_编号/01_作品及成果文件/」），
 * 在 pkg 的父目录起 python http.server，用 Playwright 验证：
 * index / assets / art / bg / audio 全部可加载，页面可操作，无控制台错误。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const BASE = path.join(ROOT, '..', '..', 'trash', '_deploy-test-2026-10-22')
const PKG = path.join(BASE, 'pkg')
const FILES = path.join(PKG, '01_files')
const PORT = 8099

await mkdir(FILES, { recursive: true })
await cp(path.join(ROOT, 'dist'), FILES, { recursive: true })

const PYTHON = process.env.PYTHON ?? 'C:\\Users\\26298\\Anaconda3\\envs\\spy\\python.exe'
const server = spawn(PYTHON, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: BASE,
  stdio: 'pipe',
})
let serverErr = ''
server.stderr?.on('data', (chunk) => {
  serverErr += String(chunk)
})

// 等端口可用（最多 12 秒）
const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/pkg/01_files/`)
      if (res.ok) return true
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}
const ready = await waitForServer()
if (!ready) {
  console.log('server not ready:', serverErr || '(no stderr)')
  server.kill()
  process.exit(1)
}

const url = `http://127.0.0.1:${PORT}/pkg/01_files/`
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
const failed = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('requestfailed', (req) => failed.push(`${req.url()} :: ${req.failure()?.errorText ?? ''}`))
page.on('response', (res) => {
  if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`)
})

const SAVE_KEY = 'names-ledger-v1'
const state = {
  sceneId: 'v0-01',
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60000,
  finishedAt: null,
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.getByRole('button', { name: '继续上次' }).click()
await page.waitForTimeout(2600)

const imageWidth = await page
  .locator('.scene-image img')
  .first()
  .evaluate((img) => (img.complete ? img.naturalWidth : 0))
  .catch(() => 0)

// 打开声音，验证音频文件也能从子目录取到
await page.locator('.audio-toggle').click()
await page.waitForTimeout(1800)

const bgLoaded = await page.evaluate(() => {
  const layer = document.querySelector('.bg-image')
  if (!layer) return 'no-layer'
  const style = getComputedStyle(layer).backgroundImage
  return style.includes('url(') ? 'has-url' : 'no-url'
})

console.log('deploy url:', url)
console.log('scene image naturalWidth:', imageWidth)
console.log('bg layer:', bgLoaded)
console.log('failed requests:', failed.length ? failed.slice(0, 6) : 'none')
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none')

await browser.close()
server.kill()
if (imageWidth <= 0 || errors.length || failed.length) process.exitCode = 1
