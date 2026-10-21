import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 《把名字留下来》动效与交互反馈核查（动画形式 / 反馈 / 性能 / 降级）
 *
 * 用法：
 *   node tools/anim-check.mjs http://127.0.0.1:4173/
 *   node tools/anim-check.mjs http://127.0.0.1:5199/ --only=discover   # 仅 dev：列出各天气场景样本
 *   node tools/anim-check.mjs <url> --only=menu,curtain,burst,finale,focus,perf,diag,consistency
 *   node tools/anim-check.mjs <url> --headed                          # 有头（真 GPU），性能数字以此为准
 *
 * 产物：
 *   docs/report/anim-shots/*.png    取证帧（时间点对齐到点击/换场，不是随手截一张）
 *   docs/report/anim-check.json     全部测量原始数据
 * 只读页面、不改源码；唯一写入是上面的截图与 json。
 */

const args = process.argv.slice(2)
const url = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4173/'
const only = args
  .filter((a) => a.startsWith('--only='))
  .flatMap((a) => a.slice('--only='.length).split(','))
  .filter(Boolean)
const headed = args.includes('--headed')
const SECTIONS = only.length ? only : ['menu', 'curtain', 'burst', 'finale', 'focus', 'perf', 'consistency', 'luma']

const ROOT = path.join(fileURLToPath(new URL('../', import.meta.url)))
const OUT = path.join(ROOT, 'docs', 'report', 'anim-shots')
await mkdir(OUT, { recursive: true })

const SAVE_KEY = 'names-ledger-v1'
const report = { url, headed, startedAt: new Date().toISOString(), sections: {}, errors: [] }

const PROBE_SRC = `
  window.__rafProbe = {
    frames: [], on: false, last: 0, pending: new Set(),
    install() {
      const orig = window.requestAnimationFrame.bind(window)
      const cancel = window.cancelAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb) => {
        const id = orig((ts) => { this.pending.delete(id); cb(ts) })
        this.pending.add(id)
        return id
      }
      window.cancelAnimationFrame = (id) => { this.pending.delete(id); cancel(id) }
    },
    start() { this.frames = []; this.on = true; this.last = 0;
      const loop = (ts) => { if (!this.on) return; if (this.last) this.frames.push(ts - this.last); this.last = ts; requestAnimationFrame(loop) }
      requestAnimationFrame(loop) },
    stop() { this.on = false; return this.frames },
    pendingCount() { return this.pending.size },
  }
  window.__rafProbe.install()
`

const browser = await chromium.launch({ channel: 'chrome', headless: !headed })

let context
let page
const attach = (p) => {
  p.on('pageerror', (e) => report.errors.push(String(e)))
  p.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
}
const useContext = async (options = {}) => {
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, ...options })
  await context.addInitScript(PROBE_SRC)
  page = await context.newPage()
  attach(page)
}

const sleep = (ms) => page.waitForTimeout(ms)
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name) })
  return `docs/report/anim-shots/${name}`
}
const savePng = async (name, base64) => {
  await writeFile(path.join(OUT, name), Buffer.from(base64, 'base64'))
  return `docs/report/anim-shots/${name}`
}

const stats = (frames) => {
  if (!frames || !frames.length) return null
  const s = [...frames].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  const sum = frames.reduce((a, b) => a + b, 0)
  const long = frames.filter((d) => d > 20).length
  return {
    n: frames.length,
    avgFps: +(1000 / (sum / frames.length)).toFixed(1),
    p50: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    droppedPct: +((long / frames.length) * 100).toFixed(1),
  }
}

const probeStart = () => page.evaluate(() => window.__rafProbe.start())
const probeStop = () => page.evaluate(() => window.__rafProbe.stop())
const rafPending = () => page.evaluate(() => window.__rafProbe.pendingCount())

const startCast = async () => {
  const cdp = await context.newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', (event) => {
    frames.push({ t: event.metadata.timestamp * 1000, data: event.data })
    cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 960, maxHeight: 600, everyNthFrame: 1 })
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {})
      await cdp.detach().catch(() => {})
    },
  }
}
const nearestFrame = (frames, target) =>
  frames.reduce((best, f) => (Math.abs(f.t - target) < Math.abs(best.t - target) ? f : best), frames[0])

/** 一帧的亮度分位：换场有没有遮住内容，看分位数（文字会把 p95 顶上去），不看均值 */
const frameLuma = async (dataUrl) =>
  page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const w = 160
    const h = 100
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    const all = ctx.getImageData(0, 0, w, h).data
    const luma = (x0, x1, y0, y1) => {
      const out = []
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * w + x) * 4
          out.push(0.2126 * all[i] + 0.7152 * all[i + 1] + 0.0722 * all[i + 2])
        }
      }
      out.sort((a, b) => a - b)
      const q = (p) => Math.round(out[Math.min(out.length - 1, Math.floor(out.length * p))])
      return { mean: Math.round(out.reduce((a, b) => a + b, 0) / out.length), p50: q(0.5), p95: q(0.95), max: q(0.999) }
    }
    return {
      full: luma(0, w, 0, h),
      center: luma(Math.round(w * 0.22), Math.round(w * 0.78), Math.round(h * 0.12), Math.round(h * 0.9)),
    }
  }, dataUrl)

