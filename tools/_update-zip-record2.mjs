import { readFile, writeFile } from 'node:fs/promises'
const files=['docs/deliverables/打包说明.md','docs/deliverables/提交清单.md','docs/deliverables/成果状态.md']
const map=[['471122706ed402d8adf4566ce6697ddea1a2547ecc2aab1d31bfc484867b9d52','5751b48cf6308efcaabe5ae5cc4c2365fe6a7d79b6cc787b20c50c00809ed712'],['32,922,607 B','34,556,356 B'],['31.40 MiB','32.96 MiB'],['597 条目','607 条目'],['579 文件','587 文件']]
for(const f of files){ let s=await readFile(f,'utf8'); for(const [a,b] of map) s=s.split(a).join(b); await writeFile(f,s,'utf8'); console.log('updated',f) }
