# 四行仓库西墙 hero 资产（Blender 4.2.3 无头 bpy）

> 产出：`public/models/warehouse-ext.glb` — 单文件、内嵌贴图、米制、Y-up，**4,732 三角面 / 469.6 KB**。
> 生成脚本：`tools/blender/build_warehouse.py`（参数化、可重复运行，seed=1937）。
> 预览：`docs/report/blender-shots/01-west-wall-night.png`、`02-damage-detail.png`（1024×576，Cycles **CPU**）。
> 配套 3D 决策见 [`2026-10-22-3d-slices.md`](2026-10-22-3d-slices.md)；色板来自 [`../art/visual-bible.md`](../art/visual-bible.md)。

---

## 一、产出清单

| 文件 | 内容 | 大小 |
|---|---|---|
| `tools/blender/build_warehouse.py` | 生成脚本（bpy 无头，1,168 行，含程序化贴图） | 61 KB |
| `public/models/warehouse-ext.glb` | **交付资产**：1 mesh / 11 primitive / 3 内嵌 JPEG | 469.6 KB |
| `docs/report/blender-shots/01-west-wall-night.png` | 预览①：全立面（64 m）夜景 | 549 KB |
| `docs/report/blender-shots/02-damage-detail.png` | 预览②：人眼高度仰视，条石 + 破洞 + 窗洞 | 690 KB |
| `docs/report/blender-shots/warehouse-ext-stats.json` | 机器可读实测数据（三角面/分项/材质/贴图/耗时/机位） | 5.3 KB |
| `tools/blender/tex/granite_base.png` 等 3 张 | 中间贴图（每次运行重生成；GLB 内是它们的 JPEG 版） | 1.6 MB |

> `tools/blender/tex/` 是**可再生产物**，不进 GLB（GLB 内嵌 JPEG，137 KB）。若要瘦身仓库可直接删，重跑脚本即重建。

---

## 二、复现命令

```powershell
$B = 'D:\AI大模型\blender\blender-4.2.3-windows-x64\blender.exe'
cd 'C:\Users\26298\OneDrive\Desktop\全栈开发\frontend\2026数字媒体'

# 出资产 + 两张预览（默认 seed=1937, damage=0.6, 64 spp）
& $B -b --factory-startup -P tools/blender/build_warehouse.py -- --render

# 只出资产，不渲染（约 9 s）
& $B -b --factory-startup -P tools/blender/build_warehouse.py -- --no-render

# 换一套破损（不同 seed / 破损程度）
& $B -b --factory-startup -P tools/blender/build_warehouse.py -- --render --seed 2025 --damage 0.9

# 快速迭代（半分辨率、8 spp、半分辨率贴图；约 5 s）
& $B -b --factory-startup -P tools/blender/build_warehouse.py -- --render --quick
```

实测：**默认参数全流程 30—36 s**（贴图 4—9 s + 几何 0.1 s + 导出 0.5—0.9 s + 渲染 25—27 s；同一台机器随负载波动），脚本自身零外部依赖（只用 Blender 自带 numpy 1.24.3 + zlib）。
可重复性：同 `--seed` 连跑多次，GLB **SHA-256 完全相同**（`67CC23A6…C05778`），即字节级可复现。

### 主要参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--seed` | 1937 | 一切随机量的种子（封窗分布、弹着点、女儿墙残缺、碎石） |
| `--damage` | 0.6 | 破损程度 0—1：影响封砖比例、女儿墙被削低的概率与段数、碎石数量 |
| `--width / --height / --depth` | 64 / 25 / 0.9 | 立面尺寸（米）。改 width 会按 `--bays` 重排开间 |
| `--floors / --bays` | 5 / 8 | 层数 / 开间数 |
| `--win-w / --win-h / --win-sill / --win-head` | 2.6 / 3.0 / 1.35 / 4.35 | 窗洞尺寸与相对楼面位置 |
| `--gate-w / --gate-h` | 4.6 / 4.3 | 铁门洞尺寸 |
| `--parapet-h` | 1.35 | 女儿墙高 |
| `--bullet-holes / --shell-holes` | 430 / 8 | 枪弹孔 / 炮弹孔数量（默认取历史口径） |
| `--breach-x / -z / --breach-hw / -hh` | -24 / 12.5 / 1.55 / 1.75 | 打穿破洞的位置与半尺寸 |
| `--blocks-per-row` | 6 | 每 8 m 几块条石（6 → 1.33 m 长） |
| `--samples / --res-x / --res-y` | 64 / 1024 / 576 | 预览渲染参数 |
| `--exposure` | -0.60 | AgX 曝光（补偿面光亮度） |
| `--out-glb / --shots-dir / --tex-dir` | 见下 | 输出路径（相对项目根） |
| `--save-blend` | 关 | 另存 `tools/blender/warehouse-ext.blend` 便于手工精修 |

