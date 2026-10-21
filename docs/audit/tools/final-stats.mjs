#!/usr/bin/env node
/**
 * final-stats.mjs — FINAL 报告用的逐文件/逐结局统计（只读）
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONTENT = join(ROOT, 'src', 'game', 'content')
const CJK = /[\u4e00-\u9fff]/g
const count = (s) => (s.match(CJK) || []).length

// 逐文件：场景数、场景正文 CJK、sources 条数
const files = ['chapter1.ts', 'volume0.ts', 'volume1.ts', 'volume2.ts', 'volume3.ts', 'volume4.ts', 'volume5.ts']
console.log('file | scenes | 场景正文CJK(近似) | sources引用数')
for (const f of files) {
  const p = join(CONTENT, f)
  if (!existsSync(p)) continue
  const t = readFileSync(p, 'utf8')
  const sceneIds = [...t.matchAll(/(?:^|\n)\s*id: '(?:prologue|epilogue|night\d+b?|v[0-5]-\d+)',/g)].length
  const srcCount = [...t.matchAll(/sources:\s*\[([^\]]*)\]/g)].reduce((a, m) => a + (m[1].match(/['"]/g) || []).length / 2, 0)
  console.log(`${f} | ${sceneIds} | ${count(t)} | ${srcCount}`)
}
// endings 逐篇
const e = readFileSync(join(CONTENT, 'endings.ts'), 'utf8')
const lines = e.split('\n')
const bounds = lines.map((l, i) => [l, i]).filter(([l]) => /^  (roster|letters|flag|photo|testimony|message): \{/.test(l)).map(([l, i]) => [l.trim().replace(': {', ''), i])
console.log('\nendings | CJK | paragraphs')
for (let j = 0; j < bounds.length; j++) {
  const [k, s] = bounds[j]
  const end = j + 1 < bounds.length ? bounds[j + 1][1] : lines.length
  const seg = lines.slice(s, end).join('\n')
  const paras = (seg.match(/^      '/gm) || []).length
  console.log(`${k} | ${count(seg)} | ${paras}`)
}
console.log(`endings 合计 | ${count(e)}`)
