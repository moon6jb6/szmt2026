import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本轮收尾：把 v1.3 的改动（Blender 资产、审计结论、字数/体积）写进所有文档。 */
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const edits = []
const add = (file, from, to) => edits.push({ file, from, to })

// ---------- README ----------
add('README.md', '四个 three.js 切片，按需加载，失败自动回退 2.5D', '五个真 3D 场景（含 Blender 导出的仓库西墙 GLB），按需加载，失败自动回退 2.5D')
add('README.md', '113,138 字正文', '113,161 字正文')

// ---------- 3D 报告 ----------
const d3 = 'docs/report/2026-10-22-3d-slices.md'
add(d3, '## 一、四个切片', '## 一、五个切片（4 个程序化 + 1 个 Blender GLB）')
add(d3, '| office-1947 | v0-02 / v0-03 / epilogue | 木桌、砚台、毛边纸、窗棂、吊灯、雪窗冷光 |', '| warehouse-ext | v1-24 / v1-25 | **Blender 4.2.3 导出的四行仓库西墙**：4,732 三角面 / 469.6 KB GLB；真挖穿炮弹洞、窗洞（含封砖）、沙袋、铁门、430 个枪弹孔 |\n| office-1947 | v0-02 / v0-03 / epilogue | 木桌、砚台、毛边纸、窗棂、吊灯、雪窗冷光 |')
add(d3, '| warehouse-int | 133.1 | 14 | 1,757 | 25 / 6,000 |\n| rooftop | 136.6 | 12 | 1,302 | 25 / 6,000 |\n| bridge | 135.9 | 11 | 2,470 | 25 / 6,000 |\n| office-1947 | 136.3 | 14 | 714 | 25 / 6,000 |', '| warehouse-int | 101.4 | 16 | 3,093 | 25 / 6,000 |\n| warehouse-ext | 147.6 | 13 | 4,734 | 25 / 6,000 |\n| rooftop | 120.3 | 12 | 2,096 | 25 / 6,000 |\n| bridge | 105.0 | 11 | 2,176 | 25 / 6,000 |\n| office-1947 | 114.6 | 15 | 828 | 25 / 6,000 |')
add(d3, '集成后（App 内实测，含 2.5D 淡出与文字卡片）：**96.4 fps / 17 draw calls / 2,087 tris**，无控制台错误。', '集成后（App 内实测，含 2.5D 淡出与文字卡片）：**81—148 fps / 13—16 draw calls / 3,093—4,734 tris**，无控制台错误（数字随机器负载波动，取多轮区间）。')
add(d3, '- 测试：`tools/test-3d.mjs`', '- Blender 资产：`tools/blender/build_warehouse.py`（1,168 行，参数化）、public/models/warehouse-ext.glb、`docs/report/2026-10-22-blender-asset.md`\n- 测试：`tools/test-3d.mjs <url> <sceneId>`（已支持分切片截图）')
add(d3, '- 程序化几何而非 Blender 模型：可复现、无二进制资产、体积极小；视觉是低多边形写实向，够支撑"纵深/光照/雾"的增强。', '- 程序化几何做 4 个切片（可复现、无二进制资产）；西墙外观用 Blender 无头建模导出 GLB（4,732 tris / 469.6 KB），按需加载，补上"建筑体量"的真 3D 资产。')

