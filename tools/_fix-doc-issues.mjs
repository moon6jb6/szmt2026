import { readFile, writeFile } from 'node:fs/promises'
const edits = [
  ['docs/deliverables/运行说明.md', [
    ['正文：113,138 字', '正文：113,048 字'],
    ['## 十二、2026-10-22 新增交互（v1.5）', '## 十一、2026-10-22 新增交互（v1.5）'],
  ]],
  ['docs/deliverables/人工智能工具使用情况说明.md', [
    ['插画 496 张、背景 16 张', '插画 496 张、背景 8 张（另 8 个同名参数 JSON）'],
    ['插画 496 张、背景 16 张', '插画 496 张、背景 8 张（另 8 个同名参数 JSON）'],
  ]],
  ['README.md', [
    ['AI使用说明.md', '人工智能工具使用情况说明.md'],
  ]],
  ['docs/report/剧情树.md', [
    ['由 tools/story-tree.mjs 自动生成', '由内部脚本根据剧情数据生成（生成脚本不随公开源码分发）'],
  ]],
]
for (const [file, pairs] of edits) {
  let s = await readFile(file, 'utf8')
  for (const [a, b] of pairs) s = s.split(a).join(b)
  await writeFile(file, s, 'utf8')
  console.log('edited', file)
}
// 全库把 113,138 统一为 113,048（历史基线若另有说明则不动）
const targets = ['docs/deliverables/运行说明.md','docs/deliverables/作品介绍.md','docs/deliverables/成果状态.md']
for (const f of targets) {
  let s = await readFile(f, 'utf8')
  if (s.includes('113,138')) { s = s.split('113,138').join('113,048'); await writeFile(f, s, 'utf8'); console.log('113138 fixed', f) }
}
