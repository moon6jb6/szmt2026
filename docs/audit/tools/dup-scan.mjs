#!/usr/bin/env node
/**
 * dup-scan.mjs — 扩写残留检测器
 *
 * 扩写最常见的两种事故：
 *   1. 同一场景里两段话说了同一个意思（插入新段落时没删旧段）；
 *   2. 同一句/同一个句式在整卷里反复出现（模板化）。
 *
 * 用法: node docs/audit/tools/dup-scan.mjs <file.ts> [...]
 */

import fs from 'node:fs'
import path from 'node:path'

const CJK = /[\u4e00-\u9fff]/g
const cjkLen = (s) => (s.match(CJK) || []).length

function stringsIn(s) {
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(s))) out.push(m[1].replace(/\\'/g, "'"))
  return out
}

function extractUnits(file) {
  const src = fs.readFileSync(file, 'utf8')
  const units = []
  // 数组式
  const arrStart = src.search(/(?:Scene\[\])\s*=\s*\[/)
  if (arrStart >= 0) {
    const open = src.indexOf('[', src.indexOf('=', arrStart))
    let depth = 0
    let inStr = false
    let quote = ''
    let objStart = -1
    for (let j = open; j < src.length; j++) {
      const c = src[j]
      if (inStr) {
        if (c === '\\') { j++; continue }
        if (c === quote) inStr = false
        continue
      }
      if (c === "'" || c === '"' || c === '`') { inStr = true; quote = c; continue }
      if (c === '[') depth++
      else if (c === ']') { if (depth === 1) break; depth-- }
      else if (c === '{') { if (depth === 1 && objStart < 0) objStart = j; depth++ }
      else if (c === '}') {
        depth--
        if (depth === 1 && objStart >= 0) {
          units.push(buildUnit(src.slice(objStart, j + 1)))
          objStart = -1
        }
      }
    }
  }
  // 回退：常量式（const V5_01: Scene = {...} / chapter1 风格）
  if (!units.length) {
    const re = /const\s+[A-Za-z0-9_]+\s*:\s*(?:Scene|Omit<Scene[^>]*>)\s*=\s*\{/g
    const marks = []
    let m
    while ((m = re.exec(src))) marks.push({ idx: m.index })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx
      const end = i + 1 < marks.length ? marks[i + 1].idx : src.length
      units.push(buildUnit(src.slice(start, end)))
    }
  }
  return units
}

function buildUnit(body) {
  const idm = /id:\s*'([^']+)'/.exec(body)
  const title = /title:\s*'([^']*)'/.exec(body)
  const paras = stringsIn(body)
    .filter((s) => cjkLen(s) >= 6)
  // 只保留 paragraphs 内的（粗筛：非 label/hint 行）
  const labelTexts = new Set()
  const lre = /(label|hint):\s*'([^']*)'/g
  let lm
  while ((lm = lre.exec(body))) labelTexts.add(lm[2])
  const cleanParas = paras.filter((s) => !labelTexts.has(s))
  return { id: idm ? idm[1] : '?', title: title ? title[1] : '', paras: cleanParas }
}

const ngram = (s, n = 4) => {
  const set = new Set()
  const chars = s.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i + n <= chars.length; i++) set.add(chars.slice(i, i + n))
  return set
}

function jaccard(a, b) {
  const A = ngram(a)
  const B = ngram(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node dup-scan.mjs <file.ts> [...]')
  process.exit(1)
}

let totalDup = 0
const globalSentences = new Map() // file -> Map

for (const f of files) {
  const units = extractUnits(f)
  const used = new Set()
  console.log(`\n### ${path.basename(f)}  ${units.length} 单元`)
  for (const u of units) {
    const paras = u.paras.filter((p) => !used.has(p))
    const suspects = []
    for (let i = 0; i < paras.length; i++) {
      if (cjkLen(paras[i]) < 12) continue
      for (let j = i + 1; j < paras.length; j++) {
        if (cjkLen(paras[j]) < 12) continue
        const sim = jaccard(paras[i], paras[j])
        if (sim >= 0.45) suspects.push({ i, j, sim: +sim.toFixed(2), a: paras[i], b: paras[j] })
        if (suspects.length > 6) break
      }
      if (suspects.length > 6) break
    }
    // 完全相同的句子在单元内重复
    const seen = new Map()
    for (const p of paras) {
      for (const s of p.split(/[。！？\n]+/).map((x) => x.trim()).filter((x) => cjkLen(x) >= 8)) {
        seen.set(s, (seen.get(s) || 0) + 1)
      }
    }
    const repeated = [...seen.entries()].filter(([, n]) => n > 1)
    if (suspects.length || repeated.length) {
      totalDup += suspects.length + repeated.length
      console.log(`  ${u.id}「${u.title}」`)
      for (const s of suspects) {
        console.log(`    ⚠ 段落相似 ${s.sim}:`)
        console.log(`      A: ${s.a.slice(0, 60)}`)
        console.log(`      B: ${s.b.slice(0, 60)}`)
      }
      for (const [s, n] of repeated) console.log(`    ⚠ 同句在单元内出现 ${n} 次：「${s.slice(0, 40)}」`)
    }
    u.paras.forEach((p) => used.add(p))
  }

  // 跨单元重复句（模板化）
  const counts = new Map()
  for (const u of units) {
    for (const p of u.paras) {
      for (const s of p.split(/[。！？\n]+/).map((x) => x.trim()).filter((x) => cjkLen(x) >= 12)) {
        if (!counts.has(s)) counts.set(s, [])
        counts.get(s).push(u.id)
      }
    }
  }
  const cross = [...counts.entries()].filter(([, ids]) => ids.length > 1)
  if (cross.length) {
    console.log(`  —— 跨单元重复句 ${cross.length} 条（模板化风险）:`)
    for (const [s, ids] of cross.slice(0, 12)) console.log(`    ${ids.join(',')}  「${s.slice(0, 44)}」`)
  }
}
console.log(`\n【文件内重复/相似合计】${totalDup}`)