// ---------- 审计补充说明 ----------
const addm = 'docs/audit/2026-10-22-post-audit-addendum.md'
add(addm, '| 合成结局 档案 / 遗物 / 口耳 | 约 3,118 字（3 个单元） | 只用已核卡：s-49 / auto-a-06 / auto-d-06 / auto-d-07 / auto-c-05 / auto-c-02 / auto-c-06 / s-flag-raise / s-tongcheng | **否**，仅 Lead 自查（详见 `2026-10-21-ending-expansion-note.md`） |', '| 合成结局 档案 / 遗物 / 口耳 | 约 3,141 字（3 个单元） | 只用已核卡：s-49 / auto-a-06 / auto-d-06 / auto-d-07 / auto-c-05 / auto-c-02 / auto-c-06 / s-flag-raise / s-tongcheng | **是**：2026-10-22 补独立审计，史实 P0=0 / 文学均分 4.35（见 `2026-10-22-composite-fact.md` / `-literary.md`） |')
add(addm, '**结论**：交付文档中所有「9 结局 / 113,138 字」数字为当前真实值；「史实 P0=0、文学 4.59」的签字仅覆盖 6 主结局，新增 3 篇为自查。两者在 AI 使用说明与本文中均已如实披露。', '## 五、2026-10-22 补审结果（更新）\n\n- 3 个合成结局已补一轮独立双轨审计：史实 **P0 4 → 0**（周福其口述年份、名册互见人数、家书/照片原件入库三处与主结局冲突全部改写）、文学 **3.99 → 4.35**（最低单项 4.2，不合格 0），报告见 `2026-10-22-composite-fact.md` / `2026-10-22-composite-literary.md`。\n- 由此全库严格字数 **113,161**（+23，全部来自三篇改写）；六主结局零改动。\n- 继承性 P0-C（chapter1.ts 尾声把唯一印片放进 1947 年册子，与 C2 冲突）已在 v1.3 修复：改为「一张画着两个圈的纸」，commit 文本同步。\n- `FINAL-fact` C7 所称「正文末有叙事重构标注」实际只在文件注释里——保留原审计签字不改，以本文说明为准。\n\n**结论**：交付文档中「9 结局 / 113,161 字」为当前真实值；「史实 P0=0、文学 4.59」的签字覆盖 6 主结局，新增 3 篇另有一轮独立审计（P0=0 / 4.35）。两者在 AI 使用说明与本文中均已如实披露。')

// ---------- AI 使用说明 ----------
const ai = 'docs/deliverables/AI使用说明.md'
add(ai, '| Stable Audio Open Small（497M） | 文生音频 | 28 条环境音/动作音/结局低音 | 本地部署（RTX 5070 Laptop 8GB） |', '| Stable Audio Open Small（497M） | 文生音频 | 28 条环境音/动作音/结局低音 | 本地部署（RTX 5070 Laptop 8GB） |\n| Blender 4.2.3（无头 bpy） | 3D 建模 | 四行仓库西墙 GLB（4,732 tris / 469.6 KB） | 本地离线（CPU，0 显存） |')
add(ai, '**补充说明（如实披露）**：六个主结局经过完整双轨审计；之后新增的三个合成结局（档案 / 遗物 / 口耳，约 3,100 字）与点击/结局画面交互代码，是在审计冻结后新增的，只做了人工自查（真实人物零台词、无伤亡数字、第三人称、事实只用已核卡），没有独立审计员的第二轮评分。详见 `docs/audit/2026-10-21-ending-expansion-note.md`。', '**补充说明（如实披露）**：六个主结局经过完整双轨审计；之后新增的三个合成结局（档案 / 遗物 / 口耳，约 3,141 字）已于 2026-10-22 补做独立双轨审计：史实 P0=0（修前 4）、文学均分 4.35（修前 3.99），报告见 `docs/audit/2026-10-22-composite-fact.md` 与 `-literary.md`。点击/结局画面交互、5 个真 3D 场景与 28 条音效不承担史实表述，做人工验收与性能测试。')

// ---------- 作品介绍 ----------
const intro = 'docs/deliverables/作品介绍.md'
add(intro, '113,138', '113,161')
add(intro, '| 真 3D 切片 | three.js（lazy chunk）程序化几何：四行仓库底楼 / 楼顶 / 桥 / 1947 厢房；指针受限视角；失败回退 2.5D |', '| 真 3D 场景 | five 个：四行仓库西墙（Blender 4.2.3 无头建模的 469.6 KB GLB）/ 底楼 / 楼顶 / 桥 / 1947 厢房；three.js 按需加载；指针受限视角；失败回退 2.5D |')
add(intro, '四行仓库底楼、楼顶、苏州河桥、1947 造册厢房各有一个 three.js 程序化 3D 场景', '四行仓库西墙、底楼、楼顶、苏州河桥、1947 造册厢房共有五个真 3D 场景（西墙是 Blender 建模导出的 4,732 三角面 GLB，其余为 three.js 程序化几何）')
add(intro, 'JS 主包 844.87 kB（gzip 299.81 kB', 'JS 主包 845.59 kB（gzip 298.0 kB')
add(intro, '3D 切片懒加载 151.76 kB gzip', '3D 懒加载 gzip 166.7 kB')

