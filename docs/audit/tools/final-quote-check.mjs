#!/usr/bin/env node
/**
 * final-quote-check.mjs — 最终版真实人物引语/红线候选清单（只读，人工判定）
 * 用法：node docs/audit/tools/final-quote-check.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONTENT = join(ROOT, 'src', 'game', 'content')
const FILES = ['chapter1.ts', 'volume0.ts', 'volume1.ts', 'volume2.ts', 'volume3.ts', 'volume4.ts', 'volume5.ts', 'endings.ts']
const PEOPLE = ['谢晋元', '杨瑞符', '杨惠敏', '陈树生', '周福其', '韩宪元', '雷雄', '上官志标', '樊城', '卢鸿信', '郭少银', '李书裕', '张柏亭', '丁一', '定光平', '沈虹光', '曾步贤', '马幼炯', '方毓强']
const WHITELIST = [
  '晋元决心殉国', '余一枪一弹', '团长啊', '舍生取义', '剩一兵一卒', '忠勇将士八百余人',
  '铭记历史', '脱帽鞠躬', '我们先行军到蒲圻', '我当嘱咐出外就医', '朝曦初上',
  '民族革命典型', '爱国情怀', '视死如归', '不畏强暴', '百折不挠', '八百人',
  '天下兴亡', '珍爱和平', '开创未来', '缅怀先烈', '含辛茹苦', '后来轰传世界的八百孤军',
]
const RED = [
  ['暴行', /(强奸|轮奸|屠杀|活埋|开膛|斩首|血洗|奸淫|虐杀|万人坑|尸体|人头落地)/g],
  ['杀敌计数', /(毙敌|歼敌|击毙|杀敌|敌尸|战果|缴获)/g],
  ['待核内容', /(泅水|泅渡|七十五厘米|煤气柜|煤气包|郝鼎诚|郝景成|尤耀亮|龙耀亮|宋子文|手令|电话命令)/g],
  ['伤亡数字', /(阵亡|伤亡|牺牲)\s*[0-9一二三四五六七八九十百]+|毙伤|死伤/g],
]

const names = (s) => PEOPLE.filter((p) => s.includes(p))
const out = []
for (const f of FILES) {
  const p = join(CONTENT, f)
  if (!existsSync(p)) continue
  const text = readFileSync(p, 'utf8')
  const lines = text.split('\n')
  // 逐个字符串字面量（内容行）
  lines.forEach((line, i) => {
    const m = line.match(/'((?:[^'\\]|\\.){2,})'/g)
    if (!m) return
    for (const lit of m) {
      const s = lit.slice(1, -1)
      const ps = names(s)
      for (const q of s.matchAll(/「([^」]{1,160})」/g)) {
        if (WHITELIST.some((w) => q[1].includes(w) || s.includes(w))) continue
        if (ps.length) out.push([f, i + 1, ps.join('/'), q[1].slice(0, 70), 'REAL-QUOTE'])
      }
      // 引语前文出现真人名（同一句）
      for (const q of s.matchAll(/「([^」]{1,160})」/g)) {
        if (WHITELIST.some((w) => s.includes(w))) continue
        const before = s.slice(Math.max(0, q.index - 40), q.index)
        const bps = names(before)
        if (bps.length) out.push([f, i + 1, bps.join('/'), q[1].slice(0, 70), 'NEAR-QUOTE'])
      }
      for (const [label, re] of RED) {
        const hit = s.match(re)
        if (hit) out.push([f, i + 1, '-', hit.join(','), label])
      }
    }
  })
}
console.log(`候选 ${out.length} 条（需人工判定；白名单已排除）`)
for (const r of out) console.log(r.join(' | '))
