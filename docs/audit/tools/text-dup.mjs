#!/usr/bin/env node
/**
 * text-dup.mjs — 纯文本重复检测（面向 endings.ts 这类非场景数组文件），只读。
 * 用法：node docs/audit/tools/text-dup.mjs src/game/content/endings.ts
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const src = readFileSync(file, 'utf8')
const strings = [...src.matchAll(/'((?:[^'\\]|\\.){6,})'/g)].map((m) => m[1].replace(/\\'/g, "'"))
const norm = (s) => s.replace(/[，。！？、…—；：「」『』（）\s]/g, '')
const seen = new Map()
for (const s of strings) {
  const k = norm(s)
  if (k.length < 8) continue
  if (!seen.has(k)) seen.set(k, { n: 0, raw: s })
  seen.get(k).n++
}
const dups = [...seen.values()].filter((v) => v.n >= 2).sort((a, b) => b.n - a.n)
console.log(`## ${file}: CJK字串 ${strings.length}，重复长句 ${dups.length}`)
for (const d of dups) console.log(`  x${d.n}  ${d.raw.slice(0, 80)}`)
