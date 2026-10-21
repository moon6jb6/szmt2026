import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = fileURLToPath(new URL('./shots/', import.meta.url))
await mkdir(outDir, { recursive: true })

const routes = [
  {
    name: '名册',
    path: ['p1', 'n1a', 'n1b-a', 'n2a', 'n2b-a', 'n3b', 'n3b-a', 'n4b', 'n4b-a', 'n5a', 'n5b-a', 'epi-roster'],
  },
  {
    name: '家书',
    path: ['p2', 'n1a', 'n1b-a', 'n2b', 'n2b-a', 'n3a', 'n3b-a', 'n4a', 'n4b-a', 'n5b', 'n5b-b', 'epi-letters'],
  },
  {
    name: '旗',
    path: ['p1', 'n1c', 'n1b-a', 'n2a', 'n2b-a', 'n3a', 'n3b-b', 'n4d', 'n4b-b', 'n5a', 'n5b-a', 'epi-flag'],
  },
  {
    name: '照片',
    path: ['p1', 'n1a', 'n1b-a', 'n2a', 'n2b-a', 'n3a', 'n3b-a', 'n4c', 'n4b-a', 'n5a', 'n5b-a', 'epi-photo'],
  },
  {
    name: '口述',
    path: ['p3', 'n1b', 'n1b-b', 'n2c', 'n2b-b', 'n3c', 'n3b-b', 'n4a', 'n4b-a', 'n5b', 'n5b-b', 'epi-testimony'],
  },
  {
    name: '口信',
    path: ['p1', 'n1a', 'n1b-a', 'n2a', 'n2b-a', 'n3a', 'n3b-a', 'n4a', 'n4b-a', 'n5c', 'n5b-a', 'epi-message'],
  },
]

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

/** 等墨迹幕结束（换场完成） */
async function waitCurtain() {
  await page.waitForTimeout(180)
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.ink-curtain')
        return !el || el.getAttribute('data-live') !== '1'
      },
      { timeout: 12000 },
    )
    .catch(() => {})
  await page.waitForTimeout(120)
}

async function play(route) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '从头开始' }).click()
  await waitCurtain()

  for (const step of route.path) {
    if (step.startsWith('epi-')) {
      await page.locator(`[data-choice="${step}"]`).click()
      await page.waitForTimeout(300)
      const finish = page.locator('.continue')
      if (await finish.isVisible().catch(() => false)) {
        await finish.click()
      } else {
        await page.getByRole('button', { name: '把东西交出去' }).click()
      }
      await waitCurtain()
      await page.locator('.ending h1').waitFor({ timeout: 12000 }).catch(() => {})
      return
    }

    await page.locator(`[data-choice="${step}"]`).click()
    await page.waitForTimeout(280)
    const cont = page.locator('.continue')
    if (await cont.isVisible().catch(() => false)) {
      await cont.click()
      await waitCurtain()
    }
  }
}

const results = []
for (const route of routes) {
  await play(route)
  const heading = await page.locator('.ending h1').innerText().catch(() => '(未到达结局)')
  const coda = await page.locator('.ending-coda').innerText().catch(() => '')
  const ok = heading === route.name && coda.includes('还有一百多个名字')
  results.push({ expected: route.name, got: heading, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} expected=${route.name} got=${heading}`)
}

// 结局一览解锁数
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '结局一览' }).click()
await page.waitForTimeout(400)
const galleryText = await page.locator('.gallery').innerText()

console.log('gallery lead:', galleryText.split('\n').find((line) => line.includes('已解锁')))
console.log('errors:', errors.length ? errors : 'none')
console.log('summary:', results.filter((item) => item.ok).length, '/', results.length, 'endings reachable')

await browser.close()
if (results.some((item) => !item.ok)) process.exitCode = 1