const canvasInk = async (selector, size = 800) =>
  page.evaluate(
    ({ sel, size }) => {
      const canvas = document.querySelector(sel)
      if (!canvas || !(canvas instanceof HTMLCanvasElement) || !canvas.width) return null
      if (getComputedStyle(canvas).display === 'none') {
        return { hidden: true, drawnPx: 0, drawnRatio: 0, opaqueRatio: 0, mean: [0, 0, 0] }
      }
      const w = size
      const h = Math.max(1, Math.round((size * canvas.height) / canvas.width))
      const sample = document.createElement('canvas')
      sample.width = w
      sample.height = h
      const ctx = sample.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(canvas, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      let drawn = 0
      let opaque = 0
      let r = 0
      let g = 0
      let b = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 12) {
          drawn += 1
          if (data[i + 3] > 240) opaque += 1
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
        }
      }
      return {
        hidden: false,
        drawnPx: drawn,
        drawnRatio: +(drawn / (w * h)).toFixed(4),
        opaqueRatio: +(opaque / (w * h)).toFixed(4),
        mean: drawn ? [Math.round(r / drawn), Math.round(g / drawn), Math.round(b / drawn)] : [0, 0, 0],
      }
    },
    { sel: selector, size },
  )

const injectSave = async (state) =>
  page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SAVE_KEY, value: state })

const baseState = (patch) => ({
  sceneId: 'v0-01',
  ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60_000,
  finishedAt: null,
  ...patch,
})

const clearSave = async () => {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
}
const resumeWith = async (state) => {
  await clearSave()
  await injectSave(state)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '继续上次' }).click({ timeout: 5000 })
}

const sceneTitle = () => page.locator('.scene-title').innerText().catch(() => '')
const waitFor = async (selector, timeout = 12000) => {
  const t0 = Date.now()
  for (let i = 0; i < timeout / 50; i += 1) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return Date.now() - t0
    await sleep(50)
  }
  return null
}
const waitGone = async (selector, timeout = 12000) => {
  const t0 = Date.now()
  for (let i = 0; i < timeout / 50; i += 1) {
    if ((await page.locator(selector).count()) === 0) return Date.now() - t0
    await sleep(50)
  }
  return null
}

/** 等幕布静息，同时记录换场发生的时间 */
const waitTransition = async (limit = 6000) => {
  const t0 = Date.now()
  let titleAtStart = null
  let swapAt = null
  for (let i = 0; i < limit / 20; i += 1) {
    const state = await page.evaluate(() => ({
      title: document.querySelector('.scene-title')?.textContent ?? '',
      live: document.querySelector('.ink-curtain')?.getAttribute('data-live') ?? 'none',
    }))
    if (titleAtStart === null) titleAtStart = state.title
    if (swapAt === null && state.title !== titleAtStart) swapAt = Date.now() - t0
    if (state.live === '0') return { endMs: Date.now() - t0, swapMs: swapAt, titleAtStart }
    await sleep(20)
  }
  return { endMs: null, swapMs: swapAt, titleAtStart }
}

await useContext()

// ---------------------------------------------------------------------------
// 0. 场景样本发现（只在 dev 上跑：vite 直接给 TS 模块）
// ---------------------------------------------------------------------------
if (SECTIONS.includes('discover')) {
  await page.goto(url, { waitUntil: 'networkidle' })
  const found = await page.evaluate(async () => {
    const reg = await import('/src/game/content/registry.ts')
    const scenes = reg.SCENES
    const out = {}
    for (const id of Object.keys(scenes)) {
      const s = scenes[id]
      const next = s.continueTo ?? s.choices?.[0]?.next ?? null
      if (!next) continue
      ;(out[s.weather] ??= []).push({ id, next, chapter: s.chapter, title: s.title })
    }
    return out
  })
  report.sections.discover = found
  for (const [weather, list] of Object.entries(found)) console.log(weather, list.length, list.slice(0, 2))
}

if (SECTIONS.some((s) => s !== 'discover')) console.log('url:', url, '| sections:', SECTIONS.join(','))

