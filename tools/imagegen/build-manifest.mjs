#!/usr/bin/env node
/**
 * build-manifest.mjs — 《把名字留下来》500 张生成图总谱生成器
 *
 * 从章节场景表（src/game/content/*.ts）＋ 手写视觉数据表生成：
 *   docs/art/image-manifest.json   500 条总谱（可直接喂 gen.py；字段见 visual-bible §9）
 *   docs/art/batches/batch-###.json 每 50 条一批，gen.py --batch 可直接吃
 *
 * 用法：
 *   node tools/imagegen/build-manifest.mjs --v0        # v0 60 条（首跑用）
 *   node tools/imagegen/build-manifest.mjs             # 全量 + 分批
 *   node tools/imagegen/build-manifest.mjs --limit 60  # 只取前 N 条
 *   node tools/imagegen/build-manifest.mjs --no-batches
 *   node tools/imagegen/build-manifest.mjs --check     # 只校验已有数据表
 *
 * 纪律：本脚本不碰 GPU、不生成图片；prompt 已含统一尾缀，negative 已合并红线词表。
 * 视觉规则见 docs/art/visual-bible.md。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const ART_DIR = path.join(ROOT, 'docs/art')
const CONTENT_DIR = path.join(ROOT, 'src/game/content')
const MANIFEST_PATH = path.join(ART_DIR, 'image-manifest.json')
const BATCH_DIR = path.join(ART_DIR, 'batches')

// --------------------------------------------------------------------------- //
// 视觉常量（与 visual-bible §7 §8 逐字一致；改这里必须同步改那份文档）
// --------------------------------------------------------------------------- //
// SDXL CLIP 上限 77 token（含 BOS/EOS）。image-runner 实测：超过 77 从**末尾**截断，
// 所以风格词必须放最前面（Lead / QUEUE.md 硬约束），目标总 token ≤70。
//
// r2 修正（2026-10-21 抽查 scene-001..003 后）：
//   实测 guidance=0 时 gen.py 不传 negative（CFG 关闭），仅靠末尾 "no people" 约束太弱，
//   scene-002 出清晰人脸、scene-003 出人群。改为：风格词后**紧跟类别护栏**（空场/静物/剪影锚点前置），
//   并在风格前缀加 "warm sepia" 锚定 public/bg 基准图的暖色调。
const STYLE_PREFIX =
  'cinematic film still, 1937 China, muted desaturated warm sepia palette, volumetric haze, painterly realism'

/**
 * 时代中性前缀：卷零（1947）与卷四（1950—2025 记忆线）不能用 "1937 China"，
 * 否则 1982 录音机 / 2015 纪念馆会被拉回 1937。调色、雾、画风三项保持一致。
 */
const STYLE_PREFIX_ERA_NEUTRAL =
  'cinematic film still, China, muted desaturated warm sepia palette, volumetric haze, painterly realism'

/**
 * 类别护栏：紧跟在风格前缀之后（CLIP 中越靠前权重越高）。
 * 这是 guidance=0 时唯一有效的"红线防线"——不能用 negative 兜底。
 */
const GUARD = {
  scene: 'empty scene, no people, no faces, no text',
  moment: 'hands and objects only, no faces, no text',
  artifact: 'top down flat lay, blurred writing, no people',
  figure: 'lone silhouette from behind, no face, no text',
  ending: 'empty scene, no people, no text',
  ui: 'flat surface texture, no people, no text',
  atmo: 'empty scene, no people, no text',
}

/**
 * prompt 总 token 上限（**估算值**）。
 * Lead 2026-10-21 实测：估算比 CLIP tokenizer 低约 4—7 token，故目标压到估算 ≤66，保真实 ≤72。
 */
const PROMPT_TOKEN_MAX = 66

const NEG_BASE =
  'blurry, lowres, jpeg artifacts, watermark, text, logo, signature, cartoon, anime, 3d render, plastic skin, extra limbs, deformed, modern buildings, neon signs, cars, power lines, oversaturated'

const NEG_HARD =
  'english letters, latin letters, chinese characters, calligraphy, legible text, printed words, numbers, faces, eyes, portrait, crowd, modern clothing, nylon, plastic, ballpoint pen, wristwatch, glasses, skyscraper, ferris wheel, motorcycle, airplane, fluorescent light, modern elements, emoji, flag emblem, star emblem, sun emblem, military insignia, rising sun flag, corpse, blood splatter, gore, violence'

const NEG_EXTRA = {
  scene: 'people, person, figures',
  moment: 'crowd, many hands',
  artifact: 'sharp text, legible handwriting, book cover title',
  figure: 'front view, face, eyes, portrait, closeup of face',
  ending: 'people, person, crowd',
  ui: 'figures, people, subject',
  atmo: 'people, person',
}

/** 类别 → 配额 / 尺寸。合计 500（scene 128 + moment 100 + artifact 80 + figure 60 + ending 30 + ui 60 + atmo 42）。 */
const CATEGORIES = {
  scene: { quota: 128, width: 1024, height: 576 },
  moment: { quota: 100, width: 1024, height: 576 },
  artifact: { quota: 80, width: 1024, height: 576 },
  figure: { quota: 60, width: 768, height: 1024 },
  ending: { quota: 30, width: 1024, height: 576 },
  ui: { quota: 60, width: 1024, height: 1024 },
  atmo: { quota: 42, width: 1024, height: 576 },
}
const CATEGORY_ORDER = ['scene', 'moment', 'ending', 'atmo', 'artifact', 'figure', 'ui']
const TOTAL_TARGET = 500

/**
 * v0 首跑分布：60 条。按 image-runner 的出图优先级排序（scene/moment 先出，
 * artifact/figure/ui 后出），故 v0 以 scene+moment 为主体，其余类别各留少量做管线验证。
 */
const V0_DIST = { scene: 18, moment: 10, ending: 6, atmo: 6, artifact: 8, figure: 6, ui: 6 }

const STEPS = 4
const GUIDANCE = 0
const RETRY_SEED_OFFSETS = [0, 1000, 2000]

