/**
 * SceneHotspots —— 「一张背景图 + 图上散布的可交互热点」
 *
 * 为什么是它：真 3D 场景只能转视角，交互太弱。把 Scene3D 渲染成静态背景图
 * （tools/render-scene-bg.mjs，1920×1080 JPG），再把注意力交给图上的热点：
 * 未发现是微弱墨点，悬停扩散成墨圈 + 标签，点击从底部滑出窄卡，已发现变淡金小印点。
 *
 * 视觉：
 *  - 背景图 object-fit: cover 铺满，上面一层墨色/暗角 grade 保护白字可读性；
 *  - 指针移动 ±8px 视差：背景 1.0 倍、热点层 0.45 倍（两层不同幅度 → 一点纵深）；
 *  - 未发现热点呼吸 opacity 6%—14%，不刺眼；悬停/聚焦扩散成墨圈，标签在点上方（最多两行）；
 *  - 已发现换成淡金色小印点；计数「已发现 n / N」在左上角，全发现后角落出现「都看过了」。
 *
 * 交互与可访问性：
 *  - 热点是真实 <button>，aria-label = label，Tab 顺序即 DOM 顺序，焦点可见；
 *  - Enter/Space 打开窄卡（原生 button 行为），Esc 关窄卡，再 Esc 退出；
 *  - reduceMotion 去掉视差与呼吸动画；≤480px 热点点击区 38px，窄卡改底部通栏。
 *
 * 文案纪律：body 只写环境/物件旁白，1—2 句，不写新剧情、不改结局、不新增史实断言；
 * 只有把握对得上的热点才挂 sourceId，且必须是 status: 'verified' 的史料卡。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './sceneHotspots.css'

export type SceneHotspotsVariant = 'warehouse-int' | 'warehouse-ext' | 'rooftop' | 'bridge' | 'office-1947'

export type Hotspot = {
  id: string
  label: string
  /** 相对容器宽度的百分比（0—100），点中心对准物件 */
  xPct: number
  /** 相对容器高度的百分比（0—100） */
  yPct: number
  /** 环境旁白，1—2 句，一句 20—45 字 */
  body: string
  /** 已核史料卡 id（sources.ts / sources.auto.ts 里 status === 'verified'） */
  sourceId?: string
}

export type SoundCue = 'ink' | 'paper' | 'thud'

type Props = {
  variant: SceneHotspotsVariant
  hotspots: Hotspot[]
  /** 点了窄卡里的「查看史料卡」 */
  onOpenSource?: (sourceId: string) => void
  onSound?: (cue: SoundCue) => void
  onExit: () => void
  reduceMotion?: boolean
}

/** 视差幅度：背景 ±8px，热点层 0.45 倍（不同幅度才有纵深） */
const PARALLAX_BG = 8
const PARALLAX_FG = 3.6

/** 背景图目录：与 vite base:'./' 兼容，不以斜杠开头 */
const BASE = import.meta.env.BASE_URL ?? './'

export const SCENE_BG_SRC = (variant: SceneHotspotsVariant): string => `${BASE}scene-bg/${variant}.jpg`

/**
 * 热点数据（五景 22 处）。
 *
 * 数据放这里只是为了让「组件 + 数据」一次交付、且不改动 content 目录；
 * 接入正式流程时可以整块搬去 src/game/content/sceneHotspots.ts，组件不用改。
 *
 * xPct / yPct 是按 16:9 背景图（1920×1080）量的百分比，是「容器坐标」：
 * 背景图 object-fit: cover 居中裁切，容器越接近 16:9，点越贴物件。
 *
 * 挂 sourceId 的 10 处全部是 sources.ts / sources.auto.ts 里 status: 'verified' 的卡，
 * 且只挑「这张卡确实说得上这件东西」的：没把握的一律不挂。
 */
