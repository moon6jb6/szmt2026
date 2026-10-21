#!/usr/bin/env node
/**
 * lit-scan.mjs — 《把名字留下来》文学审计量化扫描器
 *
 * 只读 src/game/content/*.ts，输出逐场景指标。人工评分时作为证据底座，
 * 不替代判读：能数出来的只是"有没有"，"好不好"必须人读。
 *
 * 用法:
 *   node docs/audit/tools/lit-scan.mjs ../../src/game/content/chapter1.ts [...]
 *   node docs/audit/tools/lit-scan.mjs --json file.ts > scan.json
 */

import fs from 'node:fs'
import path from 'node:path'

/* ---------------- 词典 ---------------- */

// 规划 §2.5 禁用清单（直接扣分）—— 纯词命中
const BANNED = [
  '仿佛', '似乎', '不禁', '渐渐地', '在这个', '让我们', '值得注意的是',
  '总而言之', '综上所述', '与此同时', '由此可见', '换句话说', '不言而喻', '归根结底',
  '众所周知', '毫无疑问', '不难发现', '更重要的是', '一方面', '另一方面',
]
// 语篇连接词只按"标点后接"判，避免「最后一横/最后一次」误伤
const BANNED_DISCOURSE = [/(?:^|[。！？；\n])(?:首先|其次|最后|第一|第二|第三|总之)[，、：]/g]

// 情绪直呼（§2.5）
const EMOTION_NAMED = [
  '悲痛欲绝', '无比震撼', '十分悲伤', '悲恸', '悲痛', '悲伤', '难过', '痛苦',
  '恐惧', '害怕', '愤怒', '激动', '感动', '震撼', '绝望', '欣慰', '心酸', '难受',
  '肃然起敬', '热血沸腾', '泪流满面', '热泪盈眶',
]

// 大词（§2.5：除引文外不得直接形容我方）
const BIG_WORDS = [
  '伟大', '壮烈', '可歌可泣', '英勇', '崇高', '不朽', '神圣', '伟岸',
  '惊天地泣鬼神', '气壮山河', '永垂不朽',
]

// 解释性旁白 / 预叙 / 全知评论（§2.5 重灾区）
const NARRATION_TELLS = [
  /后来[你他她](才|就|也)?(知道|明白|懂得)/g,
  /后来[^。！？\n]{0,10}(才知道|才明白|才懂得|才听说|后来才知道)/g,
  /很多年后/g,
  /多年[之以]后/g,
  /这一幕/g,
  /[他你]终于明白/g,
  /[他你]不知道，这/g,
  /后来这[些个]/g,
  /很多年[里后]/g,
  /在这个世界上/g,
  /历史告诉/g,
  /[这那]就是.{0,6}的力量/g,
  /成了[他你]一辈子的/g,
  /[他你]想，要是/g,
  /[他你]也不知道为什么/g,
]

// 抽象概念词（不是不能用，密度过高=空）
const ABSTRACT = [
  '历史', '时代', '命运', '记忆', '灵魂', '永恒', '生命', '岁月', '沧桑',
  '精神', '意义', '价值', '信念', '意志', '气节', '信仰', '传承', '血脉',
]

