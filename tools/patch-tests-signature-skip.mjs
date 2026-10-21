import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const skipSnippet = `
  // 第一夜签名覆盖层：测试先跳过，再进入原断言
  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
  }`

async function patch(rel, from, to, count = 1) {
  const full = path.join(ROOT, rel)
  let s = (await readFile(full, 'utf8')).replace(/\r\n/g, '\n')
  if (!s.includes(from)) {
    console.log(`MISS ${rel}: ${from.slice(0, 40)}`)
    return
  }
  s = s.split(from).join(to)
  await writeFile(full, s, 'utf8')
  console.log(`patched ${rel}`)
}

// test-3d：桌面与移动端 resume 后跳过覆盖层
await patch(
  'tools/test-3d.mjs',
  "await page.getByRole('button', { name: '继续上次' }).click()\nawait page.waitForTimeout(2200)\n",
  "await page.getByRole('button', { name: '继续上次' }).click()\nawait page.waitForTimeout(2200)\n" + skipSnippet + '\n',
)
await patch(
  'tools/test-3d.mjs',
  "await mobile.getByRole('button', { name: '继续上次' }).click()\nawait mobile.waitForTimeout(2000)\n",
  "await mobile.getByRole('button', { name: '继续上次' }).click()\nawait mobile.waitForTimeout(2000)\n  if (await mobile.locator('.signature-overlay').isVisible().catch(() => false)) {\n    await mobile.keyboard.press('Escape')\n    await mobile.waitForTimeout(900)\n  }\n",
)

// test-degrade：两次 resume 后都跳过
await patch(
  'tools/test-degrade.mjs',
  "await page.getByRole('button', { name: '继续上次' }).click()\n  await page.waitForTimeout(1500)\n",
  "await page.getByRole('button', { name: '继续上次' }).click()\n  await page.waitForTimeout(1500)\n" + skipSnippet + '\n',
)
await patch(
  'tools/test-degrade.mjs',
  "await page.getByRole('button', { name: '继续上次' }).click()\n  await page.waitForTimeout(1600)\n",
  "await page.getByRole('button', { name: '继续上次' }).click()\n  await page.waitForTimeout(1600)\n" + skipSnippet + '\n',
)

// chunk-fail
await patch(
  'tools/test-3d-chunk-fail.mjs',
  "await page.getByRole('button', { name: '继续上次' }).click()\nawait page.waitForTimeout(2000)\n",
  "await page.getByRole('button', { name: '继续上次' }).click()\nawait page.waitForTimeout(2000)\n" + skipSnippet + '\n',
)
