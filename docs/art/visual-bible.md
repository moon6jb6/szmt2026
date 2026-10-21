# 《把名字留下来》视觉圣经 v1.0

> 500 张生成图的总谱。执行方：image-runner（唯一 GPU 所有者）。验收方：art-director。
> 生成器：`tools/imagegen/gen.py`（SDXL base 1.0 fp16 + Lightning 4-step LoRA，guidance=0，steps=4）。
> 总谱：`docs/art/image-manifest.json`（500 条，prompt 可直接喂 gen.py）；批次：`docs/art/batches/batch-###.json`。
> 生成脚本：`tools/imagegen/build-manifest.mjs`（章节场景表 → scene-* 条目，其余类别按模板生成）。

---

## 0. 一句话

**不是战争奇观，是遗物摄影。** 每一张图都应该像有人刚刚离开：桌上还留着墨、灯还亮着、名字还没写完。
观众第一眼看到的是物，第二眼才意识到缺了人。

风格基准：`public/bg/` 下 8 张已人工筛选图（office / warehouse / river / flag / bridge / dawn / wallhole / wounded）。
新图必须与它们放在一起不跳色、不跳光、不跳年代。**这 8 张是基准，不得重生成。**

---

## 1. 色板（硬约束）

| 色 | Hex | 占比 | 用在哪 |
|---|---|---|---|
| 旗红 | `#A32B2B` | ≈8% | 布料、印泥、火光、唯一的情绪高点；一张图里只出现一次红 |
| 铁锈 | `#7A3E2E` | ≈15% | 锈铁、砖墙、血迹干透后的颜色、旧木 |
| 沙金 | `#C8A063` | ≈20% | 灯、纸、粉尘光柱、干燥的土；所有"暖"都从这里来 |
| 烟黑 | `#16130F` | ≈35% | 阴影、烟、墙、夜；不允许纯黑死区，要能看见噪点与层次 |
| 纸白 | `#EDE6D8` | ≈22% | 纸、雾、灰、天光；高光不刺眼，微微发黄 |

规则：

1. **没有纯白、没有纯黑**。最亮止于纸白，最暗止于烟黑，暗部保留砖纹/纸纹。
2. **没有青蓝色高光**（现代屏幕色）。冷色只能通过雾、雨、水灰进入画面，色相仍偏中性。
3. 一张图 **不超过 3 个色相**：黑/灰打底 + 一个暖色 + 一个红色或金点。
4. 夜晚光源只允许：煤油灯、油灯、蜡烛、远处的岸灯、炮火映红的云。**不允许电灯泛白光**（1937 上海租界已有电灯，但画面里一律处理成昏黄小点、虚焦、不泛白）。

---

## 2. 光线规则

1. **单主光**。一张图只有一个主要光向；其余是反射与环境雾。
2. 白天：侧逆光，光柱穿过破窗/门缝/砖洞，空气里有尘、烟、水汽；用丁达尔效应把空间分层。
3. 夜晚：极小的一点暖光源（灯/火），周围大面积的烟黑；人的方位靠光缘而不是靠脸。
4. 室内：光永远从画面外斜上方来，留一束光打在"那个物件"上——那束光就是叙事重音。
5. 时间可读：晨=低角度长影、雾；正午=硬光硬影；黄昏=沙金偏红；夜=一点暖光；雪=冷灰底加一个小暖点。
6. 禁止：全局均匀光、现代补光、霓虹、屏幕光、闪光灯直打、HDR 高对比、过饱和。

---

## 3. 镜头语言

| 类别 | 构图 | 焦段语感 |
|---|---|---|
| `scene-*` 场景插画 | 16:9 横幅；远景/中景建立镜头；人物完全缺席；画面下 1/4 留给 UI 渐变遮罩，主体在中上部 | 24—35mm |
| `moment-*` 关键瞬间 | 近景/特写，只出现一个动作或一个物；可有远处极小剪影 | 50—85mm |
| `artifact-*` 文物 | 平铺俯拍（top-down flat lay），45° 也可；浅景深；纸面文字一律虚焦成墨迹 | 50mm 微距 |
| `figure-*` 人物 | 768×1024 竖幅；背影/远景剪影；人物占画面 1/3—1/2，不居中，留空 | 85—135mm |
| `ending-*` 结局 | 16:9；静物/空场/远景；左右留出字幕安全区 | 35mm |
| `ui-*` 界面纹理 | 1024×1024；局部材质平铺，可无缝；无主体、无构图中心 | 微距 |
| `atmo-*` 氛围空镜 | 16:9；雨/雪/烟/河/灯/雾；纯氛围但有时间与地点感 | 24—50mm |

