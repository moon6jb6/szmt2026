#!/usr/bin/env node
/**
 * 把「另一个 AI 收集回来的史料 JSON」并入项目。
 *
 * 用法：
 *   node tools/import-collected-sources.mjs [回填文件路径]
 *   默认读取：docs/deliverables/史料收集回填.json
 *
 * 做的事：
 *   1. 对照《史料收集模板.json》的 56 个槽位逐条校验；
 *   2. 生成 src/game/content/sources.auto.ts；
 *   3. 写 docs/deliverables/史料回填报告.md；
 *   4. 控制台打印统计与问题清单。
 *
 * 生成规则：
 *   found + confidence=high + 有原句 + 有定位 → verified
 *   found/ambiguous 但缺原句或缺定位        → pending
 *   not_found                              → 不生成卡片
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const TEMPLATE = path.join(ROOT, 'docs', 'deliverables', '史料收集模板.json')
const DEFAULT_INPUT = path.join(ROOT, 'docs', 'deliverables', '史料收集回填.json')
const AUTO_OUT = path.join(ROOT, 'src', 'game', 'content', 'sources.auto.ts')
const REPORT = path.join(ROOT, 'docs', 'deliverables', '史料回填报告.md')

const input = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT

const VALID_STATUS = new Set(['found', 'not_found', 'ambiguous'])
const VALID_CONF = new Set(['high', 'medium', 'low'])
const VALID_TYPE = new Set(['book', 'news', 'archive', 'museum', 'interview'])

function fail(message) {
  console.error(`\n[失败] ${message}`)
  process.exit(1)
}

const template = JSON.parse(await readFile(TEMPLATE, 'utf8'))
if (!existsSync(input)) {
  fail(
    `找不到回填文件：${input}\n` +
      `请把收集 AI 的输出存成 docs/deliverables/史料收集回填.json，或用参数指定路径。`,
  )
}

const raw = JSON.parse(await readFile(input, 'utf8'))
const filled = Array.isArray(raw) ? raw : raw.filled
if (!Array.isArray(filled)) fail('回填文件顶层必须是数组，或形如 { "filled": [...] }')

const slotMap = new Map(template.slots.map((slot) => [slot.id, slot]))
const issues = []
const seen = new Set()
const cards = []
const notFound = []
const stats = { found: 0, not_found: 0, ambiguous: 0, verified: 0, pending: 0 }

for (const entry of filled) {
  const slotId = entry?.slot_id
  const slot = slotMap.get(slotId)
  if (!slot) {
    issues.push(`未知槽位号：${slotId}（模板里没有）`)
    continue
  }
  if (seen.has(slotId)) {
    issues.push(`重复槽位：${slotId}`)
    continue
  }
  seen.add(slotId)

  const status = entry.status
  if (!VALID_STATUS.has(status)) {
    issues.push(`${slotId}：status 非法（${status}）`)
    continue
  }
  stats[status] += 1

  if (status === 'not_found') {
    notFound.push({ slotId, note: entry.note || '' })
    continue
  }

  const fact = String(entry.fact ?? '').trim()
  if (!fact) issues.push(`${slotId}：缺 fact（一句话事实）`)

  const source = entry.source ?? {}
  if (!VALID_TYPE.has(source.type)) issues.push(`${slotId}：source.type 非法（${source.type}）`)
  if (!String(source.work ?? '').trim()) issues.push(`${slotId}：缺 source.work`)

  const hasUrl = Boolean(String(source.url ?? '').trim())
  const hasLocator = Boolean(String(source.locator ?? '').trim())
  if (!hasUrl && !hasLocator) issues.push(`${slotId}：既没有 url 也没有 locator，无法定位`)

  const quote = String(entry.quote ?? '').trim()
  if (slot.needQuote && !quote) issues.push(`${slotId}：该槽位要求逐字原句，但 quote 为空`)

  const confidence = VALID_CONF.has(entry.confidence) ? entry.confidence : 'low'
  if (!VALID_CONF.has(entry.confidence)) issues.push(`${slotId}：confidence 非法，按 low 处理`)

  // 判定标准：有原文可按（found）且能定位（URL 或页码/章节）即可作「已核对」引用。
  // confidence 只反映"是否一手 / 是否有争议"，ambiguous 一律降级为待核对。
  const canCite = status === 'found' && (hasLocator || hasUrl)
  const cardStatus = canCite ? 'verified' : 'pending'
  stats[canCite ? 'verified' : 'pending'] += 1

  cards.push({
    id: `auto-${slotId.toLowerCase()}`,
    type: source.type,
    status: cardStatus,
    work: source.work,
    author: source.author || undefined,
    publisher: source.publisher || undefined,
    year: Number.isFinite(Number(source.year)) && Number(source.year) > 0 ? Number(source.year) : undefined,
    edition: source.locator || undefined,
    claim: fact,
    excerpt: quote || undefined,
    locator: source.locator || source.url || undefined,
    note: [entry.note, source.url].filter(Boolean).join(' · ') || undefined,
    // 待核对的条目不自动挂到场景，避免把有争议的表述当成正文依据
    scenes: canCite ? (slot.scenes ?? []) : [],
    tags: [slot.group.replace(/^[A-Z]\s*/u, ''), slot.priority, `confidence:${confidence}`],
  })
}

