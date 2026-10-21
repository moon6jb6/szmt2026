import { AUDIO_MANIFEST, type AudioEntry } from './content/audioManifest'
import type { EndingKind, MemoryKind, Weather } from './types'

/**
 * 声音系统（Web Audio）
 *
 * 设计约束（见 docs/superpowers/specs/2026-10-22-afternoon-plan.md §Phase B）：
 * - 默认静音：评审环境绝不自动出声；用户在菜单/场景页点「声音」才解锁；
 * - AudioContext 只在首次用户手势后创建（浏览器自动播放策略）；
 * - 同一时刻最多 1 条 ambience 循环 + 1 条 drone；切换用 700ms 淡入淡出；
 * - 点击音限流，避免连点叠成一团；
 * - 音频文件在 public/audio 下按需 fetch，不打包进 JS；
 * - 页面隐藏时 suspend，回来 resume；
 * - 加载/解码失败一律静默降级，不影响叙事。
 */

const MUTE_KEY = 'names-audio-muted-v1'
const BASE = import.meta.env.BASE_URL ?? './'

type Channel = 'sfx' | 'ambience' | 'drone'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sfxBus: GainNode | null = null
let ambienceBus: GainNode | null = null
let droneBus: GainNode | null = null
const buffers = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer | null>>()
const lastPlayed = new Map<string, number>()

let ambienceId: string | null = null
let ambienceNode: AudioBufferSourceNode | null = null
let ambienceGain: GainNode | null = null
let droneId: string | null = null
let droneNode: AudioBufferSourceNode | null = null
let droneGain: GainNode | null = null
let ambienceToken = 0
let droneToken = 0
let unlocked = false

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

function targetVolume(channel: Channel): number {
  if (muted) return 0
  if (channel === 'ambience') return 0.34
  if (channel === 'drone') return 0.26
  return 0.6
}

function applyMasterGain(immediate = false) {
  if (!master || !ctx) return
  const now = ctx.currentTime
  const value = muted ? 0 : 0.9
  master.gain.cancelScheduledValues(now)
  if (immediate) master.gain.setValueAtTime(value, now)
  else master.gain.linearRampToValueAtTime(value, now + 0.4)
}

/** 在用户手势里调用：创建/恢复 AudioContext，开始预加载常用短音 */
export function unlockAudio(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    unlocked = true
    return Promise.resolve()
  }
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return Promise.resolve()
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.9
    master.connect(ctx.destination)
    sfxBus = ctx.createGain()
    sfxBus.gain.value = targetVolume('sfx')
    sfxBus.connect(master)
    ambienceBus = ctx.createGain()
    ambienceBus.gain.value = targetVolume('ambience')
    ambienceBus.connect(master)
    droneBus = ctx.createGain()
    droneBus.gain.value = targetVolume('drone')
    droneBus.connect(master)
    unlocked = true
    document.addEventListener('visibilitychange', onVisibility)
    // 预加载：点击音 + 翻页/纸（小文件，首次点击就要用）
    const warm = ['click-roster', 'click-letters', 'click-flag', 'click-photo', 'click-testimony', 'click-message', 'page-turn', 'paper']
    for (const id of warm) void load(id)
    return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
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

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (next) {
    // 立刻静音；保留循环节点，取消静音时继续
    applyMasterGain(true)
  } else {
    if (ctx && sfxBus) sfxBus.gain.value = targetVolume('sfx')
    if (ctx && ambienceBus) ambienceBus.gain.value = targetVolume('ambience')
    if (ctx && droneBus) droneBus.gain.value = targetVolume('drone')
    applyMasterGain(true)
    void ctx?.resume()
  }
}

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

export type PlaySfxOptions = { volume?: number }

/** 单次音效：点击载体、翻页等 */
export function playSfx(id: string, options: PlaySfxOptions = {}) {
  if (!ctx || muted || !sfxBus) return
  const meta = entry(id)
  if (!meta) return
  const now = Date.now()
  const last = lastPlayed.get(id) ?? 0
  if (now - last < 70) return
  lastPlayed.set(id, now)
  void load(id).then((buffer) => {
    if (!buffer || !ctx || !sfxBus || muted) return
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.value = options.volume ?? 1
      source.connect(gain)
      gain.connect(sfxBus)
      source.start()
    } catch {
      /* ignore */
    }
  })
}