export const SCENE_HOTSPOTS: Record<SceneHotspotsVariant, Hotspot[]> = {
  'warehouse-int': [
    {
      id: 'wi-lamp',
      label: '煤油灯',
      xPct: 30.6,
      yPct: 51,
      body: '柱子上挂着一盏煤油灯，铁皮罩子烤出一圈焦黄；灯芯压得很低，光只铺满脚下半步。',
      sourceId: 'auto-b-04',
    },
    {
      id: 'wi-bag',
      label: '沙袋垛',
      xPct: 38.5,
      yPct: 66,
      body: '沙袋码到齐胸高，麻布上落了一层灰；靠外一侧被坐塌过一个窝，还没人来得及拍平。',
    },
    {
      id: 'wi-pillar',
      label: '方柱',
      xPct: 78,
      yPct: 48,
      body: '两排方柱一路撑到顶棚，柱身的灰浆剥落了几块；靠近门口的那几根，下缘被蹭得发亮。',
    },
    {
      id: 'wi-crate',
      label: '木箱',
      xPct: 47.5,
      yPct: 74,
      body: '两只木箱摞在沙袋边上，箱盖的钉子松了一角；侧面用粉笔写过的字，已经擦不干净。',
    },
    {
      id: 'wi-breach',
      label: '西墙破洞',
      xPct: 17.5,
      yPct: 48,
      body: '西墙塌了一角，砖茬露在外面；冷光从破洞斜着进来，在地上摊开一片，边沿很硬。',
    },
  ],
  'warehouse-ext': [
    {
      id: 'we-holes',
      label: '西墙弹孔',
      xPct: 54.2,
      yPct: 39,
      body: '西墙上的弹孔密成一片，大的能塞进拳头；孔口边缘的砖烧成焦黑，摸上去发脆。',
      sourceId: 'auto-e-01',
    },
    {
      id: 'we-gate',
      label: '铁门',
      xPct: 50.4,
      yPct: 75.4,
      body: '底层铁门的两扇门扇都关着，缝里塞过麻布；门轴上的锈迹一直拖到门槛上。',
      sourceId: 's-four-banks',
    },
    {
      id: 'we-cornice',
      label: '檐口',
      xPct: 41,
      yPct: 22.5,
      body: '檐口那一圈水泥抹得比墙身平，雨水在底下冲出几道深色的痕；砖缝里还留着旧灰。',
    },
    {
      id: 'we-sandbag',
      label: '沙袋工事',
      xPct: 24,
      yPct: 77,
      body: '墙脚堆着沙袋工事，麻袋口一律朝内，绳子还没解开；最上面一层被雨压得发硬。',
      sourceId: 'auto-b-03',
    },
  ],
  rooftop: [
    {
      id: 'rt-flag',
      label: '旗面',
      xPct: 65.4,
      yPct: 18,
      body: '旗面是机织布，边角已经抽丝；一鼓风，褶子就从杆子那头一路荡到尾端。',
      sourceId: 'auto-b-05',
    },
    {
      id: 'rt-pole',
      label: '竹竿旗杆',
      xPct: 60.9,
      yPct: 32,
      body: '两根竹竿接起来当旗杆，接口处缠了几圈铁丝；风一紧，能听见竹节互相磕碰。',
      sourceId: 's-flag-raise',
    },
    {
      id: 'rt-parapet',
      label: '女儿墙',
      xPct: 41,
      yPct: 55.5,
      body: '女儿墙只有齐腰高，水泥面上全是踩出来的鞋印；墙头压着半块砖，位置挪过好几次。',
    },
    {
      id: 'rt-beam',
      label: '探照灯方向',
      xPct: 83,
      yPct: 62,
      body: '对岸的探照灯隔一阵扫过来一次，光柱掠过楼顶时，沙袋的影子先动，墙上的白灰跟着亮。',
      sourceId: 'auto-b-06',
    },
  ],
  bridge: [
    {
      id: 'br-rail',
      label: '桥栏',
      xPct: 29.5,
      yPct: 67,
      body: '铁栏的漆掉了大半，横杆上有一道被绳子磨出来的亮痕；摸过去，比看上去要凉。',
      sourceId: 'auto-b-10',
    },
    {
      id: 'br-water',
      label: '河面反光',
      xPct: 88,
      yPct: 70,
      body: '河面上浮着灯影碎成的亮点，风一过就散，过一会儿又慢慢聚回原处。',
    },
    {
      id: 'br-stone',
      label: '湿石板',
      xPct: 44,
      yPct: 86,
      body: '桥面石板被雨浸透，接缝里积着一线水；走快了会打滑，得压着步子过。',
    },
    {
      id: 'br-bank',
      label: '对岸仓库轮廓',
      xPct: 58,
      yPct: 48,
      body: '对岸那片楼在雾里只剩轮廓，窗户一扇一扇都是黑的；只有最东头亮着一格。',
      sourceId: 'auto-e-04',
    },
  ],
  'office-1947': [
    {
      id: 'of-inkstone',
      label: '缺角砚台',
      xPct: 65.3,
      yPct: 61.5,
      body: '砚台缺了一角，余墨干在池底；边上有一圈洗不掉的墨痕，比桌面深一个色。',
    },
    {
      id: 'of-paper',
      label: '毛边纸',
      xPct: 47,
      yPct: 61,
      body: '一叠毛边纸，纸边裁得不齐；最上面那张写了几行又划掉，墨还没干透。',
    },
    {
      id: 'of-lattice',
      label: '窗棂',
      xPct: 58.5,
      yPct: 51,
      body: '窗棂是四格的杉木，窗纸糊了两层；外层边角被风掀起，后来又用浆糊按了回去。',
    },
    {
      id: 'of-lamp',
      label: '吊灯',
      xPct: 83,
      yPct: 15,
      body: '吊灯的灯罩是铁皮的，内侧熏黑，绳子上系了个结，把灯压到刚好照见桌面的高度。',
    },
    {
      id: 'of-ledger',
      label: '旧册子',
      xPct: 28,
      yPct: 53.5,
      body: '柜上摞着几本旧册子，脊上的墨字褪成灰黄；最下面那本受了潮，书角卷起来。',
      sourceId: 's-49',
    },
  ],
}

