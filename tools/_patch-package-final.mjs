import fs from 'node:fs'

const file = 'tools/package.mjs'
let s = fs.readFileSync(file, 'utf8')

if (!s.includes('EXCLUDE_HANDOFF')) {
  s = s.replace(
    "const NO_SCREENSHOTS = process.argv.includes('--no-screenshots')",
    "const NO_SCREENSHOTS = process.argv.includes('--no-screenshots')\n// --final：正式材料包——不放截图、视频、承诺书/PPT 占位目录（这些单独上传）\nconst EXCLUDE_HANDOFF = process.argv.includes('--final')",
  )

  // DIR_SPEC：剔除占位目录
  const dirEnd = s.indexOf('];', s.indexOf('const DIR_SPEC'))
  const dirInject = `

if (EXCLUDE_HANDOFF) {
  for (let i = DIR_SPEC.length - 1; i >= 0; i -= 1) {
    if (DIR_SPEC[i].p.startsWith('02_作品展示视频') || DIR_SPEC[i].p.startsWith('报名与承诺书')) {
      DIR_SPEC.splice(i, 1)
    }
  }
}
`
  s = s.slice(0, dirEnd + 2) + dirInject + s.slice(dirEnd + 2)

  // ENTRY_SPEC：剔除占位条目（video 无条目，报名无条目；保险起见过滤）
  const entEnd = s.indexOf('];', s.indexOf('const ENTRY_SPEC'))
  const entInject = `

if (EXCLUDE_HANDOFF) {
  for (let i = ENTRY_SPEC.length - 1; i >= 0; i -= 1) {
    const to = String(ENTRY_SPEC[i].to || '')
    if (to.startsWith('02_作品展示视频') || to.startsWith('报名与承诺书')) ENTRY_SPEC.splice(i, 1)
  }
}
`
  s = s.slice(0, entEnd + 2) + entInject + s.slice(entEnd + 2)

  // 截图检查：--final 时也跳过
  s = s.replace(
    'if (NO_SCREENSHOTS) return { count: 0, expected: 0, ok: true, bytes: 0, names: [] }',
    'if (NO_SCREENSHOTS || EXCLUDE_HANDOFF) return { count: 0, expected: 0, ok: true, bytes: 0, names: [] }',
  )

  fs.writeFileSync(file, s, 'utf8')
  console.log('patched --final')
} else {
  console.log('already patched')
}
