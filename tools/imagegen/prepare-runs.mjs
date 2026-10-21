import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把 500 条 manifest 转成「加速出图」的连续批次：
 * - 跳过 public/art 里已经存在的 id（pilot 已生成的）；
 * - 16:9 类降到 960×540；竖图 704×960；方图 896×896（约省 20—25% 时间）；
 * - hero 类（scene/moment/ending）4 步；其余 3 步；
 * - 按优先级排序：moment → ending → scene → atmo → artifact → figure → ui；
 * - 每 100 张一个 chunk，便于中途检查与质检。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const ART = path.join(ROOT, 'public', 'art')
const LOCAL_OUT = 'D:/AI大模型/art-work'
const MANIFEST = path.join(ROOT, 'docs', 'art', 'image-manifest.json')
const OUT_DIR = path.join(ROOT, 'tools', 'imagegen', 'batches-run')

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const existing = new Set((await readdir(ART).catch(() => [])).map((f) => f.replace(/\.jpg$/u, '')))
for (const f of await readdir(LOCAL_OUT).catch(() => [])) {
  if (f.endsWith('.jpg')) existing.add(f.replace(/\.jpg$/u, ''))
}
const existingJson = new Set(
  (await readdir(ART).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/u, '')),
)

// --all：忽略已生成文件（用于 prompt 大版本更新后全量重跑，例如 r1→r2）
if (process.argv.includes('--all')) {
  existing.clear()
  existingJson.clear()
}

const PRIORITY = ['moment', 'ending', 'scene', 'atmo', 'artifact', 'figure', 'ui']
const HERO = new Set(['scene', 'moment', 'ending'])

const items = manifest
  .filter((item) => !existing.has(item.id) && !existingJson.has(item.id))
  .sort((a, b) => PRIORITY.indexOf(a.category) - PRIORITY.indexOf(b.category) || String(a.id).localeCompare(String(b.id)))

function sizeFor(item) {
  // UI 里横幅最高显示 340px，768×432 足够；小尺寸换速度（8GB 显存 + 内存吃紧）
  if (item.category === 'figure') return { width: 576, height: 768 }
  if (item.category === 'ui') return { width: 768, height: 768 }
  if (item.category === 'artifact') return { width: 768, height: 768 }
  return { width: 768, height: 432 }
}

const jobs = items.map((item) => {
  const size = sizeFor(item)
  return {
    prompt: item.prompt,
    negative: item.negative,
    seed: item.seed,
    steps: HERO.has(item.category) ? 4 : 3,
    guidance: item.guidance ?? 0,
    width: size.width,
    height: size.height,
    out: `${LOCAL_OUT}/${item.id}.jpg`,
  }
})

await readdir(OUT_DIR).catch(async () => {
  await import('node:fs/promises').then(({ mkdir }) => mkdir(OUT_DIR, { recursive: true }))
})

const CHUNK = 100
let chunkIndex = 1
for (let i = 0; i < jobs.length; i += CHUNK) {
  const chunk = jobs.slice(i, i + CHUNK)
  const file = path.join(OUT_DIR, `run-${String(chunkIndex).padStart(3, '0')}.json`)
  await writeFile(file, JSON.stringify(chunk, null, 2), 'utf8')
  console.log(`run-${String(chunkIndex).padStart(3, '0')}: ${chunk.length} 张 -> ${path.relative(ROOT, file)}`)
  chunkIndex += 1
}

console.log(`\n待生成 ${jobs.length} 张（已跳过 pilot ${existing.size} 张），共 ${chunkIndex - 1} 个 chunk`)
const byCat = {}
for (const item of items) byCat[item.category] = (byCat[item.category] ?? 0) + 1
console.log('分类：', JSON.stringify(byCat))
