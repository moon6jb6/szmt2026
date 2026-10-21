#!/usr/bin/env node
/**
 * 音效扩展层最小验证（42 事件 / 四总线 / 逐条补偿 / 换场 / 点缀）
 *
 * 用法：
 *   node tools/audio/verify-events.mjs                       # 静态检查 + 浏览器检查（默认 5199）
 *   node tools/audio/verify-events.mjs --static              # 只跑静态检查（不需要 dev server）
 *   node tools/audio/verify-events.mjs http://127.0.0.1:5199/
 *
 * 为什么有这个脚本：`tools/test-audio.mjs` 被回滚成只验「默认静音 / ctx / 床 / drone」的旧版，
 * 不含扩展层的 42 事件断言。本脚本按 docs/audio/README.md §二 的映射表补上：
 *   1) AUDIO_EVENT_MAP 覆盖 42 个事件，且事件名与 README 完全一致；
 *   2) 每个事件至少一条非空 layer，layer 的 id 全部存在于 28 条清单；
 *   3) 28 条素材没有一条是死的（事件层 / 床 / drone 都能索引到）；
 *   4) 四总线数值、逐条补偿、混响、淡入淡出、限流常数；
 *   5) 五种换场、八种点缀关键词、确定性 1/3 + 20s 冷却 + 单槽；
 *   6) 旧导出全部保留（App 不改也能编译）。
 *
 * 退出码：0 全过；1 有失败。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const AUDIO_TS = path.join(ROOT, 'src', 'game', 'audio.ts')
const MANIFEST_TS = path.join(ROOT, 'src', 'game', 'content', 'audioManifest.ts')
const DEFAULT_URL = 'http://127.0.0.1:5199/'

const EXPECTED_EVENTS = [
  'menu:enter', 'menu:click', 'ui:hover', 'ui:click', 'ui:back',
  'ui:3d:on', 'ui:3d:off', 'ui:source:open', 'ui:source:close',
  'ui:gallery', 'ui:sources', 'ui:people', 'ui:later',
  'ui:person:open', 'ui:later:open', 'ui:audio:on',
  'page:advance',
  'carrier:roster', 'carrier:letters', 'carrier:flag', 'carrier:photo',
  'carrier:testimony', 'carrier:message', 'carrier:archive', 'carrier:relics',
  'carrier:wordofmouth',
  'transition:ink', 'transition:rain', 'transition:snow', 'transition:ash', 'transition:smoke',
  'ending:enter', 'ending:finale:start', 'ending:finale:end',
  'accent:radio', 'accent:flag', 'accent:crowd', 'accent:thud',
  'accent:steps', 'accent:match', 'accent:ink', 'accent:pen',
]

const EXPECTED_TRIMS = {
  'room-tone': 3.2,
  'radio-static': 6.2,
  'tape-hiss': 10.2,
  'drone-ending-message': 3.0,
}

const EXPECTED_MIX = { master: 0.9, sfx: 0.6, ambience: 0.625, drone: 0.882, accent: 0.279 }

/* ── 小工具 ─────────────────────────────────────────────────────── */

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    const detail = await fn()
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^[ \t]*\/\/.*$/gmu, '')
}

/** 从 openIndex 处的开括号取到配对的闭括号之间（不含两端） */
function sliceBalanced(source, openIndex, open, close) {
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) depth += 1
    else if (source[i] === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }
  return ''
}

function parseEventMap(body) {
  const result = new Map()
  let depth = 0
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '[' || ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === ']' || ch === '}') {
      depth -= 1
      i += 1
      continue
    }
    if (ch === "'" && depth === 0) {
      const end = body.indexOf("'", i + 1)
      const key = body.slice(i + 1, end)
      let j = end + 1
      while (j < body.length && /\s/u.test(body[j])) j += 1
      if (body[j] === ':') {
        j += 1
        while (j < body.length && /\s/u.test(body[j])) j += 1
        if (body[j] === '[') {
          const arrayBody = sliceBalanced(body, j, '[', ']')
          result.set(key, arrayBody)
          i = j + arrayBody.length + 2
          continue
        }
      }
      i = end + 1
      continue
    }
    i += 1
  }
  return result
}

function layerIds(arrayBody) {
  return [...arrayBody.matchAll(/id:\s*'([^']+)'/gu)].map((match) => match[1])
}

function functionBody(source, signature) {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`找不到函数：${signature}`)
  const open = source.indexOf('{', start)
  return sliceBalanced(source, open, '{', '}')
}

/* ── 静态检查：直接读源码 ───────────────────────────────────────── */

