import { readFile, writeFile } from 'node:fs/promises'
const files=['docs/deliverables/提交清单.md','docs/deliverables/打包说明.md','docs/deliverables/成果状态.md']
const pairs=[
 ['32.66 MiB','25.39 MiB'],
 ['34,246,767 B','26,622,958 B'],
 ['607 条目','592 条目'],
 ['587 文件','575 文件'],
 ['fe415e718c3248ab5719affcbf281b792e15931932a95d8740add07b7cfaacdd','0e528dc0a5e278f72f558453ef2ba1786417d6dd960cb30b682c21748a517e5b'],
 ['fe415e71…acdd','0e528dc0…7e5b'],
]
for(const f of files){ let s=await readFile(f,'utf8'); for(const [a,b] of pairs) s=s.split(a).join(b); await writeFile(f,s,'utf8'); console.log('updated',f) }
// 追加迁移与最终交付说明
const extra = `
---

## 2026-10-22 12:4x 最终交付（迁移到 D 盘后）

- 项目已整体迁移到 \`D:\\2026数字媒体\`；C 盘旧目录保留为只读备份，不再作为工作副本。
- 正式材料包（**不含**承诺书 / 截图 / 评审视频 / 汇报PPT）：
  \`D:\\提交\\把名字留下来_四行仓库·苏州河北岸的四百余个名字_460737.zip\`
  **25.39 MiB / 26,622,958 B / 575 文件**，SHA256 \`0e528dc0a5e278f72f558453ef2ba1786417d6dd960cb30b682c21748a517e5b\`
- 单独材料：\`D:\\提交\\运行截图\\\`（10 张 1920×1080 + 截图说明.md）、\`运行截图_460737.zip\`、\`作品汇报PPT\\汇报PPT_把名字留下来_460737.pptx\`、\`作品简介与运行环境.txt/.md/.docx\`、\`提交说明.txt\`
- 仍需线下：报名系统信息填报、承诺书下载盖章扫描上传；评审视频按用户决定不做。
`
for(const f of ['docs/deliverables/提交清单.md','docs/deliverables/成果状态.md']){
  const s=await readFile(f,'utf8'); if(!s.includes('最终交付（迁移到 D 盘后）')) await writeFile(f,s+extra,'utf8')
}