---

## 三、实测数据

| 指标 | 实测 | 预算/目标 |
|---|---|---|
| **三角面** | **4,732**（glTF 内按 accessor 复核 = 4,732，一致） | 3,000—8,000 ✅ |
| **GLB 大小** | **469.6 KB**（480,860 B），其中 3 张内嵌 JPEG 共 137 KB | 单文件 ✅ |
| draw calls（= glTF primitive 数） | **11** | ≤ 25 ✅ |
| 材质 | 11（花岗岩/砖为贴图 PBR，其余纯色） | — |
| 节点 | 1 个 mesh node（已 join），无相机、无灯、无 KHR 扩展 | — |
| 包围盒（glTF 空间） | X −32.17…32.17 / Y −0.09…27.62 / Z −9.00…1.53 | 立面 64.3 × 25 ✅ |
| 渲染 | ① 10.9—13.1 s ② 13.4—13.9 s（1024×576，64 spp，Cycles **CPU**，OIDN 降噪） | — |
| 全流程 | 29.8—35.5 s（随机器负载波动） | — |
| 贴图 | granite 1024×640 base + 1024×640 normal，brick 512×512 | 128 texel/m |

### 几何分解（脚本实测输出，非估算）

| 部件（Builder） | 三角面 | 说明 |
|---|---|---|
| `damage` | **2,042** | 430 枪弹孔（各 2 片 = 4 tris）1,720 + 8 炮弹孔贴片 176 + 打穿破洞 ~146 |
| `windows` | **1,008** | 32 窗洞内凹四壁 256 + 20 扇敞开的暗底 40 + 20×4 根钢窗棂 960 + 12 扇封砖 24 |
| `wall` | **628** | 立面网格（含 32 窗洞 + 破洞的挖空）、左右返、顶、底、内皮、暗幕 |
| `sandbags` | **456** | 沙袋 20（12 tris/个）+ 碎石 18（12 tris/块） |
| `parapet` | **288** | 7 段女儿墙 + 压顶 + 山墙返 + 屋面板 + 楼梯间/排风井/2 烟囱/2 落水管 |
| `courses` | **156** | 4 条层间腰线 + 檐口 + 台基（6 个石带）+ 7 根壁柱 |
| `gate_leaves` | **144** | 双扇铁门（左关右开 55°）+ 3 道铁箍/扇 + 花岗岩门套 + 门槛石 |
| `gate` | **10** | 门洞四壁 + 门后暗幕 |
| **合计** | **4,732** | 与 glTF 内复核数一致 |

---

## 四、为什么用 Cycles CPU（EEVEE / Workbench 的实测记录）

任务原本要求"用 EEVEE 或 Workbench，CPU 渲染，别用 GPU"。实测结论是**这两个引擎都不是 CPU 渲染**：

| 引擎 | `-b` 无头能否出图 | 实测（160×90 测试立方体） | 是否占显存 |
|---|---|---|---|
| `BLENDER_EEVEE_NEXT` | 能 | 1.34 s | **占**——光栅化引擎，要建 OpenGL/Vulkan 上下文 |
| `BLENDER_WORKBENCH` | 能 | 0.04 s | **占**——同上 |
| `CYCLES`（`device=CPU`） | 能 | 0.25 s（8 spp） | **0**——纯 CPU 路径 |

- `gpu.platform.renderer_get()` 在 `-b` 下直接抛 `SystemError: GPU functions for drawing are not available in background mode`，说明后台模式的 GL 上下文是"能出图但不能当 API 用"的隐藏上下文。
- 既然真约束是"**别占显存**"（GPU 需让给音频任务、且不允许同时跑两个 GPU 任务），选 **Cycles，`scene.cycles.device='CPU'`，`denoising_use_gpu=False`**。这是唯一 0 显存路径，也仍然满足"1024×576、不碰 GPU 渲染"。
- 代价是慢：64 spp + OIDN 降噪，1024×576 每张 11—14 s（32 线程）。两张约 25 s，可接受。

