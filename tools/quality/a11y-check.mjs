/**
 * 无障碍终审（无头 Chrome / Playwright），不改 src。
 *
 * 用法：node tools/quality/a11y-check.mjs [url]
 * 输出：控制台报告 + tools/quality/a11y.json + tools/quality/shots/a11y-*.png
 *
 * 覆盖：
 *   1. 键盘完整走查：Tab 顺序、焦点可见性、Enter/空格/数字键、换场后焦点是否丢失
 *   2. 语义：按钮可访问名 / aria-pressed / 选项 role 覆盖 / 图片 alt / 标题层级 / 弹层焦点 / aria-live
 *   3. 对比度：计算样式取前景色 + 真实合成背景像素（截图回灌 canvas），报 p05 / 中位 / 低于阈值像素占比
 *      —— 背景像素来自真实渲染（含插画、半透明卡片、2.5D/3D 层、雪粒），不是按色值推算
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const shot = (name) => page.screenshot({ path: join(SHOTS, name) })
const wait = (ms) => page.waitForTimeout(ms)
const save = (sceneId) =>
  page.evaluate(
    ({ key, id }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          sceneId: id,
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
    { key: SAVE_KEY, id: sceneId },
  )

// ---------------------------------------------------------------- 焦点信息
const activeInfo = () =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'BODY', name: '(body)', outline: '' }
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 30),
      name: (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 34),
      role: el.getAttribute('role') || '',
      ariaPressed: el.getAttribute('aria-pressed'),
      outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
      focusVisible: el.matches(':focus-visible'),
      inViewport: rect.top >= -2 && rect.bottom <= window.innerHeight + 2 && rect.width > 0,
    }
  })

// ---------------------------------------------------------------- 1. 键盘走查
async function advanceBeats() {
  for (let i = 0; i < 6; i += 1) {
    const btn = page.getByRole('button', { name: /继续读/ })
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
    await new Promise((r) => setTimeout(r, 650))
  }
}

async function keyboardWalk() {
  const order = []
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press('Tab')
    order.push(await activeInfo())
  }
  await page.getByRole('button', { name: '从头开始' }).focus()
  const focusStyle = await activeInfo()
  await shot('a11y-focus-menu.png')

  await page.getByRole('button', { name: '从头开始' }).press('Enter')
  await page.waitForSelector('.scene h1', { timeout: 15000 })
  await wait(900)
  const scene1 = await page.locator('.scene').getAttribute('data-scene')
  const h1 = (await page.locator('.scene h1').innerText()).trim()
  await shot('a11y-scene-keyboard.png')
  await advanceBeats()
  const afterScreenFocus = await activeInfo()

  const sceneTabOrder = []
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab')
    sceneTabOrder.push(await activeInfo())
  }

  const choices = await page.locator('.choice').count()
  await page.keyboard.press('1')
  await wait(700)
  const digitWorked = await page.locator('.continue').isVisible().catch(() => false)
  await shot('a11y-scene-outcome.png')

  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SAVE_KEY)
  await page.locator('.continue').focus()
  await page.keyboard.press('Enter')
  await wait(2400)
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SAVE_KEY)
  const scene2 = await page.locator('.scene').getAttribute('data-scene').catch(() => null)
  const focusAfterAdvance = await activeInfo()

  // 空格继续（下一场有选项时用空格不该误触发）
  await advanceBeats()
  const choiceCount2 = await page.locator('.choice').count()
  if (choiceCount2 > 0) {
    const beforeSpace = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SAVE_KEY)
    await page.keyboard.press(' ')
    await wait(400)
    var spaceState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SAVE_KEY)
    var spaceChanged = beforeSpace?.sceneId !== spaceState?.sceneId
  }

  return {
    tabOrderMenu: order,
    focusStyle,
    scene1,
    h1,
    afterScreenFocus,
    sceneTabOrder,
    choices,
    digitKeyWorked: digitWorked,
    expectedNext: before?.pendingNext ?? null,
    advancedTo: after?.sceneId ?? null,
    scene2,
    focusAfterAdvance,
    choiceCount2,
    spaceIgnoredOnChoiceScreen: spaceChanged === false,
  }
}

// ---------------------------------------------------------------- 2. 语义 / 标题层级
async function axTree() {
  const cdp = await context.newCDPSession(page)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  await cdp.detach()
  const roles = {}
  const buttons = []
  const listitems = []
  for (const n of nodes) {
    if (n.ignored) continue
    const role = n.role?.value ?? 'none'
    roles[role] = (roles[role] || 0) + 1
    const name = (n.name?.value ?? '').slice(0, 26)
    if (role === 'button') buttons.push(name)
    if (role === 'listitem') listitems.push({ name, level: n.properties?.find((p) => p.name === 'level')?.value?.value })
  }
  return { roles, buttons, listitems }
}

async function semantics(label) {
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => `${h.tagName}:${(h.innerText || '').trim().slice(0, 16)}`),
  )
  const imgs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map((img) => ({ alt: img.getAttribute('alt'), loaded: img.complete && img.naturalWidth > 0 })),
  )
  const aria = await page.evaluate(() => ({
    live: document.querySelectorAll('[aria-live],[role=status],[role=alert]').length,
    pressed: [...document.querySelectorAll('[aria-pressed]')].map((b) => `${(b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 10)}=${b.getAttribute('aria-pressed')}`),
    roleOverrides: [...document.querySelectorAll('button[role]')].map((b) => `${b.getAttribute('role')}:${(b.innerText || '').trim().slice(0, 12)}`),
    landmarks: [...document.querySelectorAll('main,nav,header,footer,[role=main]')].map((n) => n.tagName.toLowerCase()),
  }))
  const ax = await axTree()
  return { label, headings, imgs, ...aria, axRoles: ax.roles, axButtons: ax.buttons, axListitems: ax.listitems }
}

// ---------------------------------------------------------------- 3. 对比度
const CONTRAST_SAMPLES = [
  ['menu', ['.menu .title'], true],
  ['menu', ['.menu-lead'], false],
  ['menu', ['.menu-facts li'], false],
  ['menu', ['.content-note'], false],
  ['menu', ['.primary-button'], false],
  ['menu', ['.quiet-button'], false],
  ['menu', ['.eyebrow'], false],
  ['menu', ['.audio-toggle'], false],
  ['scene', ['.scene-head h1'], true],
  ['scene', ['.chapter'], false],
  ['scene', ['.scene-meta'], false],
  ['scene', ['.scene .prose p'], false],
  ['scene', ['.choice-text strong'], false],
  ['scene', ['.choice-text em'], false],
  ['scene', ['.chip'], false],
  ['scene', ['.source-row .eyebrow'], false],
  ['scene3d', ['.view3d-toggle'], false],
  ['scene3d', ['.scene-3d-hint'], false],
  ['scene3d', ['.stage-3d .scene .prose p'], false],
  ['ending', ['.ending h1'], true],
  ['ending', ['.prose-ending p'], false],
  ['ending', ['.ending-coda'], false],
  ['sources', ['.source-claim'], false],
  ['sources', ['.source-quote p'], false],
  ['sources', ['.badge'], false],
]

function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

async function sampleContrast(selector, debugName) {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) return null
  await el.scrollIntoViewIfNeeded().catch(() => {})
  await wait(150)
  const meta = await el.evaluate((node) => {
    const cs = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    const parse = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const parts = m[1].split(/[,/]/).map((s) => parseFloat(s.trim()))
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
    }
    return {
      colorRGBA: parse(cs.color),
      fontSize: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight) || 400,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      text: (node.innerText || '').trim().slice(0, 14),
    }
  })
  // 内缩 2px：排除 1px 描边/圆角抗锯齿；同时把 ::first-letter / ::before 的文字一起隐掉
  const inset = 2
  const clip = {
    x: Math.max(0, meta.rect.x + inset),
    y: Math.max(0, meta.rect.y + inset),
    width: Math.max(4, Math.min(meta.rect.w - inset * 2, 1440 - meta.rect.x - inset)),
    height: Math.max(4, Math.min(meta.rect.h - inset * 2, 900 - meta.rect.y - inset)),
  }
  await page.addStyleTag({
    content:
      'html.qa-contrast *,html.qa-contrast *::first-letter,html.qa-contrast *::before,html.qa-contrast *::after{color:transparent!important;text-shadow:none!important;caret-color:transparent!important}',
  })
  await page.evaluate(() => document.documentElement.classList.add('qa-contrast'))
  await wait(90)
  const png = await page.screenshot({ clip })
  if (debugName) await page.screenshot({ path: join(SHOTS, `${debugName}-bg.png`), clip })
  await page.evaluate(() => document.documentElement.classList.remove('qa-contrast'))
  await wait(60)

  const pixels = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const list = []
    const stepX = Math.max(1, Math.floor(canvas.width / 60))
    const stepY = Math.max(1, Math.floor(canvas.height / 14))
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const i = (y * canvas.width + x) * 4
        list.push([data[i], data[i + 1], data[i + 2]])
      }
    }
    return list
  }, png.toString('base64'))

  const fg = (meta.colorRGBA ?? [237, 230, 216, 1]).slice(0, 3)
  const ratios = pixels.map((bg) => ratio(fg, bg)).sort((a, b) => a - b)
  const large = meta.fontSize >= 24 || (meta.fontSize >= 18.66 && meta.fontWeight >= 700)
  const need = large ? 3 : 4.5
  const below = ratios.filter((r) => r < need).length / ratios.length
  return {
    selector,
    text: meta.text,
    fontSize: meta.fontSize,
    large,
    need,
    p05: pct(ratios, 0.05),
    median: pct(ratios, 0.5),
    min: ratios[0],
    belowNeedPct: Math.round(below * 1000) / 10,
    pass: pct(ratios, 0.05) >= need,
    pixels: ratios.length,
  }
}

async function sampleGroup(screen) {
  const rows = []
  for (const [tag, selectors, debug] of CONTRAST_SAMPLES.filter((s) => s[0] === screen)) {
    for (const selector of selectors) {
      const r = await sampleContrast(selector, debug ? `a11y-contrast-${tag}` : null)
      if (r) rows.push({ screen, ...r })
    }
  }
  return rows
}

// ---------------------------------------------------------------- 流程
// A. 菜单（先测，再走键盘）
await page.goto(URL, { waitUntil: 'load' })
await wait(1200)
const contrast = []
contrast.push(...(await sampleGroup('menu')))
out.semanticsMenu = await semantics('menu')
out.keyboard = await keyboardWalk()
out.semanticsScene = await semantics('scene')
contrast.push(...(await sampleGroup('scene')))
await shot('a11y-scene.png')

// B. 真 3D 场景（night1）
await save('night1')
await page.reload({ waitUntil: 'load' })
await wait(700)
await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(1800)
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
  }
await wait(1800)
const toggle3d = page.getByRole('button', { name: '3D 视角' })
const toggleVisible = await toggle3d.isVisible().catch(() => false)
let on3d = null
if (toggleVisible) {
  await toggle3d.click()
  await wait(1800)
  on3d = await page.evaluate(() => {
    const btn = document.querySelector('.view3d-toggle')
    return {
      text: btn?.textContent,
      ariaPressed: btn?.getAttribute('aria-pressed'),
      canvas: !!document.querySelector('.stage-3d-layer canvas'),
      hint: !!document.querySelector('.scene-3d-hint'),
    }
  })
  await shot('a11y-3d-on.png')
  contrast.push(...(await sampleGroup('scene3d')))
  await page.getByRole('button', { name: '回到 2.5D' }).click()
  await wait(900)
  await shot('a11y-3d-off.png')
}
out.view3d = { toggleVisible, on3d }

// C. 史料卡弹层（键盘可达性 + 焦点管理）
let panel = null
const chip = page.locator('.chip').first()
if ((await chip.count()) > 0) {
  await chip.focus()
  const beforeFocus = await activeInfo()
  await page.keyboard.press('Enter')
  await wait(500)
  const panelVisible = await page.locator('.source-panel').isVisible().catch(() => false)
  const afterOpenFocus = await activeInfo()
  await page.keyboard.press('Escape')
  await wait(300)
  const escClosed = !(await page.locator('.source-panel').isVisible().catch(() => false))
  const panelSemantics = await page.evaluate(() => {
    const p = document.querySelector('.source-panel')
    if (!p) return null
    return { role: p.getAttribute('role'), ariaModal: p.getAttribute('aria-modal'), label: p.getAttribute('aria-label'), headingLevel: p.querySelector('h3') ? 'h3' : null }
  })
  await shot('a11y-source-panel.png')
  panel = { beforeFocus, panelVisible, afterOpenFocus, escClosed, panelSemantics }
  if (!escClosed) await page.locator('.source-panel .text-button').click().catch(() => {})
}
out.sourcePanel = panel

// D. 结局页（注入存档 → epilogue → 第九个选项 → 终极画面）
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
await wait(800)
await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(1800)
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
  }
await wait(1900)
// 尾声现在是 CarryTray（桌上实物），选第 9 件再点「交出去」
if (await page.locator('.carry-tray').isVisible().catch(() => false)) {
  const items = page.locator('button[aria-label*="结局："]')
  if ((await items.count()) >= 9) await items.nth(8).click()
  await wait(500)
  const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()
  if (await commit.isVisible().catch(() => false)) await commit.click()
} else {
  await page.locator('.choice').nth(8).click().catch(() => {})
}
await wait(700)
await page.locator('.continue').click().catch(() => {})
await page.waitForSelector('.finale', { timeout: 15000 }).catch(() => {})
await wait(400)
const finaleVisible = await page.locator('.finale').isVisible().catch(() => false)
const finaleProbe = await page.evaluate(() => {
  const f = document.querySelector('.finale')
  if (!f) return null
  const canvas = f.querySelector('canvas')
  return {
    role: f.getAttribute('role'),
    tabIndex: f.tabIndex,
    ariaHidden: f.getAttribute('aria-hidden'),
    canvasDisplay: canvas ? getComputedStyle(canvas).display : 'no-canvas',
    skipText: f.querySelector('.finale-skip')?.textContent ?? '',
    focusableCount: f.querySelectorAll('button,a,[tabindex]').length,
  }
})
if (finaleVisible) {
  await shot('a11y-finale.png')
  await page.locator('.finale').click({ position: { x: 600, y: 400 } })
}
for (let i = 0; i < 30; i += 1) {
  if (await page.locator('.ending').isVisible().catch(() => false)) break
  await wait(250)
}
await wait(800)
out.endingTitle = (await page.locator('.ending h1').innerText().catch(() => '')).trim()
out.finale = finaleProbe
out.semanticsEnding = await semantics('ending')
contrast.push(...(await sampleGroup('ending')))
await shot('a11y-ending.png')

// E. 其他页面标题层级
await page.goto(URL, { waitUntil: 'load' })
await wait(700)
await page.getByRole('button', { name: '史料库' }).click()
await wait(700)
out.headingsSources = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].slice(0, 6).map((h) => `${h.tagName}:${h.innerText.trim().slice(0, 14)}`))
contrast.push(...(await sampleGroup('sources')))
await shot('a11y-sources.png')
await page.goto(URL, { waitUntil: 'load' })
await wait(600)
await page.getByRole('button', { name: '结局一览' }).click()
await wait(500)
out.headingsGallery = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].slice(0, 4).map((h) => `${h.tagName}:${h.innerText.trim().slice(0, 10)}`))
await page.goto(URL, { waitUntil: 'load' })
await wait(600)
await page.getByRole('button', { name: '人物志' }).click()
await wait(500)
out.headingsPeople = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].slice(0, 4).map((h) => `${h.tagName}:${h.innerText.trim().slice(0, 10)}`))
await page.getByRole('button', { name: '返回' }).first().click().catch(() => {})
await wait(400)
await page.getByRole('button', { name: '关于与史料' }).click()
await wait(500)
out.headingsAbout = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].slice(0, 4).map((h) => `${h.tagName}:${h.innerText.trim().slice(0, 10)}`))

out.contrast = contrast
out.errors = errors
writeFileSync(join(ROOT, 'tools/quality/a11y.json'), JSON.stringify(out, null, 2), 'utf8')
await browser.close()

// ---------------------------------------------------------------- 打印
console.log('\n=== 1. 键盘走查 ===')
console.log('菜单 Tab 顺序:')
out.keyboard.tabOrderMenu.forEach((t, i) => console.log(`  ${i + 1}. <${t.tag}> ${t.name} | ${t.outline} | focus-visible=${t.focusVisible} | inViewport=${t.inViewport}`))
console.log('进入场景:', out.keyboard.scene1, '「' + out.keyboard.h1 + '」')
console.log('换场后焦点:', out.keyboard.afterScreenFocus.tag, out.keyboard.afterScreenFocus.name)
console.log('场景内 Tab:')
out.keyboard.sceneTabOrder.forEach((t, i) => console.log(`  ${i + 1}. <${t.tag}> ${t.name} | ${t.outline} | visible=${t.focusVisible}`))
console.log('数字键 1:', out.keyboard.digitKeyWorked ? '选出结果页' : '无效')
console.log('Enter 继续：期望', out.keyboard.expectedNext, '实际', out.keyboard.advancedTo, '→ 没跳场:', out.keyboard.expectedNext === out.keyboard.advancedTo)
console.log('继续后焦点:', out.keyboard.focusAfterAdvance.tag, out.keyboard.focusAfterAdvance.name)
console.log('有选项时按空格：', out.keyboard.choiceCount2 > 0 ? (out.keyboard.spaceIgnoredOnChoiceScreen ? '未误触（正确）' : '误触进入下一场') : '本场无选项')

console.log('\n=== 2. 语义 ===')
console.log('菜单 heading:', out.semanticsMenu.headings.join(' / '), '| aria-live:', out.semanticsMenu.live)
console.log('场景 heading:', out.semanticsScene.headings.join(' / '), '| aria-live:', out.semanticsScene.live)
console.log('结局 heading:', out.semanticsEnding.headings.join(' / '))
console.log('人物志:', out.headingsPeople.join(' / '), '| 结局一览:', out.headingsGallery.join(' / '), '| 关于:', out.headingsAbout.join(' / '))
console.log('史料库:', out.headingsSources.join(' / '))
console.log('场景页 button[role] 覆盖:', JSON.stringify(out.semanticsScene.roleOverrides))
console.log('场景页 AX：button =', JSON.stringify(out.semanticsScene.axButtons.slice(0, 8)))
console.log('场景页 AX：listitem =', JSON.stringify(out.semanticsScene.axListitems))
console.log('aria-pressed:', JSON.stringify(out.semanticsScene.pressed))
console.log('图片 alt:', JSON.stringify(out.semanticsScene.imgs))
console.log('landmarks:', JSON.stringify(out.semanticsScene.landmarks))
console.log('3D 开关:', JSON.stringify(out.view3d))
console.log('史料卡弹层:', JSON.stringify(out.sourcePanel))
console.log('终极画面:', JSON.stringify(out.finale))
console.log('结局:', out.endingTitle)

console.log('\n=== 3. 对比度（真实合成背景像素，p05 / 中位，低于阈值像素占比）===')
for (const c of out.contrast) {
  console.log(
    `${c.pass ? 'PASS' : 'LOW '} ${c.screen.padEnd(8)} ${c.selector.padEnd(26)} ${String(c.fontSize).padStart(4)}px  需${c.need}  p05 ${String(c.p05).padStart(6)}  中位 ${String(c.median).padStart(6)}  最低 ${String(c.min).padStart(6)}  <阈 ${c.belowNeedPct}%  ${c.text}`,
  )
}
console.log('\n错误：', errors.length ? errors.slice(0, 5) : 'none')
console.log('JSON → tools/quality/a11y.json\n')