// ---------------------------------------------------------------------------
// 1. 入场：菜单 / 章节卡 / 正文段落错峰
// ---------------------------------------------------------------------------
if (SECTIONS.includes('menu')) {
  await clearSave()
  const menuAnim = await page.evaluate(() => {
    const el = document.querySelector('.menu')
    const cs = el ? getComputedStyle(el) : null
    return {
      animation: cs ? `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction}` : null,
      children: [...document.querySelectorAll('.menu > *')].map((node) => {
        const s = getComputedStyle(node)
        return { cls: node.className || node.tagName, anim: s.animationName, delay: s.animationDelay, dur: s.animationDuration }
      }),
    }
  })
  await shot('menu-900.png')

  // 正文段落错峰：注入到有插画的序卷第一场，看首段进入
  await resumeWith(baseState({ sceneId: 'v0-01' }))
  const para = await page.evaluate(() =>
    [...document.querySelectorAll('.prose p')].map((p) => ({
      delay: getComputedStyle(p).animationDelay,
      dur: getComputedStyle(p).animationDuration,
      name: getComputedStyle(p).animationName,
    })),
  )
  const headAnim = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { anim: cs.animationName, dur: cs.animationDuration, delay: cs.animationDelay }
    }
    return {
      chapter: pick('.scene-head .chapter'),
      title: pick('.scene-title'),
      meta: pick('.scene-meta'),
      image: pick('.scene-image'),
    }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '继续上次' }).click({ timeout: 5000 })
  await sleep(120)
  const paraEarly = await page.evaluate(() =>
    [...document.querySelectorAll('.prose p')].map((p) => +getComputedStyle(p).opacity.slice(0, 4)),
  )
  await shot('scene-enter-120.png')
  await sleep(420)
  const paraMid = await page.evaluate(() =>
    [...document.querySelectorAll('.prose p')].map((p) => +getComputedStyle(p).opacity.slice(0, 4)),
  )
  await shot('scene-enter-560.png')

  // 换下一场（墨迹幕之后）：同一批 <p> 不会重新挂载，CSS 动画还会不会重播？
  await page.locator('.choice').first().click()
  await sleep(300)
  await page.locator('.continue').click()
  await sleep(2600)
  const afterTransition = await page.evaluate(() => ({
    screen: document.querySelector('.scene')
      ? `scene:${document.querySelector('.scene').dataset.scene}`
      : document.querySelector('.ending')
        ? 'ending'
        : document.querySelector('.menu')
          ? 'menu'
          : 'other',
    title: document.querySelector('.scene-title')?.textContent ?? '',
    proseCount: document.querySelectorAll('.prose p').length,
    running: document.getAnimations().filter((a) => a.playState === 'running').length,
    paraOpacity: [...document.querySelectorAll('.prose p')].map((p) => +getComputedStyle(p).opacity.slice(0, 4)),
    sceneAnim: document.getAnimations().filter((a) => a.effect?.target?.className === 'scene').length,
  }))
  report.sections.menu = { menuAnim, para, headAnim, paraEarly, paraMid, afterTransition }
  console.log('menu anim:', menuAnim.animation, '| children with anim:', menuAnim.children.filter((c) => c.anim !== 'none').length)
  console.log('para delays:', para.map((p) => p.delay).join(' '))
  console.log('early opacity:', paraEarly.join(' '), '| @560ms:', paraMid.join(' '))
  console.log('scene-head anim:', JSON.stringify(headAnim))
  console.log('after transition:', JSON.stringify(afterTransition))
}

// ---------------------------------------------------------------------------
// 2. 五种换场：真实场景逐个触发；量时长、换场帧是否遮住内容、连点是否跳场
// ---------------------------------------------------------------------------
const CURTAIN_FIXTURES = [
  { variant: 'ink', scene: 'v1-01', next: 'v1-02' },
  { variant: 'rain', scene: 'night2', next: 'v2-10' },
  { variant: 'snow', scene: 'prologue', next: 'v1-01' },
  { variant: 'ash', scene: 'night1', next: 'v2-01' },
  { variant: 'smoke', scene: 'night3', next: 'night3b' },
]
const curtainState = (fx) =>
  baseState({
    sceneId: fx.scene,
    pendingOutcome: { paragraphs: ['换场测试：这一页只用来触发墨迹幕。'], gain: {} },
    pendingNext: fx.next,
    picked: { [fx.scene]: 'test' },
  })

if (SECTIONS.includes('curtain')) {
  const rows = []
  for (const fx of CURTAIN_FIXTURES) {
    // 取帧：录像，再按点击时刻选帧
    await resumeWith(curtainState(fx))
    await sleep(700)
    await page.locator('.continue').waitFor({ state: 'visible', timeout: 5000 })
    const titleBefore = await sceneTitle()
    const cast = await startCast()
    await sleep(120)
    await page.locator('.continue').click()
    const tClick = Date.now()
    const timingCast = await waitTransition()
    await sleep(150)
    await cast.stop()
    const framesTimed = cast.frames.map((f) => ({ t: f.t - tClick, data: f.data }))
    const pickAt = async (target, name) => {
      if (!framesTimed.length) return null
      const frame = nearestFrame(framesTimed, target)
      const file = await savePng(name, frame.data)
      return { at: Math.round(frame.t), file, luma: await frameLuma(`data:image/png;base64,${frame.data}`) }
    }
    const cover = await pickAt((timingCast.swapMs ?? 900) - 240, `curtain-${fx.variant}-cover.png`)
    const hold = await pickAt((timingCast.swapMs ?? 900) + 70, `curtain-${fx.variant}-hold.png`)
    const reveal = await pickAt(((timingCast.swapMs ?? 900) + (timingCast.endMs ?? 2090)) / 2, `curtain-${fx.variant}-reveal.png`)

    // 计时：不截图，避免数百毫秒误差
    await resumeWith(curtainState(fx))
    await sleep(700)
    await page.locator('.continue').waitFor({ state: 'visible', timeout: 5000 })
    await probeStart()
    await page.locator('.continue').click()
    const timing = await waitTransition()
    const frames = await probeStop()
    const titleAfter = await sceneTitle()
    rows.push({
      variant: fx.variant,
      from: fx.scene,
      to: fx.next,
      titleBefore,
      titleAfter,
      moved: titleAfter !== titleBefore,
      totalMs: timing.endMs,
      swapMs: timing.swapMs,
      cover,
      hold,
      reveal,
      raf: stats(frames),
    })
    console.log(
      `curtain ${fx.variant}: ${titleBefore}->${titleAfter} swap@${timing.swapMs}ms end@${timing.endMs}ms ` +
        `holdP95=${hold?.luma.center.p95} holdMax=${hold?.luma.center.max} fps=${stats(frames)?.avgFps} p95=${stats(frames)?.p95}`,
    )
  }

  // 连点 / 连续 Enter：幕布播放中再次推进，是否在墨没盖住时就换场（跳场）
  const rapid = []
  for (const mode of ['enter2', 'click2', 'click12']) {
    await resumeWith(curtainState(CURTAIN_FIXTURES[0]))
    await sleep(900)
    const before = await sceneTitle()
    const t0 = Date.now()
    if (mode === 'enter2') {
      await page.keyboard.press('Enter')
      await sleep(70)
      await page.keyboard.press('Enter')
    } else {
      const times = mode === 'click2' ? 2 : 12
      await page.evaluate((n) => {
        const button = document.querySelector('.continue')
        for (let i = 0; i < n; i += 1) button?.click()
      }, times)
    }
    await sleep(260)
    const titleEarly = await sceneTitle()
    const earlyMs = Date.now() - t0
    const timing = await waitTransition()
    const after = await sceneTitle()
    rapid.push({ mode, before, titleEarly, earlyMs, jumpedEarly: titleEarly !== before, after, settleMs: timing.endMs })
    console.log(
      `rapid ${mode}: before=${before} @${earlyMs}ms=${titleEarly} (jumped=${titleEarly !== before}) final=${after} settle=${timing.endMs}ms`,
    )
  }
  report.sections.curtain = { rows, rapid }
}

