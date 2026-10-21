import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const file = path.join(ROOT, 'tools', 'quality', 'a11y-check.mjs')
let s = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')

if (!s.includes('advanceBeats')) {
  s = s.replace(
    '// ---------------------------------------------------------------- 1. 键盘走查\nasync function keyboardWalk() {\n',
    `// ---------------------------------------------------------------- 1. 键盘走查
async function advanceBeats() {
  for (let i = 0; i < 6; i += 1) {
    const btn = page.getByRole('button', { name: /继续读/ })
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
    await new Promise((r) => setTimeout(r, 650))
  }
}

async function keyboardWalk() {
`,
  )
  s = s.replace(
    "  await shot('a11y-scene-keyboard.png')\n",
    "  await shot('a11y-scene-keyboard.png')\n  await advanceBeats()\n",
  )
  // 结局后回到场景 2，再收尾 beats
  s = s.replace(
    "  // 空格继续（下一场有选项时用空格不该误触发）\n  const choiceCount2 = await page.locator('.choice').count()\n",
    "  // 空格继续（下一场有选项时用空格不该误触发）\n  await advanceBeats()\n  const choiceCount2 = await page.locator('.choice').count()\n",
  )
  await writeFile(file, s, 'utf8')
  console.log('a11y-check patched')
} else {
  console.log('already patched')
}
