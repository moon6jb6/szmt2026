# 3D 场景与 GLB 模型加载 专项复测（2026-10-22）

> 范围：《把名字留下来》真 3D 切片（`src/game/components/Scene3D.tsx`）+ Blender 西墙资产
> `public/models/warehouse-ext.glb`（480,860 B / 4,732 tris）。
> 允许改动：`Scene3D.tsx`、`content/scene3d.ts`、`tools/test-3d.mjs`、`tools/3d/**`。
> **本轮改了 7 处真实缺陷**（GLB 比例、上下文丢失永久黑屏、卸载漏 GLB、贴图不释放、重复拉 GLB、fps 自报高估、浏览器缩放后画布不跟 DPR），
> 另加一组 `data-*` 诊断以便回归断言；
> **另有 2 项必须改 `App.tsx`（本轮只写报告）**：lazy chunk 失败没有 ErrorBoundary（**P0 白屏**）、换场时 `view3d` 复位晚一拍。

---

## 一、结论

| # | 检查项 | 结论 |
|---|---|---|
| 1 | 路径与部署 | ✅ **dev / preview / 子目录（中文目录名 + URL 编码）三种形态 GLB 全部 200**；`dist/models/warehouse-ext.glb` 与 `public/` 那份字节一致；`BASE_URL` 拼接正确（产物里是 `./models/warehouse-ext.glb`） |
| 2 | 加载时机与回退 | ✅ 404 / 损坏 GLB / 慢网 / 已缓存断网 → 全部**静默回退到灯光地面**，无应用报错、不卡死<br>⚠️ **断网冷启动（lazy chunk 未缓存）→ 整页白屏**，必须改 App |
| 3 | 渲染正确性 | ✅ 5 切片全部出图：11—16 draw calls / 828—4,734 tris；GLB 朝向 +Z 面向镜头、比例 64.34 × 27.71 m、落地 base y=0.002、baseColor=**srgb**、normal=**NoColor**、**未复现 z-fighting**；11/11 材质 DoubleSide（**不能盲改 FrontSide**，实测会变 4,499 px） |
| 4 | 资源管理 | ✅ 20 次开关：canvas 每次回到基线 3、`.scene3d` 0 残留、无报错、首帧 43—75 ms 无衰减<br>✅ `WEBGL_lose_context` → `lost`（画布隐藏）→ `restored` 自动恢复出帧 119 fps<br>✅ DPR 上限 2、resize、缩到 <700px 自动卸载 |
| 5 | 性能 | ✅ 1600×1000：60—137 fps（切片自报 51—146）；390×844：2.5D 239 fps、按设计不出 3D；900×1000：仍 13 calls；4× CPU 降频：首帧 1.24 s、77.3 fps（自报最低 53.8）仍可用；首帧拆分 = chunk 305—314 ms + WebGL/切片 355—859 ms |
| 6 | App 契约 | ✅ `Scene3D` props 只有 `variant`<br>⚠️ 换场时 App 多挂一次 3D（实测 687 ms 一次白搭的 WebGL 初始化）；`<700px` 自动退出正常 |

**一句话**：GLB 这条链路（路径、部署、失败回退、卸载释放）现在是干净的；**唯一会让用户白屏的洞不在 3D 代码里，而在 App 没有给 lazy 组件套 ErrorBoundary。**

---

## 二、环境与方法

| 项 | 值 |
|---|---|
| 机器 / GPU | Windows + **Intel UHD Graphics（ANGLE Direct3D11，集显，非 SwiftShader 软光栅）**；`WebGL 2.0`，MAX_TEXTURE_SIZE 16384 |
| 浏览器 | Playwright `channel: chrome`（HeadlessChrome/155，无头，真 GPU） |
| 构建 | `npx tsc -b && npx vite build`；lazy 切片 `assets/Scene3D-<hash>.js`（本轮实测 670,165 B，gzip 172.42 KB；hash 每次构建会变）、主包 `assets/index-<hash>.js` 846 KB |
| 资产 | `dist/models/warehouse-ext.glb` 480,860 B，SHA-256 `67CC23A67ABE4F1F1FD2121E48DF82071AE101214C3E1BD8503B273841C05778` —— **与 `docs/report/2026-10-22-blender-asset.md` 记录的哈希、与 `public/` 那份完全一致** |
| 视口 | 主测 1600×1000@DPR1；另有 1280×800 / 900×1000 / 390×844@DPR3 |
| 服务器 | preview `http://127.0.0.1:4173/`（vite preview，服务 `dist/`）；dev `npx vite`（临时端口）；子目录 = `dist` 拷进 `<tmp>/pkg/01_作品及成果文件/` 后用 python http.server 起 |

> **fps 说明**：这台机器同时跑着若干 node 构建任务（本轮观测到 14 个 node 进程、Edge/豆包占 CPU），fps 波动很大。
> 所以下面给的 fps 都是「同一次会话多轮采样」的实测值 + 观察区间；**draw calls / 三角面 / 首帧拆分 / 资源计数是确定量**，可直接当回归基线。
> 另外无头 Chrome 的 rAF 没有锁 60Hz（空转基线能到 237 fps），因此「fps ≥ 55」这类门槛只在真实显示器上才有意义，这里只做横向比较。

新增/改写的工具（都在允许目录内）：

