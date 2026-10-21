import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { SilhouetteFigure } from './SilhouetteFigure'
import './beats.css'

/**
 * SceneBeats —— 长段落分三段阅读 + 卡片氛围随段落变化 + 人物剪影浮现
 *
 * 为什么要有它：140 个场景里有不少场景单页 8—20 段，一屏读不完，读者容易滑走。
 * 这里按「段落数」把正文切成最多 3 组，一组一屏读完再点「继续读」；
 * 某组正文里出现人时，卡片自己换气氛，并在正文右下方隐约浮出一个上半身剪影。
 *
 * 组件边界：
 * - 只负责「卡片这一层」。整页背景（Stage / 天气 / 3D）不归它管，也不该归它管；
 *   它通过 onBeatChange 把 { index, total, mood, hasPerson } 交给 App，
 *   App 再决定 Stage 的 background / 天气。见 docs/report/2026-10-22-scene-beats.md。
 * - 不依赖 App.tsx / styles.css / audio.ts：音效走 onSound 回调，选项区走 footer 渲染函数。
 *
 * ============================ 分组规则（可读版） ============================
 *  n = 段落数（先把「单段 > 220 字」的段落按句号切开，再数 n）
 *
 *  n ≤ 6    → 1 组，不分。保持现在的阅读节奏，不额外增加点击。
 *  n ≥ 7    → 3 组，按段数均分，余数给前几组：
 *             7  → 3 / 2 / 2
 *             8  → 3 / 3 / 2
 *             9  → 3 / 3 / 3
 *             12 → 4 / 4 / 4
 *             15 → 5 / 5 / 5
 *  顺序永远不变，不丢段、不合并段。组间切换默认不自动翻，必须读者点「继续读 ▸」
 *  （或按 Enter / 空格）。最后一组读完再点一次，footer（选项区）才出现。
 * ===========================================================================
 *
 * ======================== 情绪 / 人物关键词表（可改） ========================
 *  判定顺序：先看有没有人（有人就是 figure-*），再问是不是回忆，都不是就是 scene。
 *  每组独立判定，同一组只输出一种 mood。
 *
 *  ┌─ 人物 · 具体人名（正文里已出现过的虚构/真实人物）
 *  │   陈望生 李满仓 谢晋元 杨惠敏 陈树生 雷雄 韩宪元
 *  │   杨瑞符 张柏亭 杨虎 上官志标 王金贵 老赵
 *  ├─ 人物 · 身份词（出现即视为「这一段里有人在」）
 *  │   母亲 父亲 记者 护士 伤员 同乡 弟兄 士兵 班长 排长
 *  │   营长 团长 媳妇 老人 老太太 姑娘 孩子 船夫 军官 哨兵 战友 先生 女士
 *  ├─ 人物 · 代词 + 身体/名字（「他/她」单出现不算，得同段有落点）
 *  │   他 她 ＋ 脸 眼睛 眼 声音 背影 手 名字 肩 头 眉 嘴唇 眼神 额头 脖子
 *  │   （先把「其他 / 其它」剔掉，避免把「其他」当成代词）
 *  ├─ 回忆
 *  │   记得 那年 从前 后来 想起 十年前 小时候 早年 那时候 旧年 回忆
 *  └─ 性别（有人的组才判；判不出来一律 male）
 *      偏 female：她 母亲 护士 媳妇 姑娘 女人 女士 老太太 妇人 嫂子 杨惠敏
 *      偏 male：  他 士兵 兵 弟兄 班长 排长 营长 团长 军官 哨兵 战友 男人 父亲 先生
 *      计分：身份词 3 分/次，「她 / 他」1 分/次（封顶 3 分，避免一段里刷屏）。
 *      女分 > 男分 才判 female；平手判 male。
 * ===========================================================================
 */

export type Mood = 'scene' | 'memory' | 'figure-male' | 'figure-female'

export type BeatChangeInfo = {
  index: number
  total: number
  mood: Mood
  hasPerson: boolean
}

