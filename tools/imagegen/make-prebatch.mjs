import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * pre-manifest：GPU 空转兜底批次（60 张）
 * 由 Lead 直接生成，先让 image-runner 开跑；art-director 的正式 manifest 之后覆盖。
 * 约束：prompt 总 token ≤70，风格词放开头。
 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'imagegen', 'manifest-pre.json')
const PUBLIC_ART = path.join(ROOT, 'public', 'art')

const STYLE = 'cinematic film still, 1937 China, muted desaturated, volumetric haze, painterly realism'
const NEG =
  'people, faces, text, chinese characters, watermark, modern buildings, skyscrapers, neon, cars, power lines, cartoon, anime, 3d render, oversaturated, american flag, stars and stripes'

const scenes = [
  ['scene-office', 'snowy Chinese county office interior, wooden table, ink brush, charcoal brazier, lattice window', 194712],
  ['scene-warehouse', 'interior of a concrete warehouse fortress, burlap sandbags, wooden crates, dust in broken-window light shafts', 19371026],
  ['scene-river', 'night rain over Suzhou Creek, dark water, low concrete warehouse silhouette across the water, gas lamp reflections', 19371027],
  ['scene-flag', 'warehouse rooftop at dawn, small torn flag silhouette on bamboo pole, smoke and ash sky', 19371028],
  ['scene-bridge', 'wet asphalt bridge at night, rain backlit by street lamp, iron railings, fog', 19371030],
  ['scene-dawn', 'empty concession square at dawn, thin mist, cold blue-grey, distant low-rise silhouettes', 19371031],
  ['scene-wallhole', 'shell-damaged brick wall, jagged hole, exposed rebar, rubble, dust beam', 19371029],
  ['scene-wounded', 'warehouse dressing station, stretchers, rolled bandages, single hanging bulb, stained floor', 19371025],
]

const moments = [
  ['moment-roster', 'close shot of a worn handwritten name roster on rough paper, ink brush, lamplight', 501],
  ['moment-letters', 'stack of folded letters tied with string on a wooden crate, dim light', 502],
  ['moment-flagraise', 'low angle on a bamboo flagpole with rope tied to a leg wrap, smoke sky behind', 503],
  ['moment-bridgecross', 'backs of marching soldiers on a wet bridge at night, rain, blurred', 504],
  ['moment-candle', 'hand written names by candlelight, papers spread on concrete floor', 505],
  ['moment-snow', 'light snow falling through a broken factory window, dust and snow in a beam', 506],
  ['moment-newspaper', 'folded 1937 Chinese newspaper on wet concrete, headline illegible, blurred', 507],
  ['moment-emptyboots', 'a pair of worn boots and a folded cloth on concrete, shallow focus', 508],
]

const artifacts = [
  ['artifact-roster-page', 'flat lay photograph of a 1940s handwritten roster page, aged paper, stains', 601],
  ['artifact-letter', 'flat lay of a 1930s Chinese letter on thin paper, ink brush writing blurred', 602],
  ['artifact-uniform', 'flat lay of a 1930s Chinese army summer uniform, yellow-green cloth, brass buttons', 603],
  ['artifact-helmet', 'flat lay of a German M35 style steel helmet with worn paint, neutral background', 604],
  ['artifact-flag', 'flat lay of a small blank cloth flag with rope, no emblem, aged fabric', 605],
  ['artifact-photo', 'flat lay of a faded black and white group photo of soldiers, faces blurred', 606],
  ['artifact-seal', 'flat lay of a red seal and ink box on rough paper', 607],
  ['artifact-pencil', 'close shot of a short pencil wrapped with thread, on aged paper', 608],
]

const figures = [
  ['figure-xie', 'rear silhouette of a tall officer in 1930s uniform on rooftop, back to camera, dim light', 701],
  ['figure-yang', 'rear silhouette of a stocky officer in a warehouse doorway, back to camera', 702],
  ['figure-chen', 'rear silhouette of a young soldier climbing a stairwell, back to camera, smoke', 703],
  ['figure-clerk', 'rear silhouette of a young man with a book under his arm, snow falling, coat collar up', 704],
  ['figure-veteran', 'rear silhouette of an old man standing before a memorial wall, back to camera', 705],
  ['figure-mother', 'rear silhouette of an old woman at a village doorway, snow outside', 706],
]

const endings = [
  ['ending-roster', 'empty county archive room at dusk, a blue cloth bundle on a wooden table', 801],
  ['ending-letters', 'village doorway, a single letter on the stone step, snow falling', 802],
  ['ending-flag', 'memorial hall rooftop at dawn, small flag against pale sky, quiet', 803],
  ['ending-photo', 'warm desk lamp over a faded photograph and a magnifying glass', 804],
  ['ending-testimony', 'old cassette recorder on a table, dust in a sunbeam, empty chair', 805],
  ['ending-message', 'a village stone with no inscription at dawn, fields behind, quiet', 806],
]

const atmosphere = [
  ['atmo-rain', 'heavy rain streaks against dark water surface, texture, no subject', 901],
  ['atmo-snow', 'snow falling in a dark empty courtyard, single lamp glow', 902],
  ['atmo-fog', 'thick fog over a river at dawn, faint pier silhouettes', 903],
  ['atmo-ash', 'ash and embers floating in still air, dark background', 904],
  ['atmo-smoke', 'columns of smoke rising far away over low rooftops, dusk', 905],
  ['atmo-firelight', 'distant fire glow reflected on wet concrete, dark foreground', 906],
  ['atmo-water', 'rain rings on dark water surface, close texture', 907],
  ['atmo-lamp', 'single gas lamp in fog, wet cobblestones, empty street', 908],
]

const items = []
for (const [id, subject, seed] of [...scenes, ...moments, ...artifacts, ...figures, ...endings, ...atmosphere]) {
  items.push({
    id,
    category: id.split('-')[0],
    width: id.startsWith('figure') ? 768 : id.startsWith('artifact') ? 1024 : 1024,
    height: id.startsWith('figure') ? 1024 : id.startsWith('artifact') ? 1024 : 576,
    prompt: `${STYLE}, ${subject}`,
    negative: NEG,
    seed,
    out: `../../public/art/${id}.jpg`,
  })
}

await mkdir(PUBLIC_ART, { recursive: true })
await writeFile(OUT, JSON.stringify(items, null, 2), 'utf8')

// 同时输出 gen.py 可直接消费的 batch 格式
const batch = items.map((item) => ({
  prompt: item.prompt,
  negative: item.negative,
  seed: item.seed,
  width: item.width,
  height: item.height,
  out: item.out,
}))
const BATCH = path.join(ROOT, 'tools', 'imagegen', 'prebatch-60.json')
await writeFile(BATCH, JSON.stringify(batch, null, 2), 'utf8')

console.log(`pre-manifest: ${items.length} 条 -> ${path.relative(ROOT, OUT)}`)
console.log(`batch: ${batch.length} 条 -> ${path.relative(ROOT, BATCH)}`)
