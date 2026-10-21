import { AUDIO_IDS, AUDIO_MANIFEST, type AudioEntry } from './content/audioManifest'
import type { EndingKind, MemoryKind, Weather } from './types'

/**
 * 声音系统（Web Audio）· 扩展层
 *
 * 规格来源（唯一真源）：docs/audio/README.md
 * - 42 个事件的事件表 AUDIO_EVENT_MAP（每个事件 ≥1 条非空素材，28 条素材无死条）
 * - 四总线：master 0.900 / sfx 0.600 / ambience 0.625 / drone 0.882 / accent 0.279
 * - 逐条响度补偿：把清单里的交付 rms_dbfs 拉回组基准（床 -32 / drone -34）
 * - sfx 并联 0.5s 衰减噪声 IR 卷积混响（湿声 0.14，程序化生成，不加载额外文件）
 * - 床 1.2s 进 / 0.9s 出、drone 1.6s（终极画面 3.0s）、换场天气层 0.35—1.0s、点缀 1.2—2.2s
 * - 限流：同 id 70ms、事件 60ms、悬停 240ms、翻页 90ms、换场 400ms
 * - 软削波 tanh（拐点 -1 dBFS、oversample 2x），只当保险
 *
 * 设计约束（不变）：
 * - 默认静音：评审环境绝不自动出声；用户在菜单/场景页点「声音」才解锁；
 * - AudioContext 只在首次用户手势后创建（浏览器自动播放策略）；
 * - 同一时刻 ≤1 条 ambience 床 + ≤1 条 drone + ≤1 条点缀 + ≤1 条换场天气层；
 * - 页面隐藏时 suspend，回来 resume；
 * - 加载/解码失败一律静默降级，不影响叙事。
 *
 * 本文件在外部进程回滚后按 docs 重建，旧导出（unlockAudio/isMuted/setMuted/playSfx/
 * clickSoundFor/droneForEnding/ambienceForScene/ambienceForScreen/setAmbience/setDrone/
 * stopAudio/isAudioUnlocked）全部保留，App 与组件无需改动即可编译。
 */

const MUTE_KEY = 'names-audio-muted-v1'
const BASE = import.meta.env.BASE_URL ?? './'

/* ════════════════════════════════════════════════════════════════════
 * 一、混音常量（README §三）
 * ════════════════════════════════════════════════════════════════════ */

/** 四总线 + master 的固定增益 */
export const MIX = {
  master: 0.9, // -0.9 dB
  sfx: 0.6, // -4.4 dB
  ambience: 0.625, // -4.1 dB
  drone: 0.882, // -1.1 dB
  accent: 0.279, // -11.1 dB（比床低 7 dB）
} as const

/** 软削波：tanh 拐点 -1 dBFS、2x 过采样 */
const SOFT_CLIP_KNEE_DBFS = -1
const SOFT_CLIP_OVERSAMPLE: OverSampleType = '2x'

/** sfx 并联房间混响：0.5s 衰减噪声 IR，湿声 0.14 */
const IR_SECONDS = 0.5
const IR_DECAY = 2.6
const REVERB_WET = 0.14

/** 淡入淡出（秒 / 毫秒按命名区分） */
const BED_FADE_IN_MS = 1200
const BED_FADE_OUT_MS = 900
const DRONE_FADE_IN_MS = 1600
const DRONE_FADE_OUT_S = 1.2
const FINALE_FADE_IN_MS = 3000
const SLOT_CUT_S = 0.25
const TRANSITION_FADE_IN_MS = 700
const TRANSITION_FADE_OUT_MS = 900
const ACCENT_FADE_OUT_MS = 1200

/** 限流 */
const SAME_ID_THROTTLE_MS = 70
const DEFAULT_EVENT_THROTTLE_MS = 60
const HOVER_THROTTLE_MS = 240
const PAGE_TURN_THROTTLE_MS = 90
const TRANSITION_THROTTLE_MS = 400
const ACCENT_COOLDOWN_MS = 20_000

/** 组基准：清单里的交付 rms_dbfs 被拉回到这里，再交给总线推到目标电平 */
const BED_REF_DBFS = -32
const DRONE_REF_DBFS = -34

/* ════════════════════════════════════════════════════════════════════
 * 二、事件表（42 个事件）
 * ════════════════════════════════════════════════════════════════════ */

/** 总线通道：决定走哪条 bus、以及是否套用逐条电平补偿 */
export type AudioChannel = 'sfx' | 'ambience' | 'drone' | 'accent'

/**
 * 事件的一层：
 * - `volume` 是该层在本总线上的增益；循环层 1.0 = 该组基准电平（再乘逐条补偿）
 * - `channel` 省略时按素材分组推断（ambience→ambience、drone→drone，其余→sfx）
 * - `delayMs` 延迟起声；`maxMs` 单次音截断；`durationMs` 循环层的总时长（到点淡出停机）
 */
export type AudioLayer = {
  id: string
  volume: number
  channel?: AudioChannel
  delayMs?: number
  maxMs?: number
  durationMs?: number
  fadeInMs?: number
  fadeOutMs?: number
  loop?: boolean
}

export type TransitionVariant = 'ink' | 'rain' | 'snow' | 'ash' | 'smoke'

/** 42 个事件的联合类型；AUDIO_EVENT_MAP 必须完整覆盖（TS 会强制） */
export type AudioEvent =
  // 菜单 / UI（16）
  | 'menu:enter'
  | 'menu:click'
  | 'ui:hover'
  | 'ui:click'
  | 'ui:back'
  | 'ui:3d:on'
  | 'ui:3d:off'
  | 'ui:source:open'
  | 'ui:source:close'
  | 'ui:gallery'
  | 'ui:sources'
  | 'ui:people'
  | 'ui:later'
  | 'ui:person:open'
  | 'ui:later:open'
  | 'ui:audio:on'
  // 正文与换场（10）
  | 'page:advance'
  | 'carrier:roster'
  | 'carrier:letters'
  | 'carrier:flag'
  | 'carrier:photo'
  | 'carrier:testimony'
  | 'carrier:message'
  | 'carrier:archive'
  | 'carrier:relics'
  | 'carrier:wordofmouth'
  // 五天气换场（5）
  | 'transition:ink'
  | 'transition:rain'
  | 'transition:snow'
  | 'transition:ash'
  | 'transition:smoke'
  // 结局（3）
  | 'ending:enter'
  | 'ending:finale:start'
  | 'ending:finale:end'
  // 环境点缀（8）
  | 'accent:radio'
  | 'accent:flag'
  | 'accent:crowd'
  | 'accent:thud'
  | 'accent:steps'
  | 'accent:match'
  | 'accent:ink'
  | 'accent:pen'

