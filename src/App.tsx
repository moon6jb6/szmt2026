import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { InkCurtain, type CurtainHandle, type CurtainOpts } from './game/components/InkCurtain'
import { Stage } from './game/components/Stage'
import { ChoiceBurst, type BurstHandle, type BurstKind } from './game/components/ChoiceBurst'
import { EndingFinale, FINALE_LABEL } from './game/components/EndingFinale'
import { getScene } from './game/content/registry'
import { SCENE_IMAGES } from './game/content/sceneImages'
import { VOLUME4 } from './game/content/volume4'
import { VOLUME5 } from './game/content/volume5'
import { COMPOSITE_ORDER, COMPOSITE_REQUIRES, ENDINGS, ENDING_ORDER } from './game/content/endings'
import { getScene3D } from './game/content/scene3d'
import {
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
} from './game/audio'
import { CarryTray } from './game/components/CarryTray'
import { SpotlightFind } from './game/components/SpotlightFind'
import { FlagRaise } from './game/components/FlagRaise'
import SceneHotspots, { SCENE_HOTSPOTS } from './game/components/SceneHotspots'
import { SceneBeats } from './game/components/SceneBeats'

/** 真 3D 切片按需加载：不进主包，只有点「3D 视角」才拉取 */
const Scene3D = lazy(() => import('./game/components/Scene3D'))

/**
 * lazy chunk 拉取失败（断网/CDN 抖动）时，React 会把错误抛到根导致整树卸载。
 * 这里兜住：回退 2.5D，正文继续可读；用户下次再点 3D 会重新尝试。
 */
class Scene3DBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
import {
  NEEDED_SOURCES,
  PENDING_SOURCES,
  SOURCE_MAP,
  SOURCES,
  VERIFIED_SOURCES,
  groupByWork,
  statusLabel,
} from './game/content/sources'
import { sourceCoverage, validateSources } from './game/content/validate'
import {
  advance,
  choose,
  clearSave,
  createState,
  formatDuration,
  load,
  save,
} from './game/engine'
import type { Choice, EndingKind, GameState, MemoryKind, Scene, SceneId } from './game/types'

type Screen = 'menu' | 'game' | 'ending' | 'gallery' | 'about' | 'sources' | 'people' | 'later'

/** 插画地址：sceneImages.ts 里是 "art/scene-001.jpg"，场景数据里可能只写 "scene-001"
 *  用 import.meta.env.BASE_URL 拼前缀，配合 vite base:'./' 可在任意子目录部署 */
const artSrc = (id?: string): string => {
  if (!id) return ''
  const base = import.meta.env.BASE_URL ?? './'
  if (id.startsWith('art/') || id.startsWith('./art/')) return `${base}${id.replace(/^\.\//u, '')}`
  if (id.startsWith('/')) return `${base}${id.replace(/^\//u, '')}`
  return `${base}art/${id}.jpg`
}

/** WebGL 能力只探测一次：避免每次 render 都建 canvas/丢 context */
let webglSupport: boolean | null = null
function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) {
      webglSupport = false
      return false
    }
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()
    webglSupport = true
    return true
  } catch {
    webglSupport = false
    return false
  }
}

/** 当前设备/设置下能不能显示「3D 视角」入口（失败就继续 2.5D，不报错） */
function canUse3D(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (window.innerWidth < 700) return false
  return hasWebGL()
}

/** 结局页插画：每个结局取 manifest 里该结局的第 1 张（ending-0xx，见 docs/art/image-manifest.json） */
const ENDING_IMAGE: Record<string, string> = {
  roster: 'ending-001',
  letters: 'ending-002',
  flag: 'ending-003',
  photo: 'ending-004',
  testimony: 'ending-005',
  message: 'ending-006',
  // 合成结局复用最接近的两张（各自已过质检）
  archive: 'ending-001',
  relics: 'ending-002',
  wordofmouth: 'ending-003',
}

/** 合成结局的解锁条件说明（图鉴用） */
const COMPOSITE_HINT: Record<string, string> = {
  archive: '带走名册与口述，两样一起交',
  relics: '带走家书与照片，两样一起交',
  wordofmouth: '带走旗样与那句口信，两样一起交',
}

const CURTAIN_OPEN: CurtainOpts = { coverMs: 700, holdMs: 200, revealMs: 700 }
const CURTAIN_CHAPTER: CurtainOpts = { coverMs: 1200, holdMs: 320, revealMs: 1300 }
const CURTAIN_ENDING: CurtainOpts = { coverMs: 1500, holdMs: 600, revealMs: 1600 }

const UNLOCK_KEY = 'names-endings-v1'

