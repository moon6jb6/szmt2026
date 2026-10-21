/**
 * GLB 静态体检（不启浏览器）：直接读二进制的 JSON chunk + BIN chunk
 *
 * 用法：node tools/3d/inspect-glb.mjs [path]
 * 输出：三角面数、primitive 数（= draw calls）、材质、贴图、包围盒、doubleSided、
 *      索引数据类型、是否有 KHR 扩展 / 相机 / 灯 —— 这些决定了 three.js 里
 *      「朝向、比例、落地、色彩空间、背面剔除」到底该是什么。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'public/models/warehouse-ext.glb')

const buf = await readFile(file)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB：magic 不匹配')
const version = buf.readUInt32LE(4)
const total = buf.readUInt32LE(8)

let offset = 12
let json = null
let bin = null
const chunks = []
while (offset < buf.length) {
  const len = buf.readUInt32LE(offset)
  const type = buf.readUInt32LE(offset + 4)
  const data = buf.subarray(offset + 8, offset + 8 + len)
  chunks.push({ type: type === 0x4e4f534a ? 'JSON' : type === 0x004e4942 ? 'BIN' : `0x${type.toString(16)}`, len })
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data))
  if (type === 0x004e4942) bin = data
  offset += 8 + len
  offset += (4 - (offset % 4)) % 4
}

const g = json
const componentSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const typeCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

const accessorBytes = (i) => {
  const a = g.accessors[i]
  return a.count * typeCount[a.type] * componentSize[a.componentType]
}

let triangles = 0
let primitives = 0
const materialUse = new Map()
for (const mesh of g.meshes ?? []) {
  for (const prim of mesh.primitives) {
    primitives += 1
    const mode = prim.mode ?? 4
    if (mode !== 4) throw new Error(`非三角形图元 mode=${mode}`)
    const count = prim.indices !== undefined ? g.accessors[prim.indices].count : g.accessors[prim.attributes.POSITION].count
    triangles += count / 3
    materialUse.set(prim.material, (materialUse.get(prim.material) ?? 0) + 1)
  }
}

// POSITION 的 min/max（glTF 规范要求必填，正好当包围盒用；不含节点变换，本资产节点为 identity）
const pos = []
for (const mesh of g.meshes ?? []) {
  for (const prim of mesh.primitives) {
    const a = g.accessors[prim.attributes.POSITION]
    pos.push({ min: a.min, max: a.max, count: a.count })
  }
}
const bbox = pos.reduce(
  (acc, p) => ({
    min: [Math.min(acc.min[0], p.min[0]), Math.min(acc.min[1], p.min[1]), Math.min(acc.min[2], p.min[2])],
    max: [Math.max(acc.max[0], p.max[0]), Math.max(acc.max[1], p.max[1]), Math.max(acc.max[2], p.max[2])],
  }),
  { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
)
const size = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]]

const materials = (g.materials ?? []).map((m, i) => {
  const pbr = m.pbrMetallicRoughness ?? {}
  return {
    i,
    name: m.name ?? `mat${i}`,
    doubleSided: !!m.doubleSided,
    baseColorTexture: pbr.baseColorTexture ? g.textures[pbr.baseColorTexture.index]?.source : null,
    normalTexture: m.normalTexture ? g.textures[m.normalTexture.index]?.source : null,
    metallicRoughnessTexture: pbr.metallicRoughnessTexture
      ? g.textures[pbr.metallicRoughnessTexture.index]?.source
      : null,
    baseColorFactor: pbr.baseColorFactor ?? null,
    metallic: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
    alphaMode: m.alphaMode ?? 'OPAQUE',
    emissive: m.emissiveFactor ?? null,
    primitives: materialUse.get(i) ?? 0,
  }
})

const images = (g.images ?? []).map((img, i) => ({
  i,
  name: img.name ?? `img${i}`,
  mimeType: img.mimeType ?? '(bufferView)',
  bytes: img.bufferView !== undefined ? g.bufferViews[img.bufferView].byteLength : null,
  uri: img.uri ? String(img.uri).slice(0, 48) : null,
}))

const report = {
  file: path.relative(root, file).replace(/\\/g, '/'),
  bytes: buf.length,
  glbVersion: version,
  declaredLength: total,
  chunks,
  asset: g.asset,
  extensionsUsed: g.extensionsUsed ?? [],
  extensionsRequired: g.extensionsRequired ?? [],
  counts: {
    nodes: (g.nodes ?? []).length,
    meshes: (g.meshes ?? []).length,
    primitives,
    triangles,
    materials: materials.length,
    textures: (g.textures ?? []).length,
    images: images.length,
    cameras: (g.cameras ?? []).length,
    skins: (g.skins ?? []).length,
    animations: (g.animations ?? []).length,
  },
  nodeTransforms: (g.nodes ?? []).map((n) => ({
    name: n.name,
    mesh: n.mesh,
    translation: n.translation ?? null,
    rotation: n.rotation ?? null,
    scale: n.scale ?? null,
    matrix: n.matrix ?? null,
    children: n.children ?? [],
  })),
  bbox: { min: bbox.min, max: bbox.max, size },
  /** 立面朝向：z 收敛到 0 附近的一侧是外皮；本资产外皮 z≈0，屋面往 −z */
  facing: bbox.max[2] - bbox.min[2] < 20 ? '+Z（外皮 z≈0，屋面 −Z）' : '需人工确认',
  binBytes: bin?.length ?? 0,
  vertexBytes: (g.meshes ?? []).reduce(
    (sum, mesh) => sum + mesh.primitives.reduce((s, prim) => s + accessorBytes(prim.attributes.POSITION), 0),
    0,
  ),
  indexBytes: (g.meshes ?? []).reduce((sum, mesh) => sum + mesh.primitives.reduce((s, prim) => s + (prim.indices !== undefined ? accessorBytes(prim.indices) : 0), 0), 0),
  materials,
  images,
  doubleSidedMaterials: materials.filter((m) => m.doubleSided).length,
  textureBytes: images.reduce((sum, img) => sum + (img.bytes ?? 0), 0),
  /** 顶点属性里有没有 TANGENT：没有的话 three 会用屏幕导数算法线切线，法线贴图略糊 */
  primitivesWithoutTangent: (g.meshes ?? []).reduce(
    (n, mesh) => n + mesh.primitives.filter((prim) => prim.attributes.TANGENT === undefined).length,
    0,
  ),
  primitiveAttributes: [...new Set((g.meshes ?? []).flatMap((mesh) => mesh.primitives.flatMap((prim) => Object.keys(prim.attributes))))].sort(),
}

console.log(JSON.stringify(report, null, 2))
