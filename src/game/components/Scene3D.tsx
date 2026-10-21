/**
 * 3D 切片（plain three，不用 R3F）
 *
 * 硬预算：每切片 ≤ 6000 三角面、≤ 25 draw calls、DPR ≤ 2、桌面 55fps+。
 * 做法：
 *  - 重复的实体一律 InstancedMesh（沙袋 / 木箱 / 柱梁 / 栏杆 / 楼群）
 *  - 一次性的组合体先把 BoxGeometry 合并成单个 BufferGeometry（桌子 / 枪架 / 竹竿）
 *  - 不用阴影贴图：一盏带影光要多渲染一遍场景，draw calls 直接翻倍，25 内放不下；
 *    落地感用「接触阴影贴片 + 光池 + 雾」代替
 *  - 动画只改 attribute / 矩阵 / 光照强度，循环里不 new
 *
 * 相机：指针驱动 yaw ±18°、pitch ±14°，阻尼 0.08（按 60fps 归一到帧率无关），
 * 滚轮不劫持（本组件不监听 wheel，也不在 canvas 上 preventDefault）。
 *
 * 回退：WebGL 不可用 → 什么都不画，保留父层背景；prefers-reduced-motion → 只画静态帧、
 * 不做环境动画（App 侧本应直接走 2.5D）。屏幕 < 700px 的判断交给 App。
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { SCENE_3D_BACKDROP, type Scene3DVariant } from '../content/scene3d'

const DEG = Math.PI / 180
const MAX_YAW = 18 * DEG
const MAX_PITCH = 14 * DEG
const DAMP = 0.08
const MAX_DPR = 2

/**
 * 打开 three 的加载缓存：GLB（470 KB）与远景贴图都走 FileLoader，
 * 第二次进入同一切片时直接从内存拿，不再发一次 304 往返。
 * 缓存上限就是这几个文件，约 0.5 MB 常驻，可接受。
 */
THREE.Cache.enabled = true

/** 与 styles.css :root 同一套色板（旗帜红 / 铁锈 / 沙金 / 烟黑 / 纸白） */
const PALETTE = {
  ink: 0x16130f,
  inkSoft: 0x211b16,
  paper: 0xede6d8,
  paperDim: 0xbdb3a2,
  red: 0xa32b2b,
  redDeep: 0x6f1c1c,
  rust: 0x7a3e2e,
  gold: 0xc8a063,
} as const

type Disposable = { dispose(): void }
type Track = <T extends Disposable>(x: T) => T

type Slice = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  baseYaw: number
  basePitch: number
  exposure: number
  tick: (time: number, dt: number) => void
  dispose: () => void
}

type Inst = {
  x: number
  y: number
  z: number
  sx?: number
  sy?: number
  sz?: number
  rx?: number
  ry?: number
  rz?: number
}

// ---------------------------------------------------------------- 小工具（构建期用，循环里不调）

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** 固定种子伪随机：同一场景每次加载构图一致，截图可比 */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3(1, 1, 1)
const _euler = new THREE.Euler()
const _mat4 = new THREE.Matrix4()
const _dir = new THREE.Vector3()

function place<T extends THREE.BufferGeometry>(
  geo: T,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): T {
  if (rx || ry || rz) {
    _euler.set(rx, ry, rz)
    _quat.setFromEuler(_euler)
    _pos.set(x, y, z)
    _mat4.compose(_pos, _quat, _scale)
    geo.applyMatrix4(_mat4)
  } else {
    geo.translate(x, y, z)
  }
  return geo
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz)

const plane = (w: number, h: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  place(new THREE.PlaneGeometry(w, h), x, y, z, rx, ry, rz)

const cyl = (
  rt: number,
  rb: number,
  h: number,
  seg: number,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
) => place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz)

/** 把若干几何体合成一个 BufferGeometry；输入用完即 dispose，输出只占 1 次 draw call */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0
  let indices = 0
  for (const geo of list) {
    verts += geo.attributes.position.count
    indices += geo.index ? geo.index.count : geo.attributes.position.count
  }
  const position = new Float32Array(verts * 3)
  const normal = new Float32Array(verts * 3)
  const uv = new Float32Array(verts * 2)
  const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  let vo = 0
  let io = 0
  for (const geo of list) {
    const p = geo.attributes.position as THREE.BufferAttribute
    position.set(p.array as Float32Array, vo * 3)
    const n = geo.attributes.normal as THREE.BufferAttribute | undefined
    if (n) normal.set(n.array as Float32Array, vo * 3)
    const t = geo.attributes.uv as THREE.BufferAttribute | undefined
    if (t) uv.set(t.array as Float32Array, vo * 2)
    if (geo.index) {
      const src = geo.index.array
      for (let i = 0; i < src.length; i += 1) index[io + i] = src[i] + vo
      io += src.length
    } else {
      for (let i = 0; i < p.count; i += 1) index[io + i] = i + vo
      io += p.count
    }
    vo += p.count
    geo.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(position, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.setIndex(new THREE.BufferAttribute(index, 1))
  out.computeBoundingSphere()
  return out
}

function instanced(
  scene: THREE.Object3D,
  track: Track,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  specs: Inst[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(track(geo), track(material), specs.length)
  const dummy = new THREE.Object3D()
  for (let i = 0; i < specs.length; i += 1) {
    const s = specs[i]
    dummy.position.set(s.x, s.y, s.z)
    dummy.rotation.set(s.rx ?? 0, s.ry ?? 0, s.rz ?? 0)
    dummy.scale.set(s.sx ?? 1, s.sy ?? 1, s.sz ?? 1)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  scene.add(mesh)
  return track(mesh)
}

function makeCamera(
  pos: [number, number, number],
  look: [number, number, number],
  fov: number,
  far = 160,
): { camera: THREE.PerspectiveCamera; baseYaw: number; basePitch: number } {
  const camera = new THREE.PerspectiveCamera(fov, 1.78, 0.08, far)
  camera.position.set(pos[0], pos[1], pos[2])
  _dir.set(look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]).normalize()
  const baseYaw = Math.atan2(-_dir.x, -_dir.z)
  const basePitch = Math.asin(clamp(_dir.y, -1, 1))
  camera.rotation.order = 'YXZ'
  camera.rotation.set(basePitch, baseYaw, 0)
  return { camera, baseYaw, basePitch }
}

function makeTrash(): { track: Track; dispose: () => void } {
  let dead = false
  const items: Disposable[] = []
  const track: Track = <T extends Disposable>(x: T): T => {
    if (dead) x.dispose()
    else items.push(x)
    return x
  }
  const dispose = () => {
    dead = true
    for (const item of items) item.dispose()
    items.length = 0
  }
  return { track, dispose }
}

/** 材质上的贴图槽：material.dispose() 不会释放贴图，得自己点名 */
const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
] as const

function materialTextures(material: THREE.Material): THREE.Texture[] {
  const std = material as THREE.MeshStandardMaterial
  const found: THREE.Texture[] = []
  for (const slot of TEXTURE_SLOTS) {
    const texture = std[slot]
    if (texture) found.push(texture)
  }
  return found
}

/** 把一个对象树的 geometry / material / 贴图挂号，交给 slice 的垃圾桶统一释放 */
function trackObject(track: Track, root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    track(mesh.geometry)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const texture of materialTextures(material)) track(texture)
      track(material)
    }
  })
}

/** 立刻释放一个没人要的对象树（加载回来时组件已卸载的情况） */
function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry) geometries.add(mesh.geometry)
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of list) {
      if (!material) continue
      materials.add(material)
      for (const texture of materialTextures(material)) textures.add(texture)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}


// ---------------------------------------------------------------- 程序化贴图（canvas 画，不占 GPU 生图）

function canvasTexture(
  w: number,
  h: number,
  paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (g) paint(g, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

function concretePainter(base: string, dark: string, light: string, seed: number, cracks: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(seed)
    g.fillStyle = base
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 1400; i += 1) {
      g.globalAlpha = 0.04 + rand() * 0.14
      g.fillStyle = rand() > 0.5 ? dark : light
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 3.5, 1 + rand() * 3.5)
    }
    for (let i = 0; i < 8; i += 1) {
      const cx = rand() * w
      const cy = rand() * h
      const r = w * (0.05 + rand() * 0.2)
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, dark)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.globalAlpha = 0.1 + rand() * 0.16
      g.fillStyle = grad
      g.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    g.strokeStyle = dark
    for (let i = 0; i < cracks; i += 1) {
      g.globalAlpha = 0.3 + rand() * 0.25
      g.lineWidth = 0.6 + rand() * 1.3
      g.beginPath()
      let x = rand() * w
      let y = rand() * h
      g.moveTo(x, y)
      for (let k = 0; k < 6; k += 1) {
        x += (rand() - 0.5) * w * 0.22
        y += (rand() - 0.32) * h * 0.16
        g.lineTo(x, y)
      }
      g.stroke()
    }
    g.globalAlpha = 1
  }
}

function plankPainter(base: string, dark: string, light: string, rows: number, seed: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(seed)
    const rowH = h / rows
    for (let r = 0; r < rows; r += 1) {
      g.fillStyle = r % 2 === 0 ? base : light
      g.globalAlpha = 0.72 + rand() * 0.22
      g.fillRect(0, r * rowH, w, rowH)
      g.globalAlpha = 1
      g.fillStyle = dark
      g.fillRect(0, r * rowH, w, 1.6)
      for (let i = 0; i < 6; i += 1) {
        g.strokeStyle = dark
        g.globalAlpha = 0.1 + rand() * 0.22
        g.lineWidth = 0.7 + rand()
        g.beginPath()
        const y = r * rowH + rand() * rowH
        g.moveTo(0, y)
        for (let x = 0; x <= w; x += w / 8) g.lineTo(x, y + Math.sin(x * 0.05 + rand() * 6) * 2.4)
        g.stroke()
      }
      g.globalAlpha = 1
    }
  }
}

