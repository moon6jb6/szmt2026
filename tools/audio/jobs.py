"""Job spec for the《把名字留下来》sound set.

One entry per delivered file. `gen_seconds` is the *generation* length; the final
length is decided in post (loops are built from 2 takes + crossfades, one-shots
are trimmed around their strongest transient using `trim` / `trim_seconds`).

Prompts are English because the model's conditioner is T5-base trained on
English captions. They are deliberately short (the T5 conditioner truncates at
64 tokens) and end with negative guards ("no music, no voices") because this
score must stay restrained and concrete, never sentimental.

Temperament reference: chapter1.ts night1/night2/night3 + endings.ts
(concrete objects, quiet rooms, no battle detail, no emotional swell).
"""
from __future__ import annotations

# trim: "one"  -> keep a single gesture starting at the strongest onset
#       "steps"-> keep a longer window so two or three footfalls survive
#       "keep" -> whole take
JOBS: list[dict] = [
    # ------------------------------------------------------------------ six carriers
    # Each carrier must be identifiable with the eyes closed, so every one of them
    # lives in a different spectral pocket and has a different envelope
    # (see docs/audio/README.md「六种载体如何区分」).
    dict(id="click-roster", group="carrier", loop=False, gen_seconds=6.0, seed=1937,
         trim="one", trim_seconds=1.1, prompt=(
             "a thick bound ledger opened and closed once on a wooden table, "
             "dense paper pages, soft cloth, close microphone, no music, no voices"),
         use="记忆载体 名册 点击：厚册页翻开合上，闷、沉、有分量"),
    dict(id="click-letters", group="carrier", loop=False, gen_seconds=6.0, seed=1938,
         trim="one", trim_seconds=0.9, prompt=(
             "thin writing paper unfolded and refolded once, dry paper crinkle, "
             "very close microphone, quiet room, no music, no voices"),
         use="记忆载体 家书 点击：薄信纸，干、脆、轻"),
    dict(id="click-flag", group="carrier", loop=False, gen_seconds=6.0, seed=1939,
         trim="one", trim_seconds=1.0, prompt=(
             "one cotton flag snapping in the wind, hemp rope rubbing against a "
             "bamboo pole, cloth flap, close, no music, no voices"),
         use="记忆载体 旗 点击：棉布拍一下 + 麻绳磨竹竿"),
    dict(id="click-photo", group="carrier", loop=False, gen_seconds=6.0, seed=1946,
         trim="one", trim_seconds=0.5, prompt=(
             "paper photograph handled once, one short crisp paper snap, close "
             "microphone, no music, no voices"),
         use="记忆载体 照片 点击：硬相纸边缘咔一声，短"),
    dict(id="click-testimony", group="carrier", loop=False, gen_seconds=6.0, seed=1941,
         trim="one", trim_seconds=0.85, prompt=(
             "a pencil writing two short strokes on dry paper, graphite scratch on "
             "rough paper, close microphone, no music, no voices"),
         use="记忆载体 口述 点击：铅笔划两道，沙、涩"),
    dict(id="click-message", group="carrier", loop=False, gen_seconds=6.0, seed=1942,
         trim="one", trim_seconds=0.8, prompt=(
             "a small folded paper slip pulled from a cloth pocket and opened once, "
             "crisp light paper, close microphone, no music, no voices"),
         use="记忆载体 口信 点击：小纸条抽出展开，薄而脆"),

    # ------------------------------------------------------------------ materials
    dict(id="page-turn", group="material", loop=False, gen_seconds=6.0, seed=2101,
         trim="one", trim_seconds=1.2, prompt=(
             "a single page turned in a thick book, paper sliding and settling, "
             "close microphone, quiet, no music, no voices"),
         use="翻页：册页一页翻过、纸滑、落定"),
    dict(id="paper", group="material", loop=False, gen_seconds=6.0, seed=2102,
         trim="one", trim_seconds=1.0, prompt=(
             "one sheet of thin paper picked up and shaken once, dry paper rustle, "
             "close, no music, no voices"),
         use="纸：单张薄纸拿起抖一下"),
    dict(id="pen", group="material", loop=False, gen_seconds=6.0, seed=2103,
         trim="one", trim_seconds=1.3, prompt=(
             "a fountain pen writing a short line on paper, steel nib scratching, "
             "close microphone, no music, no voices"),
         use="笔：钢笔尖在纸上写短句"),
    dict(id="ink", group="material", loop=False, gen_seconds=6.0, seed=2104,
         trim="one", trim_seconds=0.7, prompt=(
             "a fountain pen nib dipped once into a glass ink bottle, soft wet dip, "
             "glass, close microphone, no music, no voices"),
         use="墨：笔尖蘸墨一下，湿、短"),
    dict(id="match", group="material", loop=False, gen_seconds=6.0, seed=2105,
         trim="one", trim_seconds=1.6, prompt=(
             "one match struck and catching flame, small scrape then soft flame, "
             "close microphone, no music, no voices"),
         use="火柴：划着、火起"),
    dict(id="footsteps", group="material", loop=False, gen_seconds=7.0, seed=2106,
         trim="steps", trim_seconds=3.2, prompt=(
             "slow heavy footsteps on a concrete floor in a large empty room, "
             "three steps, close, no music, no voices"),
         use="脚步：水泥地上三步，慢、闷"),
    dict(id="distant-thud", group="material", loop=False, gen_seconds=6.0, seed=2107,
         trim="one", trim_seconds=2.0,
         negative="explosion, gunfire, debris, glass breaking, music, voices",
         prompt=(
             "one distant muffled thud outside a thick concrete wall, very low and "
             "far away, no explosion detail, no debris, no music, no voices"),
         use="远处闷响：墙外的闷声，不写战斗细节"),

    # ------------------------------------------------------------------ ambience loops
    dict(id="rain-light", group="ambience", loop=True, gen_seconds=11.89, seed=3011,
         prompt=(
             "light steady rain on concrete and window glass, close, small drips, "
             "no thunder, no wind, no music, no voices"),
         use="雨·轻 循环：水泥与窗玻璃上的细雨"),
    dict(id="rain-heavy", group="ambience", loop=True, gen_seconds=11.89, seed=3012,
         prompt=(
             "heavy rain pouring on a concrete courtyard and a tin roof, dense "
             "steady downpour, no thunder, no music, no voices"),
         use="雨·重 循环：砸在院子和铁皮上的密雨"),
    dict(id="snow-wind", group="ambience", loop=True, gen_seconds=11.89, seed=3013,
         prompt=(
             "cold wind with fine snow blowing past a concrete wall, thin whistle, "
             "no howl, no music, no voices"),
         use="雪风 循环：细风带雪，不嚎"),
    dict(id="river", group="ambience", loop=True, gen_seconds=11.89, seed=3014,
         prompt=(
             "a wide river at night, low water lapping against stone steps, "
             "distant far bank, no music, no voices"),
         use="河水 循环：夜里的苏州河，贴着石阶"),
    dict(id="crowd-whisper", group="ambience", loop=True, gen_seconds=11.89, seed=3015,
         negative="music, singing, shouting, close voices, intelligible speech",
         prompt=(
             "a distant crowd murmuring low on the far side of a river, many "
             "indistinct far voices, no music"),
         use="人群低语 循环：隔河的一团人声，听不清字"),
    dict(id="room-tone", group="ambience", loop=True, gen_seconds=11.89, seed=3016,
         prompt=(
             "empty concrete warehouse room tone at night, very quiet low hum, "
             "faint air, no music, no voices"),
         use="室内底噪 循环：空仓库的夜"),
    dict(id="tape-hiss", group="ambience", loop=True, gen_seconds=11.89, seed=3017,
         prompt=(
             "old cassette tape hiss and thin mechanical hum, close, steady, "
             "no music, no voices"),
         use="磁带嘶声 循环：录音带 A-017 的底"),
    dict(id="flag-flap", group="ambience", loop=True, gen_seconds=11.89, seed=3018,
         prompt=(
             "a cotton flag flapping steadily on a bamboo pole in strong wind, "
             "cloth snap, rope tapping, no music, no voices"),
         use="旗面拍打 循环：楼顶的风把旗一遍遍掀开"),
    dict(id="radio-static", group="ambience", loop=True, gen_seconds=11.89, seed=3019,
         negative="music, voices, speech, broadcast",
         prompt=(
             "shortwave radio static and heterodyne whistle, close, intermittent, "
             "no voices, no music"),
         use="收音机杂音 循环：短波、间歇"),

    # ------------------------------------------------------------------ six ending drones
    # ids map 1:1 onto ENDINGS keys in src/game/content/endings.ts
    dict(id="drone-ending-names", group="drone", loop=True, gen_seconds=11.89, seed=4011,
         loop_from="single", prompt=(
             "low cold room drone, charcoal embers crackling in a brazier, one stone "
             "inkstone, sparse and restrained, no melody, no voices"),
         use="结局·名册：一九四七年的厢房，炭盆、砚、毛边纸"),
    dict(id="drone-ending-letters", group="drone", loop=True, gen_seconds=11.89, seed=4012,
         loop_from="single", prompt=(
             "thin kerosene lamp air hiss under a warm low drone, paper flutter, "
             "quiet, restrained, no melody, no voices"),
         use="结局·家书：煤油灯、纸、糨子"),
    dict(id="drone-ending-flag", group="drone", loop=True, gen_seconds=11.89, seed=4013,
         loop_from="single", prompt=(
             "cold wind over concrete under a very low sustained drone, loose rope "
             "creaking, empty, restrained, no melody, no voices"),
         use="结局·旗：旗没了，尺寸还在；风、绳、空"),
    dict(id="drone-ending-photo", group="drone", loop=True, gen_seconds=11.89, seed=4014,
         loop_from="single", prompt=(
             "still room drone with a slow glassy shimmer, faint paper, very quiet, "
             "restrained, no melody, no voices"),
         use="结局·照片：十一个人，认出九个；静、玻璃、纸"),
    dict(id="drone-ending-testimony", group="drone", loop=True, gen_seconds=11.89, seed=4015,
         loop_from="single", prompt=(
             "cassette tape hiss and motor hum under a low drone, small room, "
             "restrained, no melody, no voices"),
         use="结局·口述：录音带 A-017 的转动与底噪"),
    dict(id="drone-ending-message", group="drone", loop=True, gen_seconds=11.89, seed=4016,
         loop_from="single", prompt=(
             "air moving through an open doorway, low soft pulse, quiet room, "
             "restrained, no melody, no voices"),
         use="结局·口信：一句话传了四代；门开着，气在动"),
]


def job(job_id: str) -> dict:
    for j in JOBS:
        if j["id"] == job_id:
            return j
    raise KeyError(job_id)


if __name__ == "__main__":
    from collections import Counter
    c = Counter(j["group"] for j in JOBS)
    print(f"{len(JOBS)} jobs: {dict(c)}")
    print("one-shots:", sum(1 for j in JOBS if not j["loop"]),
          " loops:", sum(1 for j in JOBS if j["loop"]))
