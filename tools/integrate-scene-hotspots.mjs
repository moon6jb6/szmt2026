import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const file = path.join(ROOT, 'src', 'App.tsx')
let s = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
const miss = []
const sub = (from, to) => {
  if (!s.includes(from)) {
    miss.push(from.slice(0, 70))
    return
  }
  s = s.replace(from, to)
}

// import
sub(
  "import { FlagRaise } from './game/components/FlagRaise'\n",
  "import { FlagRaise } from './game/components/FlagRaise'\nimport SceneHotspots, { SCENE_HOTSPOTS } from './game/components/SceneHotspots'\n",
)

// state：场景探索模式
sub(
  '  const [signature, setSignature] = useState<\'spot\' | \'flag\' | null>(null)\n',
  `  const [signature, setSignature] = useState<'spot' | 'flag' | null>(null)
  // 「场景探索」：背景图 + 热点；与真 3D 视角是两个独立入口
  const [exploreVariant, setExploreVariant] = useState<keyof typeof SCENE_HOTSPOTS | null>(null)
`,
)

// 键盘守卫：探索覆盖层 / 签名时不吃 1—9
sub(
  "      const { screen, scene, pending, onAdvance, onChoose, signature } = keyState.current\n      if (signature) return\n",
  "      const { screen, scene, pending, onAdvance, onChoose, signature, exploreVariant } = keyState.current\n      if (signature || exploreVariant) return\n",
)
sub(
  '  const keyState = useRef({ screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature })\n  keyState.current = { screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature }\n',
  '  const keyState = useRef({ screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature, exploreVariant })\n  keyState.current = { screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature, exploreVariant }\n',
)

// 换场景时关闭探索
sub(
  '  useEffect(() => {\n    scrollCurrentToTop(false)\n  }, [screen, sceneId, personId, laterId])\n',
  '  useEffect(() => {\n    scrollCurrentToTop(false)\n    setExploreVariant(null)\n  }, [screen, sceneId, personId, laterId])\n',
)

// 场景页按钮：在「3D 视角」左边加「场景探索」
sub(
  `          {scene3dSpec && canUse3D() && (
            <button
              type="button"
              className={\`view3d-toggle \${show3d ? 'on' : ''}\`}
              aria-pressed={show3d}
              onClick={() => setView3dScene((current) => (current === sceneId ? null : sceneId))}
            >
              {show3d ? '回到 2.5D' : '3D 视角'}
            </button>
          )}`,
  `          {scene3dSpec && (
            <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={\`view3d-toggle \${exploreVariant ? 'on' : ''}\`}
                aria-pressed={Boolean(exploreVariant)}
                onClick={() =>
                  setExploreVariant((current) => (current === scene3dSpec.variant ? null : scene3dSpec.variant))
                }
              >
                {exploreVariant ? '回到正文' : '场景探索'}
              </button>
              {canUse3D() && (
                <button
                  type="button"
                  className={\`view3d-toggle \${show3d ? 'on' : ''}\`}
                  aria-pressed={show3d}
                  onClick={() => setView3dScene((current) => (current === sceneId ? null : sceneId))}
                >
                  {show3d ? '回到 2.5D' : '3D 视角'}
                </button>
              )}
            </div>
          )}`,
)

// 覆盖层：放在签名覆盖层同区域，先于 signature 渲染
sub(
  '      {signature && (\n',
  `      {exploreVariant && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            background: '#0a0806',
          }}
        >
          <SceneHotspots
            variant={exploreVariant}
            hotspots={SCENE_HOTSPOTS[exploreVariant]}
            reduceMotion={window.matchMedia('(prefers-reduced-motion: reduce)').matches}
            onSound={(cue) => {
              if (audioOn) playSfx(cue === 'thud' ? 'distant-thud' : cue)
            }}
            onOpenSource={(id) => setSourcePanel(id)}
            onExit={() => setExploreVariant(null)}
          />
        </div>
      )}
      {signature && (
`,
)

// 场景标题按钮位置：原按钮改成 flex 容器后，.scene-head 相对定位已有，无需改
await writeFile(file, s, 'utf8')
console.log('misses:', miss.length ? miss : 'none')