// --------------------------------------------------------------------------- //
// 数据表
// --------------------------------------------------------------------------- //
/** 场景插画：128 条对应卷零—卷五的 128 个新场景。id = 场景 id，zh = 用途说明。 */
const SCENE_BEATS = [
  // ——— 卷零 1947 冬 · 造册前夜（8）———
  {
    id: 'v0-01',
    zh: '卷零：毛边纸被推过桌面，炭盆将熄，造册开始',
    en: 'Interior of a Chinese county government side room in winter 1947, dim daylight through paper lattice windows, a bare wooden table with a stack of rough edged paper sheets pushed to the near edge, an inkstone and a brush, a dying charcoal brazier casting the only warm glow, one empty wooden chair, wide establishing shot',
  },
  {
    id: 'v0-02',
    zh: '卷零：左襟夹层里的半本册子，纸硬得像薄木板',
    en: 'A dark padded jacket laid open on a wooden chair, a thin worn paper booklet sewn inside the lining, the paper stiff and stained dark, coarse needle and thread still in place, cold winter side light, close still life',
  },
  {
    id: 'v0-03',
    zh: '卷零：雪后通城老街，一行跛脚的脚印',
    en: 'Snow covered stone street of a small Chinese county town in 1947, thin ice on the flagstones, a single set of footprints and a walking stick mark leading away, low winter sun behind roof eaves, wooden shopfronts, wide shot',
  },
  {
    id: 'v0-04',
    zh: '卷零：火塘边三个老兵的口述，空凳子还在',
    en: 'Interior of a poor village room in 1947, an earthen brazier, three rough porcelain bowls on a low table, a teapot, a notebook and a pencil, warm firelight from below, smoke in the air, three empty stools, low angle',
  },
  {
    id: 'v0-05',
    zh: '卷零：县中学旧教室，核对名字的那张桌子',
    en: 'Old school classroom in a Chinese county town, 1947 winter, rows of worn wooden desks, a teacher desk with brush, ink and a stack of draft paper, dust in the window light, blackboard out of focus, wide shot',
  },
  {
    id: 'v0-06',
    zh: '卷零：蘸水抹平脆纸的折角，灯在右边',
    en: 'Extreme close view of brittle aged paper pages of a small booklet, creased and darkened edges, a wet brush tip smoothing a crease, ink stone beside it, lamplight from the right, shallow depth of field',
  },
  {
    id: 'v0-07',
    zh: '卷零：窗棂结霜，屋里灯还亮着，扫帚靠在墙边',
    en: 'Frost covered paper lattice window of a 1947 county office at night, warm lamp glow inside, a straw broom leaning against the wall below, a woven basket, snow piled on the outer sill, no people',
  },
  {
    id: 'v0-08',
    zh: '卷零：县志木箱、蓝布与册子放进去前的一瞬',
    en: 'An open wooden document chest on a table, a folded blue cloth and a thin paper booklet about to be placed inside, snow light from the window, dust motes in the air, close overhead view',
  },

  // ——— 卷一 1937.8—10 · 通城整编、开拔、初到上海（25）———
  {
    id: 'v1-01',
    zh: '卷一：通城祠堂前坪，点名的八仙桌与枪架',
    en: 'Village ancestral hall courtyard in Tongcheng, late summer 1937, a square wooden table at the center with a roster book and a brush, rifles stacked in a tripod nearby, cloth shoes lined up along the stone step, harsh noon light on packed earth',
  },
  {
    id: 'v1-02',
    zh: '卷一：祠堂里摆开的灰军装，光从门里进来',
    en: 'Interior of a Chinese ancestral hall in 1937, ancestral tablets in deep shadow, a row of grey cotton uniforms laid out on benches, cloth caps, straw sandals, a rifle leaning against a red pillar, one shaft of light through the door',
  },
  {
    id: 'v1-03',
    zh: '卷一：造花名册，毛笔落笔，油灯照着',
    en: 'Close view of a brush writing on a lined roster book by oil lamp light, a hand only at the edge of frame, ink pot and water bowl, night, shallow depth of field, the writing blurred and illegible',
  },
  {
    id: 'v1-04',
    zh: '卷一：母亲塞进包袱的布鞋，鞋里还夹着字条',
    en: 'Worn cloth shoes tied together with string and a folded paper slip tucked into one shoe, set on a stone doorstep, early morning light, a cloth bundle beside them, close shot',
  },
  {
    id: 'v1-05',
    zh: '卷一：通城河边码头，开拔的清晨，雾还没散',
    en: 'River wharf in a small Chinese town, early autumn 1937 dawn, mist on the water, wooden boats moored, heavy rope and a gangplank, footprints on wet stone, wide shot',
  },
  {
    id: 'v1-06',
    zh: '卷一：山道行军，草鞋印与低光',
    en: 'A mountain road in southern China, autumn 1937, a column route implied by trampled grass and dust haze, straw sandal prints in the mud, low sun through pines, mist between ridges, wide shot',
  },
  {
    id: 'v1-07',
    zh: '卷一：宿营祠堂，地铺稻草与一支烛',
    en: 'Interior of a temple used as a temporary barracks, autumn 1937, straw laid on the stone floor, woven mats, rifles stacked against the altar, cobwebs in the beams, a single candle, wide shot',
  },
  {
    id: 'v1-08',
    zh: '卷一：夜里的站台，闷罐车只是一道轮廓',
    en: 'Railway platform at night, 1937, a boxcar in the far distance only in silhouette, steam and smoke under a single dim lamp, rails reflecting light, empty platform, wide shot',
  },
  {
    id: 'v1-09',
    zh: '卷一：苏州站台边的干粮与黄昏',
    en: 'Trackside in the Yangtze delta, autumn 1937 dusk, soldiers empty canteens and a mess tin on the gravel, a bundle of straw, field ridges and a distant water tower, golden haze, low angle',
  },
  {
    id: 'v1-10',
    zh: '卷一：初到上海，租界雨夜的铁轨反光',
    en: 'Rainy night street in the Shanghai foreign concession, 1937, wet stone pavement reflecting a single dim street lamp, iron railings, a tram rail curving away into fog, shopfront signs blurred out of focus, wide shot',
  },
  {
    id: 'v1-11',
    zh: '卷一：从南岸望四行仓库，阴天，河面有雾',
    en: 'A massive concrete warehouse block seen across a river from the far bank, overcast 1937 autumn sky, low industrial buildings, wooden piles and mooring rope in the foreground, wide establishing shot',
  },
  {
    id: 'v1-12',
    zh: '卷一：仓库底楼齐集，煤油灯下的名册桌',
    en: 'Ground floor of a concrete warehouse at night, plaster dust footprints on the floor, a wooden table with a roster book under a kerosene lantern, sandbags along the wall, deep receding space',
  },
  {
    id: 'v1-13',
    zh: '卷一：沙袋掩体只堆了一半，铁锹还插在沙里',
    en: 'A half built sandbag barricade, a shovel stuck in spilled sand, coarse burlap texture, dim work light on concrete, close wide shot',
  },
  {
    id: 'v1-14',
    zh: '卷一：铁门焊死，焊渣还冒着烟',
    en: 'An iron door sealed by rough weld beads, sparks and smoke still hanging in the air, a welder torch laid on the floor, harsh rim light, close shot',
  },
  {
    id: 'v1-15',
    zh: '卷一：剪断的电线，断口露出铜丝',
    en: 'Iron shears cutting a thick cloth wrapped cable, frayed copper strands at the cut, dust on a concrete ledge, close shot',
  },
  {
    id: 'v1-16',
    zh: '卷一：楼梯口的机枪位，弹壳落在台阶上',
    en: 'A machine gun barrel resting on sandbags at the top of a concrete staircase, empty shell casings scattered on the steps, dim light from below, low angle',
  },
  {
    id: 'v1-17',
    zh: '卷一：弹药箱上的名册与墨，夜里造的册',
    en: 'A small thread bound booklet, brush and ink pot on an ammunition crate, a folded blanket beside it, kerosene lantern light, deep shadows, close overhead view',
  },
  {
    id: 'v1-18',
    zh: '卷一：窗台上补到一半的布鞋，锥子还在',
    en: 'A pair of worn cloth shoes half mended on a windowsill, needle and coarse thread, a broken awl, late afternoon light, close shot',
  },
  {
    id: 'v1-19',
    zh: '卷一：米袋堆里露出一角册子',
    en: 'Stacks of rice sacks in a warehouse corner, one sack open with a paper booklet tucked inside, coarse burlap fibers, hard side light, wide shot',
  },
  {
    id: 'v1-20',
    zh: '卷一：野战电话与绕线的木箱',
    en: 'A black field telephone with a hand crank on a wooden crate, coiled cloth insulated wire, dust, dim interior light, close shot',
  },
  {
    id: 'v1-21',
    zh: '卷一：租界边界的铁丝网与沙袋，夜里一盏灯',
    en: 'Barbed wire entanglement and sandbag posts along a concession boundary at night, wet street, one dim street lamp, fog, wide shot',
  },
  {
    id: 'v1-22',
    zh: '卷一：楼顶观察哨，竹梯、望远镜、弹壳',
    en: 'A rooftop observation post of a concrete warehouse, bamboo ladder, binoculars on the parapet, spent shell casings, drifting smoke, wide shot',
  },
  {
    id: 'v1-23',
    zh: '卷一：包扎所一角，绷带与石灰桶',
    en: 'A corner of a warehouse used as a dressing station, rolls of cloth bandage, a bucket of lime powder, a wooden stretcher against the wall, single bulb light, close wide shot',
  },
  {
    id: 'v1-24',
    zh: '卷一：夜袭警报，探照灯扫过水泥墙',
    en: 'Dark warehouse interior during an air raid, a pale searchlight beam sweeping across the concrete wall through a high window, dust in the beam, deep shadows',
  },
  {
    id: 'v1-25',
    zh: '卷一：天亮前的仓库轮廓，一扇窗还亮着',
    en: 'The warehouse block before dawn seen across the river, river mist, a single lit window high up, blue grey hour, wide shot',
  },
  {
    id: 'v2-01',
    zh: '卷二：凌晨三点齐集，枪架与名册桌',
    en: 'Concrete warehouse floor at three in the morning, sleeping mats rolled and stacked, rifles in tripods, one kerosene lamp on a table with a roster book, deep shadow',
  },
  {
    id: 'v2-02',
    zh: '卷二：灯下的名册与钢笔，谢晋元刚离开',
    en: 'A kerosene lamp on a crate beside an open roster book and a fountain pen, a folded map, long shadows on concrete, night, close shot',
  },
  {
    id: 'v2-03',
    zh: '卷二：一行行被划掉的名字，笔还搁在页上',
    en: 'A column of handwritten names crossed out one by one in faded ink, a brush resting on the page, lamplight from the left, extreme close view',
  },
  {
    id: 'v2-04',
    zh: '卷二：缝进衣襟的针脚，纸边露在外头',
    en: 'Coarse stitches through grey cotton lining with a paper edge showing at the seam, needle still in the thread, warm lamplight, extreme close view',
  },
  {
    id: 'v2-05',
    zh: '卷二：灯泡碎了，只剩对岸透进来的一点光',
    en: 'A broken light bulb on a concrete floor, glass shards scattered, faint distant glow through a window, dark interior, low angle',
  },
  {
    id: 'v2-06',
    zh: '卷二：二楼铁柜半开，钥匙挂在锁上',
    en: 'A grey iron cabinet half open, a key on a cord hanging from the lock, ledger shelves inside, dim light, close shot',
  },
  {
    id: 'v2-07',
    zh: '卷二：墙根下的家书，铅笔头压在信上',
    en: 'A half written letter on folded newspaper on the concrete floor, a pencil stub on top, rifle stock shadow along the wall, dim light, overhead close',
  },
  {
    id: 'v2-08',
    zh: '卷二：报纸当桌面，信封摊在一旁',
    en: 'A newspaper page used as a writing surface on a wooden crate, an envelope and tin cup beside it, dim lantern light, close overhead',
  },
  {
    id: 'v2-09',
    zh: '卷二：三十七封信捆成两扎，墨瓶在旁边',
    en: 'Bundles of folded letters tied with hemp string on a wooden crate, ink bottle beside them, dim warm light, close shot',
  },
  {
    id: 'v2-10',
    zh: '卷二：名册页卷成细筒，半截已进竹篙',
    en: 'A hollow bamboo pole leaning on a concrete wall, a rolled paper slip half pushed into its split end, bamboo fibers, dim light, close shot',
  },
  {
    id: 'v2-11',
    zh: '卷二：雨夜的桥，桥栏上没人了',
    en: 'A wet bridge at night in rain, iron railing beaded with water, distant lamplight in fog, an abandoned wooden handcart at the far end, wide shot',
  },
  {
    id: 'v2-12',
    zh: '卷二：南岸救护站，账本与绷带',
    en: 'A field dressing station on the south bank, stacked supply crates, a table with cloth bandages and an open ledger, a folded stretcher, dim lamplight, wide shot',
  },
  {
    id: 'v2-13',
    zh: '卷二：桥头的包袱与手帕，人在别处等',
    en: 'A bridge head at dawn, a cloth bundle and a folded handkerchief left on the stone railing, fog over the river, wide shot',
  },
  {
    id: 'v2-14',
    zh: '卷二：墨水在湿纸上洇开，字变得很胖',
    en: 'A paper page with ink spreading through wet fibers, a brush beside it, lamplight, extreme close view',
  },
  {
    id: 'v2-15',
    zh: '卷二：墙根的烟与塌下来的灰泥',
    en: 'Heavy smoke and dust rising along the base of a concrete warehouse wall, fallen plaster and rubble, a broken window frame, low sun cutting through the haze, wide shot',
  },
  {
    id: 'v2-16',
    zh: '卷二：墙被炸开的洞，钢筋翘着',
    en: 'A jagged breach blasted through a concrete wall, exposed bent rebar, rubble and thin smoke, daylight beyond the hole, close wide shot',
  },
  {
    id: 'v2-17',
    zh: '卷二：帆布带与手榴弹，一张纸片在旁边',
    en: 'A canvas belt and several stick grenades laid out on a concrete floor, a folded paper slip beside them, cold side light, overhead close view',
  },
  {
    id: 'v2-18',
    zh: '卷二：五楼窗口空了，纸片被风顶在框上',
    en: 'An open fifth floor window of a warehouse, torn paper scraps caught against the frame, smoke outside, dust hanging in the air, wide shot',
  },
  {
    id: 'v2-19',
    zh: '卷二：敢死队的短名单，墨还没干',
    en: 'A short list of names in blurred wet ink on a torn paper scrap, a pencil beside it, concrete surface, hard side light, extreme close view',
  },
  {
    id: 'v2-20',
    zh: '卷二：送旗的包袱，湿着放在河石上',
    en: 'A small cloth bundle tied with string, soaked and dripping, set on wet stones at the river edge, night, close shot',
  },
  {
    id: 'v2-21',
    zh: '卷二：小旗摊在水泥地上，针脚看得清',
    en: 'A small red cloth flag with rough hand stitched edges laid flat on grey concrete, no emblem, soft daylight, overhead close view',
  },
  {
    id: 'v2-22',
    zh: '卷二：大旗与两根竹竿靠在墙上',
    en: 'A folded red cloth and two long bamboo poles leaning against a concrete wall, string and rope coiled below, daylight, wide shot',
  },
  {
    id: 'v2-23',
    zh: '卷二：两根竹竿被绑腿布缠在一起',
    en: 'Two bamboo poles lashed together with strips of grey puttee cloth, rough knots, dawn haze behind, close shot',
  },
  {
    id: 'v2-24',
    zh: '卷二：旗绳不够长，接了一段绑腿',
    en: 'A thin flag rope tied to a strip of grey cloth, knot at the joint, wind blowing the loose end, warehouse rooftop edge, close shot',
  },
  {
    id: 'v2-25',
    zh: '卷二：二十九日清晨，楼顶逆光的旗只是布',
    en: 'Rooftop at dawn, a red cloth flag on a bamboo pole backlit, only a fabric silhouette against a smoke filled sky, no emblem, low angle',
  },
  {
    id: 'v2-26',
    zh: '卷二：南岸堤上的帽子和小旗，人都仰着头',
    en: 'South bank embankment at dawn, a fallen cloth cap and a small folded paper flag on the wet ground, mist over the river, wide shot',
  },
  {
    id: 'v2-27',
    zh: '卷二：炮弹落在楼顶，旗杆歪了又立直',
    en: 'Smoke and dust erupting across a warehouse rooftop, a bamboo flag pole leaning, debris in the air, dramatic backlight, wide shot',
  },
  {
    id: 'v2-28',
    zh: '卷二：楼顶的女儿墙，旗绳还系着',
    en: 'Rooftop parapet with a rope tied to a flag pole base, empty, smoke drifting past, distant river below, wide shot',
  },
  {
    id: 'v2-29',
    zh: '卷二：南岸窗台上的望远镜与折叠相机',
    en: 'A pair of binoculars and a folding bellows press camera on a windowsill overlooking the river, a notepad, dusk light, wide shot',
  },
  {
    id: 'v2-30',
    zh: '卷二：街角报摊，头版只剩黑色大块',
    en: 'A newsstand on a Shanghai street corner, stacks of newspapers with headline blocks blurred out of focus, a wooden stool, morning light, close shot',
  },
  {
    id: 'v2-31',
    zh: '卷二：市民扔过来的烟、饼干、小旗，落在湿石板上',
    en: 'Cigarette packets, biscuits and a small folded cloth flag scattered on wet stone paving near a river railing, night, close shot',
  },
  {
    id: 'v2-32',
    zh: '卷二：慰问信和包裹堆在河岸栏边',
    en: 'Stacks of wrapped packages and letters piled against a river railing, rope, dim lamplight, wide shot',
  },
  {
    id: 'v2-33',
    zh: '卷二：夜里的河面，小船和竹筏靠过来',
    en: 'Dark river at night, several small wooden boats and bamboo rafts faintly visible in mist, oars and poles, distant lamplight, wide shot',
  },
  {
    id: 'v2-34',
    zh: '卷二：名单压在桥栏石上，人刚走',
    en: 'A folded paper pinned under a stone on a wet bridge railing, raindrops, night, a matchbox beside it, close shot',
  },
  {
    id: 'v2-35',
    zh: '卷二：铅笔搁在水泥台上，笔尖朝外',
    en: 'A pencil resting on a concrete ledge overlooking the river, fine dust and a folded note beside it, late light, extreme close view',
  },
  {
    id: 'v2-36',
    zh: '卷二：记者的笔记本摊在窗台上，字全糊了',
    en: 'An open reporters notebook with blurred pencil marks on a windowsill, binoculars beside it, dusk, close shot',
  },
  {
    id: 'v2-37',
    zh: '卷二：仓库门口的十一个人，只剩脚印',
    en: 'Eleven sets of footprints in dust in front of a warehouse door, tripod marks between them, late afternoon light, wide shot',
  },
  {
    id: 'v2-38',
    zh: '卷二：照片背面的钢笔字，墨迹停在半句',
    en: 'The back of a small photograph with blurred pen marks, a pen on the table, lamp light, extreme close view',
  },
  {
    id: 'v2-39',
    zh: '卷二：通城同乡会馆，桌上一杯凉茶',
    en: 'Interior of a Tongxiang guild hall, a long wooden table with a ledger, a cup of cold tea, a hanging scroll blurred, dim light, wide shot',
  },
  {
    id: 'v2-40',
    zh: '卷二：纸卷的传声筒搁在窗台上',
    en: 'A megaphone rolled from rough paper on a concrete windowsill, dust, river view beyond, close shot',
  },
  {
    id: 'v2-41',
    zh: '卷二：撤退令摊在弹药箱上，灯压着纸角',
    en: 'A folded order paper on an ammunition crate under a lamp, a pencil across the corner, deep shadows, night, overhead close view',
  },
  {
    id: 'v2-42',
    zh: '卷二：仓库门口的道，地上的马灯',
    en: 'A warehouse doorway at night, a lantern set on the ground, the wooden door propped open with a sandbag, rain beyond, wide shot',
  },
  {
    id: 'v2-43',
    zh: '卷二：墙根一副担架，拐杖斜靠着',
    en: 'A rolled stretcher and a single crutch leaning against a concrete wall, dim light, dust, close shot',
  },
  {
    id: 'v2-44',
    zh: '卷二：凌晨的桥，路中间一只丢下的布鞋',
    en: 'The bridge in rain at three in the morning, abandoned gear and a single dropped cloth shoe on the wet road, fog beyond, wide shot',
  },
  {
    id: 'v2-45',
    zh: '卷二：黎明租界院子里缴下来的枪堆',
    en: 'A pile of rifles stacked in a courtyard at dawn, grey concrete, thin mist, canvas straps, wide shot',
  },
  {
    id: 'v3-01',
    zh: '卷三：孤军营的铁丝网内，雨后的水泥地',
    en: 'Barbed wire fence enclosing a factory courtyard in the Shanghai concession, wet concrete ground with puddles, a distant guard post, overcast light, wide shot',
  },
  {
    id: 'v3-02',
    zh: '卷三：缴械之后的枪堆，像一堆柴',
    en: 'A pyramid of stacked rifles in a courtyard, canvas straps hanging loose, morning mist, wide shot',
  },
  {
    id: 'v3-03',
    zh: '卷三：铁丝网角的岗亭，门边一盏灯',
    en: 'A small whitewashed guard post at the corner of a wire fence, a lantern beside the door, distant, overcast light, wide shot',
  },
  {
    id: 'v3-04',
    zh: '卷三：营里的纪念日，旗只是天上一块布',
    en: 'A red cloth flag on a bamboo pole against a grey sky inside a fenced courtyard, backlit, no emblem, wide shot',
  },
  {
    id: 'v3-05',
    zh: '卷三：营院里的木台，一只摇铃',
    en: 'A low wooden platform in a factory courtyard, a folding table and a hand bell, barracks behind, overcast light, wide shot',
  },
  {
    id: 'v3-06',
    zh: '卷三：在孤军营重抄名册，纸比从前薄',
    en: 'A thread bound roster book open on a rough table, ink stone, several loose pages under a stone weight, dim window light, close overhead view',
  },
  {
    id: 'v3-07',
    zh: '卷三：木板名字钉在墙上，字看不清了',
    en: 'Small wooden name plaques nailed in rows on a plaster wall, lettering blurred and illegible, dim light, close shot',
  },
  {
    id: 'v3-08',
    zh: '卷三：学字班的黑板，粉笔字擦掉一半',
    en: 'A blackboard with blurred chalk marks half wiped away, worn desks, dust in window light, wide shot',
  },
  {
    id: 'v3-09',
    zh: '卷三：木篮板和一只旧球',
    en: 'A rough wooden basketball backboard on an iron post in a factory courtyard, a worn ball on the ground, overcast light, wide shot',
  },
  {
    id: 'v3-10',
    zh: '卷三：墙根一排布鞋，鞋头朝外',
    en: 'Rows of worn cloth shoes lined up along a whitewashed wall, toes pointing out, dust, afternoon light, close shot',
  },
  {
    id: 'v3-11',
    zh: '卷三：孤军营的雪，1938 年冬',
    en: 'Snow falling in a fenced factory courtyard, a bare tree, tracks in the snow, cold grey light, wide shot',
  },
  {
    id: 'v3-12',
    zh: '卷三：铁丝网外的上海，电车在远处',
    en: 'A street beyond barbed wire seen through the fence, blurred shopfronts and a tram in the distance, rain, wide shot',
  },
  {
    id: 'v3-13',
    zh: '卷三：新年发的一块肥皂、一包烟、一张红纸',
    en: 'A bar of soap, a small paper packet and a folded red paper slip on a wooden stool, dim light, close overhead view',
  },
  {
    id: 'v3-14',
    zh: '卷三：发信的桌子，信按扎排开',
    en: 'A table with stacked letters tied in bundles and a hand bell, bare barracks behind, dim light, wide shot',
  },
  {
    id: 'v3-15',
    zh: '卷三：晒太阳的墙角，草席和一只碗',
    en: 'A worn straw mat and a folded blanket in a sunny corner of a courtyard, a chipped bowl beside, hard afternoon light, close shot',
  },
  {
    id: 'v3-16',
    zh: '卷三：空铺位，草席翻着，稻草散了一地',
    en: 'An empty bunk of straw matting turned over, scattered straw on the floor, a broken stool, dim light, close shot',
  },
  {
    id: 'v3-17',
    zh: '卷三：1941，翻倒的椅子与一顶军帽',
    en: 'A folding chair overturned in a barracks yard, a grey military cap on the ground beside it, dust, low afternoon light, close wide shot',
  },
  {
    id: 'v3-18',
    zh: '卷三：空铺上叠好的被子，一只捆好的包袱',
    en: 'A neatly folded blanket on a bare bunk, a small bundle tied with string beside it, dim light, close shot',
  },
  {
    id: 'v3-19',
    zh: '卷三：院子里的枪架，队列已经空着',
    en: 'A row of empty positions marked by rifles stacked in tripods in a courtyard, grey sky, wide shot',
  },
  {
    id: 'v3-20',
    zh: '卷三：一口盖着白布的薄棺，远远的',
    en: 'A plain wooden coffin covered with a white cloth in a factory courtyard, distant, overcast light, wide shot',
  },
  {
    id: 'v3-21',
    zh: '卷三：解散前夜，草席卷好，绳子捆紧',
    en: 'Straw mats rolled and tied with rope beside a cloth bundle on a bare floor, dim light, overhead close view',
  },
  {
    id: 'v3-22',
    zh: '卷三：铁丝网上结了霜',
    en: 'Frost on strands of barbed wire, cold morning, a weathered brick wall behind, close shot',
  },
  {
    id: 'v3-23',
    zh: '卷三：1941 的报摊，报纸虚成一片',
    en: 'A newspaper stand on a Shanghai street corner, headline blocks blurred out of focus, morning fog, close shot',
  },
  {
    id: 'v3-24',
    zh: '卷三：路上丢下的包袱，人被带走了',
    en: 'A dropped cloth bundle and footprints on a wet road, a distant gate post in mist, overcast light, wide shot',
  },
  {
    id: 'v3-25',
    zh: '卷三：空营房，草鞋、碗、一小堆灰',
    en: 'An abandoned barracks room, scattered straw sandals and bowls, a small pile of ash, light through a broken window, wide shot',
  },
  {
    id: 'v4-01',
    zh: '卷四：1945 战后县政府门口，石狮子与落叶',
    en: 'A county government gate just after the war, a stone lion, scattered leaves, late afternoon light, wide shot',
  },
  {
    id: 'v4-02',
    zh: '卷四：1947 造册，木箱与蓝布摊开',
    en: 'An open wooden document chest with blue cloth and stacked paper on a table, winter light, close overhead view',
  },
  {
    id: 'v4-03',
    zh: '卷四：文化馆玻璃柜里的旗样图',
    en: 'A glass display case in a small county cultural center, a folded paper drawing of a flag with blurred marks, wooden floor, dim light, wide shot',
  },
  {
    id: 'v4-04',
    zh: '卷四：抽掉一块砖，墙洞里是包好的册子',
    en: 'A brick wall with one brick removed revealing a wrapped paper booklet inside, dim light, close shot',
  },
  {
    id: 'v4-05',
    zh: '卷四：1982 的录音机和三盒磁带',
    en: 'An old reel to reel tape recorder on a wooden table, a microphone, three tape boxes, dust, cold window light, wide shot',
  },
  {
    id: 'v4-06',
    zh: '卷四：纪念馆的工作台，针线篮与红布',
    en: 'A sewing basket with red cloth, needle and thread on a museum workbench, window light, close shot',
  },
  {
    id: 'v4-07',
    zh: '卷四：1995 年寄出的布包，里面是照片',
    en: 'A brown paper parcel tied with string on a post office counter, a small photograph beside it, daylight, close shot',
  },
  {
    id: 'v4-08',
    zh: '卷四：纪念馆院里的铜像，脚下一束花',
    en: 'A bronze statue of an officer on a stone plinth in a museum courtyard, one small bouquet at its base, evening light, wide shot',
  },
  {
    id: 'v4-09',
    zh: '卷四：2015 英名墙，一排排刻痕看不清',
    en: 'A vast grey stone memorial wall with rows of blurred carved marks, cold daylight, wide shot',
  },
  {
    id: 'v4-10',
    zh: '卷四：2025，石墙上的刻痕被手指磨亮',
    en: 'Extreme close view of blurred carved marks on grey stone, one patch polished by hands, dust in the grooves, cold light',
  },
  {
    id: 'v4-11',
    zh: '卷四：档案馆的架子，唯独 A-017 的盒子被调出来',
    en: 'A metal shelf of grey archive boxes, one small tape box set apart from the rest, dim light, close shot',
  },
  {
    id: 'v4-12',
    zh: '卷四：通城村口那块石头，字快磨平了',
    en: 'A rough stone at a village entrance with blurred carved marks almost erased by weather, weeds, overcast light, wide shot',
  },
  {
    id: 'v4-13',
    zh: '卷四：县志书页翻开，一览表只剩横列',
    en: 'An open county gazetteer page with blurred columns out of focus, a magnifying glass, desk lamp light, close overhead view',
  },
  {
    id: 'v4-14',
    zh: '卷四：寻访的乡间小路，雨里没有人',
    en: 'A narrow country road in the rain, rice paddies, a distant village outline, mist, wide shot',
  },
  {
    id: 'v4-15',
    zh: '卷四：厢房里那把空椅子，炭盆冷了',
    en: 'An empty wooden chair beside a table with a cold brazier, snow light through the lattice window, wide shot',
  },
  {
    id: 'v5-01',
    zh: '卷五·杨瑞符：桌上摊开的地图，铅笔与灯',
    en: 'A folded military map spread on a crate, pencil and kerosene lamp beside it, deep shadows on concrete, close overhead view',
  },
  {
    id: 'v5-02',
    zh: '卷五·杨瑞符：地图上标出的位置，弹壳压着纸角',
    en: 'A pencil marking positions on a worn map, an empty brass shell casing used as a paperweight, dim light, close shot',
  },
  {
    id: 'v5-03',
    zh: '卷五·陈树生：五楼窗台上的布带与纸片',
    en: 'A rope belt and a folded paper slip on the windowsill of a warehouse fifth floor, smoke outside, close shot',
  },
  {
    id: 'v5-04',
    zh: '卷五·陈树生：写过名字的那张纸还压在铅块下',
    en: 'A torn paper slip with blurred ink marks on a concrete ledge, a pencil stub and a lead weight beside it, close shot',
  },
  {
    id: 'v5-05',
    zh: '卷五·杨惠敏：夜里河岸，湿包袱搁在石头上',
    en: 'The river at night, a small wet cloth bundle left on the near bank stones, distant lights in mist, wide shot',
  },
  {
    id: 'v5-06',
    zh: '卷五·杨惠敏：滴水的包袱，石面上一圈水痕',
    en: 'A soaked cloth bundle dripping onto flat river stones, a ring of water spreading, night light, close overhead view',
  },
  {
    id: 'v5-07',
    zh: '卷五·记者：折叠相机、望远镜与稿纸',
    en: 'A folding bellows press camera, binoculars and a sheaf of manuscript paper on a riverside windowsill, dusk, wide shot',
  },
  {
    id: 'v5-08',
    zh: '卷五·同乡会：会馆长桌、茶碗与名册',
    en: 'A guild hall room with a long table, tea cups, a ledger, a hanging scroll blurred, dim light, wide shot',
  },
  {
    id: 'v5-09',
    zh: '卷五·通城兵：墙根一排草鞋与布鞋',
    en: 'Rows of straw sandals and cloth shoes lined along a whitewashed wall, dust, afternoon light, close shot',
  },
  {
    id: 'v5-10',
    zh: '卷五·通城兵：祠堂前的石阶，脚印还在',
    en: 'The stone steps in front of an ancestral hall, many sets of footprints in dust, late sun, wide shot',
  },
]

/**
 * 场景 prompt 覆盖层：writers 的真实场景表落地后，按实际 title / location / date / weather 重写。
 * 只写"具体物 + 地点 + 光"，风格前缀与空场护栏由 buildPrompt 自动加。
 * 已完成：卷零—卷一（33 场）；卷二甲—戊 / 卷三—五待 writers 定稿后补（未覆盖的暂用 SCENE_BEATS 基线）。
 */