const rawAudio = readFileSync(AUDIO_TS, 'utf8')
const audio = stripComments(rawAudio)
const rawManifest = readFileSync(MANIFEST_TS, 'utf8')

const manifestIds = (() => {
  const match = rawManifest.match(/export const AUDIO_IDS: string\[\] = \[([\s\S]*?)\]/u)
  if (!match) throw new Error('audioManifest.ts 里找不到 AUDIO_IDS')
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((item) => item[1])
})()

const unionEvents = (() => {
  const start = audio.indexOf('export type AudioEvent =')
  const end = audio.indexOf('export const AUDIO_EVENT_MAP')
  if (start < 0 || end < 0) throw new Error('找不到 AudioEvent 联合类型')
  const region = audio.slice(start, end)
  return [...region.matchAll(/^\s*\|\s*'([^']+)'/gmu)].map((match) => match[1])
})()

const eventMap = (() => {
  const marker = audio.indexOf('export const AUDIO_EVENT_MAP')
  if (marker < 0) throw new Error('找不到 AUDIO_EVENT_MAP')
  const assign = audio.indexOf('= {', marker)
  const body = sliceBalanced(audio, assign + 2, '{', '}')
  return parseEventMap(body)
})()

const mapLayerIds = new Map()
for (const [event, body] of eventMap) mapLayerIds.set(event, layerIds(body))

const bedIds = (() => {
  const body =
    functionBody(audio, 'export function ambienceForScene(') +
    functionBody(audio, 'export function ambienceForScreen(')
  return new Set([...body.matchAll(/'([a-z][a-z0-9-]+)'/gu)].map((m) => m[1]))
})()

const droneIds = (() => {
  const body = functionBody(audio, 'export function droneForEnding(')
  return new Set([...body.matchAll(/'(drone-ending-[a-z]+)'/gu)].map((m) => m[1]))
})()

const referencedIds = new Set([...mapLayerIds.values()].flatMap((ids) => [...ids]))
for (const id of bedIds) referencedIds.add(id)
for (const id of droneIds) referencedIds.add(id)

const trimTable = (() => {
  const marker = audio.indexOf('const LEVEL_TRIM_DB')
  const assign = audio.indexOf('= {', marker)
  const body = sliceBalanced(audio, assign + 2, '{', '}')
  const table = {}
  for (const [, quoted, bare, value] of body.matchAll(
    /(?:'([a-z0-9-]+)'|([a-z][a-z0-9-]*))\s*:\s*(-?[\d.]+)/gu,
  )) {
    table[quoted ?? bare] = Number(value)
  }
  return table
})()

const mixBlock = (() => {
  const marker = audio.indexOf('export const MIX = {')
  const body = sliceBalanced(audio, audio.indexOf('{', marker), '{', '}')
  const mix = {}
  for (const [, key, value] of body.matchAll(/([a-z]+)\s*:\s*([\d.]+)/gu)) {
    mix[key] = Number(value)
  }
  return mix
})()

function constant(name) {
  const match = audio.match(new RegExp(`const ${name} = (-?[\\d_]+(?:\\.[\\d]+)?)`, 'u'))
  if (!match) throw new Error(`找不到常量 ${name}`)
  return Number(match[1].replace(/_/gu, ''))
}

console.log('\n=== 静态检查：src/game/audio.ts ===')

await check('AudioEvent 联合类型正好 42 个成员', () => {
  assert(unionEvents.length === 42, `实际 ${unionEvents.length}`)
  return `${unionEvents.length}`
})

await check('事件名与 README §二 完全一致（无编造、无遗漏）', () => {
  const actual = [...unionEvents].sort()
  const expected = [...EXPECTED_EVENTS].sort()
  const missing = expected.filter((event) => !actual.includes(event))
  const extra = actual.filter((event) => !expected.includes(event))
  assert(missing.length === 0, `缺 ${missing.join(', ')}`)
  assert(extra.length === 0, `多 ${extra.join(', ')}`)
  return '42/42'
})

await check('AUDIO_EVENT_MAP 覆盖全部 42 个事件', () => {
  const keys = [...eventMap.keys()]
  assert(keys.length === 42, `map 里 ${keys.length} 个键`)
  const missing = unionEvents.filter((event) => !eventMap.has(event))
  assert(missing.length === 0, `未实现：${missing.join(', ')}`)
  return '42'
})

await check('每个事件至少一条非空 layer', () => {
  const empty = []
  for (const [event, body] of eventMap) {
    if (layerIds(body).length === 0) empty.push(event)
  }
  assert(empty.length === 0, `空 layer：${empty.join(', ')}`)
  return `${[...mapLayerIds.values()].reduce((sum, ids) => sum + ids.length, 0)} 层 / 42 事件`
})