function fadeParam(param: AudioParam, from: number, to: number, seconds: number) {
  if (!ctx) return
  const now = ctx.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(from, now)
  param.linearRampToValueAtTime(to, now + seconds)
}

/** 场景环境声：同一时刻只保留一条循环 */
export function setAmbience(id: string | null) {
  if (!ctx || !ambienceBus) return
  if (ambienceId === id) return
  const token = ++ambienceToken
  const oldNode = ambienceNode
  const oldGain = ambienceGain
  ambienceId = id
  ambienceNode = null
  ambienceGain = null
  if (oldNode && oldGain) {
    try {
      fadeParam(oldGain.gain, oldGain.gain.value, 0, 0.7)
      oldNode.stop(ctx.currentTime + 0.8)
    } catch {
      /* ignore */
    }
  }
  if (!id) return
  const meta = entry(id)
  if (!meta) return
  void load(id).then((buffer) => {
    if (!buffer || !ctx || !ambienceBus || token !== ambienceToken || muted) return
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = ctx.createGain()
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(ambienceBus)
      source.start()
      fadeParam(gain.gain, 0, 1, 1.2)
      ambienceNode = source
      ambienceGain = gain
    } catch {
      /* ignore */
    }
  })
}

/** 结局低音 drone：与 ambience 走不同总线，可以叠加 */
export function setDrone(id: string | null) {
  if (!ctx || !droneBus) return
  if (droneId === id) return
  const token = ++droneToken
  const oldNode = droneNode
  const oldGain = droneGain
  droneId = id
  droneNode = null
  droneGain = null
  if (oldNode && oldGain) {
    try {
      fadeParam(oldGain.gain, oldGain.gain.value, 0, 0.9)
      oldNode.stop(ctx.currentTime + 1)
    } catch {
      /* ignore */
    }
  }
  if (!id) return
  const meta = entry(id)
  if (!meta) return
  void load(id).then((buffer) => {
    if (!buffer || !ctx || !droneBus || token !== droneToken || muted) return
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = ctx.createGain()
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(droneBus)
      source.start()
      fadeParam(gain.gain, 0, 1, 1.6)
      droneNode = source
      droneGain = gain
    } catch {
      /* ignore */
    }
  })
}

export function stopAudio() {
  setAmbience(null)
  setDrone(null)
  ambienceId = null
  droneId = null
}

/** 开发/测试用只读探针（生产构建不挂） */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __audio?: unknown }).__audio = {
    getState: () => ctx?.state ?? 'none',
    isMuted: () => muted,
    isUnlocked: () => unlocked && ctx !== null,
    ambience: () => ambienceId,
    drone: () => droneId,
    buffered: () => [...buffers.keys()],
  }
}

function onVisibility() {
  if (!ctx) return
  if (document.hidden) void ctx.suspend()
  else if (!muted) void ctx.resume()
}

/** 记忆载体 → 点击音 id；合成结局映射到主载体 */
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

/** 结局 → drone；名册的音频 id 是 drone-ending-names */
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

/** 场景 → 环境声（天气 + 地点优先；失败返回 null 就静音） */
export function ambienceForScene(weather: Weather, chapter: string, location?: string): string | null {
  const where = `${chapter} ${location ?? ''}`
  if (/河|桥|苏州/.test(where) && weather !== 'snow') return 'river'
  if (weather === 'rain') return /四行|仓库|夜/.test(where) ? 'rain-heavy' : 'rain-light'
  if (weather === 'snow') return 'snow-wind'
  if (weather === 'ash' || weather === 'smoke') return 'room-tone'
  return 'room-tone'
}

/** 页面级环境声：菜单/图鉴/人物志/后来/史料库 */
export function ambienceForScreen(screen: string): string | null {
  if (screen === 'menu' || screen === 'gallery' || screen === 'about' || screen === 'sources') return null
  if (screen === 'people' || screen === 'later' || screen === 'ending') return 'room-tone'
  return null
}
