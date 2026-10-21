import { useEffect, useRef, useState } from 'react'
import type { CompositeKind, EndingKind, MemoryKind } from '../types'

/**
 * 结局「终极画面」：每种结局一段 6 秒左右的 Canvas 收束动画。
 * - 名册：名字像雨一样落下来，最后排成册页
 * - 家书：纸页翻落，一封打开
 * - 旗：暗色地平线上，红布在风里展开
 * - 照片：闪光之后，影像慢慢显影，两个人像被圈住
 * - 口述：磁带轮转动，声音画成一条波
 * - 口信：石面上一笔一笔凿出六个字
 * - 档案 / 遗物 / 口耳：把两种画面叠在一起
 *
 * 无障碍：prefers-reduced-motion 时只画最后一帧静态画面，2 秒后进入正文。
 * 可跳过：点击 / Enter / Esc / 空格。
 */

const DURATION = 6200
const GLYPHS = '卢鸿信郭少银傅冠来周福其樊城谢晋元杨瑞符陈树生通城人留名册书旗照口述'.split('')
const MESSAGE_CHARS = ['我', '们', '是', '通', '城', '人']

type Shape = { x: number; y: number; r: number; speed: number; size: number; rot: number; vr: number; char?: string }

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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

type Props = {
  kind: EndingKind
  onDone: () => void
}