/**
 * 42 个事件 → 素材层。与 docs/audio/README.md §二 的映射表逐行对应。
 * 素材 id 必须存在于 AUDIO_MANIFEST（28 条），且 28 条素材都必须被引用到。
 */
export const AUDIO_EVENT_MAP: Record<AudioEvent, AudioLayer[]> = {
  /* ── 菜单 / UI ───────────────────────────────────────────────── */
  'menu:enter': [{ id: 'paper', volume: 0.5 }],
  'menu:click': [{ id: 'paper', volume: 0.65 }],
  /** 悬停：只取 ink 前 120ms @0.09，240ms 限流，只在鼠标 */
  'ui:hover': [{ id: 'ink', volume: 0.09, maxMs: 120 }],
  'ui:click': [{ id: 'paper', volume: 0.55 }],
  'ui:back': [{ id: 'page-turn', volume: 0.4 }],
  /** 切 3D：墨 + 火柴，火柴晚 70ms */
  'ui:3d:on': [
    { id: 'ink', volume: 0.5 },
    { id: 'match', volume: 0.16, delayMs: 70 },
  ],
  'ui:3d:off': [{ id: 'paper', volume: 0.5 }],
  'ui:source:open': [{ id: 'click-letters', volume: 0.55 }],
  /** 关史料卡（含 Esc）：墨截到 320ms */
  'ui:source:close': [{ id: 'ink', volume: 0.4, maxMs: 320 }],
  'ui:gallery': [{ id: 'page-turn', volume: 0.4 }],
  'ui:sources': [{ id: 'page-turn', volume: 0.42 }],
  'ui:people': [{ id: 'page-turn', volume: 0.44 }],
  'ui:later': [{ id: 'page-turn', volume: 0.45 }],
  'ui:person:open': [{ id: 'click-letters', volume: 0.4 }],
  'ui:later:open': [{ id: 'click-letters', volume: 0.4 }],
  'ui:audio:on': [{ id: 'paper', volume: 0.5 }],

  /* ── 正文与载体 ──────────────────────────────────────────────── */
  'page:advance': [{ id: 'page-turn', volume: 0.75 }],
  'carrier:roster': [{ id: 'click-roster', volume: 1 }],
  'carrier:letters': [{ id: 'click-letters', volume: 1 }],
  'carrier:flag': [{ id: 'click-flag', volume: 1 }],
  'carrier:photo': [{ id: 'click-photo', volume: 1 }],
  'carrier:testimony': [{ id: 'click-testimony', volume: 1 }],
  'carrier:message': [{ id: 'click-message', volume: 1 }],
  /** 合成结局载体：主载体 0.85 + 副载体 0.45—0.55（两层同响） */
  'carrier:archive': [
    { id: 'click-roster', volume: 0.85 },
    { id: 'click-testimony', volume: 0.45 },
  ],
  'carrier:relics': [
    { id: 'click-letters', volume: 0.85 },
    { id: 'click-photo', volume: 0.55 },
  ],
  'carrier:wordofmouth': [
    { id: 'click-flag', volume: 0.85 },
    { id: 'click-message', volume: 0.5 },
  ],

  /* ── 五天气换场（幕 = 低频 distant-thud + 天气层，天气层跟 InkCurtain 的 variant 走） ── */
  /** 墨（无天气）：低频 + 纸，纸晚 90ms */
  'transition:ink': [
    { id: 'distant-thud', volume: 0.5 },
    { id: 'paper', volume: 0.45, delayMs: 90 },
  ],
  'transition:rain': [
    { id: 'distant-thud', volume: 0.42 },
    {
      id: 'rain-light',
      volume: 1.1,
      channel: 'ambience',
      durationMs: 2400,
      fadeInMs: 700,
      fadeOutMs: 1000,
    },
  ],
  'transition:snow': [
    { id: 'distant-thud', volume: 0.4 },
    {
      id: 'snow-wind',
      volume: 1.15,
      channel: 'ambience',
      durationMs: 2600,
      fadeInMs: 800,
      fadeOutMs: 1000,
    },
  ],
  'transition:ash': [
    { id: 'distant-thud', volume: 0.5 },
    {
      id: 'radio-static',
      volume: 1.2,
      channel: 'ambience',
      durationMs: 2200,
      fadeInMs: 350,
      fadeOutMs: 900,
    },
  ],
  'transition:smoke': [
    { id: 'distant-thud', volume: 0.45 },
    {
      id: 'crowd-whisper',
      volume: 0.95,
      channel: 'ambience',
      durationMs: 2400,
      fadeInMs: 900,
      fadeOutMs: 900,
    },
  ],

  /* ── 结局 ────────────────────────────────────────────────────── */
  'ending:enter': [
    { id: 'paper', volume: 0.45 },
    { id: 'ink', volume: 0.25 },
  ],
  /** 终极画面起势：低频 + 纸；drone 2.8s 涨到 1.0 倍（playEvent 触发 rampDrone） */
  'ending:finale:start': [
    { id: 'distant-thud', volume: 0.32 },
    { id: 'paper', volume: 0.4 },
  ],
  /** 终极画面收束：纸；drone 1.8s 落到 0.82 倍 */
  'ending:finale:end': [{ id: 'paper', volume: 0.3 }],

  /* ── 环境点缀（只在特定的夜出现，见 ACCENT_RULES） ──────────────── */
  'accent:radio': [
    {
      id: 'radio-static',
      volume: 0.9,
      channel: 'accent',
      durationMs: 9000,
      fadeInMs: 1800,
      fadeOutMs: ACCENT_FADE_OUT_MS,
    },
    {
      id: 'tape-hiss',
      volume: 0.55,
      channel: 'accent',
      durationMs: 9000,
      fadeInMs: 1800,
      fadeOutMs: ACCENT_FADE_OUT_MS,
    },
  ],
  'accent:flag': [
    {
      id: 'flag-flap',
      volume: 1,
      channel: 'accent',
      durationMs: 8000,
      fadeInMs: 1200,
      fadeOutMs: ACCENT_FADE_OUT_MS,
    },
  ],
  'accent:crowd': [
    {
      id: 'crowd-whisper',
      volume: 1,
      channel: 'accent',
      durationMs: 10000,
      fadeInMs: 1800,
      fadeOutMs: ACCENT_FADE_OUT_MS,
    },
  ],
  'accent:thud': [{ id: 'distant-thud', volume: 0.45, channel: 'accent' }],
  'accent:steps': [{ id: 'footsteps', volume: 0.5, channel: 'accent' }],
  'accent:match': [{ id: 'match', volume: 0.4, channel: 'accent' }],
  'accent:ink': [{ id: 'ink', volume: 0.35, channel: 'accent', maxMs: 500 }],
  'accent:pen': [{ id: 'pen', volume: 0.4, channel: 'accent' }],
}