// 具体物（可触）——按本作物质世界手工编定
const CONCRETE = [
  // 纸墨册
  '册子', '册页', '纸', '纸页', '毛边纸', '笔', '毛笔', '铅笔', '笔尖', '笔杆',
  '墨', '砚', '墨水', '字', '格子', '名册', '名单', '表', '圈', '名字',
  // 缝纫
  '针', '线', '针脚', '布', '蓝布', '夹层', '衣襟', '袖', '袖口', '棉袄', '被面',
  '褂子', '手帕', '裤腿', '绷带', '绑腿', '鞋', '鞋垫', '鞋底', '帽子', '钢盔',
  // 仓库与战
  '沙袋', '铁门', '铁柜', '钥匙', '锁', '电线', '机枪', '枪', '枪栓', '子弹', '弹片',
  '炮弹', '手榴弹', '导火索', '门板', '棉被', '砖', '水泥', '石灰', '墙', '墙根',
  '窗口', '楼顶', '楼梯', '柱子', '灯', '煤油灯', '灯泡', '灯影',
  // 河桥
  '苏州河', '河', '桥', '竹竿', '竹篙', '旗绳', '绳子', '雾', '雪', '雨', '冰',
  // 食物杂物
  '干粮', '米', '麻袋', '米袋', '炭盆', '火', '烟', '焦味', '霉味', '铁锈',
  '枣树', '树', '水', '石板', '扫帚',
  // 照片报纸档案
  '照片', '合影', '报纸', '标题', '铅字', '回信', '信', '家书', '信封', '信纸',
  '录音机', '录音带', '磁带', '档案馆', '县志', '盒子', '箱子', '铜像', '石头',
  '英名墙', '墙', '解说牌', '编号',
  // —— 序卷/通城（1947 冬）——
  '灶', '灶膛', '灶灰', '灶台', '灶沿', '灶口', '锅', '锅盖', '锅底', '锅巴',
  '瓢', '葫芦瓢', '木勺', '勺', '勺底', '碗', '碗柜', '瓦盆', '筷子', '火钳',
  '柴', '柴垛', '柴火', '米汤', '粥', '稀粥', '红薯', '萝卜', '腌萝卜', '豆豉',
  '盐', '盐角', '鸡蛋', '水缸', '冰碴', '石磨', '门槛', '院门', '瓦', '屋檐',
  '银元', '铜板', '纸包', '红纸', '油灯', '灯芯', '纸捻', '毛笔字', '便条',
  '公文', '红印', '印泥', '参议会', '县志稿', '蓝布包',
  // —— 孤军营（1937.11—1941.4）——
  '工场', '织机', '织袜', '木工', '刨子', '锯', '锉', '钉子', '锤', '木料',
  '铁丝网', '营门', '哨兵', '门岗', '操场', '草荐', '铺板', '床板', '被褥',
  '棉絮', '蚊帐', '黑板', '粉笔', '课本', '黑板擦', '歌本', '口琴', '篮球',
  '罐头', '铁皮', '煤球', '炉子', '水桶', '扁担', '箩筐', '扫帚', '铁锹',
  '军装', '皮带', '铜扣', '帽徽', '肩章', '绑腿布', '布鞋', '草鞋', '袜子',
  '电线杆', '路灯', '马路', '弄堂', '石库门', '租界', '巡捕', '码头', '轮船',
  '火车', '站台', '车票', '电车', '黄包车', '报童', '号外', '招牌',
  // —— 寻访/记忆线（1945—2025）——
  '邮戳', '邮票', '信封口', '稿纸', '钢笔', '墨水瓶', '剪报', '相纸', '底片',
  '相机', '采访本', '笔记本', '录音笔', '话筒', '展柜', '玻璃柜', '展板',
  '英名墙', '纪念章', '花圈', '石阶', '墓碑',
]

// 动作（不是心理概述）
const ACTIONS = [
  '缝', '撑', '拉', '放', '扛', '背', '抱', '塞', '抄', '划', '改', '抿', '蹲',
  '爬', '跑', '走', '停', '摇', '点头', '摆手', '敲', '扫', '抹', '翻', '合',
  '摊', '递', '推', '接', '按', '攥', '抓', '咬', '吐', '数', '画', '写', '读',
  '念', '喊', '听', '看', '摸', '捏', '踩', '系', '解', '掀', '扯', '提', '举',
  '抬', '蹲下', '跪下', '站', '坐', '躺', '靠着', '抵', '蹭', '蘸', '吹', '熄',
  '焊', '剪', '架', '堵', '钻', '跃', '拽', '拍', '掷', '包', '折', '撕', '卷',
  '舀', '刮', '剥', '啃', '戳', '烫', '熏', '挑', '埋', '夹', '磕', '掖',
  '搓', '擦', '挪', '摁', '拔', '拧', '倒', '斟', '搅', '熬', '煮', '烧', '添',
  '让', '分', '端', '捧', '拖', '追', '拦', '挡', '卡', '掏', '描', '誊', '唱',
  '骂', '笑', '摇头', '鞠躬', '敬礼', '立正', '躲', '藏', '找', '搜', '刨', '挖',
  '数数', '点名', '签字', '盖章', '抄写', '点灯', '吹熄', '缝上', '解开',
]