以后若要更快：`--samples 32` 约 6—8 s/张，噪点差异在夜景下基本看不出。

---

## 五、资产内容（对应 night1 / night3 的空间描述）

`src/game/content/chapter1.ts` 写的是"宽六十四米，深五十四米，高二十五米……花岗岩条石"。本资产只做**西墙外观**（另一侧与内景另属切片），所以：

| night1 / night3 原文 | 本资产对应 |
|---|---|
| 宽 64 m、高 25 m、五层 | 立面 64.0 × 25.0 m（+ 女儿墙 1.35 m），5 层、层高 5 m，层间腰线正好压在真实楼层线上 |
| 花岗岩条石 | 程序化条石：1.33 m × 0.5 m 错缝，**水平缝明显、竖缝弱**（两者一样重就立刻读成"砖墙"）；含雨痕、墙脚湿痕、大尺度污渍、法线浮雕 |
| 西墙弹孔 / "啃出一个个白坑" | 8 个炮弹孔（历史口径）+ 430 个枪弹孔（历史口径）= 四行仓库西墙实测的 8 + 430 |
| 铁门只开一半 | 4.6 × 4.3 m 双扇铁门，左扇关、右扇绕右铰链内开 55°；门内 0.62 m 处有暗幕 |
| 西墙被打穿一个洞（night3b） | 3.1 × 3.5 m **真挖空**：立面网格在此处整块缺面，填锯齿崩边环 + 内凹暗壁 + 4 根露出的钢筋 |
| 沙袋堆到窗台下沿 | 门两侧 2 垛 × 2 层 × 5 包沙袋 + 墙脚 18 块碎石（`--damage` 控制数量） |
| 楼顶 / 女儿墙（night3） | 7 段女儿墙（按 `--damage` 随机削低）、压顶石、山墙返 9 m、屋面 8.7 m 深、楼梯间/排风井/2 座砖烟囱/2 根铸铁落水管 |

玻璃/窗：**20 扇敞开**（内凹 0.55 m，带 1930s 钢窗棂 2 竖 2 横）+ **12 扇封砖**（战时封窗御弹，砖面内凹 10 cm，纹理含 3.5% 掉砖）。封砖比例随 `--damage` 上升。

---

## 六、色板（对齐 visual-bible）

严格从 `docs/art/visual-bible.md` §1 的五色派生，**没有引入红、没有青蓝、没有纯黑纯白**：

| 用途 | Hex | 来源 |
|---|---|---|
| 条石主色 | `#666055` | 烟黑→纸白之间的暖灰（bible：冷色只能经雾/水灰进入，色相居中） |
| 台基 / 窗台亮面 | `#948A79` | 同上提亮 |
| 破口白茬 | `#6F6858` | 只比主色亮一档（曾用 `#9C907C`，渲染出来是白块，已回退） |
| 条石暗面 / 洞内壁 | `#3E382F` | 烟黑 `#16130F` 提亮 |
| 弹着点浅茬 | `#736B5E` | 同上 |
| 封窗砖 | `#55453C` / 灰缝 `#6E675B` | 铁锈 `#7A3E2E` 降饱和降明度 |
| 门洞/窗洞内部 | `#0C0A08` | 比烟黑更暗，但不是纯黑 |
| 铁门 / 落水管 / 窗棂 | `#3B352F` | 烟黑提亮，metallic 0.35 |
| 沙袋布 | `#8C7C60` | 沙金 `#C8A063` 降饱和 |

灯光（仅预览，**不进 GLB**）：一盏画外左前上方的大面光（暖 `#F6DFC2`，有距离衰减→立面自然明暗过渡）+ 极弱中性暖灰补光（`#A9A398`，0.25）+ 门缝里一点煤油灯（`#FFB25E`，1200 W）＝ bible 的"单主光 + 夜里的一个暖点"。**刻意没用太阳**：等强平行光会把 64 m 立面拍平，看不出条石。

---

## 七、three.js 加载建议

### 坐标系（已实测，非推测）

glTF 是 Y-up，Blender 的 Z-up 已由导出器转换（node 无旋转，`transform` 为 identity）：

