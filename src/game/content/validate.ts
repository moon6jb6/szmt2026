import type { SceneId } from '../types'
import { SCENES } from './registry'
import { SOURCE_MAP, SOURCES } from './sources'

/**
 * 史料卡自检（仅开发环境运行，不进入生产构建）
 *
 * 目的：以后往 sources.ts 里加文献时，只要数据填错，启动就会在控制台报出来，
 * 不用等人工发现「场景引用了不存在的卡」。
 */
export function validateSources(): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  // 场景 id 白名单：正文场景 + 六个结局页 + 关于页（收集模板会用到这些分组）
  const sceneIds = new Set<string>([
    ...Object.keys(SCENES),
    'ending_names',
    'ending_letters',
    'ending_flag',
    'ending_photo',
    'ending_testimony',
    'ending_message',
    'about',
  ])

  for (const card of SOURCES) {
    if (ids.has(card.id)) errors.push(`重复 id：${card.id}`)
    ids.add(card.id)

    if (!card.work) errors.push(`${card.id} 缺 work（所属文献）`)
    if (!card.claim) errors.push(`${card.id} 缺 claim（这条依据支持什么）`)

    if (card.status === 'verified') {
      if (!card.claim) errors.push(`已核对卡缺 claim：${card.id}`)
      if (!card.locator && !card.edition) errors.push(`已核对卡缺定位（locator/edition）：${card.id}`)
    }

    if (card.status === 'needed' && !card.locator?.startsWith('待补')) {
      errors.push(`待接入卡应写明「待补：…」：${card.id}`)
    }

    for (const scene of card.scenes) {
      if (!sceneIds.has(scene)) errors.push(`${card.id} 引用了不存在的场景：${scene}`)
    }
  }

  for (const [sceneId, scene] of Object.entries(SCENES)) {
    for (const sourceId of scene.sources ?? []) {
      const card = SOURCE_MAP.get(sourceId)
      if (!card) {
        errors.push(`场景 ${sceneId} 引用了不存在的史料卡：${sourceId}`)
      } else if (card.status !== 'verified') {
        errors.push(`场景 ${sceneId} 引用了未核实的史料卡：${sourceId}`)
      }
    }
  }

  // 结局页引用的出处也要能查到
  const endingSourceIds = new Set<string>()
  for (const id of endingSourceIds) {
    if (!ids.has(id)) errors.push(`结局引用了不存在的史料卡：${id}`)
  }

  return errors
}

/** 供开发时使用：场景 → 卡片数量的快速统计 */
export function sourceCoverage(): { total: number; verified: number; needed: number; scenes: number } {
  return {
    total: SOURCES.length,
    verified: SOURCES.filter((card) => card.status === 'verified').length,
    needed: SOURCES.filter((card) => card.status === 'needed').length,
    scenes: new Set(SOURCES.flatMap((card) => card.scenes as SceneId[])).size,
  }
}
