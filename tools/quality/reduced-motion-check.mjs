/**
 * prefers-reduced-motion 降级复测（无头 Chrome / Playwright），不改 src。
 * 覆盖 3D / 粒子 / 转场 / 终极画面 四项。
 *
 * 用法：node tools/quality/reduced-motion-check.mjs [url]
 * 输出：控制台 + tools/quality/reduced-motion.json + tools/quality/shots/rm-*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'tools/quality/shots')
mkdirSync(SHOTS, { recursive: true })
const URL = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'
const out = { generatedAt: new Date().toISOString(), url: URL }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(URL, { waitUntil: 'load' })
await wait(1000)
out.mediaQuery = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
// 1) 转场：动画/过渡被压到 0.001ms
await page.evaluate(
  ({ key }) =>
    localStorage.setItem(
      key,
      JSON.stringify({
        sceneId: 'night1',
        ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
        flags: [],
        pendingOutcome: null,
        pendingNext: null,
        picked: {},
        ending: null,
        startedAt: Date.now() - 60000,
        finishedAt: null,
      }),
    ),
  { key: SAVE_KEY },
)
await page.reload({ waitUntil: 'load' })
await wait(800)
await page.getByRole('button', { name: '继续上次' }).click()
await wait(1800)

out.scene = await page.evaluate(() => {
  const prose = document.querySelector('.scene .prose p')
  const tilt = document.querySelector('.stage-tilt')
  const particles = document.querySelector('canvas.particles')
  let particlePixels = null
  if (particles) {
    const ctx = particles.getContext('2d')
    const data = ctx.getImageData(0, 0, Math.min(particles.width, 64) || 1, Math.min(particles.height, 64) || 1).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1
    particlePixels = { w: particles.width, h: particles.height, paintedAlphaPixels: painted }
  }
  return {
    proseAnimation: prose ? getComputedStyle(prose).animationDuration : null,
    proseOpacity: prose ? getComputedStyle(prose).opacity : null,
    stageTiltTransition: tilt ? getComputedStyle(tilt).transitionDuration : null,
    particleCanvas: particlePixels,
    toggle3d: !!document.querySelector('.view3d-toggle'),
    toggle3dVisible: (() => {
      const t = document.querySelector('.view3d-toggle')
      return !!t && t.getBoundingClientRect().width > 0
    })(),
    canvas3d: !!document.querySelector('.stage-3d-layer canvas'),
    bodyHasCanvas3d: document.querySelectorAll('canvas').length,
  }
})
await page.screenshot({ path: join(SHOTS, 'rm-scene.png') })

// 2) 点击粒子：.choice-burst 被 display:none，且画布上没有像素
out.burst = await page.evaluate(() => {
  const burst = document.querySelector('.choice-burst')
  return { exists: !!burst, display: burst ? getComputedStyle(burst).display : null }
})
await page.locator('.choice').first().click()
await wait(500)
out.burstAfterClick = await page.evaluate(() => {
  const burst = document.querySelector('.choice-burst')
  if (!burst) return null
  const ctx = burst.getContext('2d')
  const data = ctx.getImageData(0, 0, Math.min(burst.width, 48) || 1, Math.min(burst.height, 48) || 1).data
  let painted = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1
  return { display: getComputedStyle(burst).display, paintedAlphaPixelsTopLeft: painted }
})
await page.locator('.continue').click()
await wait(2600)

// 3) 终极画面：reduced motion 下只画最后一帧，1.8s 后自动进正文
await page.evaluate(
  ({ key }) =>
    localStorage.setItem(
      key,
      JSON.stringify({
        sceneId: 'epilogue',
        ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
        flags: [],
        pendingOutcome: null,
        pendingNext: null,
        picked: {},
        ending: null,
        startedAt: Date.now() - 60000,
        finishedAt: null,
      }),
    ),
  { key: SAVE_KEY },
)
await page.reload({ waitUntil: 'load' })
await wait(700)
await page.getByRole('button', { name: '继续上次' }).click()
await wait(1800)
await page.locator('.choice').nth(0).click()
await wait(500)
const t0 = Date.now()
await page.locator('.continue').click()
await page.waitForSelector('.finale', { timeout: 12000 })
const finaleInfo = await page.evaluate(() => {
  const f = document.querySelector('.finale')
  const canvas = f.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const data = ctx.getImageData(0, 0, Math.min(canvas.width, 48) || 1, Math.min(canvas.height, 48) || 1).data
  let painted = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1
  return { canvasDisplay: getComputedStyle(canvas).display, skipText: f.querySelector('.finale-skip')?.textContent, paintedAlphaPixels: painted }
})
await page.screenshot({ path: join(SHOTS, 'rm-finale.png') })
await page.waitForSelector('.ending', { timeout: 12000 })
await wait(900)
out.finale = { ...finaleInfo, msFromContinueToEnding: Date.now() - t0, endingTitle: (await page.locator('.ending h1').innerText().catch(() => '')).trim() }
await page.screenshot({ path: join(SHOTS, 'rm-ending.png') })

out.errors = errors
writeFileSync(join(ROOT, 'tools/quality/reduced-motion.json'), JSON.stringify(out, null, 2), 'utf8')
await browser.close()

console.log('\n=== prefers-reduced-motion ===')
console.log('媒体查询命中:', out.mediaQuery)
console.log('场景:', JSON.stringify(out.scene, null, 1))
console.log('点击粒子（CSS）:', JSON.stringify(out.burst), '→ 点击后:', JSON.stringify(out.burstAfterClick))
console.log('终极画面:', JSON.stringify(out.finale))
console.log('错误:', errors.length ? errors.slice(0, 4) : 'none')
const pass =
  out.mediaQuery &&
  !out.scene.toggle3dVisible &&
  !out.scene.canvas3d &&
  out.scene.particleCanvas?.paintedAlphaPixels === 0 &&
  out.burst.display === 'none' &&
  out.burstAfterClick?.paintedAlphaPixelsTopLeft === 0 &&
  out.finale.canvasDisplay === 'none' &&
  out.finale.msFromContinueToEnding < 6000
console.log('PASS:', pass)
if (!pass) process.exitCode = 1
