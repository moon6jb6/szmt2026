import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const CONTENT = path.join(ROOT, 'src', 'game', 'content')

const FILES = [
  { key: 'chapter1', label: '基础五夜（chapter1）', file: 'chapter1.ts' },
  { key: 'volume0', label: '序卷（volume0）', file: 'volume0.ts' },
  { key: 'volume1', label: '卷一（volume1）', file: 'volume1.ts' },
  { key: 'volume2', label: '卷二（volume2）', file: 'volume2.ts' },
  { key: 'volume3', label: '卷三（volume3）', file: 'volume3.ts' },
  { key: 'volume4', label: '卷四（volume4）', file: 'volume4.ts' },
  { key: 'volume5', label: '支线（volume5）', file: 'volume5.ts' },
  { key: 'endings', label: '六结局（endings）', file: 'endings.ts' },
]

/** 只统计汉字，排除代码与标点 */
export function countCJK(text) {
  return (text.match(/[\u4e00-\u9fa5]/gu) ?? []).length
}

/** 粗略提取 scenes 数组里的字符串字数（不执行 TS，只做文本统计） */
function countFile(text) {
  return countCJK(text)
}

const rows = []
let total = 0
for (const item of FILES) {
  let raw = ''
  try {
    raw = await readFile(path.join(CONTENT, item.file), 'utf8')
  } catch {
    rows.push({ ...item, cjk: 0, missing: true })
    continue
  }
  const cjk = countFile(raw)
  total += cjk
  rows.push({ ...item, cjk, missing: false })
}

const TARGET = 100000
console.log('===== 正文汉字统计 =====')
for (const row of rows) {
  const flag = row.missing ? '（缺文件）' : ''
  console.log(`${row.label.padEnd(22)} ${String(row.cjk).padStart(7)} 字 ${flag}`)
}
console.log('------------------------------')
console.log(`合计（含代码内中文与注释，偏上限） ${total} 字`)
console.log(`距离目标 ${TARGET} 字：${total >= TARGET ? '已达标' : `差 ${TARGET - total} 字`}`)

if (total < TARGET) process.exitCode = 2
