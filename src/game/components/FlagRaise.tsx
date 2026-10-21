import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import './signature.css'

/**
 * 第三夜「升旗」——签名时刻组件（独立可测，暂由 tools/signature-harness 承载）
 *
 * 场景：1937-10-28 夜，四行仓库楼顶。竹竿接的旗杆，旗绳是新的。
 * 玩家按住旗面往上送：风会周期性把它往回拽；松手旗子下滑一点；
 * 送到杆顶（≥90%）并保持 300ms，旗面展开，onComplete()。
 *
 * 手感约定：
 * - 拖拽是相对的（按下点 → 当前点），不抓取旗面像素，触摸端也不会跳。
 * - 阻力只在「动」的时候出现：按住不动，旗停在原处（正弦扰动表现为上下轻晃）。
 * - 90% 是硬阈值；到顶后仍保留 300ms 保持判定，避免一甩就过。
 * - 键盘：聚焦旗面后按住 ↑ / 空格累积进度；↓ 回落；Home 落回杆底。
 * - prefers-reduced-motion：无阻力、无展开动画，进度直接累积。
 * - 「跳过」永远在，不卡流程。
 *
 * 音效钩子：
 *   onSound?.('rope')   开始拖拽（旗绳摩擦）
 *   onSound?.('cloth')  到顶展开
 */

export type FlagRaiseProps = {
  /** 旗到杆顶并保持满 300ms、展开动画走完之后调用。 */
  onComplete: () => void
  /** 音效钩子，由 Lead 接到 audio.ts（rope → playSfx('ink')，cloth → playSfx('flag-flap')）。 */
  onSound?: (cue: 'rope' | 'cloth') => void
  /** 强制减少动效；不传则跟随 prefers-reduced-motion。 */
  reduceMotion?: boolean
  /** 跳过：不调用 onComplete，由 Lead 决定流程怎么走。 */
  onSkip?: () => void
}

type Phase = 'idle' | 'raised' | 'skipped'
type Metrics = { clothW: number; clothH: number; travel: number }

/** 到顶阈值与保持时长（毫秒）——写进 data 属性，测试直接引用同一组数 */
const HOLD_THRESHOLD = 0.9
const HOLD_MS = 300
/** 松手下滑量（进度单位） */
const SLIP = 0.1

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const clamp01 = (n: number) => clamp(n, 0, 1)

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