/** 结局后的「后记 · 史实」：把精神与红色属性落在可核查的事实上 */
const AFTERWORD: { text: string; sourceIds: string[] }[] = [
  {
    text: '1941 年 4 月 24 日晨，谢晋元在孤军营被汪伪收买的叛兵刺杀，年 37 岁。',
    sourceIds: ['auto-a-10'],
  },
  {
    text: '2015 年，四行仓库抗战纪念馆开馆，英名墙刻下 323 个名字；到 2025 年，是 354 个。',
    sourceIds: ['auto-c-02'],
  },
  {
    text: '1938 年 10 月，毛泽东在《论新阶段》中说：八百壮士是「英勇抗战，为国捐躯的民族革命典型」。',
    sourceIds: ['auto-d-01'],
  },
  {
    text: '抗战精神：天下兴亡、匹夫有责的爱国情怀；视死如归、宁死不屈的民族气节；不畏强暴、血战到底的英雄气概；百折不挠、坚忍不拔的必胜信念。',
    sourceIds: ['auto-f-01'],
  },
]

function loadUnlocked(): EndingKind[] {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as EndingKind[]) : []
  } catch {
    return []
  }
}

function saveUnlocked(list: EndingKind[]) {
  try {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(list))
  } catch {
    /* noop */
  }
}

function hasSave(): boolean {
  return load() !== null && load()?.sceneId !== undefined
}

