import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
const ROOT = process.cwd()
const files=['docs/deliverables/成果状态.md','docs/deliverables/提交清单.md','docs/deliverables/打包说明.md','docs/report/2026-10-21-build-report.md','docs/deliverables/第三方资源说明.md','docs/deliverables/作品介绍.md','docs/deliverables/AI使用说明.md','docs/deliverables/评审视频脚本.md','README.md','docs/superpowers/active-context.md']
const map=[['298.5','319.0'],['23.47','24.59'],['545 文件','550 文件'],['545个文件','550个文件'],['544 文件','550 文件'],['844.87','906.07'],['845.59','906.07'],['297.69','319.0'],['150.66','171.1'],['166.7','171.1'],['668.7','670.2']]
for(const f of files){ try{ let s=await readFile(path.join(ROOT,f),'utf8'); const b=s; for(const [a,c] of map) s=s.split(a).join(c); if(s!==b){ await writeFile(path.join(ROOT,f),s,'utf8'); console.log('updated',f) } }catch(e){ console.log('skip',f) } }
