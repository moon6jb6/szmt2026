import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const load = async (rel) => (await readFile(path.join(ROOT, rel), 'utf8')).replace(/\r\n/g, '\n')
const save = (rel, text) => writeFile(path.join(ROOT, rel), text, 'utf8')

// ---------- walk-test：跳过签名覆盖层 + 尾声 CarryTray ----------
{
  let s = await load('tools/walk-test.mjs')
  if (!s.includes('.signature-overlay')) {
    s = s.replace(
      "for (let guard = 0; guard < 900; guard += 1) {\n  if (await page.locator('.ending').isVisible().catch(() => false)) {",
      "for (let guard = 0; guard < 900; guard += 1) {\n  // 签名时刻覆盖层：走测试统一跳过\n  const sigOverlay = page.locator('.signature-overlay')\n  if (await sigOverlay.isVisible().catch(() => false)) {\n    const skip = page.getByRole('button', { name: '跳过（Esc）' })\n    if (await skip.isVisible().catch(() => false)) {\n      await skip.click()\n      await page.waitForTimeout(500)\n    }\n    continue\n  }\n  if (await page.locator('.ending').isVisible().catch(() => false)) {",
    )
  }
  if (!s.includes('hasTray')) {
    s = s.replace(
      '    if (count === 0 && continueCount === 0 && id) {',
      "    const hasTray = await page.locator('.carry-tray').isVisible().catch(() => false)\n    if (count === 0 && continueCount === 0 && !hasTray && id) {",
    )
  }
  if (!s.includes("button[aria-label*=\"结局：\"]")) {
    s = s.replace(
      "  const cont = page.locator('.continue')",
      "  // 尾声：CarryTray 桌上 9 件实物（选第一件 + 交出去）\n  const tray = page.locator('.carry-tray')\n  if (await tray.isVisible().catch(() => false)) {\n    const trayItem = page.locator('button[aria-label*=\"结局：\"]').first()\n    if (await trayItem.isVisible().catch(() => false)) {\n      await trayItem.click()\n      await page.waitForTimeout(350)\n      const commit = page.locator('.carry-tray button', { hasText: '交出去' }).first()\n      if (await commit.isVisible().catch(() => false)) await commit.click()\n      await page.waitForTimeout(600)\n      steps += 1\n      continue\n    }\n  }\n\n  const cont = page.locator('.continue')",
      1,
    )
  }
  await save('tools/walk-test.mjs', s)
  console.log('walk-test patched')
}

// ---------- ending-test：尾声 CarryTray 按 aria-label 选结局 ----------
{
  let s = await load('tools/ending-test-v3.mjs')
  if (!s.includes('.carry-tray')) {
    s = s.replace(
      `  const choices = page.locator('.choice')
  const count = await choices.count()
  if (count < 9) {
    results.push({ index: k + 1, title: '', error: \`epilogue choices=\${count}\` })
    continue
  }
  await choices.nth(k).click()
  await page.waitForTimeout(500)
  const cont = page.locator('.continue')
  if (await cont.isVisible().catch(() => false)) {
    await cont.click({ timeout: 3000 }).catch(() => {})
  }`,
      `  // 尾声已改为 CarryTray：按 aria-label 里的结局名选中，再点「交出去」
  const tray = page.locator('.carry-tray')
  const items = page.locator('button[aria-label*="结局："]')
  const count = await items.count()
  if (!(await tray.isVisible().catch(() => false)) || count < 9) {
    results.push({ index: k + 1, title: '', error: \`tray=\${await tray.isVisible().catch(() => false)} items=\${count}\` })
    continue
  }
  const labels = await items.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  const targetIndex = labels.findIndex((label) => label.includes(\`结局：\${EXPECTED[k]}\`))
  if (targetIndex < 0) {
    results.push({ index: k + 1, title: '', error: \`no item for \${EXPECTED[k]}\` })
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
  }`,
    )
  }
  await save('tools/ending-test-v3.mjs', s)
  console.log('ending-test patched')
}

// ---------- a11y-check：跳过签名覆盖层 ----------
{
  let s = await load('tools/quality/a11y-check.mjs')
  if (!s.includes('.signature-overlay')) {
    s = s.split("await page.getByRole('button', { name: '继续上次' }).click()").join(
      "await page.getByRole('button', { name: '继续上次' }).click()\n  await page.waitForTimeout(1800)\n  if (await page.locator('.signature-overlay').isVisible().catch(() => false)) {\n    await page.keyboard.press('Escape')\n    await page.waitForTimeout(700)\n  }",
    )
  }
  await save('tools/quality/a11y-check.mjs', s)
  console.log('a11y-check patched')
}