// ---------------------------------------------------------------------------
// 3. 六种记忆载体 + 三个合成结局的点击粒子
// ---------------------------------------------------------------------------
const ENDING_ORDER = ['roster', 'letters', 'flag', 'photo', 'testimony', 'message', 'archive', 'relics', 'wordofmouth']

const gotEpilogue = async () => {
  await resumeWith(baseState({ sceneId: 'epilogue' }))
  await sleep(700)
  await page.locator('.choice').first().waitFor({ state: 'visible', timeout: 5000 })
}

if (SECTIONS.includes('burst')) {
  const rows = []
  for (let k = 0; k < 9; k += 1) {
    await gotEpilogue()
    const choice = page.locator('.choice').nth(k)
    const kind = await choice.getAttribute('data-kind')
    const box = await choice.boundingBox()
    await choice.click()
    await sleep(110)
    const during = await canvasInk('.choice-burst')
    const file = await shot(`burst-${ENDING_ORDER[k]}.png`)
    await sleep(1400)
    const after = await canvasInk('.choice-burst')
    rows.push({
      kind: kind ?? ENDING_ORDER[k],
      canvas: { during, after },
      click: box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null,
      file,
    })
    console.log(`burst ${kind}: drawnPx=${during?.drawnPx} mean=${during?.mean?.join(',')} drained=${after?.drawnPx}`)
  }

  // 连点：真实鼠标在「继续」上快点 12 次（选项点一次就消失，只有「继续」撑到幕布 hold）
  await resumeWith(
    baseState({
      sceneId: 'v1-01',
      pendingOutcome: { paragraphs: ['连点测试。'], gain: {} },
      pendingNext: 'v1-02',
      picked: { 'v1-01': 'test' },
    }),
  )
  await sleep(900)
  const box = await page.locator('.continue').boundingBox()
  const before = await sceneTitle()
  const cx = box ? box.x + box.width / 2 : 800
  const cy = box ? box.y + box.height / 2 : 600
  await probeStart()
  for (let i = 0; i < 12; i += 1) await page.mouse.click(cx, cy)
  await sleep(140)
  const rapidDuring = await canvasInk('.choice-burst')
  await shot('burst-rapid-12.png')
  const drain = []
  for (let i = 0; i < 40; i += 1) {
    const ink = await canvasInk('.choice-burst')
    drain.push(ink?.drawnPx ?? 0)
    if ((ink?.drawnPx ?? 0) === 0) break
    await sleep(150)
  }
  const frames = await probeStop()
  const finalTitle = await sceneTitle()
  await waitTransition().catch(() => {})
  const finalTitleAfter = await sceneTitle()
  report.sections.burst = {
    rows,
    rapid: {
      clicks: 12,
      at: { x: Math.round(cx), y: Math.round(cy) },
      during: rapidDuring,
      drainSamples: drain,
      drainedInMs: drain.length * 150,
      sceneBefore: before,
      sceneAfter: finalTitle,
      sceneAfterTransition: finalTitleAfter,
      raf: stats(frames),
    },
  }
  console.log(
    `burst rapid 12: drawnPx=${rapidDuring?.drawnPx} drained≈${drain.length * 150}ms fps=${stats(frames)?.avgFps} p95=${stats(frames)?.p95} scene ${before}->${finalTitle}->${finalTitleAfter}`,
  )

  // prefers-reduced-motion：必须完全禁用
  await useContext({ reducedMotion: 'reduce' })
  await gotEpilogue()
  await page.locator('.choice').first().click()
  await sleep(200)
  const rmBurst = {
    canvas: await canvasInk('.choice-burst'),
    display: await page.evaluate(() => getComputedStyle(document.querySelector('.choice-burst')).display),
  }
  await shot('burst-reduced-motion.png')
  report.sections.burst.reducedMotion = rmBurst
  console.log(`burst reduced-motion: display=${rmBurst.display} drawn=${rmBurst.canvas?.drawnPx}`)
  await context.close()
  await useContext()
}

