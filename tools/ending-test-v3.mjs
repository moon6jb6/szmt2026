import { chromium } from 'playwright'

/**
 * 九结局快速可达性测试：
 * 注入「已走到 epilogue」的存档（localStorage 的 GameState JSON），
 * 点「继续上次」→ 在 epilogue 依次选择第 k 个结局 → 跳过结局终极画面 → 断言结局页标题。
 * 6 个主结局 + 3 个合成结局（需要两种载体同时在账本里，测试存档全部置 2）。
 */
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const SAVE_KEY = 'names-ledger-v1'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})

const saveTemplate = {
  sceneId: 'epilogue',
  ledger: { roster: 2, letters: 2, flag: 2, photo: 2, testimony: 2, message: 2 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60_000,
  finishedAt: null,
}

const EXPECTED = ['名册', '家书', '旗', '照片', '口述', '口信', '档案', '遗物', '口耳']
const results = []

for (let k = 0; k < 9; k += 1) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(
    ({ key, state }) => localStorage.setItem(key, JSON.stringify(state)),
    { key: SAVE_KEY, state: saveTemplate },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(1600)

  // 尾声已改为 CarryTray：按 aria-label 里的结局名选中，再点「交出去」
  const tray = page.locator('.carry-tray')
  const items = page.locator('button[aria-label*="结局："]')
  const count = await items.count()
  if (!(await tray.isVisible().catch(() => false)) || count < 9) {
    results.push({ index: k + 1, title: '', error: `tray=${await tray.isVisible().catch(() => false)} items=${count}` })
    continue
  }
  const labels = await items.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  const targetIndex = labels.findIndex((label) => label.includes(`结局：${EXPECTED[k]}`))
  if (targetIndex < 0) {
    results.push({ index: k + 1, title: '', error: `no item for ${EXPECTED[k]}` })
    continue
  }
  await items.nth(targetIndex).click()
  await page.waitForTimeout(400)
  const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()
  if (await commit.isVisible().catch(() => false)) await commit.click()
  await page.waitForTimeout(600)
  const cont = page.locator('.continue')
  if (await cont.isVisible().catch(() => false)) {
    await cont.click({ timeout: 3000 }).catch(() => {})
  }

  // 结局终极画面（6 秒）：出现后点击跳过
  await page.waitForTimeout(1200)
  if (await page.locator('.finale').isVisible().catch(() => false)) {
    await page.locator('.finale').click({ position: { x: 400, y: 300 } })
  }
  for (let wait = 0; wait < 30; wait += 1) {
    if (await page.locator('.ending').isVisible().catch(() => false)) break
    await page.waitForTimeout(250)
  }
  const title = (await page.locator('.ending h1').innerText().catch(() => '')).trim()
  results.push({ index: k + 1, title })
  console.log(`route ${k + 1}: ${title || '(未到达)'}`)
}

const titles = results.map((item) => item.title)
const ok = titles.length === 9 && titles.every((title) => title) && titles.join('|') === EXPECTED.join('|')
console.log('\nPASS:', ok ? `9/9` : 'FAIL')
console.log('endings:', titles.join(' / '))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (!ok || errors.length) process.exitCode = 1
