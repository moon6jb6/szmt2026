import { readFile, writeFile } from 'node:fs/promises'
const auto = await readFile('src/game/content/sources.auto.ts','utf8')
const base = await readFile('src/game/content/sources.ts','utf8')
const out = []
const reAuto = /"id":\s*"([^"]+)"[\s\S]*?"note":\s*"((?:[^"\\]|\\.)*)"/g
let m
while ((m = reAuto.exec(auto))) {
  out.push({ file: 'auto', id: m[1], note: JSON.parse('"' + m[2] + '"') })
}
const reBase = /id:\s*'([^']+)'[\s\S]*?note:\s*'((?:[^'\\]|\\.)*)'/g
while ((m = reBase.exec(base))) {
  out.push({ file: 'base', id: m[1], note: m[2].replace(/\\'/g, "'") })
}
await writeFile('D:/backups/source-notes.json', JSON.stringify(out, null, 2), 'utf8')
console.log('notes', out.length)
for (const n of out) console.log(`[${n.file}:${n.id}] ${n.note}`)
