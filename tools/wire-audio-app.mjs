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

// 1) imports
sub(
  `import {
  ambienceForScene,
  ambienceForScreen,
  clickSoundFor,
  droneForEnding,
  isAudioUnlocked,
  isMuted,
  playSfx,
  setAmbience,
  setDrone,
  setMuted,
  unlockAudio,
} from './game/audio'`,
  `import {
  ambienceForScene,
  ambienceForScreen,
  carrierEvent,
  droneForEnding,
  isAudioUnlocked,
  isMuted,
  playAccentForScene,
  playEvent,
  playSfx,
  playTransition,
  setAmbience,
  setDrone,
  setMuted,
  uiEventForScreen,
  unlockAudio,
} from './game/audio'`,
)

// 2) toggleAudio 开声回执
sub(
  '    if (next) void unlockAudio()\n  }\n',
  "    if (next) {\n      void unlockAudio().then(() => playEvent('ui:audio:on'))\n    }\n  }\n",
)

// 3) startNew / resume：菜单点击
sub(
  '  const startNew = () => {\n    if (audioOn) void unlockAudio()\n',
  "  const startNew = () => {\n    if (audioOn) void unlockAudio()\n    playEvent('menu:click')\n",
)
sub(
  '  const resume = () => {\n    if (audioOn) void unlockAudio()\n',
  "  const resume = () => {\n    if (audioOn) void unlockAudio()\n    playEvent('menu:click')\n",
)

// 4) runCurtain 换场声
sub(
  '  const runCurtain = (swap: () => void, opts?: CurtainOpts) => {\n',
  "  const runCurtain = (swap: () => void, opts?: CurtainOpts) => {\n    playTransition(weatherVariant())\n",
)

// 5) onChoose：载体事件
sub(
  '      if (!isAudioUnlocked()) void unlockAudio()\n      playSfx(clickSoundFor(burstKind))\n',
  '      if (!isAudioUnlocked()) void unlockAudio()\n      playEvent(carrierEvent(burstKind))\n',
)

// 6) onAdvance：翻页事件
sub("    if (audioOn) playSfx('page-turn')\n", "    if (audioOn) playEvent('page:advance')\n")

// 7) beginFinale 起势
sub(
  '  const beginFinale = () => {\n    setFinaleDone(false)\n',
  "  const beginFinale = () => {\n    setFinaleDone(false)\n    playEvent('ending:finale:start')\n",
)

// 8) 结局页进入 + drone 淡入
sub(
  "    } else if (screen === 'ending' && state.ending) {\n      setAmbience(null)\n      setDrone(droneForEnding(state.ending))\n",
  "    } else if (screen === 'ending' && state.ending) {\n      setAmbience(null)\n      setDrone(droneForEnding(state.ending), { fadeInMs: finaleDone ? 1600 : 3000 })\n",
)
sub(
  '  }, [audioOn, screen, sceneId, scene?.weather, scene?.chapter, scene?.location, state.ending])\n',
  '  }, [audioOn, screen, sceneId, scene?.weather, scene?.chapter, scene?.location, state.ending, finaleDone])\n',
)

// 9) 场景点缀 + 页面事件 + 人物/后来 + 悬停委托 + 史料卡开合
sub(
  '  const startNew = () => {\n',
  `  // 场景点缀（关键词规则 + 冷却）、页面事件、史料卡开合、悬停 tick
  useEffect(() => {
    if (!audioOn || screen !== 'game' || !scene) return
    playAccentForScene(scene.id, scene.paragraphs.join(''))
  }, [audioOn, screen, sceneId])
  const prevScreenRef = useRef(screen)
  useEffect(() => {
    if (screen === prevScreenRef.current) return
    prevScreenRef.current = screen
    const event = uiEventForScreen(screen)
    if (event) playEvent(event)
  }, [screen])
  useEffect(() => {
    if (personId) playEvent('ui:person:open')
  }, [personId])
  useEffect(() => {
    if (laterId) playEvent('ui:later:open')
  }, [laterId])
  const prevSourcePanel = useRef<string | null>(null)
  useEffect(() => {
    if (!audioOn) {
      prevSourcePanel.current = sourcePanel
      return
    }
    if (sourcePanel && !prevSourcePanel.current) playEvent('ui:source:open')
    if (!sourcePanel && prevSourcePanel.current) playEvent('ui:source:close')
    prevSourcePanel.current = sourcePanel
  }, [sourcePanel, audioOn])
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return
    let last = 0
    const onOver = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('button, .choice, .chip, .gallery-card, .people-card')) return
      const now = Date.now()
      if (now - last < 240) return
      last = now
      playEvent('ui:hover')
    }
    document.addEventListener('pointerover', onOver, { passive: true })
    return () => document.removeEventListener('pointerover', onOver)
  }, [])

  const startNew = () => {
`,
)

// 10) 3D 开关事件
sub(
  '                  onClick={() => setView3dScene((current) => (current === sceneId ? null : sceneId))}\n',
  `                  onClick={() => {
                    const next = view3dScene === sceneId ? null : sceneId
                    playEvent(next ? 'ui:3d:on' : 'ui:3d:off')
                    setView3dScene(next)
                  }}
`,
)

// 11) 进入结局页
sub(
  "          setScreen('ending')\n          beginFinale()\n",
  "          setScreen('ending')\n          playEvent('ending:enter')\n          beginFinale()\n",
)

// 12) 终极画面收束
sub(
  '        <EndingFinale key={finaleKey} kind={state.ending} onDone={() => setFinaleDone(true)} />\n',
  `        <EndingFinale
          key={finaleKey}
          kind={state.ending}
          onDone={() => {
            setFinaleDone(true)
            playEvent('ending:finale:end')
          }}
        />
`,
)

await writeFile(file, s, 'utf8')
console.log('misses:', miss.length ? miss : 'none')
