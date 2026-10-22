import { readFile, writeFile } from 'node:fs/promises'
const auto = await readFile('src/game/content/sources.auto.ts','utf8')
const notes = {}
const re = /"id":\s*"([^"]+)"[\s\S]*?"note":\s*"((?:[^"\\]|\\.)*)"/g
let m
while ((m = re.exec(auto))) notes[m[1]] = JSON.parse(`"${m[2]}"`)
const jp = 'docs/deliverables/史料收集回填.json'
const data = JSON.parse(await readFile(jp,'utf8'))
let hit = 0
for (const item of data.filled) {
  const slot = (item.slot_id ?? '').toLowerCase()
  const id = slot ? `auto-${slot}` : ''
  if (notes[id]) { item.note = notes[id]; hit += 1 }
}
await writeFile(jp, JSON.stringify(data,null,2) + '\n', 'utf8')
console.log('synced', hit, 'of', data.filled.length)