/** 事件名数组（顺序 = 表内顺序，共 42 条） */
export const AUDIO_EVENT_NAMES = Object.keys(AUDIO_EVENT_MAP) as AudioEvent[]

const EVENT_SET = new Set<string>(AUDIO_EVENT_NAMES)

export function isAudioEvent(value: string): value is AudioEvent {
  return EVENT_SET.has(value)
}

/** 换场事件按 variant 的固定顺序 */
export const TRANSITION_VARIANTS: TransitionVariant[] = ['ink', 'rain', 'snow', 'ash', 'smoke']

/** 事件级限流（同 id 的 70ms 另算） */
const EVENT_THROTTLE_MS: Partial<Record<AudioEvent, number>> = {
  'ui:hover': HOVER_THROTTLE_MS,
  'page:advance': PAGE_TURN_THROTTLE_MS,
  'transition:ink': TRANSITION_THROTTLE_MS,
  'transition:rain': TRANSITION_THROTTLE_MS,
  'transition:snow': TRANSITION_THROTTLE_MS,
  'transition:ash': TRANSITION_THROTTLE_MS,
  'transition:smoke': TRANSITION_THROTTLE_MS,
}

/* ════════════════════════════════════════════════════════════════════
 * 三、点缀规则（README §二「环境点缀」）
 * ════════════════════════════════════════════════════════════════════ */

export type AccentEvent =
  | 'accent:radio'
  | 'accent:flag'
  | 'accent:crowd'
  | 'accent:thud'
  | 'accent:steps'
  | 'accent:match'
  | 'accent:ink'
  | 'accent:pen'

export type AccentRule = {
  event: AccentEvent
  /** 先命中先用 */
  pattern: RegExp
  /** 关键词清单（报告/测试用，与 pattern 同源） */
  keywords: string[]
}

/** 顺序即优先级：录音 → 旗 → 河 → 炮 → 脚步 → 灯 → 墨 → 笔 */
export const ACCENT_RULES: AccentRule[] = [
  {
    event: 'accent:radio',
    keywords: ['录音', '口述', '磁带', '收音', '短波', '广播', 'A-017'],
    pattern: /录音|口述|磁带|收音|短波|广播|a-?017/i,
  },
  {
    event: 'accent:flag',
    keywords: ['升旗', '旗', '楼顶', '屋顶'],
    pattern: /升旗|旗|楼顶|屋顶/,
  },
  {
    event: 'accent:crowd',
    keywords: ['河', '桥', '渡', '苏州', '对岸', '租界'],
    pattern: /河|桥|渡|苏州|对岸|租界/,
  },
  {
    event: 'accent:thud',
    keywords: ['炮', '枪', '轰', '震', '闷响', '墙外', '爆炸', '射击'],
    pattern: /炮|枪|轰|震|闷响|墙外|爆炸|射击/,
  },
  {
    event: 'accent:steps',
    keywords: ['走廊', '楼梯', '巡', '脚步', '走过', '岗哨'],
    pattern: /走廊|楼梯|巡|脚步|走过|岗哨/,
  },
  {
    event: 'accent:match',
    keywords: ['煤油灯', '火柴', '点灯', '灯芯', '火光', '烧'],
    pattern: /煤油灯|火柴|点灯|灯芯|火光|烧/,
  },
  {
    event: 'accent:ink',
    keywords: ['蘸墨', '研墨', '砚', '墨'],
    pattern: /蘸墨|研墨|砚|墨/,
  },
  {
    event: 'accent:pen',
    keywords: ['写名字', '记名字', '记下名字', '抄名', '登记', '造册', '录名', '名单'],
    pattern: /写名字|记名字|记下名字|抄名|登记|造册|录名|名单/,
  },
]

/* ════════════════════════════════════════════════════════════════════
 * 四、逐条电平补偿（README §三）
 * 数值来自 docs/audio/audit-loudness.json 的 trims_db（与 README 表一致）：
 * 床基准 -32 dBFS、drone 基准 -34 dBFS，交付实测 rms 与基准的差就是补偿量。
 * 八条床原来 11.1 dB 的落差因此归零；单次音不动增益（只补 -0.9 dB 母线）。
 * ════════════════════════════════════════════════════════════════════ */

const LEVEL_TRIM_DB: Record<string, number> = {
  /* ambience 床与纹理（基准 -32 dBFS） */
  'rain-light': 0.4,
  'rain-heavy': -0.9,
  'snow-wind': 0,
  river: 0.1,
  'crowd-whisper': -0.6,
  'room-tone': 3.2,
  'flag-flap': -0.9,
  'radio-static': 6.2,
  'tape-hiss': 10.2,
  /* 结局 drone（基准 -34 dBFS） */
  'drone-ending-names': 0,
  'drone-ending-letters': 0,
  'drone-ending-flag': 0,
  'drone-ending-photo': 0,
  'drone-ending-testimony': 0,
  'drone-ending-message': 3,
}

