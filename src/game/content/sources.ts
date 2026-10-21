import type { SourceCard } from '../types'
import { AUTO_SOURCES } from './sources.auto'

/**
 * 史料卡注册表
 *
 * 规则：
 * - status='verified' 的卡必须同时有 excerpt（可引原句）与 locator（页码/章节），否则不进正文；
 * - status='needed' 的卡只登记"还需要哪本书的哪一章"，不进入正文，显示在「待接入文献」区；
 * - 场景通过 chapter1.ts 的 `sources: ['id']` 引用，UI 自动渲染，不需要改组件。
 *
 * 换书 / 补文献只改这个文件。
 */
const BASE_SOURCES: SourceCard[] = [
  /* ------------------------------------------------------------------ *
   * 已核对：现代报道（2010 / 2015），可直接引用
   * ------------------------------------------------------------------ */
  {
    id: 's-battle',
    type: 'news',
    status: 'verified',
    work: '淞沪会战「八百壮士」半数是湖北通城人 87 人查实姓名',
    author: '荆楚网（新华社转载）',
    publisher: '新华社',
    year: 2015,
    claim: '四行仓库保卫战是淞沪会战的最后一战，参战士兵史称「八百壮士」。',
    excerpt:
      '上海苏州河北岸的四行仓库保卫战，则是淞沪会战的最后一战，参战的中国士兵史称「八百壮士」。',
    locator: '正文第 1 段',
    scenes: ['night1', 'night3'],
    tags: ['淞沪会战', '四行仓库', '八百壮士'],
  },
  {
    id: 's-420',
    type: 'news',
    status: 'verified',
    work: '淞沪会战「八百壮士」半数是湖北通城人 87 人查实姓名',
    author: '荆楚网（新华社转载）',
    publisher: '新华社',
    year: 2015,
    claim: '「八百壮士」实际只有四百余人，通城籍占半数。',
    excerpt: '「八百壮士」其实只有 400 多人，其中一半是通城籍。',
    locator: '正文第 2 段',
    note: '同文引《辞海》作 452 名；通城方面采信约 420 人。',
    scenes: ['night1', 'night4'],
    tags: ['人数', '通城'],
  },
  {
    id: 's-tongcheng',
    type: 'news',
    status: 'verified',
    work: '淞沪会战「八百壮士」半数是湖北通城人 87 人查实姓名',
    author: '荆楚网（新华社转载）',
    publisher: '新华社',
    year: 2015,
    claim: '通城籍壮士二百余人，整建制补充进 88 师 524 团一营，是守军中坚。',
    excerpt:
      '1937 年 9 月，通城县保安大队一、三中队 200 余人被整编入湖北保安五团。当年 10 月，湖北保安五团奉命开赴淞沪前线，整建制补充伤亡惨重的 88 师 524 团，通城的两个中队编入一营，成为……「八百壮士」的中坚。',
    locator: '正文「通城籍壮士 200 人以上」节',
    scenes: ['prologue', 'night1', 'night2'],
    tags: ['通城', '88师524团', '补充兵'],
  },
  {
    id: 's-49',
    type: 'archive',
    status: 'verified',
    work: '淞沪会战「八百壮士」半数是湖北通城人 87 人查实姓名',
    author: '荆楚网（新华社转载）',
    publisher: '新华社',
    year: 2015,
    claim: '1947 年通城县参议会编《通城县抗战史料》，收有四十九壮士姓名一览表。',
    excerpt:
      '从县档案馆发现了民国通城县参议会在 1947 年编的《通城县抗战史料》，其中有《通城县参加上海四行孤军四十九壮士姓名一览表》、《参加上海四行守军通城籍四十九壮士合传》。',
    locator: '正文「查实姓名者 87 人均已离世」节',
    scenes: ['prologue', 'epilogue'],
    tags: ['名册', '通城县抗战史料', '1947'],
  },
  {
    id: 's-87',
    type: 'news',
    status: 'verified',
    work: '淞沪会战「八百壮士」半数是湖北通城人 87 人查实姓名',
    author: '荆楚网（新华社转载）',
    publisher: '新华社',
    year: 2015,
    claim:
      '截至 2015 年查实姓名的仅 87 人；最后一位周福其去世（新华社原文作 2005 年 11 月，纪念馆考订为 2006 年 1 月 17 日）。',
    excerpt:
      '排除一人多名、重复交叉的错误，形成了现在通城籍 87 名「八百壮士」名表。……查实姓名的 87 人均不健在，最后一位周福其壮士，在 2005 年 11 月离世。',
    locator: '正文「查实姓名者 87 人均已离世」节',
    note: '卒年以 auto-c-05（纪念馆/方毓强《最后一位"八百壮士"》）为准：2006-01-17。',
    scenes: ['epilogue', 'night5b'],
    tags: ['87 人', '寻访', '周福其'],
  },
  {
    id: 's-xie',
    type: 'news',
    status: 'verified',
    work: '八百壮士在重围中执戈为国',
    author: '王大可',
    publisher: '光明日报',
    year: 2010,
    claim: '谢晋元生平：1905 年生于广东蕉岭，黄埔四期，1941 年 4 月 24 日遇刺殉国。',
    excerpt: '1941 年 4 月 24 日，谢晋元将军被汪伪收买的叛兵杀害，终年 37 岁。',
    locator: '第 06 版，正文第 3 段',
    scenes: ['night1', 'night5'],
    tags: ['谢晋元', '遇刺', '黄埔'],
  },
  {
    id: 's-book',
    type: 'news',
    status: 'verified',
    work: '八百壮士在重围中执戈为国',
    author: '王大可',
    publisher: '光明日报',
    year: 2010,
    claim: '谢继民《我的父亲谢晋元将军》书后附四万余字谢晋元日记摘抄。',
    excerpt: '该书后附 4 万余字的谢晋元将军的日记摘抄，内容尤为珍贵。',
    locator: '第 06 版，正文第 4 段',
    scenes: [],
    tags: ['书目', '日记', '谢继民'],
  },
  {
    id: 's-lonecamp',
    type: 'news',
    status: 'verified',
    work: '八百壮士在重围中执戈为国',
    author: '王大可',
    publisher: '光明日报',
    year: 2010,
    claim: '八百壮士滞留「孤军营」四年，日伪多次诱降均被谢晋元严词拒绝。',
    excerpt:
      '在八百壮士滞留「孤军营」的四年里，日伪无休止的诱降活动，均遭到谢晋元将军的严词痛斥。',
    locator: '第 06 版，正文第 2 段',
    scenes: ['night5b'],
    tags: ['孤军营', '诱降', '软禁'],
  },

  {
    id: 's-chen-shusheng',
    type: 'news',
    status: 'verified',
    work: '独家：谢团长，宁愿死，不投降',
    author: '谢继民',
    publisher: '参考消息（新华网转载）',
    year: 2015,
    claim: '10 月 28 日，敢死队队员陈树生身缚手榴弹从五楼跃入敌丛，与十余名敌兵同归于尽。',
    excerpt:
      '敢死队队员陈树生在自己身上缚满手榴弹，拉了导火索，从五楼窗口跃入敌丛，与 10 余敌兵同归于尽，英勇壮烈的情景，令人泪下。',
    locator: '正文「血战四行四昼夜毙敌 200 多」节',
    scenes: ['night3'],
    tags: ['陈树生', '敢死队', '四行仓库'],
  },

  {
    id: 's-four-banks',
    type: 'news',
    status: 'verified',
    work: '独家：谢团长，宁愿死，不投降',
    author: '谢继民',
    publisher: '参考消息（新华网转载）',
    year: 2015,
    claim: '四行仓库是金城、大陆、盐业、中南四家银行储蓄会合建的仓库，位于苏州河北岸新垃圾桥西面。',
    excerpt:
      '四行仓库是金城、大陆、盐业、中南四个银行储蓄会的仓库，位于苏州河北岸新垃圾桥（现西藏路桥）西面。',
    locator: '正文「率一营孤军坚守最后阵地」节',
    scenes: ['night1'],
    tags: ['四行仓库', '建筑', '四家银行'],
  },

  {
    id: 's-lonecamp-workshops',
    type: 'news',
    status: 'verified',
    work: '独家：谢团长，宁愿死，不投降',
    author: '谢继民',
    publisher: '参考消息（新华网转载）',
    year: 2015,
    claim: '孤军营中谢晋元带战士平整场地、自盖房屋，开办制皂、织袜、毛巾等工厂，并安排教育、生产、体育三类日程。',
    excerpt:
      '他带领战士平整场地，自盖房屋，逐步开办制皂、织袜、毛巾等工厂，使战士学习技能，便于今后独立生活。……每天按教育、生产、体育三项内容安排时间。',
    locator: '正文「孤军营中坚持气节遭杀害」节',
    scenes: ['v3-01'],
    tags: ['孤军营', '工场', '识字'],
  },

  {
    id: 's-813',
    type: 'news',
    status: 'verified',
    work: '八百壮士在重围中执戈为国',
    author: '王大可',
    publisher: '光明日报',
    year: 2010,
    claim: '1937 年 8 月 13 日，日军向上海发动进攻，八一三淞沪会战爆发。',
    excerpt:
      '1937 年 7 月 7 日，卢沟桥事变后全面抗战爆发，8 月 13 日，日军向上海发动进攻，「八·一三」淞沪会战爆发。',
    locator: '第 06 版，正文第 1 段',
    scenes: [],
    tags: ['八一三', '淞沪会战', '时间线'],
  },

  {
    id: 's-flag-raise',
    type: 'news',
    status: 'verified',
    work: '独家：谢团长，宁愿死，不投降',
    author: '谢继民',
    publisher: '参考消息（新华网转载）',
    year: 2015,
    claim:
      '杨惠敏夜间把国旗送入仓库；因旗太小，市商会又送特大国旗一面、长竹竿两根、旗绳一根；旗在六层楼顶升起，对岸民众欢呼落泪。',
    excerpt:
      '女童子军杨惠敏冒着生命危险于夜间爬过西藏路把国旗送入仓库。后因国旗太小，市商会又派人送去特大国旗一面，长竹竿两根，旗绳一根。……当代表国家尊严的国旗压倒了周围的太阳旗在晴空飘扬时，租界上观战的民众欢声雷动……许多人感动得流下了热泪。',
    locator: '正文「血战四行四昼夜毙敌 200 多」节',
    scenes: ['night3'],
    tags: ['升旗', '杨惠敏', '市商会'],
  },

  {
    id: 's-lonecamp-flag',
    type: 'news',
    status: 'verified',
    work: '独家：谢团长，宁愿死，不投降',
    author: '谢继民',
    publisher: '参考消息（新华网转载）',
    year: 2015,
    claim: '孤军营中坚持精神升旗典礼，谢晋元以「含辛茹苦，以待光明来临」勉励官兵。',
    excerpt:
      '并亲率士兵坚持出操上课，以木枪练习瞄准刺杀，还举行精神升旗典礼，勉励全体官兵，「含辛茹苦，以待光明来临」。',
    locator: '正文「孤军营中坚持气节遭杀害」节',
    scenes: ['v3-05', 'v3-11'],
    tags: ['孤军营', '升旗', '精神升旗'],
  },

  /* ------------------------------------------------------------------ *
   * 待接入：可获取的现代文献（微信读书 / 掌阅 / 上海人民出版社）
   * 拿到书后：填 excerpt + locator，把 status 改成 'verified'，
   * 再把 id 加进对应场景的 sources 即可，不用改 UI。
   * ------------------------------------------------------------------ */
  {
    id: 's-baibai',
    type: 'book',
    status: 'needed',
    work: '八百壮士：中国孤军营上海抗战纪实',
    author: '陈立人',
    publisher: '团结出版社',
    year: 2024,
    edition: 'ISBN 9787802149298',
    claim: '四行仓库守军编成、五夜战况、租界缴械与孤军营始末。',
    locator: '待补：第 2 章《孤堡》、第 6 章《孤军营不是田横岛》、第 18 章《英雄倒在黎明》',
    note: '微信读书 / 掌阅可搜到（电影《八佰》原型读物）。优先补第 2 章：五夜逐日战况。',
    scenes: [],
    tags: ['四行仓库', '守军', '孤军营'],
  },
  {
    id: 's-shanghai-war',
    type: 'book',
    status: 'needed',
    work: '上海抗日战争史',
    author: '余子道、张云、吴海勇、韩洪泉',
    publisher: '上海人民出版社',
    year: 2025,
    claim: '八一三淞沪会战在上海抗战与全国抗战中的位置；四行仓库撤退后的上海态势。',
    locator: '待补：淞沪会战相关章节',
    note: '2025 新书，权威著作，较易获取。用来校核第 1、5 夜的时代背景。',
    scenes: [],
    tags: ['淞沪会战', '上海抗战', '背景'],
  },
  {
    id: 's-xie-bio',
    type: 'book',
    status: 'needed',
    work: '挥剑四行：谢晋元传',
    author: '戴胜德、谭元亨',
    publisher: '—',
    claim: '谢晋元生平与其在四行仓库的指挥经过。',
    locator: '待补：四行仓库章节',
    note: '微信读书可搜到（「十一五」国家重点图书出版规划客家研究文丛）。补第二夜、第五夜的人物细节。',
    scenes: [],
    tags: ['谢晋元', '传记', '人物'],
  },
  {
    id: 's-xie-diary',
    type: 'book',
    status: 'needed',
    work: '我的父亲谢晋元将军——八百壮士浴血奋战记',
    author: '谢继民',
    publisher: '团结出版社',
    year: 2010,
    claim: '谢晋元本人关于点名、造册、部属姓名的原话（书后附日记摘抄）。',
    locator: '待补：日记摘抄部分，检索「点名」「名册」「姓名」',
    note: '这是整个「记名字」机制的史料支点。平台搜不到时，优先用《八百壮士》里的转引。',
    scenes: [],
    tags: ['谢晋元日记', '名册', '点名'],
  },
  {
    id: 's-tongcheng-arch',
    type: 'archive',
    status: 'needed',
    work: '通城县抗战史料',
    author: '通城县参议会 编',
    publisher: '通城县档案馆藏',
    year: 1947,
    claim: '《通城县参加上海四行孤军四十九壮士姓名一览表》原文与合传。',
    locator: '待补：通城县档案馆原件或影印',
    note: '游戏内「名册」的原型。大概率无法公开获取，找不到就继续用新华社报道的转述。',
    scenes: [],
    tags: ['名册', '四十九壮士', '档案'],
  },
  {
    id: 's-flag-source',
    type: 'book',
    status: 'needed',
    work: '八百壮士：中国孤军营上海抗战纪实',
    author: '陈立人',
    publisher: '团结出版社',
    year: 2024,
    claim: '升旗与送旗的具体经过（现有多种说法，需对照）。',
    locator: '待补：第 3 章《血醒租借地》',
    note: '目前正文只写「说法有很多种」，不给定版本。拿到后可补一句可核表述。',
    scenes: [],
    tags: ['升旗', '送旗', '杨惠敏'],
  },
]

