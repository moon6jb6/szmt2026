import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 保底批次：04:45 若 gen_fast 仍不可用，用 gen.py 默认 offload 跑 120 张。
 * 选择：ending 30 张 + scene 40 张（v0/v1/5 优先）+ moment 50 张。
 * 输出：D:/AI大模型/art-work/
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const MANIFEST = path.join(ROOT, 'docs', 'art', 'image-manifest.json')
const OUT = path.join(ROOT, 'tools', 'imagegen', 'fallback-120.json')

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const byCat = (cat) => manifest.filter((item) => item.category === cat)

const picked = [
  ...byCat('ending').slice(0, 30),
  ...byCat('scene').slice(0, 40),
  ...byCat('moment').slice(0, 50),
]

const jobs = picked.map((item) => ({
  prompt: item.prompt,
  negative: item.negative,
  seed: item.seed,
  steps: 4,
  guidance: item.guidance ?? 0,
  width: 960,
  height: 544,
  out: `D:/AI大模型/art-work/${item.id}.jpg`,
}))

await writeFile(OUT, JSON.stringify(jobs, null, 2), 'utf8')
console.log(`fallback-120: ${jobs.length} 张 -> ${path.relative(ROOT, OUT)}`)
console.log('分类：', JSON.stringify(picked.reduce((acc, item) => { acc[item.category] = (acc[item.category] ?? 0) + 1; return acc }, {})))
