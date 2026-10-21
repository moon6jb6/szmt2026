import type { Ledger, Scene, SceneId } from '../types'
import { SCENES as BASE_SCENES, buildEpilogue } from './chapter1'
import { VOLUME0 } from './volume0'
import { VOLUME1 } from './volume1'
import { VOLUME2 } from './volume2'
import { VOLUME3 } from './volume3'
import { VOLUME4 } from './volume4'
import { VOLUME5 } from './volume5'

/**
 * 全场景注册表
 *
 * - 基础五夜在 chapter1.ts
 * - 扩写卷在 volume0—5.ts
 * - 合并后按 id 去重；同 id 时后加载的卷覆盖前面的（便于逐卷迭代）
 *
 * 写作者只写自己的 volume 文件，集成只改这里和 App。
 */
const ALL_SCENES: Scene[] = [
  ...Object.values(BASE_SCENES),
  ...VOLUME0,
  ...VOLUME1,
  ...VOLUME2,
  ...VOLUME3,
  ...VOLUME4,
  ...VOLUME5,
]

export const SCENES: Record<string, Scene> = {}
for (const scene of ALL_SCENES) {
  SCENES[scene.id] = scene
}

export const SCENE_IDS: string[] = Object.keys(SCENES)
export const SCENE_COUNT = SCENE_IDS.length

/** 结局页不是 Scene，返回 null，由 App 用 ENDINGS 渲染 */
export function getScene(id: SceneId, ledger: Ledger): Scene | null {
  if (id.startsWith('ending_')) return null
  if (id === 'epilogue') return buildEpilogue(ledger)
  return SCENES[id] ?? null
}