// 意象系统（规划 §2.3 八组 + 记忆载体扩展）
const IMAGERY = {
  名册墨: ['册子', '册页', '名册', '名单', '墨', '砚', '笔', '字', '圈', '格子'],
  河雾: ['苏州河', '河', '桥', '雾'],
  雪: ['雪', '冰', '扫雪'],
  灯: ['灯', '煤油灯', '灯泡', '灯影', '灯芯'],
  旗竹竿: ['旗', '旗绳', '竹竿', '旗杆', '绑腿'],
  鞋底纸: ['鞋底', '鞋垫', '纸页', '夹层'],
  报纸铅字: ['报纸', '标题', '铅字', '记者', '新闻', '号外'],
  空椅子: ['椅子', '空椅', '座位', '空铺', '铺位'],
  家书信: ['家书', '信纸', '信封', '回信', '代笔', '邮戳', '邮票'],
  照片: ['照片', '合影', '相纸', '底片'],
  证物: ['录音带', '录音机', '编号', '县志', '档案', '史料', '展柜', '采访本'],
  灶与粥: ['灶', '锅', '粥', '米汤', '勺', '瓢', '锅巴', '碗', '灶灰', '红薯'],
}

// 三连排比（§2.5）
const TRICOLON = [
  /是[^，。；！？\n]{1,14}，是[^，。；！？\n]{1,14}，是[^，。；！？\n]{1,14}/g,
  /[他你][^，。；！？\n]{0,8}，[^，。；！？\n]{0,8}，[^，。；！？\n]{0,8}。/g, // 弱信号，仅提示
]

// 明喻
const SIMILE = /像[^，。；！？\n]{1,16}|如同[^，。；！？\n]{1,16}|似的|一般[，。]/g

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/

/* ---------------- 解析 ---------------- */

function extractUnits(file) {
  const src = fs.readFileSync(file, 'utf8')
  const base = path.basename(file)
  const units = []

  const isEndings = /ENDINGS/.test(src) && /kind:\s*'/.test(src)

  if (isEndings) {
    // 结局：按 kind 定位
    const re = /kind:\s*'([a-z]+)',\s*\n\s*title:\s*'([^']*)'/g
    const marks = []
    let m
    while ((m = re.exec(src))) marks.push({ kind: m[1], title: m[2], idx: m.index })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx
      const end = i + 1 < marks.length ? marks[i + 1].idx : src.length
      const body = src.slice(start, end)
      units.push({
        key: `ending_${marks[i].kind}`,
        kind: 'ending',
        title: marks[i].title,
        chapter: '结局',
        bodyTexts: extractParagraphArrays(body).flat(),
        labels: [],
        hasChoices: false,
      })
    }
    // coda
  } else {
    // 形式 A：数组式  export const VOLUME_X: Scene[] = [ { id: 'v0-01', ... }, ... ]
    // 形式 B：常量式  const NIGHT1: Scene = { ... }（chapter1.ts）
    const arrayUnits = extractArrayScenes(src)
    if (arrayUnits.length) {
      units.push(...arrayUnits)
    } else {
      units.push(...extractConstScenes(src))
    }
  }
  return units
}

/** 数组式卷文件解析：按顶层对象切分 */
function extractArrayScenes(src) {
  const out = []
  const arrStart = src.search(/(?:Scene\[\]|Scene\s*\[\s*\])\s*=\s*\[/)
  if (arrStart < 0) return out
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
    else if (c === ']') {
      if (depth === 1) break
      depth--
    } else if (c === '{') {
      if (depth === 1 && objStart < 0) objStart = j
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 1 && objStart >= 0) {
        out.push(buildUnit(src.slice(objStart, j + 1)))
        objStart = -1
      }
    }
  }
  return out
}

