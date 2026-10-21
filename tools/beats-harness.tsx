import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  SceneBeats,
  buildBeats,
  classifyBeat,
  genderOf,
  groupParagraphs,
  paragraphHasPerson,
  splitLongParagraph,
} from '../src/game/components/SceneBeats'
import type { BeatChangeInfo, Mood } from '../src/game/components/SceneBeats'

/**
 * 长段落分三段 · 组件验证页（只给开发/测试用，不进构建）
 *
 * 页面自己模拟了两层，跟真实接入时的分工一致：
 *   1. stageMock —— App 的 Stage 层：只认 mood，负责整页背景（组件不碰）；
 *   2. SceneBeats —— 卡片层：分组、擦除/错峰淡入、氛围、剪影、footer。
 * 所以「背景随段落变化」在验证页里是看得到的：换组时 stageMock 的底色跟着走。
 *
 * 断言入口（Playwright 用）：
 *   [data-testid="beats"]          data-mood / data-has-person / data-memory /
 *                                  data-beat-index / data-beat-total / data-done
 *   [data-testid="beats-next"]     「继续读」按钮
 *   [data-testid="beats-footer"]   done 之后才出现的选项区
 *   window.__BEATS__               纯函数（分组 / 判词 / 切长段）与 fixtures
 */

type ReduceMode = 'auto' | 'on' | 'off'

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六']

/* ---------------------------------------------------------------------------
   固定样例
   ① 主线七段：3/2/2 分组，三组判词分别是 scene / memory / figure-male
   --------------------------------------------------------------------------- */

const SEVEN: string[] = [
  '西墙外起了风。沙袋缝里的黄沙被风抽出来，落到地上，像有人在门外抖一件旧棉衣。',
  '底楼的灯只剩一个灯座。灯座上的瓷口缺了一块，摸上去是凉的。',
  '苏州河上起了雾。对岸的电车开过去，灯在雾里拖成一条黄线，走远了才断。',
  '那年冬天，通城下了很久的雪。城隍庙门口的甘蔗摊子支在檐下，摊主把刀在围裙上蹭两下，一截一截地剁。',
  '后来雪化了，屋檐滴水，滴在青石板上，滴出一排小坑。',
  '谢晋元站在一根方柱下面，让各连清点人数、造名册。说到「名册」，他伸手在文件箱的盖子上按了一下。',
  '墙上那盏煤油灯把他的手影投到柱子上，影子动了一下，墙皮上掉下一点灰。',
]

/* 超长单段：> 220 字，按句号该切成两到三块，一个字都不许丢 */
const LONG =
  '底楼原来挂灯泡的地方只剩下一个灯座，灯座上的瓷口缺了一块，摸上去是凉的。' +
  '墙上还留着灯绳磨出来的一道浅槽，槽里积了黑灰。有人把一盏马灯挂在原来的钩子上，' +
  '灯芯调得很小，火苗只有黄豆大，照见半张桌面和桌角上一只空碗。' +
  '碗底有一圈干了的粥痕，边上落了灰。窗外的风一阵紧一阵松，玻璃上有块纸糊的补丁，' +
  '被风顶得一起一落，像谁在轻轻敲。桌下堆着拆下来的门板，板子上有炮火燎过的黑斑，' +
  '指甲一刮就掉下炭末。没有人说话，只有风、纸、和灯芯偶尔爆一下的轻响。' +
  '墙角的水缸见了底，缸壁上挂着一圈白痕，是水退下去留下的。' +
  '沙袋后面有一双草鞋，鞋底朝上，钉子磨得发亮，鞋带还系着。'

/* 判词样例：人名+回忆 / 含「她」 / 纯环境 / 纯回忆 */
type Sample = { id: string; label: string; expect: Mood; paragraphs: string[] }

const SAMPLES: Sample[] = [
  {
    id: 'person-memory',
    label: '人名 + 回忆',
    expect: 'figure-male',
    paragraphs: ['陈望生想起那年冬天，李满仓蹲在城隍庙门口啃甘蔗，露出一颗缺了的门牙。'],
  },
  {
    id: 'she',
    label: '含「她」',
    expect: 'figure-female',
    paragraphs: ['她把脸别过去，声音低下去：「你们吃吧，我不饿。」'],
  },
  {
    id: 'environment',
    label: '纯环境',
    expect: 'scene',
    paragraphs: ['夜里落了一场雨，仓库的铁皮顶响了一夜。天亮时水还在往沙袋缝里渗。'],
  },
  {
    id: 'memory',
    label: '纯回忆',
    expect: 'memory',
    paragraphs: ['那年冬天，雪下得很早，河面结了薄冰，冰上有脚印一直走到对岸。'],
  },
]

/* 单组不分割（4 段 ≤ 6 → 一组，选项区立刻出现） */
const FOUR: string[] = [
  '撤退令是夜里下来的。各连在门口清点人数，报数的声音一个接一个。',
  '有人把绑腿重新扎了一遍，扎得比原来紧。',
  '桥面上有灯。灯是南岸的，隔着一条河，看着像别人的家。',
  '天快亮了，雾从河面漫上来。',
]