export type SceneBeatsProps = {
  paragraphs: string[]
  /** 选项区。只有读完最后一组（done=true）之后才会被渲染。 */
  footer?: (done: boolean) => ReactNode
  /** 每次换组（含首组）回调，App 用它把 mood 传给 Stage 换整页背景。 */
  onBeatChange?: (info: BeatChangeInfo) => void
  /** 音效钩子：paper=翻页（普通叙事）/ ink=墨沉下去（回忆或人物组）。 */
  onSound?: (cue: 'paper' | 'ink') => void
  /** 强制减少动效；不传则跟随 prefers-reduced-motion。 */
  reduceMotion?: boolean
  className?: string
}

/** 一组正文：分好的段落 + 这一组的判词 */
export type Beat = {
  key: string
  paragraphs: string[]
  mood: Mood
  hasPerson: boolean
  memory: boolean
}

/* ============================== 常量 ============================== */

/** 超过这个字数的单段，按句号再切（不切开会一屏塞不下） */
const SPLIT_CHARS = 220
/** 组数上限 */
const BEAT_COUNT = 3
/** 旧组墨色擦除时长 */
const LEAVE_MS = 220
/** 新组每段错峰间隔 / 上限 */
const STAGGER_MS = 60
const STAGGER_CAP_MS = 240
/** 连点锁：一次手势只走一组 */
const ADVANCE_LOCK_MS = 300
/** 剪影目标透明度（规范：0.10—0.16） */
const FIGURE_OPACITY: Record<'male' | 'female', number> = { male: 0.14, female: 0.12 }

/* ============================== 关键词表 ============================== */

const FIGURE_NAMES = [
  '陈望生',
  '李满仓',
  '谢晋元',
  '杨惠敏',
  '陈树生',
  '雷雄',
  '韩宪元',
  '杨瑞符',
  '张柏亭',
  '杨虎',
  '上官志标',
  '王金贵',
  '老赵',
] as const

const FIGURE_ROLES = [
  '母亲',
  '父亲',
  '记者',
  '护士',
  '伤员',
  '同乡',
  '弟兄',
  '士兵',
  '班长',
  '排长',
  '营长',
  '团长',
  '媳妇',
  '老人',
  '老太太',
  '姑娘',
  '孩子',
  '船夫',
  '军官',
  '哨兵',
  '战友',
  '先生',
  '女士',
] as const

/** 「他/她」要跟这些落点同段出现，才算「这一段里有个人」 */
const BODY_HINTS = [
  '脸',
  '眼睛',
  '眼',
  '声音',
  '背影',
  '手',
  '名字',
  '肩',
  '头',
  '眉',
  '嘴唇',
  '眼神',
  '额头',
  '脖子',
] as const

const MEMORY_WORDS = ['记得', '那年', '从前', '后来', '想起', '十年前', '小时候', '早年', '那时候', '旧年', '回忆'] as const

const FEMALE_MARKERS: ReadonlyArray<readonly [string, number]> = [
  ['杨惠敏', 3],
  ['母亲', 3],
  ['护士', 3],
  ['媳妇', 3],
  ['姑娘', 3],
  ['女人', 3],
  ['女士', 3],
  ['老太太', 3],
  ['妇人', 3],
  ['嫂子', 3],
  ['她', 1],
]

const MALE_MARKERS: ReadonlyArray<readonly [string, number]> = [
  ['陈望生', 3],
  ['谢晋元', 3],
  ['李满仓', 3],
  ['陈树生', 3],
  ['士兵', 3],
  ['弟兄', 3],
  ['班长', 3],
  ['排长', 3],
  ['营长', 3],
  ['团长', 3],
  ['军官', 3],
  ['哨兵', 3],
  ['战友', 3],
  ['男人', 3],
  ['父亲', 3],
  ['先生', 3],
  ['兵', 1],
  ['他', 1],
]

/* ============================== 纯函数 ============================== */

const countOf = (text: string, word: string) => {
  let hits = 0
  let at = text.indexOf(word)
  while (at !== -1) {
    hits += 1
    at = text.indexOf(word, at + word.length)
  }
  return hits
}

/**
 * 单段超长时按句末标点切块。
 * 保守策略：切完拼回去必须与原文逐字相同，否则原样返回（宁可长，不许丢字）。
 */
