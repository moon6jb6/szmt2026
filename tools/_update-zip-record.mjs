import { readFile, writeFile } from 'node:fs/promises'
const files=['docs/deliverables/打包说明.md','docs/deliverables/提交清单.md','docs/deliverables/成果状态.md']
const map=[['b97427858617a1f167cca76c76ccb377827c0b4b1ab19e87d989853cddf3d916','471122706ed402d8adf4566ce6697ddea1a2547ecc2aab1d31bfc484867b9d52'],['29.47 MiB','31.40 MiB'],['30,906,562 B','32,922,607 B'],['29.47','31.40']]
for(const f of files){ let s=await readFile(f,'utf8'); for(const [a,b] of map) s=s.split(a).join(b); await writeFile(f,s,'utf8'); console.log('updated',f) }