export default function SceneHotspots({ variant, hotspots, onOpenSource, onSound, onExit, reduceMotion = false }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [found, setFound] = useState<string[]>([])
  const [burst, setBurst] = useState<{ id: string; n: number } | null>(null)
  const [bgFailed, setBgFailed] = useState(false)
  const burstSeq = useRef(0)

  const open = useMemo(() => hotspots.find((item) => item.id === openId) ?? null, [hotspots, openId])
  const foundCount = found.length
  const allFound = hotspots.length > 0 && foundCount === hotspots.length

  /* 视差：指针在容器内的归一化位置 × ±8px。位移写进 CSS 变量，
     背景与热点层各自按自己的变量 translate，幅度不同 → 有纵深。 */
  useEffect(() => {
    const host = hostRef.current
    if (!host || reduceMotion) return
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) return

    let raf = 0
    let nx = 0
    let ny = 0

    const apply = () => {
      raf = 0
      host.style.setProperty('--sh-bgx', `${(nx * PARALLAX_BG).toFixed(2)}px`)
      host.style.setProperty('--sh-bgy', `${(ny * PARALLAX_BG).toFixed(2)}px`)
      host.style.setProperty('--sh-fgx', `${(nx * PARALLAX_FG).toFixed(2)}px`)
      host.style.setProperty('--sh-fgy', `${(ny * PARALLAX_FG).toFixed(2)}px`)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      nx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2))
      ny = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2))
      schedule()
    }
    const onLeave = () => {
      nx = 0
      ny = 0
      schedule()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    host.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [reduceMotion])

  /* Esc：先关窄卡，再按一次退出。挂 window 上——焦点落在卡里的按钮时也要生效。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (openId !== null) {
        event.stopPropagation()
        setOpenId(null)
        return
      }
      onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, onExit])

  const close = useCallback(() => {
    setOpenId(null)
    onSound?.('paper')
  }, [onSound])

  const toggle = useCallback(
    (hotspot: Hotspot) => {
      if (openId === hotspot.id) {
        setOpenId(null)
        onSound?.('paper')
        return
      }
      setOpenId(hotspot.id)
      setFound((prev) => (prev.includes(hotspot.id) ? prev : [...prev, hotspot.id]))
      burstSeq.current += 1
      setBurst({ id: hotspot.id, n: burstSeq.current })
      onSound?.('ink')
    },
    [onSound, openId],
  )

  return (
    <div
      ref={hostRef}
      className="sh"
      data-variant={variant}
      data-reduce={reduceMotion ? '1' : '0'}
      data-bg={bgFailed ? 'fail' : 'ok'}
      style={{ '--sh-bgx': '0px', '--sh-bgy': '0px', '--sh-fgx': '0px', '--sh-fgy': '0px' } as CSSProperties}
    >
      <div className="sh-bgwrap" aria-hidden="true">
        {bgFailed ? null : (
          <img
            className="sh-bg"
            src={SCENE_BG_SRC(variant)}
            alt=""
            draggable={false}
            decoding="async"
            onError={() => setBgFailed(true)}
          />
        )}
      </div>
      <div className="sh-grade" aria-hidden="true" />

      <button type="button" className="sh-exit" onClick={onExit}>
        返回正文
      </button>

      <p className="sh-count" aria-live="polite">
        已发现 <span className="sh-count-n">{foundCount}</span> / {hotspots.length}
      </p>
      {allFound ? <p className="sh-done">都看过了</p> : null}

      <div className="sh-fg">
        {hotspots.map((hotspot) => {
          const isOpen = openId === hotspot.id
          const isFound = found.includes(hotspot.id)
          return (
            <button
              key={hotspot.id}
              type="button"
              className="sh-dot"
              style={{ left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%` }}
              aria-label={hotspot.label}
              aria-expanded={isOpen}
              data-found={isFound ? '1' : '0'}
              data-hotspot={hotspot.id}
              onClick={() => toggle(hotspot)}
            >
              <span className="sh-spot" aria-hidden="true" />
              {!reduceMotion && burst && burst.id === hotspot.id ? (
                <span className="sh-ripple" key={burst.n} aria-hidden="true" />
              ) : null}
              <span className="sh-label" aria-hidden="true">
                {hotspot.label}
              </span>
            </button>
          )
        })}
      </div>

      {open ? (
        <aside className="sh-card" role="group" aria-label={`${open.label}：环境旁白`}>
          <p className="sh-card-label">{open.label}</p>
          <p className="sh-card-body">{open.body}</p>
          <div className="sh-card-foot">
            {open.sourceId && onOpenSource ? (
              <button type="button" className="sh-card-src" onClick={() => onOpenSource(open.sourceId as string)}>
                查看史料卡
              </button>
            ) : null}
            <button type="button" className="sh-card-close" onClick={close}>
              关闭
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
