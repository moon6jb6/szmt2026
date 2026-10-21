#!/usr/bin/env node
/**
 * diff-dump.mjs — 比较两次 dump-text 快照，只输出「新增/修改的段落」。
 * 目的：r2 复审只读新增正文，节省审计成本。
 *
 * 用法:
 *   node diff-dump.mjs <old.txt> <new.txt>
 */

import fs from 'node:fs'

const [oldF, newF] = process.argv.slice(2)
if (!oldF || !newF) {
  console.error('usage: node diff-dump.mjs <old.txt> <new.txt>')
  process.exit(1)
}

function parseDump(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const units = [] // { id, title, parts: [{key, text}] }
  let cur = null
  for (const line of lines) {
    const m = /^## (\S+?)「(.*?)」/.exec(line)
    if (m) {
      cur = { id: m[1], title: m[2], parts: [] }
      units.push(cur)
      continue
    }
    if (!cur) continue
    const p = /^\[(\d+)\] (.*)$/.exec(line)
    if (p) { cur.parts.push({ key: 'B' + p[1], text: p[2] }); continue }
    const o = /^\s+\((\d+\.\d+)\) (.*)$/.exec(line)
    if (o) { cur.parts.push({ key: 'O' + o[1], text: o[2] }); continue }
    const h = /^\s+-- (选项.*)/.exec(line)
    if (h) { cur.parts.push({ key: 'H:' + h[1].slice(0, 12), text: h[1] }); continue }
  }
  return units
}

const oldU = parseDump(oldF)
const newU = parseDump(newF)
const oldMap = new Map(oldU.map((u) => [u.id, u]))
const newMap = new Map(newU.map((u) => [u.id, u]))

const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length
let added = 0
let chars = 0
const newUnits = []

for (const u of newU) {
  const old = oldMap.get(u.id)
  if (!old) {
    newUnits.push(u.id)
    added += u.parts.length
    chars += u.parts.reduce((a, p) => a + cjk(p.text), 0)
    continue
  }
  const oldKeys = new Set(old.parts.map((p) => p.key))
  const oldTexts = new Set(old.parts.map((p) => p.text))
  const fresh = u.parts.filter((p) => !oldTexts.has(p.text))
  if (fresh.length) {
    const freshCJK = fresh.reduce((a, p) => a + cjk(p.text), 0)
    if (freshCJK < 15) continue
    console.log(`\n## ${u.id}「${u.title}」 新增/改动 ${fresh.length} 段 / ${freshCJK} 字（原 ${old.parts.filter(p=>p.key.startsWith('B')).length} 段）`)
    for (const p of fresh) console.log(`  + [${p.key}] ${p.text}`)
    added += fresh.length
    chars += freshCJK
  }
}
for (const u of oldU) if (!newMap.has(u.id)) console.log(`\n## ${u.id} 已被删除`)

console.log(`\n===== 合计：新增/改动段落 ${added} 段 / ${chars} 字 =====`)
if (newUnits.length) console.log(`新增单元: ${newUnits.join(', ')}`)