export function splitLongParagraph(text: string, limit = SPLIT_CHARS): string[] {
  if (text.length <= limit) return [text]
  const sentences = text.match(/[^。！？!?…；;\n]+[。！？!?…；;」』”’）)]*/g)
  if (!sentences || sentences.length < 2) return [text]
  const chunks: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (buffer && buffer.length + sentence.length > limit) {
      chunks.push(buffer)
      buffer = sentence
    } else {
      buffer += sentence
    }
  }
  if (buffer) chunks.push(buffer)
  if (chunks.join('') !== text) return [text]
  return chunks
}

/**
 * 分段：先切超长段，再按段数均分 3 组（n ≥ 7），n ≤ 6 不分。
 * 顺序保持不变，所有段落都会出现在结果里。
 */
export function groupParagraphs(paragraphs: string[]): string[][] {
  const expanded = paragraphs.flatMap((text) => splitLongParagraph(text))
  if (expanded.length === 0) return []
  if (expanded.length <= 6) return [expanded]
  const base = Math.floor(expanded.length / BEAT_COUNT)
  const extra = expanded.length % BEAT_COUNT
  const groups: string[][] = []
  let cursor = 0
  for (let group = 0; group < BEAT_COUNT; group += 1) {
    const size = base + (group < extra ? 1 : 0)
    groups.push(expanded.slice(cursor, cursor + size))
    cursor += size
  }
  return groups
}

/** 单段里有没有人（代词要带落点，避免满篇「他」都算人物） */
export function paragraphHasPerson(paragraph: string): boolean {
  if (FIGURE_NAMES.some((name) => paragraph.includes(name))) return true
  if (FIGURE_ROLES.some((role) => paragraph.includes(role))) return true
  const pronouns = paragraph.replace(/其他|其它/g, '')
  if (!/[他她]/.test(pronouns)) return false
  return BODY_HINTS.some((hint) => pronouns.includes(hint))
}

/** 有人的组判性别：女分 > 男分才 female，判不出来默认 male */
export function genderOf(text: string): 'male' | 'female' {
  // 单字标记（她 / 他 / 兵）一段里可能出现很多次，封顶 3 分，免得刷屏压过身份词
  const score = (table: ReadonlyArray<readonly [string, number]>) =>
    table.reduce((sum, [word, weight]) => {
      const hits = countOf(text, word)
      return sum + (word.length === 1 ? Math.min(hits, 3) : hits) * weight
    }, 0)
  return score(FEMALE_MARKERS) > score(MALE_MARKERS) ? 'female' : 'male'
}

/** 一组正文的判词：mood / hasPerson / memory */
export function classifyBeat(paragraphs: string[]): Omit<Beat, 'key' | 'paragraphs'> {
  const text = paragraphs.join('\n')
  const hasPerson = paragraphs.some(paragraphHasPerson)
  const memory = MEMORY_WORDS.some((word) => text.includes(word))
  let mood: Mood = 'scene'
  if (hasPerson) mood = genderOf(text) === 'female' ? 'figure-female' : 'figure-male'
  else if (memory) mood = 'memory'
  return { mood, hasPerson, memory }
}

/** 正文 → 组（组件渲染与外部诊断共用同一个函数，避免两套规则） */
export function buildBeats(paragraphs: string[]): Beat[] {
  return groupParagraphs(paragraphs).map((group, at) => ({
    key: `beat-${at}`,
    paragraphs: group,
    ...classifyBeat(group),
  }))
}

/* ============================== 小工具 ============================== */

