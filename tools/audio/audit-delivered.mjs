/**
 * 交付素材审计：解码 public/audio/*.ogg，量真实响度/峰值/瞬态/频谱/循环接缝，
 * 再按前端总线增益折算「实际听到的电平」，跟设计目标比。
 *
 * 只用 ffmpeg 解码 + 本文件里的 FFT，不装任何 npm 依赖。
 *
 *   node tools/audio/audit-delivered.mjs            # 打表 + 写 docs/audio/audit-loudness.json
 *   node tools/audio/audit-delivered.mjs --json     # 只写 JSON
 *
 * 口径（重要）：所有响度都按 post.py 的口径——跨声道取均方，
 *  mono 与 stereo 可以直接比；双声道做求和下混会量高约 +3 dB。
 *
 * 指标：
 *   rms_dbfs     全文件 RMS（循环床的响度基准）
 *   st_max_dbfs  最响 100ms 的 RMS（单次音「听到的那一下」）
 *   peak_dbfs    采样峰值
 *   crest_db     峰值 - RMS（瞬态锐度；太高在笔记本喇叭上会刺）
 *   tail_db      最后 300ms RMS 相对 st_max（太低=太干，没有尾巴）
 *   centroid_hz  频谱重心（亮/闷）
 *   seam_*       循环接缝：首尾步进的分位数、首尾 50ms 电平差
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const MANIFEST = path.join(ROOT, 'docs', 'audio', 'audio-manifest.json')
const OUT = path.join(ROOT, 'docs', 'audio', 'audit-loudness.json')
const SR = 48000

const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-9))

/**
 * 前端总线：与 src/game/audio.ts 保持一致（改那边也要改这里）。
 * 逐条补偿 = 把素材拉到 REF_RMS，再由总线推到 TARGET —— 所以「补偿后电平」
 * 这一列应该整整齐齐落在 -37 / -36；不齐就是有素材没接上。
 */
const MASTER_GAIN = 0.9
const REF_RMS = { ambience: -32, drone: -34 }
const TARGET = { ambience: -37.0, drone: -36.0, sfxStMax: -25.0, accent: -44.0 }
const dbToGain = (db) => 10 ** (db / 20)
const busGain = (target, ref) => dbToGain(target - ref - toDb(MASTER_GAIN))
const BUS = {
  sfx: 0.6,
  ambience: busGain(TARGET.ambience, REF_RMS.ambience),
  drone: busGain(TARGET.drone, REF_RMS.drone),
  accent: busGain(TARGET.accent, REF_RMS.ambience),
}
const trimDbFor = (group, rmsDbfs) => {
  const ref = REF_RMS[group]
  if (ref === undefined || rmsDbfs === null) return 0
  return Math.min(12, Math.max(-6, ref - rmsDbfs))
}

/** 解码成交错 f32，声道数按文件原样（见文件头「口径」） */
function decode(file, channels) {
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', String(channels),
      '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 28 },
  )
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}

/** 帧能量：一帧所有声道的平方和 */
function frameEnergy(samples, channels) {
  const n = Math.floor(samples.length / channels)
  const e = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    let s = 0
    for (let c = 0; c < channels; c += 1) {
      const v = samples[i * channels + c]
      s += v * v
    }
    e[i] = s
  }
  return e
}

const rmsOf = (e, ch, a = 0, b = e.length) => {
  let s = 0
  for (let i = a; i < b; i += 1) s += e[i]
  return Math.sqrt(s / Math.max(1, (b - a) * ch))
}

/** 最响 100ms 的 RMS（滑动能量和） */
function stMax(e, ch, winS = 0.1) {
  const n = Math.max(1, Math.round(winS * SR))
  if (e.length <= n) return rmsOf(e, ch)
  let acc = 0
  for (let i = 0; i < n; i += 1) acc += e[i]
  let best = acc
  for (let i = n; i < e.length; i += 1) {
    acc += e[i] - e[i - n]
    if (acc > best) best = acc
  }
  return Math.sqrt(best / (n * ch))
}

/** 就地 radix-2 FFT（复数用两个 Float64Array） */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

const N = 2048
const HOP = 2048
const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))

/** 每个声道各自做 STFT，幅度谱按声道平均；返回 5 个频段占比 + 频谱重心 */
function spectrum(samples, channels) {
  const nFrames = Math.floor(samples.length / channels)
  const acc = new Float64Array(N / 2)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  let frames = 0
  for (let off = 0; off + N <= nFrames; off += HOP) {
    for (let c = 0; c < channels; c += 1) {
      for (let i = 0; i < N; i += 1) {
        re[i] = samples[(off + i) * channels + c] * win[i]
        im[i] = 0
      }
      fft(re, im)
      for (let k = 0; k < N / 2; k += 1) acc[k] += Math.hypot(re[k], im[k]) / channels
    }
    frames += 1
  }
  if (!frames) return null
  for (let k = 0; k < N / 2; k += 1) acc[k] /= frames
  const binHz = SR / N
  const edges = [20, 60, 250, 1000, 4000, 16000]
  const bands = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]
    let s = 0
    for (let k = Math.ceil(lo / binHz); k < Math.min(N / 2, hi / binHz); k += 1) s += acc[k]
    return s
  })
  const total = bands.reduce((a, b) => a + b, 0) + 1e-12
  let num = 0
  let den = 0
  for (let k = 1; k < N / 2; k += 1) {
    num += acc[k] * k * binHz
    den += acc[k]
  }
  return { bands: bands.map((b) => b / total), centroid: den ? num / den : 0 }
}