/** 某条素材的补偿量（dB）。表里没有的（单次音）返回 0 */
export function levelTrimDb(id: string): number {
  const known = LEVEL_TRIM_DB[id]
  if (known !== undefined) return known
  const meta = entry(id)
  if (!meta) return 0
  // 兜底：清单若带实测 rmsDbfs（build-audio-manifest.mjs 的新版字段），按组基准反推
  const measured = (meta as AudioEntry & { rmsDbfs?: number }).rmsDbfs
  if (typeof measured === 'number' && Number.isFinite(measured)) {
    return (meta.group === 'drone' ? DRONE_REF_DBFS : BED_REF_DBFS) - measured
  }
  return 0
}

/** 某条素材的补偿线性倍数 */
export function levelTrim(id: string): number {
  return Math.pow(10, levelTrimDb(id) / 20)
}

/** 层的最终增益：循环层（ambience / drone）套逐条补偿，单次音不套 */
function layerGain(id: string, volume: number): number {
  const meta = entry(id)
  if (!meta) return volume
  const trimmed = meta.group === 'ambience' || meta.group === 'drone'
  return trimmed ? volume * levelTrim(id) : volume
}

/* ════════════════════════════════════════════════════════════════════
 * 五、运行时状态
 * ════════════════════════════════════════════════════════════════════ */

type LoopHandle = { node: AudioBufferSourceNode; gain: GainNode }
type SlotName = 'transition' | 'accent'
type Slot = { token: number; handle: LoopHandle | null; until: number }

let ctx: AudioContext | null = null
let master: GainNode | null = null
let softClip: WaveShaperNode | null = null
let sfxBus: GainNode | null = null
let ambienceBus: GainNode | null = null
let droneBus: GainNode | null = null
let accentBus: GainNode | null = null
let reverb: ConvolverNode | null = null
let reverbGain: GainNode | null = null
let mixAnalyser: AnalyserNode | null = null
let ambienceAnalyser: AnalyserNode | null = null
let droneAnalyser: AnalyserNode | null = null
let accentAnalyser: AnalyserNode | null = null

const buffers = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer | null>>()
const lastPlayed = new Map<string, number>()
const lastEventAt = new Map<string, number>()
const activeOneShots = new Set<AudioBufferSourceNode>()
/** 每条循环素材最后一次设定的目标增益（探针用：可直接核对逐条补偿） */
const appliedGains = new Map<string, number>()

let ambienceId: string | null = null
let ambienceHandle: LoopHandle | null = null
let ambienceToken = 0
let droneId: string | null = null
let droneHandle: LoopHandle | null = null
let droneToken = 0
let droneFactor = 1
let droneTrim = 1
let unlocked = false

const slots: Record<SlotName, Slot> = {
  transition: { token: 0, handle: null, until: 0 },
  accent: { token: 0, handle: null, until: 0 },
}

let lastAccentAt = 0
const lastAccentById = new Map<AccentEvent, number>()

type PlayLogEntry = { event: string; at: number; layers: string[] }
const playLog: PlayLogEntry[] = []

function readMuted(): boolean {
  try {
    const raw = localStorage.getItem(MUTE_KEY)
    // 默认静音：只有显式存了 '0' 才是有声
    return raw !== '0'
  } catch {
    return true
  }
}

let muted = readMuted()

function entry(id: string): AudioEntry | null {
  return AUDIO_MANIFEST[id] ?? null
}

function defaultChannel(meta: AudioEntry): AudioChannel {
  if (meta.group === 'ambience') return 'ambience'
  if (meta.group === 'drone') return 'drone'
  return 'sfx'
}

function busFor(channel: AudioChannel): GainNode | null {
  if (channel === 'sfx') return sfxBus
  if (channel === 'ambience') return ambienceBus
  if (channel === 'drone') return droneBus
  return accentBus
}

/** 确定性哈希（FNV-1a 32bit）：同一场景结果固定 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/* ════════════════════════════════════════════════════════════════════
 * 六、音频图：master → 软削波 → destination，四条子总线
 * ════════════════════════════════════════════════════════════════════ */

/** tanh 软削波曲线：-1 dBFS 以下线性，以上软限幅（0 dBFS 输入 → 约 -0.23 dBFS 输出） */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const knee = Math.pow(10, SOFT_CLIP_KNEE_DBFS / 20)
  const room = 1 - knee
  const size = 4097
  const curve = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    const level = Math.abs(x)
    const shaped = level <= knee ? level : knee + room * Math.tanh((level - knee) / room)
    curve[i] = Math.sign(x) * shaped
  }
  return curve
}

/** 程序化生成 0.5s 衰减噪声 IR（立体声，不加载额外文件） */
function buildRoomImpulse(context: AudioContext): AudioBuffer {
  const rate = context.sampleRate
  const length = Math.max(1, Math.round(rate * IR_SECONDS))
  const impulse = context.createBuffer(2, length, rate)
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel)
    let state = (0x9e3779b9 ^ ((channel + 1) * 0x85ebca6b)) >>> 0
    for (let i = 0; i < length; i += 1) {
      // xorshift32 → 白噪声（确定性，同一台机器每次 IR 一致）
      state ^= state << 13
      state >>>= 0
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      const noise = (state / 0xffffffff) * 2 - 1
      const t = i / length
      data[i] = noise * Math.pow(1 - t, IR_DECAY)
    }
  }
  return impulse
}

