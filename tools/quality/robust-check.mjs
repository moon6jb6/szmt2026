/**
 * 健壮性终审（无头 Chrome / Playwright），不改 src。
 *
 * 用法：node tools/quality/robust-check.mjs [url]
 * 输出：控制台报告 + tools/quality/robust.json + tools/quality/shots/robust-*.png
 *
 * 四个场景：
 *   1. 断网：abort 所有非本地请求后完整进入游戏并读一页；再模拟彻底断网（setOffline）看降级
 *   2. localStorage 被禁用（隐私模式/被策略拦截）时能否玩
 *   3. 快速连点选择 / 继续 / 从头开始：会不会抛错、会不会跳场或重复计分
 *   4. 窗口从 1440 缩到 390：3D 开关与布局
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
const browser = await chromium.launch({ channel: 'chrome' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function wire(page, bucket) {
  page.on('pageerror', (e) => bucket.errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => {
    if (m.type() === 'error') bucket.errors.push(m.text().slice(0, 200))
  })
  page.on('requestfailed', (r) => bucket.failed.push(`${r.method()} ${r.url().split('/').slice(-1)[0]} ${r.failure()?.errorText ?? ''}`))
}

// 读存档（localStorage 不可用时返回 null）
async function readSave(page) {
  return page
    .evaluate((key) => {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null')
      } catch {
        return null
      }
    }, SAVE_KEY)
    .catch(() => null)
}

// 场景页摘要
async function sceneInfo(page) {
  return {
    id: await page.locator('.scene').getAttribute('data-scene').catch(() => null),
    title: (await page.locator('.scene h1').innerText().catch(() => '')).trim(),
    proseChars: (await page.locator('.scene .prose').innerText().catch(() => '')).length,
    choices: await page.locator('.choice').count(),
    img: await page
      .evaluate(() => {
        const img = document.querySelector('.scene-image img')
        return img ? { ok: img.complete && img.naturalWidth > 0, w: img.naturalWidth, alt: img.getAttribute('alt') } : null
      })
      .catch(() => null),
  }
}

// ---------------------------------------------------------------- 1. 断网
async function runOfflineAbort() {
  const bucket = { errors: [], failed: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  wire(page, bucket)
  let externalRequests = 0
  await context.route('**/*', (route) => {
    const url = route.request().url()
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) || url.startsWith('data:') || url.startsWith('blob:')
    if (!local) {
      externalRequests += 1
      return route.abort()
    }
    return route.continue()
  })
  await page.goto(URL, { waitUntil: 'load' })
  await wait(900)
  await page.getByRole('button', { name: '从头开始' }).click()
  await page.waitForSelector('.scene', { timeout: 15000 })
  await wait(1800)
  const first = await sceneInfo(page)
  // 走两场，确认换场与图片都来自本地
  await page.locator('.choice').first().click()
  await wait(600)
  await page.locator('.continue').click()
  await wait(2400)
  const second = await sceneInfo(page)
  if (second.choices > 0) {
    await page.locator('.choice').first().click()
    await wait(600)
    await page.locator('.continue').click()
    await wait(2300)
  }
  const third = await sceneInfo(page)
  await page.screenshot({ path: join(SHOTS, 'robust-offline-abort.png') })
  // 史料库也能开
  await page.goto(URL, { waitUntil: 'load' })
  await wait(600)
  await page.getByRole('button', { name: '史料库' }).click()
  await wait(700)
  const sourcesCards = await page.locator('.source-entry').count()
  await context.close()
  return { externalRequests, scenes: [first, second, third], sourcesCards, ...bucket, pass: bucket.errors.length === 0 && externalRequests === 0 && first.proseChars > 100 }
}

async function runOfflineHard() {
  const bucket = { errors: [], failed: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  wire(page, bucket)
  await page.goto(URL, { waitUntil: 'load' })
  await wait(900)
  await page.getByRole('button', { name: '从头开始' }).click()
  await page.waitForSelector('.scene', { timeout: 15000 })
  await wait(2000)
  await context.setOffline(true)
  await page.locator('.choice').first().click()
  await wait(600)
  await page.locator('.continue').click()
  await wait(2400)
  const after = await sceneInfo(page)
  await page.screenshot({ path: join(SHOTS, 'robust-offline-hard.png') })
  await context.close()
  return { scene: after, failed: bucket.failed.slice(0, 6), errors: bucket.errors, note: 'setOffline 连本地资源也断，模拟「文件被移走」' }
}

// ---------------------------------------------------------------- 2. localStorage 被禁用
async function runNoStorage() {
  const bucket = { errors: [], failed: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    const boom = () => {
      const err = new Error('SecurityError: localStorage is disabled')
      err.name = 'SecurityError'
      throw err
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: boom,
      set: boom,
    })
  })
  const page = await context.newPage()
  wire(page, bucket)
  await page.goto(URL, { waitUntil: 'load' })
  await wait(1000)
  const menuButtons = await page.getByRole('button').count()
  await page.getByRole('button', { name: '从头开始' }).click()
  await page.waitForSelector('.scene', { timeout: 15000 })
  await wait(1800)
  const first = await sceneInfo(page)
  await page.locator('.choice').first().click()
  await wait(700)
  const outcomeShown = await page.locator('.continue').isVisible().catch(() => false)
  await page.locator('.continue').click()
  await wait(2400)
  const second = await sceneInfo(page)
  // 过程中 localStorage 确实不可用
  const storageReallyBlocked = await page.evaluate(() => {
    try {
      localStorage.setItem('qa-probe', '1')
      return false
    } catch {
      return true
    }
  })
  await page.screenshot({ path: join(SHOTS, 'robust-no-storage.png') })
  await context.close()
  return { menuButtons, first, outcomeShown, second, storageReallyBlocked, ...bucket, pass: bucket.errors.length === 0 && second.proseChars > 100 }
}

