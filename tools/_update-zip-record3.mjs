import { readFile, writeFile } from 'node:fs/promises'
const pairs = [
  ['25.39 MiB', '25.50 MiB'],
  ['26,622,958 B', '26,741,587 B'],
  ['0e528dc0a5e278f72f558453ef2ba1786417d6dd960cb30b682c21748a517e5b', 'd4f13e65da91b9c6f146dca096c47a4778f5c318cc395d08ea9de272097d55bb'],
  ['0e528dc0…7e5b', 'd4f13e65…55bb'],
  ['32,66 MiB', '25,50 MiB'],
  ['32.66 MiB', '25.50 MiB'],
]
const files = [
  'D:/提交/提交说明.txt',
  'docs/deliverables/打包说明.md',
  'docs/deliverables/提交清单.md',
  'docs/deliverables/成果状态.md',
  'docs/superpowers/active-context.md',
]
for (const f of files) {
  try {
    let s = await readFile(f, 'utf8')
    let changed = false
    for (const [a, b] of pairs) if (s.includes(a)) { s = s.split(a).join(b); changed = true }
    if (changed) { await writeFile(f, s, 'utf8'); console.log('updated', f) }
  } catch (e) { console.log('skip', f) }
}
