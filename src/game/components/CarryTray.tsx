/**
 * CarryTray —— 尾声「把东西交进匣子」
 *
 * 把《把名字留下来》尾声的 9 个结局选择，从按钮列表改成「桌上拖物件、交进匣子」：
 * - 9 件实物（6 个记忆载体各一件；3 个合成结局是两件叠在一起，带「组合」标签）；
 * - 按住拖动 → 只有拖进匣子范围、再按住 1 秒（进度环填满）才落定；
 * - 松手在匣子外 → 弹回原位，不触发选择；
 * - 点击两次 / 点「交出去」/ 键盘 1—9 + Enter 都能完成，保证降级与自动化可用。
 *
 * 性能约定（重要）：拖拽期间不写 React state。位移写在元素 inline transform 上，
 * 由 rAF 合帧；长按进度写在 CSS 变量 --hold 上；只有「选中 / 落定 / 取消」才 setState。
 * 音效不直接依赖 audio.ts：只把 soundId 通过 onSound 回执给上层。
 *
 * 只依赖 ./carryTray.css，不改 App.tsx / audio.ts / styles.css。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMPOSITE_REQUIRES, ENDING_ORDER, ENDINGS } from '../content/endings'
import type { Choice, CompositeKind, EndingKind, MemoryKind } from '../types'
import './carryTray.css'

export type CarryGesture = 'drag' | 'click' | 'keyboard'

export type CarryTrayProps = {
  /** 尾声的结局选项：6 个主结局 + 最多 3 个合成结局（顺序即 1—9） */
  choices: Choice[]
  /** 只有真正落进匣子后才调用；gesture 说明玩家用了哪条路径 */
  onChoose: (choiceId: string, gesture: CarryGesture) => void
  /**
   * 可选音效回执，不直接依赖 audio.ts。
   * 回执 id 与 audio.ts 的 AudioEvent 同名，可直接 playEvent：
   * 拿起/选中 → carrier:roster…（合成结局是 carrier:archive…）
   * 进匣子/落定 → accent:ink；退回桌面 → ui:back
   */
  onSound?: (soundId: string) => void
  /** 强制降级；不传则读 prefers-reduced-motion */
  reduceMotion?: boolean
  /** 匣子上方要按住多久才落定，默认 1000ms */
  holdMs?: number
  /** 落定到 onChoose 之间的延迟，默认 400ms */
  commitDelayMs?: number
  /** 父级正在处理交付时置 true，锁住交互 */
  busy?: boolean
  /** 附加在最外层的 class */
  className?: string
}

/** 位移阈值：小于 8px 当点击，不进入拖拽 */
const DRAG_THRESHOLD = 8
const HOLD_MS = 1000
const COMMIT_DELAY_MS = 400
const DOUBLE_CLICK_MS = 1000
/** 拖拽后抑制紧随其后的 click（浏览器会把 pointerup 合成 click） */
const CLICK_GUARD_MS = 360
const SPRING_MS = 260

/** 每件东西的摆位：旋转 -2.8°~2.8°、竖向错位 0~18px，不用整齐网格 */
const TILTS = [-2.4, 1.9, -1.2, 2.6, -2.7, 1.3, 2.1, -1.6, 2.8]
const LIFTS = [12, 0, 16, 4, 10, 18, 6, 14, 2]

type Material = {
  /** 结局 kind；没有 ending 字段时为空（只影响 aria 文案） */
  ending: EndingKind | null
  /** 结局名（名册 / 家书 / 旗 / 照片 / 口述 / 口信 / 档案 / 遗物 / 口耳） */
  title: string | null
  /** 实物的层：主结局 1 层，合成结局 2 层叠放 */
  layers: MemoryKind[]
  composite: boolean
  /** 拿起时的音效 id */
  sound: string
}

type TrayItem = {
  choice: Choice
  index: number
  material: Material
  shortLabel: string
  ariaLabel: string
}

type DragSession = {
  id: string
  pointerId: number
  el: HTMLButtonElement
  startX: number
  startY: number
  x: number
  y: number
  dx: number
  dy: number
  active: boolean
  over: boolean
  dirty: boolean
  holdStart: number
  raf: number
  binRect: DOMRect | null
}

