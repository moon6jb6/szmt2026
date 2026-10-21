import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import './signature.css'

/**
 * 第一夜「灯下找名字」——签名时刻组件（独立可测，暂由 tools/signature-harness 承载）
 *
 * 场景：1937-10-26 深夜，四行仓库底楼，只有一盏煤油灯。玩家提着一小圈光，
 * 在货架 / 木箱 / 墙钉三处找到三个名字，点亮三行名册，再点「把名字描下来」。
 *
 * 设计红线（与项目一致）：
 * - 不做杀敌、不做计分；这里的「进度」只是名册行数。
 * - 场景全部是 CSS 画的轮廓（货架、木箱、墙钉、麻袋、枪架），无图片。
 * - 手电只用 CSS mask + CSS 变量位移，避免 canvas 逐帧绘制。
 * - 键盘：三个热点是真实 <button>，Tab 可达、Enter 直接点亮（不要求光圈先照到）；
 *   prefers-reduced-motion 下光圈不跟随，直接给出热点轮廓。
 *
 * 音效钩子：
 *   onSound?.('paper')  找到一处（纸页被灯照亮）
 *   onSound?.('pen')    点「把名字描下来」（铅笔描字）
 */

export type SpotlightFindProps = {
  /** 三个名字都找到、并点了「把名字描下来」之后调用。 */
  onComplete: () => void
  /** 音效钩子，由 Lead 接到 audio.ts（paper → playSfx('paper')，pen → playSfx('pen')）。 */
  onSound?: (cue: 'paper' | 'pen') => void
  /** 强制减少动效；不传则跟随 prefers-reduced-motion。 */
  reduceMotion?: boolean
  /** 热点位置与名册顺序的固定种子：同一 seed 永远同一布局。默认 1。 */
  seed?: number
}

type Hotspot = {
  id: string
  /** 这个字写在什么东西上（用于报读/提示） */
  place: string
  x: number
  y: number
  /** 点亮后那行小字往哪边浮（靠顶的热点往下，免得压到名册行） */
  slip: 'up' | 'down'
  name: string
  age: string
  home: string
}

/** 三处藏名字的地方：锚点是固定物件，seed 只做小幅偏移，保证字一定落在物件上 */
const PLACES = [
  { id: 'shelf', place: '货架第二层的木牌', x: 19, y: 45, jitter: 3.2, slip: 'up' as const },
  { id: 'crate', place: '木箱侧板的粉笔字', x: 53, y: 67, jitter: 3.4, slip: 'up' as const },
  { id: 'nail', place: '墙钉下的半张纸角', x: 74, y: 31, jitter: 2.6, slip: 'down' as const },
] as const

/**
 * 三个名字沿用游戏正文里已经出现过的虚构通城兵（chapter1 李满仓 / 王金贵、二柱），
 * 不借真实四十九壮士的姓名编年龄。Lead 若要改用真实名单，必须同时挂史料卡。
 */
const SLIPS = [
  { name: '李满仓', age: '十九岁', home: '通城 沙堆' },
  { name: '王金贵', age: '廿三岁', home: '通城 磨桥' },
  { name: '赵二柱', age: '十七岁', home: '通城 四庄' },
] as const