共同规则：

1. **画框里必须有"框"**：门、窗、砖洞、桥洞、铁丝网、格子窗棂——用来把人眼引向深处。
2. **留白即叙事**：大面积的墙、雾、水面不是浪费，是"人不在了"。
3. 视线高度：站姿人眼高度（1.5—1.7m）为主；文物为俯视；剪影可低角度。
4. 不用鱼眼、不用广角畸变、不用多重曝光、不用拼贴、不用 3D 渲染感。

---

## 4. 人物规则（红线）

1. 人物 **只允许剪影或背影**；脸不出现、眼睛不出现、五官不出现。
2. 距离：剪影距镜头 ≥ 20m，或完全逆光只剩轮廓。
3. 局部手部可以使用（如一只手把纸塞进竹篙），但**只出现手，不出现头脸**；一只手即可，不要成群的肢体。
4. 军服只出现轮廓与材质：灰布、绑腿、布鞋、斗笠/军帽轮廓；**不画任何徽章、领章、番号、袖标**。
5. 不画日军形象（不出现太阳旗、不出现具体军服细节）；敌方只以硝烟、枪口焰、钢盔轮廓的远景或阴影暗示。
6. 不画尸体、不画伤情特写、不画暴行、不画杀敌瞬间。血只用"干透的锈色痕迹"暗示。

---

## 5. 文物规则

1. 名册、家书、报纸、公文一律 **平铺俯拍 + 浅景深 + 局部虚焦**；纸上的字处理成**不可辨认的墨迹/铅字块**。
2. 报纸一律 **虚焦处理**，只看得见标题的大块墨色与纸张的粗纤维，看不见具体字。
3. 印章只出现模糊的方形红痕，不出现可辨字。
4. 旗帜：**只出现红布、针脚、布料经纬、竹竿毛刺、逆光剪影**。任何情况下不画面旗徽记、不画图案、不画星星/太阳/条纹。需要"旗"的叙事时，用"旗绳、竹竿、绑腿、布角"来指认。
5. 金属：刺刀、弹壳、水壶、铁柜——锈、划痕、指印优先级高于光泽。
6. 纸：毛边纸、宣纸、报纸、牛皮纸的纤维要在光里看得见；折痕比文字重要。

---

## 6. 禁止项（硬红线，VLM 与人工双查）

**现代物**：摩天楼、玻璃幕墙、霓虹、汽车、摩托、飞机、火车头特写（1937 有火车，但只可远景轮廓，不得出现现代车厢）、电线杆成排、塑料、尼龙、圆珠笔、钢笔（可用钢笔？——**只允许毛笔、铅笔头、蘸水钢笔，不允许现代钢笔/签字笔**）、手表、眼镜、手机、屏幕、二维码、电灯白光、空调外机、柏油路面标线。

**文字**：英文字母、拉丁字母、任何可辨认中文、书法作品、印刷可读字、数字、二维码。画面里出现"字"的合法形式只有：**虚焦墨迹、铅字块、印章红痕、纸的纹理**。

**人脸**：清晰人脸、侧面五官、眼睛特写、集体照人脸、人像摄影。人物只能是剪影/背影。

**旗帜图案错误**：星条旗、太阳旗、任何可辨认的旗徽/星徽/条纹。一切旗帜只给布料。

**暴力与苦难消费**：尸体、断肢、血腥、伤口特写、暴行场景、杀敌计数可视化、以死亡人数做画面冲击。

**观感污染**：过饱和、HDR、锐化过度、塑料质感、3D 渲染、卡通、动漫、游戏 UI 风、水印、签名、边框、拼贴、多重曝光、鱼眼。