// ---------------------------------------------------------------- 3. 快速连点
async function runRapidClicks() {
  const bucket = { errors: [], failed: [] }
  // 基线：同一个选项只点 1 次，用它的账本当「正确值」
  const baselineContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const basePage = await baselineContext.newPage()
  await basePage.goto(URL, { waitUntil: 'load' })
  await wait(900)
  await basePage.getByRole('button', { name: '从头开始' }).click()
  await basePage.waitForSelector('.scene', { timeout: 15000 })
  await wait(2000)
  await basePage.locator('.choice').first().click()
  await wait(700)
  const baselineLedger = (await readSave(basePage))?.ledger
  await baselineContext.close()

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  wire(page, bucket)
  await page.goto(URL, { waitUntil: 'load' })
  await wait(900)
  // 连点「从头开始」5 次
  const startBtn = page.getByRole('button', { name: '从头开始' })
  await Promise.all([0, 1, 2, 3, 4].map(() => startBtn.click({ force: true, noWaitAfter: true }).catch(() => {})))
  await page.waitForSelector('.scene', { timeout: 15000 })
  await wait(2200)
  const afterStart = await sceneInfo(page)

  // 连点同一个选项 6 次：账本应该只加一次（与基线一致）
  const ledgerBefore = (await readSave(page))?.ledger
  const choice = page.locator('.choice').first()
  await Promise.all([0, 1, 2, 3, 4, 5].map(() => choice.click({ force: true, noWaitAfter: true }).catch(() => {})))
  await wait(900)
  const ledgerAfter = (await readSave(page))?.ledger
  const outcomeCount = await page.locator('.continue').count()

  // 连点「继续」6 次
  const before = await readSave(page)
  const cont = page.locator('.continue')
  await Promise.all([0, 1, 2, 3, 4, 5].map(() => cont.click({ force: true, noWaitAfter: true }).catch(() => {})))
  await wait(3200)
  const after = await readSave(page)
  const sceneAfter = await sceneInfo(page)
  await page.screenshot({ path: join(SHOTS, 'robust-rapid.png') })
  await context.close()
  return {
    afterStart,
    baselineLedger,
    ledgerBefore,
    ledgerAfter,
    ledgerMatchesSingleClick: JSON.stringify(baselineLedger) === JSON.stringify(ledgerAfter),
    outcomeCount,
    expectedNext: before?.pendingNext ?? null,
    advancedTo: after?.sceneId ?? null,
    skippedOneScene: before?.pendingNext === after?.sceneId,
    sceneAfter,
    ...bucket,
    pass: bucket.errors.length === 0 && JSON.stringify(baselineLedger) === JSON.stringify(ledgerAfter) && before?.pendingNext === after?.sceneId,
  }
}