/** 循环接缝：首尾帧的跨声道差 / 全文件步进分位数；首尾 50ms 电平差 */
function seam(samples, channels) {
  const n = Math.floor(samples.length / channels)
  const first = []
  const last = []
  const d = []
  for (let c = 0; c < channels; c += 1) {
    first.push(samples[c])
    last.push(samples[(n - 1) * channels + c])
  }
  let step = 0
  for (let c = 0; c < channels; c += 1) step += (first[c] - last[c]) ** 2
  step = Math.sqrt(step / channels)
  let prev = samples[0]
  for (let i = 1; i < n; i += 1) {
    const v = samples[i * channels]
    d.push(Math.abs(v - prev))
    prev = v
  }
  d.sort((a, b) => a - b)
  const below = d.filter((v) => v < step).length
  const k = Math.min(Math.round(0.05 * SR), Math.floor(n / 10))
  const e = frameEnergy(samples, channels)
  return {
    pct: Number(((below / Math.max(1, d.length)) * 100).toFixed(1)),
    step: Number(step.toFixed(5)),
    levelJumpDb: Number((toDb(rmsOf(e, channels, n - k, n)) - toDb(rmsOf(e, channels, 0, k))).toFixed(2)),
  }
}

function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const rows = []
for (const item of manifest.items) {
  const file = path.join(ROOT, item.file)
  if (!existsSync(file)) {
    console.log(`MISSING ${item.id} ${item.file}`)
    continue
  }
  const channels = item.channels === 2 ? 2 : 1
  const samples = decode(file, channels)
  const e = frameEnergy(samples, channels)
  const nFrames = e.length
  const r = rmsOf(e, channels)
  const st = stMax(e, channels)
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]))
  const tailN = Math.min(Math.round(0.3 * SR), Math.floor(nFrames / 4))
  const tail = rmsOf(e, channels, nFrames - tailN, nFrames)
  const sp = spectrum(samples, channels)
  const trim = trimDbFor(item.group, Number(toDb(r).toFixed(1)))
  const bus = item.group === 'ambience' ? BUS.ambience : item.group === 'drone' ? BUS.drone : BUS.sfx
  const chainDb = toDb(bus * MASTER_GAIN)
  const accentDb = toDb(BUS.accent * MASTER_GAIN)
  rows.push({
    id: item.id,
    group: item.group,
    loop: Boolean(item.loop),
    duration: Number((nFrames / SR).toFixed(2)),
    channels,
    kbytes: Number((item.bytes / 1024).toFixed(1)),
    rms_dbfs: Number(toDb(r).toFixed(1)),
    st_max_dbfs: Number(toDb(st).toFixed(1)),
    peak_dbfs: Number(toDb(peak).toFixed(1)),
    crest_db: Number((toDb(peak) - toDb(r)).toFixed(1)),
    tail_db: Number((toDb(tail) - toDb(st)).toFixed(1)),
    centroid_hz: sp ? Math.round(sp.centroid) : null,
    bands: sp ? sp.bands.map((v) => Number(v.toFixed(3))) : null,
    seam: item.loop ? seam(samples, channels) : null,
    trim_db: Number(trim.toFixed(1)),
    effective_dbfs: Number((toDb(item.loop ? r : st) + trim + chainDb).toFixed(1)),
    accent_dbfs: Number((toDb(item.loop ? r : st) + trim + accentDb).toFixed(1)),
    peak_after_trim_dbfs: Number((toDb(peak) + trim + chainDb).toFixed(1)),
    manifest_rms: item.rms_dbfs,
  })
  process.stdout.write('.')
}
console.log('')

const problems = []
for (const r of rows) {
  if (r.manifest_rms !== null && Math.abs(r.manifest_rms - r.rms_dbfs) > 1.0) {
    problems.push(`${r.id}: 交付文件 RMS ${r.rms_dbfs} 与清单 ${r.manifest_rms} 差 >1 dB（编码/后处理漂移）`)
  }
  if (r.loop && r.seam && r.seam.pct > 99) {
    problems.push(`${r.id}: 循环接缝在 ${r.seam.pct} 分位（会听见咔哒）`)
  }
  if (r.loop && r.seam && Math.abs(r.seam.levelJumpDb) > 6) {
    problems.push(`${r.id}: 循环接缝电平跳变 ${r.seam.levelJumpDb} dB（会听见呼吸/泵动，不能当床）`)
  }
  if (!r.loop && r.crest_db > 26) {
    problems.push(`${r.id}: 峰值因数 ${r.crest_db} dB（瞬态过锐，笔记本喇叭上会刺）`)
  }
  if (!r.loop && r.tail_db < -30) {
    problems.push(`${r.id}: 尾巴 ${r.tail_db} dB（很干，缺空间感）`)
  }
}