/* ------------------------------------------------------------------ *
 * 合并「人工登记的待接入卡」与「脚本自动回填的卡」
 * - 自动回填里已核实的文献，会把同名文献下的 needed 占位卡顶掉；
 * - 同 id 时自动回填优先。
 * 这样收集 AI 交回数据后，不需要手工删占位卡。
 * ------------------------------------------------------------------ */
const autoVerifiedWorks = new Set(
  AUTO_SOURCES.filter((card) => card.status === 'verified').map((card) => card.work),
)

const mergedSources = new Map<string, SourceCard>()
for (const card of BASE_SOURCES) {
  if (card.status === 'needed' && autoVerifiedWorks.has(card.work)) continue
  mergedSources.set(card.id, card)
}
for (const card of AUTO_SOURCES) {
  mergedSources.set(card.id, card)
}

export const SOURCES: SourceCard[] = [...mergedSources.values()]

export const SOURCE_MAP = new Map(SOURCES.map((source) => [source.id, source]))

/** 已核对、可出现在正文的卡 */
export const VERIFIED_SOURCES = SOURCES.filter((source) => source.status === 'verified')

/** 还缺文献、只作登记、不进正文的卡 */
export const NEEDED_SOURCES = SOURCES.filter((source) => source.status === 'needed')

/** 有出处但说法不一、暂不进入正文的卡 */
export const PENDING_SOURCES = SOURCES.filter((source) => source.status === 'pending')

/** 按文献分组，供史料库页使用 */
export function groupByWork(list: SourceCard[] = SOURCES): Map<string, SourceCard[]> {
  const map = new Map<string, SourceCard[]>()
  for (const card of list) {
    const group = map.get(card.work) ?? []
    group.push(card)
    map.set(card.work, group)
  }
  return map
}

/** 按状态给卡片一个可读标签 */
export function statusLabel(card: SourceCard): string {
  if (card.status === 'verified') return '已核对'
  if (card.status === 'pending') return '待核对'
  return '待接入文献'
}