export function EndingFinale({ kind, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [leaving, setLeaving] = useState(false)
  const doneRef = useRef(false)
  /** onDone 每次 render 都是新函数；放进 ref，避免父组件任何一次重渲染就把 6 秒动画重头播 */
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const timersRef = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timersRef.current.push(id)
    return id
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rand = mulberry32(20261021 + kind.length * 97 + kind.charCodeAt(0))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = window.innerWidth
    const H = window.innerHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.scale(dpr, dpr)

    // 预生成形状，动画期间只做位置更新
    const glyphs: Shape[] = Array.from({ length: 96 }, () => ({
      x: rand() * W,
      y: -rand() * H,
      r: 0,
      speed: 24 + rand() * 70,
      size: 14 + rand() * 22,
      rot: rand() * Math.PI,
      vr: (rand() - 0.5) * 0.2,
      char: GLYPHS[Math.floor(rand() * GLYPHS.length)],
    }))
    const papers: Shape[] = Array.from({ length: 16 }, () => ({
      x: rand() * W,
      y: -rand() * H,
      r: rand() * Math.PI,
      speed: 18 + rand() * 34,
      size: 26 + rand() * 36,
      rot: rand() * Math.PI,
      vr: (rand() - 0.5) * 0.6,
    }))
    const dust: Shape[] = Array.from({ length: 70 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: 0,
      speed: 6 + rand() * 22,
      size: 1 + rand() * 2.2,
      rot: 0,
      vr: 0,
    }))
    const grain: Shape[] = Array.from({ length: 240 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: 0,
      speed: 0,
      size: 0.6 + rand() * 1.4,
      rot: rand(),
      vr: 0,
    }))

    const finish = () => {
      if (doneRef.current) return
      doneRef.current = true
      setLeaving(true)
      later(() => onDoneRef.current(), 520)
    }

    const onKey = (event: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape'].includes(event.key)) finish()
    }
    window.addEventListener('keydown', onKey)

    // ---------- 每种结局的画面 ----------
    const drawBackground = () => {
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#0b0907')
      grad.addColorStop(1, '#17110c')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }

    const drawGlyphRain = (t: number, upTo = 1) => {
      ctx.textAlign = 'center'
      ctx.font = '400 16px "Noto Serif SC", "Source Han Serif SC", serif'
      for (let i = 0; i < glyphs.length * upTo; i += 1) {
        const glyph = glyphs[i]
        const y = ((glyph.y + t * 900 * (glyph.speed / 60)) % (H + 80)) - 40
        ctx.save()
        ctx.translate(glyph.x, y)
        ctx.rotate(Math.sin(t * 6 + glyph.rot) * 0.08)
        ctx.globalAlpha = 0.16 + 0.34 * clamp01(t * 1.4)
        ctx.fillStyle = i % 7 === 0 ? '#c8a063' : '#e7dfcf'
        ctx.font = `400 ${glyph.size}px "Noto Serif SC", "Source Han Serif SC", serif`
        ctx.fillText(glyph.char ?? '', 0, 0)
        ctx.restore()
      }
    }

    const drawRosterTable = (t: number) => {
      const progress = easeOut(clamp01((t - 0.42) / 0.5))
      if (progress <= 0) return
      const tableW = Math.min(W * 0.56, 620)
      const tableH = Math.min(H * 0.44, 340)
      const x0 = (W - tableW) / 2
      const y0 = H * 0.32
      ctx.strokeStyle = 'rgba(200,160,99,0.5)'
      ctx.lineWidth = 1
      ctx.strokeRect(x0, y0, tableW, tableH)
      const rows = 12
      for (let r = 1; r < rows; r += 1) {
        if (r / rows > progress * 1.35) break
        const y = y0 + (tableH / rows) * r
        ctx.beginPath()
        ctx.moveTo(x0, y)
        ctx.lineTo(x0 + tableW, y)
        ctx.strokeStyle = 'rgba(200,160,99,0.22)'
        ctx.stroke()
        for (let c = 0; c < 3; c += 1) {
          const cx = x0 + 26 + c * (tableW - 60) * (0.28 + c * 0.12)
          ctx.fillStyle = c === 0 ? 'rgba(231,223,207,0.5)' : 'rgba(231,223,207,0.22)'
          ctx.fillText(c === 0 ? GLYPHS[(r + c) % GLYPHS.length] : '·', cx, y - 8)
        }
      }
    }

    const drawPapers = (t: number) => {
      papers.forEach((paper, index) => {
        const y = ((paper.y + t * 420 * (paper.speed / 30)) % (H + 120)) - 60
        const x = paper.x + Math.sin(t * 1.6 + index) * 26
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(paper.rot + t * paper.vr)
        ctx.fillStyle = 'rgba(216,201,168,0.16)'
        ctx.strokeStyle = 'rgba(216,201,168,0.42)'
        ctx.lineWidth = 1
        ctx.fillRect(-paper.size / 2, -paper.size / 3, paper.size, paper.size * 0.66)
        ctx.strokeRect(-paper.size / 2, -paper.size / 3, paper.size, paper.size * 0.66)
        ctx.beginPath()
        ctx.moveTo(-paper.size / 2, 0)
        ctx.lineTo(paper.size / 2, 0)
        ctx.strokeStyle = 'rgba(216,201,168,0.2)'
        ctx.stroke()
        ctx.restore()
      })
      // 最后打开的一封信
      const open = easeOut(clamp01((t - 0.55) / 0.4))
      if (open > 0) {
        const w = Math.min(W * 0.32, 380)
        const h = Math.min(H * 0.3, 240)
        const x = W / 2 - w / 2
        const y = H * 0.4
        ctx.globalAlpha = open
        ctx.fillStyle = '#d8c9a8'
        ctx.fillRect(x, y, w, h * open)
        ctx.strokeStyle = 'rgba(120,96,64,0.6)'
        ctx.strokeRect(x, y, w, h * open)
        for (let line = 0; line < 6; line += 1) {
          const ly = y + 22 + line * (h / 7)
          if (ly > y + h * open) break
          ctx.strokeStyle = 'rgba(90,72,50,0.5)'
          ctx.beginPath()
          ctx.moveTo(x + 22, ly)
          ctx.lineTo(x + w - 30 - (line % 3) * 40, ly)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
    }

    const drawFlag = (t: number) => {
      const horizon = H * 0.62
      const sky = ctx.createLinearGradient(0, 0, 0, horizon)
      sky.addColorStop(0, '#0b0907')
      sky.addColorStop(0.7, `rgba(80,32,24,${0.35 + 0.4 * t})`)
      sky.addColorStop(1, `rgba(163,43,43,${0.2 + 0.35 * t})`)
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, horizon)
      ctx.fillStyle = 'rgba(12,9,7,0.85)'
      ctx.fillRect(0, horizon, W, H - horizon)

      const poleX = W * 0.68
      ctx.strokeStyle = 'rgba(60,48,36,0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(poleX, H * 0.18)
      ctx.lineTo(poleX, horizon)
      ctx.stroke()

      const flagW = Math.min(W * 0.24, 300)
      const flagH = flagW * 0.62
      const baseX = poleX - flagW
      const baseY = H * 0.2
      const rise = easeOut(clamp01(t / 0.7))
      ctx.save()
      ctx.beginPath()
      for (let i = 0; i <= 24; i += 1) {
        const u = i / 24
        const wave = Math.sin(u * 5 + t * 7) * 14 * u
        ctx.lineTo(baseX + u * flagW, baseY + wave + (1 - rise) * 60)
      }
      for (let i = 24; i >= 0; i -= 1) {
        const u = i / 24
        const wave = Math.sin(u * 5 + t * 7 + 0.7) * 12 * u
        ctx.lineTo(baseX + u * flagW, baseY + flagH + wave + (1 - rise) * 60)
      }
      ctx.closePath()
      const cloth = ctx.createLinearGradient(baseX, baseY, baseX + flagW, baseY + flagH)
      cloth.addColorStop(0, '#8f2424')
      cloth.addColorStop(0.6, '#a32b2b')
      cloth.addColorStop(1, '#6d1b1b')
      ctx.fillStyle = cloth
      ctx.globalAlpha = 0.9
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.restore()
      // 灰
      dust.forEach((item, index) => {
        const y = (item.y + t * 60 * (item.speed / 10) + index) % H
        ctx.fillStyle = 'rgba(200,180,150,0.18)'
        ctx.fillRect(item.x, y, item.size, item.size)
      })
    }

    const drawPhoto = (t: number) => {
      if (t < 0.1) {
        ctx.fillStyle = `rgba(242,238,228,${1 - t / 0.1})`
        ctx.fillRect(0, 0, W, H)
      }
      const w = Math.min(W * 0.42, 520)
      const h = w * 0.66
      const x = (W - w) / 2
      const y = (H - h) / 2
      const develop = easeInOut(clamp01(t / 0.7))
      ctx.fillStyle = `rgba(24,20,16,0.9)`
      ctx.fillRect(x - 14, y - 14, w + 28, h + 28)
      ctx.fillStyle = `rgba(${Math.round(60 + 140 * develop)},${Math.round(54 + 120 * develop)},${Math.round(44 + 92 * develop)},${0.25 + 0.7 * develop})`
      ctx.fillRect(x, y, w, h)
      // 颗粒
      grain.forEach((g) => {
        ctx.fillStyle = `rgba(230,222,200,${0.02 + 0.05 * develop})`
        ctx.fillRect(x + (g.x % w), y + (g.y % h), g.size, g.size)
      })
      // 十一个人的轮廓
      for (let i = 0; i < 11; i += 1) {
        const px = x + w * (0.12 + (i / 11) * 0.78)
        const py = y + h * (0.62 + (i % 2) * 0.04)
        ctx.beginPath()
        ctx.fillStyle = `rgba(28,24,20,${0.18 + 0.4 * develop})`
        ctx.arc(px, py - h * 0.14, h * 0.035, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(px - h * 0.03, py - h * 0.11, h * 0.06, h * 0.14)
      }
      // 两个圈：没认出来的人
      const circle = easeOut(clamp01((t - 0.5) / 0.35))
      if (circle > 0) {
        ;[0.18, 0.34].forEach((u, index) => {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(200,160,99,${0.85 * circle})`
          ctx.lineWidth = 2
          ctx.arc(x + w * u, y + h * 0.56, h * 0.075 * circle + (index === 0 ? 0 : 4), 0, Math.PI * 2)
          ctx.stroke()
        })
      }
      // 折痕
      const crack = clamp01((t - 0.6) / 0.3)
      if (crack > 0) {
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(20,16,12,0.55)'
        ctx.lineWidth = 1.4
        ctx.moveTo(x + w * 0.78, y)
        ctx.lineTo(x + w * 0.78 - w * 0.22 * crack, y + h * 0.4 * crack)
        ctx.lineTo(x + w * 0.42, y + h * crack)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(231,223,207,0.55)'
      ctx.font = '400 14px "Noto Serif SC", serif'
      ctx.textAlign = 'center'
      ctx.fillText('一九三七年十月二十六日', W / 2, y + h + 34)
      ctx.fillStyle = 'rgba(200,160,99,0.35)'
      ctx.font = '400 12px "Noto Serif SC", serif'
      ctx.fillText('（背面日期：十月三十一日）', W / 2, y + h + 56)
    }

    const drawTestimony = (t: number) => {
      const cx = W / 2
      const cy = H * 0.45
      // 两个磁带轮
      const reelR = Math.min(W, H) * 0.085
      ;[-reelR * 1.7, reelR * 1.7].forEach((offset, index) => {
        ctx.save()
        ctx.translate(cx + offset, cy - reelR * 1.2)
        ctx.rotate(t * (index === 0 ? 7 : -5))
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(231,223,207,0.35)'
        ctx.lineWidth = 2
        ctx.arc(0, 0, reelR, 0, Math.PI * 2)
        ctx.stroke()
        for (let spoke = 0; spoke < 6; spoke += 1) {
          const a = (spoke / 6) * Math.PI * 2
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(231,223,207,0.2)'
          ctx.moveTo(0, 0)
          ctx.lineTo(Math.cos(a) * reelR, Math.sin(a) * reelR)
          ctx.stroke()
        }
        ctx.restore()
      })
      // 波形：口述的"声音"就是名字的多少
      const w = Math.min(W * 0.72, 880)
      const x0 = (W - w) / 2
      const y = cy + reelR * 1.6
      const progress = easeOut(clamp01(t / 0.75))
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(143,179,176,0.85)'
      ctx.lineWidth = 1.6
      for (let i = 0; i <= 200; i += 1) {
        const u = i / 200
        if (u > progress) break
        const wave = Math.sin(u * 40 + t * 4) * 8 + Math.sin(u * 13 + 2) * 20 * Math.abs(Math.sin(u * 3.1))
        const px = x0 + u * w
        if (i === 0) ctx.moveTo(px, y + wave)
        else ctx.lineTo(px, y + wave)
      }
      ctx.stroke()
      // 名字的刻度
      for (let i = 0; i < 49; i += 1) {
        const u = i / 49
        if (u > progress) break
        const px = x0 + u * w
        ctx.strokeStyle = 'rgba(200,160,99,0.5)'
        ctx.beginPath()
        ctx.moveTo(px, y + 34)
        ctx.lineTo(px, y + 42)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(231,223,207,0.4)'
      ctx.font = '400 13px "Noto Serif SC", serif'
      ctx.textAlign = 'center'
      ctx.fillText('一九八二年 · 通城 · 录音带 A-017', W / 2, y + 86)
    }

    const drawMessage = (t: number) => {
      // 石面
      const w = Math.min(W * 0.5, 620)
      const h = Math.min(H * 0.36, 320)
      const x = (W - w) / 2
      const y = (H - h) / 2
      const stone = ctx.createLinearGradient(x, y, x, y + h)
      stone.addColorStop(0, '#2b2822')
      stone.addColorStop(1, '#17140f')
      ctx.fillStyle = stone
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = 'rgba(120,108,88,0.4)'
      ctx.strokeRect(x, y, w, h)
      // 六个字逐个凿出
      ctx.textAlign = 'center'
      ctx.font = `500 ${Math.round(h * 0.16)}px "Noto Serif SC", serif`
      const per = 0.62 / MESSAGE_CHARS.length
      MESSAGE_CHARS.forEach((char, index) => {
        const reveal = clamp01((t - 0.12 - index * per) / per)
        if (reveal <= 0) return
        const cx = x + (w / (MESSAGE_CHARS.length + 1)) * (index + 1)
        const cy = y + h * 0.58
        ctx.save()
        ctx.beginPath()
        ctx.rect(cx - w * 0.06, cy - h * 0.2, w * 0.12 * reveal, h * 0.4)
        ctx.clip()
        ctx.fillStyle = `rgba(${Math.round(200 - index * 6)},${Math.round(186 - index * 4)},${Math.round(160 - index * 3)},${0.55 + 0.4 * reveal})`
        ctx.fillText(char, cx, cy)
        ctx.restore()
        // 石屑
        if (reveal < 1) {
          for (let d = 0; d < 8; d += 1) {
            ctx.fillStyle = 'rgba(200,190,170,0.35)'
            ctx.fillRect(cx + (Math.random() - 0.5) * 40, cy + Math.random() * 40, 1.6, 1.6)
          }
        }
      })
      // 风化的粒子
      dust.forEach((item, index) => {
        const py = (item.y + t * 30 * (item.speed / 10) + index * 7) % H
        const px = item.x + Math.sin(t * 2 + index) * 10
        ctx.fillStyle = 'rgba(180,168,146,0.14)'
        ctx.fillRect(px, py, item.size, item.size)
      })
      ctx.fillStyle = 'rgba(200,160,99,0.35)'
      ctx.font = '400 12px "Noto Serif SC", serif'
      ctx.textAlign = 'center'
      ctx.fillText('村口 · 老槐树底下', W / 2, y + h + 40)
    }

    const drawSeal = (t: number) => {
      const reveal = easeOut(clamp01((t - 0.72) / 0.2))
      if (reveal <= 0) return
      const size = Math.min(W, H) * 0.09
      const x = W / 2 + Math.min(W * 0.26, 260)
      const y = H * 0.72
      ctx.globalAlpha = reveal * 0.9
      ctx.strokeStyle = '#a32b2b'
      ctx.lineWidth = 2
      ctx.strokeRect(x - size / 2, y - size / 2, size, size)
      ctx.fillStyle = 'rgba(163,43,43,0.18)'
      ctx.fillRect(x - size / 2, y - size / 2, size, size)
      ctx.fillStyle = '#a32b2b'
      ctx.font = `500 ${Math.round(size * 0.4)}px "Noto Serif SC", serif`
      ctx.textAlign = 'center'
      ctx.fillText('档', x, y + size * 0.14)
      ctx.globalAlpha = 1
    }

    const drawWordRings = (t: number) => {
      const cx = W * 0.5
      const cy = H * 0.55
      for (let ring = 0; ring < 4; ring += 1) {
        const phase = clamp01((t - ring * 0.14) / 0.7)
        if (phase <= 0 || phase >= 1) continue
        ctx.beginPath()
        ctx.strokeStyle = `rgba(200,160,99,${0.4 * (1 - phase)})`
        ctx.lineWidth = 1.4
        ctx.arc(cx, cy, 30 + phase * Math.min(W, H) * 0.42, 0, Math.PI * 2)
        ctx.stroke()
      }
      const chars = ['我', '们', '是', '通', '城', '人']
      ctx.textAlign = 'center'
      chars.forEach((char, index) => {
        const appear = clamp01((t - 0.28 - index * 0.07) / 0.2)
        if (appear <= 0) return
        ctx.globalAlpha = appear * 0.85
        ctx.fillStyle = '#e7dfcf'
        ctx.font = '400 30px "Noto Serif SC", serif'
        ctx.fillText(char, W / 2 - 90 + index * 36, H * 0.36)
      })
      ctx.globalAlpha = 1
    }

    const draw = (t: number) => {
      drawBackground()
      const kindMap: Record<string, () => void> = {
        roster: () => {
          drawGlyphRain(t)
          drawRosterTable(t)
        },
        letters: () => drawPapers(t),
        flag: () => drawFlag(t),
        photo: () => drawPhoto(t),
        testimony: () => drawTestimony(t),
        message: () => drawMessage(t),
      }
      if (kind in kindMap) {
        kindMap[kind]()
      } else if (kind === 'archive') {
        drawGlyphRain(t, 0.7)
        ctx.save()
        ctx.globalAlpha = 0.8
        drawRosterTable(t)
        ctx.restore()
        drawTestimony(t * 0.85)
        drawSeal(t)
      } else if (kind === 'relics') {
        drawPapers(t * 0.85)
        ctx.save()
        ctx.globalAlpha = 0.85
        drawPhoto(t)
        ctx.restore()
      } else if (kind === 'wordofmouth') {
        drawFlag(t)
        drawWordRings(t)
      }
      // 暗角
      const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, 'rgba(0,0,0,0.72)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, W, H)
    }

    const cleanup = () => {
      window.removeEventListener('keydown', onKey)
      // 卸载时把待触发的定时器一起清掉：跳过/切屏后不再回调已卸载的组件
      for (const id of timersRef.current) window.clearTimeout(id)
      timersRef.current = []
    }

    if (reduce) {
      // 无障碍：把最终帧画出来停住（CSS 里不能把画布藏掉，否则只剩一块黑），1.2s 后自动进正文
      draw(1)
      later(finish, 1200)
      return cleanup
    }

    const started = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const t = clamp01((now - started) / DURATION)
      draw(t)
      if (t >= 1) {
        finish()
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [kind])

  return (
    <div
      className={`finale ${leaving ? 'finale-out' : ''}`}
      role="presentation"
      onClick={() => {
        if (doneRef.current) return
        doneRef.current = true
        setLeaving(true)
        later(() => onDoneRef.current(), 520)
      }}
    >
      <canvas ref={canvasRef} className="finale-canvas" aria-hidden="true" />
      {/* 用真按钮而不是 <span>：键盘用户有一个可见焦点，Enter/空格能跳过，读屏也读得到 */}
      <button
        type="button"
        className="finale-skip"
        aria-label="跳过这段画面"
        autoFocus
        onClick={() => {
          if (doneRef.current) return
          doneRef.current = true
          setLeaving(true)
          later(() => onDoneRef.current(), 520)
        }}
      >
        点击跳过这段画面
      </button>
    </div>
  )
}

/** 结局种类 → 终极画面标签（用于结束页的「重看一遍」按钮文案） */
export const FINALE_LABEL: Record<EndingKind, string> = {
  roster: '名字的雨',
  letters: '纸页与一封信',
  flag: '风里的红布',
  photo: '显影',
  testimony: '录进带子里的名字',
  message: '石面上凿出的六个字',
  archive: '名字与声音互证',
  relics: '字与人',
  wordofmouth: '一个给眼睛，一个给耳朵',
}

export type { CompositeKind, EndingKind, MemoryKind }