```
X: -32.17 … +32.17   宽 64.3 m（墙 64.0 + 女儿墙山墙返各外扩 0.17）
Y:  -0.09 … +27.62   高（墙 0→25，女儿墙+压顶到 ≈26.6，屋顶楼梯间顶板到 27.62）
Z:  -9.00 … +1.53    立面外皮在 z ≈ 0，朝 +Z；屋面往 -Z 深 8.7 m，门扇内开到 +1.53
```

→ **`scene.add(gltf.scene)` 后，把相机放在 +Z 一侧（如 `z = +45`）就是正对西墙**。若你的场景约定立面朝 −Z，`gltf.scene.rotation.y = Math.PI` 即可（X 对称，翻转无副作用）。

### 集成要点

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltf = await new GLTFLoader().loadAsync('/models/warehouse-ext.glb');
const wall = gltf.scene;                      // 单 node，11 个 primitive = 11 draw calls
wall.traverse((o) => {
  if (!o.isMesh) return;
  o.frustumCulled = true;                     // 64 m 单体，别关剔除
  const m = o.material as THREE.MeshStandardMaterial;
  m.side = THREE.FrontSide;                   // GLB 是 doubleSided；立面只朝外，FrontSide 省一半填充
  m.envMapIntensity = 0.25;                   // 别给夜景打环境光，会把烟黑抬起来
  if (m.map) m.map.anisotropy = 4;            // 贴图是 128 texel/m 的斜视杀手，各向异性收益明显
});
scene.add(wall);
```

- **材质**：标准 metallic-roughness，`baseColorTexture` 是 sRGB、`normalTexture` 是 Non-Color（GLTFLoader 自动设置，不要再手动改 `colorSpace`，改了会双重转换）。
- **灯光**：按 bible 只要一盏暖色主光（DirectionalLight 或面光近似）+ 极低 ambient（`0x16130F`）。**不要加半球光/白环境光**——那会把立面洗成灰盒子。
- **雾**：`scene.fog = new THREE.Fog(0x16130F, 40, 160)`，正好把 64 m 立面的远端吃掉，同时**掩盖 8 m 贴图重复**。
- **两个 draw call 优化选项**：① 11 ≤ 25 预算，可直接用；② 若要压到更少，把 11 个材质里 4 个纯深色材质（concrete/interior_void/granite_dark/rebar）合并成 1 个 `#1A1713` 级别的色值 → 8 个 primitive，肉眼几乎无差。
- **尺寸即真实尺寸**：1 unit = 1 m，直接把相机放在 `z = 45`、`y = 8`、`lookAt(0, 12, 0)` 就是预览①的构图（预览用 38 mm 等效，three.js 里 `PerspectiveCamera(50, ...)` 差不多）。
- **卸载**：`gltf.scene.traverse` 里 `geometry.dispose()`、`material.map/normalMap.dispose()`、`material.dispose()`；纹理是内嵌的，随 material 一起释放。
- **不要**下 Draco/KTX2：现在 469 KB、无 KHR 扩展，加解码器反而增加 lazy chunk 和失败面。

### 与现有程序化切片的衔接

`2026-10-22-3d-slices.md` 里 `warehouse-int` 是程序化几何（1,757 tris / 14 draw calls）。本资产是**外景**，两者不冲突：

- 保留 `warehouse-int` 做内景（night1 点名在底楼）；
- 新增一个 `warehouse-ext` 外景用法：night3b（西墙破洞）、night5 结尾"仓库外面"的远景，或作为 night1 内景窗外对位；
- 若要把外景当内景的"窗外背景"，注意本资产的 y=0 是墙外皮，窗洞背面在 y=0.55——内景模型要放在墙内侧（glTF z < 0 一侧）。

---

## 八、没做到 / 已知取舍

按"这个细节在最终尺寸下看得见吗"逐条记账：

