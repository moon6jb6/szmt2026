/**
 * SceneHotspots 验收（Playwright + Vite dev server）
 *
 * 用法：
 *   node tools/scene-hotspots-test.mjs
 *   node tools/scene-hotspots-test.mjs --port 4293
 *
 * 它自己起一个 Vite dev server（默认 4293，独立 cacheDir，不碰 4173 / 5199 / dist），
 * 打开 tools/scene-hotspots-harness.html（真实 SceneHotspots + 真实热点数据 + 真实史料卡），
 * 跑完就关。不需要 GPU：热点模式里没有 3D，只有 public/scene-bg 下的静态 JPG。
 *
 * 覆盖：
 *   - 5 张背景图存在、HTTP 200、1920×1080、单张 180—450 KB、合计 ≤2.5 MB；
 *   - 每个 variant：热点数量 3—5、真实 <button>、aria-label = label、Tab 顺序、悬停墨圈 + 标签、
 *     点击开卡/再点关闭、已发现计数、全部发现后的「都看过了」、Esc 两级行为、史料卡回调、音效回执、
 *     视差 ±8px（背景 1.0 / 热点 0.45 倍）、标题区可读性（合成后亮度）、无 console error；
 *   - 390px：无横向溢出、点击区 ≥36px、窄卡底部通栏；
 *   - reduced-motion：无动画、无视差。
 *
 * 输出：控制台 PASS/FAIL + tools/shots/scene-hotspots/report.json + 每景两张截图 + 定位核对图
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = resolve(import.meta.dirname, '..')
const SHOTS = join(ROOT, 'tools/shots/scene-hotspots')
const BG_DIR = join(ROOT, 'public/scene-bg')
const portArg = process.argv.indexOf('--port')
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.SCENE_HOTSPOTS_PORT ?? 4293)
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

const VARIANTS = ['warehouse-int', 'warehouse-ext', 'rooftop', 'bridge', 'office-1947']
const MIN_KB = 180
const MAX_KB = 450
const TOTAL_KB = 2.5 * 1024

await mkdir(SHOTS, { recursive: true })

const checks = []
const consoleErrors = []
const assets = []
let shotIndex = 0

function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail })
  const body = detail === undefined ? '' : `   ${JSON.stringify(detail)}`
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${body}`)
}

function watch(page, tag) {
  page.on('pageerror', (error) => consoleErrors.push(`${tag} pageerror: ${String(error)}`))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${tag} console: ${message.text()}`)
  })
}

async function shot(page, name, options = {}) {
  shotIndex += 1
  const file = join(SHOTS, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, ...options })
  return { file, name }
}

/** 文案体检：1—2 句、每句 20—45 字（只数汉字与数字，不数标点）、不用套话 */
const CLICHE = ['仿佛', '彷彿', '好像', '宛如', '似乎', '不禁', '令人']
function textIssues(body) {
  const sentences = body
    .split(/[。！？]/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const counts = sentences.map((sentence) => {
    const cjk = sentence.match(/[\u4e00-\u9fff0-9]/gu)
    return cjk ? cjk.length : 0
  })
  const issues = []
  if (sentences.length < 1 || sentences.length > 2) issues.push(`句数 ${sentences.length}`)
  counts.forEach((count, index) => {
    if (count < 20 || count > 45) issues.push(`第 ${index + 1} 句 ${count} 字`)
  })
  for (const word of CLICHE) if (body.includes(word)) issues.push(`套话「${word}」`)
  return { issues, counts, sentences: sentences.length }
}

/** 在截图里量一块区域的平均亮度（0—255）；用来证明左上角标题区够暗 */
async function regionLuma(auxPage, buffer, box) {
  const base64 = buffer.toString('base64')
  return auxPage.evaluate(
    async ({ data, box: area }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const g = canvas.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      const x = Math.round(area.x)
      const y = Math.round(area.y)
      const w = Math.max(1, Math.round(area.w))
      const h = Math.max(1, Math.round(area.h))
      const { data: px } = g.getImageData(x, y, w, h)
      let sum = 0
      let count = 0
      for (let i = 0; i < px.length; i += 4) {
        sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
        count += 1
      }
      return Number((sum / Math.max(1, count)).toFixed(1))
    },
    { data: base64, box },
  )
}

const startedAt = Date.now()
const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.ts'),
  cacheDir: join(ROOT, 'node_modules/.vite-scene-hotspots'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: PORT, strictPort: false },
})
await server.listen()
const address = server.httpServer?.address()
const resolvedPort = typeof address === 'object' && address ? address.port : PORT
const origin = `http://127.0.0.1:${resolvedPort}`
const url = `${origin}/tools/scene-hotspots-harness.html`
console.log(`harness: ${url}`)