| 文件 | 作用 |
|---|---|
| `tools/3d/review.mjs` | 四个套件：`fallback` / `cycles` / `perf` / `deploy`，每个都出 JSON + 截图 |
| `tools/3d/inspect-glb.mjs` | 直接读 GLB 二进制：primitive/三角面/材质/贴图/doubleSided/包围盒（不启浏览器） |
| `tools/3d/glb-probe.html` + `glb-probe.mjs` | 用**和 Scene3D 完全相同的参数**把 GLB 单独装一遍，读 `colorSpace` / `side` / 落地包围盒，并做像素级 z-fighting 与背面剔除对比 |
| `tools/3d/proto-shot.mjs` | 独立验证页 `proto.html` 五切片批量截图（顺带给 proto 页补上 warehouse-ext + favicon） |
| `tools/3d/gpu-info.mjs` | 打印 WebGL 后端（区分真 GPU / 软光栅） |
| `tools/3d/probe.mjs` | 单点调试：进场景 → 点 3D → 逐 500 ms 打快照与全部控制台事件 |
| `tools/test-3d.mjs` | 重写为「带数字的集成测试」：首帧拆分、GLB 网络/缓存、二次进入、回退断言、JSON 落盘 |

---

## 三、逐项证据

### 1. 路径与部署

三种部署形态都实测到「GLB 200 + `data-glb=ready` + 13 draw calls / 4,734 tris」：

| 形态 | 页面 URL | GLB 请求 | 字节 | 首帧（点按钮→首帧） | 结果 |
|---|---|---|---|---|---|
| dev（vite，未打包） | `http://127.0.0.1:53009/` | `GET /models/warehouse-ext.glb` → **200** | 480,860 | 697 ms | ✅ calls 13 / tris 4,734 / ready |
| preview（`dist/`） | `http://127.0.0.1:4173/` | `GET /models/warehouse-ext.glb` → **200** | 480,860 | 647 ms | ✅ 13 / 4,734 / ready |
| **子目录**（python http.server） | `http://127.0.0.1:16653/pkg/01_%E4%BD%9C%E5%93%81%E5%8F%8A%E6%88%90%E6%9E%9C%E6%96%87%E4%BB%B6/` | `GET /pkg/01_作品及成果文件/models/warehouse-ext.glb` → **200** | 480,860 | 651 ms | ✅ 13 / 4,734 / ready |

> 子目录名故意用了中文长目录（`01_作品及成果文件`），浏览器把路径编码成 `%E4%BD%9C…`，服务端 200，**没有 404**。
> 证据：`tools/3d/shots/review/review-deploy.json`、`deploy-subdir.png`（子目录下 3D 正常出墙）。

**`import.meta.env.BASE_URL` 拼接**：`vite.config.ts` 是 `base: './'`，因此构建产物
`assets/Scene3D-<hash>.js` 内是字面量 `` `./models/warehouse-ext.glb` ``（字符串级核对过），
远景贴图同一套：`bg/warehouse.jpg` → `./bg/warehouse.jpg`。两者都以 **document URL** 为基准解析，
所以在 `…/01_作品及成果文件/` 下分别落到 `…/01_作品及成果文件/models/…` 与 `…/01_作品及成果文件/bg/…`。
night1 的成片里能看到 `warehouse.jpg` 已经贴在远景板上（`3d-night1-plate.png`），是「贴图路径也一并成立」的反证。

**`dist/models/warehouse-ext.glb` 被正确复制**：`deploy` 套件直接比对字节 —— `bytes: 480860, sameAsPublic: true`。

**⚠️ 这是最容易回归的点，本次确认通过，但要知道它的失效条件**：
相对路径依赖「document URL 的最后一段是目录」。当前是单页应用（无 history 路由）所以成立。
一旦有人引入 `history.pushState` 到 `/scene/night1` 这种无斜杠路径，或把 `index.html` 换成不带尾斜杠的入口，
`./models/…` 就会解析到上一级目录 → **GLB 404 且只会在子目录部署时暴露**。
回归防线已经就位：`node tools/3d/review.mjs deploy` 会在临时目录重建一个中文子目录站，并断言 `GLB 200 + bytes=480860 + data-glb=ready`，退出码非 0 即红。

`content/scene3d.ts` **本轮未改**：它的路径约定（相对路径不带前导 `/`，由 Scene3D 拼 `BASE_URL`）本来就是对的，
App 只用它做「场景 id → 切片」映射，改它没有收益。

### 2. 加载时机与失败回退

| 场景 | 注入方式 | 结果 | 证据 |
|---|---|---|---|
| **GLB 404** | `route.fulfill(404)` | `data-glb=failed`，画布继续出帧（68—176 fps），**应用层 0 报错**，画面回落到灯光地面 | `fallback-404.png` |
| **GLB 损坏** | 200 + 4 KB 的 `0x41` 垃圾 | GLTFLoader 走 `onError` → `failed`，**0 报错**（loader 内部吞掉解析异常），出帧正常 | `fallback-corrupt.png` |
| **断网（冷启动，chunk 未缓存）** | `context.setOffline(true)` → 点 3D | ❌ **整页崩**：`pageerror: Failed to fetch dynamically imported module: …/assets/Scene3D-*.js`；`appShell=false`、`.scene-body` 消失、正文空 | `fallback-offline.png`（**纯色空白**） |
| **断网（热：已成功进过一次 3D）** | 同上，但先在线开一次 | ✅ GLB 仍 `ready`（`THREE.Cache` 命中）、107 fps、0 报错 | `fallback-offline-warm.png` |
| **慢网 + 300 ms 后切回 2.5D** | route delay 3500 ms | 切走时 `data-glb=loading`；3.5 s 后晚到的 GLB 被 `disposeObject` 释放；`.scene3d` 0 残留、canvas 回基线、0 报错 | `loading-glb-pending.png`、`fallback-slow-abort.png` |
| **3D 开着切场景（GLB 延迟 3 s）** | 选选项 → 继续 → 换场 | ✅ 换场后 `.scene3d=0`、canvas 回基线 3、晚到 GLB 不复活、0 报错 | `switch-scene.png` |
| **加载中的画面** | 同上（GLB 未到） | ✅ **不是空白**：地面 + 尘 + 四盏灯先出（约 0.7—1.3 s），正文卡片照常可读 | `loading-glb-pending.png` |
| **重复进入同一场景** | 关掉再开 | ✅ 第二次首帧 **135 ms**（首次 660 ms）、**GLB 网络请求 0 次** | `3d-v1-25-second-mount.png`、`3d-v1-25.json` |