await check('事件引用的素材 id 全部存在于 28 条清单', () => {
  const manifest = new Set(manifestIds)
  const unknown = []
  for (const [event, ids] of mapLayerIds) {
    for (const id of ids) if (!manifest.has(id)) unknown.push(`${event}→${id}`)
  }
  assert(unknown.length === 0, `未知 id：${unknown.join(', ')}`)
  assert(manifestIds.length === 28, `清单 ${manifestIds.length} 条`)
  return '28 条清单全覆盖'
})

await check('28 条素材没有一条是死的（事件层 / 床 / drone 都被引用）', () => {
  const dead = manifestIds.filter((id) => !referencedIds.has(id))
  assert(dead.length === 0, `死素材：${dead.join(', ')}`)
  return `${referencedIds.size} 条被引用`
})

await check('四总线数值 = README §三', () => {
  for (const [key, value] of Object.entries(EXPECTED_MIX)) {
    assert(Math.abs((mixBlock[key] ?? NaN) - value) < 1e-9, `${key}=${mixBlock[key]}，应为 ${value}`)
  }
  return 'master 0.9 / sfx 0.6 / ambience 0.625 / drone 0.882 / accent 0.279'
})

await check('软削波 tanh：拐点 -1 dBFS、oversample 2x', () => {
  assert(constant('SOFT_CLIP_KNEE_DBFS') === -1, '拐点不是 -1')
  assert(/SOFT_CLIP_OVERSAMPLE[^=]*=\s*'2x'/u.test(audio), 'oversample 不是 2x')
  assert(/Math\.tanh\(/u.test(audio), '曲线里没有 tanh')
  return 'tanh(-1 dBFS, 2x)'
})

await check('房间混响：0.5s 噪声 IR、湿声 0.14、程序化生成', () => {
  assert(constant('IR_SECONDS') === 0.5, 'IR 不是 0.5s')
  assert(constant('REVERB_WET') === 0.14, '湿声不是 0.14')
  assert(/createConvolver\(/u.test(audio), '没有 ConvolverNode')
  assert(/createBuffer\(2,/u.test(audio) && /getChannelData\(/u.test(audio), 'IR 不是程序化生成')
  return 'ConvolverNode + 0.5s 衰减噪声，湿声 0.14'
})

await check('淡入淡出：床 1.2/0.9s、drone 1.6s（终极 3.0s）', () => {
  assert(constant('BED_FADE_IN_MS') === 1200, '床淡入不是 1.2s')
  assert(constant('BED_FADE_OUT_MS') === 900, '床淡出不是 0.9s')
  assert(constant('DRONE_FADE_IN_MS') === 1600, 'drone 淡入不是 1.6s')
  assert(constant('FINALE_FADE_IN_MS') === 3000, '终极画面淡入不是 3.0s')
  return '1.2 / 0.9 / 1.6 / 3.0s'
})

await check('限流：同 id 70ms、事件 60ms、悬停 240ms、翻页 90ms、换场 400ms', () => {
  assert(constant('SAME_ID_THROTTLE_MS') === 70, '同 id 不是 70ms')
  assert(constant('DEFAULT_EVENT_THROTTLE_MS') === 60, '事件不是 60ms')
  assert(constant('HOVER_THROTTLE_MS') === 240, '悬停不是 240ms')
  assert(constant('PAGE_TURN_THROTTLE_MS') === 90, '翻页不是 90ms')
  assert(constant('TRANSITION_THROTTLE_MS') === 400, '换场不是 400ms')
  return '70 / 60 / 240 / 90 / 400ms'
})

await check('逐条补偿：room-tone +3.2、radio-static +6.2、tape-hiss +10.2、drone-ending-message +3.0', () => {
  for (const [id, expected] of Object.entries(EXPECTED_TRIMS)) {
    const actual = trimTable[id]
    assert(Math.abs((actual ?? NaN) - expected) < 1e-9, `${id}=${actual}，应为 ${expected}`)
  }
  return '四条关键补偿一致'
})

await check('补偿表只覆盖 15 条循环素材', () => {
  const keys = Object.keys(trimTable)
  assert(keys.length === 15, `表里 ${keys.length} 条（应为 9 床 + 6 drone）`)
  for (const [id, value] of Object.entries(trimTable)) {
    assert(manifestIds.includes(id), `${id} 不在清单里`)
    assert(Math.abs(value) <= 11, `${id} 补偿 ${value} dB 过界`)
  }
  return '15 条'
})

await check('五种换场：天气层走 ambience 总线、2.2—2.6s、0.35—1.0s 淡入', () => {
  const variants = ['ink', 'rain', 'snow', 'ash', 'smoke']
  for (const variant of variants) {
    const body = eventMap.get(`transition:${variant}`)
    assert(body, `缺 transition:${variant}`)
    const ids = layerIds(body)
    assert(ids.includes('distant-thud'), `transition:${variant} 缺 distant-thud`)
    if (variant === 'ink') {
      assert(ids.includes('paper'), 'transition:ink 缺 paper')
      continue
    }
    const channel = /channel:\s*'ambience'/u.test(body)
    assert(channel, `transition:${variant} 天气层不在 ambience 总线`)
    const duration = Number(body.match(/durationMs:\s*(\d+)/u)?.[1] ?? 0)
    const fadeIn = Number(body.match(/fadeInMs:\s*(\d+)/u)?.[1] ?? 0)
    assert(duration >= 2200 && duration <= 2600, `${variant} 时长 ${duration}ms 越界`)
    assert(fadeIn >= 350 && fadeIn <= 1000, `${variant} 淡入 ${fadeIn}ms 越界`)
  }
  return 'ink/rain/snow/ash/smoke'
})

await check('八种点缀事件 + 关键词顺序（录音→旗→河→炮→脚步→灯→墨→笔）', () => {
  const accents = unionEvents.filter((event) => event.startsWith('accent:'))
  assert(accents.length === 8, `点缀事件 ${accents.length} 个`)
  const rulesBody = (() => {
    const marker = audio.indexOf('export const ACCENT_RULES')
    const assign = audio.indexOf('= [', marker)
    return sliceBalanced(audio, assign + 2, '[', ']')
  })()
  const order = [...rulesBody.matchAll(/event:\s*'(accent:[a-z]+)'/gu)].map((m) => m[1])
  assert(
    order.join(',') ===
      'accent:radio,accent:flag,accent:crowd,accent:thud,accent:steps,accent:match,accent:ink,accent:pen',
    `顺序是 ${order.join(',')}`,
  )
  const keywordGroups = [...rulesBody.matchAll(/keywords:\s*\[([^\]]+)\]/gu)].map((m) => m[1])
  assert(keywordGroups.length === 8, '关键词组不是 8 个')
  const needed = {
    'accent:radio': ['A-017', '录音', '短波'],
    'accent:flag': ['升旗', '旗'],
    'accent:crowd': ['苏州', '河'],
    'accent:thud': ['炮', '闷响'],
    'accent:steps': ['脚步', '走廊'],
    'accent:match': ['煤油灯', '火柴'],
    'accent:ink': ['蘸墨', '墨'],
    'accent:pen': ['写名字', '名单'],
  }
  for (const [event, words] of Object.entries(needed)) {
    const group = keywordGroups[order.indexOf(event)]
    for (const word of words) assert(group.includes(`'${word}'`), `${event} 缺关键词 ${word}`)
  }
  return '8 / 42'
})

await check('点缀三道闸门：确定性 1/3 + 20s 冷却 + 单槽', () => {
  const body = functionBody(audio, 'export function playAccentForScene(')
  assert(
    /hashString\(`\$\{sceneId\}:\$\{event\}`\) % 3 === 0/u.test(audio),
    '没有 hash % 3 === 0 的确定性闸门',
  )
  assert(constant('ACCENT_COOLDOWN_MS') === 20000, '冷却不是 20s')
  assert(/lastAccentAt/u.test(body), '没有全局冷却')
  assert(/lastAccentById/u.test(body), '没有同 id 冷却')
  assert(/slots\.accent\.until > now/u.test(body), '没有单槽占用检查')
  return 'hash%3 + 20s + 单槽'
})

await check('新导出齐全：playEvent / playTransition / carrierEvent / playAccentForScene / rampDrone / setDrone', () => {
  const exports = [
    'export function playEvent(',
    'export function playTransition(',
    'export function carrierEvent(',
    'export function playAccentForScene(',
    'export function setDrone(',
    'export function rampDrone(',
    'export const AUDIO_EVENT_MAP',
    'export const DRONE_FINALE_FADE_IN_MS',
  ]
  for (const needle of exports) assert(audio.includes(needle), `缺 ${needle}`)
  return '8 个新符号'
})

await check('旧导出全部保留（App / 组件不改也能编译）', () => {
  const legacy = [
    'export function unlockAudio(',
    'export function isAudioUnlocked(',
    'export function isMuted(',
    'export function setMuted(',
    'export function playSfx(',
    'export function setAmbience(',
    'export function stopAudio(',
    'export function clickSoundFor(',
    'export function droneForEnding(',
    'export function ambienceForScene(',
    'export function ambienceForScreen(',
  ]
  for (const needle of legacy) assert(audio.includes(needle), `缺 ${needle}`)
  return '11 个旧导出'
})

await check('默认静音 / 手势解锁 / 隐藏 suspend / DEV 探针保持', () => {
  assert(/raw !== '0'/u.test(audio), '默认静音判断变了')
  assert(/master\.gain\.value = muted \? 0 : MIX\.master/u.test(audio), 'master 没有跟随静音')
  assert(/new Ctor\(\)/u.test(audio), 'AudioContext 不是在手势里创建')
  assert(/visibilitychange/u.test(audio) && /ctx\.suspend\(\)/u.test(audio), '没有隐藏 suspend')
  assert(/__audio/u.test(rawAudio) && /import\.meta\.env\.DEV/u.test(rawAudio), '探针不是 DEV only')
  return 'muted=false 才建 ctx；hidden 即 suspend'
})

/* ── 浏览器检查（playwright）───────────────────────────────────── */

async function runBrowser(url) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    console.log('\nSKIP 浏览器检查：没装 playwright')
    return
  }

  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  try {
    await page.goto(url, { waitUntil: 'networkidle' })
  } catch (error) {
    await browser.close()
    console.log(`\nSKIP 浏览器检查：${url} 连不上（${String(error).slice(0, 80)}）`)
    return
  }
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  const hasProbe = await page.evaluate(() => Boolean(window.__audio))
  await check('浏览器：window.__audio 探针在（dev only）', () => {
    assert(hasProbe, '探针不存在，dev server 上跑才有')
    return 'present'
  })
  if (!hasProbe) {
    await browser.close()
    return
  }

  /** 开着声音再测（dev server 的 HMR 可能在长测期间整页刷新，声音会回到默认静音） */
  const ensureAudio = async () => {
    const before = await page.evaluate(() => ({
      muted: window.__audio.isMuted(),
      state: window.__audio.getState(),
    }))
    if (!before.muted && before.state === 'running') return
    await page.locator('.audio-toggle').click()
    await page.waitForTimeout(1200)
  }
  /** HMR 整页刷新会让 evaluate 抛 "Execution context was destroyed"：重试一次 */
  const retry = async (run, attempts = 2) => {
    let last
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await run()
      } catch (error) {
        last = error
        await page.waitForTimeout(800)
        await ensureAudio()
      }
    }
    throw last
  }

  await check('浏览器：编译后的 AUDIO_EVENT_MAP = 42 事件、每事件非空、id 全在清单', async () => {
    const result = await page.evaluate(() => {
      const api = window.__audio
      const events = api.events()
      const map = api.map()
      const manifest = new Set(api.manifest())
      const empty = []
      const unknown = []
      let layers = 0
      for (const event of events) {
        const list = map[event] ?? []
        if (list.length === 0) empty.push(event)
        for (const layer of list) {
          layers += 1
          if (!manifest.has(layer.id)) unknown.push(`${event}→${layer.id}`)
        }
      }
      return {
        count: api.eventCount(),
        unique: new Set(events).size,
        empty,
        unknown,
        layers,
        manifest: manifest.size,
      }
    })
    assert(result.count === 42, `eventCount=${result.count}`)
    assert(result.unique === 42, `事件名有重复（${result.unique} 个唯一）`)
    assert(result.empty.length === 0, `空事件：${result.empty.join(',')}`)
    assert(result.unknown.length === 0, `未知 id：${result.unknown.join(',')}`)
    assert(result.manifest === 28, `清单 ${result.manifest} 条`)
    return `${result.layers} 层 / 28 条素材`
  })

  await check('浏览器：28 条素材无死条（事件层 + 床选择器 + 6 条结局 drone）', async () => {
    const result = await page.evaluate(() => {
      const api = window.__audio
      const manifest = api.manifest()
      const used = new Set()
      for (const event of api.events()) for (const layer of api.map()[event]) used.add(layer.id)
      const beds = new Set()
      for (const weather of ['rain', 'snow', 'ash', 'smoke', 'none']) {
        for (const where of ['', '四行仓库 夜', '苏州河', '巷子', '租界 街道', '对岸 人群']) {
          const id = api.ambienceForScene(weather, where, '')
          if (id) beds.add(id)
        }
      }
      for (const screen of ['menu', 'gallery', 'about', 'sources', 'people', 'later', 'ending']) {
        const id = api.ambienceForScreen(screen)
        if (id) beds.add(id)
      }
      const union = new Set([...used, ...beds])
      return {
        unused: manifest.filter((id) => !used.has(id) && !beds.has(id)),
        beds: [...beds],
        used: used.size,
        union: union.size,
        manifest: manifest.length,
      }
    })
    const drones = result.unused.filter((id) =>
      /^drone-ending-(names|letters|flag|photo|testimony|message)$/u.test(id),
    )
    const others = result.unused.filter((id) => !drones.includes(id))
    assert(others.length === 0, `事件表/床选择器都碰不到：${others.join(',')}`)
    assert(drones.length === 6, `unused 里 drone ${drones.length} 条（应为 6）`)
    assert(result.beds.length === 6, `床选择器只选到 ${result.beds.length} 条（应为 6）`)
    assert(result.union + drones.length === result.manifest, `并集 ${result.union}+6 ≠ ${result.manifest}`)
    return `事件层 ${result.used} 条 + 仅床 ${result.union - result.used} 条 + drone ${drones.length} 条 = ${result.manifest}`
  })

  await check('浏览器：混音 / 补偿 / 混响参数与文档一致', async () => {
    const result = await page.evaluate(() => ({
      mix: window.__audio.mix(),
      trims: window.__audio.trims(),
      reverb: window.__audio.reverb(),
      softClip: window.__audio.softClip(),
    }))
    for (const [key, value] of Object.entries(EXPECTED_MIX)) {
      assert(Math.abs(result.mix[key] - value) < 1e-9, `mix.${key}=${result.mix[key]}`)
    }
    for (const [id, value] of Object.entries(EXPECTED_TRIMS)) {
      assert(Math.abs(result.trims[id] - value) < 1e-9, `trim ${id}=${result.trims[id]}`)
    }
    assert(Math.abs(result.reverb.wet - 0.14) < 1e-9, `wet=${result.reverb.wet}`)
    assert(Math.abs(result.reverb.seconds - 0.5) < 1e-9, `IR=${result.reverb.seconds}s`)
    assert(result.softClip.kneeDbfs === -1 && result.softClip.oversample === '2x', 'softClip 不对')
    return 'master 0.9 / wet 0.14 / IR 0.5s / tanh 2x'
  })

  await check('浏览器：默认静音，点「声音」后解锁 running', async () => {
    const before = await page.evaluate(() => ({
      muted: window.__audio.isMuted(),
      state: window.__audio.getState(),
    }))
    assert(before.muted === true, '默认不是静音')
    assert(before.state === 'none', `未点声音就建了 ctx（${before.state}）`)
    await page.locator('.audio-toggle').click()
    await page.waitForTimeout(1600)
    const after = await page.evaluate(() => ({
      muted: window.__audio.isMuted(),
      state: window.__audio.getState(),
      unlocked: window.__audio.isUnlocked(),
    }))
    assert(after.muted === false, '点了声音还是静音')
    assert(after.state === 'running', `ctx 状态 ${after.state}`)
    assert(after.unlocked === true, '未解锁')
    return '静音 → click → running'
  })

  await check('浏览器：悬停限流（连发 8 次只响 1 声）', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(async () => {
      const api = window.__audio
      api.resetGates()
      for (let i = 0; i < 8; i += 1) api.playEvent('ui:hover')
      await new Promise((resolve) => setTimeout(resolve, 260))
      const log = api.log()
      return { hover: log.filter((item) => item.event === 'ui:hover').length }
    }))
    assert(result.hover === 1, `响了 ${result.hover} 声`)
    return '8 → 1'
  })

  await check('浏览器：换场天气层真的起声（transition:rain → 单槽占用 + 解码进缓冲）', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(async () => {
      const api = window.__audio
      api.resetGates()
      const played = api.playTransition('rain')
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return {
        played,
        logged: api.log().some((item) => item.event === 'transition:rain'),
        slot: api.slots().transition,
        buffered: api.buffered(),
        level: api.levels().ambience,
      }
    }))
    assert(result.played === true, 'playTransition 返回 false')
    assert(result.logged === true, '日志里没有 transition:rain')
    assert(result.slot.handle === true, '换场单槽没被占用')
    assert(result.buffered.includes('rain-light'), 'rain-light 没解码进缓存')
    assert(result.level > -90, `ambience 总线电平 ${result.level.toFixed(1)} dBFS`)
    return `slot busy + rain-light 已解码 + 总线 ${result.level.toFixed(1)} dBFS`
  })

  await check('浏览器：点缀确定性 1/3 + 20s 冷却（连试 30 个场景只响 1 次）+ 关键词命中', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(async () => {
      const api = window.__audio
      api.resetGates()
      const hits = []
      for (let i = 0; i < 30; i += 1) {
        const hit = api.playAccent(`verify-scene-${i}`, '他站在桥边，看见苏州河上的船')
        if (hit) hits.push(hit)
      }
      const keywords = {
        flag: api.accentFor('楼顶升旗，旗面被风掀开'),
        thud: api.accentFor('墙外一记闷响，炮声很远'),
        radio: api.accentFor('录音带 A-017 还在转'),
        crowd: api.accentFor('苏州河对岸的租界'),
        steps: api.accentFor('走廊里传来脚步'),
        pen: api.accentFor('他在名单上写下名字'),
        match: api.accentFor('划一根火柴，点亮煤油灯'),
        ink: api.accentFor('笔尖蘸墨，压住纸'),
        none: api.accentFor('雪停了，屋里很静'),
      }
      await new Promise((resolve) => setTimeout(resolve, 1400))
      return { hits, keywords, buffered: api.buffered(), slot: api.slots().accent }
    }))
    assert(result.hits.length === 1, `30 次里响了 ${result.hits.length} 次（应为 1）`)
    assert(result.hits[0] === 'accent:crowd', `命中的是 ${result.hits[0]}`)
    const expected = {
      flag: 'accent:flag',
      thud: 'accent:thud',
      radio: 'accent:radio',
      crowd: 'accent:crowd',
      steps: 'accent:steps',
      pen: 'accent:pen',
      match: 'accent:match',
      ink: 'accent:ink',
      none: null,
    }
    for (const [key, value] of Object.entries(expected)) {
      assert(result.keywords[key] === value, `${key} → ${result.keywords[key]}（应为 ${value}）`)
    }
    assert(result.slot.until > 0, '点缀单槽没有登记占用')
    assert(result.buffered.includes('crowd-whisper'), '点缀素材没解码')
    return '30 → 1（accent:crowd）；9 条关键词映射正确'
  })

  await check('浏览器：点击载体 / 翻页 / 终极画面起势都能起声', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(async () => {
      const api = window.__audio
      const results = {}
      for (const event of ['carrier:roster', 'carrier:archive', 'page:advance', 'ending:finale:start']) {
        api.resetGates()
        results[event] = api.playEvent(event)
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      await new Promise((resolve) => setTimeout(resolve, 700))
      return {
        results,
        logged: api.log().map((item) => item.event),
        factor: api.droneFactor(),
        buffered: api.buffered(),
      }
    }))
    for (const [event, played] of Object.entries(result.results)) {
      assert(played === true, `${event} 没起声`)
    }
    assert(result.logged.includes('carrier:roster'), '日志缺 carrier:roster')
    assert(result.logged.includes('carrier:archive'), '日志缺 carrier:archive')
    assert(result.logged.includes('page:advance'), '日志缺 page:advance')
    assert(result.logged.includes('ending:finale:start'), '日志缺 ending:finale:start')
    assert(Math.abs(result.factor - 1) < 1e-9, `finale 起势后 droneFactor=${result.factor}`)
    return 'carrier:roster/archive + page:advance + finale 起势（drone 1.0 倍）'
  })

  await check('浏览器：15 条循环素材的节点增益 = 逐条补偿（含 tape-hiss +10.2 / flag-flap -0.9）', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(() => {
      const api = window.__audio
      const beds = [
        'rain-light', 'rain-heavy', 'snow-wind', 'river',
        'crowd-whisper', 'room-tone', 'tape-hiss', 'flag-flap', 'radio-static',
      ]
      const drones = [
        'drone-ending-names', 'drone-ending-letters', 'drone-ending-flag',
        'drone-ending-photo', 'drone-ending-testimony', 'drone-ending-message',
      ]
      for (const id of beds) api.setAmbience(id)
      for (const id of drones) api.setDrone(id, 200)
      api.setAmbience(null)
      api.setDrone(null)
      return api.gains()
    }))
    const expected = {
      'rain-light': 0.4, 'rain-heavy': -0.9, 'snow-wind': 0, river: 0.1,
      'crowd-whisper': -0.6, 'room-tone': 3.2, 'tape-hiss': 10.2,
      'flag-flap': -0.9, 'radio-static': 6.2,
      'drone-ending-names': 0, 'drone-ending-letters': 0, 'drone-ending-flag': 0,
      'drone-ending-photo': 0, 'drone-ending-testimony': 0, 'drone-ending-message': 3,
    }
    for (const [id, trimDb] of Object.entries(expected)) {
      const want = Math.pow(10, trimDb / 20)
      const got = result[id]
      assert(got != null, `${id} 没有设定增益`)
      assert(
        Math.abs(got - want) / want < 1e-6,
        `${id} 增益 ${got?.toFixed(4)}，应为 ${want.toFixed(4)}（${trimDb >= 0 ? '+' : ''}${trimDb} dB）`,
      )
    }
    return '9 床 + 6 drone 全部匹配'
  })

  await check('浏览器：连续床 / drone 实测电平（AnalyzerNode 长时平均，目标 -36/-35 dBFS）', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(async () => {
      const api = window.__audio
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      // 长时平均：把每个短窗 RMS 换成能量再平均（低频 drone 的 43ms 窗方差很大）
      const meanDb = async (key, count = 20) => {
        let energy = 0
        for (let i = 0; i < count; i += 1) {
          await sleep(80)
          energy += Math.pow(10, api.levels()[key] / 10)
        }
        return Math.round(10 * Math.log10(energy / count) * 10) / 10
      }
      const beds = {}
      // tape-hiss / flag-flap 是稀疏纹理：几十毫秒窗会掉 5—12 dB，改由上面的增益断言保证
      for (const id of ['rain-light', 'rain-heavy', 'snow-wind', 'river', 'crowd-whisper', 'room-tone', 'radio-static']) {
        api.setAmbience(id)
        await sleep(800)
        beds[id] = await meanDb('ambience')
      }
      api.setAmbience(null)
      const drones = {}
      for (const id of [
        'drone-ending-names', 'drone-ending-letters', 'drone-ending-flag',
        'drone-ending-photo', 'drone-ending-testimony', 'drone-ending-message',
      ]) {
        api.setDrone(id, 200)
        await sleep(800)
        drones[id] = await meanDb('drone')
        api.setDrone(null)
        await sleep(300)
      }
      api.stopAudio()
      return { beds, drones }
    }))
    const bedValues = Object.values(result.beds)
    const droneValues = Object.values(result.drones)
    const summary = JSON.stringify(result)
    // 总线后的 analyser 目标：床 -36.1（-32 ref -4.1 bus）、drone -35.1（-34 ref -1.1 bus）
    const badBeds = Object.entries(result.beds).filter(([, value]) => !(value > -38.6 && value < -33.6))
    const badDrones = Object.entries(result.drones).filter(([, value]) => !(value > -39 && value < -32))
    assert(badBeds.length === 0, `床越界 ${JSON.stringify(badBeds)}；全部：${summary}`)
    assert(badDrones.length === 0, `drone 越界 ${JSON.stringify(badDrones)}；全部：${summary}`)
    const spread = (values) => Math.max(...values) - Math.min(...values)
    assert(spread(bedValues) < 4, `床落差 ${spread(bedValues).toFixed(1)} dB；全部：${summary}`)
    assert(spread(droneValues) < 4.5, `drone 落差 ${spread(droneValues).toFixed(1)} dB；全部：${summary}`)
    return `床 ${Math.min(...bedValues)}…${Math.max(...bedValues)} dBFS，drone ${Math.min(...droneValues)}…${Math.max(...droneValues)} dBFS`
  })

  await check('浏览器：静音后 master 归零，刷新仍静音', async () => {
    await ensureAudio()
    const result = await retry(() => page.evaluate(async () => {
      const api = window.__audio
      document.querySelector('.audio-toggle').click()
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { muted: api.isMuted(), master: api.levels().master }
    }))
    assert(result.muted === true, '没静音')
    assert(result.master < -60, `master 电平 ${result.master} dBFS，没有归零`)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const muted = await page.evaluate(() => window.__audio.isMuted())
    assert(muted === true, '刷新后不是静音')
    return `muted，master ${result.master.toFixed(0)} dBFS；刷新仍静音`
  })

  await check('浏览器：无控制台错误', () => {
    const relevant = errors.filter((text) => !/favicon|download the React DevTools/u.test(text))
    assert(relevant.length === 0, relevant.slice(0, 3).join(' | '))
    return '0'
  })

  await browser.close()
}

/* ── 入口 ───────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)
const staticOnly = argv.includes('--static')
const url = argv.find((arg) => arg.startsWith('http')) ?? DEFAULT_URL

if (!staticOnly) {
  console.log(`\n=== 浏览器检查：${url} ===`)
  await runBrowser(url).catch((error) => {
    failures.push('浏览器检查异常')
    console.log(`  FAIL  浏览器检查异常 — ${String(error).slice(0, 300)}`)
  })
}

const total = passed + failures.length
console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'}  ${passed}/${total} 断言通过`)
if (failures.length > 0) {
  console.log(`失败：${failures.join(' | ')}`)
  process.exitCode = 1
}