const SCENE_OVERRIDES = {
  // ——— 卷零 序卷（1947 冬·陈家坳→县参议会）———
  'v0-01': { zh: '序卷·便条：雪晨，便条压在木凳上', en: 'Snow covered village yard at dawn, a folded paper note weighted on a wooden stool, wooden pail by the well, cold blue light' },
  'v0-02': { zh: '序卷·半本册子：后半夜，灯下的木箱与蓝布', en: 'Dim village kitchen at night, a worn paper booklet on an opened camphor wood box, blue cloth beside it, oil lamp glow' },
  'v0-03': { zh: '序卷·灶前：清晨，锅盖上的白气', en: 'Village kitchen in the morning, an iron pot on a brick stove, steam rising to the beams, firelight on clay wall' },
  'v0-04': { zh: '序卷·烘笼：沙堆村口，手笼里的炭火', en: 'Wicker hand warmer basket on a wooden bench, glowing charcoal inside, snow beyond a doorway, low afternoon light' },
  'v0-05': { zh: '序卷·城门口：县城门洞，卖炭的扁担', en: 'County town gate arch in snow, a charcoal sellers shoulder pole across stone steps, empty baskets, low winter sun' },
  'v0-06': { zh: '序卷·廊下：县参议会黑漆门，铜环缺了一只', en: 'Dark corridor of a county assembly hall, black lacquered door with one bronze ring left, snow light from the courtyard' },
  'v0-07': { zh: '序卷·第四十九个：廊下写名单，最后一行还空着', en: 'A roster page on a low corridor table, brush and ink, one blank line at the bottom, lamp light from the doorway' },
  'v0-08': { zh: '序卷·推门：厢房门缝里的灯光，落在砖地上', en: 'A door ajar into a lamplit county office room, light falling on brick floor in two bands, empty chair beyond' },

  // ——— 卷一·通城（1937.8—9）———
  'v1-01': { zh: '卷一·公函：八月，保安大队部桌上的公函', en: 'A sealed official letter on a wooden desk, ink brush and ink stone, hot August county headquarters office, open lattice window' },
  'v1-02': { zh: '卷一·代笔：城门洞里支起的矮桌，桌脚垫着瓦片', en: 'A small writing table set against an arched gate wall, brick shards under one leg, paper and brush, draft blowing through' },
  'v1-03': { zh: '卷一·点名：九月，操场上的点名板', en: 'A roster board on a wooden stand, chalk marks on packed earth, sun bleached drill ground, hard noon light' },
  'v1-04': { zh: '卷一·擦枪：操场草席上排开的枪，油布和破布', en: 'Rifles laid out on straw matting in rows, oil cloth and rags beside them, rust and grease, hard sunlight' },
  'v1-05': { zh: '卷一·三双鞋：陈家坳门槛上，纸包的三双布鞋', en: 'Three pairs of cloth shoes wrapped in paper on a stone doorstep, field stubble beyond, late summer light' },
  'v1-06': { zh: '卷一·编队：县立小学操场，课桌堆在墙根', en: 'A schoolyard turned drill ground, worn desks stacked against the wall, chalk lines on packed earth, bare tree, autumn light' },
  'v1-07': { zh: '卷一·出发前夜：城西祠堂，雨里的地铺与枪架', en: 'Ancestral hall at night, rain falling into the courtyard, straw mats on stone floor, rifles stacked against a red pillar, lantern glow' },
  'v1-08': { zh: '卷一·离城：九月末，出城的官道和车辙', en: 'Muddy official road leaving a county town in rain, deep cart ruts, straw sandal prints in the mud, mist over fields' },
  'v1-09': { zh: '卷一·公署门前：蒲圻专员公署，石狮与告示牌', en: 'Gate of a provincial commissioner office in rain, wet stone lions, a notice board blurred, overcast light' },
  'v1-10': { zh: '卷一·车上：蒲圻至武昌道上，卡车后厢的帆布边', en: 'Roadside view from a moving truck, canvas cover edge in the foreground, dust trail behind, dusk fields' },
  'v1-11': { zh: '卷一·卓刀泉：武昌营房外的老井与石栏', en: 'Temple courtyard well at Zhuodaoquan, stone rim green with moss, a bronze incense burner, autumn light on tiles' },
  'v1-12': { zh: '卷一·铅条：江边印刷所，铅字条排在木盘里', en: 'Riverside printing shop, lead type strips in wooden trays, blurred newspaper sheets, dusk light through a dusty window' },
  'v1-13': { zh: '卷一·开拔令：卓刀泉营房，桌上的命令与打好捆的行李', en: 'Barracks room with a departure order on a table, tied bundles and rifle racks, cold morning light' },
  'v1-14': { zh: '卷一·车厢：闷罐车厢，稻草和一线一线的光', en: 'Interior of a boxcar, straw on the floor, gear bundles, slats of light through gaps, dust hanging in the air' },
  'v1-15': { zh: '卷一·夜行：江苏土路，夜里雨，灯在泥里照出一片', en: 'Waterlogged country road at night in rain, a lantern glow on the ruts, deep shadows, mist' },
  'v1-16': { zh: '卷一·干粮袋：歇脚处，打开的干粮袋与搪瓷杯', en: 'A canvas ration bag open on a stone, dry rations and a tin cup beside it, dust, low sun' },
  'v1-17': { zh: '卷一·破鞋：收容点旁堆着的破鞋', en: 'Worn shoes piled at a roadside collection point, straw and mud, a broken stool, overcast light' },

  // ——— 卷一·上海（1937.10）———
  'v1-18': { zh: '卷一·到上海：外围兵站，煤烟与货栈', en: 'Railway siding outside Shanghai, coal smoke haze, stacked supply crates, low sheds, distant fires glowing' },
  'v1-19': { zh: '卷一·补进一营：兵站营房，一排草铺', en: 'Warehouse barracks, rows of straw bedding, rifles leaning against concrete pillars, ash light through high windows' },
  'v1-20': { zh: '卷一·钢盔：木凳上的一排钢盔，都是凹的', en: 'Steel helmets in a row on a wooden bench, dents and ash dust, weak light from a high window' },
  'v1-21': { zh: '卷一·第一页：兵营里新册子翻到第一页', en: 'A new roster book open to its first blank page, brush and ink on a crate, lamp light, ash dust in the air' },
  'v1-22': { zh: '卷一·空铺：叠好的被子，留下一顶钢盔', en: 'An empty bunk with a folded blanket and one helmet left behind, dim warehouse light, deep shadow' },
  'v1-23': { zh: '卷一·苏州河：北岸看河，雨点落在水里', en: 'Suzhou creek from the north bank at dusk, rain rings on dark water, a warehouse silhouette on the far side' },
  'v1-24': { zh: '卷一·命令：十月二十六日夜，桌上的命令纸，外面下雨', en: 'A written order on a table inside a warehouse, rain beyond the doorway, lamp light, sandbags in shadow' },
  'v1-25': { zh: '卷一·铁门：十月二十七日凌晨，四行仓库铁门焊死', en: 'A heavy iron warehouse door sealed by rough welds, rain streaks on the metal, sandbags, predawn darkness' },

  // ——— 卷二·第一夜（1937.10.26 深夜—27 拂晓）———
  'v2-01': { zh: '卷二·交钥匙：铁门外，钥匙和口令交接', en: 'Iron gate of a concrete warehouse at deep night, a key on a cord in an outstretched hand, dust in a shielded lamp beam, rain beyond' },
  'v2-02': { zh: '卷二·四路进场：凌晨，底楼大厅四路纵队', en: 'Ground floor hall of a concrete warehouse at three in the morning, four lanes of chalk marks on the floor, rifles stacked in tripods, kerosene lamp' },
  'v2-03': { zh: '卷二·枪：底楼西墙，枪一捆一捆解开', en: 'Rifles unwrapped from straw rope against a concrete west wall, oil cloth and grease, ammunition crates, dim shielded light' },
  'v2-04': { zh: '卷二·粮食包：底楼窗口码起的粮包', en: 'Grain sacks stacked to the height of a warehouse window, coarse burlap, spilled grain on concrete, grey dawn light' },
  'v2-05': { zh: '卷二·地下室：黑，积水，和一股潮味', en: 'A warehouse basement with shallow water reflecting one lamp, damp brick pillars, wooden crates, deep darkness' },
  'v2-06': { zh: '卷二·裁纸：方柱下把纸裁成名册大小', en: 'Paper sheets cut to size with a knife on a crate top, paper scraps and a stone weight, kerosene lamp, concrete pillar behind' },
  'v2-07': { zh: '卷二·籍贯：一个一个问是哪里人', en: 'A roster page with columns for hometown, brush and ink pot on a crate, a tin cup, lamp light, dust in the air' },
  'v2-08': { zh: '卷二·外号：名字旁边添上了外号', en: 'A roster page with blurred nicknames added beside names, pencil and brush, rough paper, dim light' },
  'v2-09': { zh: '卷二·第一声炮：拂晓，门口第一次炮击', en: 'Warehouse doorway at first light, a new crack in the plaster, dust falling, sandbags scattered, cold outside air' },
  'v2-10': { zh: '卷二·抬上楼：傍晚，担架沿着楼梯往上', en: 'Concrete staircase of a warehouse at dusk, a canvas stretcher set down on the landing, dust and boot marks, dim light from above' },
  'v2-11': { zh: '卷二·断水：夜，水缸见了底', en: 'A stone water vat in a warehouse corner, almost empty, a tin cup inside, brick dust at the bottom, single lamp light' },
  'v2-12': { zh: '卷二·止血：伤兵房，绷带和石灰桶', en: 'Dressing station on the warehouse second floor, rolls of cloth bandage, bucket of lime, folded stretchers, one hanging bulb' },
  'v2-13': { zh: '卷二·代笔：窗下，替不识字的人写家书', en: 'A window ledge used as a writing desk, half written letters, pencil stub, river lights far below in rain' },
  'v2-14': { zh: '卷二·手印：墙上和纸上留下的手印', en: 'A grey concrete wall with dark handprints at shoulder height, dust, single lamp raking the surface' },
  'v2-15': { zh: '卷二·遗书：深夜写好的一页纸', en: 'A single sheet of farewell letter on a wooden crate, blurred ink lines, a pencil and a bullet casing as paperweight, dim lamplight' },
  'v2-16': { zh: '卷二·煤油灯：灯芯被捻到最小，怕被看见', en: 'A kerosene lamp turned down to a bead of light beside thick concrete wall, blackout cloth, deep shadows' },
  'v2-17': { zh: '卷二·水的味道：水里有砖灰和煤油味', en: 'A tin cup of cloudy water on a crate, brick dust settled at the bottom, a second empty cup, dim light' },
  'v2-18': { zh: '卷二·探照灯：窗口外，光柱扫过河面', en: 'A concrete window frame at night, a distant searchlight beam crossing the river, dark water, dust in the room' },

  // ——— 卷二·第三—四日（1937.10.28—30）———
  'v2-19': { zh: '卷二·西墙：28 日上午，墙上的弹痕与新土', en: 'Concrete west wall of a warehouse with fresh impact marks, plaster fallen in a line, torn sandbags, smoke at the base, hard morning light' },
  'v2-20': { zh: '卷二·顶钢板：西墙内侧用钢板和木梁撑住', en: 'Steel plates and wooden beams braced against a concrete wall inside a warehouse, bolts, rope and dust, dim interior light' },
  'v2-21': { zh: '卷二·绑弹：五楼楼梯口，帆布带与手榴弹', en: 'Stick grenades laid on a dusty warehouse floor beside a canvas belt, a torn paper slip, cold light from a stairwell' },
  'v2-22': { zh: '卷二·空出来的位置：五楼墙角，一支枪一顶盔', en: 'An empty corner of a warehouse fifth floor, a rifle set upright against the wall, a helmet on the floor, dusk light' },
  'v2-23': { zh: '卷二·布包：门口，湿的布包和扎紧的绳', en: 'A wet cloth bundle on a warehouse doorstep at night, string tied twice, river lamplight beyond the gate' },
  'v2-24': { zh: '卷二·旗太小：楼顶，小红旗、尺子与粉笔线', en: 'A small red cloth flag with hand stitched edge on roof concrete, a wooden ruler and chalk marks, night haze, no emblem' },
  'v2-25': { zh: '卷二·光柱：夜里楼顶，探照灯扫过天空', en: 'Warehouse rooftop parapet at night, a searchlight beam crossing the sky, flag rope taut on a bamboo pole, smoke haze' },
  'v2-26': { zh: '卷二·最密的一小时：地下室，灰从裂缝里落下来', en: 'Concrete basement during bombardment, dust falling from ceiling cracks, stacked crates, a single lamp shaking, deep shadow' },
  'v2-27': { zh: '卷二·等天亮：楼顶，搪瓷杯和一条叠好的毯子', en: 'A tin cup and a folded blanket beside a warehouse parapet, pale smoke sky above, bare bamboo pole' },
  'v2-28': { zh: '卷二·抬下去：楼梯拐角，担架和叠好的毯子', en: 'Concrete warehouse staircase, a canvas stretcher with a folded blanket on the landing, dust and boot marks, dim light' },
  'v2-29': { zh: '卷二·桥中间：夜里的桥面，装备和一只鞋', en: 'The middle of a wet bridge at night, abandoned gear and a single dropped cloth shoe on the road, river fog, distant lights' },
  'v2-30': { zh: '卷二·同乡会：桥南堍，一张桌子与扎好的信', en: 'A riverside street at night with a wooden table set up, stacked letters and a ledger, lantern glow, mist' },
  'v2-31': { zh: '卷二·通城话：桥栏上压着的那张名单', en: 'A folded paper list weighted under a stone on a wet bridge railing, night fog, distant lamps, iron beaded with rain' },
  'v2-32': { zh: '卷二·报摊：30 日拂晓，报纸头版虚成一块黑', en: 'A newsstand with stacks of newspapers, headline blocks blurred out of focus, wet pavement at dawn, one dim lamp' },
  'v2-33': { zh: '卷二·慰问信：桥南堍，一捆捆信靠在栏杆上', en: 'Bundles of letters and packages stacked against a river railing, rope, morning fog, cold light' },
  'v2-34': { zh: '卷二·回库：上午，底楼地上的泥脚印', en: 'Warehouse ground floor with returning gear, muddy footprints across the concrete, stacked supply crates, daylight through the doorway' },
  'v2-35': { zh: '卷二·桥上的雾：午后，桥面只剩前半段', en: 'Bridge deck in afternoon fog, iron railing and tram rails vanishing into grey, empty road, cold light' },
  'v2-36': { zh: '卷二·三十日的册子：西墙边，摊开的册子和墙洞', en: 'An open roster book on a crate beside a breached west wall, pencil marks, rubble below the hole, evening light' },
  'v2-37': { zh: '卷二·九点：撤退令到了，桌上一盏灯和一张纸', en: 'A written order on a crate under a lamp at nine at night, sandbags behind, deep shadow, cold concrete' },
  'v2-38': { zh: '卷二·不肯走：楼梯口留下的一副担架和一顶盔', en: 'Concrete stairs at night, a canvas stretcher set down on a landing, a helmet beside it, dim lamp light' },
  'v2-39': { zh: '卷二·收拾：大厅里捆好的行李和码起的枪', en: 'Tied bundles on a warehouse floor at night, rifles stacked in tripods, a lantern, boot marks in dust' },
  'v2-40': { zh: '卷二·不能动的：二楼担架与叠好的毯子', en: 'Warehouse second floor at night, a canvas stretcher and a folded blanket by the wall, a tin cup, dim light' },
  'v2-41': { zh: '卷二·包册子：布包、绳子、册子，压在手边', en: 'A cloth wrapper and hemp rope beside a paper booklet on a crate, a knife and a stone weight, lamp light' },
  'v2-42': { zh: '卷二·铁门：十点半，铁门打开一道缝', en: 'A heavy iron warehouse door opened a hand wide at night, rain and lamplight beyond the gap, sandbags' },
  'v2-43': { zh: '卷二·桥头：北堍，队伍还没动，雨在下', en: 'North bridgehead at night in rain, wet stone, iron railing, lamplight in fog, abandoned gear on the ground' },
  'v2-44': { zh: '卷二·过桥：凌晨的桥面，雨、灯、移动的影子', en: 'Wet bridge deck at three in the morning, rain streaks in lamplight, dark water below, deep fog' },
  'v2-45': { zh: '卷二·南堍：租界一侧，枪堆与湿的台阶', en: 'South bridgehead in the foreign concession at dawn, wet stone steps, a pile of rifles, iron railings, mist' },

  // ——— 卷三·孤军营（1937.11—1941.5 胶州路）———
  'v3-01': { zh: '卷三·三百五十五：晨雨里清点人数', en: 'Fenced factory courtyard at dawn in rain, wet concrete, a counting board on a wooden stand, puddles, barbed wire above' },
  'v3-02': { zh: '卷三·网眼：临街铁丝网，网眼里是上海', en: 'Barbed wire mesh close to a wet street, blurred shopfronts beyond the diamond openings, raindrops on the wire' },
  'v3-03': { zh: '卷三·点数：操场上，一列一列数过去', en: 'Factory courtyard drill ground, chalk marks in rows, a counting board and hand bell on a table, overcast light' },
  'v3-04': { zh: '卷三·砚台：谢晋元办公室桌上的一方砚', en: 'A small office desk with an ink stone, brush resting on a paper with blurred lines, cold window light, plain walls' },
  'v3-05': { zh: '卷三·空竹竿：操场边靠着一根空竹竿', en: 'A bare bamboo pole leaning against a courtyard wall, one dry leaf at its base, overcast light, empty ground' },
  'v3-06': { zh: '卷三·一锅粥：灶房，一锅稀粥分成几份', en: 'A cauldron of thin rice porridge in a factory kitchen, wooden ladle, chipped bowls lined up, steam, dim light' },
  'v3-07': { zh: '卷三·皂：工场里做出来的肥皂，码在木板上', en: 'Rough soap bars drying on wooden boards in a workshop, pale rectangles, dust, window light' },
  'v3-08': { zh: '卷三·黑板：营房西头的黑板，字擦了一半', en: 'A blackboard with blurred chalk marks half wiped off, worn benches, dust in a shaft of window light' },
  'v3-09': { zh: '卷三·墙外的人：铁丝网外的街，只有雨和车轨', en: 'A wet street beyond barbed wire, blurred shopfronts, a tram rail, raindrops on the wire, empty' },
  'v3-10': { zh: '卷三·歌：营房里唱歌，声音从窗口出去', en: 'Barracks interior at night, a lantern on a table, straw mats on the floor, empty shoes lined up, shadows on the wall' },
  'v3-11': { zh: '卷三·一周年：操场上升旗，布被风吹直', en: 'A red cloth flag on a bamboo pole in a fenced courtyard, wind straightening it, grey sky, no emblem' },
  'v3-12': { zh: '卷三·退回来的信：盖了戳又退回来的信', en: 'A returned letter on a wooden table, blurred stamp and crossed address, string tie, cold light' },
  'v3-13': { zh: '卷三·雪：营房外落雪，门框积了一条白', en: 'Snow piling along a barracks door frame, bare courtyard beyond, wet boot prints, cold grey light' },
  'v3-14': { zh: '卷三·报上的名字：桌上报纸，名字虚成灰块', en: 'A folded newspaper on an office desk, headline block blurred out of focus, ink brush, rain light through a window' },
  'v3-15': { zh: '卷三·礼帽：营门口地上落下的一顶礼帽', en: 'A bowler hat lying on wet stone at a camp gate, a dropped cane beside it, overcast light' },
  'v3-16': { zh: '卷三·兄弟：卡在铁丝网口的那张纸', en: 'A folded paper wedged in a gap of barbed wire, rain drops on the strands, blurred street beyond' },
  'v3-17': { zh: '卷三·断粮：灶房，空了的粮袋翻着口', en: 'Empty grain sacks turned inside out in a kitchen corner, bare shelves, a single bowl, cold light' },
  'v3-18': { zh: '卷三·相机：架在铁丝网口的老式相机', en: 'A folding bellows camera fixed at a gap in barbed wire, raindrops on the wire, blurred street beyond' },
  'v3-19': { zh: '卷三·委任状：营门口沙袋上放着的一封信', en: 'A sealed document envelope on a sandbag post at a camp gate, red seal smudged, overcast light' },
  'v3-20': { zh: '卷三·空位：营房西头空出来的一个铺位', en: 'An empty straw bunk with a folded blanket, a bowl and chopsticks left on a stool, dim barrack light' },
  'v3-21': { zh: '卷三·空格：名册上留出的一格，一直没填', en: 'A roster page with one blank square at the end of a row, brush resting beside, lamp light, worn paper' },
  'v3-22': { zh: '卷三·最后一夜：四月二十三日夜，办公室的灯', en: 'A small office at night with a lamp, an empty chair pulled out, papers on the desk, rain on the window' },
  'v3-23': { zh: '卷三·四月二十四日：操场，翻倒的椅子与一顶军帽', en: 'An overturned chair and a grey military cap on wet drill ground, five in the morning, no insignia, cold light' },
  'v3-24': { zh: '卷三·灵堂：营房改为灵堂，白布与一盏灯', en: 'A barracks room turned into a mourning hall, white cloth draped along the wall, a plain coffin in the distance, one lamp' },
  'v3-25': { zh: '卷三·五月八日：操场，队列空着的位置', en: 'A factory courtyard with rows of empty positions marked by rifles in tripods, grey sky, bare flag pole, rain' },

  // ——— 卷四·名字之后（1950—2025 通城/上海）———
  'v4-01': { zh: '卷四·蓝布包：1950 年冬，蓝布包着的册子在箱底', en: 'A blue cloth bundle in an open wooden box, winter window light, snow outside the lattice, dust motes' },
  'v4-02': { zh: '卷四·墙洞：1966 年冬，抽掉一块砖藏东西', en: 'A brick wall with one brick loosened, a cloth wrapped bundle pushed into the cavity, dim room light, dust' },
  'v4-03': { zh: '卷四·一九八〇年春：雨里的旧屋，册子摊在桌上', en: 'An old village room on a rainy spring day, a worn booklet open on a table, damp light through the window, tea cup' },
  'v4-04': { zh: '卷四·录音带 A-017：1982 年秋，老录音机与三盘磁带', en: 'An old reel to reel tape recorder on a wooden table, three tape boxes lined up, a microphone, autumn light, dust' },
  'v4-05': { zh: '卷四·广播里的歌：1985 年夏，窗外的广播喇叭', en: 'An old loudspeaker mounted on a village wall, morning light, summer leaves, a worn wire, empty yard' },
  'v4-06': { zh: '卷四·木盒：1990 年冬，木盒里放着册子和照片', en: 'An open wooden box on a table, a cloth wrapped booklet and a small photograph inside, winter light, dust' },
  'v4-07': { zh: '卷四·六个学生：1991 年夏，堂屋里抄名字的桌面', en: 'A farmhouse main room in summer, a long table with copybooks and pencils, a hand cranked fan blurred, window light' },
  'v4-08': { zh: '卷四·跪：2005 年 8 月 13 日，铜像前的空地与花', en: 'A museum courtyard with a bronze statue on a stone plinth, one small bouquet at its base, late afternoon light' },
  'v4-09': { zh: '卷四·撒网：2009 年夏，乡镇土路与行囊', en: 'A dusty township road in summer, a canvas bag and notebook left on a milestone, rice fields, hazy sun' },
  'v4-10': { zh: '卷四·去重：2013—2014，档案局桌上摊开的三份名单', en: 'A county archive office desk with three name lists side by side, a magnifying glass, cold north window light, paper dust' },
  'v4-11': { zh: '卷四·三二三个名字：2015 年，纪念馆石墙刻痕', en: 'A vast grey stone memorial wall with rows of blurred carved marks, cold daylight, a stone ledge, quiet' },
  'v4-12': { zh: '卷四·拍下来：2015 年冬，手机屏照亮旧册页', en: 'A kerosene lamp light falling on an old paper page at night, a magnifying glass lying on the page, winter dark beyond' },
  'v4-13': { zh: '卷四·看电影：2020 年秋，县城影院门口的海报架', en: 'A county town cinema entrance in autumn, a poster frame with blurred image, wet pavement, dusk light' },
  'v4-14': { zh: '卷四·三百五十四：2025 年 8 月，石墙新增的几行', en: 'A grey stone memorial wall in cold light, several newly cut marks visible, dust in the grooves, quiet' },
  'v4-15': { zh: '卷四·留白：2025 年 10 月，柳堤公园的长椅与河', en: 'A riverside park in autumn, an empty stone bench under willow trees, leaves on the ground, soft afternoon light' },

  // ——— 卷五·人物志（十个可进入的人物场景）———
  'v5-01': { zh: '卷五·收水：一楼，把雨水接进桶里', en: 'A warehouse ground floor corner, buckets and a tin basin catching dripping water from a broken pipe, wet concrete, dim light' },
  'v5-02': { zh: '卷五·团附：二楼，一个人的背影与一张地图', en: 'Warehouse second floor with a cratered map on a crate, a lantern, rifle leaning on a pillar, deep shadows' },
  'v5-03': { zh: '卷五·五楼的窗口：10 月 28 日，空窗与烟', en: 'A fifth floor warehouse window open to smoke, dust swirling on the sill, rope and a canvas belt left on the floor' },
  'v5-04': { zh: '卷五·六尺长，四尺阔：旗的尺寸被量出来', en: 'A red cloth flag laid flat on roof concrete, a wooden ruler and chalk marks beside it, no emblem, dawn light' },
  'v5-05': { zh: '卷五·八百：门口，报道里的人数与报纸', en: 'A folded newspaper on a warehouse doorstep, blurred headline block, rain, a spent shell casing beside it' },
  'v5-06': { zh: '卷五·挂号信：租界邮局，盖戳的挂号信', en: 'A registered letter envelope on a post office counter, blurred stamp, ink pad and wooden stamp, dim daylight' },
  'v5-07': { zh: '卷五·按手印的那一页：保安大队院子，红泥与名册', en: 'A dark thumb print at the bottom of a roster page, red ink pad beside it, courtyard table, hard daylight' },
  'v5-08': { zh: '卷五·卓刀泉：1991 年冬，乡下堂屋里的旧地图', en: 'A village main room in winter, a hand drawn map spread on a table, a thermos and tea cup, dim light' },
  'v5-09': { zh: '卷五·团长啊：2005 年，四行仓库楼下的跪像与花', en: 'A bronze statue on a stone base in a warehouse courtyard, a small bouquet at the foot, evening light, long shadow' },
  'v5-10': { zh: '卷五·88D：2025 年，纪念馆展柜里的旗', en: 'A museum display case with a folded red cloth flag inside, a small label blurred, cold light, dark background' },
}