const MATERIALS: Record<EndingKind, { layers: MemoryKind[]; sound: string }> = (() => {
  const out = {} as Record<EndingKind, { layers: MemoryKind[]; sound: string }>
  for (const kind of ENDING_ORDER) out[kind] = { layers: [kind], sound: `carrier:${kind}` }
  for (const kind of Object.keys(COMPOSITE_REQUIRES) as CompositeKind[]) {
    out[kind] = { layers: [...COMPOSITE_REQUIRES[kind]], sound: `carrier:${kind}` }
  }
  return out
})()

/** 拿起 / 选中 / 退回 / 进匣子的音效回执 id（AudioEvent 兼容，组件本身不 import audio.ts） */
const SOUND = {
  pick: 'ui:click',
  select: 'ui:click',
  overBin: 'accent:ink',
  commit: 'accent:ink',
  returnToDesk: 'ui:back',
} as const

/** 没有 ending 字段时的兜底：按 label 猜载体，猜不出就当一张纸条 */
const KEYWORD_KINDS: Array<[RegExp, MemoryKind]> = [
  [/名册|册子|名录|名单/, 'roster'],
  [/家书|信封|写信|抄本/, 'letters'],
  [/旗/, 'flag'],
  [/照片|相片|相纸|两个圈/, 'photo'],
  [/口述|记录|录音|磁带/, 'testimony'],
  [/口信|那句话|一句话/, 'message'],
]

function inferMemoryKind(label: string): MemoryKind {
  for (const [pattern, kind] of KEYWORD_KINDS) {
    if (pattern.test(label)) return kind
  }
  return 'message'
}

function describeMaterial(choice: Choice): Material {
  const ending = choice.ending ?? null
  if (ending) {
    const meta = MATERIALS[ending]
    return {
      ending,
      title: ENDINGS[ending]?.title ?? null,
      layers: meta ? [...meta.layers] : [inferMemoryKind(choice.label)],
      composite: meta ? meta.layers.length > 1 : false,
      sound: meta ? meta.sound : SOUND.pick,
    }
  }
  const guessed = inferMemoryKind(choice.label)
  return {
    ending: null,
    title: null,
    layers: [guessed],
    composite: false,
    sound: MATERIALS[guessed]?.sound ?? SOUND.pick,
  }
}

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setPrefers(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return prefers
}