const MEMORY_NAMES: Record<MemoryKind, string> = {
  roster: '名册页',
  letters: '家书',
  flag: '旗的图样',
  photo: '照片',
  testimony: '口述',
  message: '口信',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [state, setState] = useState<GameState>(() => load() ?? createState())
  const [unlocked, setUnlocked] = useState<EndingKind[]>(() => loadUnlocked())
  const [sourcePanel, setSourcePanel] = useState<string | null>(null)
  const [resumeAvailable, setResumeAvailable] = useState(false)
  const [personId, setPersonId] = useState<string | null>(null)
  const [laterId, setLaterId] = useState<string | null>(null)
  const [finaleDone, setFinaleDone] = useState(true)
  const [finaleKey, setFinaleKey] = useState(0)
  const [view3dScene, setView3dScene] = useState<string | null>(null)
  // 默认静音（评审环境不突然出声）；用户点右下角「声音」才开启
  const [audioOn, setAudioOn] = useState(() => !isMuted())
  const curtain = useRef<CurtainHandle>(null)
  const burst = useRef<BurstHandle>(null)

  const toggleAudio = () => {
    const next = !audioOn
    setAudioOn(next)
    setMuted(!next)
    if (next) void unlockAudio()
  }

  // 换场景天然回落 2.5D：view3dScene 只对当时那个场景有效，不做晚一拍的 effect 复位
  const sceneId = state.sceneId
  const scene3dSpec = useMemo(() => (screen === 'game' ? getScene3D(sceneId) : null), [screen, sceneId])
  const show3d = view3dScene === sceneId && Boolean(scene3dSpec)

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
    setExploreVariant(null)
  }, [screen, sceneId, personId, laterId])
  useEffect(() => {
    if (state.pendingOutcome) scrollCurrentToTop(true)
  }, [state.pendingOutcome])

  // 两个「签名时刻」：第一夜灯下找名字、第三夜升旗。每局一次，Esc 可跳过。
  const [signatureDone, setSignatureDone] = useState<('spot' | 'flag')[]>([])
  const [signature, setSignature] = useState<'spot' | 'flag' | null>(null)
  // 「场景探索」：背景图 + 热点；与真 3D 视角是两个独立入口
  const [exploreVariant, setExploreVariant] = useState<keyof typeof SCENE_HOTSPOTS | null>(null)
  /** 长段落分段阅读时的情绪（场景/回忆/人物剪影），用来微调背景 */
  const [beatMood, setBeatMood] = useState<'scene' | 'memory' | 'figure-male' | 'figure-female'>('scene')
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

  /** 点击效果的种类：结局 > 记忆载体 > 场景天气兜底，保证每次点击的动效都不同 */
  const burstKindFor = (choice?: Choice): BurstKind => {
    if (!choice) return 'quiet'
    if (choice.ending) return choice.ending
    const gain = choice.outcome.gain ?? {}
    const keys = Object.keys(gain).filter((key) => (gain[key as MemoryKind] ?? 0) > 0)
    if (keys.length > 1) return 'archive'
    return (keys[0] as BurstKind | undefined) ?? 'quiet'
  }

  const fireBurst = (kind: BurstKind, x?: number, y?: number) => {
    const seedBase = `${state.sceneId}:${kind}`
    let seed = 0
    for (let i = 0; i < seedBase.length; i += 1) seed = (seed * 31 + seedBase.charCodeAt(i)) >>> 0
    burst.current?.fire(
      x ?? window.innerWidth / 2,
      y ?? window.innerHeight * 0.62,
      kind,
      seed,
    )
  }

  /** 结局页第一次出现时播放"终极画面" */
  const beginFinale = () => {
    setFinaleDone(false)
    setFinaleKey((value) => value + 1)
  }

  /** 所有换场都过墨迹幕：换场动作在全黑那一帧执行，遮住图片解码与重排抖动 */
  const runCurtain = (swap: () => void, opts?: CurtainOpts) => {
    if (curtain.current) {
      void curtain.current.play(swap, opts)
    } else {
      swap()
    }
  }

  useEffect(() => {
    setResumeAvailable(hasSave())
  }, [])

  // 开发环境自检：史料卡数据填错会直接报在控制台
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const errors = validateSources()
    if (errors.length > 0) {
      console.warn('[史料卡校验] 发现', errors.length, '个问题', errors)
    } else {
      const coverage = sourceCoverage()
      console.info(
        `[史料卡校验] 通过：${coverage.total} 条（已核对 ${coverage.verified} / 待接入 ${coverage.needed}），覆盖 ${coverage.scenes} 个场景`,
      )
    }
  }, [])

  // 换场景后把焦点交给标题：键盘用户不必从 body 重新 Tab；读屏靠上面的 aria-live 播报
  useEffect(() => {
    if (screen !== 'game') return
    const timer = window.setTimeout(() => {
      const title = document.querySelector<HTMLElement>('.scene-title')
      title?.focus({ preventScroll: true })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [screen, sceneId, state.pendingOutcome])

  // Esc 关闭史料卡浮层（无障碍 P2：弹层不能只靠点关闭）
  useEffect(() => {
    if (!sourcePanel) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSourcePanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sourcePanel])

  // 窗口缩到 700px 以下时自动退出 3D（避免手机宽度还挂着 WebGL）
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 700) setView3dScene(null)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const scene: Scene | null = useMemo(() => {
    if (screen !== 'game') return null
    return getScene(state.sceneId, state.ledger)
  }, [screen, state.sceneId, state.ledger])

  // 声音跟随场景/页面：场景按天气与地点选环境声，结局加 drone，其余页面安静或留底噪
  useEffect(() => {
    if (!audioOn) {
      setAmbience(null)
      setDrone(null)
      return
    }
    if (screen === 'game' && scene) {
      setAmbience(ambienceForScene(scene.weather, scene.chapter, scene.location))
      setDrone(null)
    } else if (screen === 'ending' && state.ending) {
      setAmbience(null)
      setDrone(droneForEnding(state.ending))
    } else {
      setAmbience(ambienceForScreen(screen))
      setDrone(null)
    }
  }, [audioOn, screen, sceneId, scene?.weather, scene?.chapter, scene?.location, state.ending])

  const startNew = () => {
    if (audioOn) void unlockAudio()
    const fresh = createState()
    runCurtain(
      () => {
        setState(fresh)
        save(fresh)
        setScreen('game')
        setSourcePanel(null)
      },
      CURTAIN_OPEN,
    )
  }

  const resume = () => {
    if (audioOn) void unlockAudio()
    const saved = load()
    if (saved) {
      setState(saved)
      setFinaleDone(true) // 续玩直接看正文，不重播结局画面
      setScreen(saved.finishedAt ? 'ending' : 'game')
    } else {
      startNew()
    }
  }

  const onChoose = (choiceId: string, event?: { clientX?: number; clientY?: number }) => {
    if (!scene?.choices) return
    const choice = scene.choices.find((item) => item.id === choiceId)
    if (!choice) return
    const burstKind = burstKindFor(choice)
    fireBurst(burstKind, event?.clientX, event?.clientY)
    if (audioOn) {
      if (!isAudioUnlocked()) void unlockAudio()
      playSfx(clickSoundFor(burstKind))
    }
    const next = choose(state, choice.id, choice.outcome, choice.next, choice.ending ?? null)
    setState(next)
    save(next)
  }

  const onAdvance = () => {
    if (!state.pendingNext) return
    if (audioOn) playSfx('page-turn')
    advanceScene()
  }

  const advanceScene = () => {
    const nextId = state.pendingNext
    if (!nextId) return
    const finishing = state.ending !== null
    runCurtain(
      () => {
        const next = advance(state, nextId, finishing)
        setState(next)
        save(next)
        if (finishing && state.ending) {
          const merged = Array.from(new Set<EndingKind>([...unlocked, state.ending]))
          setUnlocked(merged)
          saveUnlocked(merged)
          setScreen('ending')
          beginFinale()
        }
      },
      finishing ? CURTAIN_ENDING : undefined,
    )
  }

  // 键盘操作：1-9 选择，Enter/空格 继续。
  // 监听器只挂一次，用 ref 读最新状态，避免每次 render 重挂。
  const keyState = useRef({ screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature, exploreVariant })
  keyState.current = { screen, scene, pending: state.pendingOutcome, onAdvance, onChoose, signature, exploreVariant }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { screen, scene, pending, onAdvance, onChoose, signature, exploreVariant } = keyState.current
      if (signature || exploreVariant) return
      if (screen !== 'game' || !scene) return
      // 分段阅读组件还在推进中时，键盘归它
      if (document.querySelector('.beats[data-done="false"]')) return
      if (pending) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onAdvance()
        }
        return
      }
      // 尾声的 1—9 / Enter 交给 CarryTray（需要选中 + 确认/按手印），这里让路
      if (scene.id === 'epilogue') return
      const index = Number.parseInt(event.key, 10)
      if (!Number.isNaN(index) && index >= 1 && index <= (scene.choices?.length ?? 0)) {
        event.preventDefault()
        onChoose(scene.choices![index - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const restart = () => {
    clearSave()
    startNew()
  }

  const toMenu = () => {
    // 回菜单时重算：避免「玩到结局后回开头」看不到「继续上次」
    setResumeAvailable(hasSave())
    setScreen('menu')
    setSourcePanel(null)
  }

  const renderParagraphs = (paragraphs: string[], className = 'prose') => (
    <div className={className}>
      {paragraphs.map((text, index) => (
        <p key={index} style={{ animationDelay: `${Math.min(index * 90, 540)}ms` }}>
          {text}
        </p>
      ))}
    </div>
  )

  const renderSourcePanel = () => {
    if (!sourcePanel) return null
    const card = SOURCE_MAP.get(sourcePanel)
    if (!card) return null
    const meta = [card.author, card.publisher, card.year ? `${card.year} 年` : '']
      .filter(Boolean)
      .join(' · ')
    return (
      <aside className="source-panel" role="dialog" aria-modal="false" aria-label="史料卡">
        <div className="source-panel-head">
          <span className="eyebrow">史料卡</span>
          <button className="text-button" autoFocus onClick={() => setSourcePanel(null)}>
            关闭
          </button>
        </div>
        <h3>{card.work}</h3>
        <p className="source-claim">{card.claim}</p>
        {card.excerpt ? (
          <blockquote className="source-quote">
            <p>「{card.excerpt}」</p>
            {card.locator && <cite>{card.locator}</cite>}
          </blockquote>
        ) : (
          <p className="source-warn">这一条还在等文献：{card.locator ?? '原文与页码待补'}。</p>
        )}
        {meta && <p className="source-origin">{meta}</p>}
        {card.note && <p className="source-note">{card.note}</p>}
        <span className={`badge ${card.status === 'verified' ? 'ok' : 'pending'}`}>
          {statusLabel(card)}
        </span>
      </aside>
    )
  }

  /** 场景页脚上的小标签：用 claim 的前半句，比书名更好认 */
  const chipLabel = (claim: string) => (claim.length > 18 ? `${claim.slice(0, 18)}…` : claim)

  /** 某个场景/结局页可用的史料卡：显式引用的 + 自动回填里登记到该场景的 */
  const cardsFor = (target: string, extraIds: string[] = []) => {
    const map = new Map<string, (typeof SOURCES)[number]>()
    for (const id of extraIds) {
      const card = SOURCE_MAP.get(id)
      if (card) map.set(card.id, card)
    }
    for (const card of SOURCES) {
      if ((card.scenes as string[]).includes(target)) map.set(card.id, card)
    }
    return [...map.values()]
  }

  /** 最多展示 limit 张，其余收进「另有 N 条」 */
  const renderChips = (cards: (typeof SOURCES)[number][], limit = 4) => (
    <>
      {cards.slice(0, limit).map((card) => (
        <button key={card.id} className="chip" onClick={() => setSourcePanel(card.id)}>
          {chipLabel(card.claim)}
        </button>
      ))}
      {cards.length > limit && (
        <button className="chip chip-more" onClick={() => setScreen('sources')}>
          另有 {cards.length - limit} 条史料
        </button>
      )}
    </>
  )

  const renderChoices = () => {
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
      <div key={scene.id} className={`scene ${show3d ? 'scene-in-3d' : ''}`} data-scene={scene.id} data-beat-mood={beatMood}>
        <p className="sr-only" aria-live="polite">
          {`${scene.chapter} · ${scene.title}`}
        </p>
        <header className="scene-head">
          <span className="chapter">{scene.chapter}</span>
          <h1 className="scene-title" tabIndex={-1}>
            {scene.title}
          </h1>
          {(scene.date || scene.location) && (
            <p className="scene-meta">
              {scene.date}
              {scene.date && scene.location ? ' · ' : ''}
              {scene.location}
            </p>
          )}
          {scene3dSpec && (
            <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`view3d-toggle ${exploreVariant ? 'on' : ''}`}
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
                  className={`view3d-toggle ${show3d ? 'on' : ''}`}
                  aria-pressed={show3d}
                  onClick={() => setView3dScene((current) => (current === sceneId ? null : sceneId))}
                >
                  {show3d ? '回到 2.5D' : '3D 视角'}
                </button>
              )}
            </div>
          )}
        </header>

        {show3d && (
          <p className="scene-3d-hint">这是真 3D 场景：移动鼠标或拖动画面可以换视角。点击右上角回到 2.5D。</p>
        )}

        {!show3d &&
          (() => {
            const imageId = scene.image ?? SCENE_IMAGES[scene.id]
            if (!imageId) return null
            return (
              <figure className="scene-image">
                <img src={artSrc(imageId)} alt={scene.imageCaption ?? scene.title} loading="lazy" />
                {scene.imageCaption && <figcaption>{scene.imageCaption}</figcaption>}
              </figure>
            )
          })()}

        <div className="scene-body">
          {renderBody()}

          {hasOutcome && state.pendingOutcome?.quote && (
            <blockquote className="quote-card">
              <p>{state.pendingOutcome.quote.text}</p>
              <cite>{state.pendingOutcome.quote.attribution}</cite>
            </blockquote>
          )}

          {!hasOutcome && scene.choices && scene.choices.length > 0 && renderChoices()}

          {hasOutcome && (state.pendingOutcome?.paragraphs.length ?? 0) <= 6 && renderContinue()}
        </div>

        {scene.aside && <p className="scene-aside">{scene.aside}</p>}

        {(() => {
          const cards = cardsFor(scene.id, scene.sources ?? [])
          if (cards.length === 0) return null
          return (
            <footer className="source-row">
              <span className="eyebrow">史料卡 · {cards.length}</span>
              {renderChips(cards)}
            </footer>
          )
        })()}
      </div>
    )
  }

  const renderEnding = () => {
    if (!state.ending) return null
    const ending = ENDINGS[state.ending]
    return (
      <div className="ending">
        <span className="eyebrow">结局</span>
        <h1>{ending.title}</h1>
        <p className="ending-sub">{ending.subtitle}</p>
        {ENDING_IMAGE[state.ending] && (
          <figure className="scene-image">
            <img src={artSrc(ENDING_IMAGE[state.ending])} alt={ending.title} loading="lazy" />
          </figure>
        )}
        {renderParagraphs(ending.paragraphs, 'prose prose-ending')}
        <p className="ending-coda">{ending.coda}</p>

        {(() => {
          const carried = (Object.keys(state.ledger) as MemoryKind[]).filter((kind) => state.ledger[kind] > 0)
          const compositeLine: Record<string, string> = {
            archive: '这一次交出去的不是一样东西。名字和话放在同一个匣子里，纸和口述互相作了证。',
            relics: '这一次交出去的是字和人。抄件还在，单子还在，圈里的两个名字还是没有。',
            wordofmouth: '这一次交出去的，一个给眼睛，一个给耳朵。图样收进了匣子，话留在了人嘴里。',
          }
          const line = compositeLine[ending.kind]
            ? compositeLine[ending.kind]
            : carried.length >= 4
              ? '你带出去的不止一样，最后只交出去一样。剩下的几样，各自留在了别处。'
              : carried.length === 1
                ? '你只带走了一样。剩下的，留在那间厢房里。'
                : '你带走了几样，最后只交出去一样。'
          return (
            <div className="ending-echo">
              <span className="eyebrow">余波</span>
              <p>{line}</p>
            </div>
          )
        })()}

        <section className="afterword">
          <span className="eyebrow">后记 · 史实</span>
          <ul>
            {AFTERWORD.map((item) => (
              <li key={item.text}>
                <span className="afterword-text">{item.text}</span>
                {renderChips(cardsFor('afterword', item.sourceIds), 1)}
              </li>
            ))}
          </ul>
        </section>

        <div className="ledger">
          <span className="eyebrow">你带出来的</span>
          <ul>
            {(Object.keys(state.ledger) as MemoryKind[])
              .filter((kind) => state.ledger[kind] > 0)
              .map((kind) => (
                <li key={kind}>
                  {MEMORY_NAMES[kind]} × {state.ledger[kind]}
                </li>
              ))}
          </ul>
        </div>

        {(VOLUME4.length > 0 || VOLUME5.length > 0) && (
          <section className="afterword">
            <span className="eyebrow">后来</span>
            <p className="afterword-text">结局之后，这些名字又走了七十年。可以接着读：</p>
            <div className="ending-actions">
              {VOLUME4.length > 0 && (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setLaterId(null)
                    setScreen('later')
                  }}
                >
                  读「后来」（15 篇）
                </button>
              )}
              {VOLUME5.length > 0 && (
                <button
                  className="quiet-button"
                  onClick={() => {
                    setPersonId(null)
                    setScreen('people')
                  }}
                >
                  读「人物志」（10 篇）
                </button>
              )}
            </div>
          </section>
        )}

        <div className="ending-actions">
          <button className="primary-button" onClick={restart}>
            再走一遍
          </button>
          <button
            className="quiet-button"
            onClick={() => {
              setFinaleDone(false)
              setFinaleKey((value) => value + 1)
            }}
          >
            重看结局画面 · {FINALE_LABEL[ending.kind]}
          </button>
          <button className="quiet-button" onClick={() => setScreen('gallery')}>
            看看所有结局
          </button>
          <button className="quiet-button" onClick={toMenu}>
            回到开头
          </button>
        </div>
        {(() => {
          const cards = cardsFor(`ending_${ending.kind}`, ending.sourceIds)
          if (cards.length === 0) return null
          return (
            <footer className="source-row">
              <span className="eyebrow">史料出处 · {cards.length}</span>
              {renderChips(cards)}
            </footer>
          )
        })()}
        <p className="playtime">本次用时 {formatDuration((state.finishedAt ?? Date.now()) - state.startedAt)}</p>
      </div>
    )
  }

  const renderMenu = () => (
    <div className="menu">
      <span className="eyebrow">红色之旅 · 追梦铸魂</span>
      <h1 className="title">把名字留下来</h1>
      <p className="subtitle">四行仓库 · 一九三七</p>
      <p className="menu-lead">
        四行仓库里守了四天四夜的，是四百多个中国兵，其中两百多人来自湖北通城。
        他们的名字，后来只找回来八十七个。你是其中识字的那个，负责把名字记下来。
      </p>
      <ul className="menu-facts">
        <li>从通城到上海，从四行仓库到孤军营，再到七十年后的寻访——一百四十个场景</li>
        <li>九个结局，没有好坏，只有「什么被留下」</li>
        <li>正文约 11.3 万字；单周目约 2—3 小时，读完全部内容约 6 小时</li>
        <li>七十六张史料卡（已核对六十三张），每个史实都能点开看出处</li>
      </ul>
      <div className="menu-actions">
        {resumeAvailable && (
          <button className="primary-button" onClick={resume}>
            继续上次
          </button>
        )}
        <button className={resumeAvailable ? 'quiet-button' : 'primary-button'} onClick={startNew}>
          从头开始
        </button>
        <button className="quiet-button" onClick={() => setScreen('gallery')}>
          结局一览
        </button>
        <button className="quiet-button" onClick={() => setScreen('sources')}>
          史料库
        </button>
        {VOLUME5.length > 0 && (
          <button
            className="quiet-button"
            onClick={() => {
              setPersonId(null)
              setScreen('people')
            }}
          >
            人物志
          </button>
        )}
        {VOLUME4.length > 0 && (
          <button
            className="quiet-button"
            onClick={() => {
              setLaterId(null)
              setScreen('later')
            }}
          >
            后来
          </button>
        )}
        <button className="quiet-button" onClick={() => setScreen('about')}>
          关于与史料
        </button>
      </div>
      <p className="content-note">
        内容提示：本作涉及战争与死亡，不表现血腥场面。人物陈望生为复合型虚构角色，史实依据见文内「史料卡」。
      </p>
    </div>
  )

  const renderGallery = () => (
    <div className="gallery">
      <span className="eyebrow">九个结局</span>
      <h1>哪一种记忆被留下</h1>
      <p className="gallery-lead">
        已解锁 {unlocked.length} / 9。六个主结局对应六种记忆载体；三个合成结局只在你同时带走两样东西时出现。
        每个结局都写着同一句话。
      </p>
      <div className="gallery-grid">
        {ENDING_ORDER.map((kind) => {
          const ending = ENDINGS[kind]
          const open = unlocked.includes(kind)
          return (
            <article key={kind} className={`gallery-card ${open ? 'open' : 'locked'}`}>
              <h2>{open ? ending.title : '？？'}</h2>
              <p className="gallery-sub">{open ? ending.subtitle : '尚未走到'}</p>
              {open && <p className="gallery-coda">{ending.coda}</p>}
            </article>
          )
        })}
        {COMPOSITE_ORDER.map((kind) => {
          const ending = ENDINGS[kind]
          const open = unlocked.includes(kind)
          return (
            <article key={kind} className={`gallery-card composite ${open ? 'open' : 'locked'}`}>
              <h2>{open ? ending.title : '？？'}</h2>
              <p className="gallery-sub">{open ? ending.subtitle : COMPOSITE_HINT[kind]}</p>
              {open && <p className="gallery-coda">{ending.coda}</p>}
            </article>
          )
        })}
      </div>
      <button className="quiet-button" onClick={toMenu}>
        返回
      </button>
    </div>
  )

  const renderAbout = () => (
    <div className="about">
      <span className="eyebrow">关于</span>
      <h1>这不是一个打仗的游戏</h1>
      <p>
        它讲的是记录：一个识字的兵，在四行仓库的五天里，每一次只能把一样东西带过苏州河。
        名册、家书、旗、照片、口述、口信——你带出去什么，什么就活下来。
      </p>
      <h2>史实</h2>
      <p>
        「八百壮士」实际约四百余人；湖北通城籍二百人以上。1947 年通城县参议会编《通城县抗战史料》，
        留下《通城县参加上海四行孤军四十九壮士姓名一览表》。此后数十年寻访，查实姓名者仅八十七人。
      </p>
      <h2>虚构与边界</h2>
      <p>
        主角陈望生为复合型虚构角色。谢晋元等真实人物只以可查证的事实出现，不虚构其台词。
        场景中的天气、对话细节为叙事重构；可核对的史实均标注来源。
      </p>
      <h2>技术</h2>
      <p>
        React 19 + TypeScript + Vite。2.5D 视差由同一张图的多尺度分层与指针位移实现；粒子为 Canvas 绘制。
        无后端，存档在本地浏览器。
      </p>
      <button className="quiet-button" onClick={toMenu}>
        返回
      </button>
    </div>
  )

  const renderSourceGroup = (
    list: typeof SOURCES,
    heading: string,
    lead: string,
  ) => (
    <section className="source-group">
      <h2>{heading}</h2>
      <p className="gallery-lead">{lead}</p>
      {[...groupByWork(list)].map(([work, cards]) => {
        const first = cards[0]
        const meta = [first.author, first.publisher, first.year ? `${first.year} 年` : '']
          .filter(Boolean)
          .join(' · ')
        return (
          <div key={work} className="work-group">
            <h3>{work}</h3>
            {meta && <p className="work-meta">{meta}</p>}
            {cards.map((card) => (
              <article key={card.id} className="source-entry">
                <p className="source-claim">{card.claim}</p>
                {card.excerpt ? (
                  <blockquote className="source-quote">
                    <p>「{card.excerpt}」</p>
                    {card.locator && <cite>{card.locator}</cite>}
                  </blockquote>
                ) : (
                  <p className="source-warn">
                    待补：{card.locator ?? '原文与页码'}
                    {card.note ? ` —— ${card.note}` : ''}
                  </p>
                )}
                <div className="source-entry-foot">
                  <span className={`badge ${card.status === 'verified' ? 'ok' : 'pending'}`}>
                    {statusLabel(card)}
                  </span>
                  {card.scenes.length > 0 && (
                    <span className="source-scenes">用于 {card.scenes.length} 个场景</span>
                  )}
                  {card.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="source-tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )
      })}
    </section>
  )

  const renderSources = () => (
    <div className="sources-page">
      <span className="eyebrow">史料库</span>
      <h1>每一条都写了出处</h1>
      <p className="gallery-lead">
        游戏正文只使用「已核对」的条目，每条都能点开看到原句与页码。
        还在等文献的条目单独列出，不进入正文。新增文献只需改 <code>sources.ts</code> 一个文件。
      </p>
      <p className="source-coverage">
        当前 {SOURCES.length} 条 · 已核对 {VERIFIED_SOURCES.length} · 待核对 {PENDING_SOURCES.length} · 待接入{' '}
        {NEEDED_SOURCES.length}
      </p>
      {renderSourceGroup(
        VERIFIED_SOURCES,
        `已核对 ${VERIFIED_SOURCES.length} 条`,
        '这些条目已经可以直接引用，正文中的「史料卡」就是它们。',
      )}
      {PENDING_SOURCES.length > 0 &&
        renderSourceGroup(
          PENDING_SOURCES,
          `待核对 ${PENDING_SOURCES.length} 条`,
          '有出处，但存在多种说法或原文未完全核对，因此不进入正文，只作研究记录。',
        )}
      {renderSourceGroup(
        NEEDED_SOURCES,
        `待接入文献 ${NEEDED_SOURCES.length} 条`,
        '每一条都写清了「需要哪本书、哪一章、补什么」。拿到文献后填原句与页码即可转为「已核对」。',
      )}
      <h2>这是什么意思</h2>
      <p className="gallery-lead">
        换一本书、补一页页码，只需要在 <code>src/game/content/sources.ts</code> 里改一条数据：
        填上 excerpt 与 locator、把 status 改成 verified，再把卡片 id 加进目标场景的 sources。
        界面、分组、「用于几个场景」都会自动更新，不需要改任何组件代码。
      </p>
      <button className="quiet-button" onClick={toMenu}>
        返回
      </button>
    </div>
  )

  const renderPeople = () => (
    <div className="people">
      <span className="eyebrow">人物志</span>
      <h1>十个人，和一册没有名字的名单</h1>
      <p className="gallery-lead">
        人物志独立于主线存档，随时可读。真实人物只写可查证的事实；群像为叙事重构，已在文末标注。
      </p>
      <div className="people-list">
        {VOLUME5.map((scene) => (
          <button key={scene.id} className="people-card" onClick={() => setPersonId(scene.id)}>
            <span className="people-meta">
              {scene.date}
              {scene.location ? ` · ${scene.location}` : ''}
            </span>
            <strong>{scene.title}</strong>
            <span className="people-preview">{scene.paragraphs[0]?.slice(0, 64) ?? ''}…</span>
          </button>
        ))}
      </div>
      <button className="quiet-button" onClick={toMenu}>
        返回
      </button>
    </div>
  )

  const renderPerson = () => {
    const scene = VOLUME5.find((item) => item.id === personId)
    if (!scene) return null
    const cards = cardsFor(scene.id, scene.sources ?? [])
    return (
      <div className="person-reader">
        <header className="scene-head">
          <span className="chapter">{scene.chapter}</span>
          <h1>{scene.title}</h1>
          {(scene.date || scene.location) && (
            <p className="scene-meta">
              {scene.date}
              {scene.date && scene.location ? ' · ' : ''}
              {scene.location}
            </p>
          )}
        </header>
        {(() => {
          const imageId = scene.image ?? SCENE_IMAGES[scene.id]
          if (!imageId) return null
          return (
            <figure className="scene-image">
              <img src={artSrc(imageId)} alt={scene.title} loading="lazy" />
            </figure>
          )
        })()}
        {renderParagraphs(scene.paragraphs)}
        {scene.aside && <p className="scene-aside">{scene.aside}</p>}
        {cards.length > 0 && (
          <footer className="source-row">
            <span className="eyebrow">史料卡 · {cards.length}</span>
            {renderChips(cards)}
          </footer>
        )}
        <button className="quiet-button" onClick={() => setPersonId(null)}>
          返回人物志
        </button>
      </div>
    )
  }

  const renderLater = () => (
    <div className="people">
      <span className="eyebrow">后来</span>
      <h1>名字之后的事</h1>
      <p className="gallery-lead">
        1947 年造册之后，这些名字又走了七十年。这一组是结局之后的读者页，独立于主线存档。
      </p>
      <div className="people-list">
        {VOLUME4.map((scene, index) => (
          <button key={scene.id} className="people-card" onClick={() => setLaterId(scene.id)}>
            <span className="people-meta">
              {String(index + 1).padStart(2, '0')} · {scene.date}
              {scene.location ? ` · ${scene.location}` : ''}
            </span>
            <strong>{scene.title}</strong>
            <span className="people-preview">{scene.paragraphs[0]?.slice(0, 64) ?? ''}…</span>
          </button>
        ))}
      </div>
      <button className="quiet-button" onClick={toMenu}>
        返回
      </button>
    </div>
  )

  const renderLaterScene = () => {
    const scene = VOLUME4.find((item) => item.id === laterId)
    if (!scene) return null
    const cards = cardsFor(scene.id, scene.sources ?? [])
    const imageId = scene.image ?? SCENE_IMAGES[scene.id]
    return (
      <div className="person-reader">
        <header className="scene-head">
          <span className="chapter">{scene.chapter}</span>
          <h1>{scene.title}</h1>
          {(scene.date || scene.location) && (
            <p className="scene-meta">
              {scene.date}
              {scene.date && scene.location ? ' · ' : ''}
              {scene.location}
            </p>
          )}
        </header>
        {imageId && (
          <figure className="scene-image">
            <img src={artSrc(imageId)} alt={scene.title} loading="lazy" />
          </figure>
        )}
        {renderParagraphs(scene.paragraphs)}
        {scene.aside && <p className="scene-aside">{scene.aside}</p>}
        {cards.length > 0 && (
          <footer className="source-row">
            <span className="eyebrow">史料卡 · {cards.length}</span>
            {renderChips(cards)}
          </footer>
        )}
        <button className="quiet-button" onClick={() => setLaterId(null)}>
          返回「后来」
        </button>
      </div>
    )
  }

  const weatherVariant = (): 'ink' | 'rain' | 'snow' | 'ash' | 'smoke' => {
    const weather = scene?.weather ?? 'none'
    if (weather === 'rain' || weather === 'snow' || weather === 'ash' || weather === 'smoke') return weather
    return 'ink'
  }

  return (
    <main className={`app-shell ${screen === 'game' ? 'in-game' : ''}`}>
      {screen === 'menu' && renderMenu()}
      {screen === 'game' && (
        <Stage
          background={scene?.background ?? 'warehouse'}
          weather={scene?.weather ?? 'none'}
          mode3d={show3d}
          scene3d={
            show3d && scene3dSpec ? (
              <Scene3DBoundary onError={() => setView3dScene(null)}>
                <Suspense fallback={null}>
                  <Scene3D variant={scene3dSpec.variant} />
                </Suspense>
              </Scene3DBoundary>
            ) : null
          }
        >
          {renderScene()}
        </Stage>
      )}
      {screen === 'ending' && (
        <Stage background="dawn" weather="snow">
          {renderEnding()}
        </Stage>
      )}
      {screen === 'gallery' && renderGallery()}
      {screen === 'about' && renderAbout()}
      {screen === 'sources' && renderSources()}
      {screen === 'people' && (personId ? renderPerson() : renderPeople())}
      {screen === 'later' && (laterId ? renderLaterScene() : renderLater())}
      <InkCurtain ref={curtain} variant={weatherVariant()} />
      <ChoiceBurst ref={burst} />
      {screen === 'ending' && state.ending && !finaleDone && (
        <EndingFinale key={finaleKey} kind={state.ending} onDone={() => setFinaleDone(true)} />
      )}
      {exploreVariant && (
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
      <button
        type="button"
        className={`audio-toggle ${audioOn ? 'on' : ''}`}
        aria-pressed={audioOn}
        aria-label={audioOn ? '关闭声音' : '打开声音'}
        onClick={toggleAudio}
      >
        {audioOn ? '声音 开' : '声音 关'}
      </button>
    </main>
  )
}
