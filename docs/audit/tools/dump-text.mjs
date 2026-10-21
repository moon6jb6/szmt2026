#!/usr/bin/env node
/**
 * dump-text.mjs — 把卷文件的叙事文本抽成纯文本（去掉 TS 脚手架），供审计逐句通读。
 * 用法: node dump-text.mjs <file.ts> [out.txt]
 */
import fs from 'node:fs'
import path from 'node:path'

const CJKre = /[\u4e00-\u9fff]/
function stringsIn(s) {
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(s))) out.push(m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n'))
  return out
}

function extractUnits(file) {
  const src = fs.readFileSync(file, 'utf8')
  const units = []
  // 结局文件（ENDINGS record）
  if (/ENDINGS/.test(src) && /kind:\s*'/.test(src)) {
    const re = /kind:\s*'([a-z]+)',\s*\n\s*title:\s*'([^']*)'/g
    const marks = []
    let mm
    while ((mm = re.exec(src))) marks.push({ kind: mm[1], title: mm[2], idx: mm.index })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx
      const end = i + 1 < marks.length ? marks[i + 1].idx : src.length
      const body = src.slice(start, end)
      const arrays = []
      const pre = /paragraphs:\s*\[/g
      let pm
      while ((pm = pre.exec(body))) {
        const open = body.indexOf('[', pm.index)
        let depth = 0, inStr = false, quote = ''
        let j = open
        for (; j < body.length; j++) {
          const c = body[j]
          if (inStr) { if (c === '\\') { j++; continue } if (c === quote) inStr = false; continue }
          if (c === "'" || c === '"' || c === '`') { inStr = true; quote = c; continue }
          if (c === '[') depth++
          else if (c === ']') { depth--; if (depth === 0) break }
        }
        arrays.push(stringsIn(body.slice(open, j + 1)))
      }
      units.push({ id: 'ending_' + marks[i].kind, title: marks[i].title, date: '', loc: '', startLine: 0, body: arrays[0] || [], outcomes: [], labels: [] })
    }
    return units
  }
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
          units.push(buildUnit(src.slice(objStart, j + 1), src.slice(0, objStart).split('\n').length))
          objStart = -1
        }
      }
    }
  }
  if (!units.length) {
    const re = /const\s+[A-Za-z0-9_]+\s*:\s*(?:Scene|Omit<Scene[^>]*>)\s*=\s*\{/g
    const marks = []
    let m
    while ((m = re.exec(src))) marks.push({ idx: m.index })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx
      const end = i + 1 < marks.length ? marks[i + 1].idx : src.length
      const line = src.slice(0, start).split('\n').length
      units.push(buildUnit(src.slice(start, end), line))
    }
  }
  return units
}

function buildUnit(body, startLine) {
  const idm = /id:\s*'([^']+)'/.exec(body)
  const title = /title:\s*'([^']*)'/.exec(body)
  const date = /date:\s*'([^']*)'/.exec(body)
  const loc = /location:\s*'([^']*)'/.exec(body)
  const labelSet = new Set()
  const lre = /(label):\s*'([^']*)'/g
  let lm
  while ((lm = lre.exec(body))) labelSet.add(lm[2])

  // 顺序抽取所有 paragraphs 数组
  const arrays = []
  const pre = /paragraphs:\s*\[/g
  let pm
  while ((pm = pre.exec(body))) {
    const open = body.indexOf('[', pm.index)
    let depth = 0, inStr = false, quote = ''
    let j = open
    for (; j < body.length; j++) {
      const c = body[j]
      if (inStr) { if (c === '\\') { j++; continue } if (c === quote) inStr = false; continue }
      if (c === "'" || c === '"' || c === '`') { inStr = true; quote = c; continue }
      if (c === '[') depth++
      else if (c === ']') { depth--; if (depth === 0) break }
    }
    arrays.push(stringsIn(body.slice(open, j + 1)))
  }
  const labels = []
  const lre2 = /label:\s*'([^']*)'[\s\S]{0,80}?hint:\s*'([^']*)'/g
  let l2
  while ((l2 = lre2.exec(body))) labels.push({ label: l2[1], hint: l2[2] })

  return {
    id: idm ? idm[1] : '?',
    title: title ? title[1] : '',
    date: date ? date[1] : '',
    loc: loc ? loc[1] : '',
    startLine,
    body: arrays[0] || [],
    outcomes: arrays.slice(1),
    labels,
  }
}

const file = process.argv[2]
const outFile = process.argv[3]
const units = extractUnits(file)
const lines = []
lines.push(`# ${path.basename(file)}  单元 ${units.length}`)
for (const u of units) {
  lines.push('')
  lines.push(`## ${u.id}「${u.title}」 ${u.date} ${u.loc}`)
  u.body.forEach((p, i) => lines.push(`[${i + 1}] ${p}`))
  u.outcomes.forEach((arr, ci) => {
    lines.push(`  -- 选项${ci + 1} ${u.labels[ci] ? `【${u.labels[ci].label}】` : ''} 结果 --`)
    arr.forEach((p, i) => lines.push(`  (${ci + 1}.${i + 1}) ${p}`))
  })
}
const text = lines.join('\n')
if (outFile) {
  fs.writeFileSync(outFile, text, 'utf8')
  console.log(`written ${outFile}  ${text.length} chars`)
} else {
  console.log(text)
}