---

## 7. prompt 结构（r4）：风格词 → 类别护栏 → 内容

**SDXL CLIP 上限 77 token（含 BOS/EOS），超过从末尾截断。** 风格词必须放最前；每条 prompt **估算 ≤66 token**（校准后的保守估算 ≈ 真实 ≤72；build-manifest.mjs 内置估算 + 分级裁剪）。

```text
[风格前缀] + [类别护栏：空场/静物/剪影锚点] + [内容：一个场景/一个物，英文，逗号分句]
```

风格前缀：

```text
1937—1941 场景：cinematic film still, 1937 China, muted desaturated warm sepia palette, volumetric haze, painterly realism
1947 与记忆线（卷零/卷四/卷五 1991+，26 张）：cinematic film still, China, muted desaturated warm sepia palette, volumetric haze, painterly realism
```

> **时代前缀规则**：卷零（1947 造册）与卷四（1950—2025 记忆线）、卷五后三场（1991/2005/2025）不能用 "1937 China"，否则 1982 录音机、2015 英名墙都会被拉回 1937；调色、雾、画风三项保持一致。由 build-manifest.mjs 按场景 `date` 自动判定。

类别护栏（紧跟风格前缀，CLIP 前置权重最高；**guidance=0 时 negative 不生效，这是唯一有效的红线防线**）：

| 类别 | 护栏 |
|---|---|
| `scene` | `empty scene, no people, no faces, no text` |
| `moment` | `hands and objects only, no faces, no text` |
| `artifact` | `top down flat lay, blurred writing, no people` |
| `figure` | `lone silhouette from behind, no face, no text` |
| `ending` | `empty scene, no people, no text` |
| `ui` | `flat surface texture, no people, no text` |
| `atmo` | `empty scene, no people, no text` |

**裁剪优先级（超预算时）**：① 先删 `wide shot / shallow depth of field / full body silhouette` 这类低信息构图段 → ② 删 ≤5 词的纯光线/氛围段 → ③ 再删中间最长的内容段 → ④ 只剩两段时保留信息更多的一段（避免 figure 丢掉"那个人"）。目标是把 token 留给"具体物 + 动作"（例：scene-001 保住"便条压在木凳上"，scene-002 保住"木箱上的册子与蓝布"）。

### 版本记录

| rev | 变更 | 触发 |
|---|---|---|
| r1 | 风格词前置 + 统一尾缀；估算器偏乐观 | 初版 |
| r2 | 护栏前置（空场/静物/剪影）；风格前缀加 `warm sepia` | 抽查 scene-002 出清晰人脸、scene-003 出人群；根因 guidance=0 时 negative 不生效 + no people 在末尾权重太弱 |
| r3 | 估算器按实测 tokenizer 重标定（词+逗号+BOS/EOS），阈值估 66 / 真实 ≤72；裁剪改为"先删构图段、保具体物"；护栏精简换内容空间 | image-runner 实测 scene-001 tokenizer 79 > 77，「no text」被截断 |
| r4 | **scene 类 prompt 改按 writers 真实场景表重写**（`SCENE_OVERRIDES`，卷零—卷五全部场次对齐；usage 换真实场次名）；时代中性前缀（1947/记忆线 26 张）；裁剪优先级再加"纯光线段" | writers 场景表落地，实际场景（便条/烘笼/廊下/三双鞋/车厢/破鞋/钢盔/网眼/砚台/空竹竿/一锅粥/礼帽/委任状/空位/四月二十四日/灵堂/三百五十四/留白…）比预案更具体 |
| r5 | **moment 类句型重写**（`MOMENT_OVERRIDES` 100 条）：从"手正在做过程动作"改为"物为主语 + 动作结果"（笔搁在纸上+墨点、针扎在布衬上+线垂着、纸筒半塞进竹篙），删除所有远处人影，手只作边缘元素 | 冒烟 3 张 moment 全部丢失具体物（moment-001 无笔纸手、moment-002 无针线、moment-003 出现远处人影）：4-step Lightning 对过程动作还原不稳定 |
| r6 | 清掉 artifact/ending/ui 中会诱发"画手/画人"的 9 处词（hand stitched→uneven stitching、Two hands receiving→letter on table、blurred figures→image out of focus、hand crank→crank handle 等） | 人工预检非 scene 类别 prompt 时发现；artifact=平铺静物、ending=空场，均不许出现手/人 |