export function CarryTray({
  choices,
  onChoose,
  onSound,
  reduceMotion,
  holdMs = HOLD_MS,
  commitDelayMs = COMMIT_DELAY_MS,
  busy = false,
  className,
}: CarryTrayProps) {
  const prefersReduced = usePrefersReducedMotion()
  const reduce = reduceMotion ?? prefersReduced

  const items = useMemo<TrayItem[]>(() => {
    return choices.map((choice, index) => {
      const material = describeMaterial(choice)
      const shortLabel = Array.from(choice.label).slice(0, 8).join('')
      const ariaLabel = `${index + 1} · ${choice.label}${material.title ? `（结局：${material.title}）` : ''}`
      return { choice, index, material, shortLabel, ariaLabel }
    })
  }, [choices])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sinkingId, setSinkingId] = useState<string | null>(null)
  const [lit, setLit] = useState(false)

  const rootRef = useRef<HTMLElement | null>(null)
  const binRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const liveRef = useRef<HTMLParagraphElement | null>(null)
  const itemElsRef = useRef(new Map<string, HTMLButtonElement>())
  const dragRef = useRef<DragSession | null>(null)
  const selectedRef = useRef<string | null>(null)
  const committedRef = useRef<string | null>(null)
  const lastClickRef = useRef<{ id: string; at: number }>({ id: '', at: 0 })
  const suppressClickUntilRef = useRef(0)
  const timersRef = useRef<{ commit?: number; spring?: number }>({})

  /** 事件里读最新 props，避免闭包过期 */
  const cbRef = useRef({ onChoose, onSound, busy, holdMs, commitDelayMs, reduce })
  cbRef.current = { onChoose, onSound, busy, holdMs, commitDelayMs, reduce }
  const itemsRef = useRef(items)
  itemsRef.current = items
  /** 动态挂载的 window 监听（拖拽期间才有），卸载时必须摘掉 */
  const listenersRef = useRef<{ attach: () => void; detach: () => void } | null>(null)
  /** 每个渲染周期都刷新一遍，effect 里只调 ref，不闭包旧函数 */
  const pointerRef = useRef({
    move: (_event: PointerEvent) => {},
    up: (_event: PointerEvent) => {},
    cancel: (_event: PointerEvent) => {},
    abort: () => {},
  })
  const keyRef = useRef({ down: (_event: KeyboardEvent) => {} })

  const setSelected = useCallback((id: string | null) => {
    selectedRef.current = id
    setSelectedId(id)
  }, [])

  const announce = useCallback((text: string) => {
    const el = liveRef.current
    if (el) el.textContent = text
  }, [])

  const resetHold = useCallback(() => {
    if (ringRef.current) ringRef.current.style.setProperty('--hold', '0')
    if (binRef.current) binRef.current.dataset.holding = 'false'
  }, [])

  const commitItem = useCallback(
    (choiceId: string, gesture: CarryGesture, el?: HTMLElement | null) => {
      if (committedRef.current || cbRef.current.busy) return
      const item = itemsRef.current.find((entry) => entry.choice.id === choiceId)
      const target = el ?? itemElsRef.current.get(choiceId) ?? null
      const binEl = binRef.current
      committedRef.current = choiceId

      if (target) {
        if (!cbRef.current.reduce && binEl) {
          // 落进匣子的位移：从当前位置指向匣子口（写成 CSS 变量，交给 transition）
          const itemRect = target.getBoundingClientRect()
          const binRect = binEl.getBoundingClientRect()
          const dx = Math.round(binRect.left + binRect.width / 2 - (itemRect.left + itemRect.width / 2))
          const dy = Math.round(binRect.top + binRect.height * 0.42 - (itemRect.top + itemRect.height / 2))
          target.style.setProperty('--sink-x', `${dx}px`)
          target.style.setProperty('--sink-y', `${dy}px`)
        }
        target.style.transform = ''
        target.style.transition = ''
        target.classList.remove('is-dragging', 'is-over')
      }

      setSelected(null)
      setSinkingId(choiceId)
      setLit(true)
      resetHold()
      announce(`${item ? item.choice.label : '东西'}，交进匣子了。`)
      cbRef.current.onSound?.(SOUND.commit)

      const wait = cbRef.current.reduce ? Math.min(140, cbRef.current.commitDelayMs) : cbRef.current.commitDelayMs
      timersRef.current.commit = window.setTimeout(() => {
        timersRef.current.commit = undefined
        cbRef.current.onChoose(choiceId, gesture)
      }, wait)
    },
    [announce, resetHold, setSelected],
  )

  const springBack = useCallback((el: HTMLButtonElement) => {
    el.classList.remove('is-over')
    if (cbRef.current.reduce) {
      el.style.transform = ''
      el.style.transition = ''
      return
    }
    el.style.transition = `transform ${SPRING_MS}ms cubic-bezier(0.22, 0.9, 0.3, 1.08)`
    el.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1)'
    const clear = () => {
      el.style.transition = ''
      el.style.transform = ''
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName !== 'transform') return
      el.removeEventListener('transitionend', onEnd)
      clear()
    }
    el.addEventListener('transitionend', onEnd)
    timersRef.current.spring = window.setTimeout(() => {
      el.removeEventListener('transitionend', onEnd)
      clear()
    }, SPRING_MS + 220)
  }, [])

  const writeDragTransform = useCallback((session: DragSession) => {
    const tilt = cbRef.current.reduce ? 0 : Math.max(-5, Math.min(5, session.dx * 0.045))
    const scale = cbRef.current.reduce ? 1 : 1.05
    session.el.style.transform = `translate3d(${session.dx}px, ${session.dy}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${scale})`
  }, [])

  const endDrag = useCallback(
    (options: { spring?: boolean; message?: string } = {}) => {
      const session = dragRef.current
      dragRef.current = null
      if (!session) return
      if (session.raf) cancelAnimationFrame(session.raf)
      session.raf = 0
      listenersRef.current?.detach()
      session.el.classList.remove('is-dragging', 'is-over')
      session.el.removeAttribute('data-dragging')
      if (rootRef.current) {
        rootRef.current.dataset.dragging = 'false'
        rootRef.current.dataset.over = 'false'
      }
      if (binRef.current) {
        binRef.current.dataset.over = 'false'
        binRef.current.dataset.holding = 'false'
      }
      resetHold()
      if (options.spring !== false && session.active) {
        springBack(session.el)
        cbRef.current.onSound?.(SOUND.returnToDesk)
      }
      if (options.message) announce(options.message)
    },
    [announce, resetHold, springBack],
  )

  // ---- 拖拽帧循环：位移 & 长按进度都写 DOM，不进 React ----
  const frameRef = useRef<(now: number) => void>(() => {})
  frameRef.current = (now: number) => {
    const session = dragRef.current
    if (!session || !session.active) return
    session.raf = 0

    if (session.dirty) {
      session.dirty = false
      writeDragTransform(session)
    }

    const rect = session.binRect
    const inside =
      !!rect &&
      session.x >= rect.left - 10 &&
      session.x <= rect.right + 10 &&
      session.y >= rect.top - 10 &&
      session.y <= rect.bottom + 10

    if (inside !== session.over) {
      session.over = inside
      session.el.classList.toggle('is-over', inside)
      if (rootRef.current) rootRef.current.dataset.over = inside ? 'true' : 'false'
      if (binRef.current) binRef.current.dataset.over = inside ? 'true' : 'false'
      if (inside) {
        session.holdStart = now
        if (binRef.current) binRef.current.dataset.holding = 'true'
        announce('到匣子上了：按住一秒，按手印。')
        cbRef.current.onSound?.(SOUND.overBin)
      } else {
        session.holdStart = 0
        resetHold()
        announce('离开匣子了：松手就退回桌面。')
      }
    }

    if (session.over && session.holdStart) {
      const span = Math.max(120, cbRef.current.holdMs)
      const progress = Math.min(1, (now - session.holdStart) / span)
      if (ringRef.current) ringRef.current.style.setProperty('--hold', progress.toFixed(3))
      if (progress >= 1) {
        const el = session.el
        const id = session.id
        endDrag({ spring: false })
        commitItem(id, 'drag', el)
        return
      }
    }

    session.raf = requestAnimationFrame((time) => frameRef.current(time))
  }

  const beginDrag = useCallback(
    (session: DragSession) => {
      session.active = true
      session.binRect = binRef.current ? binRef.current.getBoundingClientRect() : null
      session.el.classList.add('is-dragging')
      session.el.setAttribute('data-dragging', 'true')
      if (rootRef.current) rootRef.current.dataset.dragging = 'true'
      if (selectedRef.current) setSelected(null)
      const item = itemsRef.current.find((entry) => entry.choice.id === session.id)
      cbRef.current.onSound?.(item ? item.material.sound : SOUND.pick)
      announce(item ? `拿起了${item.shortLabel}。拖进匣子，按住一秒。` : '拖进匣子，按住一秒。')
      session.dirty = true
      if (!session.raf) session.raf = requestAnimationFrame((time) => frameRef.current(time))
    },
    [announce, setSelected],
  )

  pointerRef.current.move = (event: PointerEvent) => {
    const session = dragRef.current
    if (!session || event.pointerId !== session.pointerId) return
    session.x = event.clientX
    session.y = event.clientY
    session.dx = session.x - session.startX
    session.dy = session.y - session.startY
    if (!session.active) {
      if (Math.hypot(session.dx, session.dy) < DRAG_THRESHOLD) return
      beginDrag(session)
      return
    }
    session.dirty = true
    if (!session.raf) session.raf = requestAnimationFrame((time) => frameRef.current(time))
  }

  pointerRef.current.up = (event: PointerEvent) => {
    const session = dragRef.current
    if (!session || event.pointerId !== session.pointerId) return
    if (!session.active) {
      // 没过阈值：当作点击，交给 click 事件
      dragRef.current = null
      listenersRef.current?.detach()
      resetHold()
      return
    }
    const wasOver = session.over
    suppressClickUntilRef.current = performance.now() + CLICK_GUARD_MS
    endDrag({
      spring: true,
      message: wasOver ? '没按满一秒：东西退回桌面。' : '放回桌面。',
    })
  }

  pointerRef.current.cancel = (event: PointerEvent) => {
    const session = dragRef.current
    if (!session || event.pointerId !== session.pointerId) return
    pointerRef.current.abort()
  }

  pointerRef.current.abort = () => {
    const session = dragRef.current
    if (!session) return
    suppressClickUntilRef.current = performance.now() + CLICK_GUARD_MS
    endDrag({ spring: session.active, message: session.active ? '放回桌面。' : undefined })
  }

  keyRef.current.down = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (cbRef.current.busy || committedRef.current) return
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1
      const item = itemsRef.current[index]
      if (!item) return
      event.preventDefault()
      setSelected(item.choice.id)
      itemElsRef.current.get(item.choice.id)?.focus()
      cbRef.current.onSound?.(item.material.sound)
      announce(`选中第 ${index + 1} 件：${item.choice.label}。按 Enter 交出去。`)
      return
    }

    if (event.key === 'Enter') {
      const id = selectedRef.current
      if (!id) return
      event.preventDefault()
      commitItem(id, 'keyboard', itemElsRef.current.get(id) ?? null)
      return
    }

    if (event.key === 'Escape' && selectedRef.current) {
      event.preventDefault()
      setSelected(null)
      announce('放下了。')
    }
  }

  // ---- 只挂一次：window keydown + 拖拽监听工厂 + 卸载清理 ----
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyRef.current.down(event)

    const onPointerMove = (event: PointerEvent) => pointerRef.current.move(event)
    const onPointerUp = (event: PointerEvent) => pointerRef.current.up(event)
    const onPointerCancel = (event: PointerEvent) => pointerRef.current.cancel(event)
    const onWindowBlur = () => pointerRef.current.abort()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pointerRef.current.abort()
    }

    let attached = false
    listenersRef.current = {
      attach: () => {
        if (attached) return
        attached = true
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerCancel)
      },
      detach: () => {
        if (!attached) return
        attached = false
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
      },
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      listenersRef.current?.detach()
      listenersRef.current = null
      const session = dragRef.current
      dragRef.current = null
      if (session?.raf) cancelAnimationFrame(session.raf)
      if (timersRef.current.commit) window.clearTimeout(timersRef.current.commit)
      if (timersRef.current.spring) window.clearTimeout(timersRef.current.spring)
      timersRef.current = {}
    }
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, choiceId: string) => {
    if (cbRef.current.busy || committedRef.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (dragRef.current) return
    dragRef.current = {
      id: choiceId,
      pointerId: event.pointerId,
      el: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      active: false,
      over: false,
      dirty: false,
      holdStart: 0,
      raf: 0,
      binRect: null,
    }
    listenersRef.current?.attach()
  }

  const handleItemClick = (event: React.MouseEvent<HTMLButtonElement>, item: TrayItem) => {
    if (performance.now() < suppressClickUntilRef.current) return
    if (cbRef.current.busy || committedRef.current) return
    const id = item.choice.id
    const gesture: CarryGesture = event.detail === 0 ? 'keyboard' : 'click'
    const now = performance.now()
    const previous = lastClickRef.current

    if (selectedRef.current === id && previous.id === id && now - previous.at <= DOUBLE_CLICK_MS) {
      commitItem(id, gesture, event.currentTarget)
      return
    }

    lastClickRef.current = { id, at: now }
    if (selectedRef.current !== id) {
      setSelected(id)
      cbRef.current.onSound?.(item.material.sound)
      announce(`选中：${item.choice.label}。再点一次，或点「交出去」。`)
    } else {
      announce('已选中。点「交出去」，或按 Enter。')
    }
  }

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    const id = selectedRef.current
    if (!id) return
    commitItem(id, event.detail === 0 ? 'keyboard' : 'click', itemElsRef.current.get(id) ?? null)
  }

  const selectedItem = items.find((item) => item.choice.id === selectedId) ?? null
  const trayClass = ['carry-tray', className].filter(Boolean).join(' ')

  return (
    <section
      ref={rootRef}
      className={trayClass}
      data-reduce={reduce ? 'true' : 'false'}
      data-busy={busy ? 'true' : 'false'}
      data-dragging="false"
      data-over="false"
      aria-label="把记忆交进匣子"
    >
      <header className="carry-head">
        <p className="carry-eyebrow">尾声 · 把东西交上去</p>
        <p className="carry-lede" id="carry-tray-hint">
          按住一件东西，拖进匣子；到了匣子上方，再按住一秒按手印。
          <span className="carry-lede-2"> 点一下选中再点「交出去」，或用 Tab 选定后按 Enter。</span>
        </p>
      </header>

      <div className="carry-bin-slot">
        <div
          className="carry-bin"
          ref={binRef}
          data-lit={lit ? 'true' : 'false'}
          data-holding="false"
          data-over="false"
          aria-hidden="true"
        >
          <span className="carry-bin-lid" />
          <div className="carry-bin-body">
            <div className="carry-bin-mouth">
              <span className="carry-bin-ink" />
              <span className="carry-bin-cue">拖到这里</span>
            </div>
            <span className="carry-bin-label">抗战史料 · 暂存</span>
            <span className="carry-bin-clasp" />
          </div>
          <span className="carry-bloom" />
        </div>
        {/* 进度环必须是箱子外面的兄弟节点：它在物件之上、箱子之下，落定那刻才被箱子盖住 */}
        <div className="carry-ring" ref={ringRef} aria-hidden="true">
          <span className="carry-ring-text">
            按住 1 秒
            <br />
            按手印
          </span>
        </div>
      </div>

      <ol className="carry-desk" aria-describedby="carry-tray-hint">
        {items.map((item) => {
          const selected = selectedId === item.choice.id
          const committed = sinkingId === item.choice.id
          const sinking = committed && !reduce
          return (
            <li
              key={item.choice.id}
              className="carry-slot"
              style={{
                ['--tilt' as string]: String(TILTS[item.index % TILTS.length]),
                ['--lift' as string]: String(LIFTS[item.index % LIFTS.length]),
              }}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) itemElsRef.current.set(item.choice.id, el)
                  else itemElsRef.current.delete(item.choice.id)
                }}
                className={['carry-item', selected ? 'is-selected' : '', sinking ? 'is-sinking' : ''].filter(Boolean).join(' ')}
                data-choice={item.choice.id}
                data-kind={item.material.ending ?? 'none'}
                data-committed={committed ? 'true' : 'false'}
                aria-pressed={selected}
                aria-label={item.ariaLabel}
                disabled={busy}
                onPointerDown={(event) => handlePointerDown(event, item.choice.id)}
                onClick={(event) => handleItemClick(event, item)}
              >
                <span className="carry-num">{item.index + 1}</span>
                <span className={`carry-mat${item.material.composite ? ' carry-mat--composite' : ''}`}>
                  {item.material.layers.map((layer, layerIndex) => (
                    <span
                      key={`${layer}-${layerIndex}`}
                      className={`carry-obj carry-obj--${layer}${
                        item.material.composite ? (layerIndex === 0 ? ' carry-obj--under' : ' carry-obj--over') : ''
                      }`}
                    />
                  ))}
                  {item.material.composite && <span className="carry-item-tag">组合</span>}
                </span>
                <span className="carry-cap">{item.shortLabel}</span>
                <span className="carry-full" aria-hidden="true">
                  <strong>{item.choice.label}</strong>
                  {item.choice.hint && <em>{item.choice.hint}</em>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <footer className="carry-actions">
        <button
          type="button"
          className="carry-submit"
          disabled={!selectedId || busy}
          onClick={handleSubmit}
          aria-describedby="carry-tray-hint"
        >
          交出去
        </button>
        <span className="carry-actions-note">
          {selectedItem ? `已选中：${selectedItem.choice.label}` : '还没拿定主意'}
        </span>
      </footer>

      <p className="carry-sr-only" role="status" aria-live="polite" ref={liveRef} />
    </section>
  )
}

export default CarryTray
