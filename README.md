# 把名字留下来 · 四行仓库

> 2026 年第十四届全国大学生数字媒体科技作品及创意竞赛 · 指定命题「红色之旅 追梦铸魂」参赛作品。
> 网页端 2.5D / 真 3D 混合交互叙事：**140 个场景 · 113,048 字正文 · 9 个结局 · 76 张史料卡 · 496 张生成插画 · 28 条本地生成音效 · 5 个真 3D 场景**。

四百二十多个人守了四天四夜。他们的名字，后来只找回来八十七个。
玩家不是枪手，是四行仓库里一个识字的兵：每一夜只能带一样东西过苏州河——带出去什么，什么就活下来。

---

## 快速开始

```bash
npm install
npm run dev        # 开发预览（默认 http://localhost:5173）
npm run build      # 产出 dist/（单页静态站点）
npm run preview    # 预览构建产物
```

构建用了 ES Module，**必须通过 HTTP 起服务**（直接双击 index.html 会被浏览器 file:// 策略拦成白屏）。
构建已设 base: './'，可放在任意子目录部署。

## 作品特性

| 维度 | 内容 |
|---|---|
| 叙事 | 序卷（1947 造册前夜）→ 卷一（通城整编到上海）→ 四行五夜 → 孤军营四年 → 1947 造册 → 九结局；另有 10 篇人物志、15 篇后来读者页 |
| 结局 | 6 个主结局（六种记忆载体）+ 3 个合成结局（两样同时带走才解锁）；不排名、不分好坏 |
| 交互 | 六种记忆载体的点击粒子、五种天气转场、悬停差分、段落错峰入场；结局有 6 秒 Canvas 终极画面，可跳过可重看 |
| 2.5D | 父层真透视倾斜 + 子层静态 translateZ；实测 48fps |
| 真 3D | 四行仓库西墙（Blender 导出 GLB）/ 底楼 / 楼顶 / 苏州河桥 / 1947 厢房五个场景，three.js 按需加载，失败自动回退 2.5D |
| 声音 | 28 条本地生成环境音/动作音（Stable Audio Open Small）；默认静音，可开关，随场景与天气切换 |
| 史实 | 76 张史料卡（63 已核 / 7 待核 / 6 待接入），游戏内可逐条查看原句与出处；真实人物零自编台词 |
| 无障碍 | 键盘全流程、减少动效降级、3D/音频可关、移动端可用 |

## 目录

```
src/
  App.tsx                 页面与状态编排（菜单/游戏/结局/图鉴/人物志/后来/史料库）
  game/
    types.ts              类型（场景/抉择/结局/史料卡）
    engine.ts             纯函数状态机（choose → pendingOutcome → advance；账本封顶）
    audio.ts              Web Audio 声音系统（默认静音、手势解锁、场景映射）
    content/              正文数据（chapter1 + volume0—5 + endings + sources）
    components/           Stage(2.5D) / Scene3D(three.js) / InkCurtain / Particles / ChoiceBurst / EndingFinale
public/
  art/                    496 张场景与结局插画（生成，含同名参数 JSON）
  bg/                     8 张 2.5D 分层背景
  audio/                  28 条音效（OGG）
  models/                 warehouse-ext.glb（Blender 建模的四行仓库西墙）
docs/
  deliverables/           作品介绍、运行说明、AI 说明、测试记录、截图、PDF
  audit/                  双轨审计报告（史实 / 文学）与覆盖边界说明
  report/                 构建报告、3D 报告、三轮复审（剧情/动画/3D 加载）、metrics（唯一数字源）
  art/                    图片总谱、视觉圣经、质检报告
  audio/                  音效 manifest 与复现脚本说明
  research/               文献检索请求（交给搜索 AI 的结构化需求单）
tools/
  metrics.mjs             采集全项目数字（唯一数字源）
  count-words-strict.mjs  严格正文字数
  check-volumes.mjs       场景链与史料卡引用校验
  walk-test.mjs           全流程走路测试（115 场景到结局）
  ending-test-v3.mjs      九结局可达性测试
  test-3d.mjs / test-audio.mjs / test-deploy.mjs / test-degrade.mjs / test-3d-chunk-fail.mjs
  lead-audit.mjs          键盘/存档/图鉴/3D 泄漏等终审
  anim-check.mjs          动效与性能取证
  blender/                四行仓库西墙的无头 bpy 建模脚本
```

## 验证

```bash
node tools/metrics.mjs                    # 数字基线
node tools/count-words-strict.mjs         # 113,048 字
node tools/check-volumes.mjs              # 140 场景，next/sources 全有效
node tools/walk-test.mjs <url>            # 115 场景到「名册」，0 错误
node tools/ending-test-v3.mjs <url>       # 9/9 结局
node tools/lead-audit.mjs <url>           # 11/11 键盘/存档/图鉴/3D 泄漏
node tools/test-3d-chunk-fail.mjs <url>   # lazy chunk 失败不白屏
node tools/test-deploy.mjs                # 子目录 + HTTP 打包形态
node tools/test-degrade.mjs <url>         # 减少动效 / 移动端降级
```

## 界线（不做什么）

- 不做战斗、不做杀敌计数、不做「守住/失守」评分；
- 结局不绑定死亡人数，只改变「哪一种记忆被留下」；
- 真实人物只以可查证事实出现，不虚构台词；未核史实不进正文；
- 插图与音效为本地生成素材，不承担史实表述，不出现清晰人脸或真实人物肖像。

## 许可与声明

本项目为参赛作品，代码与文字版权归作者所有。第三方依赖见 docs/deliverables/第三方资源说明.md；
AI 使用情况见 docs/deliverables/AI使用说明.md（含审计覆盖边界）。史料出处见游戏内「史料库」。