const browser = await chromium.launch({ channel: 'chrome' })
const checksByVariant = []
const shots = []
let exitCode = 0

try {
  // ============================ 1. 背景图资产 ============================
  let totalBytes = 0
  for (const variant of VARIANTS) {
    const file = join(BG_DIR, `${variant}.jpg`)
    let size = 0
    try {
      size = (await stat(file)).size
    } catch {
      check(`背景图 ${variant}.jpg 存在`, false, { file })
      continue
    }
    totalBytes += size
    const response = await fetch(`${origin}/scene-bg/${variant}.jpg`)
    const kb = Math.round(size / 1024)
    const ok = response.status === 200 && kb >= MIN_KB && kb <= MAX_KB
    assets.push({ variant, kb, status: response.status, bytes: size })
    check(`背景图 ${variant}.jpg 可访问（200）且在 180—450 KB`, ok, { kb, status: response.status })
  }
  const totalKb = Math.round(totalBytes / 1024)
  check(`五张背景图合计 ≤2.5 MB`, totalKb <= TOTAL_KB, { totalKb })

  // ============================ 2. 桌面端交互 ============================
  const desktop = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const auxPage = await desktop.newPage()
  await auxPage.goto('about:blank')

  for (const variant of VARIANTS) {
    const page = await desktop.newPage()
    watch(page, variant)
    await page.goto(`${url}?mode=hotspots&variant=${variant}`, { waitUntil: 'load' })
    await page.waitForSelector('.sh')
    await wait(320)
    const before = consoleErrors.length
    const issues = []

    const data = await page.evaluate(() => window.__sceneHotspots.hotspots)
    const verified = new Set(await page.evaluate(() => window.__sceneHotspots.verified.map((card) => card.id)))
    const expected = data[variant] ?? []

    // ---- 2.1 结构：背景图、热点数量、真实 button、aria-label ----
    const dom = await page.evaluate(() => {
      const root = document.querySelector('.sh')
      const img = document.querySelector('.sh-bg')
      const dots = [...document.querySelectorAll('.sh-dot')]
      return {
        root: Boolean(root),
        bgSrc: img?.getAttribute('src') ?? '',
        bgReady: Boolean(img && img.complete && img.naturalWidth > 0),
        bgSize: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
        count: dots.length,
        allButtons: dots.every((el) => el.tagName === 'BUTTON' && el.getAttribute('type') === 'button'),
        arias: dots.map((el) => el.getAttribute('aria-label')),
        ids: dots.map((el) => el.dataset.hotspot),
        labels: dots.map((el) => el.querySelector('.sh-label')?.textContent ?? ''),
        countText: document.querySelector('.sh-count')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
        exitText: document.querySelector('.sh-exit')?.textContent?.trim() ?? '',
      }
    })

    const countOk = expected.length >= 3 && expected.length <= 5 && dom.count === expected.length
    check(`[${variant}] 热点 ${expected.length} 个（3—5）且全部渲染`, countOk, { dom: dom.count, data: expected.length })
    check(
      `[${variant}] 背景图加载 1920×1080（${dom.bgSrc}）`,
      dom.bgReady && dom.bgSize?.w === 1920 && dom.bgSize?.h === 1080,
      dom.bgSize,
    )
    check(
      `[${variant}] 热点是真实 <button>，aria-label = label，顺序与数据一致`,
      dom.allButtons && expected.every((spot, index) => dom.arias[index] === spot.label && dom.ids[index] === spot.id),
      { arias: dom.arias.slice(0, 3) },
    )
    check(`[${variant}] 计数初始为「已发现 0 / ${expected.length}」`, dom.countText === `已发现 0 / ${expected.length}`, dom.countText)
    check(`[${variant}] 右上角是「返回正文」`, dom.exitText === '返回正文', dom.exitText)

    // ---- 2.2 文案与史料卡 ----
    const textResults = expected.map((spot) => ({ id: spot.id, ...textIssues(spot.body) }))
    const textBad = textResults.filter((item) => item.issues.length > 0)
    check(`[${variant}] 文案：1—2 句、每句 20—45 字、无套话`, textBad.length === 0, textBad.length ? textBad : undefined)
    const sourceIds = expected.filter((spot) => spot.sourceId).map((spot) => spot.sourceId)
    const sourceBad = sourceIds.filter((id) => !verified.has(id))
    check(
      `[${variant}] ${sourceIds.length} 个 sourceId 全部是 verified 史料卡`,
      sourceBad.length === 0,
      { sourceIds, bad: sourceBad },
    )

    // ---- 2.3 悬停：墨圈 + 标签浮出 ----
    const first = expected[0]
    const firstBox = await page.locator(`[data-hotspot="${first.id}"]`).boundingBox()
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
    await wait(260)
    const hover = await page.evaluate((id) => {
      const dot = document.querySelector(`[data-hotspot="${id}"]`)
      const spot = dot.querySelector('.sh-spot')
      const label = dot.querySelector('.sh-label')
      return {
        spot: spot.getBoundingClientRect().width,
        spotOpacity: Number(getComputedStyle(spot).opacity),
        labelOpacity: Number(getComputedStyle(label).opacity),
        labelLines: Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight)),
        labelAbove: label.getBoundingClientRect().bottom <= dot.getBoundingClientRect().top + 2,
      }
    }, first.id)
    check(
      `[${variant}] 悬停扩散成墨圈（≥24px）且标签浮出、位于点上方（≤2 行）`,
      hover.spot >= 24 && hover.spotOpacity > 0.9 && hover.labelOpacity > 0.9 && hover.labelAbove && hover.labelLines <= 2,
      hover,
    )
    await page.mouse.move(4, 4)
    await wait(240)

    // ---- 2.4 未发现墨点呼吸 6%—14% ----
    const breatheA = await page.evaluate(
      (id) => Number(getComputedStyle(document.querySelector(`[data-hotspot="${id}"] .sh-spot`)).opacity),
      first.id,
    )
    await wait(1300)
    const breatheB = await page.evaluate(
      (id) => Number(getComputedStyle(document.querySelector(`[data-hotspot="${id}"] .sh-spot`)).opacity),
      first.id,
    )
    const breatheMin = Math.min(breatheA, breatheB)
    const breatheMax = Math.max(breatheA, breatheB)
    check(
      `[${variant}] 未发现墨点呼吸 opacity 落在 6%—14%（有起伏）`,
      breatheMin >= 0.055 && breatheMax <= 0.145 && breatheMax - breatheMin > 0.005,
      { a: breatheA, b: breatheB },
    )

    // ---- 2.5 视差：背景 ±8px、热点层 0.45 倍 ----
    await page.mouse.move(1599, 899)
    await wait(420)
    const parallax = await page.evaluate(() => {
      const read = (selector) => {
        const matrix = getComputedStyle(document.querySelector(selector)).transform
        const parts = matrix.startsWith('matrix') ? matrix.slice(matrix.indexOf('(') + 1, -1).split(',').map(Number) : [1, 0, 0, 1, 0, 0]
        return { x: Number(parts[4].toFixed(2)), y: Number(parts[5].toFixed(2)) }
      }
      return { bg: read('.sh-bg'), fg: read('.sh-fg') }
    })
    const bgAmp = Math.max(Math.abs(parallax.bg.x), Math.abs(parallax.bg.y))
    const fgAmp = Math.max(Math.abs(parallax.fg.x), Math.abs(parallax.fg.y))
    check(
      `[${variant}] 视差：背景≈±8px、热点层≈±3.6px（两层幅度不同）`,
      bgAmp > 7.4 && bgAmp <= 8.2 && fgAmp > 3.2 && fgAmp < 3.9 && Math.abs(fgAmp / bgAmp - 0.45) < 0.06,
      { bg: parallax.bg, fg: parallax.fg },
    )
    await page.mouse.move(800, 450)
    await wait(260)

    // ---- 2.6 点击开卡 ----
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
    await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
    await wait(360)
    const opened = await page.evaluate((id) => {
      const card = document.querySelector('.sh-card')
      const dot = document.querySelector(`[data-hotspot="${id}"]`)
      const rect = card?.getBoundingClientRect()
      return {
        exists: Boolean(card),
        width: rect ? Math.round(rect.width) : 0,
        bottomGap: rect ? Math.round(window.innerHeight - rect.bottom) : -1,
        label: card?.querySelector('.sh-card-label')?.textContent ?? '',
        body: card?.querySelector('.sh-card-body')?.textContent ?? '',
        hasSourceButton: Boolean(card?.querySelector('.sh-card-src')),
        expanded: dot?.getAttribute('aria-expanded'),
        found: dot?.dataset.found,
        count: document.querySelector('.sh-count')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
        sounds: window.__sceneHotspots.sounds.slice(),
      }
    }, first.id)
    check(
      `[${variant}] 点击打开窄卡（宽 280—340、标题与正文一致、aria-expanded=true）`,
      opened.exists && opened.width >= 280 && opened.width <= 340 && opened.label === first.label && opened.body === first.body && opened.expanded === 'true',
      { width: opened.width, label: opened.label, bodyLength: opened.body.length },
    )
    check(
      `[${variant}] 已发现计数 +1、热点变淡金印点（data-found=1）`,
      opened.found === '1' && opened.count === `已发现 1 / ${expected.length}`,
      { found: opened.found, count: opened.count },
    )
    check(`[${variant}] 点击有音效回执（ink）`, opened.sounds.includes('ink'), opened.sounds)
    check(
      `[${variant}] 有史料卡的热点才有「查看史料卡」`,
      opened.hasSourceButton === Boolean(first.sourceId),
      { has: opened.hasSourceButton, sourceId: first.sourceId ?? null },
    )

    shots.push(await shot(page, `${variant}-card`))

    // ---- 2.7 史料卡回调 ----
    if (first.sourceId) {
      await page.click('.sh-card-src')
      await wait(120)
      const sources = await page.evaluate(() => window.__sceneHotspots.sources.slice())
      check(`[${variant}] 「查看史料卡」回调收到 ${first.sourceId}`, sources.includes(first.sourceId), sources)
    }

    // ---- 2.8 再点关闭 ----
    await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
    await wait(300)
    const closed = await page.evaluate(() => ({
      card: Boolean(document.querySelector('.sh-card')),
      sounds: window.__sceneHotspots.sounds.slice(),
    }))
    check(
      `[${variant}] 再点同一点关闭窄卡（paper 音）`,
      !closed.card && closed.sounds.includes('paper'),
      { sounds: closed.sounds },
    )

    // ---- 2.9 Tab 遍历：从「返回正文」开始按 Tab，逐个走完热点 ----
    // （先显式聚焦 .sh-exit，否则浏览器会从上次点击的点继续找下一个可聚焦元素）
    await page.locator('.sh-exit').focus()
    const order = []
    for (let i = 0; i < expected.length; i += 1) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        return {
          cls: typeof el.className === 'string' ? el.className : '',
          label: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
          hotspot: el.dataset?.hotspot ?? null,
          outline: getComputedStyle(el).outlineStyle,
          outlineWidth: getComputedStyle(el).outlineWidth,
        }
      })
      if (!info) break
      order.push(info)
    }
    const hotspotOrder = order.filter((item) => item.hotspot).map((item) => item.hotspot)
    check(
      `[${variant}] Tab 依次遍历 ${expected.length} 个热点（顺序一致、中间无跳点）`,
      JSON.stringify(hotspotOrder) === JSON.stringify(expected.map((spot) => spot.id)) && order.every((item) => item.hotspot),
      hotspotOrder,
    )
    const dotFocus = order.filter((item) => item.hotspot)
    check(
      `[${variant}] 聚焦可见（热点 outline 实线）`,
      dotFocus.length > 0 && dotFocus.every((item) => item.outline === 'solid' && parseFloat(item.outlineWidth) >= 1),
      dotFocus.slice(0, 2),
    )

    // ---- 2.10 Enter 打开、Esc 两级 ----
    await page.evaluate(async (id) => {
      const dot = document.querySelector(`[data-hotspot="${id}"]`)
      dot.focus()
      window.__sceneHotspots.exits = 0
    }, expected[1].id)
    await page.keyboard.press('Enter')
    await wait(300)
    const enterOpened = await page.evaluate(() => Boolean(document.querySelector('.sh-card')))
    await page.keyboard.press('Escape')
    await wait(260)
    const escOne = await page.evaluate(() => ({
      card: Boolean(document.querySelector('.sh-card')),
      exits: window.__sceneHotspots.exits,
    }))
    await page.keyboard.press('Escape')
    await wait(220)
    const escTwo = await page.evaluate(() => window.__sceneHotspots.exits)
    check(
      `[${variant}] Enter 开卡、第一次 Esc 关卡（不退出）、第二次 Esc 退出`,
      enterOpened && !escOne.card && escOne.exits === 0 && escTwo === 1,
      { enterOpened, escOne, escTwo },
    )

    // ---- 2.11 全部发现 ----
    await page.evaluate(() => window.__sceneHotspots.remount())
    await wait(300)
    for (const spot of expected) {
      await page.click(`[data-hotspot="${spot.id}"]`)
      await wait(160)
    }
    const allFound = await page.evaluate(() => ({
      count: document.querySelector('.sh-count')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      done: document.querySelector('.sh-done')?.textContent?.trim() ?? '',
      found: [...document.querySelectorAll('.sh-dot')].map((el) => el.dataset.found),
    }))
    check(
      `[${variant}] 全部发现：计数到顶 + 角落出现「都看过了」`,
      allFound.count === `已发现 ${expected.length} / ${expected.length}` && allFound.done === '都看过了' && allFound.found.every((flag) => flag === '1'),
      { count: allFound.count, done: allFound.done },
    )
    // 关掉最后一张卡再截图：全发现状态本身不弹窗
    await page.keyboard.press('Escape')
    await wait(220)
    shots.push(await shot(page, `${variant}-allfound`))

    // ---- 2.12 全景 + 标题区亮度 ----
    await page.evaluate(() => window.__sceneHotspots.remount())
    await wait(420)
    // 墨点在 6%—14% 之间呼吸：等它走到接近峰值的相位再截，否则截图正好落在低谷，
    // 看上去像「页面上没有热点」（这只是一次对相位的等待，不改任何样式）
    await page
      .waitForFunction(
        () => {
          const spot = document.querySelector('.sh-spot')
          return spot ? Number(getComputedStyle(spot).opacity) >= 0.128 : true
        },
        null,
        { timeout: 8000, polling: 'raf' },
      )
      .catch(() => {})
    const wide = await shot(page, `${variant}-wide`)
    shots.push(wide)
    const luma = await regionLuma(auxPage, await readFile(wide.file), { x: 8, y: 6, w: 168, h: 16 })
    check(`[${variant}] 左上标题区合成后够暗（平均亮度 ≤60，纸色白字可读）`, luma <= 60, { luma })

    // ---- 2.13 定位核对图（把点放大显示，人工看一遍）----
    await page.addStyleTag({
      content:
        '.sh-spot{opacity:.95!important;animation:none!important;width:16px!important;height:16px!important;margin:-8px 0 0 -8px!important;border-radius:50%!important;background:#f2e6c6!important;box-shadow:0 0 0 2px #16130f!important}' +
        '.sh-label{opacity:1!important;transform:translate(-50%,0)!important}',
    })
    await wait(180)
    shots.push(await shot(page, `${variant}-map`))

    check(`[${variant}] 无 console error / pageerror`, consoleErrors.length === before, consoleErrors.slice(before))
    checksByVariant.push({ variant, hotspots: expected.length, sources: sourceIds.length, checks: checks.length })

    await page.close()
  }

  // ============================ 3. 390px 移动端 ============================
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  })
  for (const variant of ['warehouse-ext', 'office-1947']) {
    const page = await mobile.newPage()
    watch(page, `${variant}-390`)
    await page.goto(`${url}?mode=hotspots&variant=${variant}`, { waitUntil: 'load' })
    await page.waitForSelector('.sh')
    await wait(320)
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.sh')
      const dots = [...document.querySelectorAll('.sh-dot')]
      return {
        overflowX: root.scrollWidth - root.clientWidth,
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        minW: Math.min(...dots.map((el) => el.getBoundingClientRect().width)),
        minH: Math.min(...dots.map((el) => el.getBoundingClientRect().height)),
        inside: dots.every((el) => {
          const rect = el.getBoundingClientRect()
          return rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5
        }),
      }
    })
    check(
      `[${variant}@390] 无横向溢出`,
      metrics.overflowX <= 0 && metrics.docOverflow <= 0 && metrics.inside,
      metrics,
    )
    check(`[${variant}@390] 热点点击区 ≥36px`, metrics.minW >= 36 && metrics.minH >= 36, { w: metrics.minW, h: metrics.minH })

    const firstMobileId = await page.evaluate((key) => window.__sceneHotspots.hotspots[key][0].id, variant)
    await page.tap(`[data-hotspot="${firstMobileId}"]`)
    await wait(340)
    const card = await page.evaluate(() => {
      const el = document.querySelector('.sh-card')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        width: Math.round(rect.width),
        left: Math.round(rect.left),
        bottomGap: Math.round(window.innerHeight - rect.bottom),
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
    check(
      `[${variant}@390] 窄卡改底部通栏（宽≈390、贴底、仍不溢出）`,
      Boolean(card) && card.width >= 380 && card.left <= 1 && card.bottomGap <= 1 && card.docOverflow <= 0,
      card,
    )
    shots.push(await shot(page, `${variant}-390-card`))
    await page.close()
  }

  // ============================ 4. reduced motion ============================
  {
    const page = await desktop.newPage()
    watch(page, 'reduced')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${url}?mode=hotspots&variant=rooftop&reduce=1`, { waitUntil: 'load' })
    await page.waitForSelector('.sh')
    await wait(260)
    const reduced = await page.evaluate(() => {
      const spot = document.querySelector('.sh-spot')
      const card = document.querySelector('.sh-card')
      const root = document.querySelector('.sh')
      return {
        attr: root.dataset.reduce,
        spotAnimation: getComputedStyle(spot).animationName,
        spotTransition: getComputedStyle(spot).transitionDuration,
        bgTransition: getComputedStyle(document.querySelector('.sh-bg')).transitionDuration,
        cardAnimation: card ? getComputedStyle(card).animationName : 'none',
      }
    })
    await page.mouse.move(1599, 899)
    await wait(360)
    const stillTransform = await page.evaluate(() => {
      const matrix = getComputedStyle(document.querySelector('.sh-bg')).transform
      const parts = matrix.startsWith('matrix') ? matrix.slice(matrix.indexOf('(') + 1, -1).split(',').map(Number) : [1, 0, 0, 1, 0, 0]
      return { x: Number(parts[4].toFixed(2)), y: Number(parts[5].toFixed(2)) }
    })
    check(
      '[reduced-motion] 呼吸动画/过渡被关掉（animation:none、transition 0s）',
      reduced.attr === '1' && reduced.spotAnimation === 'none' && parseFloat(reduced.bgTransition) === 0,
      reduced,
    )
    check('[reduced-motion] 指针移动不产生视差（translate 保持 0）', stillTransform.x === 0 && stillTransform.y === 0, stillTransform)
    await page.mouse.click(200, 300)
    await wait(60)
    await page.keyboard.press('Escape')
    shots.push(await shot(page, 'reduced-motion'))
    await page.close()
  }

  await desktop.close()
  await mobile.close()

  check('没有任何 console error / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 4))
} catch (error) {
  check(`测试脚本自身异常：${String(error && error.message)}`, false, String(error && error.stack).slice(0, 400))
  exitCode = 1
} finally {
  await browser.close()
  await server.close()
}

const failed = checks.filter((item) => !item.pass)
if (failed.length > 0) exitCode = 1

const report = {
  ranAt: new Date().toISOString(),
  elapsedMs: Date.now() - startedAt,
  viewport: { desktop: '1600×900（16:9，与背景图同比例）', mobile: '390×844' },
  assets,
  totalAssetsKb: Math.round(assets.reduce((sum, item) => sum + item.kb, 0)),
  checks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  failures: failed,
  consoleErrors,
  screenshots: shots.map((item) => item.file.replace(`${ROOT}\\`, '')),
  details: checks,
}
await writeFile(join(SHOTS, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log('')
console.log(`通过 ${report.passed} / ${checks.length}   用时 ${Math.round((Date.now() - startedAt) / 1000)}s`)
console.log(`截图与报告：${SHOTS}`)
if (failed.length > 0) {
  console.log('\n未通过：')
  for (const item of failed) console.log(` - ${item.name}`)
}
process.exitCode = exitCode