function paperPainter(base: string, fiber: string, edge: string, seed: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(seed)
    g.fillStyle = base
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 900; i += 1) {
      g.globalAlpha = 0.03 + rand() * 0.1
      g.fillStyle = fiber
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 2.6, 1)
    }
    const v = g.createLinearGradient(0, 0, 0, h)
    v.addColorStop(0, 'rgba(255,255,255,0.2)')
    v.addColorStop(1, edge)
    g.globalAlpha = 1
    g.fillStyle = v
    g.fillRect(0, 0, w, h)
  }
}

function fabricPainter() {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(17)
    g.fillStyle = '#a32b2b'
    g.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = `rgba(30,4,4,${0.02 + rand() * 0.06})`
      g.fillRect(x, 0, 1, h)
    }
    const v = g.createLinearGradient(0, 0, 0, h)
    v.addColorStop(0, 'rgba(255,196,140,0.24)')
    v.addColorStop(0.55, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(48,8,8,0.5)')
    g.fillStyle = v
    g.fillRect(0, 0, w, h)
    // 「旗角上有一小块补丁，针脚很密」
    const px = w * 0.06
    const py = h * 0.64
    const pw = w * 0.2
    const ph = h * 0.24
    g.fillStyle = 'rgba(138,44,36,0.95)'
    g.fillRect(px, py, pw, ph)
    g.strokeStyle = 'rgba(232,204,168,0.42)'
    g.lineWidth = Math.max(1, w / 160)
    g.setLineDash([Math.max(1, w / 96), Math.max(1, w / 192)])
    g.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3)
    g.setLineDash([])
  }
}

function glowPainter(inner: string, mid: string, outer: string) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.clearRect(0, 0, w, h)
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2)
    grad.addColorStop(0, inner)
    grad.addColorStop(0.45, mid)
    grad.addColorStop(1, outer)
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
  }
}

function streakPainter(seed: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(seed)
    g.clearRect(0, 0, w, h)
    g.globalCompositeOperation = 'lighter'
    // 湿地面上的竖向反光：窄、密、越靠下越淡
    for (let i = 0; i < 46; i += 1) {
      const x = rand() * w
      const sw = 0.8 + rand() * 2.6
      const top = rand() * h * 0.2
      const sh = h * (0.45 + rand() * 0.55)
      const grad = g.createLinearGradient(0, top, 0, top + sh)
      grad.addColorStop(0, `rgba(255,214,164,${0.14 + rand() * 0.26})`)
      grad.addColorStop(0.4, `rgba(255,198,140,${0.06 + rand() * 0.12})`)
      grad.addColorStop(1, 'rgba(255,170,110,0)')
      g.fillStyle = grad
      g.fillRect(x, top, sw, sh)
    }
    g.globalCompositeOperation = 'source-over'
  }
}

function waterPainter(seed: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(seed)
    g.fillStyle = '#141d22'
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'lighter'
    // 灯的竖向倒影
    for (let i = 0; i < 34; i += 1) {
      const x = rand() * w
      const sw = 2 + rand() * 9
      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, 'rgba(226,214,176,0)')
      grad.addColorStop(0.22 + rand() * 0.3, `rgba(240,224,186,${0.1 + rand() * 0.22})`)
      grad.addColorStop(1, 'rgba(150,166,180,0)')
      g.fillStyle = grad
      g.fillRect(x, 0, sw, h)
    }
    // 水面碎纹
    for (let i = 0; i < 110; i += 1) {
      g.fillStyle = `rgba(196,206,214,${0.03 + rand() * 0.09})`
      g.fillRect(rand() * w, rand() * h, 3 + rand() * 20, 1 + rand() * 1.6)
    }
    g.globalCompositeOperation = 'source-over'
  }
}

function snowViewPainter() {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(5)
    const sky = g.createLinearGradient(0, 0, 0, h * 0.72)
    sky.addColorStop(0, '#93a7b8')
    sky.addColorStop(0.55, '#cbd6de')
    sky.addColorStop(1, '#e8eef2')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    const hill = (yBase: number, amp: number, color: string) => {
      g.fillStyle = color
      g.beginPath()
      g.moveTo(0, h)
      for (let x = 0; x <= w; x += w / 14) {
        g.lineTo(x, yBase + Math.sin(x * 0.03 + rand() * 4) * amp + rand() * amp * 0.6)
      }
      g.lineTo(w, h)
      g.closePath()
      g.fill()
    }
    hill(h * 0.5, h * 0.05, '#a2b3c0')
    hill(h * 0.58, h * 0.035, '#bcc9d3')
    const snow = g.createLinearGradient(0, h * 0.64, 0, h)
    snow.addColorStop(0, '#e9eff3')
    snow.addColorStop(1, '#f6fafc')
    g.fillStyle = snow
    g.fillRect(0, h * 0.64, w, h * 0.36)
    g.strokeStyle = 'rgba(74,86,96,0.5)'
    g.lineWidth = Math.max(1, w / 200)
    for (let i = 0; i < 12; i += 1) {
      const x = rand() * w
      const y = h * (0.66 + rand() * 0.16)
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x, y - h * (0.03 + rand() * 0.06))
      g.stroke()
    }
    for (let i = 0; i < 40; i += 1) {
      g.fillStyle = `rgba(255,255,255,${0.28 + rand() * 0.5})`
      g.beginPath()
      g.arc(rand() * w, rand() * h * 0.92, 0.6 + rand() * 1.3, 0, Math.PI * 2)
      g.fill()
    }
  }
}

function snowSpeckPainter(seed: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const rand = prng(seed)
    g.clearRect(0, 0, w, h)
    for (let i = 0; i < 80; i += 1) {
      const x = rand() * w
      const y = rand() * h
      const r = 0.5 + rand() * 1.5
      g.fillStyle = `rgba(255,255,255,${0.22 + rand() * 0.5})`
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
      // 上下各补一份：RepeatWrapping 时滚动不露接缝
      if (y < r + 2) {
        g.beginPath()
        g.arc(x, y + h, r, 0, Math.PI * 2)
        g.fill()
      } else if (y > h - r - 2) {
        g.beginPath()
        g.arc(x, y - h, r, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
}

function shaftPainter() {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.clearRect(0, 0, w, h)
    const v = g.createLinearGradient(0, 0, 0, h)
    v.addColorStop(0, 'rgba(255,255,255,0.6)')
    v.addColorStop(0.62, 'rgba(255,255,255,0.16)')
    v.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = v
    g.fillRect(0, 0, w, h)
    const e = g.createLinearGradient(0, 0, w, 0)
    e.addColorStop(0, 'rgba(0,0,0,1)')
    e.addColorStop(0.2, 'rgba(0,0,0,0)')
    e.addColorStop(0.8, 'rgba(0,0,0,0)')
    e.addColorStop(1, 'rgba(0,0,0,1)')
    g.globalCompositeOperation = 'destination-out'
    g.fillStyle = e
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'source-over'
  }
}

/**
 * 天空板：远处一大片竖直渐变（fog: false，否则整片被雾吃掉）
 * 比铺生成图可靠——生成图的构图（地平线、楼、栏杆）会跟 3D 打架。
 */
function addSky(
  scene: THREE.Scene,
  track: Track,
  colors: [string, string, string],
  width: number,
  height: number,
  y: number,
  z: number,
): void {
  const tex = track(
    canvasTexture(64, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, colors[0])
      grad.addColorStop(0.6, colors[1])
      grad.addColorStop(0.86, colors[2])
      grad.addColorStop(1, colors[2])
      g.fillStyle = grad
      g.fillRect(0, 0, w, h)
    }),
  )
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  const material = track(new THREE.MeshBasicMaterial({ map: tex, fog: false }))
  const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), material)
  mesh.position.set(0, y, z)
  scene.add(mesh)
}

/** 远景贴图：加载失败就留纯色，不影响画面成立 */
function addBackdrop(
  scene: THREE.Scene,
  track: Track,
  url: string,
  width: number,
  height: number,
  y: number,
  z: number,
  tint: number,
  fog: boolean,
): void {
  const material = track(new THREE.MeshBasicMaterial({ color: tint, fog }))
  const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), material)
  mesh.position.set(0, y, z)
  scene.add(mesh)
  // 相对路径配合 vite base:'./'：子目录部署时也能取到 public/bg 下的图
  const resolvedUrl =
    url.startsWith('/') || url.startsWith('http') || url.startsWith('./') ? url : `${import.meta.env.BASE_URL}${url}`
  new THREE.TextureLoader().load(
    resolvedUrl,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      track(tex)
      // color 一直当压暗用：远景是氛围，不能比主体抢眼
      material.map = tex
      material.needsUpdate = true
    },
    undefined,
    () => {
      /* 静默：远景只是氛围，没有也能看 */
    },
  )
}

/** 接触阴影：一片贴地的径向黑，替代阴影贴图 */
function addContactShadows(scene: THREE.Scene, track: Track, tex: THREE.Texture, specs: Inst[]): void {
  const material = track(
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
      color: 0x000000,
      fog: true,
    }),
  )
  // plane 已转平，实例只需给位置和 XZ 缩放
  instanced(scene, track, plane(1, 1, 0, 0, 0, -Math.PI / 2, 0, 0), material, specs)
}

function shadowTex(track: Track): THREE.Texture {
  return track(
    canvasTexture(64, 64, glowPainter('rgba(0,0,0,0.85)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0)')),
  )
}