function createGraph(context: AudioContext) {
  ctx = context

  master = context.createGain()
  master.gain.value = muted ? 0 : MIX.master
  softClip = context.createWaveShaper()
  softClip.curve = softClipCurve()
  softClip.oversample = SOFT_CLIP_OVERSAMPLE
  mixAnalyser = context.createAnalyser()
  mixAnalyser.fftSize = 2048
  master.connect(softClip)
  softClip.connect(mixAnalyser)
  mixAnalyser.connect(context.destination)

  // sfx：干声直达 master，另并联一条卷积混响（湿声 0.14）
  sfxBus = context.createGain()
  sfxBus.gain.value = MIX.sfx
  sfxBus.connect(master)
  reverb = context.createConvolver()
  reverb.normalize = true
  reverb.buffer = buildRoomImpulse(context)
  reverbGain = context.createGain()
  reverbGain.gain.value = REVERB_WET
  sfxBus.connect(reverb)
  reverb.connect(reverbGain)
  reverbGain.connect(master)

  ambienceBus = context.createGain()
  ambienceBus.gain.value = MIX.ambience
  ambienceAnalyser = context.createAnalyser()
  ambienceAnalyser.fftSize = 2048
  ambienceBus.connect(ambienceAnalyser)
  ambienceAnalyser.connect(master)

  droneBus = context.createGain()
  droneBus.gain.value = MIX.drone
  droneAnalyser = context.createAnalyser()
  droneAnalyser.fftSize = 2048
  droneBus.connect(droneAnalyser)
  droneAnalyser.connect(master)

  accentBus = context.createGain()
  accentBus.gain.value = MIX.accent
  accentAnalyser = context.createAnalyser()
  accentAnalyser.fftSize = 2048
  accentBus.connect(accentAnalyser)
  accentAnalyser.connect(master)
}

const WARM_IDS = [
  'click-roster',
  'click-letters',
  'click-flag',
  'click-photo',
  'click-testimony',
  'click-message',
  'page-turn',
  'paper',
  'pen',
  'ink',
  'match',
  'footsteps',
  'distant-thud',
]

/** 在用户手势里调用：创建/恢复 AudioContext，开始预加载常用短音 */
export function unlockAudio(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    unlocked = true
    return Promise.resolve()
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return Promise.resolve()
    const context = new Ctor()
    createGraph(context)
    unlocked = true
    document.addEventListener('visibilitychange', onVisibility)
    // 预加载：点击音 + 翻页/纸/笔/墨/火柴/脚步/闷响（小文件，第一次就要用）
    for (const id of WARM_IDS) void load(id)
    return context.state === 'suspended' ? context.resume() : Promise.resolve()
  } catch {
    ctx = null
    return Promise.resolve()
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked && ctx !== null
}

export function isMuted(): boolean {
  return muted
}

function applyMasterGain(immediate = false) {
  if (!master || !ctx) return
  const now = ctx.currentTime
  const value = muted ? 0 : MIX.master
  master.gain.cancelScheduledValues(now)
  if (immediate) master.gain.setValueAtTime(value, now)
  else master.gain.linearRampToValueAtTime(value, now + 0.4)
}

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (next) {
    // 立刻静音；保留循环节点，取消静音时继续原来的位置
    applyMasterGain(true)
  } else {
    applyMasterGain(true)
    void ctx?.resume()
  }
}

/* ════════════════════════════════════════════════════════════════════
 * 七、加载与播放原语
 * ════════════════════════════════════════════════════════════════════ */

async function load(id: string): Promise<AudioBuffer | null> {
  if (!ctx) return null
  const cached = buffers.get(id)
  if (cached) return cached
  const inflight = pending.get(id)
  if (inflight) return inflight
  const meta = entry(id)
  if (!meta) return null
  const job = (async () => {
    try {
      const url = `${BASE}${meta.file.replace(/^\.?\//u, '')}`
      const response = await fetch(url)
      if (!response.ok) return null
      const arrayBuffer = await response.arrayBuffer()
      const decoded = await ctx!.decodeAudioData(arrayBuffer)
      buffers.set(id, decoded)
      return decoded
    } catch {
      return null
    } finally {
      pending.delete(id)
    }
  })()
  pending.set(id, job)
  return job
}

function fadeLoopOut(handle: LoopHandle | null, seconds: number) {
  if (!handle || !ctx) return
  try {
    const now = ctx.currentTime
    const current = Math.max(0, handle.gain.gain.value)
    handle.gain.gain.cancelScheduledValues(now)
    handle.gain.gain.setValueAtTime(current, now)
    handle.gain.gain.linearRampToValueAtTime(0, now + seconds)
    handle.node.stop(now + seconds + 0.05)
  } catch {
    /* ignore */
  }
}

function claimSlot(name: SlotName, fadeOut: number): number {
  const slot = slots[name]
  const token = slot.token + 1
  slot.token = token
  fadeLoopOut(slot.handle, fadeOut)
  slot.handle = null
  slot.until = 0
  return token
}

/** 起一条循环层：淡入 → （可选）保持 → 淡出停机 */
function startLoopLayer(options: {
  id: string
  bus: GainNode
  gain: number
  fadeInMs: number
  fadeOutMs?: number
  durationMs?: number
  delayMs?: number
  isCancelled?: () => boolean
  onStarted?: (handle: LoopHandle) => void
}) {
  if (!ctx) return
  const meta = entry(options.id)
  if (!meta) return
  appliedGains.set(options.id, options.gain)
  const context = ctx
  const startAt = context.currentTime + (options.delayMs ?? 0) / 1000
  void load(options.id).then((buffer) => {
    if (!buffer || ctx !== context) return
    if (options.isCancelled?.()) return
    try {
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = context.createGain()
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(options.bus)
      source.start(startAt)

      const target = options.gain
      const fadeIn = Math.max(0.01, options.fadeInMs / 1000)
      gain.gain.setValueAtTime(0, startAt)
      gain.gain.linearRampToValueAtTime(target, startAt + fadeIn)

      const durationMs = options.durationMs
      if (durationMs != null) {
        const fadeOut = Math.max(0.05, (options.fadeOutMs ?? 900) / 1000)
        const endAt = startAt + Math.max(durationMs / 1000, fadeIn + fadeOut + 0.05)
        gain.gain.setValueAtTime(target, endAt - fadeOut)
        gain.gain.linearRampToValueAtTime(0, endAt)
        source.stop(endAt + 0.05)
      }
      options.onStarted?.({ node: source, gain })
    } catch {
      /* ignore */
    }
  })
}