**P0 详情（必须改 App）**：`App.tsx:1089` 是 `<Suspense fallback={null}><Scene3D …/></Suspense>`，
`Suspense` 只接挂起、不接异常；`lazy` 的 `import()` 被拒 → React 19 把错误抛到根 → **整棵树卸载**，页面只剩 `<body>` 底色。
本轮在两条互相独立的路径上都复现了它：

1. 断网冷启动点「3D 视角」（上文，截图 `fallback-offline.png`）；
2. `npm run dev` **第一次**点「3D 视角」时 Vite 依赖预构建（`three`）会 abort 在飞模块请求，日志见 `tools/3d/probe.mjs` 输出
   （`REQFAIL …/three.module-*.js net::ERR_ABORTED` → `appShell=false`）→ 页面被 Vite 强制刷新回菜单。第二次点就正常
   （`review-deploy.json` 里 dev 的 `attempts: 1, ok: true`）。

> 结论：「GLB 加载失败」这条链已经稳了；**「组件代码本身加载失败」这条链没有兜底**。修法见「六、A」。

### 3. 渲染正确性

五个切片，1600×1000@DPR1，**同一构建、同一次会话**（`node tools/test-3d.mjs http://127.0.0.1:4173/ <id>`）：

| 场景 id | 切片 | fps（外部 rAF / 自报） | draw calls | 三角面 | 首帧 | 二次进入首帧 |
|---|---|---|---|---|---|---|
| night1 | warehouse-int | 73.1 / 53.6 | **16** | **3,093** | 1173 ms | 290 ms |
| v1-25 | **warehouse-ext（GLB）** | 65.6 / 56.6 | **13** | **4,734** | 660 ms | 135 ms |
| night3 | rooftop | 60.5 / 51.2 | **12** | **2,096** | 1146 ms | 271 ms |
| night5b | bridge | 137.1 / 145.9 | **11** | **2,176** | 1117 ms | 152 ms |
| v0-02 | office-1947 | 82.8 / 96.0 | **15** | **828** | 1154 ms | 162 ms |

预算（`Scene3D.tsx` 文件头）：≤ 25 draw calls / ≤ 6,000 tris —— **五项全部在预算内，最紧的是 warehouse-int 的 16/25**。

同一轮里切片级别的「纯」fps（独立验证页 `proto.html`，没有 2.5D 分层 / 粒子 / 正文卡片）：

| 切片 | calls | tris | fps | 报错 |
|---|---|---|---|---|
| warehouse-int | 16 | 3,093 | 119—224 | 0 |
| warehouse-ext | 13 | 4,734 | 180—238 | 0（`glb=ready`） |
| rooftop | 12 | 2,096 | 85—240 | 0 |
| bridge | 11 | 2,176 | 116—206 | 0 |
| office-1947 | 15 | 828 | 121—141 | 0 |

> 也就是说 App 内比切片裸跑低一截，差额是 2.5D Stage 的三层 `background-image` + Particles + 文字层，不是 3D 本身。

截图（每切片 5 张：正常 / 净画面 / 左看 / 右看 / 二次进入）：
`tools/3d/shots/review/3d-{night1,v1-25,night3,night5b,v0-02}{,-plate,-left,-right,-second-mount}.png`

**GLB 专项（`glb-probe.html` + `inspect-glb.mjs` 实测，非推测）**

| 项 | 实测 | 判定 |
|---|---|---|
| 三角面 / primitive | 4,732 / 11（= 11 draw calls，+地面 1 +尘 1 = 13） | ✅ 与资产报告一致 |
| 材质 / 贴图 | 11 material、3 texture（内嵌 JPEG 共 140,532 B） | ✅ |
| **朝向** | 外皮在 +Z（bbox z −9.00…+1.53），相机在 z=+68 → **正对西墙、不镜像** | ✅ 见 `glb-probe.png` / `3d-v1-25-plate.png`：铁门在下部中央、8 开间 × 4 排窗、女儿墙在顶 |
| **比例** | 修复后 **64.34 × 27.71 × 10.53 m**，scale=1.0（资产本来就是米制） | ✅ 修复前是 22.56 m 高的立面（见「四、F1」） |
| **落地** | `baseY = 0.002`，`centerX = centerZ = 0`；地面 280×280 在 y≈0，模型 z∈[−5.27, +5.27] | ✅ 不悬空、不陷地 |
| **穿插** | 除墙脚与地面相接外，场景内无其它几何与模型相交（外景切片只有地面、尘、灯） | ✅ |
| **baseColor 色彩空间** | `material.map.colorSpace = 'srgb'` | ✅ GLTFLoader 自动设，代码里**没有**二次改（改了会双重转换） |
| **法线贴图色彩空间** | `normalMap.colorSpace = ''`（= `NoColorSpace`） | ✅ 正确；顶点里没有 TANGENT，three 用屏幕导数求切线，法线贴图略柔但正确 |
| **渲染器色彩** | `outputColorSpace = SRGBColorSpace` + `ACESFilmicToneMapping` + `exposure = 1.25` | ✅ |
| **z-fighting** | 墙脚底面与地面共面（0.002 vs 0）时，相机微动 0.02° 的翻转像素 **8,266 / 强 177**；把地面下沉 2 cm 后**完全相同 8,266 / 177** | ✅ **未观察到 z-fighting**（这 2 mm 抬高只是防御，实测零差异） |
| **背面剔除** | 11/11 材质 `DoubleSide`（GLB 导出即双面）；**强制改 FrontSide 会让 4,499 像素变化（437 为强变化）** | ⚠️ 不能盲改。资产报告建议的「改 FrontSide 省一半填充」**在这套几何上不成立**——有面只以背面可见（窗洞内壁 / 门扇背面 / 暗幕） |

