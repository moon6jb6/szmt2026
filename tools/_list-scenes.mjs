import { readFile } from 'node:fs/promises'
const files = ['chapter1.ts','volume0.ts','volume1.ts','volume2.ts','volume3.ts','volume4.ts','volume5.ts']
for (const f of files) {
  const s = await readFile(`src/game/content/${f}`,'utf8')
  const re = /id:\s*'([^']+)'[\s\S]{0,300}?title:\s*'([^']+)'/g
  const rows=[]; let m
  while ((m=re.exec(s))) { const b = /background:\s*'([^']+)'/.exec(s.slice(m.index, m.index+600)); rows.push(`${m[1]} ${m[2]}${b?` [${b[1]}]`:''}`) }
  console.log(`--- ${f} (${rows.length}) ---`); console.log(rows.slice(0,8).join(' | ')); console.log('...', rows.slice(-3).join(' | '))
}
