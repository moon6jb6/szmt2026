import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 生成「质检失败」的入屏图重试批次：同 prompt、seed+1000、输出到 D:/AI大模型/art-work。
 * 用法：node tools/imagegen/make-retry.mjs scene-056 scene-060 ...
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const MANIFEST = path.join(ROOT, 'docs', 'art', 'image-manifest.json')
const OUT = path.join(ROOT, 'tools', 'imagegen', 'retry-ui.json')

const ids = process.argv.slice(2)
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const byId = new Map(manifest.map((item) => [item.id, item]))

const jobs = []
for (const id of ids) {
  const item = byId.get(id)
  if (!item) {
    console.warn('[skip] manifest 里没有', id)
    continue
  }
  jobs.push({
    prompt: item.prompt,
    negative: item.negative,
    seed: (item.seed ?? 1) + 1000,
    steps: item.steps ?? 4,
    guidance: item.guidance ?? 0,
    width: 768,
    height: item.category === 'ending' || item.category === 'scene' ? 432 : 768,
    out: `D:/AI大模型/art-work/${id}.jpg`,
  })
}

await writeFile(OUT, JSON.stringify(jobs, null, 2), 'utf8')
console.log(`retry-ui: ${jobs.length} 张 -> ${path.relative(ROOT, OUT)}`)
console.log(jobs.map((job) => job.out.split('/').pop()).join(', '))
