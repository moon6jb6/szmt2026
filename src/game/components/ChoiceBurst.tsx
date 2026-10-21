import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { CompositeKind, MemoryKind } from '../types'

export type BurstKind = MemoryKind | CompositeKind | 'quiet' | 'continue'

export type BurstHandle = {
  fire: (x: number, y: number, kind: BurstKind, seed?: number) => void
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: string
  kind: 'dot' | 'frag' | 'ribbon' | 'ring' | 'glyph'
  rot: number
  vr: number
  glyph?: string
}

const GLYPHS = ['名', '册', '家', '书', '旗', '照', '口', '述', '信', '城', '人', '留']

/** 颜色与情绪绑定：同一次点击里，颜色、形状、运动方向都随载体而变 */
const PALETTE: Record<string, string[]> = {
  roster: ['#1d1913', '#2c261d', '#c8a063'],
  letters: ['#d8c9a8', '#b99f74', '#8a7551'],
  flag: ['#a32b2b', '#c0442f', '#e0a15a'],
  photo: ['#e8e4d8', '#9aa7a4', '#4c5a57'],
  testimony: ['#8fb3b0', '#5d8b88', '#c8a063'],
  message: ['#e5dccb', '#b8ab93', '#7c7362'],
  archive: ['#1d1913', '#c8a063', '#8fb3b0'],
  relics: ['#d8c9a8', '#a32b2b', '#e8e4d8'],
  wordofmouth: ['#a32b2b', '#c8a063', '#e5dccb'],
  quiet: ['#8d8577', '#6c655a', '#a8a093'],
  continue: ['#c8a063', '#8a7551', '#e5dccb'],
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

function hashSeed(text: string, extra = 0) {
  let hash = 2166136261 ^ extra
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const ChoiceBurst = forwardRef<BurstHandle, object>(function ChoiceBurst(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const sizeRef = useRef({ dpr: 1, w: 0, h: 0 })

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    sizeRef.current = { dpr, w, h }
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [resize])

  const spawn = (x: number, y: number, kind: BurstKind, seed: number) => {
    const rand = mulberry32(seed)
    const palette = PALETTE[kind] ?? PALETTE.quiet
    const pick = (list: string[]) => list[Math.floor(rand() * list.length)]
    const base = Math.min(window.innerWidth, window.innerHeight)
    const out: Particle[] = []

    const add = (kindName: Particle['kind'], count: number, make: (index: number) => Partial<Particle>) => {
      for (let i = 0; i < count; i += 1) {
        out.push({
          x,
          y,
          vx: 0,
          vy: 0,
          life: 0,
          maxLife: 700 + rand() * 500,
          size: 2 + rand() * 4,
          hue: pick(palette),
          kind: kindName,
          rot: rand() * Math.PI * 2,
          vr: (rand() - 0.5) * 0.3,
          ...make(i),
        })
      }
    }

    if (kind === 'roster' || kind === 'archive') {
      add('dot', 10, () => {
        const angle = rand() * Math.PI * 2
        const speed = 60 + rand() * 170
        return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 2 + rand() * 5 }
      })
      add('glyph', 5, () => ({
        x: x + (rand() - 0.5) * 90,
        y: y + (rand() - 0.5) * 40,
        vy: -20 - rand() * 40,
        vx: (rand() - 0.5) * 20,
        glyph: GLYPHS[Math.floor(rand() * GLYPHS.length)],
        size: 18 + rand() * 16,
        maxLife: 900 + rand() * 400,
      }))
      add('ring', 1, () => ({ vx: 0, vy: 0, size: 12, maxLife: 620 }))
    } else if (kind === 'letters' || kind === 'relics') {
      add('frag', 12, () => {
        const angle = rand() * Math.PI * 2
        const speed = 40 + rand() * 130
        return {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 30,
          rot: rand() * Math.PI,
          vr: (rand() - 0.5) * 0.5,
          size: 6 + rand() * 9,
          maxLife: 1000 + rand() * 500,
        }
      })
    } else if (kind === 'flag' || kind === 'wordofmouth') {
      add('ribbon', 3, () => ({ size: 46 + rand() * 40, maxLife: 800 + rand() * 300 }))
      add('dot', 14, () => {
        const angle = -Math.PI / 2 + (rand() - 0.5) * 2.2
        const speed = 70 + rand() * 180
        return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 1.6 + rand() * 3 }
      })
    } else if (kind === 'photo') {
      add('ring', 2, () => ({ size: 10, maxLife: 520 }))
      add('dot', 12, () => {
        const angle = rand() * Math.PI * 2
        const speed = 90 + rand() * 220
        return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 1.4 + rand() * 2.6, maxLife: 480 + rand() * 260 }
      })
    } else if (kind === 'testimony') {
      add('ring', 3, (index) => ({ size: 8 + index * 6, maxLife: 700 + index * 180 }))
      add('dot', 16, (index) => {
        const angle = (index / 16) * Math.PI * 2
        return { vx: Math.cos(angle) * 70, vy: Math.sin(angle) * 70, size: 1.5 + rand() * 2.2 }
      })
    } else if (kind === 'message') {
      add('dot', 16, () => ({
        vx: (rand() - 0.5) * 50,
        vy: -30 - rand() * 90,
        size: 1.5 + rand() * 3,
        maxLife: 900 + rand() * 500,
      }))
      add('glyph', 2, () => ({
        vx: (rand() - 0.5) * 16,
        vy: -24,
        glyph: '口',
        size: 18 + rand() * 10,
        maxLife: 900,
      }))
    } else if (kind === 'continue') {
      add('ribbon', 1, () => ({ size: base * 0.12, maxLife: 600 }))
    } else {
      add('dot', 8, () => ({
        vx: (rand() - 0.5) * 40,
        vy: -(10 + rand() * 50),
        size: 1.2 + rand() * 2,
        maxLife: 700 + rand() * 400,
      }))
    }

    particlesRef.current.push(...out)
    if (!runningRef.current) {
      runningRef.current = true
      let last = performance.now()
      const frame = (now: number) => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) {
          runningRef.current = false
          return
        }
        resize()
        const { dpr, w: W, h: H } = sizeRef.current
        const delta = Math.min(40, Math.max(1, now - last))
        last = now

        ctx.clearRect(0, 0, W, H)
        ctx.save()
        ctx.scale(dpr, dpr)
        const list = particlesRef.current
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const p = list[i]
          p.life += delta
          if (p.life >= p.maxLife) {
            list.splice(i, 1)
            continue
          }
          const t = p.life / p.maxLife
          const fade = 1 - t
          p.x += (p.vx * delta) / 1000
          p.y += (p.vy * delta) / 1000
          p.vy += p.kind === 'glyph' ? 6 * (delta / 1000) : 0
          p.rot += p.vr * (delta / 1000)
          ctx.globalAlpha = Math.max(0, fade)
          ctx.fillStyle = p.hue
          ctx.strokeStyle = p.hue

          if (p.kind === 'dot') {
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * fade, 0, Math.PI * 2)
            ctx.fill()
          } else if (p.kind === 'frag') {
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot)
            ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66)
            ctx.restore()
          } else if (p.kind === 'ribbon') {
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot * 0.4)
            ctx.globalAlpha = fade * 0.45
            ctx.beginPath()
            ctx.moveTo(-p.size, 0)
            ctx.quadraticCurveTo(0, -p.size * 0.5, p.size, 0)
            ctx.lineWidth = 2 + fade * 3
            ctx.stroke()
            ctx.restore()
          } else if (p.kind === 'ring') {
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size + t * 90, 0, Math.PI * 2)
            ctx.lineWidth = 2 * fade
            ctx.stroke()
          } else if (p.kind === 'glyph' && p.glyph) {
            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.rot * 0.3)
            ctx.font = `${p.size}px "Noto Serif SC", serif`
            ctx.textAlign = 'center'
            ctx.fillText(p.glyph, 0, 0)
            ctx.restore()
          }
        }
        ctx.restore()
        ctx.globalAlpha = 1
        if (list.length === 0) {
          ctx.clearRect(0, 0, W, H)
          runningRef.current = false
          return
        }
        rafRef.current = requestAnimationFrame(frame)
      }
      rafRef.current = requestAnimationFrame(frame)
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      fire(x: number, y: number, kind: BurstKind, seed = 1) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        resize()
        spawn(x, y, kind, hashSeed(`${kind}:${seed}`))
      },
    }),
    [resize],
  )

  return <canvas ref={canvasRef} className="choice-burst" aria-hidden="true" />
})