// ---------------------------------------------------------------- 4. 390px 缩放
async function runResize() {
  const bucket = { errors: [], failed: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  wire(page, bucket)
  await page.goto(URL, { waitUntil: 'load' })
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
  await wait(1900)
  const desktopToggle = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
  await page.getByRole('button', { name: '3D 视角' }).click()
  await wait(1800)
  const desktop3d = await page.evaluate(() => !!document.querySelector('.stage-3d-layer canvas'))
  await page.screenshot({ path: join(SHOTS, 'robust-1440-3d.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await wait(1200)
  const afterResize = await page.evaluate(() => {
    const toggle = document.querySelector('.view3d-toggle')
    const canvas = document.querySelector('.stage-3d-layer canvas')
    const audio = document.querySelector('.audio-toggle')?.getBoundingClientRect()
    const scene = document.querySelector('.scene')?.getBoundingClientRect()
    return {
      toggleVisible: !!toggle && toggle.getBoundingClientRect().width > 0,
      toggleText: toggle?.textContent ?? null,
      ariaPressed: toggle?.getAttribute('aria-pressed') ?? null,
      canvas3dStillMounted: !!canvas,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      audioOverlapsScene: audio && scene ? audio.left < scene.right && audio.top < scene.bottom : null,
      sceneWidth: scene ? Math.round(scene.width) : null,
      proseChars: document.querySelector('.scene .prose')?.innerText.length ?? 0,
    }
  })
  await page.screenshot({ path: join(SHOTS, 'robust-390-after-3d.png') })

  // 换一场（触发重新渲染）后 3D 开关与画布是否按 390px 规则收起
  await page.locator('.choice').first().click().catch(() => {})
  await wait(600)
  await page.locator('.continue').click().catch(() => {})
  await wait(2600)
  const nextScene = await page.evaluate(() => ({
    toggleVisible: (() => {
      const t = document.querySelector('.view3d-toggle')
      return !!t && t.getBoundingClientRect().width > 0
    })(),
    canvas3d: !!document.querySelector('.stage-3d-layer canvas'),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  await page.screenshot({ path: join(SHOTS, 'robust-390-next-scene.png') })

  // 从 390 冷启动一遍（菜单 + 场景布局）
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page2 = await context2.newPage()
  const bucket2 = { errors: [], failed: [] }
  wire(page2, bucket2)
  await page2.goto(URL, { waitUntil: 'load' })
  await wait(1000)
  const mobileMenu = await page2.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))
  await page2.getByRole('button', { name: '从头开始' }).click()
  await page2.waitForSelector('.scene', { timeout: 15000 })
  await wait(2000)
  const mobileScene = await page2.evaluate(() => {
    const scene = document.querySelector('.scene')?.getBoundingClientRect()
    const audio = document.querySelector('.audio-toggle')?.getBoundingClientRect()
    return {
      toggle: !!document.querySelector('.view3d-toggle'),
      sceneWidth: scene ? Math.round(scene.width) : null,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      proseChars: document.querySelector('.scene .prose')?.innerText.length ?? 0,
      audioInViewport: audio ? audio.right <= window.innerWidth + 1 && audio.bottom <= window.innerHeight + 1 : null,
    }
  })
  await page2.screenshot({ path: join(SHOTS, 'robust-390-cold.png'), fullPage: false })
  await context2.close()

  await context.close()
  return { desktopToggle, desktop3d, afterResize, nextScene, mobileMenu, mobileScene, errors: bucket.errors, mobileErrors: bucket2.errors }
}

out.offlineAbort = await runOfflineAbort()
out.offlineHard = await runOfflineHard()
out.noStorage = await runNoStorage()
out.rapid = await runRapidClicks()
out.resize = await runResize()
writeFileSync(join(ROOT, 'tools/quality/robust.json'), JSON.stringify(out, null, 2), 'utf8')
await browser.close()

console.log('\n=== 1. 断网 ===')
console.log('非本地请求数（应为 0）:', out.offlineAbort.externalRequests)
console.log('场景链:', out.offlineAbort.scenes.map((s) => `${s.id}(${s.proseChars}字,${s.choices}选项,img=${s.img?.ok ? s.img.w + 'px' : '无'})`).join(' → '))
console.log('史料库卡片:', out.offlineAbort.sourcesCards, '| 错误:', out.offlineAbort.errors.length, '| 失败请求:', out.offlineAbort.failed.length, '| PASS:', out.offlineAbort.pass)
console.log('彻底断网（setOffline）:', JSON.stringify(out.offlineHard.scene), '| 失败请求:', out.offlineHard.failed, '| 错误:', out.offlineHard.errors.length)

console.log('\n=== 2. localStorage 被禁用 ===')
console.log('菜单按钮数:', out.noStorage.menuButtons, '| 真的被禁:', out.noStorage.storageReallyBlocked)
console.log('进入:', out.noStorage.first.id, '→ 结果页:', out.noStorage.outcomeShown, '→ 下一场:', out.noStorage.second.id, `(${out.noStorage.second.proseChars} 字, img=${out.noStorage.second.img?.ok})`)
console.log('错误:', out.noStorage.errors.length, '| PASS:', out.noStorage.pass)

console.log('\n=== 3. 快速连点 ===')
console.log('连点「从头开始」5 次后:', JSON.stringify(out.rapid.afterStart))
console.log('单点一次账本（基线）:', JSON.stringify(out.rapid.baselineLedger))
console.log('连点选项 6 次账本:', JSON.stringify(out.rapid.ledgerAfter), '| 与基线一致 =', out.rapid.ledgerMatchesSingleClick, '| 结果页按钮数:', out.rapid.outcomeCount)
console.log('连点「继续」6 次：期望', out.rapid.expectedNext, '实际', out.rapid.advancedTo, '| 只前进一场 =', out.rapid.skippedOneScene)
console.log('错误:', out.rapid.errors.length, JSON.stringify(out.rapid.errors.slice(0, 3)), '| PASS:', out.rapid.pass)

console.log('\n=== 4. 390px ===')
console.log('桌面 3D 开关:', out.resize.desktopToggle, '| 3D 画布:', out.resize.desktop3d)
console.log('缩到 390 后:', JSON.stringify(out.resize.afterResize))
console.log('再换一场后:', JSON.stringify(out.resize.nextScene))
console.log('390 冷启动菜单:', JSON.stringify(out.resize.mobileMenu))
console.log('390 冷启动场景:', JSON.stringify(out.resize.mobileScene))
console.log('错误:', out.resize.errors.length, out.resize.mobileErrors.length)
console.log('\nJSON → tools/quality/robust.json\n')