// ---------------------------------------------------------------------------
// 4. 九段结局「终极画面」
// ---------------------------------------------------------------------------
const reachFinale = async (k) => {
  await gotEpilogue()
  await page.locator('.choice').nth(k).click()
  await sleep(200)
  await page.locator('.continue').click()
  return waitFor('.finale', 9000)
}
const skipFinale = async () => {
  await page.keyboard.press('Escape')
  return waitGone('.finale', 4000)
}
const fingerprint = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.finale-canvas')
    if (!canvas) return null
    const c = document.createElement('canvas')
    const w = (c.width = 64)
    const h = (c.height = 40)
    const ctx = c.getContext('2d')
    ctx.drawImage(canvas, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    const out = []
    for (let i = 0; i < d.length; i += 4) out.push(Math.round((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * 10) / 10)
    return out
  })

if (SECTIONS.includes('finale')) {
  const rows = []
  for (let k = 0; k < 9; k += 1) {
    const appear = await reachFinale(k)
    if (appear === null) {
      rows.push({ kind: ENDING_ORDER[k], error: 'finale 未出现' })
      console.log(`finale ${ENDING_ORDER[k]}: 未出现`)
      continue
    }
    await probeStart()
    await sleep(5400)
    const hasCanvas = await page.locator('.finale-canvas').count()
    const ink = hasCanvas ? await canvasInk('.finale-canvas') : null
    const file = await shot(`finale-${ENDING_ORDER[k]}.png`)
    const frames = await probeStop()
    const fp = hasCanvas ? await fingerprint() : null
    const skipMs = await skipFinale()
    rows.push({ kind: ENDING_ORDER[k], appearMs: appear, ink, file, fingerprint: fp, skipToGoneMs: skipMs, raf: stats(frames) })
    console.log(
      `finale ${ENDING_ORDER[k]}: appear=${appear}ms canvas=${ink?.drawnRatio} mean=${ink?.mean?.join(',')} skip→gone=${skipMs}ms`,
    )
  }

  // 九段画面到底"是不是各不相同"：拿落盘的取证截图做 64×40 亮度指纹两两比对
  // （画布内取指纹会和动画时刻赛跑，截图是报告里给人看的那一帧，比它更可信）
  const shotPrints = []
  for (const row of rows) {
    if (!row.file) continue
    const b64 = (await readFile(path.join(ROOT, row.file))).toString('base64')
    const fp = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = document.createElement('canvas')
      const w = (c.width = 64)
      const h = (c.height = 40)
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      const out = []
      for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
      return out
    }, `data:image/png;base64,${b64}`)
    shotPrints.push({ kind: row.kind, fp })
  }
  const pairs = []
  for (let i = 0; i < shotPrints.length; i += 1) {
    for (let j = i + 1; j < shotPrints.length; j += 1) {
      const a = shotPrints[i].fp
      const b = shotPrints[j].fp
      pairs.push({
        a: shotPrints[i].kind,
        b: shotPrints[j].kind,
        diff: +(a.reduce((sum, v, idx) => sum + Math.abs(v - b[idx]), 0) / a.length).toFixed(2),
      })
    }
  }
  pairs.sort((x, y) => x.diff - y.diff)
  const minPair = pairs[0] ?? null

  // 不跳过：验证 6 秒时长 + 自动进正文
  await reachFinale(0)
  const naturalMs = await waitGone('.finale', 12000)
  const natural = { finaleGoneAfterMs: naturalMs }
  await shot('finale-natural-ending.png')

  // 重看：结局页「重看结局画面」
  const replayButton = page.getByRole('button', { name: /重看结局画面/ })
  let replay = null
  if (await replayButton.isVisible().catch(() => false)) {
    await replayButton.click()
    const again = await waitFor('.finale', 4000)
    replay = { visibleAgainMs: again }
    await skipFinale()
  }

  // 播放中切到别的屏（程序点击，绕过遮罩）：是否停止、是否残留 rAF
  await reachFinale(1)
  const beforeSwitch = { pending: await rafPending(), finale: await page.locator('.finale').isVisible() }
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.ending-actions .quiet-button')]
    buttons.find((b) => (b.textContent ?? '').includes('回到开头'))?.click()
  })
  await sleep(700)
  const afterSwitch = {
    pending: await rafPending(),
    finale: await page.locator('.finale').isVisible().catch(() => false),
    screen: await page.evaluate(() =>
      document.querySelector('.menu') ? 'menu' : document.querySelector('.scene') ? 'game' : 'other',
    ),
  }

  // prefers-reduced-motion：只显示最终帧 + 自动进正文
  await useContext({ reducedMotion: 'reduce' })
  const rmAppear = await reachFinale(0)
  await sleep(500)
  const rmCanvas = await canvasInk('.finale-canvas')
  const rmDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('.finale-canvas')).display)
  const rmOverlay = await page.evaluate(() => {
    const el = document.querySelector('.finale')
    return el ? { bg: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity } : null
  })
  const rmFile = await shot('finale-reduced-motion.png')
  const rmEnd = await waitGone('.finale', 5000)
  await shot('finale-reduced-motion-ending.png')

  report.sections.finale = {
    rows,
    minPairwiseDiff: minPair,
    closestPairs: pairs.slice(0, 4),
    natural,
    replay,
    switchAway: { before: beforeSwitch, after: afterSwitch },
    reducedMotion: {
      appearMs: rmAppear,
      canvas: rmCanvas,
      canvasDisplay: rmDisplay,
      overlay: rmOverlay,
      toGoneMs: rmEnd,
      file: rmFile,
    },
  }
  console.log('finale min pairwise diff:', JSON.stringify(minPair))
  console.log('finale natural:', JSON.stringify(natural), 'replay=', JSON.stringify(replay))
  console.log('finale switch-away:', JSON.stringify(beforeSwitch), '->', JSON.stringify(afterSwitch))
  console.log(
    `finale reduced-motion: display=${rmDisplay} drawn=${rmCanvas?.drawnPx} overlay=${JSON.stringify(rmOverlay)} gone=${rmEnd}ms`,
  )
  await context.close()
  await useContext()
}