/* ---------------------------------------------------------------------------
   小组件
   --------------------------------------------------------------------------- */

function MoodSample({ sample }: { sample: Sample }) {
  const [info, setInfo] = useState<BeatChangeInfo | null>(null)
  return (
    <div className="cell" data-testid={`sample-${sample.id}`} data-expect={sample.expect}>
      <div className="cell__head">
        <span>{sample.label}</span>
        <span>
          期望 <b>{sample.expect}</b>
        </span>
      </div>
      <SceneBeats paragraphs={sample.paragraphs} onBeatChange={(next) => setInfo(next)} />
      <p className="fakeNote">
        data-mood = {info?.mood ?? '—'} · hasPerson = {String(info?.hasPerson ?? '—')}
      </p>
    </div>
  )
}

function MatrixCell({ count, reduce }: { count: number; reduce?: boolean }) {
  const paragraphs = Array.from({ length: count }, (_, at) => `${count}·${CN[at] ?? at + 1}`)
  const sizes = groupParagraphs(paragraphs).map((group) => group.length)
  return (
    <div className="cell cell--matrix" data-testid={`matrix-${count}`} data-group-sizes={sizes.join('/')}>
      <div className="cell__head">
        <span>{count} 段</span>
        <span>
          分组 <b data-testid={`matrix-${count}-sizes`}>{sizes.join(' / ')}</b>
        </span>
      </div>
      <SceneBeats paragraphs={paragraphs} reduceMotion={reduce} />
    </div>
  )
}