/** 关键瞬间：100 条，抉择点/催泪点。 */
const MOMENTS = [
  {
    zh: '关键瞬间：第一个名字落笔，墨在纸纤维里化开',
    scene: 'prologue',
    en: 'Extreme close up of a brush tip landing on rough paper, a single dark ink dot spreading into the fibers, lamplight from the left, one hand only at the edge of frame, shallow depth of field',
  },
  {
    zh: '关键瞬间：把名册缝进衣襟，线头打了一个结',
    scene: 'night1',
    en: 'Close up of a needle pushing through thick cotton lining and paper pages, coarse thread, a knotted thread end, warm lamplight, one hand only, shallow depth of field',
  },
  {
    zh: '关键瞬间：名册页卷成细筒塞进空心竹篙',
    scene: 'night2',
    en: 'Close view of a hollow bamboo pole with a rolled paper slip being pushed in, dry bamboo fibers and a split end, one hand only, dim indoor light, shallow depth of field',
  },
  {
    zh: '关键瞬间：举不起来的铅笔，悬在纸上',
    scene: 'night4',
    en: 'Close up of a stub pencil held above a page, hand frozen in mid air, faint pencil marks and an unfinished line on the paper, dim side light, shallow depth of field',
  },
  {
    zh: '关键瞬间：三十七封家书捆成两扎，手按在上面',
    scene: 'night2',
    en: 'Two bundles of folded letters tied with rough hemp string on a wooden table, a hand resting on them, dim warm lamplight, worn paper edges, close shot',
  },
  {
    zh: '关键瞬间：把半块干粮放回口袋',
    scene: 'night5',
    en: 'Close up of a half eaten piece of dry ration being put back into a cloth bag, coarse crumbs on a wooden surface, one hand only, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：绑腿布一圈圈接长旗绳',
    scene: 'night3',
    en: 'Close up of hands tying a strip of puttee cloth around a bamboo pole joint, the flag rope still too short, backlit by dawn haze, shallow depth of field',
  },
  {
    zh: '关键瞬间：照片背面的日期，笔停了一下',
    scene: 'night4b',
    en: 'Close up of a pen hovering above the back of a small black and white photograph, faint writing out of focus, one hand only, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：两双手在湿铁栏上交一张名单',
    scene: 'night4',
    en: 'Two hands exchanging a folded sheet of paper over a wet iron railing at night, rain drops on the railing, dim lamplight beyond, close shot',
  },
  {
    zh: '关键瞬间：册子推进鞋垫底下',
    scene: 'night5b',
    en: 'Close up of a small folded paper booklet being pushed under the insole of a worn cloth shoe, one hand only, dim dawn light, shallow depth of field',
  },
  {
    zh: '关键瞬间：铁筷从炭盆里夹出最后一块炭',
    scene: 'prologue',
    en: 'Close up of an iron chopstick lifting the last glowing charcoal from a brazier, ash falling, one hand only, cold room, shallow depth of field',
  },
  {
    zh: '关键瞬间：手掌按住左襟，下面缝着册子',
    scene: 'prologue',
    en: 'Close up of a hand pressed flat against a jacket chest, a stiff paper edge showing under the cloth, one hand only, dim winter light, shallow depth of field',
  },
  {
    zh: '关键瞬间：笔尖在纸上圈出一个空，名字想不起来',
    scene: 'prologue',
    en: 'Close up of a brush drawing a small empty circle on a name roster, ink bleeding, one hand only, lamp light from the left, shallow depth of field',
  },
  {
    zh: '关键瞬间：湿手指把脆纸的折角一点点抹平',
    scene: 'epilogue',
    en: 'Close up of a wet fingertip smoothing a crease in brittle old paper, fibers lifting, one hand only, lamplight, extreme close view',
  },
  {
    zh: '关键瞬间：一根手指在花名册上一行行点过去',
    scene: 'v1-01',
    en: 'Close up of a single finger moving down a column of blurred ink names on rough paper, one hand only, harsh daylight, shallow depth of field',
  },
  {
    zh: '关键瞬间：母亲的手把字条塞进布鞋里',
    scene: 'v1-04',
    en: 'Close up of a weathered hand tucking a folded paper slip into a worn cloth shoe, coarse cloth fibers, morning light, one hand only, shallow depth of field',
  },
  {
    zh: '关键瞬间：竹篙提起来，纸筒在里面轻轻响',
    scene: 'night2',
    en: 'Close up of a hand lifting a hollow bamboo pole, a rolled paper slip visible inside, bamboo fibers, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：钥匙挂上脖子，铁片贴着锁骨',
    scene: 'night1',
    en: 'Close up of a small iron key on a cord being hung around a neck, rusted bit, rough hands, dim lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：第二份册子塞进米袋口，扎紧',
    scene: 'night1',
    en: 'Close up of hands pushing a paper booklet into the mouth of a rice sack, coarse burlap, rope beside, dim lantern light, shallow depth of field',
  },
  {
    zh: '关键瞬间：黑暗里手摸到册子，才松一口气',
    scene: 'night1b',
    en: 'Close up of a hand finding a small paper booklet in darkness, faint light from a window, dust in the beam, shallow depth of field',
  },
  {
    zh: '关键瞬间：毛笔刮掉一个错字，纸皮皱起来',
    scene: 'night1b',
    en: 'Close up of a brush scraping a wrong character off paper, the surface furring up, one hand only, lamplight, extreme close view',
  },
  {
    zh: '关键瞬间：磨破的信角露出「不要哭」',
    scene: 'night2',
    en: 'Close up of a worn letter corner torn open showing blurred ink strokes, a hand holding it, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：十二页名册撕下来，撕口不齐',
    scene: 'night2',
    en: 'Close up of hands tearing pages from a thread bound booklet, ragged paper edge, one hand only, lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：两扎信塞进棉袄夹层，扣子扣上',
    scene: 'night2',
    en: 'Close up of a hand tucking two bundles of letters into a padded jacket lining, wooden buttons, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：伤兵名单递到另一双手里',
    scene: 'night2',
    en: 'Close up of a folded list of names passing from one hand to two waiting hands, dim lamplight, sleeve cuffs worn, shallow depth of field',
  },
  {
    zh: '关键瞬间：竹竿靠上楼顶女儿墙，手扶稳',
    scene: 'night3',
    en: 'Close up of a bamboo pole being braced against a concrete parapet, one hand steadying it, dawn haze behind, shallow depth of field',
  },
  {
    zh: '关键瞬间：拇指捻着旗角，看针脚齐不齐',
    scene: 'night3',
    en: 'Close up of a thumb rubbing the corner of red cloth, rough hand stitching visible, dawn light, extreme close view',
  },
  {
    zh: '关键瞬间：绑腿从腿上解下来，布还热着',
    scene: 'night3',
    en: 'Close up of a strip of grey puttee cloth being unwound from a leg, coarse weave, dim light, one hand only, shallow depth of field',
  },
  {
    zh: '关键瞬间：旗绳多出的一截被缠紧',
    scene: 'night3',
    en: 'Close up of hands winding a thin rope around a bamboo joint, cloth strip tied at the end, dawn haze, shallow depth of field',
  },
  {
    zh: '关键瞬间：册子背面画旗，铅笔走的是直线',
    scene: 'night3',
    en: 'Close up of a pencil drawing straight lines on the back page of a booklet, faint marks, one hand only, lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：手拢在嘴边，朝对岸喊话',
    scene: 'night4',
    en: 'Close up of two hands cupped beside a mouth position at the edge of frame, no face visible, river haze beyond, shallow depth of field',
  },
  {
    zh: '关键瞬间：铅笔举到一半，又放下',
    scene: 'night4',
    en: 'Close up of a pencil rising halfway then lowering onto a page, a full list of blurred names below, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：名单抄进同乡会的账本里',
    scene: 'night4',
    en: 'Close up of a hand copying names into a ledger, a thin roster page beside it, ink brush, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：袖子擦掉照片上的灰',
    scene: 'night4',
    en: 'Close up of a sleeve wiping dust from a small black and white photograph, blurred figures, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：照片塞进信封，封口按牢',
    scene: 'night4b',
    en: 'Close up of a hand sliding a small photograph into an envelope, sealing edge pressed, dim lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：巴掌大的小旗展平，夹进册子',
    scene: 'night4b',
    en: 'Close up of two hands flattening a small red cloth flag with rough stitching, pressing it between booklet pages, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：干粮掰成两半，一半塞回口袋留给别人',
    scene: 'night5',
    en: 'Close up of hands breaking a dry ration in two, one half wrapped in cloth and tucked back into a pocket, crumbs falling, dim light',
  },
  {
    zh: '关键瞬间：伤兵抓住裤腿，手背青筋暴起',
    scene: 'night5',
    en: 'Close up of a hand gripping a trouser leg, knuckles pale, coarse cloth, dim emergency light, shallow depth of field',
  },
  {
    zh: '关键瞬间：册子递出去，手指没松',
    scene: 'night5',
    en: 'Close up of a hand passing a small paper booklet to a younger hand, fingers still curled on the edge, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：鞋垫掀起来，册子推进去',
    scene: 'night5b',
    en: 'Close up of a hand lifting the insole of a worn cloth shoe and pushing a folded booklet underneath, dawn light, shallow depth of field',
  },
  {
    zh: '关键瞬间：两只手把枪放在地上，一排排摆好',
    scene: 'night5b',
    en: 'Close up of two hands laying a rifle on wet stone, more rifles already lined up beyond, dim dawn light, shallow depth of field',
  },
  {
    zh: '关键瞬间：手在墙上一格格摸，找名字的位置',
    scene: 'v3-07',
    en: 'Close up of a hand moving across rows of blurred name plaques on a plaster wall, one hand only, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：针线篮里的针停在红布上方',
    scene: 'v4-06',
    en: 'Close up of a needle held above red cloth, thread trailing to a sewing basket, museum workbench, window light, shallow depth of field',
  },
  {
    zh: '关键瞬间：放大镜移到县志一览表的横列上',
    scene: 'v4-13',
    en: 'Close up of a magnifying glass moving over blurred columns on a gazetteer page, one hand only, desk lamp light, shallow depth of field',
  },
  {
    zh: '关键瞬间：手指压过英名墙的刻痕，停在某一个',
    scene: 'v4-10',
    en: 'Close up of fingertips tracing carved marks on grey stone, stopping on one groove, dust, cold light, shallow depth of field',
  },
  {
    zh: '关键瞬间：磁带盒被放回架子，标签朝外',
    scene: 'v4-11',
    en: 'Close up of a hand sliding a small tape box back onto a metal shelf, paper label blurred, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：一束花放在铜像脚下',
    scene: 'v4-08',
    en: 'Close up of a hand laying a small bunch of flowers at the base of a bronze statue, stone plinth, evening light, shallow depth of field',
  },
  {
    zh: '关键瞬间：包裹推上邮局柜台，手停了一下',
    scene: 'v4-07',
    en: 'Close up of a brown paper parcel being pushed across a post office counter, string tied, one hand only, daylight, shallow depth of field',
  },
  {
    zh: '关键瞬间：手伸进墙洞，把包好的册子取出来',
    scene: 'v4-04',
    en: 'Close up of a hand reaching into a hole in a brick wall and drawing out a wrapped paper booklet, dust, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：蓝布解开，册子露出来',
    scene: 'v0-08',
    en: 'Close up of hands unfolding a blue cloth to reveal a thin worn booklet, paper edges darkened, winter window light, shallow depth of field',
  },
  {
    zh: '关键瞬间：手把领口的布章摘下来，线头崩开',
    scene: 'v3-02',
    en: 'Close up of a hand unpinning a plain cloth collar tab from a grey uniform, frayed threads, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：扫开雪，石板露出一块干净面',
    scene: 'v0-03',
    en: 'Close up of a hand brushing snow off a flagstone, dark wet stone appearing, one hand only, low winter light, shallow depth of field',
  },
  {
    zh: '关键瞬间：灯芯被挑亮一点，屋子才看得清',
    scene: 'v1-12',
    en: 'Close up of a hand adjusting a kerosene lamp wick, flame growing, warm light spreading on concrete, shallow depth of field',
  },
  {
    zh: '关键瞬间：帆布弹带挂上肩，铜弹壳碰响',
    scene: 'v1-16',
    en: 'Close up of a hand hooking a canvas ammunition belt over a shoulder, brass casings glinting, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：沙袋口用麻绳扎紧，膝盖压住',
    scene: 'v1-13',
    en: 'Close up of hands tying off a sandbag with hemp rope, burlap texture and spilled sand, dim work light, shallow depth of field',
  },
  {
    zh: '关键瞬间：粉笔在铁门上画了一个叉',
    scene: 'v1-14',
    en: 'Close up of a piece of chalk drawing a cross on an iron door, white dust falling, dim light, extreme close view',
  },
  {
    zh: '关键瞬间：电话摇柄摇到底，等一个回声',
    scene: 'v1-20',
    en: 'Close up of a hand turning a field telephone crank to the end, cloth wire coiled, dim interior light, shallow depth of field',
  },
  {
    zh: '关键瞬间：地图折起来塞进怀里，只留一格',
    scene: 'v5-02',
    en: 'Close up of a folded map being tucked inside a jacket, one corner left visible, pencil marks blurred, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：纸卷的传声筒递出窗外',
    scene: 'v2-40',
    en: 'Close up of a paper megaphone handed through a window frame, one hand only, river haze beyond, shallow depth of field',
  },
  {
    zh: '关键瞬间：慰问信捆扎带被抽紧',
    scene: 'v2-32',
    en: 'Close up of hands pulling a cord tight around a bundle of letters and packages, rope creaking, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：一包烟被扔过河，落进泥里',
    scene: 'v2-31',
    en: 'Close up of a small cigarette packet falling onto wet stone, water splashing, river backdrop blurred, night, shallow depth of field',
  },
  {
    zh: '关键瞬间：望远镜举到眼前，手肘撑在窗台',
    scene: 'v2-29',
    en: 'Close up of hands raising binoculars at a windowsill, no face visible, river haze beyond, shallow depth of field',
  },
  {
    zh: '关键瞬间：笔尖断了，记者用指甲掐出印',
    scene: 'v2-36',
    en: 'Close up of a broken pencil tip on a notebook page, a fingernail making a mark instead, one hand only, dusk light, shallow depth of field',
  },
  {
    zh: '关键瞬间：照片被翻过来，背面朝上',
    scene: 'night4b',
    en: 'Close up of hands turning a small photograph face down, blank paper back with faint pencil lines, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：把名册页从竹篙里倒出来',
    scene: 'night2',
    en: 'Close up of a hand tapping a bamboo pole so a rolled paper slip slides out, dust, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：铅笔头削到只剩一小截',
    scene: 'v1-17',
    en: 'Close up of a small knife shaving a pencil stub, wood curls and graphite dust, one hand only, lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：墨从瓶口倾进砚台，一滴不剩',
    scene: 'v1-03',
    en: 'Close up of ink pouring from a small bottle into an ink stone, last dark drop forming, lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：信按姓氏分成两堆，堆得很慢',
    scene: 'v2-14',
    en: 'Close up of hands sorting letters into two stacks by name, blurred ink, dim lamplight, shallow depth of field',
  },
  {
    zh: '关键瞬间：军帽被摆正，帽檐朝前',
    scene: 'v3-18',
    en: 'Close up of hands setting a grey military cap straight on a folded blanket, no insignia, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：草席卷起来，绳子捆了两道',
    scene: 'v3-21',
    en: 'Close up of hands rolling a straw mat and tying it with rope, loose straw sticking out, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：白布在棺面上被抚平',
    scene: 'v3-20',
    en: 'Close up of a hand smoothing a white cloth over a plain wooden coffin lid, fibers catching light, distant and restrained, overcast light',
  },
  {
    zh: '关键瞬间：手拂掉铁丝网上的霜',
    scene: 'v3-22',
    en: 'Close up of a hand brushing frost off barbed wire, ice crystals falling, cold morning, shallow depth of field',
  },
  {
    zh: '关键瞬间：红纸年礼被拆开，里面是一块肥皂',
    scene: 'v3-13',
    en: 'Close up of hands opening a folded red paper packet revealing a small bar of soap, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：球被扔向木篮板，篮圈没有网',
    scene: 'v3-09',
    en: 'Close up of a worn ball in the air above a rough wooden basketball backboard, iron ring without a net, overcast light, shallow depth of field',
  },
  {
    zh: '关键瞬间：黑板上的半行字被擦掉',
    scene: 'v3-08',
    en: 'Close up of a cloth wiping half a line of blurred chalk marks off a blackboard, chalk dust in the air, shallow depth of field',
  },
  {
    zh: '关键瞬间：布袋倒过来，信一封封落桌上',
    scene: 'v3-14',
    en: 'Close up of a cloth bag being tipped over, letters sliding onto a wooden table, string and paper, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：脆纸被浸进浅水，墨色开始走',
    scene: 'prologue',
    en: 'Close up of a brittle page dipped in shallow water, ink stains loosening into the water, one hand only, dim light, extreme close view',
  },
  {
    zh: '关键瞬间：对冻住的窗哈气，擦出一小块亮',
    scene: 'v0-07',
    en: 'Close up of a hand wiping breath frost from a paper lattice window, a clear patch revealing snow outside, cold light, shallow depth of field',
  },
  {
    zh: '关键瞬间：扫帚从墙边被拿起来',
    scene: 'v0-07',
    en: 'Close up of a hand lifting a straw broom from beside a door frame, snow dust falling, cold morning light, shallow depth of field',
  },
  {
    zh: '关键瞬间：账本合上，手掌压住封面',
    scene: 'v2-39',
    en: 'Close up of a hand pressing a ledger book closed, embossed cover worn smooth, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：纸片被折成小方块，折了四折',
    scene: 'night4',
    en: 'Close up of hands folding a paper slip into a small square, fourth fold completed, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：铅笔别在耳朵上，手空了',
    scene: 'night3b',
    en: 'Close up of a hand tucking a pencil stub behind an ear position at the edge of frame, no face visible, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：旗面卷到竹竿上，卷得很紧',
    scene: 'v2-22',
    en: 'Close up of hands rolling red cloth tightly around a bamboo pole, fabric folds, daylight, shallow depth of field',
  },
  {
    zh: '关键瞬间：线头被咬断，针收起来',
    scene: 'night1',
    en: 'Close up of teeth biting off a thread end, needle and stitching below, dim lamplight, extreme close view',
  },
  {
    zh: '关键瞬间：铅笔在地图上点住一个位置',
    scene: 'v5-02',
    en: 'Close up of a pencil tip pressing a mark on a worn map, paper fibers indenting, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：册子放进箱底，蓝布盖上',
    scene: 'v0-08',
    en: 'Close up of hands lowering a booklet into a wooden chest, blue cloth folded back, winter light, shallow depth of field',
  },
  {
    zh: '关键瞬间：最后一张纸放进盒子，盖子合上',
    scene: 'v4-15',
    en: 'Close up of hands placing a last sheet of paper into a wooden box, lid half closed, snow light, shallow depth of field',
  },
  {
    zh: '关键瞬间：盒子被推到桌子对面',
    scene: 'prologue',
    en: 'Close up of a wooden box being pushed across a table toward the far side, dust moving, dim winter light, shallow depth of field',
  },
  {
    zh: '关键瞬间：两只手在桌沿上握住',
    scene: 'prologue',
    en: 'Close up of two weathered hands clasped on the edge of a wooden table, sleeves of grey padded jackets, dim winter light, shallow depth of field',
  },
  {
    zh: '关键瞬间：红纸对联被贴上门框，手抚平',
    scene: 'v3-13',
    en: 'Close up of a hand smoothing a red paper strip onto a wooden door frame, paste glistening, dim winter light, shallow depth of field',
  },
  {
    zh: '关键瞬间：碗里最后一口水喝完，碗放下',
    scene: 'v1-09',
    en: 'Close up of a tin cup being set down empty on gravel beside a mess tin, dry crumbs, dusk light, shallow depth of field',
  },
  {
    zh: '关键瞬间：干粮掰成两半，一半递过去',
    scene: 'v1-09',
    en: 'Close up of hands breaking a dry ration in half, crumbs falling, one half passed to a second hand, dusk light, shallow depth of field',
  },
  {
    zh: '关键瞬间：伤员名单折成四折，塞进口袋',
    scene: 'night2',
    en: 'Close up of a list of names being folded twice and pushed into a jacket pocket, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：头发塞进军帽，帽檐压低',
    scene: 'v1-02',
    en: 'Close up of hands tucking hair under a grey cloth cap, no face visible, morning light, shallow depth of field',
  },
  {
    zh: '关键瞬间：扣子系到最上面一颗',
    scene: 'v2-01',
    en: 'Close up of hands fastening the top button of a grey cotton uniform, coarse cloth and wooden button, dim light, shallow depth of field',
  },
  {
    zh: '关键瞬间：手在雪里按出一个手印，又抹掉',
    scene: 'v3-11',
    en: 'Close up of a hand pressing into fresh snow, leaving a print, then smoothing it away, cold grey light, shallow depth of field',
  },
  {
    zh: '关键瞬间：旗绳在手臂上绕两圈，攥住',
    scene: 'v2-25',
    en: 'Close up of a thin rope wound twice around a forearm and gripped in a fist, dawn haze, shallow depth of field',
  },
  {
    zh: '关键瞬间：照片举到光里，正面慢慢看清',
    scene: 'v4-07',
    en: 'Close up of two hands holding a small photograph up to the light, blurred figures, dust in the air, shallow depth of field',
  },
  {
    zh: '关键瞬间：录音键按下去，红灯亮起',
    scene: 'v4-05',
    en: 'Close up of a finger pressing the record key of an old tape recorder, reels beginning to turn, dust, cold window light',
  },
  {
    zh: '关键瞬间：刻刀在石头上收最后一刀',
    scene: 'v4-12',
    en: 'Close up of a chisel finishing a carved mark on a rough stone, stone dust falling, one hand only, overcast light, extreme close view',
  },
]

