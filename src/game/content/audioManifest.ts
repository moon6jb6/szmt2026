// 由 tools/audio/build-audio-manifest.mjs 自动生成，请勿手改
// 来源：docs/audio/audio-manifest.json（audio-owner 生成）
export type AudioGroup = 'carrier' | 'material' | 'ambience' | 'drone'

export type AudioEntry = {
  id: string
  /** 相对路径，播放时拼 import.meta.env.BASE_URL */
  file: string
  group: AudioGroup
  duration: number
  loop: boolean
  use: string
}

export const AUDIO_MANIFEST: Record<string, AudioEntry> = {
  "click-roster": {
    "id": "click-roster",
    "file": "audio/click-roster.ogg",
    "group": "carrier",
    "duration": 1.1,
    "loop": false,
    "use": "记忆载体 名册 点击：厚册页翻开合上，闷、沉、有分量"
  },
  "click-letters": {
    "id": "click-letters",
    "file": "audio/click-letters.ogg",
    "group": "carrier",
    "duration": 0.9,
    "loop": false,
    "use": "记忆载体 家书 点击：薄信纸，干、脆、轻"
  },
  "click-flag": {
    "id": "click-flag",
    "file": "audio/click-flag.ogg",
    "group": "carrier",
    "duration": 1,
    "loop": false,
    "use": "记忆载体 旗 点击：棉布拍一下 + 麻绳磨竹竿"
  },
  "click-photo": {
    "id": "click-photo",
    "file": "audio/click-photo.ogg",
    "group": "carrier",
    "duration": 0.5,
    "loop": false,
    "use": "记忆载体 照片 点击：硬相纸边缘咔一声，短"
  },
  "click-testimony": {
    "id": "click-testimony",
    "file": "audio/click-testimony.ogg",
    "group": "carrier",
    "duration": 0.85,
    "loop": false,
    "use": "记忆载体 口述 点击：铅笔划两道，沙、涩"
  },
  "click-message": {
    "id": "click-message",
    "file": "audio/click-message.ogg",
    "group": "carrier",
    "duration": 0.8,
    "loop": false,
    "use": "记忆载体 口信 点击：小纸条抽出展开，薄而脆"
  },
  "page-turn": {
    "id": "page-turn",
    "file": "audio/page-turn.ogg",
    "group": "material",
    "duration": 1.2,
    "loop": false,
    "use": "翻页：册页一页翻过、纸滑、落定"
  },
  "paper": {
    "id": "paper",
    "file": "audio/paper.ogg",
    "group": "material",
    "duration": 1,
    "loop": false,
    "use": "纸：单张薄纸拿起抖一下"
  },
  "pen": {
    "id": "pen",
    "file": "audio/pen.ogg",
    "group": "material",
    "duration": 1.1,
    "loop": false,
    "use": "笔：钢笔尖在纸上写短句"
  },
  "ink": {
    "id": "ink",
    "file": "audio/ink.ogg",
    "group": "material",
    "duration": 0.7,
    "loop": false,
    "use": "墨：笔尖蘸墨一下，湿、短"
  },
  "match": {
    "id": "match",
    "file": "audio/match.ogg",
    "group": "material",
    "duration": 1.6,
    "loop": false,
    "use": "火柴：划着、火起"
  },
  "footsteps": {
    "id": "footsteps",
    "file": "audio/footsteps.ogg",
    "group": "material",
    "duration": 3.2,
    "loop": false,
    "use": "脚步：水泥地上三步，慢、闷"
  },
  "distant-thud": {
    "id": "distant-thud",
    "file": "audio/distant-thud.ogg",
    "group": "material",
    "duration": 2,
    "loop": false,
    "use": "远处闷响：墙外的闷声，不写战斗细节"
  },
  "rain-light": {
    "id": "rain-light",
    "file": "audio/rain-light.ogg",
    "group": "ambience",
    "duration": 21.06,
    "loop": true,
    "use": "雨·轻 循环：水泥与窗玻璃上的细雨"
  },
  "rain-heavy": {
    "id": "rain-heavy",
    "file": "audio/rain-heavy.ogg",
    "group": "ambience",
    "duration": 20.26,
    "loop": true,
    "use": "雨·重 循环：砸在院子和铁皮上的密雨"
  },
  "snow-wind": {
    "id": "snow-wind",
    "file": "audio/snow-wind.ogg",
    "group": "ambience",
    "duration": 29.97,
    "loop": true,
    "use": "雪风 循环：细风带雪，不嚎"
  },
  "river": {
    "id": "river",
    "file": "audio/river.ogg",
    "group": "ambience",
    "duration": 20.44,
    "loop": true,
    "use": "河水 循环：夜里的苏州河，贴着石阶"
  },
  "crowd-whisper": {
    "id": "crowd-whisper",
    "file": "audio/crowd-whisper.ogg",
    "group": "ambience",
    "duration": 20.96,
    "loop": true,
    "use": "人群低语 循环：隔河的一团人声，听不清字"
  },
  "room-tone": {
    "id": "room-tone",
    "file": "audio/room-tone.ogg",
    "group": "ambience",
    "duration": 21.38,
    "loop": true,
    "use": "室内底噪 循环：空仓库的夜"
  },
  "tape-hiss": {
    "id": "tape-hiss",
    "file": "audio/tape-hiss.ogg",
    "group": "ambience",
    "duration": 20.08,
    "loop": true,
    "use": "磁带嘶声 循环：录音带 A-017 的底"
  },
  "flag-flap": {
    "id": "flag-flap",
    "file": "audio/flag-flap.ogg",
    "group": "ambience",
    "duration": 29.85,
    "loop": true,
    "use": "旗面拍打 循环：楼顶的风把旗一遍遍掀开"
  },
  "radio-static": {
    "id": "radio-static",
    "file": "audio/radio-static.ogg",
    "group": "ambience",
    "duration": 20.32,
    "loop": true,
    "use": "收音机杂音 循环：短波、间歇"
  },
  "drone-ending-names": {
    "id": "drone-ending-names",
    "file": "audio/drone-ending-names.ogg",
    "group": "drone",
    "duration": 20.28,
    "loop": true,
    "use": "结局·名册：一九四七年的厢房，炭盆、砚、毛边纸"
  },
  "drone-ending-letters": {
    "id": "drone-ending-letters",
    "file": "audio/drone-ending-letters.ogg",
    "group": "drone",
    "duration": 29.46,
    "loop": true,
    "use": "结局·家书：煤油灯、纸、糨子"
  },
  "drone-ending-flag": {
    "id": "drone-ending-flag",
    "file": "audio/drone-ending-flag.ogg",
    "group": "drone",
    "duration": 20.22,
    "loop": true,
    "use": "结局·旗：旗没了，尺寸还在；风、绳、空"
  },
  "drone-ending-photo": {
    "id": "drone-ending-photo",
    "file": "audio/drone-ending-photo.ogg",
    "group": "drone",
    "duration": 21.38,
    "loop": true,
    "use": "结局·照片：十一个人，认出九个；静、玻璃、纸"
  },
  "drone-ending-testimony": {
    "id": "drone-ending-testimony",
    "file": "audio/drone-ending-testimony.ogg",
    "group": "drone",
    "duration": 20.38,
    "loop": true,
    "use": "结局·口述：录音带 A-017 的转动与底噪"
  },
  "drone-ending-message": {
    "id": "drone-ending-message",
    "file": "audio/drone-ending-message.ogg",
    "group": "drone",
    "duration": 29.97,
    "loop": true,
    "use": "结局·口信：一句话传了四代；门开着，气在动"
  }
}

export const AUDIO_IDS: string[] = ["click-roster","click-letters","click-flag","click-photo","click-testimony","click-message","page-turn","paper","pen","ink","match","footsteps","distant-thud","rain-light","rain-heavy","snow-wind","river","crowd-whisper","room-tone","tape-hiss","flag-flap","radio-static","drone-ending-names","drone-ending-letters","drone-ending-flag","drone-ending-photo","drone-ending-testimony","drone-ending-message"]