**观感层面（非缺陷，未改）**：warehouse-ext 的相机距墙约 66 m、`FogExp2(0.016)` 在该距离的雾权重约 **0.71**，
立面读起来偏灰平（对比 `docs/report/blender-shots/01-west-wall-night.png` 的 Blender 预览）。
这是切片的美术参数（灯 + 雾 + exposure），属于「重做美术」范畴，本轮不动；若以后想更「有石头感」，调 `fog.density` 或加一盏近墙低强度面光即可。

### 4. 资源管理

**反复开关 20 次**（`node tools/3d/review.mjs cycles`，viewport 1280×800）：

| 指标 | 结果 |
|---|---|
| canvas 数（进入 3D 时） | 每次都是 4（基线 3 + 1） |
| canvas 数（退出后） | **每次都是 3 = 基线**，无堆积 |
| `.scene3d` 残留 | **0** |
| 正文 / 存档 | 一直在，未受影响 |
| 首帧（第 2—20 次） | 43—75 ms，无衰减（第 1 次 117—598 ms 是 chunk 冷启动） |
| JS 堆 | 基线 6.0 MB → 20 次后 12.2 MB，但每次循环在 9.6—19.8 MB 之间锯齿（GC 噪声），**无单向增长** |
| 控制台 / 页面错误 | **0** |

**`WEBGL_lose_context`（本轮重点修复）**：

| 阶段 | 实测 |
|---|---|
| `ext.loseContext()` 后 600 ms | `data-gl = 'lost'`、`canvas.style.visibility = 'hidden'`（露父层背景）、`data-fps` 被清空（不留陈旧数字） |
| `ext.restoreContext()` 后 1.6 s | `data-gl = 'restored'`、画布可见、**重新出帧 119 fps** |
| 截图 | `context-lost.png`（暗背景 + 正文可读）、`context-restored.png`（墙回来了） |

**dispose 覆盖清单**（卸载时逐项核对过代码）：

| 资源 | 处理 |
|---|---|
| geometry（程序化 + GLB） | ✅ `makeTrash` 统一 `track` |
| material | ✅ 同上 |
| **texture（程序化 canvas / 远景 / GLB 内嵌）** | ✅ 本轮补齐：`trackObject` 会把 `map/normalMap/roughnessMap/metalnessMap/aoMap/emissiveMap/alphaMap` 一起挂号（原来只挂 material，`material.dispose()` **不释放贴图**） |
| GLTFLoader 结果（卸载后才到的） | ✅ 本轮补齐：`disposeObject(model)` 立刻释放 |
| renderer / GL context | ✅ `gl.dispose()` + `gl.forceContextLoss()` + `canvas.remove()` |
| ResizeObserver / 5 个事件监听 | ✅ 全部 `disconnect` / `removeEventListener`（含新增的 `webglcontextrestored`） |
| `data-*` 诊断属性 | ✅ 卸载时清空（否则下次进入读到陈旧 fps） |
| 动画循环 | ✅ `setAnimationLoop(null)`；`visibilitychange` 隐藏即停、恢复时 `last = 0` 重置 |

**DPR 上限**：`deviceScaleFactor=3` 时 `canvas.width / clientWidth = 2400/1200 = 2.00` ✅（`MAX_DPR = 2`）。
**resize**：1600×1000 → 1000×720，缓冲区同步为 1000×720 ✅。
**缩窗自动退出**：宽度拉到 680 px 后 `.scene3d` = 0、canvas 回 3 ✅（App 的 `resize` 监听）。
**浏览器缩放（Ctrl +/-）**：本轮把 `setPixelRatio` 挪进 `resize()` 每次重新夹一次，修掉「缩放到 150% 后画布仍是 100% 比例、3D 发糊」；
无头环境改不了 `devicePixelRatio`，这条只有代码层证据 + DPR 上限的实测，**未做真实浏览器缩放实测**（列在「七、未修 / 未验证」第 9 条）。

### 5. 性能

| 场景 | 尺寸 | fps | 其它 |
|---|---|---|---|
| 桌面 | 1600×1000@DPR1 | **75.2**（自报 68.3—91.7；空转 rAF 基线 237.7） | 13 calls / 4,734 tris，首帧 719 ms |
| 窄窗 | 900×1000@DPR1 | — | 13 calls；**但正文卡片占 85% 宽度，3D 基本被挡住**（见「七、未修」第 5 条） |
| 手机 | 390×844@DPR3 | **239（纯 2.5D）** | 按设计**不出**「3D 视角」按钮，`canUse3D()` 卡在 `innerWidth < 700` |
| **低端（4× CPU 降频）** | 1600×1000 | **77.3**（自报最低 53.8） | 首帧 **1,240 ms**（chunk 662 + gl 909 的那一轮）；仍可操作、无报错 → **可用** |