// ---------- 测试记录 ----------
const test = 'docs/deliverables/测试记录.md'
add(test, '113,138', '113,161')
add(test, '| JS 主包（含 11.3 万字正文、9 个结局、76 张史料卡与交互组件） | 844.87 kB | 299.81 kB |', '| JS 主包（含 11.3 万字正文、9 个结局、76 张史料卡与交互组件） | 845.59 kB | 298.0 kB |')
add(test, '| dist 总计（含 496 张场景插画与 8 张背景图） | 544 个文件 / 22.93 MB | — |', '| 3D 懒加载（three.js + Blender GLB） | 668.7 kB | 166.7 kB |\n| dist 总计（含 496 张插画、8 张背景、28 条音效与 GLB） | 545 个文件 / 23.46 MB | — |')
add(test, "3D metrics: { fps: '87.3', calls: '16', tris: '3093' }", "3D metrics: { fps: '81.3—120.1', calls: '16', tris: '3093' }（night1）；warehouse-ext（v1-25）147.6fps / 13 calls / 4,734 tris")
add(test, 'node tools/test-3d.mjs <url>               3D 87.3fps / 16 calls / 3,093 tris；移动端无按钮', 'node tools/test-3d.mjs <url> <scene>       3D 81—148fps / 13—16 calls / 3,093—4,734 tris；移动端无按钮\nnode tools/quality/a11y-check.mjs          无障碍：按钮语义修复后 AX name 正常、换场有 aria-live 播报')

// ---------- 提交清单 ----------
const list = 'docs/deliverables/提交清单.md'
add(list, '113,138', '113,161')
add(list, '544 个文件 / 22.93 MB', '545 个文件 / 23.46 MB')
add(list, '22.93 MB', '23.46 MB')

// ---------- 运行说明 ----------
const run = 'docs/deliverables/运行说明.md'
add(run, '在四行仓库底楼 / 楼顶 / 桥 / 1947 厢房场景', '在四行仓库西墙 / 底楼 / 楼顶 / 桥 / 1947 厢房场景')

// ---------- 评审视频脚本 ----------
const video = 'docs/deliverables/评审视频脚本.md'
add(video, '四行仓库底楼、楼顶、苏州河桥、1947 厢房这四个场景，还各有一个真的 3D 场景', '四行仓库西墙、底楼、楼顶、苏州河桥、1947 厢房这五个场景，还各有一个真的 3D 场景（西墙是 Blender 建模导出的 GLB，其余是程序化几何）')

// ---------- 成果状态：追加 v1.3 ----------
const status = 'docs/deliverables/成果状态.md'

let applied = 0
const misses = []
for (const edit of edits) {
  const full = path.join(ROOT, edit.file)
  let source
  try {
    source = await readFile(full, 'utf8')
  } catch {
    misses.push(`${edit.file} :: 文件不存在`)
    continue
  }
  if (!source.includes(edit.from)) {
    misses.push(`${edit.file} :: 未找到 ${edit.from.slice(0, 40)}…`)
    continue
  }
  await writeFile(full, source.split(edit.from).join(edit.to), 'utf8')
  applied += 1
}

const statusAppend = `

---

## 2026-10-22 13:50 更新（v1.3）

- ✅ **合成结局独立审计补齐**：史实 P0 4→0、文学 3.99→4.35；修复 4 个与主结局冲突的 P0（口述年份、互见人数、家书/照片原件入库）与 16 条 P1；六主结局零改动。
- ✅ **继承性问题修复**：chapter1.ts 尾声「一张十一个人的合影」→「一张画着两个圈的纸」（与 C2 一致）；App.tsx compositeLine 同步为「抄件还在，单子还在」。
- ✅ **无障碍 P1 修复**：选项按钮恢复 button 语义（删除 role=list/listitem）；换场 h1 焦点 + aria-live 播报；Esc 关史料卡浮层；3D 在窗口 <700px 自动退出；移动端声音按钮不再压正文。
- ✅ **Blender hero 资产**：public/models/warehouse-ext.glb（4,732 tris / 469.6 KB，4.2.3 无头 bpy，Cycles CPU 0 显存），接入 v1-24 / v1-25 的 3D 视角。
- ✅ **数字统一**：113,161 字 / dist 545 文件 23.46 MB / 主包 gzip 298.0 kB / 3D 懒加载 166.7 kB。
- 🔄 待办：正式重出 PDF → 打包 ZIP（node tools/package.mjs --name "把名字留下来_<编号>"）→ 评审视频与报名线下。
`
await writeFile(path.join(ROOT, status), (await readFile(path.join(ROOT, status), 'utf8')) + statusAppend, 'utf8')

console.log(`applied ${applied}/${edits.length}`)
if (misses.length) console.log('misses:\n' + misses.join('\n'))