/** 沙袋材质：粗麻布，共用一份贴图 */
function bagMat(track: Track): THREE.MeshStandardMaterial {
  const tex = canvasTexture(128, 128, (g, w, h) => {
    const rand = prng(41)
    g.fillStyle = '#867a5f'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 700; i += 1) {
      g.globalAlpha = 0.05 + rand() * 0.16
      g.fillStyle = rand() > 0.5 ? '#5c5340' : '#a99b7d'
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 2)
    }
    g.globalAlpha = 1
  })
  track(tex)
  return new THREE.MeshStandardMaterial({ map: tex, color: 0x93897a, roughness: 0.94, metalness: 0.02 })
}

// ---------------------------------------------------------------- warehouse-int：底楼大厅

function buildWarehouse(track: Track, backdrop: string | null): Slice {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.ink)
  scene.fog = new THREE.FogExp2(0x2b241c, 0.026)

  // 站在底楼西头往东看：柱列在两侧，破洞在左墙
  // 视线略向左偏 5°：App 里正文卡片压住左半边，主体要落在右半边
  const { camera, baseYaw, basePitch } = makeCamera([1.0, 1.66, 8.6], [-2.2, 3.0, -14], 50)

  scene.add(new THREE.HemisphereLight(0x69737f, 0x1a1310, 1.15))
  const cold = new THREE.DirectionalLight(0x9db4d2, 1.7)
  cold.position.set(-16, 9, -6)
  scene.add(cold)
  const lamp = new THREE.PointLight(0xffab5e, 46, 17, 2)
  lamp.position.set(-4.35, 2.34, -2.6)
  scene.add(lamp)
  const farLamp = new THREE.PointLight(0xff9d4e, 26, 13, 2)
  farLamp.position.set(4.4, 2.3, -14.5)
  scene.add(farLamp)

  // 地面：粗糙水泥，反光很弱
  const floorTex = track(canvasTexture(256, 256, concretePainter('#3b362f', '#231f1a', '#57503f', 7, 5)))
  floorTex.repeat.set(11, 15)
  const floorMat = track(
    new THREE.MeshStandardMaterial({ map: floorTex, color: 0x968d80, roughness: 0.74, metalness: 0.06 }),
  )
  scene.add(new THREE.Mesh(track(plane(50, 70, 0, 0, -18, -Math.PI / 2, 0, 0)), floorMat))

  // 两盏灯脚下的暖光池（地面反光的替身）
  const poolTex = track(
    canvasTexture(
      128,
      128,
      glowPainter('rgba(255,182,110,0.95)', 'rgba(255,150,80,0.3)', 'rgba(255,120,60,0)'),
    ),
  )
  const poolMat = track(
    new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    }),
  )
  scene.add(
    new THREE.Mesh(
      track(merge([plane(12, 12, -4.35, 0.02, -2.6, -Math.PI / 2, 0, 0), plane(9, 9, 4.4, 0.02, -14.5, -Math.PI / 2, 0, 0)])),
      poolMat,
    ),
  )

  // 顶棚 + 柱梁 + 碎砖：同一份混凝土材质
  const concreteTex = track(canvasTexture(256, 256, concretePainter('#514b42', '#332e27', '#635c50', 21, 3)))
  concreteTex.repeat.set(3, 3)
  const concreteMat = track(
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x8f887c, roughness: 0.93, metalness: 0.02 }),
  )
  scene.add(new THREE.Mesh(track(plane(50, 70, 0, 10.0, -18, Math.PI / 2, 0, 0)), concreteMat))

  const structure: Inst[] = []
  // 柱列：三排，撑起 10 米高的大厅
  for (const x of [-5.4, 5.4]) {
    for (const z of [-2.5, -8.5, -14.5]) {
      structure.push({ x, y: 5.0, z, sx: 1.25, sy: 10.0, sz: 1.25 })
    }
  }
  // 顶下横梁：只在顶部，不挡视线
  for (const z of [-2.5, -8.5, -14.5]) {
    structure.push({ x: 0, y: 8.8, z, sx: 23, sy: 0.7, sz: 0.95 })
  }
  for (const x of [-5.4, 5.4]) structure.push({ x, y: 8.45, z: -8.5, sx: 0.5, sy: 0.5, sz: 27 })
  // 破洞下的碎砖
  const rubble = prng(31)
  for (let i = 0; i < 16; i += 1) {
    structure.push({
      x: -8.2 + rubble() * 1.7,
      y: 0.08 + rubble() * 0.12,
      z: -4.4 - rubble() * 2.6,
      sx: 0.16 + rubble() * 0.4,
      sy: 0.1 + rubble() * 0.24,
      sz: 0.16 + rubble() * 0.4,
      ry: rubble() * 3,
      rz: rubble() * 0.6,
    })
  }
  instanced(scene, track, new THREE.BoxGeometry(1, 1, 1), concreteMat, structure)

  // 沙袋（米包、面袋也在里面）
  const bagR = prng(11)
  const bags: Inst[] = []
  const pushRow = (x0: number, z0: number, count: number, dx: number, dz: number, y: number) => {
    for (let i = 0; i < count; i += 1) {
      bags.push({
        x: x0 + dx * i + (bagR() - 0.5) * 0.07,
        y: y + (bagR() - 0.5) * 0.04,
        z: z0 + dz * i + (bagR() - 0.5) * 0.07,
        sx: 1.15 + bagR() * 0.1,
        sy: 0.48,
        sz: 0.72,
        ry: (bagR() - 0.5) * 0.55,
        rz: (bagR() - 0.5) * 0.18,
      })
    }
  }
  for (let row = 0; row < 3; row += 1) {
    pushRow(-8.0 + row * 0.47, -7.2, 9, 0.94, 0.05, 0.2 + row * 0.345)
  }
  for (let row = 0; row < 4; row += 1) {
    const count = 5 - row
    for (let i = 0; i < count; i += 1) {
      bags.push({
        x: 7.4 + row * 0.08 + (bagR() - 0.5) * 0.07,
        y: 0.19 + row * 0.33,
        z: -9.4 + i * 0.68 + row * 0.05,
        sx: 1.15,
        sy: 0.44,
        sz: 0.72,
        ry: (bagR() - 0.5) * 0.55,
        rz: (bagR() - 0.5) * 0.2,
      })
    }
  }
  for (let row = 0; row < 3; row += 1) {
    pushRow(-7.6 + row * 0.22, -12.6, 6, 0.96, 0.05, 0.19 + row * 0.33)
  }
  // 地上散落几只
  for (let i = 0; i < 4; i += 1) {
    bags.push({
      x: -3.2 + i * 1.4 + (bagR() - 0.5) * 0.4,
      y: 0.17,
      z: -4.6 + (bagR() - 0.5) * 1.2,
      sx: 1.1,
      sy: 0.42,
      sz: 0.7,
      ry: bagR() * 3.1,
      rz: (bagR() - 0.5) * 0.5,
    })
  }
  instanced(scene, track, new THREE.SphereGeometry(0.4, 6, 4), bagMat(track), bags)

  // 木箱
  const crateTex = track(canvasTexture(128, 128, plankPainter('#5a462e', '#2b1e12', '#6e5638', 5, 9)))
  const crateMat = track(
    new THREE.MeshStandardMaterial({ map: crateTex, color: 0x8f8574, roughness: 0.86, metalness: 0.03 }),
  )
  const crateR = prng(19)
  const crates: Inst[] = []
  const crateSpot = (x: number, y: number, z: number, s: number) => {
    crates.push({
      x,
      y,
      z,
      sx: s,
      sy: s * 0.82,
      sz: s,
      ry: (crateR() - 0.5) * 0.6,
      rz: (crateR() - 0.5) * 0.08,
    })
  }
  crateSpot(6.0, 0.31, -3.4, 0.62)
  crateSpot(6.65, 0.29, -4.1, 0.58)
  crateSpot(6.2, 0.83, -3.6, 0.56)
  crateSpot(-7.2, 0.3, -1.4, 0.6)
  crateSpot(-6.6, 0.32, -2.2, 0.64)
  crateSpot(-7.0, 0.86, -1.7, 0.55)
  crateSpot(3.9, 0.34, -5.6, 0.66)
  crateSpot(4.5, 0.3, -6.3, 0.6)
  crateSpot(2.2, 0.33, -2.8, 0.64)
  crateSpot(-1.4, 0.3, -1.9, 0.56)
  crateSpot(0.6, 0.3, -6.6, 0.62)
  crateSpot(7.0, 0.3, -6.1, 0.6)
  instanced(scene, track, new THREE.BoxGeometry(1, 1, 1), crateMat, crates)

  // 左墙开破洞（相机朝 -z，yaw 往左摆就到），冷光从那里进来
  const wallShape = new THREE.Shape()
  wallShape.moveTo(-12, 0)
  wallShape.lineTo(12, 0)
  wallShape.lineTo(12, 10.0)
  wallShape.lineTo(-12, 10.0)
  wallShape.closePath()
  // 破洞位置：yaw 往左摆时才进画面，别被前排柱子挡住
  const breach = new THREE.Path()
  breach.moveTo(-1.2, 1.1)
  breach.lineTo(0.0, 1.35)
  breach.lineTo(1.4, 2.0)
  breach.lineTo(1.8, 3.2)
  breach.lineTo(1.0, 4.2)
  breach.lineTo(-0.4, 4.1)
  breach.lineTo(-1.0, 3.0)
  breach.closePath()
  wallShape.holes.push(breach)
  const wallGeo = new THREE.ShapeGeometry(wallShape)
  place(wallGeo, -9.4, 0, -6.2, 0, Math.PI / 2, 0)
  const plasterMat = track(
    new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x8b8375, roughness: 0.95, metalness: 0.02 }),
  )
  scene.add(new THREE.Mesh(track(wallGeo), plasterMat))
  // 右墙：同材质，给画面收边
  scene.add(
    new THREE.Mesh(
      track(merge([plane(24, 10.0, 9.4, 5.0, -6.2, 0, -Math.PI / 2, 0)])),
      plasterMat,
    ),
  )

  // 破洞外的冷光（过曝，看不见外面）
  const breachMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          128,
          128,
          glowPainter('rgba(214,232,250,0.98)', 'rgba(150,178,208,0.55)', 'rgba(90,120,150,0)'),
        ),
      ),
      transparent: true,
      opacity: 0.66,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  scene.add(new THREE.Mesh(track(plane(6.2, 4.2, -9.47, 2.8, -6.5, 0, Math.PI / 2, 0)), breachMat))

  // 冷光落到地上的一片
  // （原本还叠了一道斜插的光柱，低多边形下读成一块悬浮的灰板，删了）
  const coldPoolMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          128,
          128,
          glowPainter('rgba(190,216,244,0.9)', 'rgba(130,164,200,0.32)', 'rgba(90,120,150,0)'),
        ),
      ),
      color: 0xaecbe8,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    }),
  )
  scene.add(new THREE.Mesh(track(plane(13, 10, -6.0, 0.02, -6.6, -Math.PI / 2, 0, 0)), coldPoolMat))

  // 一排枪靠在左墙，正好被破洞的冷光打成一排剪影
  const rifles: THREE.BufferGeometry[] = []
  const rifleR = prng(23)
  for (let i = 0; i < 7; i += 1) {
    const z = -5.2 + i * 0.3
    const tilt = -0.13 + rifleR() * 0.04
    rifles.push(box(0.05, 1.2, 0.06, -8.7, 0.62, z, 0, 0, tilt))
    rifles.push(box(0.045, 0.34, 0.1, -8.65, 0.2, z + 0.02, 0, 0, tilt))
  }
  const rifleMat = track(
    new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.66, metalness: 0.2 }),
  )
  scene.add(new THREE.Mesh(track(merge(rifles)), rifleMat))

  // 煤油灯：挂在第一排左柱上，铜壳 + 发亮的玻璃罩
  const lampMat = track(new THREE.MeshStandardMaterial({ color: 0x7d6135, roughness: 0.45, metalness: 0.62 }))
  const lampBody = merge([
    box(0.1, 0.1, 0.1, -4.72, 2.5, -2.6),
    box(0.34, 0.05, 0.05, -4.53, 2.5, -2.6),
    cyl(0.14, 0.15, 0.05, 8, -4.35, 2.2, -2.6),
    cyl(0.095, 0.13, 0.18, 8, -4.35, 2.3, -2.6),
    cyl(0.05, 0.05, 0.08, 6, -4.35, 2.42, -2.6),
  ])
  scene.add(new THREE.Mesh(track(lampBody), lampMat))
  const glassMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffd7a0,
      emissive: PALETTE.gold,
      emissiveIntensity: 3.2,
      roughness: 0.35,
      transparent: true,
      opacity: 0.8,
    }),
  )
  scene.add(new THREE.Mesh(track(cyl(0.082, 0.072, 0.17, 8, -4.35, 2.34, -2.6)), glassMat))

  // 灯周围的一层暖雾（加色，让灯真的「亮」）
  const hazeMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          64,
          64,
          glowPainter('rgba(255,204,150,0.8)', 'rgba(255,170,110,0.28)', 'rgba(255,150,90,0)'),
        ),
      ),
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  scene.add(new THREE.Mesh(track(plane(2.4, 2.4, -4.35, 2.36, -2.55)), hazeMat))

  if (backdrop) addBackdrop(scene, track, backdrop, 66, 38, 11, -24, 0x7d7365, true)

  addContactShadows(scene, track, shadowTex(track), [
    { x: -5.4, y: 0, z: -7.2, sx: 10, sz: 2.8 },
    { x: 7.4, y: 0, z: -8.2, sx: 3.6, sz: 5.6 },
    { x: -5.8, y: 0, z: -12.6, sx: 5.0, sz: 2.6 },
    { x: 6.2, y: 0, z: -3.6, sx: 3.8, sz: 3.4 },
    { x: -6.8, y: 0, z: -1.8, sx: 2.8, sz: 2.4 },
    { x: -4.35, y: 0, z: -2.6, sx: 3.4, sz: 3.4 },
    { x: 4.4, y: 0, z: -14.5, sx: 3.0, sz: 3.0 },
    { x: -5.4, y: 0, z: -2.5, sx: 2.6, sz: 2.6 },
  ])

  const tick = (time: number) => {
    lamp.intensity = 41 + Math.sin(time * 8.7) * 3 + Math.sin(time * 21.3) * 1.4
    farLamp.intensity = 22 + Math.sin(time * 6.1 + 1.7) * 1.6
    glassMat.emissiveIntensity = 2.9 + Math.sin(time * 11.1) * 0.4
    hazeMat.opacity = 0.58 + Math.sin(time * 9.3) * 0.06
  }

  return { scene, camera, baseYaw, basePitch, exposure: 1.22, tick, dispose: () => {} }
}

