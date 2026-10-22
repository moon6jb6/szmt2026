import { readFile } from 'node:fs/promises'
const files=['chapter1.ts','volume0.ts','volume1.ts','volume2.ts','volume3.ts','volume4.ts','volume5.ts']
for(const f of files){
  const s=await readFile(`src/game/content/${f}`,'utf8')
  const chunks=s.split(/\n  \{\n    id:/).slice(1)
  for(const c of chunks){
    const id=(c.match(/^\s*'([^']+)'/)||[])[1]
    if(id && /roster/.test(c) && /choices:/.test(c)) console.log(f, id, 'has roster mention + choices')
  }
}
