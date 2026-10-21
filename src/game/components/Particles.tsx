import { useEffect, useRef } from 'react'

type Props = {
  weather: 'rain' | 'ash' | 'smoke' | 'snow' | 'none'
  reduceMotion: boolean
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  drift: number
}

const COUNT = 90

/** 以 60fps 为基准的步长；重绘上限 30fps（见 tick 内注释） */
const STEP_MS = 1000 / 30
const BASE_STEP = 1000 / 60

export function Particles({ weather, reduceMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const element: HTMLCanvasElement | null = canvasRef.current
    if (!element) return
    const context: CanvasRenderingContext2D | null = element.getContext('2d')
    if (!context) return

    const canvas = element
    const ctx = context

    if (reduceMotion || weather === 'none') {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    let width = (canvas.width = canvas.offsetWidth)
    let height = (canvas.height = canvas.offsetHeight)
    let raf = 0
    let acc = 0
    let last = performance.now()

    function spawn(w: number, h: number): Particle {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: 0.4 + Math.random() * 1.6,
        size: 0.6 + Math.random() * 1.8,
        alpha: 0.15 + Math.random() * 0.55,
        drift: Math.random() * Math.PI * 2,
      }
    }

    const particles: Particle[] = Array.from({ length: COUNT }, () => spawn(width, height))

    function resize() {
      width = canvas.width = canvas.offsetWidth
      height = canvas.height = canvas.offsetHeight
    }

    function tick(now: number) {
      // 30fps 重绘：这层是整屏 canvas，每重绘一次都会让上层带 backdrop-filter 的
      // 正文卡片重新取背景（实测：去掉这层，空闲帧率 64 → 231fps）。
      // 雨/雪/灰/烟都是慢速氛围，位移按真实时间算，速度不变。
      acc += Math.min(120, now - last)
      last = now
      if (acc < STEP_MS) {
        raf = requestAnimationFrame(tick)
        return
      }
      const step = Math.min(3, acc / BASE_STEP)
      acc = 0
      ctx.clearRect(0, 0, width, height)

      for (const p of particles) {
        p.drift += 0.01 * step
        p.x += (p.vx + Math.sin(p.drift) * 0.3) * step
        if (weather === 'smoke') {
          // 烟单独往上飘：旧写法用 (frame % 240) 当位移，所有粒子每 4 秒一起瞬移一次
          p.y -= (0.35 + p.size * 0.12) * step
          if (p.y < -30) {
            p.y = height + 30
            p.x = Math.random() * width
          }
        } else {
          p.y += p.vy * step
          if (p.y > height + 4) {
            p.y = -4
            p.x = Math.random() * width
          }
        }
        if (p.x < -4) p.x = width + 4
        if (p.x > width + 4) p.x = -4

        ctx.beginPath()
        if (weather === 'rain') {
          ctx.strokeStyle = `rgba(198, 214, 226, ${p.alpha})`
          ctx.lineWidth = p.size * 0.5
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 3, p.y - 10 - p.size * 4)
          ctx.stroke()
        } else if (weather === 'snow') {
          ctx.fillStyle = `rgba(240, 238, 230, ${p.alpha})`
          ctx.arc(p.x, p.y, p.size * 1.1, 0, Math.PI * 2)
          ctx.fill()
        } else if (weather === 'ash') {
          ctx.fillStyle = `rgba(196, 178, 150, ${p.alpha * 0.8})`
          ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillStyle = `rgba(120, 112, 100, ${p.alpha * 0.35})`
          ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [weather, reduceMotion])

  return <canvas ref={canvasRef} className="particles" aria-hidden="true" />
}