> id / seed / 配额跨版本不变，只升 prompt（manifest 每条带 `rev` 字段；r2 预裁版留档 `docs/art/image-manifest-r2-pretrim.json`）。

---

## 8. negative 词表

基础（沿用 `gen.py --negative` 默认，另加红线段）：

```
blurry, lowres, jpeg artifacts, watermark, text, logo, signature, cartoon, anime,
3d render, plastic skin, extra limbs, deformed, modern buildings, neon signs, cars,
power lines, oversaturated
```

红线追加（所有类别都加）：

```
english letters, latin letters, chinese characters, calligraphy, legible text,
printed words, numbers, faces, eyes, portrait, crowd, modern clothing, nylon,
plastic, ballpoint pen, wristwatch, glasses, skyscraper, ferris wheel, motorcycle,
airplane, fluorescent light, modern elements, emoji, flag emblem, star emblem,
sun emblem, military insignia, rising sun flag, corpse, blood splatter, gore,
violence
```

> ⚠️ **negative 在 guidance=0 时不生效**：`gen.py` 只有 `guidance > 1.0` 才会把 negative 传给 pipeline（Lightning 蒸馏默认关 CFG）。所以红线的第一道防线是 **prompt 里的 `no people / no faces / no text` 与负样本质检**，negative 字段是"换 guidance 重试"时的弹药。manifest 仍保留完整 negative，供 image-runner 按自己的管线决定是否启用。

分类追加：

| 类别 | 额外 negative |
|---|---|
| `scene` | `people, person, figures` |
| `moment` | `hands too many, crowd` |
| `artifact` | `sharp text, legible handwriting, book cover title` |
| `figure` | `front view, face, eyes, portrait, closeup of face` |
| `ending` | `people, person, crowd` |
| `ui` | `figures, people, subject` |
| `atmo` | `people, person` |

---

## 9. 尺寸、配额、命名与批次

| 类别 | 配额 | 尺寸（W×H） | manifest id | 落盘 |
|---|---|---|---|---|
| `scene-*` | 128 | 1024×576 | `scene-001` … `scene-128` | `public/art/scene-001.jpg` … |
| `moment-*` | 100 | 1024×576 | `moment-001` … | `public/art/moment-001.jpg` … |
| `ending-*` | 30 | 1024×576 | `ending-001` … | `public/art/ending-001.jpg` … |
| `atmo-*` | 42 | 1024×576 | `atmo-001` … | `public/art/atmo-001.jpg` … |
| `artifact-*` | 80 | 1024×576 | `artifact-001` … | `public/art/artifact-001.jpg` … |
| `figure-*` | 60 | 768×1024 | `figure-001` … | `public/art/figure-001.jpg` … |
| `ui-*` | 60 | 1024×1024 | `ui-001` … | `public/art/ui-001.jpg` … |
| **合计** | **500** | | | |

> **实际交付尺寸口径（Lead 2026-10-21 拍板）**：落盘 **960×544**（8GB 显存下的速度取舍，交付说明中注明）；上表 width/height 保留为规格记录。`figure-*` 按 768×1024、`ui-*` 按 1024×1024 生成。抽查与验收以实际落盘 json 记录的尺寸为准。

- **id 已冻结，永不改名**（image-runner 按 id 批处理，改名会丢已生成图）。id → 场景的映射看 `scene` 字段：`scene-001→v0-01`、`scene-009→v1-01`、`scene-034→v2-01`、`scene-079→v3-01`、`scene-104→v4-01`、`scene-119→v5-01`、`scene-128→v5-10`。
- **集成用映射表**：`docs/art/scene-map.json`，`{ "v2-13": { "image": "public/art/scene-046.jpg", "id": "scene-046", "usage": "…" } }`，Lead 在 `Scene.image` 字段直接查这张表，共 128 条。
- `scene-*` 覆盖卷 0—5 的 128 个新场景；`chapter1.ts` 现有 12 个场景继续用 `public/bg/` 8 张基准图，**不重复生成、不占 128 槽位**。核心戏的补图走 `moment-*`（night1 点名 / night3 升旗 / night5 过桥）。
- 构图安全区：场景插画下 1/4 是 UI 文字区（主体避开最底 140px）；`ending-*` 左右各留 220px 字幕区；`figure-*` 脚底留 8% 余量。