/** 起一条单次音：同 id 70ms 限流；maxMs 截断（悬停 tick / 短墨声） */
function startOneShot(options: {
  id: string
  bus: GainNode
  gain: number
  delayMs?: number
  maxMs?: number
}): boolean {
  if (!ctx) return false
  const meta = entry(options.id)
  if (!meta) return false
  const nowMs = Date.now()
  const last = lastPlayed.get(options.id) ?? 0
  if (nowMs - last < SAME_ID_THROTTLE_MS) return false
  lastPlayed.set(options.id, nowMs)

  const context = ctx
  const startAt = context.currentTime + (options.delayMs ?? 0) / 1000
  void load(options.id).then((buffer) => {
    if (!buffer || ctx !== context) return
    try {
      const source = context.createBufferSource()
      source.buffer = buffer
      const gain = context.createGain()
      const at = Math.max(context.currentTime + 0.005, startAt)
      source.connect(gain)
      gain.connect(options.bus)
      gain.gain.value = options.gain
      if (options.maxMs != null) {
        // 截断：留 40ms 淡出，避免硬切出「咔」
        const hold = Math.max(0.06, options.maxMs / 1000)
        gain.gain.setValueAtTime(options.gain, at)
        gain.gain.setValueAtTime(options.gain, at + Math.max(0.01, hold - 0.04))
        gain.gain.linearRampToValueAtTime(0.0001, at + hold)
        source.start(at)
        source.stop(at + hold + 0.02)
      } else {
        source.start(at)
      }
      activeOneShots.add(source)
      source.onended = () => activeOneShots.delete(source)
    } catch {
      /* ignore */
    }
  })
  return true
}

/* ════════════════════════════════════════════════════════════════════
 * 八、事件播放（App 只调这里）
 * ════════════════════════════════════════════════════════════════════ */

function layerDurationMs(layer: AudioLayer): number {
  const meta = entry(layer.id)
  const natural = Math.round((meta?.duration ?? 1) * 1000)
  const span = layer.durationMs ?? natural
  return layer.maxMs != null ? Math.min(span, layer.maxMs) : span
}

function startLayer(
  layer: AudioLayer,
  hooks: { isCancelled?: () => boolean; onStarted?: (handle: LoopHandle) => void } = {},
) {
  if (!ctx) return
  const meta = entry(layer.id)
  if (!meta) return
  const channel = layer.channel ?? defaultChannel(meta)
  const bus = busFor(channel)
  if (!bus) return
  const gain = layerGain(layer.id, layer.volume)
  const loop = layer.loop ?? meta.loop
  if (loop) {
    startLoopLayer({
      id: layer.id,
      bus,
      gain,
      fadeInMs: layer.fadeInMs ?? 1200,
      fadeOutMs: layer.fadeOutMs ?? 900,
      durationMs: layer.durationMs,
      delayMs: layer.delayMs,
      isCancelled: hooks.isCancelled,
      onStarted: hooks.onStarted,
    })
    return
  }
  startOneShot({ id: layer.id, bus, gain, maxMs: layer.maxMs, delayMs: layer.delayMs })
}

/**
 * 播放一个事件（42 个之一）。返回是否真的发声（限流/静音/未知事件返回 false）。
 *
 * - 事件级限流：默认 60ms，悬停 240ms、翻页 90ms、换场 400ms
 * - 点缀 / 换场各占一个单槽：新的一条进来先把上一条 250ms 收掉
 * - `ending:finale:start` / `ending:finale:end` 自带 drone 包络（2.8s 涨到 1.0 / 1.8s 落到 0.82）
 */
export function playEvent(event: AudioEvent): boolean
export function playEvent(event: string): boolean
export function playEvent(event: string): boolean {
  if (!isAudioEvent(event)) return false
  if (!ctx || muted) return false
  const layers = AUDIO_EVENT_MAP[event]
  if (!layers || layers.length === 0) return false

  const now = Date.now()
  const throttle = EVENT_THROTTLE_MS[event] ?? DEFAULT_EVENT_THROTTLE_MS
  if (now - (lastEventAt.get(event) ?? 0) < throttle) return false
  lastEventAt.set(event, now)

  let slotName: SlotName | null = null
  if (event.startsWith('accent:')) slotName = 'accent'
  else if (event.startsWith('transition:')) slotName = 'transition'

  let token = 0
  if (slotName) {
    token = claimSlot(slotName, SLOT_CUT_S)
    let until = now
    for (const layer of layers) {
      until = Math.max(until, now + (layer.delayMs ?? 0) + layerDurationMs(layer))
    }
    slots[slotName].until = until
  }

  const hooks: {
    isCancelled?: () => boolean
    onStarted?: (handle: LoopHandle) => void
  } = {}
  if (slotName) {
    const name = slotName
    hooks.isCancelled = () => slots[name].token !== token
    hooks.onStarted = (handle) => {
      if (slots[name].token === token) slots[name].handle = handle
    }
  }
  for (const layer of layers) startLayer(layer, hooks)

  // 结局终极画面：复用现有 drone 的增益包络，没有新建素材
  if (event === 'ending:finale:start') rampDrone(1, 2800)
  if (event === 'ending:finale:end') rampDrone(0.82, 1800)

  playLog.push({ event, at: now, layers: layers.map((layer) => layer.id) })
  if (playLog.length > 80) playLog.shift()
  return true
}

/** 换场幕声：低频 + 跟 InkCurtain variant 一一对应的天气层 */
export function playTransition(variant: TransitionVariant): boolean {
  return playEvent(`transition:${variant}`)
}

/** 记忆载体 / 合成结局 → 事件名（App 点选项时用） */
export function carrierEvent(kind: EndingKind | MemoryKind): AudioEvent {
  const map: Record<string, AudioEvent> = {
    roster: 'carrier:roster',
    letters: 'carrier:letters',
    flag: 'carrier:flag',
    photo: 'carrier:photo',
    testimony: 'carrier:testimony',
    message: 'carrier:message',
    archive: 'carrier:archive',
    relics: 'carrier:relics',
    wordofmouth: 'carrier:wordofmouth',
  }
  return map[kind] ?? 'carrier:roster'
}

/** 页面 → 进入音（App 切页面时用） */
export function uiEventForScreen(screen: string): AudioEvent | null {
  if (screen === 'menu') return 'menu:enter'
  if (screen === 'gallery') return 'ui:gallery'
  if (screen === 'sources') return 'ui:sources'
  if (screen === 'people') return 'ui:people'
  if (screen === 'later') return 'ui:later'
  return null
}

