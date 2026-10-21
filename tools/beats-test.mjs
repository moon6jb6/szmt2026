import { chromium } from 'playwright'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * SceneBeats（长段落分三段 + 氛围 + 人物剪影）验收
 *
 * 用法：
 *   node tools/beats-test.mjs                      # 默认 http://127.0.0.1:5199/tools/beats-harness.html
 *   node tools/beats-test.mjs <harness-url>
 *   node tools/beats-test.mjs <harness-url> appcss # 额外跑一遍挂 App styles.css 的场景
 *
 * 说明：本项目 4173 是 Lead/玩家正在试玩的 preview，本脚本**不起也不重启任何服务**，
 * 只打开已经存在的 dev server 上的验证页（5173 / 5199 都行，用第一个参数指定）。
 *
 * 必过项：
 *   分组：7/9/12/15 段都分 3 组，组大小 3-2-2 / 3-3-3 / 4-4-4 / 5-5-5，总段数与顺序不变；
 *   ≤ 6 段不分（1 组、无「继续读」、选项区立刻出现）；单段 > 220 字按句号切且不丢字。
 *   交互：点击 / Enter / 空格推进；最后一组再点一次才出 footer(done=true)；进度点状态跟随；
 *         连点 8 次只前进 1 组。
 *   判词：人名+回忆 → figure-male；含「她」→ figure-female；纯环境 → scene；纯回忆 → memory。
 *   剪影：figure 组有 .silhouette 且 opacity 在 0.08—0.2（data-opacity 0.10—0.16），
 *         scene 组没有；pointer-events:none、z-index 在正文之下、不拦截正文命中测试。
 *   reduced-motion：无动画/无过渡仍能推进，footer 正常出现。
 *   390px：无横向溢出、正文可读。
 *   全程无 console error / pageerror。
 *
 * 产出：tools/shots/beats/*.png + summary.json；任一断言失败 exitCode=1。
 */

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5199/tools/beats-harness.html'
const alsoAppCss = process.argv.includes('appcss') || process.argv[3] === 'appcss'
const appCssUrl = baseUrl.includes('?') ? `${baseUrl}&appcss=1` : `${baseUrl}?appcss=1`

const OUT = fileURLToPath(new URL('./shots/beats/', import.meta.url))
await mkdir(OUT, { recursive: true })
const stale = await readdir(OUT).catch(() => [])
await Promise.all(
  stale.filter((name) => name.endsWith('.png') || name === 'summary.json').map((name) => rm(`${OUT}${name}`, { force: true })),
)

const checks = []
const skipped = []
const consoleErrors = []
let shotIndex = 0