/**
 * moment prompt 覆盖层（r5）：实测 4-step Lightning 对"过程动作"（笔尖落纸/针穿线/纸塞进竹篙）
 * 还原不稳定，会退化成"手放在某处 + 一盏灯"。改为**物为主语 + 动作结果**的静态句，
 * 手只作为画面边缘元素，不出现脸/远处人影。key = MOMENTS 数组序号（1-based）。
 */
const MOMENT_OVERRIDES = {
  1: { en: 'A worn writing brush resting on a sheet of rough paper, one dark ink dot spreading into the fibers, ink stone beside it, lamplight from the left' },
  2: { en: 'A sewing needle stuck through thick grey cotton lining, coarse dark thread trailing to a knotted end, a worn paper edge underneath, warm lamplight' },
  3: { en: 'A rolled paper slip half pushed into the split end of a bamboo pole, frayed paper edge, dry bamboo fibers, dim indoor light' },
  4: { en: 'A stub pencil lying across a half finished list of blurred names, one incomplete line, dim side light, rough paper' },
  5: { en: 'Two bundles of folded letters tied with hemp string on a wooden table, worn paper edges, dim warm lamplight' },
  6: { en: 'A half eaten piece of dry ration beside an open cloth bag, coarse crumbs on a wooden surface, dim light' },
  7: { en: 'A strip of grey puttee cloth tied to a thin rope around a bamboo joint, rough knots, dawn haze behind' },
  8: { en: 'The back of a small black and white photograph with faint blurred writing, a fountain pen resting beside it, dim lamplight' },
  9: { en: 'A folded sheet of paper wedged under a stone on a wet iron railing, raindrops on the iron, dim lamplight beyond' },
  10: { en: 'A small folded paper booklet half pushed under the insole of a worn cloth shoe, dirt on the cloth, dim dawn light' },
  11: { en: 'An iron chopstick lifting the last glowing charcoal from a brazier, ash falling, cold dim room' },
  12: { en: 'A dark padded jacket front with a stiff paper edge showing under the cloth, a hand pressed flat over it, dim winter light' },
  13: { en: 'A small empty circle drawn in ink on a name roster, brush resting beside it, lamp light from the left' },
  14: { en: 'A wet fingertip smoothing a crease in brittle old paper, fibers lifting, lamplight, extreme close view' },
  15: { en: 'A single finger resting on a column of blurred ink names, rough paper fibers, harsh daylight' },
  16: { en: 'A folded paper slip tucked inside a worn cloth shoe, coarse cloth fibers, morning light, one hand at the edge' },
  17: { en: 'A hollow bamboo pole held upright, a rolled paper slip visible inside, dry fibers, dim light' },
  18: { en: 'A small iron key on a linen cord hanging against grey cloth, rusted bit, dim lamplight' },
  19: { en: 'A paper booklet pushed into the open mouth of a rice sack, coarse burlap, hemp rope beside, dim lantern light' },
  20: { en: 'A small paper booklet on dark concrete, a hand reaching toward it, faint window light, dust in the air' },
  21: { en: 'A worn page with one blurred character scraped away, the paper surface furred, a brush on the ink stone, lamplight' },
  22: { en: 'The torn corner of a folded letter revealing blurred ink strokes, a hand holding it, dim light' },
  23: { en: 'Twelve loose pages torn from a thread bound booklet, ragged edges, on a wooden crate, lamplight' },
  24: { en: 'Two bundles of letters inside the open lining of a padded jacket, wooden buttons, dim light' },
  25: { en: 'A folded list of names passing between two worn hands, dim lamplight, shallow depth of field' },
  26: { en: 'A bamboo pole braced against a concrete parapet, one hand steadying it, dawn haze behind' },
  27: { en: 'A red cloth corner with rough hand stitching pinched between thumb and finger, dawn light' },
  28: { en: 'A strip of grey puttee cloth half unwound, coarse weave, dim light, no face' },
  29: { en: 'A thin rope wound twice around a bamboo joint, a cloth strip tied at the end, dawn haze' },
  30: { en: 'A pencil drawing straight lines on the back page of a booklet, faint marks, lamplight' },
  31: { en: 'Two hands cupped beside a mouth at the edge of frame, river haze beyond, no face' },
  32: { en: 'A stub pencil resting above a page with a half written list, faint marks, dim side light' },
  33: { en: 'A thin roster page beside an open ledger with blurred copied names, ink brush, dim light' },
  34: { en: 'A small black and white photograph with dust wiped from one corner, blurred figures, dim light' },
  35: { en: 'A small photograph half inside an envelope, flap open, on a wooden table, dim lamplight' },
  36: { en: 'A small red cloth flag with rough stitching pressed between booklet pages, dim light' },
  37: { en: 'A dry ration broken in two beside a cloth wrapper, crumbs on a wooden surface, dim light' },
  38: { en: 'A hand gripping a coarse trouser leg, knuckles pale, dim emergency light' },
  39: { en: 'A small paper booklet passing from one hand to another, fingers still curled on the edge, dim light' },
  40: { en: 'A worn cloth shoe with the insole lifted, a folded booklet underneath, dawn light' },
  41: { en: 'A rifle laid on wet stone beside a row of others, dim dawn light, iron railings' },
  42: { en: 'A hand moving across rows of blurred name plaques on a plaster wall, dust, dim light' },
  43: { en: 'A needle held above red cloth above a sewing basket, thread trailing, museum workbench, window light' },
  44: { en: 'A magnifying glass over blurred columns on a gazetteer page, one hand at the edge, desk lamp light' },
  45: { en: 'Fingertips tracing carved marks on grey stone, stopping on one groove, dust, cold light' },
  46: { en: 'A small tape box slid onto a metal archive shelf, blurred paper label, dim light' },
  47: { en: 'A small bunch of flowers laid at the base of a bronze statue, stone plinth, evening light' },
  48: { en: 'A brown paper parcel tied with string on a post office counter, one hand beside it, daylight' },
  49: { en: 'A wrapped paper booklet being drawn out of a hole in a brick wall, dust, dim light' },
  50: { en: 'A blue cloth unfolded on a table revealing a thin worn booklet, winter window light' },
  51: { en: 'A plain cloth collar tab half unpinned from a grey uniform, frayed threads, dim light' },
  52: { en: 'A hand brushing snow off a flagstone, dark wet stone appearing, low winter light' },
  53: { en: 'A hand adjusting a kerosene lamp wick, flame growing, warm light on a concrete wall' },
  54: { en: 'A canvas ammunition belt hooked over a shoulder, brass casings, dim light' },
  55: { en: 'Hands tying off a sandbag with hemp rope, burlap texture and spilled sand, dim work light' },
  56: { en: 'A piece of chalk drawing a cross on an iron door, white dust, dim light' },
  57: { en: 'A hand turning a field telephone crank, cloth insulated wire coiled, dim light' },
  58: { en: 'A folded map tucked inside a jacket, one corner still visible, pencil marks, dim light' },
  59: { en: 'A paper megaphone handed through a window frame, one hand, river haze beyond' },
  60: { en: 'A cord pulled tight around a bundle of letters and packages, dim light' },
  61: { en: 'A small cigarette packet falling onto wet stone, water splashing, night' },
  62: { en: 'Hands raising binoculars at a windowsill, river haze beyond, no face' },
  63: { en: 'A broken pencil tip on a notebook page, a fingernail mark instead, dusk light' },
  64: { en: 'A small photograph turned face down on a wooden table, faint pencil lines on the back' },
  65: { en: 'A bamboo pole tilted, a rolled paper slip sliding out into a waiting hand, dim light' },
  66: { en: 'A small knife shaving a pencil stub, wood curls and graphite dust, lamplight' },
  67: { en: 'Ink pouring from a small bottle into an ink stone, last dark drop, lamplight' },
  68: { en: 'Letters sorted into two stacks on a table, blurred ink, dim lamplight' },
  69: { en: 'A plain grey military cap set straight on a folded blanket, no insignia, dim light' },
  70: { en: 'A straw mat rolled and tied with rope, loose straw sticking out, dim light' },
  71: { en: 'A hand smoothing a white cloth over a plain wooden coffin lid, fibers catching light, overcast' },
  72: { en: 'A hand brushing frost off barbed wire, ice crystals falling, cold morning' },
  73: { en: 'A folded red paper packet opened to reveal a small bar of soap, dim light' },
  74: { en: 'A worn ball above a rough wooden backboard, iron ring without a net, overcast light' },
  75: { en: 'A cloth wiping half a line of blurred chalk marks off a blackboard, chalk dust in the air' },
  76: { en: 'A cloth bag tipped over, letters sliding onto a wooden table, string and paper, dim light' },
  77: { en: 'A brittle page dipped in shallow water, ink stains loosening, one hand, extreme close view' },
  78: { en: 'A clear patch wiped in breath frost on a paper lattice window, snow outside, cold light' },
  79: { en: 'A straw broom leaning against a door frame, snow dust falling, cold morning light' },
  80: { en: 'A hand pressing a worn ledger closed, embossed cover smooth, dim light' },
  81: { en: 'A paper slip folded into a small square, the fourth fold completed, dim light' },
  82: { en: 'A pencil stub tucked behind an ear position at the edge of frame, dim light, no face' },
  83: { en: 'Red cloth rolled tightly around a bamboo pole, hands steadying it, daylight' },
  84: { en: 'A thread end bitten off above stitching in cloth, needle still in the fabric, lamplight' },
  85: { en: 'A pencil tip pressing a mark on a worn map, paper fibers indenting, dim light' },
  86: { en: 'A booklet lowered into a wooden chest, blue cloth folded back, winter light' },
  87: { en: 'A last sheet of paper placed into a wooden box, lid half closed, snow light' },
  88: { en: 'A wooden box pushed across a table toward the far side, dust moving, winter light' },
  89: { en: 'Two clasped weathered hands on the edge of a wooden table, grey padded jacket cuffs, winter light' },
  90: { en: 'A hand smoothing a red paper strip onto a wooden door frame, paste glistening, winter light' },
  91: { en: 'An empty tin cup set down on gravel beside a mess tin, dry crumbs, dusk light' },
  92: { en: 'A dry ration broken in two, one half passed toward a second hand, crumbs falling, dusk light' },
  93: { en: 'A list of names folded twice and pushed into a jacket pocket, dim light' },
  94: { en: 'Hair tucked under a grey cloth cap at the edge of frame, no face, morning light' },
  95: { en: 'A uniform collar button being fastened, coarse grey cloth, wooden button, dim light' },
  96: { en: 'A handprint pressed into fresh snow, cold grey light, one hand' },
  97: { en: 'A thin rope wound twice around a forearm and gripped in a fist, dawn haze' },
  98: { en: 'A small photograph held up to the light, blurred figures, dust in the air' },
  99: { en: 'A finger pressing the record key of an old tape recorder, reels starting to turn, dust, cold light' },
  100: { en: 'A chisel finishing a carved mark on a rough stone, stone dust falling, overcast light' },
}

/** 文物档案：80 条，平铺俯拍，文字一律虚焦。 */
const ARTIFACTS = [
  {
    zh: '文物：名册内页，毛边纸、栏格、褪色墨迹',
    en: 'Top down flat lay of a small thread bound roster book, rough edged paper, faint columns of faded ink marks, water stains and a bent corner, dark wooden table, soft side light',
  },
  {
    zh: '文物：衣襟里的册子残页，血干透成锈色',
    en: 'Top down flat lay of stained brittle paper scraps sewn inside a torn jacket lining, dark dried rust colored stains, coarse stitching, grey cotton cloth, soft daylight',
  },
  {
    zh: '文物：三十七封家书，麻绳捆成两扎',
    en: 'Top down flat lay of thirty seven folded letters tied in two bundles with hemp string, yellowed paper, soft brush writing blurred out of focus, wooden table, side light',
  },
  {
    zh: '文物：报纸头版，标题只剩一块黑',
    en: 'Top down flat lay of a folded 1937 Chinese newspaper, heavy black headline block completely out of focus, yellowed coarse paper, oil lamp light from the side',
  },
  {
    zh: '文物：铅笔头、墨与毛边纸',
    en: 'Top down flat lay of a worn pencil stub, a small ink stone and a broken ink stick on a sheet of rough paper, faint smudges, side light, shallow depth of field',
  },
  {
    zh: '文物：铁柜钥匙，挂绳被汗浸深',
    en: 'Top down flat lay of an old iron key on a length of cotton cord, rust at the bit, lying on grey concrete, hard side light, close shot',
  },
  {
    zh: '文物：巴掌大的小旗，红布针脚，没有任何图案',
    en: 'Top down flat lay of a palm sized red cloth flag with rough uneven stitching, no emblem and no pattern, deep fold creases, set on coarse grey cloth, soft light',
  },
  {
    zh: '文物：合影背面，两个铅笔圈',
    en: 'Top down flat lay of a small black and white group photograph face down on a wooden table, faint blurred pencil marks on the back, torn corner, side light',
  },
  {
    zh: '文物：花名册封面，布面磨损，线装书脊',
    en: 'Top down flat lay of a thread bound roster book cover, worn cloth binding, exposed stitching on the spine, water stains, dark wooden table, soft light',
  },
  {
    zh: '文物：名册最后一页，还剩半页空白',
    en: 'Top down flat lay of the last page of a name roster, half filled with blurred ink marks, remaining half blank and aged, side light, shallow depth of field',
  },
  {
    zh: '文物：撕下来的册页，撕口毛糙',
    en: 'Top down flat lay of a torn page from a small booklet, ragged fibrous edge, blurred columns of ink, on grey concrete, hard side light',
  },
  {
    zh: '文物：补页——后来添上的名字，墨色更深',
    en: 'Top down flat lay of an added page with darker fresher ink entries beside older faded ones, rough paper, lamplight, shallow depth of field',
  },
  {
    zh: '文物：册页栏格特写，一格一个名字的空间',
    en: 'Top down extreme close view of ruled columns on rough paper, empty and blurred ink entries in equal measure, paper fibers, soft side light',
  },
  {
    zh: '文物：一道折过的命令纸，折痕发白',
    en: 'Top down flat lay of a folded order paper, white crease lines worn through the paper, blurred stamp mark, dim light, shallow depth of field',
  },
  {
    zh: '文物：县志一览表的横列，墨色已灰',
    en: 'Top down flat lay of a gazetteer table page, blurred rows and columns of grey ink, ruled lines, magnified fibers, cold light',
  },
  {
    zh: '文物：通城籍名单一页，四十九行',
    en: 'Top down flat lay of a list of names in blurred ink, many short rows, rough paper, one corner curled, side light',
  },
  {
    zh: '文物：孤军营用的花名册，纸比原来薄',
    en: 'Top down flat lay of a thin worn roster book, grey paper, faint blurred columns, cloth cover, dim interior light',
  },
  {
    zh: '文物：学字本，横竖撇捺只写了一半',
    en: 'Top down flat lay of a writing exercise book, blurred brush strokes on ruled squares, ink stains, worn corners, dim light',
  },
  {
    zh: '文物：口述记录稿，铅笔字一行压一行',
    en: 'Top down flat lay of manuscript pages with blurred pencil lines overlapping, a pencil stub, paperclips rusted, cold light',
  },
  {
    zh: '文物：借阅登记卡，日期栏空着',
    en: 'Top down flat lay of a library borrowing card in a wooden drawer, blurred date columns mostly empty, one stamped mark, dim light',
  },
  {
    zh: '文物：一盒录音带，标签被手摸浅了',
    en: 'Top down flat lay of a small tape box with a worn paper label, blurred handwriting, dust, cold window light, close shot',
  },
  {
    zh: '文物：磁带上的标签，编号只看得清一半',
    en: 'Top down extreme close view of a tape reel label with blurred numbers, yellowed paper, dust specks, cold light',
  },
  {
    zh: '文物：旗样图纸，长宽与针脚画成线条',
    en: 'Top down flat lay of a paper drawing of a flag, rectangle outline with measurement marks, pencil lines, fold creases, lamplight',
  },
  {
    zh: '文物：纪念馆的回信，纸是新的，字是打印的',
    en: 'Top down flat lay of a typed reply letter, blurred lines of text, clean white paper contrasting with an old photograph beside it, soft light',
  },
  {
    zh: '文物：馆藏登记页，贴着一张照片和一角布',
    en: 'Top down flat lay of a museum registration page with a small photograph and a scrap of red cloth attached, blurred entries, cold light',
  },
  {
    zh: '文物：印章的红痕，边缘不齐',
    en: 'Top down extreme close view of a square red seal imprint on rough paper, uneven ink coverage, blurred strokes, shallow depth of field',
  },
  {
    zh: '文物：试笔纸，一行行乱画的墨线',
    en: 'Top down flat lay of a scrap of paper covered with trial brush strokes and ink blots, one brush beside it, lamplight',
  },
  {
    zh: '文物：写坏的一张，揉了又展平',
    en: 'Top down flat lay of a crumpled then flattened page, deep fold lines, blurred ink, rough paper, side light',
  },
  {
    zh: '文物：家书的信封，邮票被雨水泡过',
    en: 'Top down flat lay of an old envelope with a water stained stamp, blurred address lines, rough paper, dim light',
  },
  {
    zh: '文物：没写完的信，笔停在最后一行',
    en: 'Top down flat lay of a half written letter, blurred brush strokes ending mid line, brush resting across the page, lamplight',
  },
  {
    zh: '文物：三封信叠在一起，压着一块石头',
    en: 'Top down flat lay of three folded letters stacked under a smooth stone weight, worn paper edges, dim light',
  },
  {
    zh: '文物：代笔的几封信，字迹是同一个人的',
    en: 'Top down flat lay of several letters in the same blurred handwriting, different paper, a pencil beside, dim lamplight',
  },
  {
    zh: '文物：慰问信一叠，纸角被雨打皱',
    en: 'Top down flat lay of a stack of comfort letters with rain crinkled corners, blurred ink, coarse paper, dim light, shallow depth of field',
  },
  {
    zh: '文物：明信片，正面图案已经看不出',
    en: 'Top down flat lay of an old postcard, printed image faded into grey, blurred message lines, worn corner, dim light',
  },
  {
    zh: '文物：电报稿，字少得可怜',
    en: 'Top down flat lay of a short telegram form, few blurred characters, ruled boxes, yellowed paper, hard side light',
  },
  {
    zh: '文物：请安帖，红纸黑字，折成三折',
    en: 'Top down flat lay of a folded red paper greeting card, blurred ink strokes, deep fold lines, warm light',
  },
  {
    zh: '文物：灰布军装上衣，领口磨白',
    en: 'Top down flat lay of a grey cotton military jacket, collar worn pale, plain cloth buttons, no insignia, soft daylight',
  },
  {
    zh: '文物：灰布军帽，帽檐压过形',
    en: 'Top down flat lay of a grey cloth military cap, deformed brim, plain cloth, no insignia, dust, side light',
  },
  {
    zh: '文物：一副绑腿布，卷成两卷',
    en: 'Top down flat lay of two rolls of grey puttee cloth, coarse weave, loose thread ends, concrete surface, side light',
  },
  {
    zh: '文物：一双布鞋，鞋底磨穿了前掌',
    en: 'Top down flat lay of a pair of worn cloth shoes, front soles worn through, mud stains, coarse sole stitching, soft light',
  },
  {
    zh: '文物：一双草鞋，草绳还带着泥',
    en: 'Top down flat lay of a pair of straw sandals, straw rope frayed and mud stained, dried grass bits, dim light',
  },
  {
    zh: '文物：军帽里的汗渍，布已经发硬',
    en: 'Top down extreme close view of the inside band of a grey cloth cap, sweat stains and stiffened fabric, plain, dim light',
  },
  {
    zh: '文物：帆布弹带，铜扣氧化成暗绿',
    en: 'Top down flat lay of a canvas ammunition belt, brass buckles oxidized dark green, coarse webbing, hard side light',
  },
  {
    zh: '文物：一条旧腰带，扣眼被磨大',
    en: 'Top down flat lay of an old leather belt, worn buckle, stretched holes, cracks in the leather, dim light',
  },
  {
    zh: '文物：棉袄夹层被拆开，露出里子',
    en: 'Top down flat lay of a padded jacket opened at the lining, grey cotton wadding showing, coarse stitches, soft daylight',
  },
  {
    zh: '文物：针线包，一卷黑线，两根针',
    en: 'Top down flat lay of a small cloth sewing kit, one spool of black thread, two needles, a thimble, dim light',
  },
  {
    zh: '文物：盖棺的白布一角，布边没有缝完',
    en: 'Top down flat lay of the corner of a white burial cloth, unfinished hem, coarse weave, cold light, shallow depth of field',
  },
  {
    zh: '文物：一块红布，折成四折，针脚在边上',
    en: 'Top down flat lay of red cloth folded in four, crude stitched hem visible, no emblem, coarse linen surface, soft light',
  },
  {
    zh: '文物：针脚特写，线是双股，走得歪',
    en: 'Top down extreme close view of stitching on red cloth, double thread, uneven path, fabric fibers, warm light',
  },
  {
    zh: '文物：两根接起来的竹竿，绑腿布还缠着',
    en: 'Top down flat lay of two bamboo poles joined end to end, grey cloth strips wrapped at the joint, dry bamboo fibers, daylight',
  },
  {
    zh: '文物：旗绳与绳结，绳子磨得起毛',
    en: 'Top down flat lay of a thin worn rope with several knots, frayed fibers, coiled on grey concrete, side light',
  },
  {
    zh: '文物：旗竿顶上的一个布结',
    en: 'Top down extreme close view of a cloth knot at the top of a bamboo pole, red thread ends, bamboo grain, daylight',
  },
  {
    zh: '文物：红布的布角，经纬线看得见',
    en: 'Top down extreme close view of a red cloth corner, visible warp and weft threads, crude hem, raking light',
  },
  {
    zh: '文物：军用水壶，壶身凹了一块',
    en: 'Top down flat lay of a dented tin canteen, canvas strap, rust spots, hard side light, shallow depth of field',
  },
  {
    zh: '文物：搪瓷饭盒，盖子磕掉一块瓷',
    en: 'Top down flat lay of an enamel mess tin, chipped enamel on the lid, dark metal showing, a spoon beside it, side light',
  },
  {
    zh: '文物：搪瓷碗，碗底有一圈水垢',
    en: 'Top down flat lay of a chipped enamel bowl, water ring stains inside, worn rim, grey concrete surface, soft light',
  },
  {
    zh: '文物：刺刀，刃口有缺口，柄上缠布',
    en: 'Top down flat lay of a bayonet with a nicked blade, cloth wrapped handle, rust at the guard, grey concrete, hard side light',
  },
  {
    zh: '文物：黄铜弹壳，底火有击针印',
    en: 'Top down flat lay of several brass shell casings, primer dents visible, tarnish and dust, concrete surface, side light',
  },
  {
    zh: '文物：铁锹插在沙堆里，木柄开裂',
    en: 'Top down flat lay of an iron shovel lying beside spilled sand, cracked wooden handle, coarse grains, dim work light',
  },
  {
    zh: '文物：马灯，玻璃罩上有一道裂纹',
    en: 'Top down flat lay of a kerosene hurricane lantern, cracked glass globe, soot on the metal, dim light, close shot',
  },
  {
    zh: '文物：煤油灯与灯花，灯芯烧黑了一截',
    en: 'Top down flat lay of a small kerosene lamp, blackened wick, soot on the glass, warm rim light, close shot',
  },
  {
    zh: '文物：砚台，墨池里结了一层干壳',
    en: 'Top down flat lay of an ink stone, dried ink crust in the well, a broken ink stick beside it, rough paper, side light',
  },
  {
    zh: '文物：毛笔，笔尖的墨硬了',
    en: 'Top down flat lay of a writing brush, ink hardened at the tip, bamboo shaft cracked, ink stone nearby, dim light',
  },
  {
    zh: '文物：一只铁盒，盖子合着，锈在缝里',
    en: 'Top down flat lay of a small iron box with a closed lid, rust along the seams, dented corner, concrete surface, side light',
  },
  {
    zh: '文物：缝衣针别在布上，旁边一小段线',
    en: 'Top down extreme close view of a sewing needle pinned in grey cloth, a short length of coarse thread, fine dust, warm light',
  },
  {
    zh: '文物：一只木箱，箱角包着铁皮',
    en: 'Top down flat lay of a wooden document chest, iron corner reinforcements, worn hinges, dust, soft light',
  },
  {
    zh: '文物：一盒洋火，盒面磨得看不出图案',
    en: 'Top down flat lay of a small matchbox, printed surface worn blank, a few matches beside it, concrete, side light',
  },
  {
    zh: '文物：野战电话，摇柄包着布',
    en: 'Top down flat lay of a black field telephone, crank handle wrapped in cloth, coiled wire, dust, dim light',
  },
  {
    zh: '文物：1930 年代上海地图，街道线还看得清',
    en: 'Top down flat lay of a 1930s Shanghai street map, blurred lettering, visible street lines, fold creases, yellowed paper',
  },
  {
    zh: '文物：一包香烟，盒子压扁了',
    en: 'Top down flat lay of a flattened cigarette packet, faded printed design, torn corner, dim light, shallow depth of field',
  },
  {
    zh: '文物：饼干罐，铁皮盖凹进去',
    en: 'Top down flat lay of a dented biscuit tin, faded label, crumbs inside, concrete surface, side light',
  },
  {
    zh: '文物：一本账簿，翻到中间一页',
    en: 'Top down flat lay of an opened account ledger, blurred columns and rows, ink brush beside it, dim light',
  },
  {
    zh: '文物：孤军营的木牌，名字已经看不清',
    en: 'Top down flat lay of a small wooden name plaque, blurred engraved marks, nail holes, dust, side light',
  },
  {
    zh: '文物：1982 年的录音机，按键磨圆了',
    en: 'Top down flat lay of an old reel to reel tape recorder, rounded worn keys, dust on the case, cold window light',
  },
  {
    zh: '文物：两盘磁带，磁带丝松了',
    en: 'Top down flat lay of two tape reels, loose magnetic tape unspooled beside them, cold light, shallow depth of field',
  },
  {
    zh: '文物：纪念馆的纪念章，盒子开着',
    en: 'Top down flat lay of a small commemorative medal in an open box, blurred engraved surface, red cloth lining, soft light',
  },
  {
    zh: '文物：铜像的铭牌，字是铸的，磨得发亮',
    en: 'Top down flat lay of a cast bronze plaque on stone, blurred raised characters polished bright, cold light',
  },
  {
    zh: '文物：一束花放在石台上，包装纸还湿着',
    en: 'Top down flat lay of a small bunch of flowers sealed in wet paper on a stone ledge, petals, cold light, shallow depth of field',
  },
  {
    zh: '文物：一只旧相框，玻璃下压着合影',
    en: 'Top down flat lay of a wooden photo frame, glass covering a blurred group photograph, dust in the corners, soft light',
  },
  {
    zh: '文物：半块干粮，硬得能敲响',
    en: 'Top down flat lay of a piece of hard dry ration, cracked surface, cloth bag beside it, crumbs, dim light',
  },
]