/** 常量式场景解析（chapter1.ts 旧结构） */
function extractConstScenes(src) {
  const units = []
  const re = /const\s+([A-Za-z0-9_]+)\s*:\s*(?:Scene|Omit<Scene[^>]*>)\s*=\s*\{/g
  const marks = []
  let m
  while ((m = re.exec(src))) marks.push({ name: m[1], idx: m.index })
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].idx
    const end = i + 1 < marks.length ? marks[i + 1].idx : src.length
    let body = src.slice(start, end)
    const cut = body.search(/\nconst (MEMORY_LABELS|ENDING_SCENE|COMMIT_TEXT|SCENES)\b|\nexport (function|const) (buildEpilogue|SCENES|getScene)\b/)
    if (cut > 0) body = body.slice(0, cut)
    outPush(units, buildUnit(body), marks[i].name)
  }
  // 补充：COMMIT_TEXT / MEMORY_LABELS 等散落文本（结局交代用）
  const tailTexts = []
  const commit = /const COMMIT_TEXT[^{]*\{([\s\S]*?)\n\}/.exec(src)
  if (commit) tailTexts.push(...extractStrings(commit[1]))
  const mem = /const MEMORY_LABELS[^{]*\{([\s\S]*?)\n\}/.exec(src)
  if (mem) tailTexts.push(...extractStrings(mem[1]))
  if (tailTexts.length) {
    units.push({ key: 'misc_tail', kind: 'misc', title: '尾声交代/标签', chapter: '尾声',
      bodyTexts: tailTexts, labels: [], hasChoices: false })
  }
  return units
}

function outPush(arr, unit, fallbackKey) {
  if (!unit.key) unit.key = fallbackKey
  arr.push(unit)
}

function buildUnit(body) {
  const idm = /id:\s*'([^']+)'/.exec(body)
  const title = /title:\s*'([^']*)'/.exec(body)
  const chapter = /chapter:\s*'([^']*)'/.exec(body)
  const arrays = extractParagraphArrays(body)
  return {
    key: idm ? idm[1] : '',
    kind: 'scene',
    title: title ? title[1] : '',
    chapter: chapter ? chapter[1] : '',
    bodyTexts: arrays[0] || [],
    outcomeTexts: arrays.slice(1).flat(),
    labels: extractLabels(body),
    hasChoices: /choices:\s*\[/.test(body),
  }
}

function extractStrings(s) {
  const out = []
  const re = /'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(s))) out.push(m[1])
  return out
}

// 抓 `paragraphs: [ ... ]` 的所有数组（按出现顺序）
function extractParagraphArrays(body) {
  const out = []
  const re = /paragraphs:\s*\[/g
  let m
  while ((m = re.exec(body))) {
    // 从 [ 开始做括号配对
    let i = body.indexOf('[', m.index)
    let depth = 0
    let j = i
    let inStr = false
    let quote = ''
    for (; j < body.length; j++) {
      const c = body[j]
      if (inStr) {
        if (c === '\\') { j++; continue }
        if (c === quote) inStr = false
        continue
      }
      if (c === "'" || c === '"' || c === '`') { inStr = true; quote = c; continue }
      if (c === '[') depth++
      else if (c === ']') { depth--; if (depth === 0) break }
    }
    const chunk = body.slice(i, j + 1)
    out.push(extractStrings(chunk))
  }
  return out
}

function extractLabels(body) {
  const out = []
  const re = /(label|hint):\s*'([^']*)'/g
  let m
  while ((m = re.exec(body))) out.push(m[2])
  return out
}

/* ---------------- 统计 ---------------- */

function countCJK(s) {
  let n = 0
  for (const ch of s) if (CJK.test(ch)) n++
  return n
}

function splitSentences(texts) {
  const joined = texts.join('\n')
  return joined
    .split(/[。！？；…\n]+/)
    .map((s) => s.trim())
    .filter((s) => countCJK(s) > 0)
}

function stats(nums) {
  if (!nums.length) return { mean: 0, cv: 0, min: 0, max: 0 }
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length)
  return { mean: +mean.toFixed(2), cv: +(sd / (mean || 1)).toFixed(3), min: Math.min(...nums), max: Math.max(...nums) }
}