### 批次表（`docs/art/batches/`，gen.py `--batch` 直接吃）

| 文件 | 内容 | 张数 |
|---|---|---|
| `batch-001` | scene-001…050 | 50 |
| `batch-002` | scene-051…100 | 50 |
| `batch-003` | scene-101…128 + moment-001…022 | 50 |
| `batch-004` | moment-023…072 | 50 |
| `batch-005` | moment-073…100 + ending-001…022 | 50 |
| `batch-006` | ending-023…030 + atmo-001…042 | 50 |
| `batch-007` | artifact-001…050 | 50 |
| `batch-008` | artifact-051…080 + figure-001…020 | 50 |
| `batch-009` | figure-021…060 + ui-001…010 | 50 |
| `batch-010` | ui-011…060 | 50 |

- 批次按出图优先级排序（scene → moment → ending → atmo → artifact → figure → ui），**已落盘的批次内容不再变**，后续只会新增编号更大的批次；重跑同一批次时按 `public/art/<id>.jpg` 是否已存在做跳过。
- 每批 50 张；image-runner 每批后做 VLM 逐张质检，art-director 每 50 张抽 10 张人工看「灵魂五问」（§11）。

---

## 10. seed 与重试

- manifest 里的 `seed` 由 id 的 FNV-1a 哈希确定，**同一条永远同 seed**，便于复现与回滚。
- 生成参数固定：`steps=4, guidance=0`（Lightning 蒸馏，CFG 关闭时 negative 不生效——需要 negative 生效时把 guidance 提到 2.0，仅对 retry 用）。
- `retry` 换 seed：原 seed + 1000（第一次）、+2000（第二次），最多 2 次。
- `reject`：记录原因，改 prompt 重来（art-director 出修订条目，见 §12）。

---

## 11. 质检：什么算「有灵魂」

VLM 初筛（image-runner）查：prompt 符合度 / 时代准确性 / 画面瑕疵 / 有没有人脸-文字-现代物。
art-director 人工抽查（每 50 张抽 10 张）只问五个问题：

1. **有没有一个具体物**？（不是"仓库一角"，而是"半块干粮"、"缝过的衣襟"、"钥匙"）
2. **有没有一道光在替我们看**？（光打在哪个物件上，是不是那束光在讲故事）
3. **有没有人的缺席**？（空椅、摊开没写完的册、墙上的影子、桥头的空位）
4. **删掉一切氛围之后，这张图还剩什么动作**？（如果只剩"很好看"，算空镜）
5. **它放进 500 张里，能不能被认出来**？（不重复、不油腻、不是壁纸）

五问里有 **≥3 个"是"** 才算通过。全部"是"为 A 级，可做关键节点头图。
只有氛围没有叙事的（"很美的空镜"）——判 `atmo` 降级，不占 scene/moment/artifact 名额。

抽查记录：`docs/art/spot-check.md`。

---

## 12. 更新流程

1. writers 交卷后，Lead/art-director 运行：
   ```powershell
   node tools/imagegen/build-manifest.mjs --refresh
   ```
   脚本重新解析 `src/game/content/volume*.ts` 与 `chapter1.ts`，把 `scene` 元信息（title/location/date）回填到 manifest；若出现新场景 id 且无手写 prompt，则用场景字段自动生成兜底 prompt。
2. 已生成过的条目 **prompt 不变**（seed 不变，可复现）；只有新增/修正条目需要 image-runner 补跑。
3. 任何 prompt 修改必须在本文件或 `build-manifest.mjs` 的数据表里留痕，不允许手改 `image-manifest.json`。