export function FlagRaise({ onComplete, onSound, reduceMotion, onSkip }: FlagRaiseProps) {
  const reduce = useReduceMotion(reduceMotion)
  const hintId = useId()

  const rootRef = useRef<HTMLElement | null>(null)
  const poleRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const clothRef = useRef<HTMLDivElement | null>(null)
  const pctRef = useRef<HTMLSpanElement | null>(null)

  /** 目标进度（0—1）：指针 / 键盘累积到哪；阻力只作用在显示值上 */
  const pRef = useRef(0)
  /** 上一帧实际渲染的进度（resize 后重放用） */
  const shownRef = useRef(0)
  const metricsRef = useRef<Metrics>({ clothW: 0, clothH: 0, travel: 0 })
  const dragRef = useRef({ active: false, startY: 0, startP: 0 })
  const keyRef = useRef<{ held: boolean; dir: 'up' | 'down' }>({ held: false, dir: 'up' })
  const holdRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const ariaPctRef = useRef(-1)
  const holdingRef = useRef(false)
  const phaseRef = useRef<Phase>('idle')

  const soundRef = useRef(onSound)
  soundRef.current = onSound
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete
  const skipRef = useRef(onSkip)
  skipRef.current = onSkip
  const reduceRef = useRef(reduce)
  reduceRef.current = reduce

  const [metrics, setMetrics] = useState<Metrics>({ clothW: 0, clothH: 0, travel: 0 })
  const [phase, setPhase] = useState<Phase>('idle')
  const [holding, setHolding] = useState(false)
  /** 最近一次输入是键盘还是指针：只给键盘留焦点环，鼠标拖完不要一圈虚线 */
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('pointer')

  useEffect(() => {
    const onKey = () => setInputMode('keyboard')
    const onPointer = () => setInputMode('pointer')
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [])

  /* ---------- 量杆与旗面：travel = 杆高 − 旗面高 ---------- */
  const applyShown = (value: number) => {
    const wrap = wrapRef.current
    const root = rootRef.current
    const v = clamp01(value)
    const { travel } = metricsRef.current
    if (wrap) wrap.style.transform = `translateY(${(-v * travel).toFixed(2)}px)`
    shownRef.current = v
    const pct = Math.round(v * 100)
    if (root) {
      root.dataset.progress = String(pct)
      if (travel) root.style.setProperty('--travel', `${travel}px`)
    }
    if (pctRef.current) pctRef.current.setAttribute('data-pct', String(pct))
    if (clothRef.current && pct !== ariaPctRef.current) {
      ariaPctRef.current = pct
      clothRef.current.setAttribute('aria-valuenow', String(pct))
      clothRef.current.setAttribute(
        'aria-valuetext',
        pct >= HOLD_THRESHOLD * 100 ? `旗面已到杆顶，${pct}%` : `旗面升到 ${pct}%`,
      )
    }
  }

  useEffect(() => {
    const root = rootRef.current
    const pole = poleRef.current
    if (!root || !pole) return

    const apply = () => {
      const width = root.clientWidth
      const poleH = pole.getBoundingClientRect().height
      if (!width || !poleH) return
      const clothW = Math.round(clamp(width * 0.3, 92, 236))
      const clothH = Math.round(clothW * 0.62) // 长约六尺，阔约四尺 ≈ 3:2
      const travel = Math.max(56, Math.round(poleH - clothH))
      const next = { clothW, clothH, travel }
      metricsRef.current = next
      setMetrics(next)
      applyShown(shownRef.current)
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(root)
    observer.observe(pole)
    return () => observer.disconnect()
    // applyShown 只读写 ref，安全地只挂一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  /* 首帧写一遍位置与 aria（ResizeObserver 还没回调时读屏也能拿到值） */
  useEffect(() => {
    applyShown(pRef.current)
    // applyShown 只读写 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setDraggingAttr = (on: boolean) => {
    const wrap = wrapRef.current
    if (!wrap) return
    if (on) wrap.dataset.dragging = '1'
    else delete wrap.dataset.dragging
  }

  const stopLoop = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  const succeed = () => {
    if (phaseRef.current !== 'idle') return
    phaseRef.current = 'raised'
    dragRef.current.active = false
    keyRef.current.held = false
    holdRef.current = null
    stopLoop()
    setDraggingAttr(false)
    pRef.current = 1
    applyShown(1)
    setHolding(false)
    holdingRef.current = false
    setPhase('raised')
    soundRef.current?.('cloth')
    timerRef.current = window.setTimeout(
      () => {
        timerRef.current = null
        completeRef.current()
      },
      reduceRef.current ? 60 : 900,
    )
  }

  const startLoop = () => {
    if (rafRef.current != null) return
    lastRef.current = performance.now()
    const frame = (now: number) => {
      rafRef.current = null
      const dt = clamp((now - lastRef.current) / 1000, 0, 0.05)
      lastRef.current = now

      if (keyRef.current.held) {
        const rate = reduceRef.current ? 0.9 : 0.64
        pRef.current = clamp01(pRef.current + rate * dt * (keyRef.current.dir === 'up' ? 1 : -1))
      }

      const active = dragRef.current.active || keyRef.current.held
      if (!active) {
        applyShown(pRef.current)
        return
      }

      // 风：正弦扰动，只在动作时把旗往回拽；到顶后仍留 5% 的摆幅（≥95%，不影响判定）
      const amplitude = reduceRef.current ? 0 : dragRef.current.active ? 0.05 : 0.03
      const wind = amplitude * Math.abs(Math.sin(now / 300))
      const shown = clamp01(pRef.current - wind)
      applyShown(shown)

      if (shown >= HOLD_THRESHOLD && pRef.current >= HOLD_THRESHOLD) {
        if (holdRef.current == null) holdRef.current = now
        else if (now - holdRef.current >= HOLD_MS) {
          succeed()
          return
        }
      } else {
        holdRef.current = null
      }

      const nearTop = pRef.current >= HOLD_THRESHOLD
      if (nearTop !== holdingRef.current) {
        holdingRef.current = nearTop
        setHolding(nearTop)
      }

      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  /** 松手/松开键：旗子下滑一点（reduced-motion 下同样生效，只是没有过渡动画） */
  const slipDown = () => {
    if (phaseRef.current !== 'idle') return
    pRef.current = pRef.current > 0 ? Math.max(0, pRef.current - SLIP) : 0
    applyShown(pRef.current)
  }

  const endGesture = () => {
    dragRef.current.active = false
    keyRef.current.held = false
    holdRef.current = null
    stopLoop()
    setDraggingAttr(false)
    setHolding(false)
    holdingRef.current = false
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'idle') return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const cloth = clothRef.current
    cloth?.focus({ preventScroll: true })
    try {
      cloth?.setPointerCapture(event.pointerId)
    } catch {
      /* 某些浏览器在 pointerdown 里不给 capture，忽略 */
    }
    dragRef.current = { active: true, startY: event.clientY, startP: pRef.current }
    holdRef.current = null
    setDraggingAttr(true)
    soundRef.current?.('rope')
    startLoop()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const travel = metricsRef.current.travel || 1
    pRef.current = clamp01(dragRef.current.startP + (dragRef.current.startY - event.clientY) / travel)
  }

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const cloth = clothRef.current
    try {
      cloth?.releasePointerCapture(event.pointerId)
    } catch {
      /* 已经释放过就算了 */
    }
    endGesture()
    slipDown()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'idle') return
    const key = event.key
    if (key === 'ArrowUp' || key === ' ' || key === 'Spacebar' || key === 'ArrowDown') {
      event.preventDefault()
      const dir = key === 'ArrowDown' ? 'down' : 'up'
      if (keyRef.current.held && keyRef.current.dir !== dir) {
        keyRef.current = { held: true, dir }
      } else if (!keyRef.current.held) {
        keyRef.current = { held: true, dir }
        holdRef.current = null
        setDraggingAttr(true)
        startLoop()
      }
    } else if (key === 'Home') {
      event.preventDefault()
      pRef.current = 0
      applyShown(0)
      holdRef.current = null
    }
  }

  const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    if (key !== 'ArrowUp' && key !== ' ' && key !== 'Spacebar' && key !== 'ArrowDown') return
    if (!keyRef.current.held) return
    const wasUp = keyRef.current.dir === 'up'
    endGesture()
    if (wasUp) slipDown()
  }

  const onBlur = () => {
    if (!keyRef.current.held) return
    endGesture()
  }

  const skip = () => {
    if (phaseRef.current === 'raised') return
    if (phaseRef.current === 'skipped') return
    phaseRef.current = 'skipped'
    endGesture()
    applyShown(pRef.current)
    setPhase('skipped')
    skipRef.current?.()
  }

  const status =
    phase === 'raised'
      ? '旗升到杆顶。风把旗展开，又卷住。'
      : phase === 'skipped'
        ? '旗没有升到杆顶。'
        : holding
          ? '到顶了，攥住别松。'
          : '还没有到杆顶。'

  return (
    <section
      ref={rootRef}
      className={`sig-flag${reduce ? ' is-reduce' : ''}${phase === 'raised' ? ' is-raised' : ''}${
        phase === 'skipped' ? ' is-skipped' : ''
      }${holding ? ' is-holding' : ''}`}
      data-testid="flag"
      data-reduce={reduce ? '1' : '0'}
      data-wind={reduce ? '0' : '1'}
      data-phase={phase}
      data-input={inputMode}
      data-travel={metrics.travel || undefined}
      style={{
        ['--cloth-w' as string]: `${metrics.clothW}px`,
        ['--cloth-h' as string]: `${metrics.clothH}px`,
        ['--travel' as string]: `${metrics.travel}px`,
      }}
      aria-label="第三夜 · 升旗"
    >
      <div className="sig-flag__sky" aria-hidden="true" />
      <div className="sig-flag__smoke" aria-hidden="true" />
      <div className="sig-flag__searchlight" aria-hidden="true" />
      <div className="sig-flag__bank" aria-hidden="true" />
      <div className="sig-flag__roof" aria-hidden="true" />
      <div className="sig-flag__stairwell" aria-hidden="true">
        <span className="sig-flag__door" />
      </div>
      <div className="sig-flag__parapet" aria-hidden="true" />
      <div className="sig-flag__sandbags" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="sig-flag__ammo" aria-hidden="true" />

      <div className="sig-flag__pole" ref={poleRef} aria-hidden="true">
        <span className="sig-flag__poleBase" />
        <span className="sig-flag__poleJoint" />
        <span className="sig-flag__poleRope" />
        <span className="sig-flag__poleCap" />
        <span className="sig-flag__poleMark">
          <i />
          <em>九成</em>
        </span>
        <span className="sig-flag__poleTop">杆顶</span>
      </div>

      <div className="sig-flag__wrap" ref={wrapRef}>
        <div
          ref={clothRef}
          className="sig-flag__cloth"
          role="slider"
          tabIndex={0}
          aria-label="旗面"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-describedby={hintId}
          data-testid="flag-cloth"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={onBlur}
        >
          <span className="sig-flag__hem" aria-hidden="true" />
          <span className="sig-flag__fold sig-flag__fold--a" aria-hidden="true" />
          <span className="sig-flag__fold sig-flag__fold--b" aria-hidden="true" />
          <span className="sig-flag__patch" aria-hidden="true" />
        </div>
        <span className="sig-flag__sleeve" aria-hidden="true" />
      </div>

      <p className="sig-flag__caption" aria-hidden="true">
        一九三七年十月二十八日 夜 · 四行仓库楼顶
      </p>
      <p className="sig-flag__measure" aria-hidden="true">
        旗：长六尺 阔四尺
        <span className="sig-flag__pct" ref={pctRef} data-pct="0" />
      </p>
      <p className="sig-flag__hint" id={hintId}>
        按住旗面往上拖；键盘按住 ↑ 或空格。
      </p>
      <p className="sig-flag__status" role="status" aria-live="polite">
        {status}
      </p>
      <button type="button" className="sig-flag__skip" data-testid="flag-skip" onClick={skip}>
        跳过
      </button>
    </section>
  )
}
