import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 严格正文字数统计（auditor 口径）：
 * - 只统计 `paragraphs: [...]` 里的字符串（场景正文 + 抉择结果）
 * - 只数 CJK：\u4e00-\u9fa5
 * - 不统计注释、字段名、标题、选项 label
 * - endings.ts 的 paragraphs 同样计入
 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const CONTENT = path.join(ROOT, 'src', 'game', 'content')

const FILES = [
  ['序卷 volume0', 'volume0.ts'],
  ['卷一 volume1', 'volume1.ts'],
  ['卷二 volume2', 'volume2.ts'],
  ['卷三 volume3', 'volume3.ts'],
  ['卷四 volume4', 'volume4.ts'],
  ['支线 volume5', 'volume5.ts'],
  ['基础五夜 chapter1', 'chapter1.ts'],
  ['六结局 endings', 'endings.ts'],
]

function cjk(text) {
  return (text.match(/[\u4e00-\u9fa5]/gu) ?? []).length
}

/** 找出所有 `paragraphs: [ ... ]` 块，取出其中引号字符串 */
function extractParagraphs(source) {
  const chunks = []
  const key = /paragraphs\s*:\s*\[/gu
  let match
  while ((match = key.exec(source)) !== null) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '[') depth += 1
      else if (ch === ']') depth -= 1
      i += 1
    }
    chunks.push(source.slice(start, i - 1))
  }
  return chunks
}

function extractStrings(chunk) {
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/gu
  let m
  while ((m = re.exec(chunk)) !== null) out.push(m[1] ?? m[2] ?? '')
  return out
}

console.log('===== 严格字正文字数（只算 paragraphs 里的汉字）=====')
let total = 0
for (const [label, file] of FILES) {
  let source = ''
  try {
    source = await readFile(path.join(CONTENT, file), 'utf8')
  } catch {
    console.log(`${label.padEnd(20)}  缺失`)
    continue
  }
  // 去掉行注释，避免注释里的中文被算进去
  source = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1')
  const strings = extractParagraphs(source).flatMap(extractStrings)
  const count = strings.reduce((sum, text) => sum + cjk(text), 0)
  total += count
  console.log(`${label.padEnd(20)} ${String(count).padStart(7)} 字（${strings.length} 段）`)
}
console.log('----------------------------------------------')
console.log(`严格正文合计：${total} 字`)
const TARGET = 100000
console.log(total >= TARGET ? `已达标（超 ${total - TARGET}）` : `距离 100,000 还差 ${TARGET - total} 字`)