// ---------------------------------------------------------------- warehouse-ext：Blender 西墙

/**
 * 四行仓库西墙外观（Blender 4.2.3 无头导出的 GLB，见 tools/blender/build_warehouse.py）。
 * 模型缺失时只保留地面、灯光与尘，不报错。
 *
 * onGlb 只是把加载状态写到宿主 data-* 上（tools/test-3d.mjs 要断言「到底加载了没」），
 * 不参与渲染，也不改变任何视觉。
 */
function buildWarehouseExt(track: Track, onGlb?: (status: 'loading' | 'ready' | 'failed') => void): Slice {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0907)
  scene.fog = new THREE.FogExp2(0x16120e, 0.010)

  const { camera, baseYaw, basePitch } = makeCamera([24, 18, 68], [0, 12, 0], 40)

  scene.add(new THREE.HemisphereLight(0x76828f, 0x1b1510, 1.5))
  const moon = new THREE.DirectionalLight(0x9db4d2, 2.4)
  moon.position.set(-38, 52, 44)
  scene.add(moon)
  const warm = new THREE.PointLight(0xe0a15a, 40, 110, 2)
  warm.position.set(20, 7, 12)
  scene.add(warm)
  // 立面补光：让砖缝与弹孔在暗场里读得出来
  const fill = new THREE.DirectionalLight(0xc9b79a, 0.9)
  fill.position.set(0, 18, 60)
  scene.add(fill)

  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(280, 280)),
    track(new THREE.MeshStandardMaterial({ color: 0x16120e, roughness: 0.96, metalness: 0 })),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  // 尘与火星：低配 Points，只动画透明度
  const count = 240
  const positions = new Float32Array(count * 3)
  const rnd = prng(1937)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (rnd() - 0.5) * 96
    positions[i * 3 + 1] = rnd() * 26
    positions[i * 3 + 2] = (rnd() - 0.5) * 56 - 6
  }
  const dustGeo = track(new THREE.BufferGeometry())
  dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const dustMat = track(
    new THREE.PointsMaterial({ color: 0xc8a063, size: 0.18, transparent: true, opacity: 0.5, depthWrite: false }),
  )
  const dust = new THREE.Points(dustGeo, dustMat)
  scene.add(dust)

  let alive = true
  const loader = new GLTFLoader()
  onGlb?.('loading')
  loader.load(
    `${import.meta.env.BASE_URL}models/warehouse-ext.glb`,
    (gltf) => {
      const model = gltf.scene
      if (!alive) {
        // 加载期间已经切场景/卸载：这次结果没人要，必须自己释放，
        // 否则每次「点了 3D 又立刻切走」都会漏一套 geometry/material/texture。
        disposeObject(model)
        return
      }
      model.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
          trackObject(track, mesh)
        }
      })
      // 注：GLB 是单节点 join 过的（11 primitive / 1 mesh），逐个 mesh 挂号即可；
      // trackObject 会把 geometry / material / 内嵌贴图全部进垃圾桶。
      // 资产是米制、Y-up、节点无变换（见 docs/report/2026-10-22-blender-asset.md：
      // bbox X±32.17 / Y −0.09…27.62 / Z −9.00…1.53，1 unit = 1 m）。
      // 所以按原尺寸落地即可；只有单位明显不是米时才归一化，
      // 否则 27.7 m 的总高（含女儿墙+楼梯间）会被当成「立面 = 25 m」缩成 22.6 m。
      const size = new THREE.Vector3()
      new THREE.Box3().setFromObject(model).getSize(size)
      if (size.y < 12 || size.y > 60) model.scale.setScalar(25 / Math.max(size.y, 0.001))
      const box2 = new THREE.Box3().setFromObject(model)
      const center = new THREE.Vector3()
      box2.getCenter(center)
      model.position.x -= center.x
      model.position.z -= center.z
      // 落地：把底边贴到 y=0；再抬 2 mm 让墙脚底面与地面不共面。
      // 实测（tools/3d/glb-probe.html）共面时也没有观察到 z-fighting，这 2 mm 只是防御，
      // 64 m 立面上肉眼与 0 不可区分。
      model.position.y -= box2.min.y
      model.position.y += 0.002
      scene.add(model)
      onGlb?.('ready')
    },
    undefined,
    () => {
      /* 静默：模型缺失（404 / 断网 / 文件损坏）时保留地面与灯光，绝不抛错 */
      onGlb?.('failed')
    },
  )

  const tick = (time: number) => {
    dustMat.opacity = 0.38 + Math.sin(time * 1.3) * 0.12
    dust.rotation.y = Math.sin(time * 0.06) * 0.05
  }

  return {
    scene,
    camera,
    baseYaw,
    basePitch,
    exposure: 1.25,
    tick,
    dispose: () => {
      alive = false
    },
  }
}

// ---------------------------------------------------------------- rooftop：楼顶升旗

