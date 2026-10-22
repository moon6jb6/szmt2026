import { readFile, writeFile } from 'node:fs/promises'

const files = [
  'docs/deliverables/打包说明.md',
  'docs/deliverables/提交清单.md',
  'docs/deliverables/成果状态.md',
]
const finalHash = 'fe415e718c3248ab5719affcbf281b792e15931932a95d8740add07b7cfaacdd'
const pairs = [
  ['801148ca0154673d63d0e537697b0edb28e76187958feddd38c58aa9aacd1490', finalHash],
  ['5751b48cf6308efcaabe5ae5cc4c2365fe6a7d79b6cc787b20c50c00809ed712', finalHash],
  ['34,246,748 B', '34,246,767 B'],
  ['34,246,748', '34,246,767'],
]
for (const f of files) {
  let s = await readFile(f, 'utf8')
  for (const [a, b] of pairs) s = s.split(a).join(b)
  await writeFile(f, s, 'utf8')
  console.log('updated', f)
}

const report = 'docs/report/2026-10-22-deai-pass1.md'
let r = await readFile(report, 'utf8')
if (!r.includes('玩家可见文本（本提交新增）')) {
  r += `

---

## 玩家可见文本（本提交新增，Lead 执行）

| 范围 | 数量 | 做法 |
|---|---|---|
| 史料卡备注 note | 64 条（56 auto + 8 base） | 全部重写：删网址、删 confidence/not_found/web.fetch/禁止合并/本槽提问 等流程词；各家说法照实并列 |
| 场景脚注 aside | 35 条 | 去掉「复合型虚构角色」「叙事重构」这类公文词和卡片 id，改成作者附注口吻 |
| claim（依据陈述） | 6 条报告腔 | 「系…所致」「方使…披露于世」「未见留载」「需并列」等改成正常语序 |
| App 静态文案 | 4 处 | 「复合型虚构角色」改成「不是哪个真人，是照着几个通城兵拼出来的」；内容提示同步 |
| 史料库标签 | 全部 | 隐藏 confidence:/P1 这类内部标签，只留内容分类 |

用户点名的三句已改：

- 「主持人明确为民国通城县参议会」→「这本册子由民国通城县参议会主持编成」
- 「四十九人名单即该册所录本县参加四行孤军者。」→「表里四十九个人，就是当时记下的本县参加四行孤军的那一批」
- 「“为什么编”…未见权威公开详述，不臆测。」→「编它，是想把本县参加抗战的人记下来……公开报道只讲到 1980 年重新发现它，再往下就没有了。戏里在这段上添了一些艺术加工。」

验收：verify-deai-round1 通过（史料库 76 条无网址、无流程词、无旧句）；全流程 115 场景 0 错误；九结局 9/9；lead-audit 11/11。
`
  await writeFile(report, r, 'utf8')
  console.log('report updated')
}