/** 人物剪影：60 条，竖幅，背影/远景，不出现脸。 */
const FIGURES = [
  {
    zh: '人物剪影：陈望生雪中背影，跛脚，一根手杖',
    en: 'A lone man in a dark padded jacket walking away on a snow covered stone street, slight limp, walking stick, seen from behind at a distance, low winter sun, long shadow, 1947 Chinese county town',
  },
  {
    zh: '人物剪影：在墙上写名字的兵，背对镜头',
    en: 'A lone soldier in grey cotton uniform seen from behind, writing on a wall with a brush, distant, dusk light, dust haze, full body silhouette',
  },
  {
    zh: '人物剪影：门口点人的谢晋元，远处一盏灯',
    en: 'A lone officer standing in the doorway of a concrete warehouse giving orders, seen from behind at a distance, dim lamp light, smoke haze, full body silhouette',
  },
  {
    zh: '人物剪影：送旗的少年在河边，湿衣贴背',
    en: 'A lone thin figure standing at the edge of a dark river at night, wet clothes clinging to the back, seen from behind at a distance, distant lights out of focus, full body silhouette',
  },
  {
    zh: '人物剪影：2005，周福其跪在铜像前',
    en: 'A lone old man seen from behind, kneeling before a bronze statue in a museum courtyard, 2005, low evening light, distant, full body silhouette',
  },
  {
    zh: '人物剪影：英名墙前的后人，抬手摸那面墙',
    en: 'A lone young person seen from behind standing before a vast stone memorial wall, one hand raised toward the wall, cold daylight, distant, full body silhouette',
  },
  {
    zh: '人物剪影：1937 年，年轻的陈望生站在仓库窗前',
    en: 'A lone young soldier seen from behind at a distance, standing at a warehouse window at night, rifle leaning beside him, dim lamplight',
  },
  {
    zh: '人物剪影：1947 年，陈望生伏在桌上写册子',
    en: 'A lone man seen from behind at a distance, bent over a table writing in a small booklet, winter lamp light, snow beyond the window',
  },
  {
    zh: '人物剪影：老年陈望生站在县志库房门口',
    en: 'A lone old man seen from behind at a distance, standing at the door of a county archive room, walking stick, cold light',
  },
  {
    zh: '人物剪影：杨瑞符俯身在地图前',
    en: 'A lone officer seen from behind at a distance, leaning over a map on a crate, lantern light, deep shadows on concrete',
  },
  {
    zh: '人物剪影：谢晋元站在楼顶，风把衣角掀起来',
    en: 'A lone officer seen from behind at a distance, standing on a warehouse rooftop in wind, coat edge lifting, smoke filled dawn',
  },
  {
    zh: '人物剪影：谢晋元在门口一个一个点人',
    en: 'A lone officer seen from behind at a distance, standing in a warehouse doorway counting men, lantern on the ground, rain beyond',
  },
  {
    zh: '人物剪影：陈树生站在五楼窗口，背对镜头',
    en: 'A lone soldier seen from behind at a distance, standing at a fifth floor window of a warehouse, smoke outside, cold light on his back',
  },
  {
    zh: '人物剪影：杨惠敏湿着衣服站在河岸',
    en: 'A lone thin figure seen from behind at a distance, standing at a dark riverbank with wet clothes, distant lights in mist',
  },
  {
    zh: '人物剪影：杨惠敏把包袱递出去',
    en: 'A lone thin figure seen from behind at a distance, holding out a small cloth bundle, night river beyond, dim light',
  },
  {
    zh: '人物剪影：记者举着折叠相机在窗边',
    en: 'A lone reporter seen from behind at a distance, holding a folding bellows camera at a riverside window, dusk light',
  },
  {
    zh: '人物剪影：同乡会长站在会馆门口',
    en: 'A lone older man seen from behind at a distance, standing at a guild hall doorway holding a paper list, dim interior light',
  },
  {
    zh: '人物剪影：老母亲站在村口，手里攥着布包',
    en: 'A lone old woman seen from behind at a distance, standing at a village gate holding a cloth bundle, early morning light',
  },
  {
    zh: '人物剪影：兵蹲在墙根往墙上写字',
    en: 'A lone soldier seen from behind at a distance, crouching at a plaster wall writing with a brush, dim light and dust',
  },
  {
    zh: '人物剪影：兵站在桥头，前面是雾',
    en: 'A lone soldier seen from behind at a distance, standing at the head of a fog covered bridge, gear on his back, cold dawn light',
  },
  {
    zh: '人物剪影：兵扛着沙袋往墙根走',
    en: 'A lone soldier seen from behind at a distance, carrying a sandbag toward a warehouse wall, dust and smoke, hard light',
  },
  {
    zh: '人物剪影：机枪手趴在楼梯口',
    en: 'A lone soldier seen from behind at a distance, lying behind sandbags at the top of a concrete staircase, dim light from below',
  },
  {
    zh: '人物剪影：伤兵靠墙坐着，一条腿伸着',
    en: 'A lone wounded soldier seen from behind at a distance, sitting against a concrete wall with one leg stretched out, dim lamplight',
  },
  {
    zh: '人物剪影：医务兵低头缠绷带',
    en: 'A lone medic seen from behind at a distance, bent over bandaging, single bulb light, deep shadow',
  },
  {
    zh: '人物剪影：孤军营的兵站在铁丝网前',
    en: 'A lone soldier seen from behind at a distance, standing before barbed wire in a factory courtyard, wet ground, overcast light',
  },
  {
    zh: '人物剪影：孤军营列队，一排背影',
    en: 'A row of soldiers seen from behind at a distance, standing in line in a fenced factory courtyard, grey sky, full body silhouettes',
  },
  {
    zh: '人物剪影：铁丝网外的岗亭，卫兵远远站着',
    en: 'A lone guard seen from behind at a distance, standing by a small guard post beyond barbed wire, lantern light, overcast',
  },
  {
    zh: '人物剪影：孤军营升旗，兵仰头看旗',
    en: 'A lone soldier seen from behind at a distance, looking up at a red cloth flag on a bamboo pole, grey sky, full body silhouette',
  },
  {
    zh: '人物剪影：兵站在木篮板下，球在手里',
    en: 'A lone soldier seen from behind at a distance, standing under a rough wooden backboard holding a worn ball, overcast light',
  },
  {
    zh: '人物剪影：兵站在黑板前，头微微低着',
    en: 'A lone soldier seen from behind at a distance, standing before a blackboard with blurred chalk marks, dust in window light',
  },
  {
    zh: '人物剪影：兵蹲在墙角读信',
    en: 'A lone soldier seen from behind at a distance, crouching in a corner reading a letter, dim light, dust in the air',
  },
  {
    zh: '人物剪影：女人抱着孩子站在桥头等',
    en: 'A lone woman seen from behind at a distance, standing at a bridgehead holding a child, fog over the river, cold light',
  },
  {
    zh: '人物剪影：报童背对镜头跑过街角',
    en: 'A lone newsboy seen from behind at a distance, running past a Shanghai street corner with newspapers under one arm, morning fog',
  },
  {
    zh: '人物剪影：市民在南岸往上扔东西',
    en: 'A lone civilian seen from behind at a distance, arm raised to throw a small packet over a river railing, night fog, dim lamplight',
  },
  {
    zh: '人物剪影：年轻人接过名单，手举在半空',
    en: 'A lone young man seen from behind at a distance, receiving a folded paper over a bridge railing, rain, dim light',
  },
  {
    zh: '人物剪影：记者抱着稿子往桥头跑',
    en: 'A lone reporter seen from behind at a distance, running toward a bridgehead with manuscript pages under one arm, dusk fog',
  },
  {
    zh: '人物剪影：2005 年，周福其站在铜像前',
    en: 'A lone old man seen from behind at a distance, standing before a bronze statue in a museum courtyard, evening light, full body silhouette',
  },
  {
    zh: '人物剪影：文化馆的人站在展柜前',
    en: 'A lone clerk seen from behind at a distance, standing before a wooden glass display case, dim interior light, full body silhouette',
  },
  {
    zh: '人物剪影：档案员站在铁架前，手里一只盒子',
    en: 'A lone archivist seen from behind at a distance, standing before a metal shelf holding a small tape box, cold light, full body silhouette',
  },
  {
    zh: '人物剪影：录音员对着话筒坐了一下午',
    en: 'A lone young recorder seen from behind at a distance, sitting before a microphone and tape recorder, cold window light, full body silhouette',
  },
  {
    zh: '人物剪影：县志编修者伏在案上，一盏灯',
    en: 'A lone editor seen from behind at a distance, bent over a table with papers and a lamp, winter night, full body silhouette',
  },
  {
    zh: '人物剪影：寻访者一个人走在乡间土路上',
    en: 'A lone walker seen from behind at a distance, on a muddy country road in light rain, a notebook under one arm, mist, full body silhouette',
  },
  {
    zh: '人物剪影：参观者站在英名墙前很久',
    en: 'A lone visitor seen from behind at a distance, standing before a vast stone memorial wall, cold daylight, full body silhouette',
  },
  {
    zh: '人物剪影：小孩抬手指着墙上的一个名字',
    en: 'A lone child seen from behind at a distance, one arm raised pointing at a stone memorial wall, cold light, full body silhouette',
  },
  {
    zh: '人物剪影：母亲抱着孩子看那面墙',
    en: 'A lone woman seen from behind at a distance, holding a small child before a stone memorial wall, soft cold light, full body silhouettes',
  },
  {
    zh: '人物剪影：后辈弯腰把花放在铜像脚下',
    en: 'A lone young person seen from behind at a distance, bending to lay flowers at the base of a bronze statue, evening light',
  },
  {
    zh: '人物剪影：少年站在河岸，看着对岸',
    en: 'A lone teenager seen from behind at a distance, standing at a modern riverbank looking across at an old warehouse, grey sky',
  },
  {
    zh: '人物剪影：老妇人站在门口，手里一封旧信',
    en: 'A lone old woman seen from behind at a distance, standing in a doorway holding an old letter, warm interior light behind her',
  },
  {
    zh: '人物剪影：老人蹲下去，看门缝里有没有信',
    en: 'A lone old man seen from behind at a distance, crouching to look under a wooden door, thin light along the floor',
  },
  {
    zh: '人物剪影：士兵仰头看被炸开的墙洞',
    en: 'A lone soldier seen from behind at a distance, looking up at a jagged hole in a concrete wall, light pouring through, dust',
  },
  {
    zh: '人物剪影：士兵扶着竹梯往楼顶爬',
    en: 'A lone soldier seen from behind at a distance, climbing a bamboo ladder toward a warehouse roof, smoke haze, backlit',
  },
  {
    zh: '人物剪影：士兵把竹竿举起来，墙在下面',
    en: 'A lone soldier seen from behind at a distance, lifting a bamboo pole above a concrete parapet, dawn haze, backlit',
  },
  {
    zh: '人物剪影：军号兵站在天亮前的院子里',
    en: 'A lone bugler seen from behind at a distance, standing in a factory courtyard before dawn, horn lowered, mist, full body silhouette',
  },
  {
    zh: '人物剪影：传令兵抱着命令纸在仓库里跑',
    en: 'A lone runner seen from behind at a distance, running through a concrete warehouse with a folded paper in hand, dim light',
  },
  {
    zh: '人物剪影：伙房兵蹲在灶前，烟很大',
    en: 'A lone cook seen from behind at a distance, crouching at a brick stove, smoke rising, warm glow on the wall, full body silhouette',
  },
  {
    zh: '人物剪影：文书坐在弹药箱上写东西',
    en: 'A lone clerk seen from behind at a distance, sitting on an ammunition crate writing, lantern light, deep shadows',
  },
  {
    zh: '人物剪影：少年兵靠着墙睡着了',
    en: 'A lone young soldier seen from behind at a distance, asleep sitting against a warehouse wall, dim light, full body silhouette',
  },
  {
    zh: '人物剪影：三个兵并排站在河边，都不说话',
    en: 'Three soldiers seen from behind at a distance, standing side by side at a river railing at dusk, full body silhouettes',
  },
  {
    zh: '人物剪影：一个人走进雪里，越走越远',
    en: 'A lone figure seen from behind at a distance, walking away into falling snow on a stone street, low winter sun, long shadow',
  },
  {
    zh: '人物剪影：参观者走下山墙，往街口去',
    en: 'A lone visitor seen from behind at a distance, walking away from a stone memorial wall toward a city street, cold daylight, full body silhouette',
  },
]

/** 结局插画：30 条 = 六结局 × 5 变体。 */
const ENDINGS = [
  {
    kind: 'roster',
    zh: '结局·名册 1/5：蓝布包好，放进县志木箱',
    en: 'Interior of a county archive room, a blue cloth wrapped roster book being placed into a wooden document chest, snow light through the window, dust motes, quiet',
  },
  {
    kind: 'letters',
    zh: '结局·家书 1/5：从门缝塞进去的最后一封',
    en: 'A single folded letter pushed through a gap under a wooden door, fallen leaves on the doorstep, afternoon light, quiet',
  },
  {
    kind: 'flag',
    zh: '结局·旗 1/5：红布与竹竿靠在白墙上',
    en: 'A piece of red cloth and a bamboo pole leaning against a whitewashed wall, creases and rough stitching visible, soft window light, quiet',
  },
  {
    kind: 'photo',
    zh: '结局·照片 1/5：照片正面，两个圈全是模糊',
    en: 'A small black and white photograph face up on a wooden table, two faint pencil circles beside indistinguishable figures, everything softly out of focus, dim lamplight',
  },
  {
    kind: 'testimony',
    zh: '结局·口述 1/5：1982 的录音机与磁带盒',
    en: 'An old reel to reel tape recorder in a county archive, 1982, bare tape reels, dust, cold window light, a numbered tape box out of focus, quiet',
  },
  {
    kind: 'message',
    zh: '结局·口信 1/5：村口石头上快要磨平的字',
    en: 'A rough stone at a village entrance with faint carved marks almost erased by weather, weeds around the base, overcast light, quiet',
  },
  // ——— 结局·名册 2/5—5/5 ———
  {
    kind: 'roster',
    zh: '结局·名册 2/5：县志铺开的蓝布上，册子放在正中',
    en: 'A thread bound booklet placed at the center of a spread blue cloth on a wooden table, winter window light, dust motes, quiet',
  },
  {
    kind: 'roster',
    zh: '结局·名册 3/5：档案馆铁架上的旧册，纸边发脆',
    en: 'An old booklet on a metal archive shelf, brittle edges, a paper tag blurred, cold light, quiet',
  },
  {
    kind: 'roster',
    zh: '结局·名册 4/5：四十九个名字的一页，被翻到中间',
    en: 'A single page of a worn roster book lying open, rows of faded ink marks blurred out of focus, lamplight, quiet',
  },
  {
    kind: 'roster',
    zh: '结局·名册 5/5：空了的县志木箱，箱底留着一层纸灰',
    en: 'An empty wooden document chest, a thin layer of paper dust in the bottom, snow light from the window, quiet',
  },
  // ——— 结局·家书 2/5—5/5 ———
  {
    kind: 'letters',
    zh: '结局·家书 2/5：十二封信一字排开在桌上',
    en: 'Twelve folded letters laid out in a row on a wooden table, worn edges, afternoon light through a window, quiet',
  },
  {
    kind: 'letters',
    zh: '结局·家书 3/5：一只老太太的手接住信',
    en: 'A worn letter held open above a wooden table, blurred ink lines, dim interior light, close shot, quiet',
  },
  {
    kind: 'letters',
    zh: '结局·家书 4/5：门缝底下的信，已经放了很久',
    en: 'A letter under a wooden door gap, dust on the paper, a thin line of light along the floor, quiet',
  },
  {
    kind: 'letters',
    zh: '结局·家书 5/5：纪念馆玻璃柜里的家书，字迹只剩一半',
    en: 'A folded letter in a museum glass case, half the ink faded away, soft display light, quiet',
  },
  // ——— 结局·旗 2/5—5/5 ———
  {
    kind: 'flag',
    zh: '结局·旗 2/5：一面红旗布晾在竹竿上，风把它吹直',
    en: 'A red cloth hanging on a bamboo pole in the wind, hand stitched hem, no emblem, grey daylight, quiet',
  },
  {
    kind: 'flag',
    zh: '结局·旗 3/5：旗的尺寸画在册子背面，只剩线条',
    en: 'A pencil drawing of a rectangle with measurement marks on the back page of a booklet, lamplight, quiet',
  },
  {
    kind: 'flag',
    zh: '结局·旗 4/5：纪念馆里，一面新缝的旗叠好放在托盘上',
    en: 'A newly sewn red cloth flag folded on a museum tray, hand stitching visible, no emblem, soft light, quiet',
  },
  {
    kind: 'flag',
    zh: '结局·旗 5/5：旗升到半空，逆光里只是一块红',
    en: 'A red cloth flag halfway up a bamboo pole, backlit against a pale sky, no emblem, distant, quiet',
  },
  // ——— 结局·照片 2/5—5/5 ———
  {
    kind: 'photo',
    zh: '结局·照片 2/5：馆藏登记册上别着那张照片',
    en: 'A small photograph pinned to a museum registration page, image out of focus, cold light, quiet',
  },
  {
    kind: 'photo',
    zh: '结局·照片 3/5：照片上十一个人，两个位置画了圈',
    en: 'A small black and white group photograph on a table, two faint pencil circles on the surface, everything softly out of focus, lamplight',
  },
  {
    kind: 'photo',
    zh: '结局·照片 4/5：回信放在照片旁边，两张纸',
    en: 'A typed letter beside a small photograph on a desk, both dimly lit, blurred lines, quiet',
  },
  {
    kind: 'photo',
    zh: '结局·照片 5/5：玻璃相框里的合影，反光遮住人脸',
    en: 'A small group photograph in a wood frame, glass reflection over the faces, indistinct, quiet',
  },
  // ——— 结局·口述 2/5—5/5 ———
  {
    kind: 'testimony',
    zh: '结局·口述 2/5：桌上一支话筒，三盘磁带排开',
    en: 'A microphone on a wooden table with three tape reels lined up, cold window light, dust, quiet',
  },
  {
    kind: 'testimony',
    zh: '结局·口述 3/5：磁带在机器里转，灯是红的',
    en: 'An old tape recorder with reels turning, a small red indicator glowing, dim archive room, quiet',
  },
  {
    kind: 'testimony',
    zh: '结局·口述 4/5：县档案馆的借阅登记卡，一张没写满',
    en: 'A library borrowing card in a wooden drawer, blurred handwritten lines, dim light, quiet',
  },
  {
    kind: 'testimony',
    zh: '结局·口述 5/5：录音机空转，磁带到了头',
    en: 'A reel to reel tape recorder at the end of a tape, one reel still, dust in the light, quiet',
  },
  // ——— 结局·口信 2/5—5/5 ———
  {
    kind: 'message',
    zh: '结局·口信 2/5：一块石头被搬到村口，草压平了一片',
    en: 'A rough stone set upright at a village entrance, flattened grass around its base, overcast light, quiet',
  },
  {
    kind: 'message',
    zh: '结局·口信 3/5：一只手在石头上刻字，石粉落在鞋上',
    en: 'A chisel and a stone mallet beside a roughly carved stone, stone dust on cloth shoes, overcast light, close shot',
  },
  {
    kind: 'message',
    zh: '结局·口信 4/5：石头上的字被孩子用手描了一遍',
    en: 'A rough stone with blurred carved marks, small handprints in the dust on its surface, dusk light, quiet',
  },
  {
    kind: 'message',
    zh: '结局·口信 5/5：村口石头的背面什么也没有',
    en: 'The back of a rough stone at a village entrance, blank and weathered, weeds, overcast light, quiet',
  },
]

