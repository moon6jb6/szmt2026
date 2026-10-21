import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 恢复 App 集成：CarryTray / 签名时刻 / 回顶。外部进程曾把 App.tsx 回滚到 HEAD。 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const file = path.join(ROOT, 'src', 'App.tsx')
let s = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
const miss = []
const sub = (from, to) => {
  if (!s.includes(from)) {
    miss.push(from.slice(0, 60))
    return
  }
  s = s.replace(from, to)
}

// 1) 组件 import
sub(
  "} from './game/audio'\n",
  "} from './game/audio'\nimport { CarryTray } from './game/components/CarryTray'\nimport { SpotlightFind } from './game/components/SpotlightFind'\nimport { FlagRaise } from './game/components/FlagRaise'\n",
)

// 2) 签名时刻 state + 回顶 helper（插在 show3d 之后）
sub(
  '  const show3d = view3dScene === sceneId && Boolean(scene3dSpec)\n',
  `  const show3d = view3dScene === sceneId && Boolean(scene3dSpec)

  /** 换页/换场后回到置顶：游戏内滚 .stage-content，菜单与读者页滚窗口。 */
  const scrollCurrentToTop = (smooth: boolean) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = smooth && !reduce ? 'smooth' : 'auto'
    const stage = document.querySelector<HTMLElement>('.stage-content')
    if (stage) stage.scrollTo({ top: 0, behavior })
    window.scrollTo({ top: 0, behavior })
  }
  useEffect(() => {
    scrollCurrentToTop(false)
  }, [screen, sceneId, personId, laterId])
  useEffect(() => {
    if (state.pendingOutcome) scrollCurrentToTop(true)
  }, [state.pendingOutcome])

  // 两个「签名时刻」：第一夜灯下找名字、第三夜升旗。每局一次，Esc 可跳过。
  const [signatureDone, setSignatureDone] = useState<('spot' | 'flag')[]>([])
  const [signature, setSignature] = useState<'spot' | 'flag' | null>(null)
  const finishSignature = (kind: 'spot' | 'flag') => {
    setSignatureDone((prev) => (prev.includes(kind) ? prev : [...prev, kind]))
    setSignature(null)
    if (audioOn) playSfx('paper')
  }
  useEffect(() => {
    if (screen !== 'game') {
      setSignature(null)
      return
    }
    if (sceneId === 'night1' && !signatureDone.includes('spot')) setSignature('spot')
    else if (sceneId === 'night3' && !signatureDone.includes('flag')) setSignature('flag')
    else setSignature(null)
  }, [screen, sceneId, signatureDone])
  useEffect(() => {
    if (!signature) return
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finishSignature(signature)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
`,
)

// 3) keyState 加 signature 守卫 + 尾声让路
sub(
  '  const keyState = useRef({ screen, scene, pending: state.pendingOutcome, onAdvance, onChoose })\n  keyState.current = { screen, scene, pending: state.pendingOutcome, onAdvance, onChoose }\n',
  '  const keyState = useRef({ screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature })\n  keyState.current = { screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature }\n',
)
sub(
  '      const { screen, scene, pending, onAdvance, onChoose } = keyState.current\n      if (screen !== \'game\' || !scene) return\n',
  '      const { screen, scene, pending, onAdvance, onChoose, signature } = keyState.current\n      if (signature) return\n      if (screen !== \'game\' || !scene) return\n',
)
sub(
  '      const index = Number.parseInt(event.key, 10)\n      if (!Number.isNaN(index) && index >= 1 && index <= (scene.choices?.length ?? 0)) {\n',
  '      // 尾声的 1—9 / Enter 交给 CarryTray（需要选中 + 确认/按手印），这里让路\n      if (scene.id === \'epilogue\') return\n      const index = Number.parseInt(event.key, 10)\n      if (!Number.isNaN(index) && index >= 1 && index <= (scene.choices?.length ?? 0)) {\n',
)

// 4) 尾声 choices -> CarryTray
sub(
  `          {!hasOutcome && scene.choices && scene.choices.length > 0 && (
            <div className="choices">
`,
  `          {!hasOutcome && scene.choices && scene.choices.length > 0 &&
            (scene.id === 'epilogue' ? (
              <CarryTray
                choices={scene.choices}
                onChoose={(id) => onChoose(id)}
                onSound={(id) => {
                  if (audioOn) playSfx('paper')
                }}
              />
            ) : (
              <div className="choices">
`,
)
sub(
  `              })}
            </div>
          )}

          {hasOutcome && (
`,
  `              })}
              </div>
            ))}

          {hasOutcome && (
`,
)

// 5) 签名覆盖层（插在 renderSourcePanel 之前）
sub(
  '      {renderSourcePanel()}\n',
  `      {signature && (
        <div
          className="signature-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            display: 'grid',
            placeItems: 'center',
            padding: 'clamp(10px, 2vw, 28px)',
            background: 'rgba(7, 5, 4, 0.96)',
          }}
        >
          <button
            type="button"
            className="quiet-button"
            onClick={() => finishSignature(signature)}
            style={{ position: 'fixed', top: 16, right: 18, zIndex: 81, fontSize: 12 }}
          >
            跳过（Esc）
          </button>
          {signature === 'spot' ? (
            <SpotlightFind
              seed={4}
              reduceMotion={window.matchMedia('(prefers-reduced-motion: reduce)').matches}
              onSound={(cue) => {
                if (audioOn) playSfx(cue)
              }}
              onComplete={() => finishSignature('spot')}
            />
          ) : (
            <FlagRaise
              reduceMotion={window.matchMedia('(prefers-reduced-motion: reduce)').matches}
              onSound={(cue) => {
                if (audioOn) playSfx(cue === 'rope' ? 'ink' : 'flag-flap')
              }}
              onComplete={() => finishSignature('flag')}
              onSkip={() => finishSignature('flag')}
            />
          )}
        </div>
      )}
      {renderSourcePanel()}
`,
)

await writeFile(file, s, 'utf8')
console.log('misses:', miss.length ? miss : 'none')
