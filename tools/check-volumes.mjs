import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const CONTENT = path.join(ROOT, 'src', 'game', 'content')
const FILES = ['chapter1.ts', 'volume0.ts', 'volume1.ts', 'volume2.ts', 'volume3.ts', 'volume4.ts', 'volume5.ts']

/**
 * 静态校验（不执行 TS，用正则提取）：
 * 1. 所有 id 唯一；
 * 2. 所有 next / continueTo 指向存在的场景（结局页除外）；
 * 3. 所有 sources id 在 sources.ts / sources.auto.ts 里存在；
 * 4. 统计孤立场景（没有任何场景指向它，且不是入口）。
 */
const sceneIds = new Set()
const nextTargets = []
const sourceRefs = []
const idCount = new Map()

for (const file of FILES) {
  let raw = ''
  try {
    raw = await readFile(path.join(CONTENT, file), 'utf8')
  } catch {
    continue
  }
  // 只认场景 id（紧跟 chapter 字段），避免把 Choice.id 也算成场景
  for (const m of raw.matchAll(/\bid:\s*'([^']+)',\s*\n\s*chapter:/gu)) {
    const id = m[1]
    idCount.set(id, (idCount.get(id) ?? 0) + 1)
    sceneIds.add(id)
  }
  for (const m of raw.matchAll(/\bnext:\s*'([^']+)'/gu)) nextTargets.push({ file, target: m[1] })
  for (const m of raw.matchAll(/\bcontinueTo:\s*'([^']+)'/gu)) nextTargets.push({ file, target: m[1] })
  for (const m of raw.matchAll(/sources:\s*\[([^\]]*)\]/gu)) {
    for (const idm of m[1].matchAll(/'([^']+)'/gu)) sourceRefs.push({ file, id: idm[1] })
  }
}

const sourceIds = new Set()
for (const file of ['sources.ts', 'sources.auto.ts']) {
  const raw = await readFile(path.join(CONTENT, file), 'utf8')
  // sources.ts 用单引号，sources.auto.ts 是 JSON 生成文件用双引号，两种都要认
  for (const m of raw.matchAll(/\bid["']?\s*:\s*["']([^"']+)["']/gu)) sourceIds.add(m[1])
}

const errors = []
const seen = new Set()
for (const [id, count] of idCount) {
  if (count > 1) errors.push(`重复场景 id：${id}（出现 ${count} 次）`)
  if (seen.has(id)) continue
  seen.add(id)
}

for (const { file, target } of nextTargets) {
  if (target.startsWith('ending_')) continue
  if (!sceneIds.has(target)) errors.push(`${file}：next 指向不存在的场景 ${target}`)
}

for (const { file, id } of sourceRefs) {
  if (!sourceIds.has(id)) errors.push(`${file}：sources 引用了不存在的史料卡 ${id}`)
}

const targets = new Set(nextTargets.map((item) => item.target))
const entries = new Set(['prologue', 'v0-01', 'v1-01'])
const orphans = [...sceneIds].filter((id) => !targets.has(id) && !entries.has(id))

console.log('===== 场景结构校验 =====')
console.log(`场景总数：${sceneIds.size}`)
console.log(`next / continueTo 引用：${nextTargets.length}`)
console.log(`sources 引用：${sourceRefs.length}`)
console.log(`未被指向的场景（可能是入口或孤立）：${orphans.length ? orphans.join('、') : '无'}`)
if (errors.length) {
  console.log(`\n发现 ${errors.length} 个问题：`)
  for (const err of errors) console.log(' -', err)
  process.exitCode = 1
} else {
  console.log('\n通过：id 唯一、next 全部有效、史料卡引用全部存在。')
}