/** 假选项区：模拟 App 传给 footer 的 choices */
function FakeChoices({ done }: { done: boolean }) {
  return (
    <div className="fakeChoices">
      <button type="button" className="fakeChoice" data-testid="fake-choice">
        <strong>把名册留在墙上</strong>
      </button>
      <button type="button" className="fakeChoice" data-testid="fake-choice-2">
        <strong>把名册缝进衣襟带走</strong>
      </button>
      <p className="fakeNote">footer(done={String(done)}) — 只有读完最后一组才会渲染</p>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   页面
   --------------------------------------------------------------------------- */

function Harness() {
  const [reduceMode, setReduceMode] = useState<ReduceMode>('auto')
  const [resetKey, setResetKey] = useState(0)
  const [info, setInfo] = useState<BeatChangeInfo | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [cues, setCues] = useState<string[]>([])

  const reduce = reduceMode === 'auto' ? undefined : reduceMode === 'on'

  const onBeatChange = (next: BeatChangeInfo) => {
    setInfo(next)
    setLog((list) => {
      const entry = `#${next.index} ${next.mood}${next.hasPerson ? '+person' : ''}`
      if (list[list.length - 1] === entry) return list
      return [...list, entry]
    })
  }

  const reset = () => {
    setResetKey((n) => n + 1)
    setInfo(null)
    setLog([])
    setCues([])
  }

  const mood = info?.mood ?? 'scene'

  return (
    <div className="harness">
      <header className="harness__head">
        <div>
          <p className="harness__kicker">《把名字留下来》· 长段落分三段 · 组件验证页</p>
          <h1 className="harness__title">SceneBeats · 分段读 / 氛围 / 剪影</h1>
        </div>
        <div className="harness__controls">
          <label className="harness__field">
            <span>reduceMotion</span>
            <select
              data-testid="reduce-select"
              value={reduceMode}
              onChange={(event) => setReduceMode(event.target.value as ReduceMode)}
            >
              <option value="auto">auto（跟随系统）</option>
              <option value="on">强制开启</option>
              <option value="off">强制关闭</option>
            </select>
          </label>
          <button type="button" data-testid="reset" onClick={reset}>
            重开
          </button>
        </div>
      </header>

      {/* ---------- 一、主线七段：三组、三态 ---------- */}
      <section className="harness__panel" data-testid="panel-main">
        <div className="harness__panelHead">
          <h2>一 · 七段主线（3 / 2 / 2，三组判词不同）</h2>
          <div className="harness__stats">
            <span>
              onBeatChange <b data-testid="beat-log">{log.join(' · ') || '—'}</b>
            </span>
            <span>
              onSound <b data-testid="sound-log">{cues.join(' ') || '—'}</b>
            </span>
          </div>
        </div>

        <div className="stageMock" data-mood={mood} data-testid="stage-mock">
          <p className="stageMock__label">
            App 的 Stage 层：收到 mood = <b data-testid="stage-mood">{mood}</b>
            （组件只回传，不自己换整页背景）
          </p>
          <SceneBeats
            key={`main-${resetKey}-${reduceMode}`}
            paragraphs={SEVEN}
            reduceMotion={reduce}
            onBeatChange={onBeatChange}
            onSound={(cue) => setCues((list) => [...list, cue])}
            footer={(done) => <FakeChoices done={done} />}
          />
        </div>
      </section>

      {/* ---------- 二、判词样例 ---------- */}
      <section className="harness__panel">
        <div className="harness__panelHead">
          <h2>二 · 判词样例（每组独立判定，同一组只有一种 mood）</h2>
        </div>
        <div className="grid">
          {SAMPLES.map((sample) => (
            <MoodSample key={sample.id} sample={sample} />
          ))}
        </div>
      </section>

      {/* ---------- 三、分组矩阵 ---------- */}
      <section className="harness__panel" data-testid="panel-matrix">
        <div className="harness__panelHead">
          <h2>三 · 分组矩阵（n ≥ 7 均分 3 组，顺序不变）</h2>
        </div>
        <div className="grid">
          {[7, 9, 12, 15].map((count) => (
            <MatrixCell key={`${count}-${resetKey}`} count={count} reduce={reduce} />
          ))}
        </div>
      </section>

      {/* ---------- 四、边界 ---------- */}
      <section className="harness__panel">
        <div className="harness__panelHead">
          <h2>四 · 边界：≤ 6 段不分 / 单段超长按句号切</h2>
        </div>
        <div className="grid">
          <div className="cell" data-testid="cell-single">
            <div className="cell__head">
              <span>4 段（≤ 6）</span>
              <span>
                期望 <b>1 组 · 无按钮</b>
              </span>
            </div>
            <SceneBeats key={`four-${resetKey}`} paragraphs={FOUR} reduceMotion={reduce} footer={(done) => <FakeChoices done={done} />} />
          </div>
          <div className="cell" data-testid="cell-long">
            <div className="cell__head">
              <span>单段 {LONG.length} 字（&gt; 220）</span>
              <span>
                期望 <b>按句号再切</b>
              </span>
            </div>
            <SceneBeats key={`long-${resetKey}`} paragraphs={[LONG]} reduceMotion={reduce} />
            <p className="fakeNote">原文 {LONG.length} 字 · 切完拼回去必须与原文逐字相同</p>
          </div>
        </div>
      </section>

      {/* ---------- 五、嵌进已有 .scene 卡片 ---------- */}
      <section className="harness__panel" data-testid="panel-flat">
        <div className="harness__panelHead">
          <h2>五 · 嵌进 App 现有 .scene 卡片（className=&quot;beats--flat&quot;）</h2>
          <div className="harness__stats">
            <span>不出现「卡中卡」</span>
          </div>
        </div>
        <div className="sceneMock" data-testid="scene-mock">
          <p className="sceneMock__title">第三夜 · 灯下造册</p>
          <p className="sceneMock__meta">1937 年 10 月 28 日 · 上海 · 四行仓库底楼</p>
          <SceneBeats
            key={`flat-${resetKey}-${reduceMode}`}
            className="beats--flat"
            paragraphs={SEVEN}
            reduceMotion={reduce}
            footer={(done) => <FakeChoices done={done} />}
          />
        </div>
      </section>

      <footer className="harness__foot">
        组件不依赖 App.tsx / styles.css / audio.ts：音效走 <code>onSound('paper' | 'ink')</code>，选项区走
        <code> footer(done)</code>，整页背景走 <code>onBeatChange(mood)</code>。
        <br />
        纯函数挂在 <code>window.__BEATS__</code>（分组 / 判词 / 切长段 / fixtures），方便脚本直接断言。
      </footer>
    </div>
  )
}

const host = document.getElementById('harness-root')
if (!host) throw new Error('缺少 #harness-root')

// 调试入口：只在验证页暴露，组件本身不挂任何 window
const api: Record<string, unknown> = {
  groupParagraphs,
  classifyBeat,
  splitLongParagraph,
  buildBeats,
  genderOf,
  paragraphHasPerson,
  fixtures: { seven: SEVEN, long: LONG, four: FOUR, samples: SAMPLES },
}
;(window as unknown as Record<string, unknown>).__BEATS__ = api

// ?appcss=1 时把 App 的全局 styles.css 以 <link> 挂上，模拟真实接入环境的样式污染。
// 用 link 而不是 import：styles.css 不在这个组件的依赖里，万一它暂时不在（别的分支/重构中途），
// 验证页只是少一层全局样式，不会整个白屏。
// 注意：文件不存在时 dev server 会回 SPA 的 index.html（200 + text/html），
// 所以必须用 link.sheet 判断「真的解析成了样式表」，不能只看 onload。
if (new URLSearchParams(window.location.search).get('appcss') === '1') {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = new URL('../src/styles.css', import.meta.url).href
  link.addEventListener('load', () => {
    const sheet = link.sheet as CSSStyleSheet | null
    document.body.dataset.appcss = sheet && sheet.cssRules.length > 0 ? '1' : 'missing'
  })
  link.addEventListener('error', () => {
    document.body.dataset.appcss = 'missing'
  })
  document.head.append(link)
}

createRoot(host).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
