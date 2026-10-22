import fs from 'node:fs'

const file = 'tools/package.mjs'
let s = fs.readFileSync(file, 'utf8')

if (!s.includes('NO_SCREENSHOTS')) {
  // 1) 命令行开关
  s = s.replace(
    "import { fileURLToPath } from 'node:url'",
    "import { fileURLToPath } from 'node:url'\n\n// --no-screenshots：截图按赛事要求单独上传，不放进材料压缩包\nconst NO_SCREENSHOTS = process.argv.includes('--no-screenshots')",
  )

  // 2) DIR_SPEC 后剔除截图目录
  const dirEnd = s.indexOf('];', s.indexOf('const DIR_SPEC'))
  const dirInject = `

// --no-screenshots：截图单独提交，材料包里不放
if (NO_SCREENSHOTS) {
  const i = DIR_SPEC.findIndex((d) => d.p.endsWith('/screenshots'))
  if (i >= 0) DIR_SPEC.splice(i, 1)
}
`
  s = s.slice(0, dirEnd + 2) + dirInject + s.slice(dirEnd + 2)

  // 3) ENTRY_SPEC 后剔除截图条目
  const entEnd = s.indexOf('];', s.indexOf('const ENTRY_SPEC'))
  const entInject = `

if (NO_SCREENSHOTS) {
  for (let i = ENTRY_SPEC.length - 1; i >= 0; i -= 1) {
    if (String(ENTRY_SPEC[i].to || '').includes('screenshots')) ENTRY_SPEC.splice(i, 1)
  }
}
`
  s = s.slice(0, entEnd + 2) + entInject + s.slice(entEnd + 2)

  // 4) 截图检查在 no-screenshots 时直接通过
  s = s.replace(
    'function checkScreenshots(files) {\n  const list',
    "function checkScreenshots(files) {\n  if (NO_SCREENSHOTS) return { count: 0, expected: 0, ok: true, bytes: 0, names: [] }\n  const list",
  )

  fs.writeFileSync(file, s, 'utf8')
  console.log('patched package.mjs')
} else {
  console.log('already patched')
}