function buildRooftop(track: Track, backdrop: string | null): Slice {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x4e443a)
  scene.fog = new THREE.FogExp2(0x5b4f42, 0.017)

  const { camera, baseYaw, basePitch } = makeCamera([0.7, 1.6, 7.4], [0.3, 2.6, -9], 50, 180)

  scene.add(new THREE.HemisphereLight(0xa4b4c8, 0x342819, 1.15))
  const dawn = new THREE.DirectionalLight(0xffc07e, 2.2)
  dawn.position.set(16, 7, -14)
  scene.add(dawn)
  const fill = new THREE.DirectionalLight(0x8799b2, 0.85)
  fill.position.set(-7, 5, 10)
  scene.add(fill)
  // 地面反弹光：让女儿墙和沙袋的朝镜头面不至于全黑
  const bounce = new THREE.DirectionalLight(0xd8a878, 0.9)
  bounce.position.set(1, -3, 14)
  scene.add(bounce)

  const deckTex = track(canvasTexture(256, 256, concretePainter('#736a5e', '#4e4840', '#8b8173', 3, 7)))
  deckTex.repeat.set(8, 7)
  const deckMat = track(
    new THREE.MeshStandardMaterial({ map: deckTex, color: 0x9e9585, roughness: 0.88, metalness: 0.03 }),
  )
  scene.add(new THREE.Mesh(track(plane(46, 44, 0, 0, -10, -Math.PI / 2, 0, 0)), deckMat))

  // 女儿墙 + 楼梯间
  const parapet = merge([
    box(20.4, 1.1, 0.46, 0, 0.55, -9.2),
    box(20.7, 0.16, 0.6, 0, 1.18, -9.2),
    box(0.46, 1.1, 13.0, -10.0, 0.55, -2.8),
    box(0.6, 0.16, 13.3, -10.0, 1.18, -2.8),
    box(0.46, 1.1, 13.0, 10.0, 0.55, -2.8),
    box(0.6, 0.16, 13.3, 10.0, 1.18, -2.8),
    // 楼梯间
    box(3.6, 2.6, 0.34, -5.6, 1.3, -6.6),
    box(0.34, 2.6, 3.2, -7.4, 1.3, -5.0),
    box(0.34, 2.6, 3.2, -3.8, 1.3, -5.0),
    box(3.6, 0.32, 3.2, -5.6, 2.76, -5.0),
    box(1.15, 2.1, 0.16, -5.6, 1.05, -6.74),
  ])
  const parapetMat = track(
    new THREE.MeshStandardMaterial({ map: deckTex, color: 0x8f8878, roughness: 0.9, metalness: 0.03 }),
  )
  scene.add(new THREE.Mesh(track(parapet), parapetMat))

  // 女儿墙内侧加沙袋（守楼顶的常态）
  const bagR = prng(57)
  const bags: Inst[] = []
  for (let row = 0; row < 2; row += 1) {
    for (let i = 0; i < 12; i += 1) {
      bags.push({
        x: -7.8 + i * 1.4,
        y: 0.2 + row * 0.34,
        z: -8.86 + (bagR() - 0.5) * 0.1,
        sx: 1.1,
        sy: 0.42,
        sz: 0.7,
        ry: (bagR() - 0.5) * 0.5,
        rz: (bagR() - 0.5) * 0.16,
      })
    }
  }
  // 角落里再叠一堆
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 3; i += 1) {
      bags.push({
        x: 6.4 + i * 0.7,
        y: 0.2 + row * 0.34,
        z: -6.6 + row * 0.1,
        sx: 1.08,
        sy: 0.42,
        sz: 0.7,
        ry: (bagR() - 0.5) * 0.6,
        rz: (bagR() - 0.5) * 0.18,
      })
    }
  }
  instanced(scene, track, new THREE.SphereGeometry(0.4, 6, 4), bagMat(track), bags)

  // 两根长竹竿接起来的旗杆
  const bambooMat = track(new THREE.MeshStandardMaterial({ color: 0x6f5c34, roughness: 0.7, metalness: 0.03 }))
  const pole = merge([
    cyl(0.055, 0.072, 3.0, 6, 1.9, 1.5, -6.6),
    cyl(0.045, 0.055, 2.7, 6, 1.94, 4.3, -6.6),
    cyl(0.078, 0.078, 0.05, 6, 1.9, 2.98, -6.6),
    cyl(0.074, 0.074, 0.05, 6, 1.92, 3.08, -6.6),
    cyl(0.03, 0.048, 0.18, 6, 1.95, 5.72, -6.6),
    cyl(0.18, 0.22, 0.22, 6, 1.9, 0.11, -6.6),
  ])
  scene.add(new THREE.Mesh(track(pole), bambooMat))

  // 旗面：顶点正弦波动画（法线也按波峰斜率解析算，别每帧重算整块）
  const flagTex = track(canvasTexture(128, 96, fabricPainter()))
  flagTex.wrapS = THREE.ClampToEdgeWrapping
  flagTex.wrapT = THREE.ClampToEdgeWrapping
  const FLAG_W = 2.0
  const FLAG_H = 1.3
  const FLAG_SEG_X = 16
  const flagGeo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, FLAG_SEG_X, 7)
  flagGeo.translate(FLAG_W / 2, 0, 0)
  // 布的明暗用顶点色直接刷（MeshBasic 不吃光，靠斜率做褶，比 MeshStandard 稳）
  const flagShade = new Float32Array(flagGeo.attributes.position.count * 3).fill(1)
  flagGeo.setAttribute('color', new THREE.BufferAttribute(flagShade, 3))
  const flagMat = track(
    new THREE.MeshBasicMaterial({
      map: flagTex,
      color: 0xd8b49a,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    }),
  )
  const flag = new THREE.Mesh(track(flagGeo), flagMat)
  flag.position.set(1.93, 4.86, -6.6)
  flag.rotation.y = -0.62
  scene.add(flag)
  const flagPos = flagGeo.attributes.position as THREE.BufferAttribute
  const flagShadeAttr = flagGeo.attributes.color as THREE.BufferAttribute
  const flagBase = new Float32Array(flagPos.array as Float32Array)
  const flagCount = flagPos.count
  const FLAG_COLS = FLAG_SEG_X + 1
  const INV_LEN = 1 / FLAG_W
  const waveZ = new Float32Array(FLAG_COLS)
  const waveN = new Float32Array(FLAG_COLS)

  // 探照灯：只做可见光锥，不额外加光源（预算里最像的做法）
  const beamGeo = new THREE.ConeGeometry(1.9, 20, 8, 1, true)
  beamGeo.rotateX(Math.PI)
  beamGeo.translate(0, 10, 0)
  const beamMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xdce9f6,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  )
  const beam = new THREE.Mesh(track(beamGeo), beamMat)
  beam.position.set(7.5, 1.3, -7.2)
  scene.add(beam)

  // 楼顶杂物：探照灯座、弹药箱、水桶、断竹竿、木板
  scene.add(
    new THREE.Mesh(
      track(
        merge([
          box(0.55, 1.1, 0.55, 7.5, 1.05, -7.2),
          box(1.5, 0.55, 0.55, 6.8, 1.55, -7.2),
          box(0.72, 0.44, 0.48, 5.6, 0.22, -3.0, 0, 0.22, 0),
          box(0.72, 0.44, 0.48, 5.7, 0.66, -2.8, 0, 0.1, 0.02),
          box(0.68, 0.42, 0.46, 4.0, 0.21, -0.4, 0, -0.3, 0),
          cyl(0.2, 0.17, 0.42, 8, -2.8, 0.21, -2.4),
          cyl(0.032, 0.038, 2.3, 5, 1.2, 0.13, 2.6, 0, 0, Math.PI / 2 - 0.1),
          box(1.0, 0.07, 1.7, -3.6, 0.03, 1.8, 0, 0.4, 0),
          box(0.5, 0.3, 0.34, -1.2, 0.16, -5.2, 0, 0.7, 0),
        ]),
      ),
      track(new THREE.MeshStandardMaterial({ color: 0x53483a, roughness: 0.88, metalness: 0.05 })),
    ),
  )

  // 对岸楼群（远景剪影）
  const cityR = prng(63)
  const city: Inst[] = []
  for (let i = 0; i < 20; i += 1) {
    const w = 4 + cityR() * 8
    const h = 3 + cityR() * 7
    city.push({
      x: -54 + i * 5.6 + cityR() * 2,
      y: h / 2 - 1.4,
      z: -42 - cityR() * 14,
      sx: w,
      sy: h,
      sz: 4 + cityR() * 5,
    })
  }
  instanced(
    scene,
    track,
    new THREE.BoxGeometry(1, 1, 1),
    track(new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 1, metalness: 0 })),
    city,
  )

  // 天：程序化天空板（要比雾更亮，才能从雾里透出天光）
  addSky(scene, track, ['#39424e', '#8a7360', '#c9a077'], 460, 220, 44, -130)

  // 日出的暖光带
  const glowMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          128,
          128,
          glowPainter('rgba(255,196,138,0.9)', 'rgba(255,160,110,0.32)', 'rgba(255,140,90,0)'),
        ),
      ),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  scene.add(new THREE.Mesh(track(plane(150, 40, 10, 10, -70)), glowMat))

  addContactShadows(scene, track, shadowTex(track), [
    { x: -5.6, y: 0, z: -5.0, sx: 4.8, sz: 4.6 },
    { x: 1.9, y: 0, z: -6.6, sx: 2.6, sz: 2.6 },
    { x: 5.7, y: 0, z: -2.9, sx: 2.2, sz: 2.6 },
    { x: 7.5, y: 0, z: -7.2, sx: 2.4, sz: 2.4 },
    { x: 7.1, y: 0, z: -6.6, sx: 3.0, sz: 1.6 },
  ])

  const tick = (time: number) => {
    // 旗面波动：风从西边来，越靠旗尾摆得越大
    for (let c = 0; c < FLAG_COLS; c += 1) {
      const bx = flagBase[c * 3]
      const t = bx * INV_LEN
      const a = Math.sin(bx * 2.6 - time * 4.1) * 0.27 * t
      const b = Math.sin(bx * 1.3 - time * 2.2) * 0.09 * t
      const d = Math.sin(bx * 6.1 - time * 6.4) * 0.045 * t
      waveZ[c] = a + b + d
      const da =
        Math.cos(bx * 2.6 - time * 4.1) * 2.6 * 0.27 * t +
        Math.sin(bx * 2.6 - time * 4.1) * 0.27 * INV_LEN
      const db =
        Math.cos(bx * 1.3 - time * 2.2) * 1.3 * 0.09 * t +
        Math.sin(bx * 1.3 - time * 2.2) * 0.09 * INV_LEN
      const dd =
        Math.cos(bx * 6.1 - time * 6.4) * 6.1 * 0.045 * t +
        Math.sin(bx * 6.1 - time * 6.4) * 0.045 * INV_LEN
      waveN[c] = da + db + dd
    }
    for (let i = 0; i < flagCount; i += 1) {
      const c = i % FLAG_COLS
      const bx = flagBase[i * 3]
      const by = flagBase[i * 3 + 1]
      const t = bx * INV_LEN
      flagPos.setXYZ(i, bx, by + Math.sin(bx * 2.0 - time * 3.4) * 0.045 * t, waveZ[c])
      // 迎风面偏亮、背风面偏暗；越靠上越受天光
      const shade = clamp(1 - waveN[c] * 1.05, 0.36, 1.5) * (1 + (by / FLAG_H) * 0.2)
      flagShade[i * 3] = shade
      flagShade[i * 3 + 1] = shade
      flagShade[i * 3 + 2] = shade
    }
    flagPos.needsUpdate = true
    flagShadeAttr.needsUpdate = true
    // 探照灯扫过
    beam.rotation.y = Math.sin(time * 0.31) * 0.55
    beam.rotation.z = -0.72 + Math.sin(time * 0.19) * 0.09
    beamMat.opacity = 0.06 + Math.sin(time * 1.7) * 0.014
  }

  return { scene, camera, baseYaw, basePitch, exposure: 1.25, tick, dispose: () => {} }
}

