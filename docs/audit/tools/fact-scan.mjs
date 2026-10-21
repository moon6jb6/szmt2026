#!/usr/bin/env node
/**
 * fact-scan.mjs — auditor-fact 的卷宗快速筛查器（只读，不写 src/）
 *
 * 用法：node docs/audit/tools/fact-scan.mjs [--file volume0.ts ...] [--full]
 * 输出：每文件场景数 / CJK 字数 / 挂源问题 / 红线关键词命中 / 真实人物引语疑似 / 日期序列 / next 断链
 *
 * 设计原则：只做「筛」，不做「判」。命中项仍需 auditor 人工读上下文定性（P0/P1/P2）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONTENT = join(ROOT, 'src', 'game', 'content')

const REAL_PEOPLE = ['谢晋元', '杨瑞符', '杨惠敏', '陈树生', '周福其', '韩宪元', '雷雄', '上官志标', '樊城', '卢鸿信', '郭少银', '金汉朝', '傅冠喜', '傅冠来', '吴祖德', '万连卿', '凌维诚', '郝鼎诚']

const WHITELIST = [
  '晋元决心殉国', '余一枪一弹', '团长啊', '舍生取义', '剩一兵一卒', '忠勇将士八百余人',
  '铭记历史', '脱帽鞠躬', '我们先行军到蒲圻', '我当嘱咐出外就医', '朝曦初上',
  '民族革命典型', '爱国情怀', '视死如归', '不畏强暴', '百折不挠', '八百人',
  '天下兴亡', '珍爱和平', '开创未来', '缅怀先烈',
]

// 禁止进正文的 pending / needed 卡内容关键词
const PENDING_KEYS = ['泅渡', '泅水', '竹竿', '旗绳', '煤气柜', '煤气包', '郝鼎诚', '郝景成', '尤耀亮', '龙耀亮', '传了好几道', '宋子文', '张柏亭', '杨虎', '手令', '电话命令', '毙伤', '毙敌', '歼敌', '第五次庭审', '特别法庭', '457', '377人', '452', '423', '414', '397']

const KILL_KEYS = ['毙敌', '歼敌', '击毙', '杀敌', '敌兵', '敌人死', '敌尸', '战果', '缴获', '打死']
const ATROCITY_KEYS = ['强奸', '轮奸', '屠杀', '活埋', '刺刀', '开膛', '斩首', '血洗', '烧死', '奸淫', '虐杀', '万人坑', '人头']

const HIST_KEYS = ['1937', '一九三七', '1938', '1941', '1945', '1947', '保安五团', '保安第五团', '524团', '五二四', '88师', '八十八师', '四行仓库', '孤军营', '谢晋元', '通城', '八百壮士', '淞沪']

const CARD_ID_RE = /['"](auto-[a-z]-\d{2}|s-[a-z0-9-]+)['"]/g

function readSources() {
  const map = new Map()
  for (const f of ['sources.ts', 'sources.auto.ts']) {
    const text = readFileSync(join(CONTENT, f), 'utf8')
    // 按对象块粗切
    const blocks = text.split(/\n\s*\{/)
    for (const b of blocks) {
      const id = b.match(/id:\s*'([^']+)'/) || b.match(/"id":\s*"([^"]+)"/)
      const status = b.match(/status:\s*'([^']+)'/) || b.match(/"status":\s*"([^"]+)"/)
      const work = b.match(/work:\s*'([^']*)'/) || b.match(/"work":\s*"([^"]*)"/)
      if (id && status) map.set(id[1], { status: status[1], work: work ? work[1] : '' })
    }
  }
  return map
}

function cjkCount(s) {
  return (s.match(/[\u4e00-\u9fff]/g) || []).length
}

function sceneIdsOf(text) {
  const ids = []
  for (const m of text.matchAll(/(?:^|\n)\s*id:\s*'([^']+)',/g)) {
    if (/^(prologue|epilogue|night\d+b?|v[0-5]-\d+)$/.test(m[1])) ids.push({ id: m[1], index: m.index, line: text.slice(0, m.index).split('\n').length })
  }
  return ids
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length }

function scanFile(file, sourcesMap) {
  const text = readFileSync(join(CONTENT, file), 'utf8')
  const ids = sceneIdsOf(text)
  const scenes = []
  for (let i = 0; i < ids.length; i++) {
    const start = ids[i].index
    const end = i + 1 < ids.length ? ids[i + 1].index : text.length
    const block = text.slice(start, end)
    const date = (block.match(/date:\s*'([^']+)'/) || [])[1] || ''
    const location = (block.match(/location:\s*'([^']+)'/) || [])[1] || ''
    const srcMatch = block.match(/sources:\s*\[([^\]]*)\]/)
    const sources = srcMatch ? [...srcMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : []
    // 字符串内容（段落/结局文本）
    const strings = [...block.matchAll(/'([^'\n]{2,})'/g)].map((m) => m[1])
    const prose = strings.join('\n')
    // 引语
    const quotes = [...prose.matchAll(/「([^」]{1,240})」/g)].map((m) => ({ text: m[1], at: m.index }))
    // next
    const nexts = [...block.matchAll(/next:\s*'([^']+)'/g)].map((m) => m[1])
    scenes.push({ id: ids[i].id, line: ids[i].line, date, location, sources, nexts, quotes, prose, cjk: cjkCount(prose), block })
  }
  return { file, text, scenes }
}

function checkScene(scene, sourcesMap, allSceneIds) {
  const issues = []
  const seen = new Set()
  const add = (kind, level, detail) => issues.push({ kind, level, detail })

  // 1. sources 有效性
  for (const sid of scene.sources) {
    if (!sourcesMap.has(sid)) add('source-missing', 'P0', `挂源不存在：${sid}`)
    else if (sourcesMap.get(sid).status !== 'verified') add('source-unverified', 'P0', `挂源非已核（${sourcesMap.get(sid).status}）：${sid}`)
    if (seen.has(sid)) add('source-dup', 'P2', `重复挂源：${sid}`)
    seen.add(sid)
  }
  // 2. 有史实关键词但无挂源
  const histHits = HIST_KEYS.filter((k) => scene.prose.includes(k))
  if (scene.sources.length === 0 && histHits.length > 0) add('no-sources', 'P0', `场景含史实词但 sources 为空：${histHits.slice(0, 6).join('/')}`)

  // 3. 红线关键词
  for (const k of KILL_KEYS) if (scene.prose.includes(k)) add('kill-count?', 'P0?', `杀敌类关键词：${k}`)
  for (const k of ATROCITY_KEYS) if (scene.prose.includes(k)) add('atrocity?', 'P0?', `暴行类关键词：${k}`)
  for (const k of PENDING_KEYS) if (scene.prose.includes(k)) add('pending-content?', 'P0?', `pending/needed 卡内容关键词：${k}`)
  // 4. 真实人物引语疑似
  for (const q of scene.quotes) {
    if (WHITELIST.some((w) => q.text.includes(w))) continue
    const before = scene.prose.slice(Math.max(0, q.at - 60), q.at)
    const hit = REAL_PEOPLE.find((n) => before.includes(n))
    if (hit) add('real-person-quote?', 'P0?', `${hit} 附近引语：「${q.text.slice(0, 40)}」`)
  }
  // 5. 纪念馆/英名墙年代
  for (const line of scene.prose.split('\n')) {
    if (/(纪念馆|英名墙|纪念公园|纪念馆藏|展厅)/.test(line)) {
      const years = [...line.matchAll(/(18|19|20)\d{2}/g)].map((m) => Number(m[0]))
      if (years.length && years.some((y) => y < 2015)) add('anachronism?', 'P0', `早期年份与纪念馆同句：${line.slice(0, 80)}`)
      else if (!years.length && /(19\d\d|民国)/.test(scene.date)) add('anachronism?', 'P0', `场景日期在 2015 前却提纪念馆：${scene.date}`)
    }
  }
  // 6. 日期序列粗检
  const y = scene.date.match(/(19\d{2})/)
  if (y && Number(y[1]) < 2015 && /英名墙|纪念馆开馆/.test(scene.prose)) add('timeline?', 'P0', `scene date ${scene.date} 但正文含英名墙/开馆`)
  // 7. next 断链
  for (const n of scene.nexts) if (!allSceneIds.has(n) && !n.startsWith('ending_')) add('next-broken', 'P1', `next 指向不存在的场景：${n}`)
  return issues
}

const args = process.argv.slice(2)
let files = ['chapter1.ts', 'volume0.ts', 'volume1.ts', 'volume2.ts', 'volume3.ts', 'volume4.ts', 'volume5.ts']
for (let i = 0; i < args.length; i++) if (args[i] === '--file') files = args.slice(i + 1)
files = files.filter((f) => f.endsWith('.ts'))

const sourcesMap = readSources()
const scanned = files.filter((f) => existsSync(join(CONTENT, f))).map((f) => scanFile(f, sourcesMap))
const allSceneIds = new Set(scanned.flatMap((s) => s.scenes.map((x) => x.id)))

console.log('=== fact-scan ===')
console.log(`卡片：${sourcesMap.size} 张（verified ${[...sourcesMap.values()].filter((v) => v.status === 'verified').length} / pending ${[...sourcesMap.values()].filter((v) => v.status === 'pending').length} / needed ${[...sourcesMap.values()].filter((v) => v.status === 'needed').length}）`)
console.log(`场景总数：${allSceneIds.size}`)
console.log('')
let p0 = 0
for (const s of scanned) {
  const cjk = s.scenes.reduce((a, x) => a + x.cjk, 0)
  console.log(`## ${s.file} — ${s.scenes.length} 场景 / CJK ${cjk}`)
  for (const sc of s.scenes) {
    const issues = checkScene(sc, sourcesMap, allSceneIds)
    const usedSources = sc.sources.map((x) => `${x}${sourcesMap.get(x) ? '' : '?'}`)
    const srcShort = usedSources.length ? usedSources.join(',') : '（空）'
    const line = `  ${sc.id.padEnd(8)} L${String(sc.line).padStart(4)} CJK${String(sc.cjk).padStart(4)} date=${sc.date || '-'} | src=${srcShort}`
    console.log(line)
    for (const i of issues) {
      if (i.level === 'P0') p0++
      console.log(`      [${i.level}] ${i.kind}: ${i.detail}`)
    }
  }
  console.log('')
}
console.log(`=== 粗筛 P0 命中：${p0}（需人工定性；本工具不做最终判定） ===`)
