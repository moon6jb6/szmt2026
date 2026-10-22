import { readFile, writeFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
const pairs = [
  ['847.26', '897.96'],
  ['gzip 319.0', 'gzip 316.6'],
  ['319.0 kB', '316.6 kB'],
  ['24.59', '24.58'],
  ['545 个文件', '550 个文件'],
  ['545 文件', '550 文件'],
  ['32.96 MiB', '32.66 MiB'],
  ['34,556,356 B', '34,246,748 B'],
  ['5751b48cf6308efcaabe5ae5cc4c2365fe6a7d79b6cc787b20c50c00809ed712', '801148ca0154673d63d0e537697b0edb28e76187958feddd38c58aa9aacd1490'],
]
const files = []
for (const dir of ['docs/deliverables', 'docs/report']) {
  for (const f of await readdir(dir)) if (f.endsWith('.md')) files.push(`${dir}/${f}`)
}
files.push('README.md', 'docs/superpowers/active-context.md')
for (const f of files) {
  try {
    let s = await readFile(f, 'utf8')
    const before = s
    for (const [a, b] of pairs) s = s.split(a).join(b)
    if (s !== before) { await writeFile(f, s, 'utf8'); console.log('updated', f) }
  } catch {}
}
