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
  "import SceneHotspots, { SCENE_HOTSPOTS } from './game/components/SceneHotspots'\n",
  "import SceneHotspots, { SCENE_HOTSPOTS } from './game/components/SceneHotspots'\nimport { SceneBeats } from './game/components/SceneBeats'\n",
)

// mood state
sub(
  '  const [exploreVariant, setExploreVariant] = useState<keyof typeof SCENE_HOTSPOTS | null>(null)\n',
  "  const [exploreVariant, setExploreVariant] = useState<keyof typeof SCENE_HOTSPOTS | null>(null)\n  /** 长段落分段阅读时的情绪（场景/回忆/人物剪影），用来微调背景 */\n  const [beatMood, setBeatMood] = useState<'scene' | 'memory' | 'figure-male' | 'figure-female'>('scene')\n",
)

// 键盘：beats 未读完时不让全局 Enter/数字抢
sub(
  '      if (screen !== \'game\' || !scene) return\n      if (pending) {\n',
  "      if (screen !== 'game' || !scene) return\n      // 分段阅读组件还在推进中时，键盘归它\n      if (document.querySelector('.beats[data-done=\"false\"]')) return\n      if (pending) {\n",
)

// scene 根节点带 mood
sub(
  '      <div key={scene.id} className={`scene ${show3d ? \'scene-in-3d\' : \'\'}`} data-scene={scene.id}>\n',
  '      <div key={scene.id} className={`scene ${show3d ? \'scene-in-3d\' : \'\'}`} data-scene={scene.id} data-beat-mood={beatMood}>\n',
)

// 抽出 renderChoices / renderContinue，并把正文渲染改为长段落分段
sub(
  '  const renderScene = () => {\n    if (!scene) return null\n    const hasOutcome = state.pendingOutcome !== null\n\n    return (\n',
  `  const renderChoices = () => {
    if (!scene?.choices || scene.choices.length === 0) return null
    if (scene.id === 'epilogue') {
      return (
        <CarryTray
          choices={scene.choices}
          onChoose={(id) => onChoose(id)}
          onSound={() => {
            if (audioOn) playSfx('paper')
          }}
        />
      )
    }
    return (
      <div className="choices">
        {scene.choices.map((choice, index) => {
          const kind = burstKindFor(choice)
          return (
            <button
              key={choice.id}
              className="choice"
              data-choice={choice.id}
              data-kind={kind}
              style={{ ['--i' as string]: String(index) }}
              onClick={(event) => onChoose(choice.id, event)}
            >
              <span className="choice-index">{index + 1}</span>
              <span className="choice-text">
                <strong>{choice.label}</strong>
                {choice.hint && <em>{choice.hint}</em>}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  const renderContinue = () => {
    if (state.pendingOutcome === null) return null
    return (
      <button
        className="primary-button continue"
        onClick={(event) => {
          fireBurst('continue', event.clientX, event.clientY)
          onAdvance()
        }}
      >
        {state.ending ? '把东西交出去' : '继续'}
      </button>
    )
  }

  const renderBody = () => {
    if (!scene) return null
    const hasOutcome = state.pendingOutcome !== null
    const paras = hasOutcome ? state.pendingOutcome!.paragraphs : scene.paragraphs
    if (paras.length <= 6) return renderParagraphs(paras)
    return (
      <SceneBeats
        className="beats--flat"
        paragraphs={paras}
        reduceMotion={window.matchMedia('(prefers-reduced-motion: reduce)').matches}
        onSound={(cue) => {
          if (audioOn) playSfx(cue)
        }}
        onBeatChange={(info) => setBeatMood(info.mood)}
        footer={() => (hasOutcome ? renderContinue() : renderChoices())}
      />
    )
  }

  const renderScene = () => {
    if (!scene) return null
    const hasOutcome = state.pendingOutcome !== null

    return (
`,
)

// 替换正文段落渲染
sub(
  '          {renderParagraphs(hasOutcome ? state.pendingOutcome!.paragraphs : scene.paragraphs)}\n',
  '          {renderBody()}\n',
)

// 替换 choices 块
sub(
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
                {scene.choices.map((choice, index) => {
                  const kind = burstKindFor(choice)
                  return (
                    <button
                      key={choice.id}
                      className="choice"
                      data-choice={choice.id}
                      data-kind={kind}
                      style={{ ['--i' as string]: String(index) }}
                      onClick={(event) => onChoose(choice.id, event)}
                    >
                      <span className="choice-index">{index + 1}</span>
                      <span className="choice-text">
                        <strong>{choice.label}</strong>
                        {choice.hint && <em>{choice.hint}</em>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
`,
  `          {!hasOutcome && scene.choices && scene.choices.length > 0 && (
            <>{renderChoices()}</>
          )}
`,
)

// 替换 continue 块：只有不分段时才在正文后渲染；分段时由 footer 渲染
sub(
  `          {hasOutcome && (
            <button
              className="primary-button continue"
              onClick={(event) => {
                fireBurst('continue', event.clientX, event.clientY)
                onAdvance()
              }}
            >
              {state.ending ? '把东西交出去' : '继续'}
            </button>
          )}
`,
  `          {hasOutcome && (state.pendingOutcome?.paragraphs.length ?? 0) <= 6 && renderContinue()}
`,
)

await writeFile(file, s, 'utf8')
console.log('misses:', miss.length ? miss : 'none')