// ---------------------------------------------------------------- bridge：雾里的桥

function buildBridge(track: Track, backdrop: string | null): Slice {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x131a21)
  scene.fog = new THREE.FogExp2(0x424c54, 0.022)

  const { camera, baseYaw, basePitch } = makeCamera([0.15, 1.7, 6.2], [-0.75, 1.34, -12], 54, 180)

  scene.add(new THREE.HemisphereLight(0x7c8a96, 0x12181c, 0.9))
  const cold = new THREE.DirectionalLight(0x94a9bd, 0.85)
  cold.position.set(-8, 9, 12)
  scene.add(cold)
  const lampLight = new THREE.PointLight(0xffd8a2, 58, 22, 2)
  lampLight.position.set(3.05, 4.1, -6.5)
  scene.add(lampLight)

  // 桥面（湿）
  const deckTex = track(canvasTexture(256, 256, concretePainter('#3a352f', '#211d19', '#524d45', 13, 5)))
  deckTex.repeat.set(4, 18)
  const deckMat = track(
    new THREE.MeshStandardMaterial({ map: deckTex, color: 0x7b766d, roughness: 0.42, metalness: 0.18 }),
  )
  scene.add(new THREE.Mesh(track(plane(7.6, 40, 0, 0, -12, -Math.PI / 2, 0, 0)), deckMat))

  // 灯在湿桥面上的竖向倒影
  const wetMat = track(
    new THREE.MeshBasicMaterial({
      map: track(canvasTexture(256, 256, streakPainter(29))),
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    }),
  )
  scene.add(new THREE.Mesh(track(plane(7.2, 30, 0, 0.015, -10, -Math.PI / 2, 0, 0)), wetMat))

  // 铁栏 + 路缘石：全合并成 1 次 draw call
  const railing: THREE.BufferGeometry[] = []
  for (const x of [-3.62, 3.62]) {
    for (let i = 0; i < 28; i += 1) {
      const z = 6 - i * 1.15
      railing.push(box(0.05, 1.02, 0.05, x, 0.55, z))
      railing.push(box(0.035, 0.035, 0.16, x, 1.01, z + 0.05))
    }
    railing.push(box(0.075, 0.075, 34, x, 1.07, -11))
    railing.push(box(0.055, 0.055, 34, x, 0.65, -11))
    railing.push(box(0.06, 0.06, 34, x, 0.17, -11))
    railing.push(box(0.22, 0.2, 34, x, 0.1, -11))
  }
  const railingMat = track(new THREE.MeshStandardMaterial({ color: 0x232a2e, roughness: 0.5, metalness: 0.65 }))
  scene.add(new THREE.Mesh(track(merge(railing)), railingMat))

  // 河面：反光烘在贴图里（低多边形夜景最省的一种做法）
  const waterTex = track(canvasTexture(256, 256, waterPainter(37)))
  waterTex.repeat.set(3, 5)
  const waterMat = track(new THREE.MeshBasicMaterial({ map: waterTex, color: 0xb4c0c8, fog: true }))
  scene.add(new THREE.Mesh(track(plane(220, 240, 0, -3.0, -34, -Math.PI / 2, 0, 0)), waterMat))

  // 河面上的灯影：几道竖向碎光，比给水面真打光便宜得多
  const glintMat = track(
    new THREE.MeshBasicMaterial({
      map: track(canvasTexture(256, 256, streakPainter(41))),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    }),
  )
  const glints = merge([
    plane(2.8, 28, 5.0, -2.96, -18, -Math.PI / 2, 0, 0),
    plane(2.8, 28, 7.8, -2.96, -18, -Math.PI / 2, 0, 0),
    plane(2.8, 28, -5.0, -2.96, -18, -Math.PI / 2, 0, 0),
    plane(2.8, 28, -7.8, -2.96, -18, -Math.PI / 2, 0, 0),
  ])
  scene.add(new THREE.Mesh(track(glints), glintMat))

  // 对岸的低矮剪影
  const bankR = prng(71)
  const bank: Inst[] = []
  for (let i = 0; i < 18; i += 1) {
    const h = 2 + bankR() * 7
    bank.push({
      x: -52 + i * 6 + bankR() * 3,
      y: h / 2 - 2.4,
      z: -32 - bankR() * 12,
      sx: 4 + bankR() * 6,
      sy: h,
      sz: 4,
    })
  }
  instanced(
    scene,
    track,
    new THREE.BoxGeometry(1, 1, 1),
    track(new THREE.MeshStandardMaterial({ color: 0x2a3136, roughness: 1, metalness: 0 })),
    bank,
  )

  // 灯柱 + 灯头 + 灯晕
  const posts: THREE.BufferGeometry[] = []
  const glowMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          64,
          64,
          glowPainter('rgba(255,228,182,0.95)', 'rgba(255,200,140,0.42)', 'rgba(255,180,120,0)'),
        ),
      ),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  const glows: THREE.BufferGeometry[] = []
  for (const z of [-3.2, -11, -18.6, -26]) {
    for (const x of [-3.2, 3.2]) {
      posts.push(cyl(0.055, 0.08, 4.3, 6, x, 2.15, z))
      posts.push(box(0.16, 0.2, 0.16, x, 4.32, z))
      posts.push(cyl(0.1, 0.07, 0.1, 6, x, 4.46, z))
      glows.push(plane(1.15, 1.15, x, 4.3, z + 0.1))
    }
  }
  scene.add(
    new THREE.Mesh(
      track(merge(posts)),
      track(new THREE.MeshStandardMaterial({ color: 0x2e3336, roughness: 0.6, metalness: 0.55 })),
    ),
  )
  scene.add(new THREE.Mesh(track(merge(glows)), glowMat))

  // 雾团：几片加色羽化面，缓慢漂
  const fogBankMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          128,
          128,
          glowPainter('rgba(196,206,214,0.55)', 'rgba(160,175,190,0.22)', 'rgba(120,135,150,0)'),
        ),
      ),
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  const fogMesh = new THREE.Mesh(
    track(merge([plane(42, 10, -2, 1.6, -16), plane(52, 12, 3, 2.2, -25), plane(64, 14, -3, 2.6, -35)])),
    fogBankMat,
  )
  scene.add(fogMesh)

  // 远景：程序化天空板 + 对岸剪影
  // （这里原本堆了一排沙袋，4 米外看过去全是黑石头，删了）
  addSky(scene, track, ['#141a21', '#39434b', '#5f676d'], 460, 220, 40, -130)

  addContactShadows(scene, track, shadowTex(track), [
    { x: 0, y: 0, z: -10, sx: 6.6, sz: 34 },
  ])

  const tick = (time: number, dt: number) => {
    waterTex.offset.y -= dt * 0.022
    waterTex.offset.x = Math.sin(time * 0.12) * 0.012
    fogMesh.position.x = Math.sin(time * 0.07) * 1.1
    fogBankMat.opacity = 0.28 + Math.sin(time * 0.5) * 0.03
    lampLight.intensity = 57 + Math.sin(time * 2.3) * 3
    glowMat.opacity = 0.58 + Math.sin(time * 1.9) * 0.05
  }

  return { scene, camera, baseYaw, basePitch, exposure: 1.06, tick, dispose: () => {} }
}

// ---------------------------------------------------------------- office-1947：造册的厢房