/* ════════════════════════════════════════════════════════════════════
 * 九、环境点缀引擎（关键词 + 确定性 1/3 + 20s 冷却 + 单槽）
 * ════════════════════════════════════════════════════════════════════ */

/** 规则命中（纯函数，不含任何闸门）：返回点缀事件 id 或 null */
export function accentForScene(text: string): AccentEvent | null {
  if (!text) return null
  const normalized = text.replace(/\s+/gu, '')
  for (const rule of ACCENT_RULES) {
    if (rule.pattern.test(normalized)) return rule.event
  }
  return null
}

/** 确定性闸门：同一场景同一事件结果固定（1/3 命中） */
export function accentGate(sceneId: string, event: AccentEvent): boolean {
  return hashString(`${sceneId}:${event}`) % 3 === 0
}

/**
 * 按场景文本决定这一场要不要出声点缀。
 * 三道闸门：确定性 1/3 → 20s 冷却（全局 + 同 id）→ 单槽占用。
 * 返回命中的点缀 id，被闸门挡掉返回 null。
 */
export function playAccentForScene(sceneId: string, text: string): AccentEvent | null {
  if (!ctx || muted) return null
  const event = accentForScene(text)
  if (!event) return null
  if (!accentGate(sceneId, event)) return null
  const now = Date.now()
  if (now - lastAccentAt < ACCENT_COOLDOWN_MS) return null
  if (now - (lastAccentById.get(event) ?? 0) < ACCENT_COOLDOWN_MS) return null
  if (slots.accent.until > now) return null
  if (!playEvent(event)) return null
  lastAccentAt = now
  lastAccentById.set(event, now)
  return event
}

/* ════════════════════════════════════════════════════════════════════
 * 十、单次音（旧 API）、环境床、结局 drone
 * ════════════════════════════════════════════════════════════════════ */

export type PlaySfxOptions = { volume?: number; maxMs?: number; delayMs?: number }

/** 单次音效：点击载体、翻页等（旧 API，保持可用） */
export function playSfx(id: string, options: PlaySfxOptions = {}): boolean {
  if (!ctx || muted || !sfxBus) return false
  return startOneShot({
    id,
    bus: sfxBus,
    gain: options.volume ?? 1,
    maxMs: options.maxMs,
    delayMs: options.delayMs,
  })
}

/** 场景环境声：同一时刻只保留一条循环床，1.2s 进 / 0.9s 出 */
export function setAmbience(
  id: string | null,
  options: { fadeInMs?: number; fadeOutMs?: number } = {},
) {
  if (!ctx || !ambienceBus) return
  if (ambienceId === id) return
  ambienceId = id
  const token = ambienceToken + 1
  ambienceToken = token
  fadeLoopOut(ambienceHandle, (options.fadeOutMs ?? BED_FADE_OUT_MS) / 1000)
  ambienceHandle = null
  if (!id) return
  const meta = entry(id)
  if (!meta) {
    ambienceId = null
    return
  }
  startLoopLayer({
    id,
    bus: ambienceBus,
    gain: layerGain(id, 1),
    fadeInMs: options.fadeInMs ?? BED_FADE_IN_MS,
    isCancelled: () => token !== ambienceToken,
    onStarted: (handle) => {
      if (token === ambienceToken) ambienceHandle = handle
    },
  })
}

export type DroneOptions = { fadeInMs?: number; factor?: number }

/** 结局低音 drone：与 ambience 走不同总线，可以叠加；默认 1.6s 淡入 */
export function setDrone(id: string | null, options: DroneOptions = {}) {
  if (!ctx || !droneBus) return
  if (droneId === id) {
    // 同一条 drone：只动包络（终极画面正常走 rampDrone，这里兜底）
    if (id && options.factor != null) {
      rampDrone(options.factor, options.fadeInMs ?? DRONE_FADE_IN_MS)
    }
    return
  }
  droneId = id
  const token = droneToken + 1
  droneToken = token
  fadeLoopOut(droneHandle, DRONE_FADE_OUT_S)
  droneHandle = null
  if (!id) return
  const meta = entry(id)
  if (!meta) {
    droneId = null
    return
  }
  droneFactor = options.factor ?? 1
  droneTrim = layerGain(id, 1)
  startLoopLayer({
    id,
    bus: droneBus,
    gain: droneTrim * droneFactor,
    fadeInMs: options.fadeInMs ?? DRONE_FADE_IN_MS,
    isCancelled: () => token !== droneToken,
    onStarted: (handle) => {
      if (token === droneToken) droneHandle = handle
    },
  })
}

/**
 * drone 包络：把当前 drone 的增益乘到 `factor` 倍（1.0 = 该 drone 的基准电平，
 * 已含逐条补偿，所以六条结局的起势幅度一致）。没有 drone 在播时只记录，等下次 setDrone 生效。
 */
export function rampDrone(factor: number, ms = 2000) {
  droneFactor = Math.max(0, Math.min(2, factor))
  if (!ctx || !droneHandle) return
  const param = droneHandle.gain.gain
  const now = ctx.currentTime
  const target = Math.max(0.0001, droneTrim * droneFactor)
  param.cancelScheduledValues(now)
  param.setValueAtTime(Math.max(0.0001, param.value), now)
  param.linearRampToValueAtTime(target, now + Math.max(0.05, ms / 1000))
}

/** 终极画面期间的 drone 淡入时长（README：结局页 1.6s，终极画面在播时 3.0s） */
export const DRONE_FINALE_FADE_IN_MS = FINALE_FADE_IN_MS

export function stopAudio() {
  setAmbience(null)
  setDrone(null)
  claimSlot('transition', SLOT_CUT_S)
  claimSlot('accent', SLOT_CUT_S)
  ambienceId = null
  droneId = null
}

/* ════════════════════════════════════════════════════════════════════
 * 十一、页面可见性、旧映射函数
 * ════════════════════════════════════════════════════════════════════ */