/** 界面与纹理：60 条，1024×1024，无主体。 */
const UI = [
  {
    zh: '纹理：毛边纸纤维，暖灰，有零星霉点',
    en: 'Aged mulberry paper texture, visible fibers, warm grey, slight foxing stains, soft even light, abstract, no subject',
  },
  {
    zh: '纹理：墨在宣纸上洇开，一角压着红印',
    en: 'Ink wash bleeding into paper fibers, dark grey abstract spread with a single red seal smudge in one corner, no legible marks',
  },
  {
    zh: '纹理：模糊的方形朱印，墨色不匀',
    en: 'Faded square red seal imprint on rough paper, incomplete ink coverage, abstract, no legible characters',
  },
  {
    zh: '纹理：砖墙与水泥的接缝，锈痕',
    en: 'Weathered grey brick and concrete boundary, chipped mortar, a vertical rust streak, close texture, soft side light',
  },
  {
    zh: '纹理：1930 年代上海地图局部，字全虚成灰',
    en: 'Fragment of a 1930s Shanghai street map printed on thin paper, all lettering out of focus into grey texture, fold creases, warm grey tone',
  },
  {
    zh: '纹理：水面与雾的分界，远处一盏灯',
    en: 'Dark water surface with mist above, soft reflection of a distant lamp, abstract horizontal texture, muted palette',
  },
  {
    zh: '纹理：宣纸纤维，暖白，细看有帘纹',
    en: 'Aged xuan paper texture seen in raking light, fine fibers and faint laid lines, warm white, soft even light, abstract',
  },
  {
    zh: '纹理：毛边纸的毛边，纸浆纤维散着',
    en: 'Raw edge of handmade paper with loose pulp fibers, warm grey tone, raking light, abstract texture',
  },
  {
    zh: '纹理：牛皮纸，纤维粗，颜色发褐',
    en: 'Kraft paper texture, coarse long fibers, brown grey tone, creases and dust, soft light, abstract',
  },
  {
    zh: '纹理：报纸纸浆纤维，没有可读字',
    en: 'Close texture of old newsprint pulp, tiny grey fibers and dust specks, no readable marks, warm grey, abstract',
  },
  {
    zh: '纹理：纸的折痕，白线穿过多层',
    en: 'Deep crease lines across aged paper, white wear along the folds, soft raking light, abstract texture',
  },
  {
    zh: '纹理：纸上的霉斑，一圈圈发黄',
    en: 'Foxing stains spreading in rings across old paper, yellow brown blotches, soft light, abstract texture',
  },
  {
    zh: '纹理：纸边烧焦，黑褐色往里化开',
    en: 'Charred edge of paper, dark brown gradient from burnt to warm white, ash flakes, soft light, abstract texture',
  },
  {
    zh: '纹理：纸边的虫蛀小孔，边缘发毛',
    en: 'Tiny insect holes along the edge of old paper, frayed fibers around each hole, warm grey, raking light, abstract',
  },
  {
    zh: '纹理：一滴墨落在纸上，边缘先渗开',
    en: 'A single ink drop on rough paper, dark center with a spreading grey halo, warm light, abstract',
  },
  {
    zh: '纹理：墨在纸上被手指拖开一道',
    en: 'Ink smeared sideways by a finger across paper, dark streak fading into fibers, raking light, abstract',
  },
  {
    zh: '纹理：干笔刷过纸面，留下飞白',
    en: 'Dry brush strokes across paper leaving broken white gaps, dark grey ink texture, abstract',
  },
  {
    zh: '纹理：淡墨在湿纸上晕开，边界很软',
    en: 'Pale ink blooming into wet paper, soft grey edges and tide marks, abstract texture',
  },
  {
    zh: '纹理：浓墨泼在纸上，边缘炸开',
    en: 'Thick dark ink splashed on rough paper, exploded edges and fine spatter dots, abstract',
  },
  {
    zh: '纹理：朱砂印泥上一个指纹',
    en: 'A fingerprint pressed into vermilion seal paste on paper, faint ridges in the red film, abstract close texture',
  },
  {
    zh: '纹理：印章边缘的纸纤维被压平',
    en: 'Edge of a red seal imprint on rough paper, fibers flattened under pressure, uneven ink coverage, abstract',
  },
  {
    zh: '纹理：模糊的红印，只有方形轮廓',
    en: 'A blurred square red seal impression on paper, only the outline readable, no marks, abstract',
  },
  {
    zh: '纹理：蓝色粗布的经纬',
    en: 'Coarse indigo blue cloth weave seen close, visible warp and weft, worn threads, soft light, abstract texture',
  },
  {
    zh: '纹理：灰棉布的经纬，有洗白的地方',
    en: 'Grey cotton cloth weave, faded patches and loose threads, close texture, soft light, abstract',
  },
  {
    zh: '纹理：粗麻布，纤维扎手的那种',
    en: 'Rough hemp burlap texture, thick irregular fibers, warm grey, raking light, abstract',
  },
  {
    zh: '纹理：布上的补丁，针脚密',
    en: 'A patched square of cloth sewn onto grey fabric, dense uneven stitches, worn edges, abstract texture',
  },
  {
    zh: '纹理：一截线缝，针脚一密一疏',
    en: 'An uneven stitched line across grey cloth, stitches varying in length, loose thread end, abstract texture',
  },
  {
    zh: '纹理：麻绳的绳结与纤维',
    en: 'Hemp rope knots close up, frayed fibers and twist pattern, warm grey, raking light, abstract texture',
  },
  {
    zh: '纹理：竹篾编织，缝隙里积着灰',
    en: 'Woven bamboo strips close up, dust in the gaps, warm gold grey, raking light, abstract texture',
  },
  {
    zh: '纹理：竹竿表面，一节一节的环',
    en: 'Bamboo pole surface with nodes and fine vertical grain, dry pale gold, raking light, abstract texture',
  },
  {
    zh: '纹理：老木头纹，裂了一道',
    en: 'Old wood grain with a long split, worn edges and dust, warm brown grey, raking light, abstract texture',
  },
  {
    zh: '纹理：木桌上的刀痕与划痕',
    en: 'Wooden table surface covered with knife marks and scratches, wax and dust in the grooves, abstract texture',
  },
  {
    zh: '纹理：墙皮剥落，露出底下的砖',
    en: 'Peeling plaster on a wall exposing grey brick beneath, flakes and dust, raking light, abstract texture',
  },
  {
    zh: '纹理：灰砖墙缝，白灰浆剩下一点',
    en: 'Grey brick wall joints close up, remnant lime mortar, dust and grit, raking light, abstract texture',
  },
  {
    zh: '纹理：水泥麻面，石子露出来',
    en: 'Rough cast concrete surface, aggregate stones showing, hairline cracks, raking light, abstract texture',
  },
  {
    zh: '纹理：石灰墙颗粒，手一摸就掉粉',
    en: 'Lime plaster wall texture, chalky granules and fine powder, soft raking light, abstract',
  },
  {
    zh: '纹理：一块铁锈，边缘是深褐的',
    en: 'A patch of iron rust, orange brown core fading to dark edges, pitted metal, raking light, abstract texture',
  },
  {
    zh: '纹理：铁皮边缘被剪开，卷着',
    en: 'Cut sheet iron edge curling over, rust along the cut, cold grey metal, raking light, abstract texture',
  },
  {
    zh: '纹理：一枚锈钉，钉帽上有划痕',
    en: 'A rusted nail head close up, scratches across the flat top, flakes of rust, raking light, abstract',
  },
  {
    zh: '纹理：玻璃上的一道裂纹，放射状',
    en: 'A radiating crack across dirty glass, dust along the line, faint light, abstract texture',
  },
  {
    zh: '纹理：冰裂纹，细密地分叉',
    en: 'Fine ice crack pattern branching across a surface, thin white lines, cold tone, abstract texture',
  },
  {
    zh: '纹理：窗上的霜花，像草叶',
    en: 'Frost patterns on an old window pane, fern like crystals, cold grey light, abstract texture',
  },
  {
    zh: '纹理：雪面被压过的痕迹',
    en: 'Compressed snow surface with footprint rims and sliding marks, cold grey blue tone, soft light, abstract',
  },
  {
    zh: '纹理：雨水积在石板上，一层薄光',
    en: 'Rainwater film over stone paving, faint reflections and ripples, cold grey, abstract texture',
  },
  {
    zh: '纹理：水面的波纹，一圈套一圈',
    en: 'Concentric ripples on dark water, soft grey tones, abstract texture',
  },
  {
    zh: '纹理：雾的分层，一层比一层淡',
    en: 'Layered mist fading from dense grey to pale, soft gradients, abstract atmospheric texture',
  },
  {
    zh: '纹理：烟的黑灰过渡，边缘散开',
    en: 'Smoke edge fading from dark grey to transparent, soft turbulent texture, abstract',
  },
  {
    zh: '纹理：纸灰，一碰就碎',
    en: 'A sheet of ash from burnt paper, fragile flakes and grey dust, raking light, abstract texture',
  },
  {
    zh: '纹理：煤油灯的光晕落在纸上，暖黄',
    en: 'A warm kerosene lamp halo falling on aged paper, soft yellow gradient, dust specks, abstract',
  },
  {
    zh: '纹理：光柱里的尘，一粒一粒',
    en: 'Dust motes suspended in a shaft of light, dark background, soft golden haze, abstract',
  },
  {
    zh: '纹理：纸面的暗角，越靠边越暗',
    en: 'Aged paper surface with a soft vignette darkening toward the edges, warm grey, abstract texture',
  },
  {
    zh: '纹理：窗棂的影子落在纸上',
    en: 'The shadow of a lattice window falling across old paper, hard geometric lines, warm light, abstract',
  },
  {
    zh: '纹理：地图折痕交汇的地方磨白了',
    en: 'Intersection of map fold lines worn white, thin paper edges, warm grey, raking light, abstract texture',
  },
  {
    zh: '纹理：旧账页的横线，墨色褪成灰',
    en: 'Faint ruled lines on an old ledger page, grey ink grid, yellowed paper, soft light, abstract',
  },
  {
    zh: '纹理：碑面颗粒，凿痕还在',
    en: 'Granite surface close up, chisel marks and stone grains, cold grey, raking light, abstract texture',
  },
  {
    zh: '纹理：石头上的凿痕排列成行',
    en: 'Rows of chisel marks on a stone face, shallow grooves and stone dust, cold light, abstract texture',
  },
  {
    zh: '纹理：石阶被脚步磨出的凹面',
    en: 'The worn hollow of a stone step, polished by years of footsteps, dust in the grain, raking light, abstract',
  },
  {
    zh: '纹理：木牌上的刻痕，刀口发毛',
    en: 'Carved marks on a wooden plaque, furred edges along the cuts, dust, raking light, abstract texture',
  },
  {
    zh: '纹理：灰布的磨破边缘，线头散着',
    en: 'The frayed edge of worn grey cloth, loose threads and thinning weave, soft light, abstract texture',
  },
  {
    zh: '纹理：纸角卷起来，下面是空的',
    en: 'A curled corner of aged paper lifting off a surface, shadow beneath, warm grey, raking light, abstract',
  },
]

/** 氛围空镜：42 条。 */
const ATMO = [
  {
    zh: '空镜：雪落破窗台，屋里只有一点暖光',
    en: 'Snow falling past a broken wooden window frame, cold grey interior, a single warm lamp reflection on the sill, wide shot',
  },
  {
    zh: '空镜：苏州河清晨的浓雾，仓库只剩轮廓',
    en: 'Thick river mist at dawn over the Suzhou creek, dark water, a distant concrete warehouse silhouette barely visible, wide shot',
  },
  {
    zh: '空镜：砖洞里飘出的烟，逆着低太阳',
    en: 'Smoke drifting from a jagged hole in a concrete wall, backlit by low sun, dust suspended in the air, close wide shot',
  },
  {
    zh: '空镜：夜雨打在水面，对岸灯全是虚的',
    en: 'Night rain rings on dark water, out of focus lights along the far bank, long broken reflections, wide shot',
  },
  {
    zh: '空镜：风里的一盏煤油灯，光在墙上抖',
    en: 'A small kerosene lamp flame bending in a draft inside a dark concrete room, a warm circle of light on the wall, close shot',
  },
  {
    zh: '空镜：仓库高窗落下的尘光柱',
    en: 'Shafts of dusty light falling through high warehouse windows onto a concrete floor, volumetric haze, straw scraps, wide shot',
  },
  {
    zh: '空镜：雨打在铁皮雨棚上，檐口滴水成线',
    en: 'Rain beating on a corrugated iron awning, water dripping in a line from the edge, wet brick wall, grey light, close wide shot',
  },
  {
    zh: '空镜：雪落进苏州河，河面不积雪',
    en: 'Snow falling into a dark river, flakes dissolving on the water surface, distant bank in mist, wide shot',
  },
  {
    zh: '空镜：烟从仓库高窗出去，被风拉成一条',
    en: 'Smoke leaving a high warehouse window and stretched sideways by wind, cold sky, roof edge in silhouette, wide shot',
  },
  {
    zh: '空镜：清晨雾散一半，仓库一半浸在水里',
    en: 'Morning mist lifting halfway over a river, a concrete warehouse half drowned in fog, dark water below, wide shot',
  },
  {
    zh: '空镜：灯芯烧到最后，火苗只剩豆大',
    en: 'A kerosene lamp wick burned almost to the end, a tiny flame, warm circle of light shrinking on a concrete wall, close shot',
  },
  {
    zh: '空镜：油灯的光晕落在湿墙上',
    en: 'A soft halo of oil lamp light spreading on a damp plaster wall, water stains catching the glow, dim room, close shot',
  },
  {
    zh: '空镜：月亮被云挡住，只剩屋顶轮廓',
    en: 'Moon hidden behind thick cloud, only the roof line and chimney silhouette visible, faint cold glow, night, wide shot',
  },
  {
    zh: '空镜：远处的低云被火映成暗红',
    en: 'Low clouds far away stained dull red by firelight, black roof silhouettes in the foreground, night, wide shot',
  },
  {
    zh: '空镜：灰从天花板裂缝里落下来',
    en: 'Fine dust and ash sifting down from cracks in a concrete ceiling, caught in a shaft of light, empty room, close shot',
  },
  {
    zh: '空镜：破窗纸被风一下一下鼓动',
    en: 'Torn paper window covering bulging and relaxing in the wind, wooden lattice frame, cold light behind, close shot',
  },
  {
    zh: '空镜：雨顺着铁栏杆往下流',
    en: 'Rainwater running down an iron railing in thin streams, beads of water, misty river beyond, close shot',
  },
  {
    zh: '空镜：雪落在铁丝网上，积成一条白线',
    en: 'Snow gathering along strands of barbed wire in a thin white line, grey sky, brick wall behind, close shot',
  },
  {
    zh: '空镜：河面结薄冰，冰下还有暗流',
    en: 'Thin ice forming over a dark river, cracks and moving water below the surface, cold dawn light, close shot',
  },
  {
    zh: '空镜：雾从下水道口一阵阵冒出来',
    en: 'Mist rising in slow pulses from a street drain, wet cobblestones, one dim lamp, night, wide shot',
  },
  {
    zh: '空镜：门缝里透进一束光，落在水泥地上',
    en: 'A beam of light entering through a door gap and falling on a concrete floor, dust in the beam, dark room, close wide shot',
  },
  {
    zh: '空镜：楼梯间的光从上方漏下来',
    en: 'Light leaking down a concrete stairwell from a high window, dust and haze, worn steps in shadow, low angle',
  },
  {
    zh: '空镜：屋顶看出去，烟和云分不清',
    en: 'A view from a warehouse rooftop where smoke and cloud merge, grey sky, parapet in silhouette, wide shot',
  },
  {
    zh: '空镜：风吹动墙上的旧报纸，字全虚着',
    en: 'Old newspaper sheets pasted on a brick wall lifting in the wind, lettering blurred into grey, dust, close shot',
  },
  {
    zh: '空镜：檐下的冰凌滴着一滴水',
    en: 'Icicles under a tiled eave, a single drop falling, snow on the roof above, winter light, close shot',
  },
  {
    zh: '空镜：灶膛的火快灭了，只剩余烬',
    en: 'Embers dying in a brick stove, soft red glow at the bottom of grey ash, warm light on a dark wall, close shot',
  },
  {
    zh: '空镜：煤油灯罩被熏黑，光变黄',
    en: 'A soot blackened kerosene lamp glass, yellow light leaking through smoke stains, dark room, close shot',
  },
  {
    zh: '空镜：夜里的河面，雨点把灯影打碎',
    en: 'Night rain breaking the reflections of distant lamps on dark water, long fragments of light, wide shot',
  },
  {
    zh: '空镜：远处的探照灯扫过云层',
    en: 'A distant searchlight beam sweeping across low clouds, dark sky, silhouette of rooftops, wide shot',
  },
  {
    zh: '空镜：雾里一座桥只露出前半段',
    en: 'A bridge half swallowed by fog, only the near span visible, dark water below, cold dawn light, wide shot',
  },
  {
    zh: '空镜：雨后的石板路上一层薄光',
    en: 'Wet flagstone street after rain, a thin sheen of light on the stones, wooden shopfronts in shadow, wide shot',
  },
  {
    zh: '空镜：雪夜里营房窗子，只有一格亮着',
    en: 'A snow covered barracks at night, one window lit warm, all the others dark, falling snow, wide shot',
  },
  {
    zh: '空镜：晨雾里的树，只剩枝',
    en: 'Bare trees in morning mist, only branches visible, soft grey layers, cold light, wide shot',
  },
  {
    zh: '空镜：破墙洞外的天空，云走得很快',
    en: 'The sky seen through a jagged hole in a concrete wall, clouds moving fast, light shifting on rubble, close wide shot',
  },
  {
    zh: '空镜：水缸里的水面有细小波纹',
    en: 'Tiny ripples spreading on the water surface in a stone water vat, reflected eave above, dim courtyard light, close shot',
  },
  {
    zh: '空镜：夏夜灯下飞着的小虫',
    en: 'Small insects circling a kerosene lamp at night, warm halo, dust and moths, close shot',
  },
  {
    zh: '空镜：屋顶的烟和雾交接在一起',
    en: 'Smoke from a chimney merging into low mist above rooftops, grey morning, soft light, wide shot',
  },
  {
    zh: '空镜：河岸芦苇被风压向一边',
    en: 'Riverbank reeds bent in one direction by wind, dark water beyond, overcast light, wide shot',
  },
  {
    zh: '空镜：湿草席晾在竹竿上滴水',
    en: 'A wet straw mat draped over a bamboo pole, water dripping, courtyard concrete below, afternoon light, close shot',
  },
  {
    zh: '空镜：空屋里的光柱与尘，回声一样静',
    en: 'A shaft of light standing in an empty concrete room, dust suspended, deep shadow around, wide shot',
  },
  {
    zh: '空镜：1947 冬通城的雪落在瓦上',
    en: 'Snow falling on grey tiled roofs of a small Chinese county town in 1947 winter, chimney smoke, quiet street, wide shot',
  },
  {
    zh: '空镜：纪念馆高窗的冷光落在石墙上',
    en: 'Cold daylight falling through a tall narrow window onto a stone wall, dust in the air, quiet, wide shot',
  },
]

