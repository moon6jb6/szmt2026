import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export type CurtainOpts = {
  /** 墨合拢 */
  coverMs?: number
  /** 全黑驻留，换场发生在这里 */
  holdMs?: number
  /** 墨退开 */
  revealMs?: number
}

export type CurtainHandle = {
  play: (swap: () => void, opts?: CurtainOpts) => Promise<void>
}

type Props = {
  /** 按天气给转场叠不同的"场"：ink 纯墨、rain 雨、snow 雪、ash 灰、smoke 烟 */
  variant?: 'ink' | 'rain' | 'snow' | 'ash' | 'smoke'
}

const INK = '#16130f'

/**
 * 幕布的 dpr 上限。
 * 换场是整屏 overdraw（7 块墨 + 天气平铺），像素量随 dpr² 涨：
 * 实测 1600×1000 @2× 时墨幕只剩 20–28fps、掉帧 87–96%；@1× 是 105fps。
 * 幕布上只有模糊的墨/雪/烟纹理，1.5× 与 2× 肉眼无差，所以这里比粒子层收得更紧。
 */
const MAX_DPR = 1.5

/** 墨前沿锚点：从四边四角向画面中心推进 */
const ANCHORS = [
  { x: 0.0, y: 0.0 },
  { x: 0.5, y: -0.06 },
  { x: 1.0, y: 0.0 },
  { x: -0.05, y: 0.55 },
  { x: 1.05, y: 0.5 },
  { x: 0.2, y: 1.05 },
  { x: 0.82, y: 1.05 },
]

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t: number) => t * t * t
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 一次性生成墨迹纹理（离屏 canvas + 烘焙 blur），运行时只 drawImage */
function makeInkTile(size = 512, blobs = 170): HTMLCanvasElement {
  const shape = document.createElement('canvas')
  shape.width = size
  shape.height = size
  const sx = shape.getContext('2d')
  if (!sx) return shape
  sx.fillStyle = '#000'

  const c = size / 2
  sx.beginPath()
  sx.arc(c, c, size * 0.3, 0, Math.PI * 2)
  sx.fill()

  for (let i = 0; i < blobs; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const distance = size * (0.3 + Math.random() * 0.13)
    const radius = size * (0.014 + Math.random() * 0.05)
    sx.beginPath()
    sx.arc(c + Math.cos(angle) * distance, c + Math.sin(angle) * distance, radius, 0, Math.PI * 2)
    sx.fill()
  }

  sx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 40; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const distance = Math.random() * size * 0.3
    const radius = size * (0.008 + Math.random() * 0.03)
    sx.beginPath()
    sx.arc(c + Math.cos(angle) * distance, c + Math.sin(angle) * distance, radius, 0, Math.PI * 2)
    sx.fill()
  }
  sx.globalCompositeOperation = 'source-over'

  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const ox = out.getContext('2d')
  if (!ox) return out
  try {
    ox.filter = `blur(${Math.round(size * 0.035)}px)`
  } catch {
    /* 老浏览器忽略 filter */
  }
  ox.drawImage(shape, 0, 0)
  ox.filter = 'none'
  return out
}

function makeRainTile(w = 640, h = 640): HTMLCanvasElement {
  const tile = document.createElement('canvas')
  tile.width = w
  tile.height = h
  const ctx = tile.getContext('2d')
  if (!ctx) return tile
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * w
    const y = Math.random() * h
    const len = 18 + Math.random() * 70
    const alpha = 0.05 + Math.random() * 0.2
    ctx.strokeStyle = `rgba(198,214,226,${alpha})`
    ctx.lineWidth = 0.6 + Math.random() * 1.1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - 6, y + len)
    ctx.stroke()
  }
  return tile
}