**首帧到达时间（点按钮 → 第一帧渲染完成）拆分**（1600×1000，多次取样）：

| 切片 | 总计 | lazy chunk（下载+解析） | WebGL 初始化 + 切片搭建 |
|---|---|---|---|
| warehouse-ext | **660—865 ms** | 305—323 ms | **355—542 ms** |
| warehouse-int | 1,173—1,368 ms | 311—314 ms | **859—1,057 ms** |
| rooftop | 1,146—1,188 ms | 306—310 ms | 840—878 ms |
| bridge | 1,117—1,246 ms | 306—314 ms | 803—940 ms |
| office-1947 | 1,134—1,154 ms | 307—316 ms | 818—847 ms |
| **二次进入（同一切片）** | **135—334 ms** | 0（chunk 已缓存） | 全部 |

> 结论：首帧成本几乎全在「WebGL 初始化 + 程序化切片搭建（canvas 贴图 + 着色器编译）」，**GLB 那 470 KB 不是瓶颈**。
> 需要优化首帧的话，方向是程序化贴图数量与灯光数（着色器变体），不是模型。

### 6. App 交互契约（只读 App.tsx）

- **props 只有 `variant`** ✅：`type Props = { variant: Scene3DVariant }`；App 侧 `App.tsx:1090` 只传 `variant={scene3dSpec.variant}`，挂在 `<Stage scene3d>` 里。无隐藏 props、无回调。
- **`show3d` 生命周期**：`show3d = view3d && Boolean(scene3dSpec)`（`App.tsx:198`），`view3d` 在换场后用
  `useEffect(() => setView3d(false), [sceneId])`（`App.tsx:191-195`）复位。这个 effect 比换场那次 commit **晚一拍**，
  所以换场时会先按新场景挂一次 3D 再卸掉。**实测确认**（MutationObserver，`review-fallback.json → sceneSwitch.mutations`）：

  | 时刻（页面内 ms） | scene | `.scene3d` | canvas |
  |---|---|---|---|
  | 3,683 | v1-25 | 1 | 4 |
  | **5,514** | **night1（已换场）** | **1（多余的一次挂载）** | 4 |
  | 6,201 | night1 | 0 | 3 |

  即换场后有 **687 ms** 里存在一个马上要被扔掉的新 3D 场景（一次新的 WebGL context + 全套切片搭建）。curtain 是黑的所以看不见，
  但代价是实打实的（对应上表 glInit 一栏 800+ ms 量级）。修法见「六、B」。
- **`hasWebGL()` 探测缓存**：本轮读到的 `App.tsx` 工作区版本已经把探测结果缓存到 `webglSupport`（原实现每次 render 都 `createElement('canvas')` + `loseContext()`），
  但**这段改动尚未提交**（`git status`: `M src/App.tsx`）。提醒接手人别回退。
- **`<700px` 自动退出** ✅（`App.tsx:295-302`，实测 680 px 后 3D 卸载）。
- **`prefers-reduced-motion`** ✅ 不出按钮；`Scene3D` 内部也 `reduce` 时不跑 `tick`（只出静态帧）。

---

## 四、修复清单（本轮改动，全部在允许文件内）