// 近重复：同组内频谱 + 时长都接近的成对（余弦 > 0.985）
const dups = []
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const a = rows[i]
    const b = rows[j]
    if (!a.bands || !b.bands || a.group !== b.group) continue
    const c = cosine(a.bands, b.bands)
    if (c > 0.985 && Math.abs(a.duration - b.duration) < 0.5) {
      dups.push({ a: a.id, b: b.id, cosine: Number(c.toFixed(4)) })
    }
  }
}

const ambience = rows.filter((r) => r.group === 'ambience')
const drone = rows.filter((r) => r.group === 'drone')
const sfx = rows.filter((r) => !r.loop)
const spread = (list) => Number((Math.max(...list) - Math.min(...list)).toFixed(1))
const summary = {
  files: rows.length,
  mix: {
    master: MASTER_GAIN,
    bus: Object.fromEntries(Object.entries(BUS).map(([k, v]) => [k, Number(toDb(v).toFixed(2))])),
    refs: REF_RMS,
    targets: TARGET,
    chain_db: Object.fromEntries(
      Object.entries(BUS).map(([k, v]) => [k, Number(toDb(v * MASTER_GAIN).toFixed(1))]),
    ),
  },
  ambience_effective_dbfs: {
    min: Math.min(...ambience.map((r) => r.effective_dbfs)),
    max: Math.max(...ambience.map((r) => r.effective_dbfs)),
    spread_db: spread(ambience.map((r) => r.effective_dbfs)),
    target: TARGET.ambience,
    trims_db: Object.fromEntries(ambience.map((r) => [r.id, r.trim_db])),
  },
  drone_effective_dbfs: {
    min: Math.min(...drone.map((r) => r.effective_dbfs)),
    max: Math.max(...drone.map((r) => r.effective_dbfs)),
    spread_db: spread(drone.map((r) => r.effective_dbfs)),
    target: TARGET.drone,
    trims_db: Object.fromEntries(drone.map((r) => [r.id, r.trim_db])),
  },
  sfx_effective_st_max_dbfs: {
    min: Math.min(...sfx.map((r) => r.effective_dbfs)),
    max: Math.max(...sfx.map((r) => r.effective_dbfs)),
    spread_db: spread(sfx.map((r) => r.effective_dbfs)),
    target: TARGET.sfxStMax,
    delta_db: Object.fromEntries(
      sfx.map((r) => [r.id, Number((r.effective_dbfs - TARGET.sfxStMax).toFixed(1))]),
    ),
  },
  accent_effective_dbfs: {
    min: Math.min(...ambience.map((r) => r.accent_dbfs)),
    max: Math.max(...ambience.map((r) => r.accent_dbfs)),
    target: TARGET.accent,
  },
  problems,
  near_duplicates: dups,
}

if (!process.argv.includes('--json')) {
  const pad = (s, n) => String(s).padEnd(n)
  console.log('id'.padEnd(22), pad('grp', 9), pad('loop', 5), pad('dur', 6), pad('rms', 7),
    pad('stMax', 7), pad('peak', 7), pad('crest', 6), pad('tail', 7), pad('cent', 6),
    pad('trim', 6), pad('eff', 7), pad('peak*', 7), 'seam')
  for (const r of rows) {
    console.log(
      pad(r.id, 22), pad(r.group, 9), pad(r.loop ? 'yes' : '-', 5), pad(r.duration, 6),
      pad(r.rms_dbfs, 7), pad(r.st_max_dbfs, 7), pad(r.peak_dbfs, 7), pad(r.crest_db, 6),
      pad(r.tail_db, 7), pad(r.centroid_hz, 6), pad(r.trim_db, 6), pad(r.effective_dbfs, 7),
      pad(r.peak_after_trim_dbfs, 7),
      r.seam ? `pct ${r.seam.pct} jump ${r.seam.levelJumpDb}dB` : '',
    )
  }
  console.log('\n总线（dB，文件 → destination）:', summary.mix.chain_db)
  console.log('ambience 补偿后电平:', summary.ambience_effective_dbfs)
  console.log('drone 补偿后电平:', summary.drone_effective_dbfs)
  console.log('SFX 瞬态电平:', summary.sfx_effective_st_max_dbfs)
  console.log('点缀总线电平:', summary.accent_effective_dbfs)
  if (dups.length) console.log('近重复:', dups)
  console.log('\n问题:')
  for (const p of problems) console.log(' -', p)
}

writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), summary, rows }, null, 2))
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
