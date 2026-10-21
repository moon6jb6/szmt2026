/**
 * 3D 切片清单（真 3D 是增强，不是必需）
 *
 * 依据 docs/superpowers/specs/2026-10-22-3d-audio-plan.md「一、3D 决策」：
 * 只做少量 hero 切片，不做全项目 3D 化。本文件只回答「哪个场景用哪个切片」，
 * 画面怎么搭由 components/Scene3D.tsx 决定（内容与表现分离）。
 *
 * 回退：WebGL 不可用 / prefers-reduced-motion / 屏幕 < 700px 时，
 * App 侧不要挂 Scene3D，继续用 Stage 的 2.5D 分层。
 *
 * 路径约定：所有静态资源写相对路径（不带前导 /），由 Scene3D 拼 import.meta.env.BASE_URL，
 * 这样 `vite base:'./'` 子目录部署也能取到；不要在这里写死 '/'。
 */

export type Scene3DVariant = 'warehouse-int' | 'warehouse-ext' | 'rooftop' | 'bridge' | 'office-1947'

export type Scene3DSpec = {
  /** 场景切片 id */
  variant: Scene3DVariant
}

/**
 * 场景 id → 切片。
 * 只挂「值得做 3D」的场景：五夜里的关键场 + 到达仓库 + 扩写卷/序卷/尾声。
 */
export const SCENE_3D: Record<string, Scene3DSpec> = {
  // 仓库外观（Blender 导出的西墙 GLB）：到达 / 铁门
  'v1-24': { variant: 'warehouse-ext' },
  'v1-25': { variant: 'warehouse-ext' },

  // 仓库底楼内景（夜·点名 / 扩写内景）
  night1: { variant: 'warehouse-int' },
  'v2-03': { variant: 'warehouse-int' },
  'v2-05': { variant: 'warehouse-int' },

  // 楼顶升旗
  night3: { variant: 'rooftop' },
  night3b: { variant: 'rooftop' },

  // 渡河 / 桥
  night5b: { variant: 'bridge' },
  'v2-44': { variant: 'bridge' },

  // 1947 厢房造册（序卷 / 尾声）
  'v0-02': { variant: 'office-1947' },
  'v0-03': { variant: 'office-1947' },
  epilogue: { variant: 'office-1947' },
}

/** 挂 3D 的场景 id（调试与冒烟用） */
export const SCENE_3D_IDS: string[] = Object.keys(SCENE_3D)

/**
 * 每个切片的「远处背景贴图」，null 表示该切片不用贴图（远景走程序化天空板）。
 * - warehouse-int 用 warehouse.jpg 当远端墙面，麻袋与高窗的构图正好接得上；
 * - rooftop / bridge / warehouse-ext 用程序化天空 + 3D 主体，避免「两个地平线打架」；
 * - office-1947 是内景，窗外用 canvas 画的雪景。
 * 主体一律是真 3D，贴图只当远景。
 */
export const SCENE_3D_BACKDROP: Record<Scene3DVariant, string | null> = {
  'warehouse-int': 'bg/warehouse.jpg',
  'warehouse-ext': null,
  rooftop: null,
  bridge: null,
  'office-1947': null,
}

/** 取某个场景的切片；没有就返回 null（调用方回退 2.5D） */
export function getScene3D(id: string): Scene3DSpec | null {
  return SCENE_3D[id] ?? null
}
