/**
 * 《把名字留下来》核心类型
 *
 * 红线（改动前请先读设计基线 v0.2 第 3 节）：
 * - 不做杀敌计数、不做战斗评分、不把苦难做成奖励。
 * - 结局只改变"哪些记忆被留下"，不绑定死亡人数。
 * - 真实人物只以有出处的事实出现，不虚构台词。
 */

export type MemoryKind =
  | 'roster' // 名册页
  | 'letters' // 家书
  | 'flag' // 旗
  | 'photo' // 照片
  | 'testimony' // 口述
  | 'message' // 口信

export type Ledger = Record<MemoryKind, number>

export const EMPTY_LEDGER: Ledger = {
  roster: 0,
  letters: 0,
  flag: 0,
  photo: 0,
  testimony: 0,
  message: 0,
}

export type MemoryGain = Partial<Ledger>

/**
 * 合成结局：两个记忆载体同时被留下来时才会出现，
 * 表现"记忆互相作证"，不属于六个主结局的序列。
 */
export type CompositeKind = 'archive' | 'relics' | 'wordofmouth'

/** 结局种类：六个主结局（记忆载体）+ 三个合成结局 */
export type EndingKind = MemoryKind | CompositeKind

/**
 * 背景键：扩写卷会用到更多场景名（smoke/street/yard…）。
 * Stage 只认识 6 个有 CSS 渐变的键，未知键自动回退到 warehouse，不会白屏。
 */
export type BackgroundKey = string

export type Weather = 'rain' | 'ash' | 'smoke' | 'snow' | 'none'

/**
 * 史料卡状态
 * - verified：已核对，可引用，正文可用
 * - pending：有出处但原文/页码未核，正文只可作概述
 * - needed：文献还没到手，只登记"需要什么"，不进入正文
 */
export type SourceStatus = 'verified' | 'pending' | 'needed'

export type SourceType = 'book' | 'news' | 'archive' | 'museum' | 'interview'

/**
 * 史料卡：一张卡 = 一条可定位的史实依据。
 *
 * 插拔方式：
 * 1. 在 sources.ts 里加一条，填 work / author / year / claim / excerpt / locator；
 * 2. 在 chapter1.ts 的目标场景 `sources: ['卡片id']` 里引用；
 * 3. UI 会自动在场景页脚出现，并进入「史料库」分组。
 * 不需要改任何组件代码。
 */
export type SourceCard = {
  id: string
  type: SourceType
  status: SourceStatus
  /** 所属文献标题，用于史料库分组；如《八百壮士》 */
  work: string
  /** 文献作者 */
  author?: string
  /** 出版社 / 发表媒体 */
  publisher?: string
  /** 出版年 / 发表年 */
  year?: number
  /** 版次、卷次 */
  edition?: string
  /** 这条依据支撑的具体史实陈述（一句话） */
  claim: string
  /** 可直接引用的原文；needed 状态留空 */
  excerpt?: string
  /** 页码 / 章节定位，如「第 7 章，p.132」 */
  locator?: string
  /** 内部备注：为什么需要它、拿到后补什么 */
  note?: string
  /** 用到这张卡的场景，用于自动校验与「用于本场景」提示 */
  scenes: SceneId[]
  /** 检索标签 */
  tags: string[]
}

export type Outcome = {
  paragraphs: string[]
  gain?: MemoryGain
  flags?: string[]
  /** 史实引文：必须来自已核来源，否则不要填 */
  quote?: { text: string; attribution: string }
  sources?: string[]
}

export type Choice = {
  id: string
  label: string
  /** 玩家可见的轻提示，不透数值 */
  hint?: string
  outcome: Outcome
  next: SceneId
  /** 尾声专用：选择把哪一样交给县志，直接决定结局 */
  ending?: EndingKind
}

export type Scene = {
  id: SceneId
  chapter: string
  title: string
  date?: string
  location?: string
  background: BackgroundKey
  weather: Weather
  paragraphs: string[]
  /** 场景插画 id，对应 public/art/<id>.jpg；缺省则不显示 */
  image?: string
  /** 插画说明（右下角小字，如「1937 年 10 月，四行仓库西墙」） */
  imageCaption?: string
  /** 页脚小注，如"复合型虚构角色"声明 */
  aside?: string
  choices?: Choice[]
  /** 无抉择场景的自动续接 */
  continueTo?: SceneId
  sources?: string[]
}

/**
 * 场景 id：扩写后允许任意稳定字符串（v0-01、v2-13…）。
 * 约定：
 * - 结局页固定为 ending_names / ending_letters / ending_flag / ending_photo / ending_testimony / ending_message
 * - 尾声固定为 epilogue
 * - 序卷 v0-xx，卷一 v1-xx，卷二 v2-xx，卷三 v3-xx，卷四 v4-xx，支线 v5-xx
 */
export type SceneId = string

export type GameState = {
  sceneId: SceneId
  ledger: Ledger
  flags: string[]
  /** 已显示过的抉择结果；非空时展示"继续"而不是选项 */
  pendingOutcome: Outcome | null
  /** 结果页点继续后要去的场景 */
  pendingNext: SceneId | null
  /** 已选过的选项 id，避免同一场景重复加值 */
  picked: Record<string, string>
  ending: EndingKind | null
  startedAt: number
  finishedAt: number | null
}

export type Ending = {
  kind: EndingKind
  title: string
  subtitle: string
  paragraphs: string[]
  /** 结局页固定语句 */
  coda: string
  sourceIds: string[]
}
