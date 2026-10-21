import { chromium } from 'playwright'

/**
 * 六结局快速可达性测试：
 * 直接注入一个「已走到 epilogue」的存档（engine 的 localStorage 格式就是 GameState JSON），
 * 点「继续上次」→ 在 epilogue 选第 k 个结局 → 断言结局页标题。
 * 比从头走 6 遍快 30 倍，且覆盖同一个结局判定代码路径。
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

const results = []
for (let k = 0; k < 6; k += 1) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state))
    },
    { key: SAVE_KEY, state: saveTemplate },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(1600)

  const choices = page.locator('.choice')
  const count = await choices.count()
  if (count < 6) {
    results.push({ index: k + 1, title: '', error: `epilogue choices=${count}` })
    continue
  }
  await choices.nth(k).click()
  await page.waitForTimeout(400)
  const cont = page.locator('.continue')
  if (await cont.isVisible().catch(() => false)) {
    await cont.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(800)
  }
  for (let wait = 0; wait < 20; wait += 1) {
    if (await page.locator('.ending').isVisible().catch(() => false)) break
    await page.waitForTimeout(250)
  }
  const title = (await page.locator('.ending h1').innerText().catch(() => '')).trim()
  results.push({ index: k + 1, title })
  console.log(`route ${k + 1}: ${title || '(未到达)'}`)
}

const titles = results.map((item) => item.title)
const ok = titles.every(Boolean) && new Set(titles).size === 6
console.log('\nPASS:', ok ? '6/6' : 'FAIL')
console.log('endings:', titles.join(' / '))
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
if (!ok || errors.length) process.exitCode = 1