// --------------------------------------------------------------------------- //
// 工具
// --------------------------------------------------------------------------- //
/** FNV-1a 32bit → 稳定 seed（同 id 永远同 seed，可复现）。 */
function stableSeed(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 2147483646) + 1
}

function fnv(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * 估算 CLIP BPE token 数（校准版，2026-10-21 image-runner 实测后重标定）。
 *
 * 实测：旧估算器把 scene-001 的 r1 prompt 算成约 60，CLIP tokenizer 实为 79 —— 低估 30%，
 * 原因是逗号几乎各占 1 token、BPE 对长词切分比预想多、还有 BOS/EOS 2 token。
 * 校准公式：word 估算（短 1 / 中 2 / 长 3）＋ 每个逗号分号 1 ＋ BOS/EOS 2。
 * 偏保守（略高估），阈值 72（Lead 2026-10-21 指令）保证实际 ≤77。
 */
function estimateTokens(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  let t = 0
  for (const w of words) {
    if (/^\d+$/.test(w)) t += 2
    else if (w.length <= 6) t += 1
    else if (w.length <= 12) t += 2
    else t += 3
  }
  const punct = (text.match(/[,;]/g) || []).length
  return t + punct + 2 // +2 = BOS/EOS
}

/**
 * 去掉与类别护栏重复的开头/结尾（省 token 给具体叙事信息）。
 * 例：figure 护栏已有 "silhouette seen from behind"，内容里的 "seen from behind at a distance" 就是浪费。
 */
function compactBody(en, category) {
  let body = en.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '')
  if (category === 'figure') {
    body = body.replace(/,?\s*seen from behind at a distance/gi, '')
    body = body.replace(/,?\s*full body silhouettes?/gi, '')
  }
  if (category === 'moment') {
    body = body.replace(/^(Extreme close up of|Close up of|Close view of|Close shot of)\s+/i, '')
  }
  if (category === 'artifact') {
    body = body.replace(/^Top down extreme close view of\s+/i, 'extreme close view of ')
    body = body.replace(/^Top down flat lay of\s+/i, '')
  }
  return body
}

/** 低信息量的构图/技术段（优先删除，把 token 留给具体物与动作）。 */
const TECHNICAL_SEG =
  /^(wide|close|medium|low angle|high angle|overhead|establishing|extreme close|full body|distant)\b.*\b(shot|view|angle|silhouette|lay)s?$|(shallow )?depth of field|full body silhouettes?/i

/** 纯光线/氛围段（≤5 词）：预算紧时先于具体物删除。 */
const ATMOS_SEG = /\b(light|glow|shadow|shadows|sun|sunlight|moonlight|dusk|dawn|haze|mist|fog|darkness|gloom)\b/i
const isAtmosSeg = (seg) => seg.trim().split(/\s+/).length <= 5 && ATMOS_SEG.test(seg)

/**
 * 拼 prompt：风格前缀 → 类别护栏（空场/静物/剪影，前置）→ 内容。
 * 超 66 token（估算）时的删除优先级：
 *   ① "wide shot / shallow depth of field" 这类低信息构图段
 *   ② ≤5 词的纯光线/氛围段（先于具体物删除）
 *   ③ 中间最长的内容段（保住开头时空设定与结尾具体物）
 *   ④ 只剩两段时保留信息更多的一段（避免 figure 丢掉"那个人"）
 */
function buildPrompt(en, category, warnings = [], prefix = STYLE_PREFIX) {
  const content = compactBody(en, category)
    .split(/,\s*/)
    .filter(Boolean)
  const join = () => [prefix, GUARD[category], ...content].join(', ')
  let prompt = join()
  while (estimateTokens(prompt) > PROMPT_TOKEN_MAX && content.length > 1) {
    // ① 技术段（不删第一段，第一段通常是主体/时空）
    let idx = -1
    for (let i = 1; i < content.length; i++) {
      if (TECHNICAL_SEG.test(content[i].trim())) {
        idx = i
        break
      }
    }
    // ② 纯光线/氛围段（≤5 词）
    if (idx === -1) {
      for (let i = 1; i < content.length; i++) {
        if (isAtmosSeg(content[i])) {
          idx = i
          break
        }
      }
    }
    // ③ 中间最长段
    if (idx === -1) {
      let best = -1
      for (let i = 1; i < content.length - 1; i++) {
        const t = estimateTokens(content[i])
        if (t > best) {
          best = t
          idx = i
        }
      }
    }
    // ④ 两段时保留信息更多的一段
    if (idx === -1) idx = content[0].length >= content[1].length ? 1 : 0
    content.splice(idx, 1)
    prompt = join()
  }
  if (estimateTokens(prompt) > PROMPT_TOKEN_MAX) {
    warnings.push(`prompt 无法压到 ${PROMPT_TOKEN_MAX} token：${en.slice(0, 48)}…`)
  }
  return prompt
}

const pad3 = (n) => String(n).padStart(3, '0')

/**
 * 解析章节场景表：扫描 `{ id: 'v0-01', chapter: ..., title: ... }` 字面量。
 * 卷文件可能尚未写入（writers 并行中），解析不到就返回空数组，不报错。
 */
function parseSceneTables() {
  const found = new Map()
  if (!fs.existsSync(CONTENT_DIR)) return found
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => /^(volume[0-9]|chapter1)\.ts$/.test(f))
  for (const file of files) {
    const text = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8')
    const re = /\{\s*\n?\s*id:\s*'([^']+)'/g
    let m
    while ((m = re.exec(text)) !== null) {
      const start = text.indexOf('{', m.index)
      const block = braceBlock(text, start)
      if (!block) continue
      if (!/chapter:\s*'/.test(block) || !/title:\s*'/.test(block)) continue
      const pick = (key) => {
        const mm = block.match(new RegExp(`${key}:\\s*'([^']*)'`))
        return mm ? mm[1] : undefined
      }
      const id = m[1]
      found.set(id, {
        id,
        file,
        chapter: pick('chapter'),
        title: pick('title'),
        date: pick('date'),
        location: pick('location'),
        background: pick('background'),
        weather: pick('weather'),
      })
    }
  }
  return found
}

/** 从 start 处的 '{' 做括号配对，返回对象字面量文本（忽略字符串内的括号）。 */
function braceBlock(text, start) {
  if (text[start] !== '{') return null
  let depth = 0
  let inStr = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 场景表兜底 prompt：当出现未手写的场景 id 时用（visual-bible §12）。 */
const BG_EN = {
  office: 'Chinese county government office interior, wooden desks, paper documents',
  warehouse: 'concrete warehouse interior, exposed pillars, sandbags and wooden crates',
  river: 'dark river at night with distant lights along the far bank',
  flag: 'warehouse rooftop against a smoke filled dawn sky',
  bridge: 'wet stone bridge at night in the rain',
  dawn: 'empty paved yard at dawn in the foreign concession, thin mist',
}
const WEATHER_EN = {
  rain: 'rain',
  ash: 'drifting ash and dust',
  smoke: 'smoke haze',
  snow: 'snow',
  none: 'clear still air',
}
const TIME_EN = (date = '') => {
  if (/黎明|清晨/.test(date)) return 'dawn light'
  if (/深夜|凌晨/.test(date)) return 'deep night'
  if (/夜/.test(date)) return 'night'
  if (/黄昏|傍晚/.test(date)) return 'dusk light'
  return 'overcast daylight'
}

function autoSceneBeat(scene) {
  const place = BG_EN[scene.background] || '1937 China, war damaged building'
  return {
    id: scene.id,
    zh: `场景兜底：${scene.chapter || ''} ${scene.title || ''}`.trim(),
    en: `${place}, ${TIME_EN(scene.date)}, ${WEATHER_EN[scene.weather] || 'haze'}, empty space with narrative objects, wide shot`,
    auto: true,
  }
}

function buildEntries({ v0 = false, limit = 0, log = console.log } = {}) {
  const parsed = parseSceneTables()
  const warnings = []
  const entries = []
  const perCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]))

  // ---- scene-*：以 SCENE_BEATS 为基线，SCENE_OVERRIDES（按 writers 真实场景表重写）优先 ----
  const beats = SCENE_BEATS.map((b) => (SCENE_OVERRIDES[b.id] ? { ...b, ...SCENE_OVERRIDES[b.id] } : b))
  const missingOverride = SCENE_BEATS.filter((b) => !SCENE_OVERRIDES[b.id]).map((b) => b.id)
  if (missingOverride.length) {
    warnings.push(
      `以下场景尚无真实场景表覆盖（暂用预案 prompt，writers 交卷后补）：${missingOverride.join(', ')}`,
    )
  }
  const beatIds = new Set(beats.map((b) => b.id))
  const autoScenes = [...parsed.values()].filter(
    (s) => /^v\d-\d+$/.test(s.id) && !beatIds.has(s.id),
  )
  if (autoScenes.length) {
    warnings.push(
      `场景表出现 ${autoScenes.length} 个未手写场景 id，已用兜底 prompt：${autoScenes.map((s) => s.id).join(', ')}`,
    )
    for (const s of autoScenes.sort((a, b) => a.id.localeCompare(b.id))) beats.push(autoSceneBeat(s))
  }

  beats.slice(0, CATEGORIES.scene.quota).forEach((beat, i) => {
    const meta = parsed.get(beat.id)
    perCategory.scene.push({
      id: `scene-${pad3(i + 1)}`,
      category: 'scene',
      scene: beat.id,
      purpose: beat.zh,
      en: beat.en,
      auto: Boolean(beat.auto),
      sceneMeta: meta
        ? { chapter: meta.chapter, title: meta.title, date: meta.date, location: meta.location }
        : undefined,
    })
  })
  if (beats.length > CATEGORIES.scene.quota) {
    warnings.push(`SCENE_BEATS 超配额：${beats.length} > ${CATEGORIES.scene.quota}，多余条目被截断`)
  }

  // ---- 其余类别：按数据表顺序编号 ----
  const pushList = (category, list, mapItem) => {
    const quota = CATEGORIES[category].quota
    if (list.length > quota) warnings.push(`${category} 超配额：${list.length} > ${quota}，末尾截断`)
    list.slice(0, quota).forEach((item, i) => {
      perCategory[category].push({
        id: `${category}-${pad3(i + 1)}`,
        category,
        ...mapItem(item),
        en: item.en,
      })
    })
  }
  // moment 类：r5 起用"物为主语 + 动作结果"的静态句（过程动作 4-step 还原不稳定，见 spot-check §1.6）
  pushList(
    'moment',
    MOMENTS.map((m, i) => (MOMENT_OVERRIDES[i + 1] ? { ...m, ...MOMENT_OVERRIDES[i + 1] } : m)),
    (it) => ({ purpose: it.zh, scene: it.scene || null }),
  )
  pushList('artifact', ARTIFACTS, (it) => ({ purpose: it.zh, scene: it.scene || null }))
  pushList('figure', FIGURES, (it) => ({ purpose: it.zh, scene: it.scene || null }))
  pushList('ending', ENDINGS, (it) => ({ purpose: it.zh, scene: it.scene || null, ending: it.kind }))
  pushList('ui', UI, (it) => ({ purpose: it.zh, scene: it.scene || null }))
  pushList('atmo', ATMO, (it) => ({ purpose: it.zh, scene: it.scene || null }))

  // ---- 补全字段：prompt = 风格前缀 + 内容 + 紧凑尾缀（成品，可直接喂 gen.py）----
  for (const category of CATEGORY_ORDER) {
    for (const item of perCategory[category]) {
      const { width, height } = CATEGORIES[category]
      const seed = stableSeed(item.id)
      const negative = [NEG_BASE, NEG_HARD, NEG_EXTRA[category]].filter(Boolean).join(', ')
      // 非 1937—1941 的 scene 用时代中性前缀（卷零 1947、卷四 1950—2025、卷五 1991+）
      const eraNeutral =
        category === 'scene' &&
        item.sceneMeta &&
        !/民国二十六年|19(3[7-9]|4[01])/.test(item.sceneMeta.date || '')
      const prefix = eraNeutral ? STYLE_PREFIX_ERA_NEUTRAL : STYLE_PREFIX
      const prompt = buildPrompt(item.en, category, warnings, prefix)
      const entry = {
        id: item.id,
        category,
        rev: 'r6',
        width,
        height,
        prompt,
        negative,
        seed,
        steps: STEPS,
        guidance: GUIDANCE,
        usage: item.purpose,
        scene: item.scene ?? null,
        tokens: estimateTokens(prompt),
        file: `public/art/${item.id}.jpg`,
        out: `../../public/art/${item.id}.jpg`,
      }
      if (item.ending) entry.ending = item.ending
      if (item.sceneMeta) entry.sceneMeta = item.sceneMeta
      if (item.auto) entry.auto = true
      entries.push(entry)
    }
  }

  // ---- 总数守门：超过 500 时从低优先级类别尾部截断 ----
  let finalEntries = entries
  if (finalEntries.length > TOTAL_TARGET) {
    const trimOrder = ['atmo', 'ui', 'figure', 'artifact', 'moment', 'ending']
    let overflow = finalEntries.length - TOTAL_TARGET
    const drop = new Set()
    for (const cat of trimOrder) {
      if (overflow <= 0) break
      const list = finalEntries.filter((e) => e.category === cat)
      for (let i = list.length - 1; i >= 0 && overflow > 0; i--, overflow--) drop.add(list[i].id)
    }
    if (overflow > 0) {
      finalEntries = finalEntries.slice(0, TOTAL_TARGET)
    } else {
      finalEntries = finalEntries.filter((e) => !drop.has(e.id))
      warnings.push(`超出 500，已从低优先级类别尾部截断 ${drop.size} 条`)
    }
  }

  // ---- v0 / limit ----
  if (v0) {
    const picked = []
    for (const cat of CATEGORY_ORDER) {
      const want = V0_DIST[cat] || 0
      picked.push(...finalEntries.filter((e) => e.category === cat).slice(0, want))
    }
    finalEntries = picked
  } else if (limit > 0) {
    finalEntries = finalEntries.slice(0, limit)
  }

  return { entries: finalEntries, warnings, parsed, v0 }
}

// --------------------------------------------------------------------------- //
// 校验 + 输出
// --------------------------------------------------------------------------- //
function validate(entries) {
  const issues = []
  const ids = new Set()
  const prompts = new Map()
  for (const e of entries) {
    if (ids.has(e.id)) issues.push(`重复 id: ${e.id}`)
    ids.add(e.id)
    if (!/^(scene|moment|artifact|figure|ending|ui|atmo)-\d{3}$/.test(e.id))
      issues.push(`id 命名不合规: ${e.id}`)
    const cfg = CATEGORIES[e.category]
    if (!cfg) issues.push(`未知类别: ${e.category}`)
    else if (e.width !== cfg.width || e.height !== cfg.height)
      issues.push(`尺寸不符 ${e.id}: ${e.width}x${e.height}`)
    if (!e.prompt || e.prompt.length < 80) issues.push(`prompt 过短: ${e.id}`)
    if (!e.prompt.startsWith('cinematic film still, ')) issues.push(`风格词不在开头: ${e.id}`)
    if (!e.prompt.includes('muted desaturated warm sepia palette'))
      issues.push(`调色板锚点缺失: ${e.id}`)
    if (estimateTokens(e.prompt) > PROMPT_TOKEN_MAX)
      issues.push(`prompt 超 ${PROMPT_TOKEN_MAX} token (${estimateTokens(e.prompt)}): ${e.id}`)
    if (!e.usage) issues.push(`usage 缺失: ${e.id}`)
    if (!e.negative || !e.negative.includes('modern buildings')) issues.push(`negative 缺失: ${e.id}`)
    if (!Number.isInteger(e.seed) || e.seed <= 0 || e.seed >= 2 ** 31) issues.push(`seed 非法: ${e.id}`)
    if (e.steps !== 4 || e.guidance !== 0) issues.push(`生成参数不符: ${e.id}`)
    const p = e.prompt
    if (prompts.has(p)) issues.push(`重复 prompt: ${e.id} 与 ${prompts.get(p)}`)
    prompts.set(p, e.id)
  }
  return issues
}

function summarize(entries) {
  const byCat = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]))
  for (const e of entries) byCat[e.category] = (byCat[e.category] || 0) + 1
  const sizes = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]))
  for (const e of entries) sizes[e.category]++
  return { total: entries.length, byCat }
}

function emitBatches(entries, batchSize = 50, log = console.log, prefix = 'batch', stableOnly = false) {
  fs.mkdirSync(BATCH_DIR, { recursive: true })
  const pattern = new RegExp(`^${prefix}-\\d{3}\\.json$`)
  const existing = fs.readdirSync(BATCH_DIR).filter((f) => pattern.test(f))
  for (const f of existing) fs.unlinkSync(path.join(BATCH_DIR, f))
  const counts = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]))
  for (const e of entries) counts[e.category] = (counts[e.category] || 0) + 1
  /** 一个批次稳定 ⇔ 它最后一条所属类别的所有前置类别都已补满（此后只会尾部追加，不会移位）。 */
  const isStable = (chunk) => {
    const lastCat = chunk[chunk.length - 1].category
    const idx = CATEGORY_ORDER.indexOf(lastCat)
    return CATEGORY_ORDER.slice(0, idx).every((c) => counts[c] >= CATEGORIES[c].quota)
  }
  const batches = []
  for (let i = 0; i < entries.length; i += batchSize) batches.push(entries.slice(i, i + batchSize))
  let emitted = 0
  batches.forEach((chunk, i) => {
    const jobs = chunk.map((e) => ({
      id: e.id,
      prompt: e.prompt,
      negative: e.negative,
      seed: e.seed,
      width: e.width,
      height: e.height,
      steps: e.steps,
      guidance: e.guidance,
      out: e.out,
    }))
    if (stableOnly && !isStable(chunk)) return
    const file = path.join(BATCH_DIR, `${prefix}-${pad3(i + 1)}.json`)
    fs.writeFileSync(file, JSON.stringify(jobs, null, 2) + '\n', 'utf8')
    emitted++
  })
  log(
    `[batches] ${emitted} 个批次 → docs/art/batches/${prefix}-###.json（每批 ${batchSize}）` +
      (stableOnly ? ' [仅稳定批次：后续只会新增编号更大的批次，已写批次内容不再变]' : ''),
  )
  return emitted
}

// --------------------------------------------------------------------------- //
// CLI
// --------------------------------------------------------------------------- //
function main() {
  const argv = process.argv.slice(2)
  const has = (flag) => argv.includes(flag)
  const valueOf = (flag, def) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def
  }
  const log = (...a) => console.log(...a)

  fs.mkdirSync(ART_DIR, { recursive: true })
  const { entries, warnings, parsed } = buildEntries({
    v0: has('--v0'),
    limit: valueOf('--limit', 0),
    log,
  })

  log(`[scenes] 场景表解析：${parsed.size} 个场景（${CONTENT_DIR.replace(ROOT + path.sep, '')}）`)
  for (const w of warnings) log(`[warn] ${w}`)

  const issues = validate(entries)
  if (issues.length) {
    log(`[check] ❌ ${issues.length} 个问题：`)
    for (const i of issues.slice(0, 30)) log(`  - ${i}`)
    if (issues.length > 30) log(`  ... 其余 ${issues.length - 30} 条略`)
  } else {
    log('[check] ✅ 字段/命名/尺寸/参数/唯一性 全部通过')
  }

  const { total, byCat } = summarize(entries)
  log(`[manifest] 共 ${total} 条`)
  for (const cat of CATEGORY_ORDER) log(`  ${cat.padEnd(9)} ${String(byCat[cat]).padStart(3)} / ${CATEGORIES[cat].quota}`)
  const tok = entries.map((e) => e.tokens || estimateTokens(e.prompt))
  const maxTok = tok.length ? Math.max(...tok) : 0
  const avgTok = tok.length ? tok.reduce((a, b) => a + b, 0) / tok.length : 0
  log(`[token] prompt 估算：max ${maxTok} / 上限 ${PROMPT_TOKEN_MAX}，avg ${avgTok.toFixed(1)}`)
  if (total !== TOTAL_TARGET) log(`[warn] 距离目标 ${TOTAL_TARGET} 还差 ${TOTAL_TARGET - total} 条（数据表待补）`)

  if (has('--check')) return issues.length ? 1 : 0

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf8')
  log(`[write] ${MANIFEST_PATH.replace(ROOT + path.sep, '')}`)

  // scene 场景 id → 插画 id 映射（Lead 集成 App.tsx 的 `image` 字段直接查这张表）
  const sceneMap = {}
  for (const e of entries) {
    if (e.category !== 'scene' || !e.scene) continue
    sceneMap[e.scene] = { image: `public/art/${e.id}.jpg`, id: e.id, usage: e.usage }
  }
  const sceneMapPath = path.join(ART_DIR, 'scene-map.json')
  fs.writeFileSync(sceneMapPath, JSON.stringify(sceneMap, null, 2) + '\n', 'utf8')
  log(`[write] docs/art/scene-map.json（${Object.keys(sceneMap).length} 个场景 → 插画映射）`)

  if (!has('--no-batches'))
    emitBatches(
      entries,
      valueOf('--batch-size', 50),
      log,
      has('--v0') ? 'pilot' : 'batch',
      has('--stable-only'),
    )
  return issues.some((i) => /重复 id|未知类别|尺寸不符/.test(i)) ? 1 : 0
}

main()