// ---------------------------------------------------------------------------
// 5. 悬停 / 键盘焦点 / 按下反馈；动效是否阻塞点击
// ---------------------------------------------------------------------------
if (SECTIONS.includes('focus')) {
  await clearSave()
  const stops = []
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press('Tab')
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const cs = getComputedStyle(el)
        return {
          tag: el.tagName,
          text: (el.textContent ?? '').trim().slice(0, 14),
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        }
      }),
    )
  }

  // 选项：hover / active（用只有 2 个选项的普通场景，卡片不会长出视口）
  await resumeWith(baseState({ sceneId: 'v0-01' }))
  await page.locator('.scene-title').waitFor({ timeout: 5000 })
  await page.locator('.choice').first().scrollIntoViewIfNeeded().catch(() => {})
  const rect = await page.evaluate(() => {
    const el = document.querySelector('.choice')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = Math.min(window.innerWidth - 4, Math.max(4, r.x + r.width / 2))
    const y = Math.min(window.innerHeight - 4, Math.max(4, r.y + r.height / 2))
    return { x, y, inside: r.y >= 0 && r.y + r.height <= window.innerHeight }
  })
  const styleNow = () =>
    page.evaluate(() => {
      const el = document.querySelector('.choice')
      const cs = getComputedStyle(el)
      return { transform: cs.transform, filter: cs.filter, background: cs.backgroundImage.slice(0, 44), border: cs.borderColor }
    })
  const base = await styleNow()
  let hover = null
  let active = null
  if (rect) {
    await page.mouse.move(rect.x, rect.y)
    await sleep(340)
    hover = await styleNow()
    await page.mouse.down()
    await sleep(170)
    active = await styleNow()
    // 先挪开再松手：否则 mouseup 会真的点中选项、换到结果页，后面就测不到原元素了
    await page.mouse.move(10, 10)
    await page.mouse.up()
  }
  const hitTest = rect
    ? await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return el ? `${el.tagName}.${String(el.className).split(' ')[0]}` : null
      }, rect)
    : null
  const choiceMeta = await page.evaluate(() => {
    const el = document.querySelector('.choice')
    if (!el) return null
    return { kind: el.getAttribute('data-kind'), accent: getComputedStyle(el).getPropertyValue('--accent').trim() }
  })
  // 动效层不应挡住点击（游戏屏：三个 canvas + 渐变层都在）
  const overlays = await page.evaluate(() =>
    ['.ink-curtain', '.choice-burst', '.particles', '.stage-grade'].map((sel) => {
      const el = document.querySelector(sel)
      return el ? { sel, pointerEvents: getComputedStyle(el).pointerEvents, z: getComputedStyle(el).zIndex } : null
    }),
  )

  const buttonProbe = async (selector) => {
    const el = page.locator(selector).first()
    const b = await el.boundingBox().catch(() => null)
    if (!b) return null
    const read = () =>
      page.evaluate((sel) => {
        const node = document.querySelector(sel)
        const cs = getComputedStyle(node)
        return { transform: cs.transform, background: cs.backgroundColor, border: cs.borderColor, color: cs.color }
      }, selector)
    const before = await read()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await sleep(320)
    const over = await read()
    await page.mouse.down()
    await sleep(160)
    const down = await read()
    await page.mouse.up()
    await page.mouse.move(10, 10)
    return { before, hover: over, active: down }
  }
  await gotEpilogue()
  await page.locator('.choice').nth(1).click()
  await sleep(500)
  const primary = await buttonProbe('.primary-button')
  await clearSave()
  const quiet = await buttonProbe('.menu .quiet-button')

  report.sections.focus = { stops, choice: { meta: choiceMeta, base, hover, active, rect, hitTest }, primary, quiet, overlays }
  console.log('focus stops:', stops.map((s) => `${s?.text}:${s?.outline}`).join(' | '))
  console.log('choice meta:', JSON.stringify(choiceMeta))
  console.log('choice base->hover->active:', base.transform, '->', hover?.transform, '->', active?.transform, '| border:', base.border, '->', hover?.border)
  console.log('primary:', JSON.stringify(primary))
  console.log('quiet:', JSON.stringify(quiet))
  console.log('overlays:', JSON.stringify(overlays), '| rect:', JSON.stringify(rect), '| hitTest:', hitTest)
}

