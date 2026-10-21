import { readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把 art-director 的 scene-map.json 转成前端可用的 TS 映射。
 * scene-map 格式：{ "v2-13": { "image": "public/art/scene-046.jpg", ... } }
 * 输出：src/game/content/sceneImages.ts
 *    export const SCENE_IMAGES: Record<string, string> = { "v2-13": "/art/scene-046.jpg", ... }
 *
 * 只有 public/art 下真实存在的图才写入映射，避免 404/裂图。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const MAP = path.join(ROOT, 'docs', 'art', 'scene-map.json')
const OUT = path.join(ROOT, 'src', 'game', 'content', 'sceneImages.ts')
const ART = path.join(ROOT, 'public', 'art')

let raw
try {
  raw = JSON.parse(await readFile(MAP, 'utf8'))
} catch {
  console.log('[skip] scene-map.json 不存在，写入空映射')
  raw = {}
}

const entries = []
let missing = 0
for (const [sceneId, meta] of Object.entries(raw)) {
  // 相对路径（不带前导 /），配合 vite base:'./'，子目录部署与 file 服务都能找到
  const image = String(meta.image ?? '').replace(/^public\//u, '')
  const filename = image.replace(/^\/?art\//u, '')
  try {
    await access(path.join(ART, filename))
    entries.push([sceneId, image])
  } catch {
    missing += 1
  }
}

const body = `// 由 tools/art/build-scene-images.mjs 自动生成，请勿手改
// 来源：docs/art/scene-map.json（art-director 维护）；只包含 public/art 下真实存在的图
export const SCENE_IMAGES: Record<string, string> = ${JSON.stringify(Object.fromEntries(entries), null, 2)}
`

await writeFile(OUT, body, 'utf8')
console.log(`sceneImages.ts: ${entries.length} 条（跳过缺失 ${missing} 条）-> ${path.relative(ROOT, OUT)}`)