function buildOffice(track: Track): Slice {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.ink)

  const { camera, baseYaw, basePitch } = makeCamera([0.19, 1.28, 3.9], [-0.4, 1.0, -1.8], 44)

  scene.add(new THREE.HemisphereLight(0xc2d0dc, 0x2b2018, 0.5))
  const winLight = new THREE.DirectionalLight(0xa8c2dc, 0.95)
  winLight.position.set(-2.2, 4.8, -9)
  scene.add(winLight)
  const lamp = new THREE.PointLight(0xffb070, 18, 8.5, 2)
  lamp.position.set(1.15, 1.92, 0.5)
  scene.add(lamp)

  // 木地板
  const floorTex = track(canvasTexture(256, 256, plankPainter('#6a4d2e', '#33210f', '#7d5c39', 8, 13)))
  floorTex.repeat.set(4, 4)
  const floorMat = track(
    new THREE.MeshStandardMaterial({ map: floorTex, color: 0x9b8569, roughness: 0.56, metalness: 0.05 }),
  )
  scene.add(new THREE.Mesh(track(plane(9.8, 7.8, 0, 0, -0.3, -Math.PI / 2, 0, 0)), floorMat))

  // 墙 + 顶：后墙开窗洞，全部合并成 1 次 draw call
  const wallShape = new THREE.Shape()
  wallShape.moveTo(-4.8, 0)
  wallShape.lineTo(4.8, 0)
  wallShape.lineTo(4.8, 3.36)
  wallShape.lineTo(-4.8, 3.36)
  wallShape.closePath()
  const windowPath = new THREE.Path()
  windowPath.moveTo(-1.36, 0.96)
  windowPath.lineTo(1.36, 0.96)
  windowPath.lineTo(1.36, 2.86)
  windowPath.lineTo(-1.36, 2.86)
  windowPath.closePath()
  wallShape.holes.push(windowPath)
  const shell = new THREE.ShapeGeometry(wallShape)
  place(shell, 0, 0, -3.4)
  const ceil = new THREE.PlaneGeometry(9.8, 7.8)
  ceil.rotateX(Math.PI / 2)
  ceil.translate(0, 3.36, -0.3)
  const sideA = new THREE.PlaneGeometry(7.8, 3.36)
  sideA.rotateY(Math.PI / 2)
  sideA.translate(-4.7, 1.68, -0.3)
  const sideB = new THREE.PlaneGeometry(7.8, 3.36)
  sideB.rotateY(-Math.PI / 2)
  sideB.translate(4.7, 1.68, -0.3)
  const shellGeo = merge([shell, ceil, sideA, sideB])
  const plasterTex = track(canvasTexture(256, 256, concretePainter('#8f8674', '#6d6555', '#a49a86', 67, 2)))
  plasterTex.repeat.set(2, 2)
  const plasterMat = track(
    new THREE.MeshStandardMaterial({ map: plasterTex, color: 0x9d937f, roughness: 0.96, metalness: 0.02 }),
  )
  scene.add(new THREE.Mesh(track(shellGeo), plasterMat))

  // 窗外：雪景 + 飘雪 + 窗棂
  const viewTex = track(canvasTexture(256, 180, snowViewPainter()))
  viewTex.wrapS = THREE.ClampToEdgeWrapping
  viewTex.wrapT = THREE.ClampToEdgeWrapping
  const viewMat = track(new THREE.MeshBasicMaterial({ map: viewTex, color: 0xd2dce6, fog: false }))
  scene.add(new THREE.Mesh(track(plane(2.66, 1.86, 0, 1.91, -3.44)), viewMat))

  const snowTex = track(canvasTexture(128, 128, snowSpeckPainter(97)))
  const snowMat = track(
    new THREE.MeshBasicMaterial({ map: snowTex, transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
  )
  scene.add(new THREE.Mesh(track(plane(2.64, 1.84, 0, 1.91, -3.42)), snowMat))

  const latticeTex = track(canvasTexture(128, 128, plankPainter('#5a4026', '#281a0d', '#6d5030', 4, 43)))
  latticeTex.repeat.set(2, 2)
  const woodMat = track(
    new THREE.MeshStandardMaterial({ map: latticeTex, color: 0x8b7150, roughness: 0.7, metalness: 0.04 }),
  )
  const lattice: THREE.BufferGeometry[] = [
    box(2.92, 0.12, 0.18, 0, 2.9, -3.34),
    box(2.92, 0.12, 0.18, 0, 0.94, -3.34),
    box(0.12, 2.08, 0.18, -1.42, 1.9, -3.34),
    box(0.12, 2.08, 0.18, 1.42, 1.9, -3.34),
    box(0.07, 1.9, 0.1, -0.46, 1.91, -3.35),
    box(0.07, 1.9, 0.1, 0.46, 1.91, -3.35),
    box(2.7, 0.065, 0.1, 0, 1.5, -3.35),
    box(2.7, 0.065, 0.1, 0, 2.3, -3.35),
    box(2.7, 0.05, 0.1, 0, 1.9, -3.35),
    box(9.3, 0.15, 0.12, 0, 0.075, -3.33),
    // 窗台
    box(2.9, 0.09, 0.26, 0, 0.9, -3.28),
    // 墙边的柜子（填一下画面左边）
    box(1.0, 0.78, 0.42, -2.9, 0.39, -2.95),
    box(0.96, 0.04, 0.46, -2.9, 0.8, -2.95),
    box(0.9, 0.02, 0.02, -2.9, 0.48, -2.74),
    // 柜上的一摞账簿
    box(0.34, 0.16, 0.24, -2.78, 0.9, -2.98, 0, 0.12, 0),
  ]
  scene.add(new THREE.Mesh(track(merge(lattice)), woodMat))

  // 木桌（加一把椅子会挡住桌面，而且从背后看是个黑块，不画）
  const deskGeo = merge([
    box(1.68, 0.07, 0.84, -0.14, 0.76, 0.06),
    box(0.09, 0.76, 0.09, -0.88, 0.38, -0.28),
    box(0.09, 0.76, 0.09, 0.6, 0.38, -0.28),
    box(0.09, 0.76, 0.09, -0.88, 0.38, 0.4),
    box(0.09, 0.76, 0.09, 0.6, 0.38, 0.4),
    box(1.54, 0.07, 0.07, -0.14, 0.2, -0.28),
    box(0.07, 0.07, 0.6, -0.88, 0.2, 0.06),
    box(0.07, 0.07, 0.6, 0.6, 0.2, 0.06),
    // 抽屉
    box(0.6, 0.17, 0.48, 0.26, 0.63, 0.06),
    box(0.05, 0.05, 0.05, 0.5, 0.63, 0.3),
    box(0.05, 0.05, 0.05, 0.02, 0.63, 0.3),
    // 《抗战史料》的稿匣：桌上只有一个
    box(0.44, 0.15, 0.32, 0.16, 0.87, -0.2, 0, 0.18, 0),
    box(0.06, 0.09, 0.004, 0.3, 0.87, -0.04, 0, 0.18, 0),
  ])
  scene.add(new THREE.Mesh(track(deskGeo), woodMat))

  // 砚台（带余墨）+ 茶盏 + 小瓷瓶
  const stoneMat = track(new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.36, metalness: 0.12 }))
  const inkstone = merge([
    cyl(0.13, 0.135, 0.05, 10, 0.4, 0.815, -0.18),
    cyl(0.098, 0.098, 0.014, 10, 0.4, 0.842, -0.18),
    cyl(0.052, 0.042, 0.07, 8, 0.66, 0.84, -0.1),
    box(0.028, 0.028, 0.028, 0.7, 0.87, -0.09),
    cyl(0.032, 0.026, 0.09, 8, -0.62, 0.845, -0.16),
  ])
  scene.add(new THREE.Mesh(track(inkstone), stoneMat))

  // 毛边纸：一叠，纸边裁得不齐
  const paperTex = track(canvasTexture(128, 128, paperPainter('#e2d8c2', '#f6efdd', 'rgba(120,100,70,0.14)', 53)))
  const paperMat = track(
    new THREE.MeshStandardMaterial({ map: paperTex, color: PALETTE.paper, roughness: 0.95, metalness: 0 }),
  )
  const paperR = prng(59)
  const sheets: THREE.BufferGeometry[] = []
  const stackX = -0.46
  const stackZ = 0.02
  for (let i = 0; i < 12; i += 1) {
    sheets.push(
      box(
        0.44 + paperR() * 0.03,
        0.008,
        0.3 + paperR() * 0.02,
        stackX + (paperR() - 0.5) * 0.02,
        0.802 + i * 0.0085,
        stackZ + (paperR() - 0.5) * 0.02,
        0,
        (paperR() - 0.5) * 0.07,
        0,
      ),
    )
  }
  // 摊开的一页
  sheets.push(box(0.46, 0.006, 0.32, -0.26, 0.802, 0.26, 0, 0.16, 0))
  scene.add(new THREE.Mesh(track(merge(sheets)), paperMat))

  // 笔搁在笔架上（深竹杆 + 笔头）
  const brushMat = track(new THREE.MeshStandardMaterial({ color: 0x3e3327, roughness: 0.55, metalness: 0.06 }))
  const brush = merge([
    cyl(0.009, 0.012, 0.3, 5, 0.12, 0.905, -0.02, 0, 0, Math.PI / 2 - 0.1),
    cyl(0.002, 0.012, 0.07, 5, 0.29, 0.892, -0.02, 0, 0, Math.PI / 2 - 0.1),
    box(0.17, 0.06, 0.06, 0.12, 0.833, -0.02),
    box(0.04, 0.05, 0.05, 0.03, 0.87, -0.02),
  ])
  scene.add(new THREE.Mesh(track(brush), brushMat))

  // 吊灯（放低一点，进画面）
  const shadeMat = track(new THREE.MeshStandardMaterial({ color: 0x4c3d2c, roughness: 0.55, metalness: 0.4 }))
  const shade = merge([
    cyl(0.008, 0.008, 1.24, 4, 1.15, 2.55, 0.5),
    cyl(0.19, 0.07, 0.2, 10, 1.15, 1.96, 0.5),
  ])
  scene.add(new THREE.Mesh(track(shade), shadeMat))
  const bulbMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffe2b4,
      emissive: 0xffb271,
      emissiveIntensity: 4.2,
      roughness: 0.4,
    }),
  )
  const bulb = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.06, 0)), bulbMat)
  bulb.position.set(1.15, 1.85, 0.5)
  scene.add(bulb)
  // 灯泡外的一小圈暖雾
  const haloMat = track(
    new THREE.MeshBasicMaterial({
      map: track(
        canvasTexture(
          64,
          64,
          glowPainter('rgba(255,206,152,0.72)', 'rgba(255,176,116,0.24)', 'rgba(255,160,100,0)'),
        ),
      ),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  scene.add(new THREE.Mesh(track(plane(1.5, 1.5, 1.15, 1.9, 0.5)), haloMat))

  // 窗光打进房间：冷色光柱 + 地面光斑（同一材质，合并成 1 次 draw call）
  const shaftMat = track(
    new THREE.MeshBasicMaterial({
      map: track(canvasTexture(128, 256, shaftPainter())),
      color: 0xbcd3ea,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  )
  const shafts = merge([
    plane(2.9, 4.0, -1.1, 1.6, -2.4, 0.14, 0.26, 0.14),
    plane(2.6, 1.2, -1.2, 0.02, -1.1, -Math.PI / 2, 0, 0.1),
  ])
  scene.add(new THREE.Mesh(track(shafts), shaftMat))

  addContactShadows(scene, track, shadowTex(track), [
    { x: -0.14, y: 0.012, z: 0.06, sx: 2.6, sz: 1.8 },
    { x: -0.46, y: 0.016, z: 0.02, sx: 1.1, sz: 0.8 },
    { x: 0.72, y: 0.016, z: 1.0, sx: 1.3, sz: 1.3 },
    { x: -1.55, y: 0.016, z: -0.5, sx: 1.1, sz: 0.9 },
    { x: 1.15, y: 0.016, z: 0.5, sx: 1.5, sz: 1.5 },
  ])

  const tick = (time: number, dt: number) => {
    snowTex.offset.y -= dt * 0.055
    lamp.intensity = 18 + Math.sin(time * 3.1) * 0.6
    bulbMat.emissiveIntensity = 4.1 + Math.sin(time * 2.7) * 0.16
    haloMat.opacity = 0.58 + Math.sin(time * 3.1) * 0.03
  }

  return { scene, camera, baseYaw, basePitch, exposure: 1.02, tick, dispose: () => {} }
}

// ---------------------------------------------------------------- 组装

function createSlice(variant: Scene3DVariant, onGlb?: (status: 'loading' | 'ready' | 'failed') => void): Slice {
  const { track, dispose } = makeTrash()
  const backdrop = SCENE_3D_BACKDROP[variant]
  let slice: Slice
  switch (variant) {
    case 'warehouse-ext':
      slice = buildWarehouseExt(track, onGlb)
      break
    case 'rooftop':
      slice = buildRooftop(track, backdrop)
      break
    case 'bridge':
      slice = buildBridge(track, backdrop)
      break
    case 'office-1947':
      slice = buildOffice(track)
      break
    case 'warehouse-int':
    default:
      slice = buildWarehouse(track, backdrop)
      break
  }
  const ownDispose = slice.dispose
  slice.dispose = () => {
    ownDispose()
    dispose()
  }
  return slice
}

// ---------------------------------------------------------------- React 组件

const HOST_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: '#0a0807',
  pointerEvents: 'none',
  zIndex: 0,
}

const GRADE_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background:
    'radial-gradient(130% 100% at 50% 46%, transparent 52%, rgba(5, 4, 3, 0.55) 100%), linear-gradient(180deg, rgba(5, 4, 3, 0.4), transparent 20%, transparent 78%, rgba(5, 4, 3, 0.62))',
}

type Props = { variant: Scene3DVariant }

export default function Scene3D({ variant }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // 每次挂载都从干净的 data-* 开始：否则上一轮（同一切片再次进入）的 fps / ready
    // 会污染这一轮的首帧测量
    delete host.dataset.fps
    delete host.dataset.calls
    delete host.dataset.tris
    delete host.dataset.ready
    delete host.dataset.glb
    delete host.dataset.gl
    // effect 开始跑的瞬间：和 data-ready 相减就是「WebGL 初始化 + 切片搭建」的耗时，
    // 与 data-ready 减点击瞬间（含 lazy chunk 下载）分开记，报告里要能分辨是哪一段慢
    host.dataset.mounted = String(Math.round(performance.now()))
    let created: THREE.WebGLRenderer | null = null
    try {
      created = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      host.dataset.gl = 'unavailable'
      return // WebGL 不可用：不画，父层背景还在
    }
    const gl = created
    const canvas = gl.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    host.appendChild(canvas)

    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
    gl.outputColorSpace = THREE.SRGBColorSpace
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.shadowMap.enabled = false // 见文件头：带影光会把 draw calls 翻倍

    const slice = createSlice(variant, (status) => {
      host.dataset.glb = status
    })
    gl.toneMappingExposure = slice.exposure
    const camera = slice.camera

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      // 浏览器缩放会改 devicePixelRatio 并触发 resize：每次都重新夹一次，
      // 否则从 100% 缩到 150% 之后缓冲区还是旧比例，3D 会一直发糊
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      if (Math.abs(dpr - gl.getPixelRatio()) > 0.01) gl.setPixelRatio(dpr)
      gl.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()

    // 指针驱动：窗口内的 pointermove 都算，按容器矩形归一化
    let targetYaw = 0
    let targetPitch = 0
    let yaw = 0
    let pitch = 0

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      const nx = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1)
      const ny = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1)
      // 指针往右 → 看右边（yaw 取负）；硬夹在 ±18° / ±14° 内，不会无限抬头低头
      targetYaw = -nx * MAX_YAW
      targetPitch = -ny * MAX_PITCH
    }
    const onReset = () => {
      targetYaw = 0
      targetPitch = 0
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let last = 0
    let frames = 0
    let acc = 0
    let peakCalls = 0
    let peakTris = 0

    const loop = (time: number) => {
      const raw = last === 0 ? 1 / 60 : (time - last) / 1000
      // 动画用钳过的 dt：卡顿一帧之后不要一次把旗面/水面推出去太远
      const dt = Math.min(raw, 0.05)
      last = time
      // 阻尼 0.08 = 「60fps 下每帧补 8%」，按 dt 归一后换帧率手感一致
      const k = 1 - Math.pow(1 - DAMP, dt * 60)
      yaw += (targetYaw - yaw) * k
      pitch += (targetPitch - pitch) * k
      camera.rotation.set(slice.basePitch + pitch, slice.baseYaw + yaw, 0)
      if (!reduce) slice.tick(time / 1000, dt)
      gl.render(slice.scene, camera)
      // 首帧到达时刻（毫秒，navigationStart 起算）：tools/test-3d.mjs 用它算「点按钮 → 出画面」
      if (host.dataset.ready === undefined) host.dataset.ready = String(Math.round(performance.now()))

      const drawn = gl.info.render
      if (drawn.calls > peakCalls) peakCalls = drawn.calls
      if (drawn.triangles > peakTris) peakTris = drawn.triangles
      frames += 1
      // fps 必须用没钳过的真实墙钟：用钳过的 dt 会在卡顿时把 20fps 报成 100fps
      acc += Math.min(raw, 5)
      if (acc >= 0.5) {
        host.dataset.fps = (frames / acc).toFixed(1)
        host.dataset.calls = String(peakCalls)
        host.dataset.tris = String(peakTris)
        frames = 0
        acc = 0
      }
    }
    gl.setAnimationLoop(loop)

    const observer = new ResizeObserver(() => {
      resize()
    })
    observer.observe(host)

    let contextLost = false

    const onVisibility = () => {
      if (document.hidden || contextLost) {
        gl.setAnimationLoop(null)
      } else {
        last = 0
        gl.setAnimationLoop(loop)
      }
    }
    const onContextLost = (event: Event) => {
      // preventDefault 之后浏览器才会发 webglcontextrestored；不拦就永远回不来
      event.preventDefault()
      contextLost = true
      gl.setAnimationLoop(null)
      host.dataset.gl = 'lost'
      delete host.dataset.fps
      // 安全回退：先把画布藏起来，露出父层背景（正文卡片还在），不留一块死黑板
      canvas.style.visibility = 'hidden'
    }
    const onContextRestored = () => {
      contextLost = false
      host.dataset.gl = 'restored'
      canvas.style.visibility = 'visible'
      // three 在 restore 时自己重建 GL 状态（几何/材质/贴图的 CPU 端还在），重开循环即可
      last = 0
      gl.setAnimationLoop(loop)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', onReset)
    document.addEventListener('pointerleave', onReset)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    // 滚轮不监听：页面该滚就滚，这里不改 fov 也不改距离

    return () => {
      gl.setAnimationLoop(null)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', onReset)
      document.removeEventListener('pointerleave', onReset)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      // 先扔场景资源，再扔 renderer
      slice.dispose()
      gl.dispose()
      gl.forceContextLoss()
      canvas.remove()
      delete host.dataset.fps
      delete host.dataset.calls
      delete host.dataset.tris
      delete host.dataset.ready
      delete host.dataset.glb
      delete host.dataset.gl
      delete host.dataset.mounted
    }
  }, [variant])

  return (
    <div ref={hostRef} className="scene3d" data-variant={variant} aria-hidden="true" style={HOST_STYLE}>
      <div style={GRADE_STYLE} />
    </div>
  )
}