// ---------------------------------------------------------------------------
// 6. 性能
// ---------------------------------------------------------------------------
const cdpMetrics = async () => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const before = await cdp.send('Performance.getMetrics')
  await sleep(3000)
  const after = await cdp.send('Performance.getMetrics')
  await cdp.detach()
  const pick = (set, name) => set.metrics.find((m) => m.name === name)?.value ?? 0
  const delta = (name) => +(pick(after, name) - pick(before, name)).toFixed(3)
  return {
    window: 3,
    taskDuration: delta('TaskDuration'),
    layoutDuration: delta('LayoutDuration'),
    recalcStyleDuration: delta('RecalcStyleDuration'),
    scriptDuration: delta('ScriptDuration'),
  }
}
const heapKb = async () => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
  await sleep(200)
  const usage = await cdp.send('Runtime.getHeapUsage')
  await cdp.detach()
  return Math.round(usage.usedSize / 1024)
}

/** 连点 20 次换屏（人物志 / 史料库 往返），用于 canvas / rAF / 堆的泄漏检查 */
const screenSwitchRound = async () => {
  for (let i = 0; i < 10; i += 1) {
    await page.getByRole('button', { name: '人物志' }).click().catch(() => {})
    await sleep(80)
    await page.getByRole('button', { name: '返回' }).first().click().catch(() => {})
    await sleep(80)
    await page.getByRole('button', { name: '史料库' }).click().catch(() => {})
    await sleep(80)
    await page.getByRole('button', { name: '返回' }).first().click().catch(() => {})
    await sleep(80)
  }
}

if (SECTIONS.includes('perf')) {
  await clearSave()
  await probeStart()
  await sleep(1200)
  const menuFrames = await probeStop()

  // 场景空闲：rain（Stage + 粒子两套 rAF）/ none（只有 Stage）
  const idleRows = []
  for (const fx of [
    { scene: 'night2', weather: 'rain' },
    { scene: 'v1-01', weather: 'none' },
  ]) {
    await resumeWith(baseState({ sceneId: fx.scene }))
    await page.locator('.scene-title').waitFor({ timeout: 5000 })
    await sleep(1200)
    await probeStart()
    const metrics = await cdpMetrics()
    const frames = await probeStop()
    idleRows.push({ ...fx, raf: stats(frames), metrics, pendingRaf: await rafPending() })
  }

  // 点击粒子
  await gotEpilogue()
  await probeStart()
  await page.locator('.choice').nth(2).click()
  await sleep(1400)
  const burstFrames = await probeStop()

  // 反复换屏：canvas 数 / rAF 残留 / 堆（20 次 / 40 次）
  await clearSave()
  const start = { canvases: await page.evaluate(() => document.querySelectorAll('canvas').length), heap: await heapKb() }
  await screenSwitchRound()
  const after20 = {
    canvases: await page.evaluate(() => document.querySelectorAll('canvas').length),
    heap: await heapKb(),
    pending: await rafPending(),
  }
  await screenSwitchRound()
  const after40 = {
    canvases: await page.evaluate(() => document.querySelectorAll('canvas').length),
    heap: await heapKb(),
    pending: await rafPending(),
  }

  // dpr=2（高分屏）同一段换场：看全屏 overdraw 是否翻倍
  const dprRows = []
  await context.close()
  await useContext({ deviceScaleFactor: 2 })
  for (const fx of [CURTAIN_FIXTURES[0], CURTAIN_FIXTURES[4]]) {
    await resumeWith(curtainState(fx))
    await sleep(700)
    await page.locator('.continue').click()
    await probeStart()
    await waitTransition()
    const frames = await probeStop()
    dprRows.push({ variant: fx.variant, dpr: 2, raf: stats(frames) })
    console.log(`dpr2 curtain ${fx.variant}: fps=${stats(frames)?.avgFps} p95=${stats(frames)?.p95} dropped=${stats(frames)?.droppedPct}%`)
  }

  report.sections.perf = {
    menu: { raf: stats(menuFrames) },
    sceneIdle: idleRows,
    burst: { raf: stats(burstFrames) },
    screenSwitch: { start, after20, after40 },
    dpr2: dprRows,
  }
  console.log('perf menu:', JSON.stringify(stats(menuFrames)))
  for (const row of idleRows) console.log(`perf idle ${row.weather}:`, JSON.stringify(row.raf), JSON.stringify(row.metrics), 'pending:', row.pendingRaf)
  console.log('perf burst:', JSON.stringify(stats(burstFrames)))
  console.log('perf screenSwitch:', JSON.stringify(start), '-> 20:', JSON.stringify(after20), '-> 40:', JSON.stringify(after40))
  await context.close()
  await useContext()
}

// ---------------------------------------------------------------------------
// 诊断：空闲帧成本到底花在哪（粒子 / backdrop-filter / 渐变层）
// ---------------------------------------------------------------------------
if (SECTIONS.includes('diag')) {
  const measure = async (label, css) => {
    if (css)
      await page.evaluate((c) => {
        const style = document.createElement('style')
        style.id = 'diag-style'
        style.textContent = c
        document.head.appendChild(style)
      }, css)
    await sleep(500)
    await probeStart()
    await sleep(2200)
    const frames = await probeStop()
    if (css) await page.evaluate(() => document.getElementById('diag-style')?.remove())
    console.log(`diag ${label}:`, JSON.stringify(stats(frames)))
    return { label, css, raf: stats(frames) }
  }
  await resumeWith(baseState({ sceneId: 'night2' }))
  await page.locator('.scene-title').waitFor({ timeout: 5000 })
  await sleep(1500)
  const rows = []
  rows.push(await measure('baseline(rain)'))
  rows.push(await measure('no-backdrop-filter', '.scene,.ending{backdrop-filter:none!important}'))
  rows.push(await measure('no-particles-layer', '.particles{display:none!important}'))
  rows.push(await measure('no-grade', '.stage-grade{display:none!important}'))
  rows.push(await measure('no-tilt', '.stage-tilt{display:none!important}'))
  await clearSave()
  await sleep(400)
  await probeStart()
  await sleep(2200)
  rows.push({ label: 'menu(no canvas anim)', raf: stats(await probeStop()) })
  console.log('diag menu:', JSON.stringify(rows[rows.length - 1].raf))
  report.sections.diag = rows
}