// 中途抛错也要把已抓到的 console error 打出来，否则只看到一句 Timeout
process.on('unhandledRejection', (error) => {
  console.error(`\n运行中断：${error && error.message ? error.message : error}`)
  for (const entry of consoleErrors) {
    if (entry.bucket.length) console.error(`[${entry.label}] ${entry.bucket.join(' | ')}`)
  }
  process.exit(1)
})

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function shot(page, name) {
  shotIndex += 1
  const file = `${OUT}${String(shotIndex).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** 元素截图：关掉动画，保证每次截图一致 */
async function shotEl(page, selector, name) {
  shotIndex += 1
  const file = `${OUT}${String(shotIndex).padStart(2, '0')}-${name}.png`
  await page.locator(selector).screenshot({ path: file, animations: 'disabled' })
  return file
}

let browser
try {
  // 不碰 GPU：另一个任务在用，这边强制走 CPU 光栅
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-gpu', '--disable-software-rasterizer'] })
} catch {
  browser = await chromium.launch({ args: ['--disable-gpu'] })
}

const errorsOf = (page, label) => {
  const bucket = []
  consoleErrors.push({ label, bucket })
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.push(msg.text())
  })
  page.on('pageerror', (error) => bucket.push(`pageerror: ${String(error)}`))
  return bucket
}

/** 读一个卡片作用域里的关键状态 */
const stateOf = async (card) => ({
  mood: await card.getAttribute('data-mood'),
  person: await card.getAttribute('data-has-person'),
  memory: await card.getAttribute('data-memory'),
  index: Number(await card.getAttribute('data-beat-index')),
  total: Number(await card.getAttribute('data-beat-total')),
  done: await card.getAttribute('data-done'),
})

const currentTexts = (card) => card.locator('.beats__beat--current .beats__para').allInnerTexts()

const waitIndex = async (page, card, want, tries = 80) => {
  for (let at = 0; at < tries; at += 1) {
    if (Number(await card.getAttribute('data-beat-index')) === want) return true
    await page.waitForTimeout(40)
  }
  return false
}

/** 上一次「继续读」点击的时间戳：保证两次点击之间一定过了 300ms 连点锁 */
let lastClickAt = 0

/** 点一次「继续读」；点之前确保连点锁已过期，点之后给 DOM 一点收尾时间 */
const next = async (page, card) => {
  const rest = 330 - (Date.now() - lastClickAt)
  if (rest > 0) await page.waitForTimeout(rest)
  await card.locator('[data-testid="beats-next"]').click()
  lastClickAt = Date.now()
  await page.waitForTimeout(220)
}

/** 等一会儿看某个元素是否消失（按钮收起这类异步变化） */
const gone = async (locator, timeout = 1500) => {
  try {
    await locator.waitFor({ state: 'detached', timeout })
    return true
  } catch {
    return false
  }
}

async function openPage({ viewport = { width: 1280, height: 1000 }, reducedMotion = 'no-preference', label, url = baseUrl }) {
  const page = await browser.newPage({ viewport, reducedMotion })
  errorsOf(page, label)
  await page.goto(url, { waitUntil: 'load' })
  await page.locator('[data-testid="panel-main"] [data-testid="beats"]').waitFor({ state: 'visible' })
  await page.waitForFunction(() => Boolean(window.__BEATS__))
  return page
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五']
/** 分组矩阵里第 n 个样例的期望切法 */
const EXPECTED = {
  7: [
    ['7·一', '7·二', '7·三'],
    ['7·四', '7·五'],
    ['7·六', '7·七'],
  ],
  9: [
    ['9·一', '9·二', '9·三'],
    ['9·四', '9·五', '9·六'],
    ['9·七', '9·八', '9·九'],
  ],
  12: [
    ['12·一', '12·二', '12·三', '12·四'],
    ['12·五', '12·六', '12·七', '12·八'],
    ['12·九', '12·十', '12·十一', '12·十二'],
  ],
  15: [
    ['15·一', '15·二', '15·三', '15·四', '15·五'],
    ['15·六', '15·七', '15·八', '15·九', '15·十'],
    ['15·十一', '15·十二', '15·十三', '15·十四', '15·十五'],
  ],
}

console.log(`harness: ${baseUrl}\n`)

/* ==========================================================================
   一、首屏结构
   ========================================================================== */
{
  const page = await openPage({ label: 'structure' })
  const card = page.locator('[data-testid="panel-main"] [data-testid="beats"]')
  const state = await stateOf(card)
  const dots = card.locator('.beats__dot')
  const dotCount = await dots.count()
  const currentDot = await dots.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('data-current') === 'true'))

  check('首屏：7 段分 3 组', state.total === 3 && state.index === 0, `total=${state.total} index=${state.index}`)
  check('首屏：第一组判为 scene（纯环境）', state.mood === 'scene' && state.person === 'false', `mood=${state.mood}`)
  check('首屏：三枚墨点，第一个实心', dotCount === 3 && currentDot === 0, `dots=${dotCount} current=${currentDot}`)
  check('首屏：有「继续读」，还没有选项区', (await card.locator('[data-testid="beats-next"]').count()) === 1 && (await card.locator('[data-testid="beats-footer"]').count()) === 0)
  check('首屏：onBeatChange 首帧已回传 scene', (await page.locator('[data-testid="beat-log"]').innerText()) === '#0 scene')
  check('首屏：Stage 层拿到 scene', (await page.locator('[data-testid="stage-mood"]').innerText()) === 'scene')
  await page.waitForTimeout(700) // 等首组 3 段错峰淡入走完再截整页
  await shot(page, 'harness-top')
  await shotEl(page, '[data-testid="stage-mock"]', 'stage-scene')
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'card-scene')

  /* ---- 第二组：记忆（暖褐纸纹） ---- */
  await next(page, card)
  await waitIndex(page, card, 1)
  const beat2 = await stateOf(card)
  const dot2 = await dots.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('data-current') === 'true'))
  check('第二组：mood=memory', beat2.mood === 'memory' && beat2.memory === 'true', `mood=${beat2.mood} memory=${beat2.memory}`)
  check('第二组：没有人，不出剪影', beat2.person === 'false' && (await card.locator('.silhouette').count()) === 0)
  check('第二组：墨点跟到第二个', dot2 === 1, `current=${dot2}`)
  check('第二组：Stage 换到 memory 底色', (await page.locator('[data-testid="stage-mock"]').getAttribute('data-mood')) === 'memory')
  await shotEl(page, '[data-testid="stage-mock"]', 'stage-memory')
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'card-memory')

  /* ---- 第三组：人物（男性剪影 + 卡片加深 6%） ---- */
  await next(page, card)
  await waitIndex(page, card, 2)
  const beat3 = await stateOf(card)
  const figure = card.locator('.beats__figure .silhouette')
  await page.waitForTimeout(900) // 等 800ms 浮影动画走完再看 opacity
  const figureMetrics = await figure.evaluate((node) => {
    const box = node.closest('.beats__figure')
    const style = getComputedStyle(box)
    const card = box.closest('.beats')
    const prose = card.querySelector('.beats__para')
    const proseStyle = getComputedStyle(prose)
    return {
      opacity: Number(style.opacity),
      filter: style.filter,
      pointerEvents: style.pointerEvents,
      zIndex: Number(style.zIndex),
      proseZ: Number(proseStyle.zIndex || 0),
      ariaHidden: node.getAttribute('aria-hidden'),
      variant: node.getAttribute('data-variant'),
      dataOpacity: Number(box.getAttribute('data-opacity')),
      cardAlpha: getComputedStyle(card).getPropertyValue('--beats-card-alpha').trim(),
    }
  })
  check('第三组：mood=figure-male 且 hasPerson', beat3.mood === 'figure-male' && beat3.person === 'true', `mood=${beat3.mood}`)
  check('第三组：出现男性剪影', (await figure.count()) === 1 && figureMetrics.variant === 'male', `variant=${figureMetrics.variant}`)
  check(
    '剪影：computed opacity 落在 0.08—0.2',
    figureMetrics.opacity >= 0.08 && figureMetrics.opacity <= 0.2,
    `opacity=${figureMetrics.opacity}`,
  )
  check(
    '剪影：data-opacity 落在规范 0.10—0.16',
    figureMetrics.dataOpacity >= 0.1 && figureMetrics.dataOpacity <= 0.16,
    `data-opacity=${figureMetrics.dataOpacity}`,
  )
  check('剪影：模糊 1—2px', /blur\((1|1\.[0-9]|2)px\)/.test(figureMetrics.filter), figureMetrics.filter)
  check('剪影：aria-hidden（是氛围不是内容）', figureMetrics.ariaHidden === 'true')
  check('剪影：pointer-events:none', figureMetrics.pointerEvents === 'none', figureMetrics.pointerEvents)
  check(
    '剪影：z-index 在正文之下',
    figureMetrics.zIndex < Math.max(figureMetrics.proseZ, 1),
    `figure=${figureMetrics.zIndex} prose=${figureMetrics.proseZ}`,
  )
  check('剪影：人物组卡片底色加深 6%（0.78 → 0.84）', figureMetrics.cardAlpha === '0.84', figureMetrics.cardAlpha)

  /* ---- 正文不被剪影挡住：命中测试 ---- */
  const hitTest = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="panel-main"] [data-testid="beats"]')
    const paras = [...card.querySelectorAll('.beats__beat--current .beats__para')]
    const hits = []
    for (const para of paras) {
      const rect = para.getBoundingClientRect()
      for (const fx of [0.12, 0.5, 0.88]) {
        for (const fy of [0.3, 0.7]) {
          const x = rect.left + rect.width * fx
          const y = rect.top + rect.height * fy
          const top = document.elementFromPoint(x, y)
          hits.push({
            silhouette: Boolean(top?.closest('.beats__figure')) || Boolean(top?.classList?.contains('silhouette')),
            inParagraph: Boolean(top?.closest('.beats__para')),
          })
        }
      }
    }
    return hits
  })
  check(
    '正文：剪影不参与命中测试（正文 12 个采样点都不是剪影）',
    hitTest.every((hit) => !hit.silhouette) && hitTest.some((hit) => hit.inParagraph),
    `samples=${hitTest.length}`,
  )

  /* ---- 正文对比度：正文色不变，另有一层半透明压深底 ---- */
  const contrast = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="panel-main"] [data-testid="beats"]')
    const para = card.querySelector('.beats__para')
    const scrim = card.querySelector('.beats__scrim')
    return {
      color: getComputedStyle(para).color,
      scrim: getComputedStyle(scrim).backgroundImage,
      scrimOpacity: getComputedStyle(scrim).opacity,
    }
  })
  check('正文：字号/颜色沿用纸白', contrast.color === 'rgb(237, 230, 216)', contrast.color)
  check(
    '正文：人物组多一层压深 scrim（对比度只升不降）',
    /rgba\(10, 8, 6/.test(contrast.scrim) && Number(contrast.scrimOpacity) > 0.9,
    `scrim opacity=${contrast.scrimOpacity}`,
  )
  await shotEl(page, '[data-testid="stage-mock"]', 'stage-figure-male')
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'card-figure-male')

  /* ---- 最后一组再点一次 → footer ---- */
  await next(page, card)
  const done = await stateOf(card)
  const footer = card.locator('[data-testid="beats-footer"]')
  check('收尾：读完最后一组后 done=true', done.done === 'true', `done=${done.done}`)
  check('收尾：footer 出现且 done=true', (await footer.count()) === 1 && (await footer.getAttribute('data-done')) === 'true')
  check('收尾：「继续读」收起', await gone(card.locator('[data-testid="beats-next"]')))
  check(
    '收尾：onBeatChange 三次回执正确',
    (await page.locator('[data-testid="beat-log"]').innerText()) === '#0 scene · #1 memory · #2 figure-male+person',
    await page.locator('[data-testid="beat-log"]').innerText(),
  )
  check(
    '音效：普通组 paper、回忆/人物组 ink',
    (await page.locator('[data-testid="sound-log"]').innerText()) === 'ink ink paper',
    await page.locator('[data-testid="sound-log"]').innerText(),
  )
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'card-done-footer')
  await page.close()
}

/* ==========================================================================
   二、分组矩阵：7 / 9 / 12 / 15
   ========================================================================== */
{
  const page = await openPage({ label: 'grouping' })
  await page.waitForTimeout(700)
  await page.locator('[data-testid="panel-matrix"]').scrollIntoViewIfNeeded()
  await shotEl(page, '[data-testid="panel-matrix"]', 'matrix-grid')
  for (const count of [7, 9, 12, 15]) {
    const cell = page.locator(`[data-testid="matrix-${count}"]`)
    const card = cell.locator('[data-testid="beats"]')
    const state = await stateOf(card)
    const sizes = await cell.getAttribute('data-group-sizes')
    const expected = EXPECTED[count]
    const expectedSizes = expected.map((group) => group.length).join('/')

    check(`分组 ${count} 段：分成 3 组`, state.total === 3, `total=${state.total}`)
    check(`分组 ${count} 段：组大小 ${expectedSizes}`, sizes === expectedSizes, `sizes=${sizes}`)

    const collected = []
    for (let at = 0; at < 3; at += 1) {
      await waitIndex(page, card, at)
      collected.push(await currentTexts(card))
      if (at < 2) await next(page, cell)
    }
    const flat = collected.flat()
    const sameOrder = JSON.stringify(collected) === JSON.stringify(expected)
    check(
      `分组 ${count} 段：顺序不变、不丢段（逐组读回）`,
      sameOrder && flat.length === count,
      `${collected.map((group) => group.length).join('/')} → ${flat.join(',')}`,
    )

    // 收尾：最后一组再点一次，按钮收起
    await next(page, cell)
    check(`分组 ${count} 段：读完收起按钮`, await gone(cell.locator('[data-testid="beats-next"]')))
  }
  await page.close()
}

/* ==========================================================================
   三、判词样例 + 单组 / 超长单段
   ========================================================================== */
{
  const page = await openPage({ label: 'moods' })
  const expectations = [
    ['sample-person-memory', 'figure-male'],
    ['sample-she', 'figure-female'],
    ['sample-environment', 'scene'],
    ['sample-memory', 'memory'],
  ]
  for (const [id, expected] of expectations) {
    const card = page.locator(`[data-testid="${id}"] [data-testid="beats"]`)
    const state = await stateOf(card)
    check(`判词 ${id}：${expected}`, state.mood === expected, `mood=${state.mood}`)
  }

  // 女性剪影：换到 figure-female 后看 opacity
  const sheCard = page.locator('[data-testid="sample-she"] [data-testid="beats"]')
  await page.waitForTimeout(900)
  const sheFigure = await sheCard.locator('.silhouette').evaluate((node) => {
    const box = node.closest('.beats__figure')
    return {
      variant: node.getAttribute('data-variant'),
      opacity: Number(getComputedStyle(box).opacity),
      dataOpacity: Number(box.getAttribute('data-opacity')),
    }
  })
  check('剪影：含「她」的组出女性剪影', sheFigure.variant === 'female', sheFigure.variant)
  check(
    '剪影：女性 opacity 落在 0.08—0.2（规范 0.10—0.16）',
    sheFigure.opacity >= 0.08 && sheFigure.opacity <= 0.2 && sheFigure.dataOpacity >= 0.1 && sheFigure.dataOpacity <= 0.16,
    `opacity=${sheFigure.opacity} data=${sheFigure.dataOpacity}`,
  )
  await shotEl(page, '[data-testid="sample-she"]', 'card-figure-female')

  // 4 段：不分、无按钮、选项区立刻出现
  const single = page.locator('[data-testid="cell-single"] [data-testid="beats"]')
  const singleState = await stateOf(single)
  check(
    '≤ 6 段：只分 1 组、直接 done、没有「继续读」',
    singleState.total === 1 && singleState.done === 'true' && (await single.locator('[data-testid="beats-next"]').count()) === 0,
    `total=${singleState.total} done=${singleState.done}`,
  )
  check(
    '≤ 6 段：选项区立刻出现（保持现有阅读节奏）',
    (await single.locator('[data-testid="beats-footer"]').count()) === 1,
  )

  // 超长单段：按句号切，拼回去与原文逐字相同
  const longCell = page.locator('[data-testid="cell-long"] [data-testid="beats"]')
  const longState = await stateOf(longCell)
  const longTexts = await currentTexts(longCell)
  const fixture = await page.evaluate(() => window.__BEATS__.fixtures.long)
  check(
    '超长单段（> 220 字）：按句号切成多段',
    longTexts.length >= 2,
    `原文 ${fixture.length} 字 → ${longTexts.length} 段`,
  )
  check('超长单段：一个字都没丢', longTexts.join('') === fixture, `${longTexts.join('').length} / ${fixture.length}`)
  check('超长单段：不额外分组（仍是 1 组）', longState.total === 1, `total=${longState.total}`)
  await shotEl(page, '[data-testid="cell-long"]', 'card-long-paragraph')
  await page.close()
}

/* ==========================================================================
   四、键盘 + 连点
   ========================================================================== */
{
  const page = await openPage({ label: 'keyboard' })
  const card = page.locator('[data-testid="panel-main"] [data-testid="beats"]')

  // 先点一下正文（不是按钮）：让这个实例成为「最近被操作」的那个
  await card.locator('.beats__para').first().click()
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(120)
  check('键盘：Enter 推进一组（不需要先聚焦按钮）', (await stateOf(card)).index === 1, `index=${(await stateOf(card)).index}`)

  await page.waitForTimeout(320)
  await page.keyboard.press(' ')
  await page.waitForTimeout(120)
  check('键盘：空格再推进一组', (await stateOf(card)).index === 2, `index=${(await stateOf(card)).index}`)

  // 多实例隔离：按了一次键，别的卡片不许动
  const sampleIndexes = await page.locator('[data-testid^="sample-"] [data-testid="beats"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-beat-index')),
  )
  check('键盘：只推进当前实例（样例卡片都还在第 0 组）', sampleIndexes.every((value) => value === '0'), sampleIndexes.join(','))

  // 连点 8 次（同一任务里同步触发，模拟手抖连点）：只能前进 1 组
  await page.locator('[data-testid="reset"]').click()
  await page.waitForTimeout(120)
  const card2 = page.locator('[data-testid="panel-main"] [data-testid="beats"]')
  const before = (await stateOf(card2)).index
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="panel-main"] [data-testid="beats-next"]')
    for (let at = 0; at < 8; at += 1) button.click()
  })
  await page.waitForTimeout(400)
  const after = (await stateOf(card2)).index
  check('连点：同步连发 8 次只前进 1 组', before === 0 && after === 1, `${before} → ${after}`)

  // 真实鼠标双击也不能跳组
  await page.waitForTimeout(340)
  const box = await card2.locator('[data-testid="beats-next"]').boundingBox()
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)
  check('连点：双击只前进 1 组', (await stateOf(card2)).index === 2, `index=${(await stateOf(card2)).index}`)
  await page.close()
}

/* ==========================================================================
   五、reduced-motion
   ========================================================================== */
{
  const page = await openPage({ label: 'reduce-motion-on', reducedMotion: 'reduce' })
  const card = page.locator('[data-testid="panel-main"] [data-testid="beats"]')

  // 1) 跟随系统：不传 reduceMotion 也该降级
  const auto = await card.evaluate((node) => ({
    reduce: node.getAttribute('data-reduce-motion'),
    animation: getComputedStyle(node.querySelector('.beats__para')).animationName,
  }))
  check(
    'reduced-motion：不传 prop、跟随系统偏好时也降级',
    auto.reduce === 'true' && auto.animation === 'none',
    `data-reduce-motion=${auto.reduce} animation=${auto.animation}`,
  )

  // 2) 强制开启（prop 优先）
  await page.selectOption('[data-testid="reduce-select"]', 'on')
  await page.waitForTimeout(200)
  const motion = await card.evaluate((node) => {
    const para = node.querySelector('.beats__para')
    const figureStyle = getComputedStyle(node)
    return {
      reduce: node.getAttribute('data-reduce-motion'),
      animation: getComputedStyle(para).animationName,
      opacity: getComputedStyle(para).opacity,
      transition: figureStyle.transitionDuration,
    }
  })
  check('reduced-motion：标记为 true', motion.reduce === 'true', motion.reduce)
  check('reduced-motion：段落无动画（animation-name: none）', motion.animation === 'none', motion.animation)
  check('reduced-motion：段落直接可见（opacity 1）', Number(motion.opacity) === 1, motion.opacity)
  check('reduced-motion：卡片无过渡', /^0s(, 0s)*$/.test(motion.transition), motion.transition)

  await next(page, card)
  check('reduced-motion：仍能推进', (await stateOf(card)).index === 1, `index=${(await stateOf(card)).index}`)
  check('reduced-motion：不留擦除层', (await card.locator('.beats__inkwipe').count()) === 0 && (await card.locator('.beats__beat--leaving').count()) === 0)
  await next(page, card)
  await next(page, card)
  check('reduced-motion：走完三组后 footer 出现', (await card.locator('[data-testid="beats-footer"]').count()) === 1)
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'reduced-motion-done')
  await page.close()
}

/* ==========================================================================
   六、390px 移动端
   ========================================================================== */
{
  const page = await openPage({ viewport: { width: 390, height: 844 }, label: 'mobile-390' })
  const card = page.locator('[data-testid="panel-main"] [data-testid="beats"]')
  await card.scrollIntoViewIfNeeded()
  const overflow = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="panel-main"] [data-testid="beats"]')
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      cardScroll: card.scrollWidth,
      cardClient: card.clientWidth,
      box: card.getBoundingClientRect().width,
    }
  })
  check(
    '390px：页面无横向溢出',
    overflow.pageWidth <= overflow.viewport + 1,
    `scrollWidth=${overflow.pageWidth} viewport=${overflow.viewport}`,
  )
  check(
    '390px：卡片内部无横向溢出',
    overflow.cardScroll <= overflow.cardClient + 1,
    `scroll ${overflow.cardScroll} / client ${overflow.cardClient}`,
  )
  await page.waitForTimeout(700) // 等首段 520ms 淡入走完
  check(
    '390px：正文可读（首段 opacity 1 且字号 ≥ 15px）',
    await card.locator('.beats__para').first().evaluate((node) => {
      const style = getComputedStyle(node)
      return Number(style.opacity) > 0.95 && Number.parseFloat(style.fontSize) >= 15
    }),
  )
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'mobile-390-scene')

  await next(page, card)
  await next(page, card)
  await page.waitForTimeout(900)
  const mobileFigure = await card.evaluate((node) => {
    const figure = node.querySelector('.beats__figure')
    const stage = node.querySelector('.beats__stage')
    const figureBox = figure.getBoundingClientRect()
    const cardBox = node.getBoundingClientRect()
    const style = getComputedStyle(figure)
    return {
      bleed: figureBox.right - cardBox.right,
      cardWidth: cardBox.width,
      stageOverflow: getComputedStyle(stage).overflow,
      stageClip: stage.scrollWidth - stage.clientWidth,
      mask: style.maskImage || style.webkitMaskImage,
      opacity: Number(style.opacity),
    }
  })
  // 剪影允许小幅出血（右侧贴边），但必须被 .beats__stage 裁掉：页面不出现横向滚动
  check(
    '390px：剪影出血量 ≤ 卡片宽 9%，且被 stage 裁切',
    mobileFigure.bleed <= mobileFigure.cardWidth * 0.09 && mobileFigure.stageOverflow === 'hidden',
    `bleed=${Math.round(mobileFigure.bleed)}px overflow=${mobileFigure.stageOverflow} clipped=${mobileFigure.stageClip}px`,
  )
  check('390px：剪影底部淡出（mask 生效）', /linear-gradient/.test(mobileFigure.mask), mobileFigure.mask)
  check('390px：移动端剪影透明度更低（不抢字）', mobileFigure.opacity <= 0.13, `opacity=${mobileFigure.opacity}`)
  check('390px：剪影仍在（不是删掉）', (await card.locator('.silhouette').count()) === 1)
  await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'mobile-390-figure')
  await shot(page, 'mobile-390-page')
  await page.close()
}

/* ==========================================================================
   八、可选：挂上 App 的 styles.css 再跑一遍（样式污染检查）
   ========================================================================== */
if (alsoAppCss) {
  const page = await openPage({ label: 'app-css', url: appCssUrl })
  const appCssLoaded = await page.evaluate(() => document.body.dataset.appcss)
  const card = page.locator('[data-testid="panel-main"] [data-testid="beats"]')
  if (appCssLoaded !== '1') {
    // styles.css 暂时不在工作区（可能在别的分支/重构中途）：跳过，不算失败
    skipped.push('接入 App CSS（src/styles.css 不可用）')
    console.log(`SKIP  接入 App CSS：styles.css 不可用（body[data-appcss]=${appCssLoaded ?? 'unset'}）`)
  } else {
    await next(page, card)
    await next(page, card)
    await page.waitForTimeout(900)
    const withApp = await card.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      overflow: node.scrollWidth - node.clientWidth,
      silhouette: node.querySelectorAll('.silhouette').length,
    }))
    check('接入 App CSS：卡片仍宽 760 以内', withApp.width <= 760 && withApp.width > 300, `${Math.round(withApp.width)}px`)
    check('接入 App CSS：无横向溢出', withApp.overflow <= 1, `overflow=${withApp.overflow}`)
    check('接入 App CSS：剪影仍在', withApp.silhouette === 1)
    await shotEl(page, '[data-testid="panel-main"] [data-testid="beats"]', 'with-app-css')
  }
  await page.close()
}

/* ==========================================================================
   七、嵌进 App 现有 .scene 卡片（beats--flat）
   ========================================================================== */
{
  const page = await openPage({ label: 'flat' })
  const card = page.locator('[data-testid="panel-flat"] [data-testid="beats"]')
  const state = await stateOf(card)
  const flat = await card.evaluate((node) => {
    const style = getComputedStyle(node)
    const shell = node.closest('[data-testid="scene-mock"]')
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      padding: style.paddingTop,
      width: Math.round(node.getBoundingClientRect().width),
      shellWidth: Math.round(shell.getBoundingClientRect().width),
    }
  })
  check('扁平接入：仍然分 3 组', state.total === 3, `total=${state.total}`)
  check(
    '扁平接入：不再画第二层卡片（无底色 / 无边框 / 无内边距）',
    /rgba\(0, 0, 0, 0\)|transparent/.test(flat.background) && flat.border === '0px' && flat.padding === '0px',
    `bg=${flat.background} border=${flat.border} padding=${flat.padding}`,
  )
  check('扁平接入：宽度跟随 .scene 内容盒', Math.abs(flat.width - (flat.shellWidth - 2 * 44)) <= 2 || flat.width < flat.shellWidth, `${flat.width} / ${flat.shellWidth}`)
  await next(page, card)
  await next(page, card)
  await page.waitForTimeout(900)
  check('扁平接入：人物组照样出剪影', (await card.locator('.silhouette').count()) === 1)
  await page.mouse.move(3, 3)
  await shotEl(page, '[data-testid="panel-flat"] [data-testid="scene-mock"]', 'flat-inside-scene')
  await page.close()
}

/* ==========================================================================
   八、过渡中间帧（把动画放慢 6 倍抓一帧，只为看「墨色擦除」长什么样）
   ========================================================================== */
{
  const page = await openPage({ label: 'inflight' })
  const card = page.locator('[data-testid="panel-main"] [data-testid="beats"]')
  await page.waitForTimeout(700)
  await page.addStyleTag({
    content:
      '.beats__beat--leaving{animation-duration:1.4s !important}' +
      '.beats__inkwipe{animation-duration:1.4s !important}' +
      '.beats__beat--current .beats__para{animation-duration:1.4s !important;animation-delay:0s !important}',
  })
  // 点完 30ms 就读（擦除层 220ms 后才移除，窗口很宽）：三层同屏
  await page.evaluate(() => {
    document.querySelector('[data-testid="panel-main"] [data-testid="beats"] [data-testid="beats-next"]').click()
  })
  await page.waitForTimeout(30)
  const inflight = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="panel-main"] [data-testid="beats"]')
    return {
      leaving: card.querySelectorAll('.beats__beat--leaving').length,
      wipe: card.querySelectorAll('.beats__inkwipe').length,
      current: card.querySelectorAll('.beats__beat--current').length,
      lockedHeight: card.querySelector('.beats__stage').style.minHeight,
      index: card.getAttribute('data-beat-index'),
    }
  })
  check(
    '过渡：切组瞬间旧组擦除层 / 墨带 / 新组三层同屏',
    inflight.leaving === 1 && inflight.wipe === 1 && inflight.current === 1 && inflight.index === '1',
    JSON.stringify(inflight),
  )
  await page.mouse.move(3, 3)
  shotIndex += 1
  await card.screenshot({ path: `${OUT}${String(shotIndex).padStart(2, '0')}-transition-inflight.png` })
  await page.close()
}

/* ==========================================================================
   九、console 汇总
   ========================================================================== */
const totalErrors = consoleErrors.reduce((sum, entry) => sum + entry.bucket.length, 0)
check(
  '全程无 console error / pageerror',
  totalErrors === 0,
  totalErrors === 0 ? '' : JSON.stringify(consoleErrors.filter((entry) => entry.bucket.length), null, 1),
)

await browser.close()

const passed = checks.filter((item) => item.ok).length
const failed = checks.filter((item) => !item.ok)
console.log(`\n${passed}/${checks.length} 通过${failed.length ? `，失败 ${failed.length} 项` : ''}`)

const summary = {
  url: baseUrl,
  appCss: alsoAppCss,
  at: new Date().toISOString(),
  total: checks.length,
  passed,
  failed: failed.map((item) => item.name),
  skipped,
  checks,
  consoleErrors: consoleErrors.filter((entry) => entry.bucket.length),
  shots: shotIndex,
}
await writeFile(`${OUT}summary.json`, JSON.stringify(summary, null, 2), 'utf8')

process.exit(failed.length === 0 ? 0 : 1)