| # | 等级 | 文件:行 | 缺陷 | 修法 | 验证 |
|---|---|---|---|---|---|
| **F1** | **高（用户可见）** | `Scene3D.tsx:1088-1100` | 用 `25 / size.y` 归一化。资产 `size.y = 27.71`（含女儿墙 + 楼梯间），于是 **25 m 的立面被缩到 22.56 m（−9.8%）**，与人眼/窗洞比例都对不上 | 资产本来就是米制（1 unit = 1 m），**不再缩放**；只在 `size.y` 明显异常（<12 或 >60 m）时才归一兜底 | `glb-probe`: 立面 64.34 × 27.71 m、`scale=1.0`、`baseY=0.002`；截图 `3d-v1-25-plate.png` |
| **F2** | **高（用户可见）** | `Scene3D.tsx:1984-2029` | `webglcontextlost` 里停掉循环，**没有 `webglcontextrestored`** → 上下文丢失后画布永久黑，只能手动点「回到 2.5D」 | 丢失时 `preventDefault` + 隐藏画布（露父层背景）+ 清 `data-fps`；恢复时重开循环（three 自己重建 GL 资源）；`visibilitychange` 里补 `contextLost` 判断避免把循环开回来 | `cycles` 套件：`lost/hidden` → `restored/119 fps`；`context-lost.png`、`context-restored.png` |
| **F3** | 中 | `Scene3D.tsx:1063-1107` | GLB 加载期间卸载时 `if (!alive) return` —— 回来的 `gltf.scene` 没人释放，每次「点开又切走」留下一整套 geometry/material/贴图在 JS 里 | 新增 `disposeObject(root)`，卸载后到达就立刻释放（对 geometry/material/texture 去重） | `fallback` 的 slow-abort 用例：切走后 5 s 无报错、无残留 |
| **F4** | 中 | `Scene3D.tsx:234-289` | `material.dispose()` **不释放贴图**；原代码只 `track(material)`，3 张内嵌 JPEG 的 GPU 资源要靠 `forceContextLoss` 兜底 | 新增 `trackObject` / `materialTextures`，把 `map/normalMap/…` 与材质一起进垃圾桶 | `cycles` 20 次无报错、canvas/堆无增长 |
| **F5** | 低 | `Scene3D.tsx:35` | 每次进入同一切片都重新拉 GLB（preview 对 `models/*.glb` 回 `Cache-Control: no-cache`，hashed asset 也是 no-cache → 每次一次 304 往返） | `THREE.Cache.enabled = true`（GLB 与远景贴图都走 FileLoader，缓存上限 ≈ 0.5 MB 常驻） | 二次进入：**GLB 请求 0 次**、首帧 135 ms（首次 660 ms） |
| **F6** | 低（诊断） | `Scene3D.tsx:1968-1976` | fps 用**钳到 50 ms 的 dt** 累加：卡顿时会系统性高估。解析例子：30 帧 ×10 ms + 1 帧 ×250 ms（真值 56.4 fps）→ 旧公式报 **88.6（+57%）**；同时 0.5 s 快照与 3 s 外部计数在负载下会打架（本轮实测到外部 87.9 / 自报 66.3） | fps 累加改用未钳的真实墙钟（`Math.min(raw, 5)`），动画仍用钳过的 dt | 改后同一窗口 78.2 vs 75.2、96.0 vs 82.8、145.9 vs 137.1，量级一致 |
| **F7** | 低 | `Scene3D.tsx:1907-1918` | `setPixelRatio` 只在挂载时调一次；浏览器 Ctrl+缩放会改 `devicePixelRatio` 并触发 `resize`，缓冲区却停在旧比例 → 3D 持续发糊 | 在 `resize()` 里每次重新夹一次（值不变则跳过） | DPR3 下 ratio = 2.00；resize 1000×720 同步（真实缩放未实测，见「七、未修」第 9 条） |
| **F8** | 低（可观测性） | `Scene3D.tsx:1871-1881, 1902-1904, 1961` | 3D 到底加载了没、首帧什么时候到，外部无法断言（只能"看着像有"） | 宿主加 `data-mounted` / `data-ready` / `data-glb` / `data-gl`；`buildWarehouseExt` 收一个 `onGlb` 回调写状态 | 本报告所有 GLB/首帧数字都来自这四个属性 |

**测试侧改动**：`tools/test-3d.mjs` 重写（保留原 CLI 兼容 `node tools/test-3d.mjs <url> <id>`），
新增首帧拆分、GLB 网络与缓存（CDP `Network.*`）、二次进入、净画面截图、回退断言（canvas 回基线、`.scene3d` 归零、正文仍在）、JSON 落盘；任一断言失败 `exit 1`。
另外把 `proto.html` 的切片列表补上 `warehouse-ext`（原来只有 4 个，验证页看不到唯一的 GLB 切片）并补 favicon（消掉一条 404 噪声）。

---

## 五、逐条复测结果（交付要求的那五条命令）

```
node tools/test-3d.mjs http://127.0.0.1:4173/ night1   → pass: true
node tools/test-3d.mjs http://127.0.0.1:4173/ v1-25    → pass: true
node tools/test-3d.mjs http://127.0.0.1:4173/ night3   → pass: true
node tools/test-3d.mjs http://127.0.0.1:4173/ night5b  → pass: true
node tools/test-3d.mjs http://127.0.0.1:4173/ v0-02    → pass: true
```

| 命令 | toggle | 首帧 | fps 外部/自报 | calls | tris | GLB | 回 2.5D | 移动端无按钮 | 报错 |
|---|---|---|---|---|---|---|---|---|---|
| night1 | ✅ | 1173 ms | 73.1 / 53.6 | 16 | 3,093 | — | ✅ `.scene3d`=0、canvas 3、正文在 | ✅ | 0 |
| v1-25 | ✅ | 660 ms | 65.6 / 56.6 | 13 | 4,734 | **200 / 480,860 B / ready** | ✅ | ✅ | 0 |
| night3 | ✅ | 1146 ms | 60.5 / 51.2 | 12 | 2,096 | — | ✅ | ✅ | 0 |
| night5b | ✅ | 1117 ms | 137.1 / 145.9 | 11 | 2,176 | — | ✅ | ✅ | 0 |
| v0-02 | ✅ | 1154 ms | 82.8 / 96.0 | 15 | 828 | — | ✅ | ✅ | 0 |

> `night1 / night3 / night5b` 这三个场景在 `SCENE_IMAGES` 里**没有 2.5D 插画**（`back to 2.5D image visible: false`），
> 所以回退后只有分层渐变背景。这不是 3D 缺陷（属 `sceneImages.ts` 内容），但会让「回到 2.5D」看起来更空 —— 记在「七、未修」第 6 条。

**关于 fps 的波动**：上表是「机器相对空闲」那一轮的数。同一套命令在这台机器上共跑了 5 轮，同一分片的外测 fps 波动很大，
例如 office-1947 在 34.7—96.0、bridge 在 55.2—145.9、warehouse-ext 在 53.2—89.7 之间；
波动来源是并发构建任务（本轮观测到 14 个 node 进程），不是切片本身。**回归时请以上表的 draw calls / 三角面 / 首帧拆分 / 断言为准，不要拿单次 fps 当门槛。**

---

## 六、必须改 App 的（本轮只写报告）

### A. 【P0】给 lazy 的 Scene3D 套 ErrorBoundary（否则断网一点 3D 就白屏）