1. **430 个枪弹孔在全景预览里是亚像素**。64 m 宽 / 1024 px = 12 px/m，6 cm 的孔 ≈ 0.7 px，所以在预览①里只呈现为一片噪点斑。近距离（相机 8 m 内）才逐孔可辨——这是物理正确、但"远看不显"。**没做的处理**：没有做"远距离用贴图/顶点色放大弹痕"的 LOD 变体。
2. **8 个炮弹孔是贴片不是凹坑**。做成浅碗两层（崩边浅茬 + 暗心）贴在墙面上，因为立面是一整张平面，凹进去的部分会被自己挡住；而 1.5 m 的坑在游戏视距下只有约 18 px，两层贴片与真几何不可区分。代价：贴到墙根勉强能看到它们是"平的"。
3. **破洞是真挖空的矩形 + 锯齿内凹环，不是任意形状贯穿**。矩形边界与立面网格共享边，所以接缝干净；但洞的实际形状受限于 `breach_hw/hh` 那个矩形，且内凹只到 0.52 m（后面是墙内皮暗幕）。相机若钻进洞里会看见 0.52 m 处的假底。
4. **贴图平铺 8 m × 5 m，在 64 m 立面上重复 8 次**。已做无缝（块号与像素 hash 全部取模，接缝不再有条状色阶），但"大尺度污渍"仍每 8 m 重复一次。**没做** 64 m 级别的唯一大贴图或顶点色大尺度调色（会让 GLB 从 470 KB 涨到数 MB，且现有程序化切片也没有，风格一致性更差）。
5. **窗棂是 4 根方条**，不是真实钢窗断面。近看像"断掉的窗框"，中远距离读作 1930s 工业窗。破损窗没有做玻璃碎片。
6. **立面开间与窗型是按 1930s 工业仓库重构的，不是测绘复原**。真实四行仓库西山墙的窗洞实际数量、位置、尺寸未逐格核对过；只有 8 + 430 这组弹孔数是查了报道口径（[文汇](https://wenhui.whb.cn/third/zaker/202008/27/368010.html)、[上观](https://www.shobserver.cn/staticsg/res/html/web/newsDetail.html?id=1127924)）。这条是**最该补的**：拿到可靠立面照片/尺寸后，改 `--bays/--win-*` 或直接改 `window_rects()`。
7. **没有内景、没有屋顶旗杆**。旗杆/旗面顶点动画属 `rooftop` 切片；本资产屋顶只有构筑物剪影。
8. **没有 LOD、没有 Draco/KTX2、没有 UV 展开**。UV 用世界坐标投影（法线主轴决定投哪两个轴），对木箱/沙袋这种有机体会有拉伸——但它们是纯色材质，无影响；花岗岩/砖的平面投影正是需要的。
9. **预览没加雾/体积光**。Cycles 体积雾会显著拖长渲染，且 GLB 里也不含雾；雾留给 three.js 的 `scene.fog` 做（更省、可调）。
10. **地面/相机/灯都不进 GLB**（导出时 `use_selection=True` 只选资产，地面板单独留在场景里给预览挡背景）。

---

## 九、校验记录

| 项 | 结果 |
|---|---|
| glTF 内三角面（按 primitive 的 index 数 /3 统计） | **4,732**，与 Blender 内计数 **完全一致** |
| GLB 重新导入 Blender | 通过：1 mesh / 4,732 tris / 3 张 packed 贴图 / `granite_normal` 为 Non-Color / normalMap 节点存在 |
| 重新导入后中性布光复渲染 | 通过（外观与源场景一致，见下"往返验证"说明） |
| GLB 结构 | `generator: Khronos glTF Blender I/O v4.2.70`，`extensionsUsed: []`，无 cameras / 无 KHR_lights_punctual |
| 尺寸 | 立面 64.34 × 25.0 m（墙厚 0.9），最高点 27.62（女儿墙 ≈26.6，屋顶楼梯间顶板 27.62） |
| 可重复性 | 同 `--seed` 连跑两次，GLB **SHA-256 完全一致**（`67CC23A67ABE4F1F1FD2121E48DF82071AE101214C3E1BD8503B273841C05778`） |

> 往返验证：把 `warehouse-ext.glb` 导入空场景、中性灰世界光 + 一盏太阳、35 mm，仍得到同一立面（破洞/封窗/女儿墙/铁门位置全对），确认 UV、法线、材质槽、双面标记都正常导出。

---

## 十、一句话总结

**64 m × 25 m 的五层花岗岩条石西墙，4,732 三角面 / 469.6 KB，单文件 11 draw calls，8 炮弹孔 + 430 枪弹孔 + 一处打穿的真破洞 + 半开铁门 + 被削低的女儿墙；Cycles CPU 30—36 s 全流程重建（字节级可复现），两张 1024×576 预览。** 缺的是"真实立面测绘核对"和"远距离弹痕 LOD"，补这两条需要外部资料，不需要更多算力。
