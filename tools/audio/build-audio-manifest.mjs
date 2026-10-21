import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * docs/audio/audio-manifest.json → src/game/content/audioManifest.ts
 * 只保留前端需要的字段，避免把整份生成参数（seed/prompt/频谱）打进包。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const SRC = path.join(ROOT, 'docs', 'audio', 'audio-manifest.json')
const OUT = path.join(ROOT, 'src', 'game', 'content', 'audioManifest.ts')

const manifest = JSON.parse(await readFile(SRC, 'utf8'))
const items = (manifest.items ?? []).map((item) => ({
  id: item.id,
  file: String(item.file).replace(/^public\//u, ''),
  group: item.group,
  duration: item.duration_s,
  loop: Boolean(item.loop),
  use: item.use ?? '',
}))

const body = `// 由 tools/audio/build-audio-manifest.mjs 自动生成，请勿手改
// 来源：docs/audio/audio-manifest.json（audio-owner 生成）
export type AudioGroup = 'carrier' | 'material' | 'ambience' | 'drone'

export type AudioEntry = {
  id: string
  /** 相对路径，播放时拼 import.meta.env.BASE_URL */
  file: string
  group: AudioGroup
  duration: number
  loop: boolean
  use: string
}

export const AUDIO_MANIFEST: Record<string, AudioEntry> = ${JSON.stringify(
  Object.fromEntries(items.map((item) => [item.id, item])),
  null,
  2,
)}

export const AUDIO_IDS: string[] = ${JSON.stringify(items.map((item) => item.id))}
`

await writeFile(OUT, body, 'utf8')
const groups = items.reduce((acc, item) => {
  acc[item.group] = (acc[item.group] ?? 0) + 1
  return acc
}, {})
console.log(`audioManifest.ts: ${items.length} 条`, groups)