问题位置：`src/App.tsx:26-27`（`const Scene3D = lazy(...)`）与 `src/App.tsx:1087-1093`（`<Suspense>` 包裹处）。
仓库里**没有任何 ErrorBoundary**（`grep -n "ErrorBoundary|componentDidCatch|getDerivedStateFromError"` 只命中 Suspense 自身）。

建议补丁（`App.tsx`）：

```tsx
// 1) 顶部：class 组件做兜底（函数组件没有 error boundary）
import { Component, type ReactNode } from 'react'

class Scene3DBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    // 切片代码本身没拉下来（断网 / 部署丢 chunk / CDN 抖动）：静默退回 2.5D，绝不让整页陪葬
    console.warn('[3D] 切片加载失败，回退 2.5D', error)
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

// 2) 组件内加状态
const [view3dBroken, setView3dBroken] = useState(false)

// 3) 渲染处（替换 App.tsx:1087-1093）
scene3d={
  show3d && scene3dSpec && !view3dBroken ? (
    <Scene3DBoundary onFail={() => { setView3dBroken(true); setView3d(false) }}>
      <Suspense fallback={null}>
        <Scene3D variant={scene3dSpec.variant} />
      </Suspense>
    </Scene3DBoundary>
  ) : null
}

// 4) 按钮条件（App.tsx:503）也加上，避免用户再点一次又崩
{scene3dSpec && !view3dBroken && canUse3D() && ( … )}
```

验收：断网状态下点「3D 视角」→ 控制台一条 `[3D] 切片加载失败` 警告、正文仍在、按钮消失、可以继续读。

### B. 【中】换场时把 `view3d` 和 `state` 一起复位（省掉一次白搭的 3D 初始化）

问题位置：`src/App.tsx:191-195`（`useEffect(() => setView3d(false), [sceneId])`）。
实测换场后有 687 ms 存在一个马上被丢弃的新 3D 场景（本节第 2 条的时间线）。建议在换场的同一个 update 里复位，例如
`advanceScene` 的 swap 回调（`App.tsx:375-394`）里：

```tsx
runCurtain(() => {
  setView3d(false)          // ← 和换场同一批状态更新，不再有"多挂一拍"
  const next = advance(state, nextId, finishing)
  setState(next)
  save(next)
  …
}, finishing ? CURTAIN_ENDING : undefined)
```

`startNew` / `restart` / `toMenu` 同理。之后 `App.tsx:191-195` 的 effect 可以删掉。

---

## 七、未修 / 未验证

| # | 项 | 说明 |
|---|---|---|
| 1 | **P0 白屏** | 见「六、A」。改的是 `App.tsx`，本轮不动。**注意：`node tools/3d/review.mjs fallback` 目前以 exit 1 结束，且只因为这一条**（同套件里 404 / 损坏 / 断网热 / 慢网卸载 / 切场 五个用例全绿）；App 补上 ErrorBoundary 后该套件自动转绿 |
| 2 | **换场多挂一次 3D** | 见「六、B」，同样是 `App.tsx` |
| 3 | `Scene3D` 首帧 0.66—1.37 s | 主要是 WebGL 初始化 + 程序化切片搭建（canvas 贴图 + 着色器编译）。可以做预热或减少 `canvasTexture` 数量，但那是性能工程，不是缺陷，本轮不动 |
| 4 | 3D 打开瞬间 2.5D 立刻淡出 | `.stage-3d .stage-tilt { opacity: 0 }`（`styles.css:1210`，不在允许文件）。GLB 切片首帧先出地面+尘约 0.7—1.3 s，这段舞台近黑（`loading-glb-pending.png`）。若要更稳，可让 2.5D 等 `data-ready` 再淡出（需改 App/CSS） |
| 5 | 700—1000 px 窄窗构图 | 正文卡片占 ~85% 宽度，3D 几乎全被遮住（`perf-900x1000.png`）。属 CSS 布局，不在允许文件 |
| 6 | night1 / night3 / night5b 没有 2.5D 插画 | 退出 3D 后只剩渐变背景（`SCENE_IMAGES` 里没有这三个 id）。属 `sceneImages.ts` 内容，不在允许文件 |
| 7 | GLB 材质双面 | 11/11 `DoubleSide`，实测省不掉（改 FrontSide 变 4,499 px）。当前 13 calls 在预算内，保持现状 |
| 8 | 立面偏灰平 | 66 m 距离 + `FogExp2(0.016)` 雾权重 ≈ 0.71。属美术参数，未改 |
| 9 | 浏览器缩放（Ctrl +/-） | 代码已修（`resize()` 里重夹 DPR），但无头环境改不了 `devicePixelRatio`，**只有代码层证据** |
| 10 | 真机（手机 Safari / 低端 Android） | 本轮 390×844 只验了「不加载 3D」；低端用 4× CPU 降频模拟，没有真机数据 |
| 11 | `addBackdrop` 的 TextureLoader 结果若在卸载后才到 | 会被 `track` 立刻 dispose，但随后又赋给已 dispose 的材质。因为 renderer 同步销毁，**不构成 GPU 泄漏**，属已知无害，未改 |

---

## 八、复现命令