function analyze(unit) {
  const texts = [...unit.bodyTexts, ...(unit.outcomeTexts || [])]
  const all = texts.join('\n')
  const full = all + '\n' + (unit.labels || []).join('\n')
  const cjk = countCJK(all)
  const sentences = splitSentences(texts)
  const sLens = sentences.map(countCJK)
  const paras = texts.filter((t) => countCJK(t) > 0)
  const pLens = paras.map(countCJK)

  const hits = (list, field = 'exact') => {
    const found = []
    for (const w of list) {
      if (field === 'exact') {
        if (all.includes(w)) found.push(w)
      }
    }
    return found
  }
  const regexHits = (res) => {
    const found = []
    for (const re of res) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(all))) found.push(m[0].replace(/^[。！？；\n]+/, '').trim())
    }
    return found
  }

  const banned = hits(BANNED)
  const bannedDiscourse = regexHits(BANNED_DISCOURSE)
  banned.push(...bannedDiscourse)
  const emo = hits(EMOTION_NAMED)
  const big = hits(BIG_WORDS)
  const tellHits = regexHits(NARRATION_TELLS)
  const tri = regexHits([TRICOLON[0]])
  const similes = (all.match(SIMILE) || []).length
  const abstractHits = []
  for (const w of ABSTRACT) {
    const n = (all.split(w).length - 1)
    if (n > 0) abstractHits.push(`${w}x${n}`)
  }
  const concreteHits = {}
  for (const w of CONCRETE) {
    const n = all.split(w).length - 1
    if (n > 0) concreteHits[w] = n
  }
  const actionHits = {}
  for (const w of ACTIONS) {
    const n = all.split(w).length - 1
    if (n > 0) actionHits[w] = n
  }
  const imageryFound = {}
  for (const [k, words] of Object.entries(IMAGERY)) {
    const n = words.reduce((acc, w) => acc + (all.split(w).length - 1), 0)
    if (n > 0) imageryFound[k] = n
  }

  // 粗粒度"可触物密度"：具体物 独立词次数 / 百字
  const concreteTotal = Object.values(concreteHits).reduce((a, b) => a + b, 0)
  const actionTotal = Object.values(actionHits).reduce((a, b) => a + b, 0)
  // 单一具体物最高重复（比"意象组"更能抓名词复读）
  const topEntries = Object.entries(concreteHits).sort((a, b) => b[1] - a[1])
  const topConcrete = topEntries.length ? { word: topEntries[0][0], n: topEntries[0][1] } : { word: '', n: 0 }

  return {
    key: unit.key,
    title: unit.title,
    chapter: unit.chapter,
    cjk,
    paras: paras.length,
    // 第二人称只算叙述：剔除「」『』内的人物对话（对话里的「你」合法）
    secondPerson: (all
      .replace(/「[^」]*」/g, '')
      .replace(/『[^』]*』/g, '')
      .replace(/[：:][^。！？\n]{0,60}[。！？]?/g, '')
      .match(/你/g) || []).length,
    choices: unit.hasChoices ? (unit.labels.length ? 'yes' : 'yes') : 'no',
    sentence: stats(sLens),
    sentenceMean: stats(sLens).mean,
    sentenceCV: stats(sLens).cv,
    shortFrac: sLens.length ? +(sLens.filter((n) => n < 10).length / sLens.length).toFixed(2) : 0,
    commaDensity: cjk ? +((all.match(/[，、]/g) || []).length * 100 / cjk).toFixed(1) : 0,
    paraCV: stats(pLens).cv,
    concreteTypes: Object.keys(concreteHits).length,
    concreteDensity: cjk ? +((concreteTotal * 100) / cjk).toFixed(1) : 0,
    actionTypes: Object.keys(actionHits).length,
    actionDensity: cjk ? +((actionTotal * 100) / cjk).toFixed(1) : 0,
    similes,
    simileDensity: cjk ? +((similes * 100) / cjk).toFixed(2) : 0,
    banned,
    emo,
    big,
    tells: tellHits,
    tricolon: tri,
    abstract: abstractHits,
    imagery: imageryFound,
    imageryMax: Object.values(imageryFound).length ? Math.max(...Object.values(imageryFound)) : 0,
    imageryMaxPer100: cjk && Object.values(imageryFound).length
      ? +((Math.max(...Object.values(imageryFound)) * 100) / cjk).toFixed(1)
      : 0,
    topConcrete: topConcrete.word,
    topConcreteN: topConcrete.n,
    topConcretePer100: cjk ? +((topConcrete.n * 100) / cjk).toFixed(1) : 0,
    texts, // 供人工抽读
  }
}

/* ---------------- 输出 ---------------- */

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) {
  console.error('usage: node lit-scan.mjs [--json] <file.ts> [...]')
  process.exit(1)
}

/** 简易 0—5 提示分：只做"体检"，不代替人工五维 */
function heuristic(r) {
  let s = 5
  if (r.banned.length) s -= Math.min(2, r.banned.length)
  if (r.emo.length) s -= Math.min(2, r.emo.length)
  if (r.big.length) s -= Math.min(2, r.big.length)
  if (r.tells.length) s -= Math.min(2, r.tells.length)
  if (r.tricolon.length) s -= 1
  if (r.concreteDensity < 1.2) s -= 2
  else if (r.concreteDensity < 2.0) s -= 1
  if (r.actionDensity < 1.0) s -= 1
  if (r.sentence.cv < 0.3) s -= 1
  if (r.shortFrac < 0.15) s -= 1 // 短句太少 = 句子被拉长
  if (r.topConcretePer100 > 2.5) s -= 1 // 单一具体物过饱和（名词复读）
  return Math.max(0, Math.min(5, s))
}

