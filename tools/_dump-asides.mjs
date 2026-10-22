import { readFile } from 'node:fs/promises'
const files = ['src/game/content/chapter1.ts','src/game/content/volume0.ts','src/game/content/volume1.ts','src/game/content/volume2.ts','src/game/content/volume3.ts','src/game/content/volume4.ts','src/game/content/volume5.ts','src/game/content/endings.ts']
for (const f of files) {
  const s = await readFile(f,'utf8')
  const re = /aside:\s*'((?:[^'\\]|\\.)*)'|aside:\s*"((?:[^"\\]|\\.)*)"/g
  let m; let i=0
  while ((m = re.exec(s))) { i++; console.log(`${f.split('/').pop()}#${i}: ${m[1] ?? m[2]}`) }
}