```powershell
cd 'C:\Users\26298\OneDrive\Desktop\全栈开发\frontend\2026数字媒体'

# 1) 构建（preview 服务的 dist 必须是最新）
npx tsc -b; npx vite build

# 2) 五条交付要求
node tools/test-3d.mjs http://127.0.0.1:4173/ night1
node tools/test-3d.mjs http://127.0.0.1:4173/ v1-25
node tools/test-3d.mjs http://127.0.0.1:4173/ night3
node tools/test-3d.mjs http://127.0.0.1:4173/ night5b
node tools/test-3d.mjs http://127.0.0.1:4173/ v0-02

# 3) 四个专项套件（每个都会落 JSON + 截图，失败 exit 1）
node tools/3d/review.mjs fallback    # 404 / 损坏 / 断网冷热 / 慢网卸载 / 切场
node tools/3d/review.mjs cycles      # 20 次开关 + WEBGL_lose_context
node tools/3d/review.mjs perf        # 1600/900/390 + 4× CPU + DPR + resize
node tools/3d/review.mjs deploy      # dev / preview / 子目录（临时目录重建中文子目录站）

# 4) 资产与切片体检
node tools/3d/inspect-glb.mjs                                   # 只读 GLB 二进制
npx vite --port 5199 --strictPort --host 127.0.0.1              # 体检页/验证页要用 dev server
node tools/3d/glb-probe.mjs http://127.0.0.1:5199               # colorSpace / side / 落地 / z-fighting
node tools/3d/proto-shot.mjs http://127.0.0.1:5199              # 五切片裸跑截图
node tools/3d/gpu-info.mjs http://127.0.0.1:4173/               # 确认是不是真 GPU
```

---

## 九、证据索引

### 截图（`tools/3d/shots/review/`）

| 文件 | 内容 |
|---|---|
| `3d-night1.png` / `-plate` / `-left` / `-right` / `-second-mount` | warehouse-int（内景：柱、沙袋、煤油灯、西墙破洞亮光） |
| `3d-v1-25.png` / `-plate` / `-left` / `-right` / `-second-mount` | **warehouse-ext（GLB）**：完整立面、铁门、8 开间 × 4 排窗、女儿墙 |
| `3d-night3.png` / `-plate` / … | rooftop（旗杆 + 红旗下摆、沙袋女儿墙、城市剪影、探照灯） |
| `3d-night5b.png` / `-plate` / … | bridge（灯柱、栏杆、河面反光、雾中楼群） |
| `3d-v0-02.png` / `-plate` / … | office-1947（木桌、毛边纸、砚台、雪窗、吊灯） |
| `fallback-404.png` / `fallback-corrupt.png` | 失败回退：只剩灯光地面 + 正文，无报错界面 |
| `fallback-offline.png` | **P0 白屏**（断网冷启动点 3D） |
| `fallback-offline-warm.png` | 已缓存断网：GLB 仍 ready、正常出帧 |
| `loading-glb-pending.png` | 慢网加载中的画面（不空白） |
| `fallback-slow-abort.png` / `switch-scene.png` | 加载中切走 / 3D 开着换场 |
| `context-lost.png` / `context-restored.png` | 上下文丢失 / 恢复 |
| `perf-1600x1000.png` / `perf-900x1000.png` / `perf-390x844.png` / `perf-cpu4x.png` | 各视口 |
| `deploy-subdir.png` | **子目录部署下 3D 正常（GLB 不 404）** |
| `glb-probe.png` | GLB 裸装（同机位/同灯光）成片 |
| `proto-{warehouse-int,warehouse-ext,rooftop,bridge,office-1947}.png` | 独立验证页五切片 |

### 数据（JSON）

| 文件 | 内容 |
|---|---|
| `3d-{night1,v1-25,night3,night5b,v0-02}.json` | 五条交付命令的完整指标（首帧拆分、GLB 网络/缓存、二次进入、回退断言） |
| `review-fallback.json` | 404 / 损坏 / 断网冷热 / 慢网 / 切场（含 MutationObserver 时间线） |
| `review-cycles.json` | 20 次开关逐轮数据 + 上下文丢失/恢复 |
| `review-perf.json` | 视口 / CPU 降频 / DPR / resize / 缩窗 |
| `review-deploy.json` | dist 复制 + dev/preview/子目录 三种形态 |
| `glb-probe.json` | 材质 side、贴图 colorSpace、落地包围盒、z-fighting 与 FrontSide 像素对比 |

---

## 十、一句话交接

**子目录部署的 GLB 已经确认不 404（中文目录 + URL 编码实测 200 / 480,860 B / `data-glb=ready`），并且写成了可重跑的 `review.mjs deploy` 断言；
3D 这条链路剩下的唯一高优事项是给 App 的 `lazy(Scene3D)` 套一层 ErrorBoundary —— 现在断网时点一下「3D 视角」，整页会白掉。**

---

## 十、Lead 处置（2026-10-22 22:4x）

报告「六、A/B」两项 App 侧问题已随 v1.4 修复：

1. **P0 白屏**：新增 Scene3DBoundary（class ErrorBoundary，getDerivedStateFromError + componentDidCatch → 回退 2.5D 并清空 3D 状态）。回归脚本 tools/test-3d-chunk-fail.mjs 实测：拦截 Scene3D-*.js 后点「3D 视角」→ 正文仍在（1,285 字）、自动回 2.5D、页面不崩。
2. **换场多挂一次 3D**：view3d 布尔改为 view3dScene（记住场景 id），换场后 show3d 自然为 false，删掉晚一拍的 effect；3D 入口/卸载由 show3d 单点派生。

追加回归：五切片 test-3d 全 pass；GLB 子目录 200；404 回退 0 报错；反复开关 canvas 回基线（baseline 3 → after 3）；二次进入 GLB 请求 0 次。