function onVisibility() {
  if (!ctx) return
  if (document.hidden) void ctx.suspend()
  else if (!muted) void ctx.resume()
}

/** 记忆载体 → 点击音 id；合成结局映射到主载体（旧 API，保持可用） */
export function clickSoundFor(kind: EndingKind | MemoryKind | 'quiet' | 'continue'): string {
  if (kind === 'continue') return 'page-turn'
  if (kind === 'quiet') return 'paper'
  const map: Record<string, string> = {
    roster: 'click-roster',
    letters: 'click-letters',
    flag: 'click-flag',
    photo: 'click-photo',
    testimony: 'click-testimony',
    message: 'click-message',
    archive: 'click-roster',
    relics: 'click-letters',
    wordofmouth: 'click-flag',
  }
  return map[kind] ?? 'paper'
}

/** 结局 → drone；名册的音频 id 是 drone-ending-names（旧 API，保持可用） */
export function droneForEnding(kind: EndingKind): string {
  const map: Record<string, string> = {
    roster: 'drone-ending-names',
    letters: 'drone-ending-letters',
    flag: 'drone-ending-flag',
    photo: 'drone-ending-photo',
    testimony: 'drone-ending-testimony',
    message: 'drone-ending-message',
    archive: 'drone-ending-names',
    relics: 'drone-ending-letters',
    wordofmouth: 'drone-ending-flag',
  }
  return map[kind] ?? 'drone-ending-names'
}

/** 场景 → 环境声（README §二「环境床」：天气 + 地点优先；失败返回 null 就静音） */
export function ambienceForScene(
  weather: Weather,
  chapter: string,
  location?: string,
): string | null {
  const where = `${chapter} ${location ?? ''}`
  if (/河|桥|苏州|渡/u.test(where) && weather !== 'snow') return 'river'
  if (weather === 'rain') return /四行|仓库|夜|巷/u.test(where) ? 'rain-heavy' : 'rain-light'
  if (weather === 'snow') return 'snow-wind'
  if (weather === 'smoke') return /街|租界|对岸|人群/u.test(where) ? 'crowd-whisper' : 'room-tone'
  return 'room-tone'
}

/** 页面级环境声：菜单/图鉴/关于/史料库/人物志/后来都用 room-tone 当垫；结局页只留 drone */
export function ambienceForScreen(screen: string): string | null {
  if (screen === 'ending') return null
  if (screen === 'menu') return 'room-tone'
  if (screen === 'gallery' || screen === 'about' || screen === 'sources') return 'room-tone'
  if (screen === 'people' || screen === 'later') return 'room-tone'
  return null
}

/* ════════════════════════════════════════════════════════════════════
 * 十二、DEV 探针（window.__audio，生产构建不挂）
 * ════════════════════════════════════════════════════════════════════ */

function analyserDbfs(node: AnalyserNode | null): number {
  if (!node) return -120
  const data = new Float32Array(node.fftSize)
  node.getFloatTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i]
  const rms = Math.sqrt(sum / data.length)
  return rms > 0 ? 20 * Math.log10(rms) : -120
}

function readLevels() {
  return {
    master: analyserDbfs(mixAnalyser),
    ambience: analyserDbfs(ambienceAnalyser),
    drone: analyserDbfs(droneAnalyser),
    accent: analyserDbfs(accentAnalyser),
  }
}

function resetGates() {
  lastAccentAt = 0
  lastAccentById.clear()
  lastEventAt.clear()
  lastPlayed.clear()
  slots.accent.until = 0
  slots.transition.until = 0
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __audio?: unknown }).__audio = {
    getState: () => ctx?.state ?? 'none',
    isMuted: () => muted,
    isUnlocked: () => unlocked && ctx !== null,
    ambience: () => ambienceId,
    drone: () => droneId,
    buffered: () => [...buffers.keys()],
    /* 事件表 */
    events: () => [...AUDIO_EVENT_NAMES],
    eventCount: () => AUDIO_EVENT_NAMES.length,
    map: () => AUDIO_EVENT_MAP,
    layers: (event: string) => (isAudioEvent(event) ? AUDIO_EVENT_MAP[event] : []),
    manifest: () => [...AUDIO_IDS],
    transitions: () => [...TRANSITION_VARIANTS],
    accents: () => ACCENT_RULES.map((rule) => ({ event: rule.event, keywords: rule.keywords })),
    accentFor: (text: string) => accentForScene(text),
    /* 床选择器（测试用：证明九条床没有死的） */
    ambienceForScene: (weather: string, chapter: string, location?: string) =>
      ambienceForScene(weather as Weather, chapter, location),
    ambienceForScreen: (screen: string) => ambienceForScreen(screen),
    /* 混音 */
    mix: () => ({ ...MIX }),
    trims: () => ({ ...LEVEL_TRIM_DB }),
    trimDb: (id: string) => levelTrimDb(id),
    gains: () => Object.fromEntries(appliedGains),
    reverb: () => ({ seconds: IR_SECONDS, wet: REVERB_WET }),
    softClip: () => ({ kneeDbfs: SOFT_CLIP_KNEE_DBFS, oversample: SOFT_CLIP_OVERSAMPLE }),
    /* 播放（测试用：App 未接线时也能验事件） */
    playEvent: (event: string) => playEvent(event),
    playTransition: (variant: string) => playTransition(variant as TransitionVariant),
    playAccent: (sceneId: string, text: string) => playAccentForScene(sceneId, text),
    setAmbience: (id: string | null) => setAmbience(id, { fadeInMs: 200 }),
    setDrone: (id: string | null, fadeInMs?: number) => setDrone(id, { fadeInMs }),
    rampDrone: (factor: number, ms?: number) => rampDrone(factor, ms),
    stopAudio: () => stopAudio(),
    /* 观察 */
    log: () => playLog.map((item) => ({ ...item })),
    levels: () => readLevels(),
    droneFactor: () => droneFactor,
    slots: () => ({
      transition: { ...slots.transition, handle: Boolean(slots.transition.handle) },
      accent: { ...slots.accent, handle: Boolean(slots.accent.handle) },
    }),
    resetGates: () => resetGates(),
  }
}