const report = []
for (const f of files) {
  for (const u of extractUnits(f)) {
    const r = analyze(u)
    r.file = path.basename(f)
    r.heuristic = heuristic(r)
    report.push(r)
  }
}

if (jsonMode) {
  const slim = report.map(({ texts, ...rest }) => rest)
  console.log(JSON.stringify(slim, null, 2))
} else {
  const byFile = {}
  for (const r of report) (byFile[r.file] ||= []).push(r)
  for (const [file, rows] of Object.entries(byFile)) {
    const scenes = rows.filter((r) => r.key !== 'misc_tail')
    const totalCJK = rows.reduce((a, r) => a + r.cjk, 0)
    console.log(`\n### ${file}  —  ${scenes.length} 单元 / CJK ${totalCJK}`)
    console.log(
      'unit'.padEnd(14) +
        'CJK'.padStart(6) +
        '具体/百'.padStart(9) +
        '动作/百'.padStart(9) +
        '句均长'.padStart(7) +
        '句长CV'.padStart(8) +
        '短句%'.padStart(7) +
        '逗/百'.padStart(7) +
        '喻/百'.padStart(6) +
        '意象峰'.padStart(7) +
        '提示'.padStart(5)
    )
    for (const r of rows) {
      console.log(
        String(r.key).padEnd(14) +
          String(r.cjk).padStart(6) +
          String(r.concreteDensity).padStart(9) +
          String(r.actionDensity).padStart(9) +
          String(r.sentence.mean).padStart(7) +
          String(r.sentence.cv).padStart(8) +
          String(Math.round(r.shortFrac * 100)).padStart(7) +
          String(r.commaDensity).padStart(7) +
          String(r.simileDensity).padStart(6) +
          String(r.imageryMaxPer100).padStart(7) +
          String(r.heuristic).padStart(5)
      )
      const flags = []
      if (r.secondPerson) flags.push(`第二人称×${r.secondPerson}(P0)`)
      if (r.banned.length) flags.push(`禁用[${r.banned.join(',')}]`)
      if (r.emo.length) flags.push(`情绪直呼[${r.emo.join(',')}]`)
      if (r.big.length) flags.push(`大词[${r.big.join(',')}]`)
      if (r.tells.length) flags.push(`旁白[${r.tells.join(' | ')}]`)
      if (r.tricolon.length) flags.push(`三连[${r.tricolon.join(' | ')}]`)
      if (r.shortFrac < 0.15) flags.push(`节奏:短句仅${Math.round(r.shortFrac * 100)}%`)
      if (r.sentence.cv < 0.35) flags.push(`节奏:CV${r.sentence.cv}`)
      if (r.topConcretePer100 > 2.5) flags.push(`名词复读:${r.topConcrete}x${r.topConcreteN}(${r.topConcretePer100}/百字)`)
      if (flags.length) console.log('   ⚠ ' + flags.join('  '))
      const img = Object.entries(r.imagery)
      if (img.length) console.log('   意象: ' + img.map(([k, n]) => `${k}×${n}`).join('  '))
    }
    const withText = rows.filter((r) => r.cjk > 0)
    const avg = (k) => (+(withText.reduce((a, r) => a + (r[k] || 0), 0) / (withText.length || 1)).toFixed(2))
    console.log(
      `  【文件合计】CJK ${totalCJK}  禁用 ${rows.reduce((a, r) => a + r.banned.length, 0)}` +
        `  旁白 ${rows.reduce((a, r) => a + r.tells.length, 0)}  情绪直呼 ${rows.reduce((a, r) => a + r.emo.length, 0)}` +
        `  三连 ${rows.reduce((a, r) => a + r.tricolon.length, 0)}  大词 ${rows.reduce((a, r) => a + r.big.length, 0)}` +
        `  第二人称 ${rows.reduce((a, r) => a + r.secondPerson, 0)}`
    )
    console.log(
      `  【单元均值】具体 ${avg('concreteDensity')}/百字  动作 ${avg('actionDensity')}/百字` +
        `  句均长 ${avg('sentenceMean')}  句长CV ${avg('sentenceCV')}  短句 ${Math.round(avg('shortFrac') * 100)}%` +
        `  逗号 ${avg('commaDensity')}/百字  明喻 ${avg('simileDensity')}/百字`
    )
  }
}