/** 雪 / 灰 / 烟：一次性烘成纹理，运行时只做整片平移 */
function makeFlakeTile(color: string, count: number, minR: number, maxR: number, streak = 0): HTMLCanvasElement {
  const w = 640
  const tile = document.createElement('canvas')
  tile.width = w
  tile.height = w
  const ctx = tile.getContext('2d')
  if (!ctx) return tile
  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * w
    const y = Math.random() * w
    const r = minR + Math.random() * (maxR - minR)
    ctx.fillStyle = color
    ctx.beginPath()
    if (streak > 0) {
      ctx.ellipse(x, y, r, r * (1 + streak), Math.random() * 0.8, 0, Math.PI * 2)
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  return tile
}

function makeSmokeTile(): HTMLCanvasElement {
  const w = 768
  const shape = document.createElement('canvas')
  shape.width = w
  shape.height = w
  const sx = shape.getContext('2d')
  if (!sx) return shape
  // 每团烟在九宫格里重复画一遍（含出界的那 8 份），模糊后接缝处仍然连续，
  // 否则平铺时能看见 512px 的方格（实测截图有明显网格）。
  const blobs = Array.from({ length: 26 }, () => ({
    x: Math.random() * w,
    y: Math.random() * w,
    r: 40 + Math.random() * 90,
    a: 0.07 + Math.random() * 0.12,
  }))
  for (const blob of blobs) {
    sx.fillStyle = `rgba(120,116,108,${blob.a})`
    for (const dx of [-w, 0, w]) {
      for (const dy of [-w, 0, w]) {
        sx.beginPath()
        sx.arc(blob.x + dx, blob.y + dy, blob.r, 0, Math.PI * 2)
        sx.fill()
      }
    }
  }
  // 模糊只做一次（整张烘焙），运行时不再碰 filter
  const out = document.createElement('canvas')
  out.width = w
  out.height = w
  const ox = out.getContext('2d')
  if (!ox) return out
  try {
    ox.filter = 'blur(18px)'
  } catch {
    /* ignore */
  }
  ox.drawImage(shape, 0, 0)
  ox.filter = 'none'
  return out
}

export const InkCurtain = forwardRef<CurtainHandle, Props>(function InkCurtain(
  { variant = 'ink' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const tilesRef = useRef<HTMLCanvasElement[] | null>(null)
  const rainRef = useRef<HTMLCanvasElement | null>(null)
  const snowRef = useRef<HTMLCanvasElement | null>(null)
  const ashRef = useRef<HTMLCanvasElement | null>(null)
  const smokeRef = useRef<HTMLCanvasElement | null>(null)
  const runningRef = useRef(false)
  /** 幕布此刻是否已经换过场（cover 之后为 true）；后到的播放请求靠它决定"排队还是直接执行" */
  const swappedRef = useRef(false)
  /** 幕布播放期间又来的换场请求：排到 hold 那一帧，避免墨没盖住就换内容（跳场） */
  const pendingSwapRef = useRef<(() => void) | null>(null)
  const sizeRef = useRef({ dpr: 1, w: 0, h: 0 })

  const resize = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.round(canvas.clientWidth * dpr)
    const h = Math.round(canvas.clientHeight * dpr)
    canvas.width = w
    canvas.height = h
    sizeRef.current = { dpr, w, h }
  }

  useEffect(() => {
    tilesRef.current = [makeInkTile(), makeInkTile(), makeInkTile()]
    rainRef.current = makeRainTile()
    snowRef.current = makeFlakeTile('rgba(236,242,246,0.75)', 150, 1, 2.6)
    ashRef.current = makeFlakeTile('rgba(196,192,184,0.5)', 120, 0.8, 2.2, 0.6)
    smokeRef.current = makeSmokeTile()
    resize()
    window.addEventListener('resize', resize)

    // 预热：把纹理先上传一次，避免第一次转场首帧卡顿
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx && tilesRef.current) {
      const { w, h } = sizeRef.current
      canvas.setAttribute('data-live', '1')
      for (let i = 0; i < ANCHORS.length; i += 1) {
        const blob = Math.max(w, h) * 0.62 * 1.3 * (0.86 + ((i * 37) % 29) / 100)
        ctx.globalAlpha = 0.01
        ctx.drawImage(
          tilesRef.current[i % 3],
          ANCHORS[i].x * w - blob / 2,
          ANCHORS[i].y * h - blob / 2,
          blob,
          blob,
        )
      }
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, w, h)
      canvas.setAttribute('data-live', '0')
    }

    return () => window.removeEventListener('resize', resize)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      play(swap: () => void, opts: CurtainOpts = {}) {
        if (runningRef.current) {
          // 幕布正在跑：**不能**在这里直接 swap——墨还没盖住就把内容换掉，
          // 用户会看到新页面从半透明的墨里弹出来（实测连点/连续 Enter 时 288–410ms 就跳场）。
          // 还在 cover 段就排到 hold 那一帧执行（那时已全黑，看不出换场）；
          // 已经过了 hold 就直接执行（此时画面基本被墨盖住）。
          if (!swappedRef.current) {
            pendingSwapRef.current = swap
          } else {
            swap()
          }
          return Promise.resolve()
        }

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduce) {
          // 无障碍短路：直接换场，不动 canvas
          swap()
          return Promise.resolve()
        }

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        const tiles = tilesRef.current
        if (!canvas || !ctx || !tiles) {
          swap()
          return Promise.resolve()
        }

        resize()
        const { dpr, w: W, h: H } = sizeRef.current
        if (W === 0 || H === 0) {
          swap()
          return Promise.resolve()
        }

        const { coverMs = 900, holdMs = 240, revealMs = 950 } = opts
        const root = document.documentElement
        const started = performance.now()
        runningRef.current = true
        swappedRef.current = false
        canvas.setAttribute('data-live', '1')

        const drawInk = (scaleMul: number, alpha: number) => {
          const base = Math.max(W, H) * 0.62 * scaleMul
          ctx.globalAlpha = alpha
          for (let i = 0; i < ANCHORS.length; i += 1) {
            const blob = base * (0.86 + ((i * 37) % 29) / 100)
            ctx.drawImage(
              tiles[i % tiles.length],
              ANCHORS[i].x * W - blob / 2,
              ANCHORS[i].y * H - blob / 2,
              blob,
              blob,
            )
          }
          ctx.globalAlpha = 1
        }

        let weatherPattern: CanvasPattern | null = null
        let weatherPattern2: CanvasPattern | null = null

        const drawWeather = (phase: number, strength: number) => {
          if (variant === 'ink') return
          const tile =
            variant === 'rain'
              ? rainRef.current
              : variant === 'snow'
                ? snowRef.current
                : variant === 'ash'
                  ? ashRef.current
                  : smokeRef.current
          if (!tile) return
          if (!weatherPattern) weatherPattern = ctx.createPattern(tile, 'repeat')
          if (!weatherPattern) return
          // 整屏一次 fillRect（旧写法每帧 12–25 次 drawImage，@2× 时是掉帧主因）。
          // 平铺按 dpr 放大、位移取模，视觉与逐块平铺一致。
          const s = tile.width * dpr
          const vx = variant === 'ash' ? -Math.round(s * 0.28) : variant === 'smoke' ? Math.round(s * 0.09) : 0
          const vy = variant === 'smoke' ? Math.round(s * 0.05) : Math.round(s * 0.35)
          const offsetX = (((phase * vx) % s) + s) % s
          const offsetY = (((phase * vy) % s) + s) % s
          ctx.save()
          // 烟要留出墨的暗度：0.5 时整屏灰到 mean≈73，像一块灰布而不是墨
          ctx.globalAlpha = (variant === 'smoke' ? 0.28 : 0.62) * strength
          if (variant === 'rain') ctx.globalCompositeOperation = 'lighter'
          ctx.setTransform(dpr, 0, 0, dpr, offsetX, offsetY)
          ctx.fillStyle = weatherPattern
          ctx.fillRect(0, 0, W / dpr + tile.width, H / dpr + tile.height)
          ctx.restore()

          if (variant !== 'smoke') return
          // 第二层烟：同一张瓦片按 1.37 倍平铺、反向漂移。
          // 单张瓦片平铺能明显看出 768px 的重复（像墙纸），第二层周期 1052px，
          // 两者叠在一起就看不出一致的重复了；两层都是整屏一次 fillRect。
          if (!weatherPattern2) weatherPattern2 = ctx.createPattern(tile, 'repeat')
          if (!weatherPattern2) return
          const s2 = s * 1.37
          const ox = (((phase * -Math.round(s2 * 0.07)) % s2) + s2) % s2
          const oy = (((phase * Math.round(s2 * 0.04)) % s2) + s2) % s2
          ctx.save()
          ctx.globalAlpha = 0.16 * strength
          ctx.setTransform(s2, 0, 0, s2, ox, oy)
          ctx.fillStyle = weatherPattern2
          ctx.fillRect(0, 0, W / s2 + tile.width, H / s2 + tile.height)
          ctx.restore()
        }

        return new Promise<void>((resolve) => {
          let swapped = false

          const commitSwap = () => {
            if (swapped) return
            swapped = true
            swappedRef.current = true
            root.style.setProperty('--push', '1.04')
            swap()
            const extra = pendingSwapRef.current
            pendingSwapRef.current = null
            if (extra) extra()
          }

          const finish = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, W, H)
            root.style.removeProperty('--push')
            canvas.setAttribute('data-live', '0')
            runningRef.current = false
            swappedRef.current = false
            pendingSwapRef.current = null
            resolve()
          }

          const frame = (now: number) => {
            const elapsed = now - started
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, W, H)

            // 掉帧 / 标签页切后台时 rAF 会跳段：换场必须在 cover 之后补上，
            // 否则这一场会"没换过去"（旧写法只在 hold 分支里 swap，跳过 hold 就永远不换）。
            if (elapsed >= coverMs) commitSwap()

            if (elapsed < coverMs) {
              const p = easeOutCubic(elapsed / coverMs)
              drawInk(lerp(0.1, 1.3, p), 1)
              root.style.setProperty('--push', String(1 + 0.045 * p))
              drawWeather(p, p)
              if (p > 0.999) {
                ctx.fillStyle = INK
                ctx.fillRect(0, 0, W, H)
              }
            } else if (elapsed < coverMs + holdMs) {
              ctx.fillStyle = INK
              ctx.fillRect(0, 0, W, H)
              drawWeather((elapsed - coverMs) / holdMs, 1)
            } else if (elapsed < coverMs + holdMs + revealMs) {
              const q = easeInCubic((elapsed - coverMs - holdMs) / revealMs)
              ctx.fillStyle = INK
              ctx.fillRect(0, 0, W, H)
              ctx.globalCompositeOperation = 'destination-out'
              drawInk(lerp(0.55, 3.2, q), 1)
              ctx.globalCompositeOperation = 'source-over'
              root.style.setProperty('--push', String(lerp(1.04, 1, easeOutCubic(q))))
              drawWeather(q, 1 - q)
            } else {
              finish()
              return
            }
            requestAnimationFrame(frame)
          }

          requestAnimationFrame(frame)
        })
      },
    }),
    [variant],
  )

  return <canvas ref={canvasRef} className="ink-curtain" aria-hidden="true" />
})