// ---------------------------------------------------------------------------
// 7. 一致性：时长 / 缓动 / 配色
// ---------------------------------------------------------------------------
if (SECTIONS.includes('consistency')) {
  await clearSave()
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      ease: cs.getPropertyValue('--ease').trim(),
      ink: cs.getPropertyValue('--ink').trim(),
      paper: cs.getPropertyValue('--paper').trim(),
      red: cs.getPropertyValue('--red').trim(),
      gold: cs.getPropertyValue('--gold').trim(),
    }
  })
  await gotEpilogue()
  const durations = await page.evaluate(() => {
    const rows = []
    const selectors = [
      '.scene', '.scene-head', '.scene-title', '.prose p', '.choice', '.primary-button', '.quiet-button', '.chip',
      '.gallery-card', '.source-panel', '.menu', '.ending', '.finale', '.finale-skip', '.view3d-toggle', '.audio-toggle',
      '.people-card',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (!el) continue
      const cs = getComputedStyle(el)
      rows.push({
        sel,
        animation: `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction} delay=${cs.animationDelay}`,
        transition:
          cs.transitionDuration === '0s'
            ? 'none'
            : `${cs.transitionProperty.slice(0, 40)} ${cs.transitionDuration} ${cs.transitionTimingFunction}`,
      })
    }
    return rows
  })
  const choiceKinds = await page.evaluate(() =>
    [...document.querySelectorAll('.choice')].map((el) => ({
      kind: el.getAttribute('data-kind'),
      accent: getComputedStyle(el).getPropertyValue('--accent').trim(),
    })),
  )
  report.sections.consistency = { tokens, durations, choiceKinds }
  console.log('tokens:', JSON.stringify(tokens))
  for (const d of durations) console.log('dur', d.sel, '|', d.animation, '|', d.transition)
  console.log('choice accents:', JSON.stringify(choiceKinds))
}

// ---------------------------------------------------------------------------
// 6b. dpr 对比：高分屏上整页基线 vs 换场，隔离"幕布太贵"与"整页都贵"
// ---------------------------------------------------------------------------
if (SECTIONS.includes('dpr')) {
  const rows = []
  for (const dsf of [1, 2]) {
    await context.close()
    await useContext({ deviceScaleFactor: dsf })
    // 菜单：没有 canvas 动画，作为整页基线
    await clearSave()
    await sleep(500)
    await probeStart()
    await sleep(2200)
    rows.push({ dsf, case: 'menu(no canvas anim)', raf: stats(await probeStop()) })
    // 场景空闲（rain）
    await resumeWith(baseState({ sceneId: 'night2' }))
    await page.locator('.scene-title').waitFor({ timeout: 5000 })
    await sleep(1200)
    await probeStart()
    await sleep(2200)
    rows.push({ dsf, case: 'scene idle(rain)', raf: stats(await probeStop()) })
    // 换场：墨 / 烟
    for (const fx of [CURTAIN_FIXTURES[0], CURTAIN_FIXTURES[4]]) {
      await resumeWith(curtainState(fx))
      await sleep(700)
      await page.locator('.continue').click()
      await probeStart()
      await waitTransition()
      rows.push({ dsf, case: `curtain ${fx.variant}`, raf: stats(await probeStop()) })
    }
  }
  for (const row of rows) {
    console.log(`dpr${row.dsf} ${row.case}:`, JSON.stringify(row.raf))
  }
  report.sections.dpr = rows
  await context.close()
  await useContext()
}

// ---------------------------------------------------------------------------
// 8. 亮度对照：正常正文页 vs 换场帧，用来证明"换场帧确实把内容遮住了"
// ---------------------------------------------------------------------------
if (SECTIONS.includes('luma')) {
  const files = {
    'scene-visible': 'docs/deliverables/screenshots/01-scene-2.5d.png',
    'curtain-ink-cover': 'docs/report/anim-shots/curtain-ink-cover.png',
    'curtain-ink-hold': 'docs/report/anim-shots/curtain-ink-hold.png',
    'curtain-smoke-hold': 'docs/report/anim-shots/curtain-smoke-hold.png',
    'finale-roster': 'docs/report/anim-shots/finale-roster.png',
  }
  const rows = []
  for (const [label, file] of Object.entries(files)) {
    const b64 = (await readFile(path.join(ROOT, file))).toString('base64')
    const luma = await frameLuma(`data:image/png;base64,${b64}`)
    rows.push({ label, file, luma })
    console.log(`luma ${label}: full=${JSON.stringify(luma.full)} center=${JSON.stringify(luma.center)}`)
  }
  report.sections.luma = rows
}

console.log('errors:', report.errors.length ? report.errors.slice(0, 6) : 'none')
await browser.close()
await writeFile(path.join(ROOT, 'docs', 'report', 'anim-check.json'), JSON.stringify(report, null, 2))
console.log('report: docs/report/anim-check.json')