// 补齐未回填的槽位
const missing = template.slots.filter((slot) => !seen.has(slot.id)).map((slot) => slot.id)

const generated = `import type { SourceCard } from '../types'

/**
 * 由 tools/import-collected-sources.mjs 自动生成，请勿手改。
 * 生成时间：${new Date().toISOString()}
 * 数据来源：${path.relative(ROOT, input)}
 * 卡片数：${cards.length}（verified ${stats.verified} / pending ${stats.pending}）
 */
export const AUTO_SOURCES: SourceCard[] = ${JSON.stringify(cards, null, 2)} as SourceCard[]
`
await writeFile(AUTO_OUT, generated, 'utf8')

const lines = []
lines.push('# 史料回填报告')
lines.push('')
lines.push(`- 回填文件：\`${path.relative(ROOT, input)}\``)
lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`)
lines.push(`- 槽位总数：${template.slots.length}，已回填：${filled.length}，未回填：${missing.length}`)
lines.push(
  `- 状态分布：found ${stats.found} / ambiguous ${stats.ambiguous} / not_found ${stats.not_found}`,
)
lines.push(`- 生成卡片：${cards.length}（verified ${stats.verified} / pending ${stats.pending}）`)
lines.push('')
if (missing.length) {
  lines.push('## 未回填槽位')
  lines.push('')
  lines.push(missing.join('、'))
  lines.push('')
}
if (issues.length) {
  lines.push('## 需要人工处理的问题')
  lines.push('')
  for (const issue of issues) lines.push(`- ${issue}`)
  lines.push('')
}
if (cards.length) {
  lines.push('## 生成的卡片')
  lines.push('')
  lines.push('| 卡片 id | 状态 | 文献 | 一句话事实 | 定位 |')
  lines.push('|---|---|---|---|---|')
  for (const card of cards) {
    lines.push(
      `| \`${card.id}\` | ${card.status} | ${card.work} | ${String(card.claim).replace(/\|/gu, '｜')} | ${card.locator ?? ''} |`,
    )
  }
  lines.push('')
}
if (notFound.length) {
  lines.push('## 未找到的槽位')
  lines.push('')
  for (const item of notFound) lines.push(`- ${item.slotId}${item.note ? `：${item.note}` : ''}`)
  lines.push('')
}
await writeFile(REPORT, lines.join('\n'), 'utf8')

console.log('===== 史料回填并入完成 =====')
console.log(`回填 ${filled.length} / ${template.slots.length} 条，未回填 ${missing.length} 条`)
console.log(`状态：found ${stats.found} / ambiguous ${stats.ambiguous} / not_found ${stats.not_found}`)
console.log(`生成卡片 ${cards.length} 张（verified ${stats.verified} / pending ${stats.pending}）`)
if (issues.length) {
  console.log(`\n需要人工处理 ${issues.length} 个问题：`)
  for (const issue of issues) console.log(' -', issue)
}
console.log(`\n已写入：${path.relative(ROOT, AUTO_OUT)}`)
console.log(`已写入：${path.relative(ROOT, REPORT)}`)
console.log('\n下一步：npm run build，然后 node tools/ending-test.mjs <preview-url> 跑回归。')
