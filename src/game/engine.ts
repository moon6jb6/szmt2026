import {
  EMPTY_LEDGER,
  type Ending,
  type GameState,
  type Ledger,
  type MemoryGain,
  type Outcome,
  type SceneId,
} from './types'

export const SAVE_KEY = 'names-ledger-v1'

export const INITIAL_STATE: GameState = {
  // 扩写后主线从序卷 v0-01 开始：v0-08 → prologue → v1-01 → … → night1
  sceneId: 'v0-01',
  ledger: { ...EMPTY_LEDGER },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: 0,
  finishedAt: null,
}

export function createState(now = Date.now()): GameState {
  return { ...INITIAL_STATE, ledger: { ...EMPTY_LEDGER }, startedAt: now }
}

function applyGain(ledger: Ledger, gain?: MemoryGain): Ledger {
  if (!gain) return ledger
  const next: Ledger = { ...ledger }
  for (const key of Object.keys(gain) as (keyof Ledger)[]) {
    const amount = gain[key] ?? 0
    next[key] = Math.max(0, next[key] + amount)
  }
  return next
}

export function choose(
  state: GameState,
  choiceId: string,
  outcome: Outcome,
  nextScene: SceneId,
  ending: GameState['ending'] = null,
  flags: string[] = [],
): GameState {
  if (state.picked[state.sceneId]) return state
  const mergedFlags = Array.from(new Set([...state.flags, ...(outcome.flags ?? []), ...flags]))
  return {
    ...state,
    ledger: applyGain(state.ledger, outcome.gain),
    flags: mergedFlags,
    pendingOutcome: outcome,
    pendingNext: nextScene,
    picked: { ...state.picked, [state.sceneId]: choiceId },
    ending,
    sceneId: state.sceneId,
  }
}

/** 结果页点"继续" */
export function advance(state: GameState, nextScene: SceneId, finish = false): GameState {
  return {
    ...state,
    sceneId: nextScene,
    pendingOutcome: null,
    pendingNext: null,
    finishedAt: finish ? Date.now() : state.finishedAt,
  }
}

export function save(state: GameState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
  } catch {
    /* 私密模式下 localStorage 可能不可用，静默降级 */
  }
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GameState
    if (!parsed || typeof parsed.sceneId !== 'string') return null
    return { ...INITIAL_STATE, ...parsed, ledger: { ...EMPTY_LEDGER, ...parsed.ledger } }
  } catch {
    return null
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* noop */
  }
}

const ENDING_PRIORITY: (keyof Ledger)[] = [
  'testimony',
  'roster',
  'letters',
  'flag',
  'photo',
  'message',
]

/** 老版本兜底：没有结局选择时，按记忆账本权重判定 */
export function resolveEnding(state: GameState): Ending['kind'] {
  if (state.ending) return state.ending
  let best: keyof Ledger = ENDING_PRIORITY[0]
  let bestValue = -1
  for (const key of ENDING_PRIORITY) {
    const value = state.ledger[key]
    if (value > bestValue) {
      best = key
      bestValue = value
    }
  }
  return best
}

/** 可供尾声选择的记忆（有才能交） */
export function availableMemories(ledger: Ledger): (keyof Ledger)[] {
  return (Object.keys(ledger) as (keyof Ledger)[]).filter((key) => ledger[key] > 0)
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}