/** 每个组件各带一份，避免为了一个 hook 相互 import（接进 App 后可换成共用 hook） */
function useReduceMotion(forced?: boolean) {
  const [media, setMedia] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setMedia(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return forced ?? media
}

/**
 * 多实例共存时的键盘归属：
 * 焦点在谁里面，Enter/空格就归谁；焦点在 body 上时，归「最近被点过」的那个实例，
 * 一个都没点过就归最先挂载的那个（真实 App 只有一个实例，不受影响）。
 */
const ambientOwners = new Set<HTMLElement>()
let activeRoot: HTMLElement | null = null

/* ============================== 组件 ============================== */

export function SceneBeats({ paragraphs, footer, onBeatChange, onSound, reduceMotion, className }: SceneBeatsProps) {
  const reduce = useReduceMotion(reduceMotion)

  // 用内容签名而不是数组引用做依赖：App 每帧新建数组时不会把阅读进度重置回第一组
  const signature = useMemo(() => paragraphs.join('\u0001'), [paragraphs])
  const beats = useMemo(
    () => (paragraphs.length === 0 ? [] : buildBeats(signature.split('\u0001'))),
    [signature, paragraphs.length],
  )
  const total = beats.length

  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  /** 正在擦除的旧组（只在 220ms 里存在） */
  const [leaving, setLeaving] = useState<Beat | null>(null)
  /** 过渡期间锁住舞台高度，避免新组比旧组短时卡片一抖 */
  const [stuck, setStuck] = useState<number | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const lockRef = useRef(0)
  const leaveTimer = useRef<number | null>(null)
  const stuckTimer = useRef<number | null>(null)

  // 最新值都放 ref：advance 与键盘监听因此可以只挂一次
  const indexRef = useRef(index)
  indexRef.current = index
  const finishedRef = useRef(finished)
  finishedRef.current = finished
  const beatsRef = useRef(beats)
  beatsRef.current = beats
  const reduceRef = useRef(reduce)
  reduceRef.current = reduce
  const soundRef = useRef(onSound)
  soundRef.current = onSound
  const infoRef = useRef(onBeatChange)
  infoRef.current = onBeatChange

  /** 只有一组时没有「继续读」可言：直接算读完，选项区立刻出现（保持现有节奏） */
  const done = total <= 1 ? true : finished
  const beat: Beat | undefined = beats[index] ?? beats[0]

  /* ---------- 正文换了（换场景 / 换结果页）就回到第一组 ---------- */
  useEffect(() => {
    setIndex(0)
    setFinished(false)
    setLeaving(null)
    setStuck(null)
    lockRef.current = 0
  }, [signature])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    ambientOwners.add(root)
    return () => {
      ambientOwners.delete(root)
      if (activeRoot === root) activeRoot = null
    }
  }, [])

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
      if (stuckTimer.current !== null) window.clearTimeout(stuckTimer.current)
    },
    [],
  )

  /* ---------- 换组回执：App 拿 mood 去换 Stage 背景 ---------- */
  useEffect(() => {
    if (!beat) return
    infoRef.current?.({ index, total, mood: beat.mood, hasPerson: beat.hasPerson })
    // beat 由 index / beats 决定，这里依赖到 index 与 total 就够
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total, beat?.mood, beat?.hasPerson])

  /* ---------- 推进一组 ---------- */
  const advance = useCallback(() => {
    const now = Date.now()
    // 连点/连按：一次手势只走一组
    if (now < lockRef.current) return
    if (finishedRef.current) return
    const list = beatsRef.current
    if (list.length === 0) return
    const current = indexRef.current
    const last = list.length - 1

    lockRef.current = now + ADVANCE_LOCK_MS

    // 最后一组：不再换文本，把选项区放出来
    if (current >= last) {
      finishedRef.current = true
      setFinished(true)
      soundRef.current?.('paper')
      return
    }

    const next = current + 1
    const outgoing = list[current]
    const incoming = list[next]

    if (!reduceRef.current) {
      const height = stageRef.current?.offsetHeight ?? 0
      if (height > 0) {
        setStuck(height)
        if (stuckTimer.current !== null) window.clearTimeout(stuckTimer.current)
        stuckTimer.current = window.setTimeout(() => setStuck(null), ADVANCE_LOCK_MS)
      }
      setLeaving(outgoing)
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
      leaveTimer.current = window.setTimeout(() => setLeaving(null), LEAVE_MS)
    } else {
      setLeaving(null)
      setStuck(null)
    }

    indexRef.current = next
    setIndex(next)
    // 普通叙事翻页是纸声；回忆 / 人物组是墨沉下去
    soundRef.current?.(incoming.mood === 'scene' ? 'paper' : 'ink')
  }, [])

  /* ---------- 键盘：Enter / 空格 ---------- */
  useEffect(() => {
    if (typeof window === 'undefined' || total <= 1) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
      const root = rootRef.current
      if (!root) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const focused = document.activeElement as HTMLElement | null
      const inside = Boolean(focused && root.contains(focused))
      const ambient = !focused || focused === document.body || focused === document.documentElement
      if (!inside) {
        if (!ambient) return
        const owner = activeRoot && activeRoot.isConnected ? activeRoot : ambientOwners.values().next().value
        if (owner !== root) return
      }
      // 按钮自己会响应 Enter/空格（原生点击），这里让路，免得一次按键走两组
      if (inside && focused && focused.tagName === 'BUTTON') return
      if (finishedRef.current) return
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, total])

  const markActive = () => {
    activeRoot = rootRef.current
  }

  const figureVariant: 'male' | 'female' = beat?.mood === 'figure-female' ? 'female' : 'male'
  const figureStyle = beat?.hasPerson
    ? ({ '--fig-opacity': String(FIGURE_OPACITY[figureVariant]) } as CSSProperties)
    : undefined

  return (
    <div
      ref={rootRef}
      className={`beats${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={total > 1 ? '正文，分三段阅读' : '正文'}
      data-testid="beats"
      data-mood={beat?.mood ?? 'scene'}
      data-has-person={beat?.hasPerson ? 'true' : 'false'}
      data-memory={beat?.memory ? 'true' : 'false'}
      data-beat-index={index}
      data-beat-total={total}
      data-done={done ? 'true' : 'false'}
      data-reduce-motion={reduce ? 'true' : 'false'}
      onPointerDown={markActive}
      onFocus={markActive}
    >
      <div className="beats__atmos" aria-hidden="true" />

      {/* 剪影挂在卡片上、贴着卡片下沿：躯干被卡片底边裁掉，正好是「半个躯干」 */}
      {beat?.hasPerson && (
        <div
          key={`${beat.key}-figure`}
          className="beats__figure"
          style={figureStyle}
          data-opacity={FIGURE_OPACITY[figureVariant]}
          aria-hidden="true"
        >
          <SilhouetteFigure variant={figureVariant} />
        </div>
      )}

      {beat && (
        <div className="beats__stage" ref={stageRef} style={stuck ? { minHeight: stuck } : undefined}>
          <div className="beats__scrim" aria-hidden="true" />

          {leaving && !reduce && (
            <div className="beats__beat beats__beat--leaving" aria-hidden="true">
              {leaving.paragraphs.map((text, at) => (
                <p key={at} className="beats__para">
                  {text}
                </p>
              ))}
            </div>
          )}

          {leaving && !reduce && <span className="beats__inkwipe" aria-hidden="true" />}

          <div key={beat.key} className="beats__beat beats__beat--current" data-beat={index}>
            {beat.paragraphs.map((text, at) => (
              <p
                key={at}
                className="beats__para"
                style={reduce ? undefined : { animationDelay: `${Math.min(at * STAGGER_MS, STAGGER_CAP_MS)}ms` }}
              >
                {text}
              </p>
            ))}
          </div>
        </div>
      )}

      {total > 1 && !done && (
        <div className="beats__bar">
          <div
            className="beats__progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            aria-label="长段落阅读进度"
          >
            {beats.map((item, at) => (
              <span key={item.key} className="beats__dot" data-current={at === index ? 'true' : 'false'} />
            ))}
          </div>
          <button
            type="button"
            className="beats__next"
            data-testid="beats-next"
            onClick={() => {
              markActive()
              advance()
            }}
          >
            继续读
            <span className="beats__next-mark" aria-hidden="true">
              ▸
            </span>
          </button>
        </div>
      )}

      {done && footer && (
        <div className="beats__footer" data-testid="beats-footer" data-done="true">
          {footer(done)}
        </div>
      )}

      <p className="beats__sr" aria-live="polite">
        {total > 1 ? `第 ${index + 1} 组，共 ${total} 组` : ''}
      </p>
    </div>
  )
}