const STAGE_SEED = 1

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const clamp01 = (n: number) => clamp(n, 0, 1)

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / Math.max(0.0001, edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mixSeed(seed: number, salt: number) {
  let h = (seed | 0) ^ 0x9e3779b9
  h = Math.imul(h ^ (salt + 1), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return h >>> 0
}

function buildSpots(seed: number): Hotspot[] {
  const rand = mulberry32(mixSeed(seed, 7))
  const shift = Math.abs(Math.trunc(seed)) % SLIPS.length
  return PLACES.map((place, index) => {
    const dx = (rand() - 0.5) * 2 * place.jitter
    const dy = (rand() - 0.5) * 2 * place.jitter * 0.7
    const slip = SLIPS[(index + shift) % SLIPS.length]
    return {
      id: place.id,
      place: place.place,
      x: clamp(place.x + dx, 8, 92),
      y: clamp(place.y + dy, 12, 88),
      slip: place.slip,
      ...slip,
    }
  })
}

/** 两个签名组件各带一份：避免为了一个 hook 相互 import，接进 App 后可随时换成共用 hook */
function useReduceMotion(forced?: boolean) {
  const [media, setMedia] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setMedia(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return forced ?? media
}

export function SpotlightFind({ onComplete, onSound, reduceMotion, seed = STAGE_SEED }: SpotlightFindProps) {
  const reduce = useReduceMotion(reduceMotion)
  const spots = useMemo(() => buildSpots(seed), [seed])

  const rootRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const hotRefs = useRef<Array<HTMLButtonElement | null>>([])
  /** 光圈位置（0—1 的场景比例）。x/y 是渲染值，tx/ty 是目标值。 */
  const lightRef = useRef({ x: 0.5, y: 0.46, tx: 0.5, ty: 0.46 })
  const sizeRef = useRef({ w: 0, h: 0 })
  const missTimerRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const soundRef = useRef(onSound)
  soundRef.current = onSound

  const [found, setFound] = useState<boolean[]>(() => spots.map(() => false))
  const [note, setNote] = useState('')
  const [missed, setMissed] = useState(false)

  const count = found.reduce((sum, hit) => sum + (hit ? 1 : 0), 0)
  const done = count === spots.length
  const status = done ? `三个名字都找到了。${note}` : `名册行 ${count} / ${spots.length}。${note}`

  /* seed 变了就重开一局（Lead 若在场景里换 seed，不会出现「名字换了、计数还在」） */
  useEffect(() => {
    setFound(spots.map(() => false))
    setNote('')
    setMissed(false)
    finishedRef.current = false
  }, [spots])

  /* 量场景尺寸：光圈半径、遮挡层尺寸都跟它走（不逐帧读布局） */
  useEffect(() => {
    const frame = frameRef.current
    const root = rootRef.current
    if (!frame || !root) return
    const apply = () => {
      const w = frame.clientWidth
      const h = frame.clientHeight
      sizeRef.current = { w, h }
      const radius = clamp(w * 0.17, 78, 200)
      root.style.setProperty('--lr', `${Math.round(radius)}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  /* 光圈跟随：rAF 里做阻尼，CSS 变量交给 mask / 光斑 / 热点显形 */
  useEffect(() => {
    const root = rootRef.current
    if (reduce) {
      if (root) {
        root.style.setProperty('--lx', '50%')
        root.style.setProperty('--ly', '46%')
      }
      hotRefs.current.forEach((node) => node?.style.setProperty('--near', '1'))
      return
    }

    let raf = 0
    const light = lightRef.current
    const tick = () => {
      light.x += (light.tx - light.x) * 0.3
      light.y += (light.ty - light.y) * 0.3
      if (root) {
        const { w, h } = sizeRef.current
        const radius = clamp(w * 0.17, 78, 200)
        root.style.setProperty('--lx', `${(light.x * 100).toFixed(2)}%`)
        root.style.setProperty('--ly', `${(light.y * 100).toFixed(2)}%`)
        for (let i = 0; i < spots.length; i += 1) {
          const node = hotRefs.current[i]
          if (!node) continue
          const dx = (spots[i].x / 100 - light.x) * w
          const dy = (spots[i].y / 100 - light.y) * h
          const dist = Math.hypot(dx, dy)
          const near = 1 - smoothstep(radius * 0.42, radius * 1.2, dist)
          node.style.setProperty('--near', near.toFixed(3))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduce, spots])

  useEffect(() => {
    return () => {
      if (missTimerRef.current) window.clearTimeout(missTimerRef.current)
    }
  }, [])

  const aim = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (reduce) return
      const frame = frameRef.current
      if (!frame) return
      const rect = frame.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const light = lightRef.current
      light.tx = clamp01((event.clientX - rect.left) / rect.width)
      light.ty = clamp01((event.clientY - rect.top) / rect.height)
    },
    [reduce],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return
    aim(event)
    // 按下时把光圈直接挪到指尖，别等行业阻尼（触摸端第一下就要有反应）
    const light = lightRef.current
    light.x = light.tx
    light.y = light.ty
  }

  const focusSpot = (index: number) => {
    const spot = spots[index]
    const light = lightRef.current
    light.tx = spot.x / 100
    light.ty = spot.y / 100
    // 键盘用户没有指针：光圈直接跟到焦点上
    light.x = light.tx
    light.y = light.ty
  }

  const flashMissed = () => {
    setMissed(true)
    if (missTimerRef.current) window.clearTimeout(missTimerRef.current)
    missTimerRef.current = window.setTimeout(() => setMissed(false), 1400)
  }

  const tryFind = (index: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (found[index]) return
    // detail === 0 是键盘触发的 click（Enter / 空格）：不要求光圈先在附近
    const fromKeyboard = event.detail === 0
    if (!fromKeyboard && !reduce) {
      const node = hotRefs.current[index]
      if (node) {
        const rect = node.getBoundingClientRect()
        const dist = Math.hypot(
          event.clientX - (rect.left + rect.width / 2),
          event.clientY - (rect.top + rect.height / 2),
        )
        if (dist > Math.max(44, rect.width)) {
          flashMissed()
          return
        }
      }
    }

    const next = found.slice()
    next[index] = true
    const spot = spots[index]
    const total = next.reduce((sum, hit) => sum + (hit ? 1 : 0), 0)
    setFound(next)
    setNote(
      total === spots.length
        ? `最后一个是${spot.place}：${spot.name}，${spot.age}。`
        : `${spot.place}：${spot.name}，${spot.age}。`,
    )
    soundRef.current?.('paper')
  }

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    soundRef.current?.('pen')
    onComplete()
  }

  return (
    <section
      ref={rootRef}
      className={`sig-spot${reduce ? ' is-reduce' : ''}${done ? ' is-done' : ''}`}
      data-testid="spotlight"
      data-reduce={reduce ? '1' : '0'}
      data-found={count}
      aria-label="第一夜 · 灯下找名字"
    >
      <div
        ref={frameRef}
        className="sig-spot__frame"
        onPointerMove={aim}
        onPointerDown={onPointerDown}
      >
        {/* ---------- CSS 场景：底楼轮廓，全靠渐变与色块 ---------- */}
        <div className="sig-spot__scene" aria-hidden="true">
          <span className="sig-spot__beamShadow" />
          <span className="sig-spot__column" />
          <span className="sig-spot__socket" />
          {/* 地面先画，物件才像站在地上 */}
          <span className="sig-spot__floor" />
          <span className="sig-spot__crack" />
          <span className="sig-spot__shelf">
            <i className="sig-spot__shelfPost" />
            <i className="sig-spot__shelfPost sig-spot__shelfPost--b" />
            <i className="sig-spot__plank sig-spot__plank--a" />
            <i className="sig-spot__plank sig-spot__plank--b" />
            <i className="sig-spot__plank sig-spot__plank--c" />
            <i className="sig-spot__jar sig-spot__jar--a" />
            <i className="sig-spot__jar sig-spot__jar--b" />
            <i className="sig-spot__jar sig-spot__jar--c" />
            <i className="sig-spot__tag" />
          </span>
          <span className="sig-spot__tinBox" />
          <span className="sig-spot__crate sig-spot__crate--a">
            <i className="sig-spot__crateBoard" />
            <i className="sig-spot__crateBrace" />
          </span>
          <span className="sig-spot__crate sig-spot__crate--b">
            <i className="sig-spot__crateBoard" />
            <i className="sig-spot__crateBrace" />
          </span>
          <span className="sig-spot__nails">
            <i />
            <i />
            <i />
          </span>
          <span className="sig-spot__paperScrap" />
          <span className="sig-spot__sacks">
            <i className="sig-spot__sack" />
            <i className="sig-spot__sack sig-spot__sack--b" />
            <i className="sig-spot__sack sig-spot__sack--c" />
          </span>
          <span className="sig-spot__rifles">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="sig-spot__shell" />
        </div>

        {/* ---------- 灯：光斑 + 遮挡层（mask 开孔） ---------- */}
        <div className="sig-spot__glow" aria-hidden="true" />
        <div className="sig-spot__dark" aria-hidden="true" />
        <div className="sig-spot__grain" aria-hidden="true" />

        {/* 煤油灯本体：整间屋子上唯一常亮的东西，压在遮挡层之上 */}
        <span className="sig-spot__lamp" aria-hidden="true">
          <i className="sig-spot__lampBracket" />
          <i className="sig-spot__lampGlass" />
          <i className="sig-spot__lampFlame" />
        </span>

        {/* ---------- 名册行 ---------- */}
        <div className="sig-spot__hud" aria-hidden="true">
          <span className="sig-spot__stamp">一九三七年十月二十六日 · 深夜</span>
          <span className="sig-spot__place">四行仓库 底楼</span>
          <span className="sig-spot__tally">
            <span className="sig-spot__tallyLabel">名册行</span>
            {spots.map((spot, index) => (
              <i key={spot.id} className={`sig-spot__row${found[index] ? ' is-on' : ''}`} />
            ))}
            <span className="sig-spot__tallyNum">
              {count} / {spots.length}
            </span>
          </span>
        </div>

        {/* ---------- 三个热点 ---------- */}
        {spots.map((spot, index) => (
          <button
            key={spot.id}
            ref={(node) => {
              hotRefs.current[index] = node
            }}
            type="button"
            className={`sig-spot__hot${found[index] ? ' is-lit' : ''}`}
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
            data-testid={`spot-${index}`}
            data-found={found[index] ? '1' : '0'}
            data-place={spot.place}
            data-slip={spot.slip}
            aria-label={`找到第 ${index + 1} 个名字`}
            aria-pressed={found[index]}
            onClick={(event) => tryFind(index, event)}
            onFocus={() => focusSpot(index)}
          >
            <span className="sig-spot__hotCore" aria-hidden="true" />
            <span className="sig-spot__slip" aria-hidden="true">
              <span className="sig-spot__slipName">{spot.name}</span>
              <span className="sig-spot__slipAge">{spot.age}</span>
              <span className="sig-spot__slipHome">{spot.home}</span>
            </span>
          </button>
        ))}

        <p className="sig-spot__whisper" aria-hidden="true">
          {missed ? '灯还没照到这里。' : '灯照到的地方，才看得见字。'}
        </p>
      </div>

      <div className="sig-spot__bar">
        <p className="sig-spot__status" role="status" aria-live="polite">
          {status}
        </p>
        {done ? (
          <button type="button" className="sig-spot__finish" data-testid="spot-finish" onClick={finish}>
            把名字描下来 →
          </button>
        ) : (
          <span className="sig-spot__keys" aria-hidden="true">
            Tab 换一处 · Enter 点亮
          </span>
        )}
      </div>
    </section>
  )
}
