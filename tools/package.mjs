#!/usr/bin/env node
/**
 * 《把名字留下来》参赛打包器
 * =============================================================================
 * 入口：node tools/package.mjs
 *
 * 作用：按《参赛作品材料提交规范》14 项生成七段目录 + 线下材料占位目录的 ZIP 包，
 *       顺带做四件事——匿名化关键词扫描、dist 完整性核对、PDF 新鲜度核对、
 *       与 `docs/report/2026-10-22-afternoon-metrics.json`（唯一数字源）对账，
 *       最后把结果写成 `docs/report/2026-10-22-package-manifest.json`。
 *
 * 设计原则：
 *   1. 不删除任何源文件；只在 `--out` 目录下新建「暂存树 + ZIP」，再写 2 个占位说明。
 *   2. 缺文件就报错/列缺失项，**绝不伪造**内容（占位说明只写「这里缺什么、怎么补」）。
 *   3. 数字一律从 metrics JSON 读或现场实测，脚本里不写死会漂移的数字。
 *   4. ZIP 由脚本自己写（Node 自带 zlib），文件名按 UTF-8 + 置 EFS 标志位（0x800）。
 *      —— 系统 tar(bsdtar) 在中文 Windows 上会把文件名写成 GBK 且不置标志位，
 *         评委在英文/日文系统或 macOS 上解压会乱码，故不用系统 tar 打包。
 *
 * 用法：
 *   node tools/package.mjs                                  # 默认占位名，输出到 trash 试打包目录
 *   node tools/package.mjs --name "把名字留下来_A1234"        # 报名后换成「作品名_作品编号」
 *   node tools/package.mjs --out "D:\提交\作品.zip"
 *   node tools/package.mjs --dry-run                        # 只体检 + 写 manifest，不落 ZIP
 *   node tools/package.mjs --help
 * =============================================================================
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url'

// --no-screenshots：截图按赛事要求单独上传，不放进材料压缩包
const NO_SCREENSHOTS = process.argv.includes('--no-screenshots')
// --final：正式材料包——不放截图、视频、承诺书/PPT 占位目录（这些单独上传）
const EXCLUDE_HANDOFF = process.argv.includes('--final');

// ============================================================================
// 0. 路径与常量
// ============================================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                     // 项目根：frontend/2026数字媒体
const DIST = path.join(ROOT, 'dist');
const DELIV = path.join(ROOT, 'docs', 'deliverables');
const DOCS = path.join(ROOT, 'docs');
const MANIFEST_PATH = path.join(DOCS, 'report', '2026-10-22-package-manifest.json');
const METRICS_PATH = path.join(DOCS, 'report', '2026-10-22-afternoon-metrics.json');

const DEFAULT_NAME = '把名字留下来_待填编号';
const PLACEHOLDER_NAME_HINT = '_待填编号';
const DEFAULT_OUT_DIR = path.resolve(ROOT, '..', '..', 'trash', '_package-test-2026-10-22');

const ZIP_MAX_TOTAL_BYTES = 10 * 1024 ** 3;                // 规范上限 10 GB
const FLAG_UTF8 = 0x0800;                                  // ZIP 通用标志位 11：文件名为 UTF-8

// 目录结构（顺序即 ZIP 内顺序）。required=false 的目录允许为空 + 占位说明。
const DIR_SPEC = [
  { p: '01_作品及成果文件', label: '作品及成果文件（dist 原样）', required: true },
  { p: '01_作品及成果文件/assets', label: '打包产物 JS/CSS', required: true },
  { p: '01_作品及成果文件/art', label: '场景/结局/道具插画', required: true },
  { p: '01_作品及成果文件/bg', label: '2.5D 基准背景 + 参数 JSON', required: true },
  { p: '01_作品及成果文件/audio', label: '本地生成音效', required: true },
  { p: '02_作品展示视频', label: '作品展示/评审视频（当前缺）', required: false },
  { p: '03_作品介绍文档', label: '作品介绍 PDF', required: true },
  { p: '04_运行或使用说明', label: '运行说明 PDF', required: true },
  { p: '05_补充成果材料', label: '截图 / 测试 / 审计 / 美术 / 音频 / 指标', required: true },
  { p: '05_补充成果材料/screenshots', label: '作品截图（≤10 张）', required: true },
  { p: '05_补充成果材料/审计报告', label: '双轨审计 FINAL×2 + 覆盖边界补充', required: true },
  { p: '05_补充成果材料/美术报告', label: '图片总谱 / 质检 / 视觉圣经', required: true },
  { p: '05_补充成果材料/音频报告', label: '音效 manifest', required: true },
  { p: '06_第三方资源说明', label: '第三方资源说明 PDF', required: true },
  { p: '07_AI工具使用补充说明', label: 'AI 使用说明 PDF', required: true },
  { p: '报名与承诺书（线下办理）', label: '报名信息 / 承诺书（线下办理，当前缺）', required: false },
];

if (EXCLUDE_HANDOFF) {
  for (let i = DIR_SPEC.length - 1; i >= 0; i -= 1) {
    if (DIR_SPEC[i].p.startsWith('02_作品展示视频') || DIR_SPEC[i].p.startsWith('报名与承诺书') || DIR_SPEC[i].p.endsWith('/screenshots')) {
      DIR_SPEC.splice(i, 1)
    }
  }
}


// --no-screenshots：截图单独提交，材料包里不放
if (NO_SCREENSHOTS) {
  const i = DIR_SPEC.findIndex((d) => d.p.endsWith('/screenshots'))
  if (i >= 0) DIR_SPEC.splice(i, 1)
}


// 打包内容：{ to: 包内相对路径, from: 源相对路径, tree?: 整目录, glob?: 文件模式, required }
const ENTRY_SPEC = [
  // ---- 01 作品及成果文件：dist 原样（R1 修复后 base:'./'，可直接起静态服务运行）----
  { to: '01_作品及成果文件/index.html', from: 'dist/index.html', required: true },
  { to: '01_作品及成果文件/assets', from: 'dist/assets', tree: true, required: true },
  { to: '01_作品及成果文件/art', from: 'dist/art', tree: true, required: true },
  { to: '01_作品及成果文件/bg', from: 'dist/bg', tree: true, required: true },
  { to: '01_作品及成果文件/audio', from: 'dist/audio', tree: true, required: true },
  { to: '01_作品及成果文件/models', from: 'dist/models', tree: true, required: true },
  { to: '01_作品及成果文件/scene-bg', from: 'dist/scene-bg', tree: true, required: true },

  // ---- 03 / 04 文档 ----
  { to: '03_作品介绍文档/作品介绍.pdf', from: 'docs/deliverables/作品介绍.pdf', required: true },
  { to: '04_运行或使用说明/运行说明.pdf', from: 'docs/deliverables/运行说明.pdf', required: true },

  // ---- 05 补充成果材料 ----
  { to: '05_补充成果材料/测试记录.pdf', from: 'docs/deliverables/测试记录.pdf', required: true },
  {
    to: '05_补充成果材料/screenshots', from: 'docs/deliverables/screenshots',
    glob: '*.png', required: true, expectedCount: 10, label: '作品截图',
  },
  { to: '05_补充成果材料/审计报告/FINAL-fact-audit.md', from: 'docs/audit/FINAL-fact-audit.md', required: true },
  { to: '05_补充成果材料/审计报告/FINAL-literary-audit.md', from: 'docs/audit/FINAL-literary-audit.md', required: true },
  { to: '05_补充成果材料/审计报告/2026-10-22-post-audit-addendum.md', from: 'docs/audit/2026-10-22-post-audit-addendum.md', required: true },
  { to: '05_补充成果材料/审计报告/2026-10-22-composite-fact.md', from: 'docs/audit/2026-10-22-composite-fact.md', required: true },
  { to: '05_补充成果材料/审计报告/2026-10-22-composite-literary.md', from: 'docs/audit/2026-10-22-composite-literary.md', required: true },
  { to: '05_补充成果材料/复审报告/2026-10-22-story-rules-review.md', from: 'docs/report/2026-10-22-story-rules-review.md', required: true },
  { to: '05_补充成果材料/复审报告/2026-10-22-animation-review.md', from: 'docs/report/2026-10-22-animation-review.md', required: true },
  { to: '05_补充成果材料/复审报告/2026-10-22-3d-loading-review.md', from: 'docs/report/2026-10-22-3d-loading-review.md', required: true },
  { to: '05_补充成果材料/复审报告/2026-10-22-blender-asset.md', from: 'docs/report/2026-10-22-blender-asset.md', required: true },
  { to: '05_补充成果材料/美术报告/image-manifest.json', from: 'docs/art/image-manifest.json', required: true },
  { to: '05_补充成果材料/美术报告/scene-map.json', from: 'docs/art/scene-map.json', required: true },
  { to: '05_补充成果材料/美术报告/image-qa-report.md', from: 'docs/art/image-qa-report.md', required: true },
  { to: '05_补充成果材料/美术报告/spot-check.md', from: 'docs/art/spot-check.md', required: true },
  { to: '05_补充成果材料/美术报告/visual-bible.md', from: 'docs/art/visual-bible.md', required: true },
  { to: '05_补充成果材料/美术报告/README.md', from: 'docs/art/README.md', required: true },
  { to: '05_补充成果材料/音频报告/audio-manifest.json', from: 'docs/audio/audio-manifest.json', required: true },
  { to: '05_补充成果材料/2026-10-22-3d-slices.md', from: 'docs/report/2026-10-22-3d-slices.md', required: true },
  { to: '05_补充成果材料/2026-10-22-afternoon-metrics.json', from: 'docs/report/2026-10-22-afternoon-metrics.json', required: true },

  // ---- 06 / 07 说明 ----
  { to: '06_第三方资源说明/第三方资源说明.pdf', from: 'docs/deliverables/第三方资源说明.pdf', required: true },
  { to: '07_AI工具使用补充说明/AI使用说明.pdf', from: 'docs/deliverables/AI使用说明.pdf', required: true },
  {
    to: '07_AI工具使用补充说明/人工智能工具使用情况说明_460737.docx',
    from: 'docs/deliverables/人工智能工具使用情况说明_460737.docx',
    required: true,
  },
  {
    to: '07_AI工具使用补充说明/人工智能工具使用情况说明.pdf',
    from: 'docs/deliverables/人工智能工具使用情况说明.pdf',
    required: true,
  },
];

if (EXCLUDE_HANDOFF) {
  for (let i = ENTRY_SPEC.length - 1; i >= 0; i -= 1) {
    const to = String(ENTRY_SPEC[i].to || '')
    if (to.startsWith('02_作品展示视频') || to.startsWith('报名与承诺书') || to.includes('screenshots')) ENTRY_SPEC.splice(i, 1)
  }
}


if (NO_SCREENSHOTS) {
  for (let i = ENTRY_SPEC.length - 1; i >= 0; i -= 1) {
    if (String(ENTRY_SPEC[i].to || '').includes('screenshots')) ENTRY_SPEC.splice(i, 1)
  }
}


// PDF → 源 md（新鲜度核对：PDF 必须晚于 md，否则说明改了文档没重出 PDF）
const PDF_SOURCES = [
  { pdf: 'docs/deliverables/作品介绍.pdf', md: 'docs/deliverables/作品介绍.md' },
  { pdf: 'docs/deliverables/运行说明.pdf', md: 'docs/deliverables/运行说明.md' },
  { pdf: 'docs/deliverables/第三方资源说明.pdf', md: 'docs/deliverables/第三方资源说明.md' },
  { pdf: 'docs/deliverables/AI使用说明.pdf', md: 'docs/deliverables/AI使用说明.md' },
  { pdf: 'docs/deliverables/测试记录.pdf', md: 'docs/deliverables/测试记录.md' },
];

// ============================================================================
// 1. 敏感词表（可配置：--keywords <json> 可覆盖/追加；规则见 docs/deliverables/打包说明.md）
// ============================================================================
//
// 语义：
//   block   —— 命中即视为身份信息泄漏（评审材料必须匿名）：学校/指导教师/学号/姓名 等
//   caution —— 允许出现但需人工确认的（多为制度性用词）
//   patterns—— 正则：手机号、邮箱、身份证号、超长数字串
//
// 现状说明（诚实披露）：本项目正文的主题词就是「姓名/名字」（作品叫《把名字留下来》），
// 因此 01_作品及成果文件/assets/*.js 这种 11 万字叙事打包产物**不做正文关键词扫描**——
// 命中全是剧情用词，不构成身份信息，扫了只会制造噪音。构建产物只查文件名。
const KEYWORDS = {
  version: 1,
  note: '《把名字留下来》参赛包匿名化关键词表；tier=block 命中即 FAIL，caution 仅提示。',
  block: [
    { term: '指导教师', note: '评审材料不得出现指导教师' },
    { term: '指导老师', note: '同上（口语写法）' },
    { term: '辅导员', note: '校内身份' },
    { term: '班主任', note: '校内身份' },
    { term: '校长', note: '校内身份' },
    { term: '教务处', note: '校内机构' },
    { term: '学校', note: '校名常与之同现' },
    { term: '大学', note: '校名片段' },
    { term: '学院', note: '校名片段' },
    { term: '中学', note: '校名片段' },
    { term: '学号', note: '个人标识' },
    { term: '身份证', note: '个人证件' },
    { term: '学籍', note: '个人学籍材料' },
    { term: '手机号', note: '联系方式' },
    { term: '手机号码', note: '联系方式' },
    { term: '联系方式', note: '联系方式' },
    { term: '邮箱', note: '联系方式' },
    { term: '微信', note: '联系方式' },
    { term: 'QQ', note: '联系方式', flags: 'i' },
    { term: '真实姓名', note: '个人姓名' },
    { term: '姓名', note: '个人姓名（本作主题词，需逐条看上下文）' },
    { term: '团队', note: '团队署名（评审材料不带署名）' },
    { term: '队长', note: '团队署名' },
    { term: '参赛人', note: '申报人' },
    { term: '报名人', note: '申报人' },
    { term: '作者', note: '署名（需辨是否指叙事角色/文档撰写人）' },
  ],
  caution: [
    { term: '署名', note: '署名安排' },
    { term: '分工', note: '团队分工' },
    { term: '密码', note: '凭据' },
    { term: '密钥', note: '凭据' },
  ],
  patterns: [
    { id: 'cn-mobile', re: '(?<![0-9])1[3-9]\\d{9}(?![0-9])', tier: 'block', note: '中国大陆手机号' },
    { id: 'email', re: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', tier: 'block', note: '邮箱地址' },
    { id: 'cn-id', re: '(?<![0-9])[1-9]\\d{5}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[0-9Xx](?![0-9])', tier: 'block', note: '18 位身份证号' },
    { id: 'long-digit', re: '(?<![0-9])\\d{15,}(?![0-9])', tier: 'caution', note: '疑似证件号/银行卡号' },
    // 技术凭据只认「名称 + = 值」的形状：图片 manifest 的 "tokens": 63、
    // visual-bible 的「r3 token 重标定」（指 CLIP token）不应报警。
    { id: 'credential', re: '\\b(?:token|tokens|secret|password|passwd|api[_-]?key)\\b\\s*[:=]\\s*["\']?[\\w.+/=-]{12,}', tier: 'caution', flags: 'gi', note: '疑似硬编码凭据' },
    { id: 'dotenv', re: '(?<![\\w.])\\.env\\b', tier: 'caution', note: '环境变量文件' },
    { id: 'bearer', re: '\\bBearer\\s+[A-Za-z0-9._-]{8,}', tier: 'caution', flags: 'gi', note: '疑似令牌' },
  ],
  // 已核定的豁免：命中但经人工确认不含身份信息。每条必须写清理由，写入 manifest。
  exemptions: [
    {
      path: '05_补充成果材料/审计报告/FINAL-fact-audit.md',
      term: '姓名',
      reason: '原文「凶手姓名未列」，指叙事角色，不是参赛者真实姓名；上下文中无学校/人名实体。',
    },
    {
      path: '05_补充成果材料/审计报告/2026-10-22-composite-fact.md',
      term: '姓名',
      reason: '原文指史料《通城县参加上海四行孤军四十九壮士姓名一览表》，是历史文献名，不是参赛者真实姓名。',
    },
    {
      path: '05_补充成果材料/审计报告/2026-10-22-composite-fact.md',
      term: '署名',
      reason: '原文讨论虚构文书上的“文件署名”是否合理，属叙事审查用语，不含任何真实姓名。',
    },
  ],
};

// 全量扫描的文本扩展名（含正文语义，需要逐行看）
const TEXT_SCAN_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.html', '.htm', '.csv', '.yml', '.yaml', '.xml', '.svg']);
// 只查文件名的（压缩/二进制/构建产物）
const FILENAME_ONLY_EXT = new Set(['.js', '.mjs', '.css', '.map', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.ogg', '.mp3', '.wav', '.pdf', '.mp4', '.mov', '.zip']);

// 已压缩格式：ZIP 里直接 store，不再 deflate（省时间，体积几乎不变）
const STORE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.ogg', '.mp3', '.wav', '.mp4', '.mov', '.zip', '.gz', '.woff2']);

// ============================================================================
// 2. 参数
// ============================================================================

function usage() {
  return `《把名字留下来》参赛打包器

  node tools/package.mjs [选项]

选项
  --name <作品名称_作品编号>  ZIP 根目录与文件名，默认「${DEFAULT_NAME}」（占位）
  --out <zip 路径>            输出 ZIP；给目录则拼 <目录>/<name>.zip
                              默认 ${path.relative(process.cwd(), DEFAULT_OUT_DIR) || DEFAULT_OUT_DIR}\\<name>.zip
  --dry-run                   只体检 + 写 manifest，不建暂存树、不生成 ZIP
  --keywords <json>           覆盖敏感词表（结构见脚本内 KEYWORDS）
  --manifest <json>           manifest 输出路径，默认 docs/report/2026-10-22-package-manifest.json
  --note <文本>               本次运行的备注，写进 manifest（例：试打包，输出到 trash）
  --no-staging                打包后删除本次自建的暂存树（默认保留，便于人工核对）
  --allow-out-in-repo         允许把 ZIP 落到项目仓库内（默认禁止，避免把包提交进 git）
  --quiet                     只输出结论行
  --help                      显示本帮助

退出码
  0 打包成功且无阻断项（可直接提交）
  2 已出包 / 已体检，但 readiness.blockers 非空（缺视频、缺线下材料、编号占位、PDF 过期、匿名化）
  1 失败（缺必交文件 / ZIP 写入或回读校验失败 / 参数错）
`;
}

function parseArgs(argv) {
  const o = {
    name: DEFAULT_NAME,
    out: null,
    dryRun: false,
    keywordsFile: null,
    manifest: MANIFEST_PATH,
    note: '',
    keepStaging: true,
    allowOutInRepo: false,
    quiet: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺少取值`);
      return v;
    };
    switch (a) {
      case '--name': o.name = next(); break;
      case '--out': o.out = next(); break;
      case '--dry-run': o.dryRun = true; break;
      case '--keywords': o.keywordsFile = next(); break;
      case '--manifest': o.manifest = path.resolve(process.cwd(), next()); break;
      case '--note': o.note = next(); break;
      case '--no-staging': o.keepStaging = false; break;
      case '--allow-out-in-repo': o.allowOutInRepo = true; break;
      case '--quiet': o.quiet = true; break;
      case '--final': o.final = true; break;
      case '--no-screenshots': o.noScreenshots = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`未知参数 ${a}（--help 看用法）`);
    }
  }
  return o;
}

// ============================================================================
// 3. 小工具
// ============================================================================

const posix = (p) => p.split(path.sep).join('/');
const abs = (rel) => path.join(ROOT, rel);
const exists = (p) => fs.existsSync(p);
const stat = (p) => fs.statSync(p);

function human(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KiB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(2)} MiB`;
  return `${(b / 1024 ** 3).toFixed(2)} GiB`;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readJson(p) {
  // Windows 编辑器/PowerShell Set-Content 常带 BOM，先剥掉再解析
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

function localTimeString(d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${oh}:${om}`;
}

function walkFiles(dirAbs, relBase = '') {
  const out = [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const childRel = relBase ? `${relBase}/${e.name}` : e.name;
    const childAbs = path.join(dirAbs, e.name);
    if (e.isDirectory()) out.push(...walkFiles(childAbs, childRel));
    else if (e.isFile()) out.push({ rel: childRel, abs: childAbs, size: stat(childAbs).size, mtime: stat(childAbs).mtime });
  }
  return out;
}

function walkDirs(dirAbs, relBase = '') {
  const out = [];
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const childRel = relBase ? `${relBase}/${e.name}` : e.name;
    out.push(childRel);
    out.push(...walkDirs(path.join(dirAbs, e.name), childRel));
  }
  return out;
}

function gitInfo() {
  const info = { available: false, head: null, dirty: null };
  try {
    info.head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const st = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    info.dirty = st.split('\n').filter(Boolean).length;
    info.available = true;
  } catch { /* 无 git 或不在仓库内：不影响打包 */ }
  return info;
}

// ============================================================================
// 4. 打包计划
// ============================================================================

function validateName(name, outInRepo) {
  if (!name || !name.trim()) throw new Error('--name 不能为空');
  if (/[\\/:*?"<>|]/.test(name)) throw new Error(`--name 含有文件系统非法字符：${name}`);
  if (/^[.\s]/.test(name) || /\s$/.test(name)) throw new Error(`--name 不能以点或空格开头/结尾：${name}`);
  if (name.length > 80) throw new Error(`--name 过长（${name.length} > 80）`);
  if (!/^[\w\u4e00-\u9fff\u3000-\u303f\uff00-\uffef·\-（）()_\s]+$/u.test(name)) {
    throw new Error(`--name 含不支持的字符：${name}`);
  }
  if (name.includes('/') || name.includes('\\')) throw new Error('--name 不能含路径分隔符');
  return name;
}

function buildPlan() {
  const files = [];        // { to, srcAbs, srcRel, size, mtime, group, note }
  const missing = [];      // { entry, expected, required, note }
  const warnings = [];

  for (const e of ENTRY_SPEC) {
    const group = e.to.split('/')[0];
    if (e.tree) {
      const srcAbs = abs(e.from);
      if (!exists(srcAbs) || !stat(srcAbs).isDirectory()) {
        missing.push({ packagePath: e.to, source: e.from, required: !!e.required, note: '目录不存在' });
        continue;
      }
      const list = walkFiles(srcAbs);
      if (!list.length) {
        missing.push({ packagePath: e.to, source: e.from, required: !!e.required, note: '目录为空' });
        continue;
      }
      for (const f of list) {
        files.push({
          to: `${e.to}/${f.rel}`.replace(/\/+/g, '/'),
          srcAbs: f.abs,
          srcRel: `${e.from}/${f.rel}`,
          size: f.size,
          mtime: f.mtime,
          group,
        });
      }
    } else if (e.glob) {
      const dirAbs = abs(e.from);
      if (!exists(dirAbs)) {
        missing.push({ packagePath: e.to, source: e.from, required: !!e.required, note: '目录不存在' });
        continue;
      }
      const ext = path.extname(e.glob.replace('*', 'x')).toLowerCase();
      const list = fs.readdirSync(dirAbs, { withFileTypes: true })
        .filter((d) => d.isFile() && path.extname(d.name).toLowerCase() === ext)
        .map((d) => d.name)
        .sort();
      if (!list.length) {
        missing.push({ packagePath: e.to, source: e.from, required: !!e.required, note: `目录内没有 ${e.glob}` });
        continue;
      }
      for (const n of list) {
        const srcAbs = path.join(dirAbs, n);
        const st = stat(srcAbs);
        files.push({ to: `${e.to}/${n}`.replace(/\/+/g, '/'), srcAbs, srcRel: `${e.from}/${n}`, size: st.size, mtime: st.mtime, group });
      }
      if (e.expectedCount && list.length !== e.expectedCount) {
        warnings.push({
          id: 'screenshot-count',
          message: `${e.label || e.to} 数量 ${list.length}，规范/清单写作 ${e.expectedCount}`,
        });
      }
    } else {
      const srcAbs = abs(e.from);
      if (!exists(srcAbs) || !stat(srcAbs).isFile()) {
        missing.push({ packagePath: e.to, source: e.from, required: !!e.required, note: '文件不存在' });
        continue;
      }
      const st = stat(srcAbs);
      files.push({ to: e.to, srcAbs, srcRel: e.from, size: st.size, mtime: st.mtime, group });
    }
  }

  return { files, missing, warnings };
}

// ---------------------------------------------------------------------------
// 占位说明：只陈述「缺什么、怎么补、当前为空」，不编造内容
// ---------------------------------------------------------------------------

function placeholderTexts(name, missingVideo = true, missingEnroll = true) {
  const now = localTimeName();
  const p2 = [
    '【占位说明 · 02_作品展示视频】',
    '',
    '本目录按《参赛作品材料提交规范》预留「作品展示视频」位置，当前为空。',
    '',
    `· 打包时间：${now}`,
    `· 包名：${name}`,
    `· 现状：${missingVideo ? '评审视频尚未录制，打包时全库未检出可用 MP4 视频文件。' : '见包内实际文件。'}`,
    '',
    '应放内容：',
    '  1 个 MP4（H.264 视频 + AAC 音频），1920×1080，时长 ≤ 5 分钟；',
    '  容器内不要嵌外链、不要加水印；旁白与字幕按《评审视频脚本》执行。',
    '',
    '补齐步骤：',
    '  1. 按 docs/deliverables/评审视频脚本.md 录制、剪辑、导出 1080P MP4；',
    '  2. 把 MP4 放入本目录，删除本说明文件；',
    '  3. 重跑：node tools/package.mjs --name "<作品名称>_<作品编号>"',
    '',
    '备注：若官网该栏目与「参赛打包文件」合并上传、不要求独立视频文件，可整目录删除。',
    '本目录当前只有本说明文件，不含任何视频素材。',
    '',
  ].join('\r\n');

  const p7 = [
    '【占位说明 · 报名与承诺书（线下办理）】',
    '',
    '本目录预留「参赛报名信息」「参赛承诺书」等线下办理材料，当前为空。',
    '',
    `· 打包时间：${now}`,
    `· 包名：${name}`,
    `· 现状：${missingEnroll ? '报名系统信息尚未填写完成，承诺书尚未生成/盖章，故本目录只放本说明。' : '见包内实际文件。'}`,
    '',
    '应放内容：',
    '  报名系统导出的报名表（PDF，可选）；',
    '  承诺书：系统生成 → 打印 → 加盖公章 → 扫描为 PDF；',
    '  按官网要求需走身份审核渠道的材料，不要放进专家评审材料目录。',
    '',
    '补齐步骤：',
    '  1. 登录大赛官网报名系统，填写作品名称、赛道赛项、简介、运行条件、AI 使用情况；',
    '  2. 生成并打印承诺书，完成签章，扫描为 PDF；',
    '  3. 放入本目录、删除本说明，重跑打包命令；',
    '  4. 作品编号（系统生成）回填到 --name 里再打包。',
    '',
    '本目录当前不含任何已签署文件。',
    '',
  ].join('\r\n');


  if (EXCLUDE_HANDOFF) return []
  return [
    { to: '02_作品展示视频/占位说明.txt', text: p2, reason: '作品展示/评审视频尚未录制（缺 MP4 源文件）' },
    { to: '报名与承诺书（线下办理）/占位说明.txt', text: p7, reason: '报名系统信息与承诺书盖章为线下环节，本地无文件' },
  ];
}

function localTimeName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================================
// 5. 匿名化扫描
// ============================================================================

function loadKeywordTable(file) {
  if (!file) return { table: KEYWORDS, source: '内置默认表（脚本内 KEYWORDS）' };
  const p = path.resolve(process.cwd(), file);
  const j = readJson(p);
  const norm = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { term: x, note: '' } : x));
  const table = {
    version: j.version || KEYWORDS.version,
    note: j.note || '',
    block: j.block ? norm(j.block) : KEYWORDS.block,
    caution: j.caution ? norm(j.caution) : KEYWORDS.caution,
    patterns: j.patterns || KEYWORDS.patterns,
    exemptions: [...KEYWORDS.exemptions, ...(j.exemptions || [])],
  };
  return { table, source: path.relative(ROOT, p) };
}

function compileTerms(table) {
  const out = [];
  for (const t of table.block) out.push({ ...t, tier: 'block', re: null });
  for (const t of table.caution) out.push({ ...t, tier: 'caution', re: null });
  return out.filter((t) => t.term);
}

function scanLine(line, terms, patterns) {
  const hits = [];
  const lower = line.toLowerCase();
  for (const t of terms) {
    const needle = String(t.flags || '').includes('i') ? t.term.toLowerCase() : t.term;
    const hay = String(t.flags || '').includes('i') ? lower : line;
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      hits.push({ tier: t.tier, kind: 'term', term: line.slice(idx, idx + needle.length), index: idx, note: t.note || '' });
      idx = hay.indexOf(needle, idx + needle.length);
    }
  }
  for (const p of patterns) {
    let re;
    try {
      const f = p.flags ? (p.flags.includes('g') ? p.flags : `${p.flags}g`) : 'g';
      re = new RegExp(p.re, f);
    } catch { continue; }
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      hits.push({ tier: p.tier || 'caution', kind: 'pattern', term: m[0], id: p.id, index: m.index, note: p.note || '' });
    }
  }
  return hits;
}

function snippet(line, index, len) {
  const s = Math.max(0, index - 34);
  const e = Math.min(line.length, index + len + 34);
  const body = line.slice(s, e).replace(/\s+/g, ' ').trim();
  return `${s > 0 ? '…' : ''}${body}${e < line.length ? '…' : ''}`;
}

function exemptionFor(table, packagePath, term) {
  return table.exemptions.find((x) => (x.path === packagePath || packagePath.endsWith(x.path)) && x.term === term);
}

// --- PDF Info 字典 ---------------------------------------------------------
function decodePdfString(raw) {
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/[^0-9A-Fa-f]/g, '');
    const buf = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      try { return buf.slice(2).swap16().toString('utf16le'); } catch { /* fallthrough */ }
    }
    return buf.toString('latin1');
  }
  let s = raw.slice(1, -1);
  s = s.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c]));
  s = s.replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  if (/^[\x00-\xff]*$/.test(s)) {
    const bytes = Buffer.from(s, 'latin1');
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return bytes.slice(2).swap16().toString('utf16le');
    const utf8 = bytes.toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8;
  }
  return s;
}

function pdfMetadata(fileAbs) {
  const buf = fs.readFileSync(fileAbs);
  const txt = buf.toString('latin1');
  const keys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
  const info = {};
  for (const k of keys) {
    const re = new RegExp(`/${k}\\s*(\\((?:[^()\\\\]|\\\\.)*\\)|<[0-9A-Fa-f\\s]*>)`);
    const m = re.exec(txt);
    if (m) {
      const val = decodePdfString(m[1].trim());
      if (val) info[k] = val.slice(0, 300);
    }
  }
  return { info, bytes: buf.length };
}

function runAnonymityScan(packageFiles, table, source) {
  const terms = compileTerms(table);
  const patterns = table.patterns;
  const hits = [];
  const exempted = [];
  const scanStats = { textFiles: 0, textBytes: 0, textLines: 0, filenameOnlyFiles: 0, pdfFiles: 0 };
  const pdfMeta = [];
  const limitations = [
    '01_作品及成果文件/assets/*.js、*.css 为 11 万字叙事的构建产物，只查文件名、不做正文关键词扫描：本作主题词即「姓名/名字」，正文扫描全是剧情用词，无判定价值（如需可加 --keywords 后自行全文扫描）。',
    '截图 PNG / 插画 JPG / 音效 OGG 只查文件名，未做 OCR 与像素级人像检测。',
    'PDF 只解析 Info 字典（Title/Author/Creator/Producer 等）与明文，正文流是压缩的，未逐页提取文字。',
    '压缩包内文件的时间戳、EXIF 等元数据未做剔除处理（dist 为构建产物，无相机信息）。',
  ];
  const MAX_HITS_PER_FILE = 60;

  // 文件名检查（所有文件）
  for (const f of packageFiles) {
    const base = path.posix.basename(f.to);
    const lineHits = scanLine(f.to, terms, patterns);
    for (const h of lineHits) {
      const ex = exemptionFor(table, f.to, h.term);
      const rec = {
        packagePath: f.to, where: 'filename', tier: h.tier, kind: h.kind,
        term: h.term, id: h.id || null, line: null, snippet: base,
        exempted: !!ex, exemptionReason: ex ? ex.reason : null,
      };
      (ex ? exempted : hits).push(rec);
    }
  }

  // 正文检查（文本文件）
  for (const f of packageFiles) {
    const ext = path.extname(f.srcRel).toLowerCase();
    if (!TEXT_SCAN_EXT.has(ext)) { scanStats.filenameOnlyFiles++; continue; }
    const buf = fs.readFileSync(f.srcAbs);
    scanStats.textFiles++;
    scanStats.textBytes += buf.length;
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    scanStats.textLines += lines.length;
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < MAX_HITS_PER_FILE; i++) {
      const line = lines[i];
      if (!line) continue;
      for (const h of scanLine(line, terms, patterns)) {
        const ex = exemptionFor(table, f.to, h.term);
        const rec = {
          packagePath: f.to, where: 'content', tier: h.tier, kind: h.kind,
          term: h.term, id: h.id || null, line: i + 1,
          snippet: snippet(line, h.index, h.term.length),
          exempted: !!ex, exemptionReason: ex ? ex.reason : null,
        };
        (ex ? exempted : hits).push(rec);
        if (++perFile >= MAX_HITS_PER_FILE) break;
      }
    }
  }

  // PDF 元数据
  for (const f of packageFiles) {
    if (path.extname(f.srcRel).toLowerCase() !== '.pdf') continue;
    scanStats.pdfFiles++;
    const meta = pdfMetadata(f.srcAbs);
    pdfMeta.push({ packagePath: f.to, info: meta.info, bytes: meta.bytes });
    for (const [k, v] of Object.entries(meta.info)) {
      if (k === 'CreationDate' || k === 'ModDate') continue;
      for (const h of scanLine(`${k}: ${v}`, terms, patterns)) {
        hits.push({
          packagePath: f.to, where: `pdf-info:${k}`, tier: h.tier, kind: h.kind,
          term: h.term, id: h.id || null, line: null,
          snippet: v.slice(0, 120), exempted: false, exemptionReason: null,
        });
      }
    }
  }

  const blockHits = hits.filter((h) => h.tier === 'block');
  const cautionHits = hits.filter((h) => h.tier !== 'block');
  const status = blockHits.length ? 'FAIL' : cautionHits.length ? 'REVIEW' : 'PASS';
  const conclusion = blockHits.length
    ? `检出 ${blockHits.length} 处 block 级敏感词，必须先处理再上传（见 hits）`
    : hits.length
      ? `无 block 级命中；${cautionHits.length} 处 caution 级提示需人工确认（多为制度/叙事用词）`
      : `未检出身分级敏感词（text ${scanStats.textFiles} 个文件 / 文件名 ${packageFiles.length} 条 / PDF 元数据 ${scanStats.pdfFiles} 份）`;

  return {
    status,
    conclusion,
    keywordTable: { version: table.version, source, block: table.block.length, caution: table.caution.length, patterns: table.patterns.length, exemptions: table.exemptions.length },
    scanned: scanStats,
    counts: { block: blockHits.length, caution: cautionHits.length, exempted: exempted.length },
    hits,
    exempted,
    pdfMetadata: pdfMeta,
    limitations,
  };
}

// ============================================================================
// 6. ZIP 写入（自实现：UTF-8 名 + EFS 标志位 + 含空目录条目）
// ============================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const y = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
    date: (((y - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

function localHeader({ nameBuf, method, crc, csize, usize, time, date }) {
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4);          // version needed
  b.writeUInt16LE(FLAG_UTF8, 6);   // 文件名 UTF-8
  b.writeUInt16LE(method, 8);
  b.writeUInt16LE(time, 10);
  b.writeUInt16LE(date, 12);
  b.writeUInt32LE(crc >>> 0, 14);
  b.writeUInt32LE(csize >>> 0, 18);
  b.writeUInt32LE(usize >>> 0, 22);
  b.writeUInt16LE(nameBuf.length, 26);
  b.writeUInt16LE(0, 28);
  return b;
}

function centralHeader({ nameBuf, method, crc, csize, usize, time, date, offset, isDir }) {
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(0x0314, 4);      // made by: UNIX(3) + spec 2.0
  b.writeUInt16LE(20, 6);          // version needed
  b.writeUInt16LE(FLAG_UTF8, 8);
  b.writeUInt16LE(method, 10);
  b.writeUInt16LE(time, 12);
  b.writeUInt16LE(date, 14);
  b.writeUInt32LE(crc >>> 0, 16);
  b.writeUInt32LE(csize >>> 0, 20);
  b.writeUInt32LE(usize >>> 0, 24);
  b.writeUInt16LE(nameBuf.length, 28);
  b.writeUInt16LE(0, 30);          // extra len
  b.writeUInt16LE(0, 32);          // comment len
  b.writeUInt16LE(0, 34);          // disk start
  b.writeUInt16LE(0, 36);          // internal attr
  const mode = isDir ? 0o040755 : 0o100644;
  b.writeUInt32LE(((mode << 16) | (isDir ? 0x10 : 0x00)) >>> 0, 38);
  b.writeUInt32LE(offset >>> 0, 42);
  return b;
}

function shouldStore(name) {
  return STORE_EXT.has(path.extname(name).toLowerCase());
}

/**
 * 写 ZIP。entries: [{ name: 'a/b/', isDir: true } | { name, data: Buffer, mtime }]
 * 返回 { bytes, entries }
 */
function writeZip(outPath, entries, log) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, 'w');
  let offset = 0;
  const central = [];
  const write = (buf) => { fs.writeSync(fd, buf, 0, buf.length); offset += buf.length; };

  try {
    for (const e of entries) {
      const nameBuf = Buffer.from(e.isDir ? `${e.name.replace(/\/+$/, '')}/` : e.name, 'utf8');
      const dt = dosDateTime(e.mtime || new Date());
      if (e.isDir) {
        const lh = localHeader({ nameBuf, method: 0, crc: 0, csize: 0, usize: 0, ...dt });
        const localOffset = offset;
        write(lh); write(nameBuf);
        central.push(Buffer.concat([
          centralHeader({ nameBuf, method: 0, crc: 0, csize: 0, usize: 0, ...dt, offset: localOffset, isDir: true }),
          nameBuf,
        ]));
        continue;
      }
      const data = e.data;
      const crc = crc32(data);
      let method = 0;
      let payload = data;
      if (!shouldStore(e.name) && data.length > 256) {
        const deflated = zlib.deflateRawSync(data, { level: 9 });
        if (deflated.length < data.length) { method = 8; payload = deflated; }
      }
      if (payload.length > 0xFFFFFFFE || data.length > 0xFFFFFFFE) {
        throw new Error(`文件超过 4 GB，本脚本不支持 ZIP64：${e.name}`);
      }
      const localOffset = offset;
      const lh = localHeader({ nameBuf, method, crc, csize: payload.length, usize: data.length, ...dt });
      write(lh); write(nameBuf); write(payload);
      central.push(Buffer.concat([
        centralHeader({
          nameBuf, method, crc, csize: payload.length, usize: data.length, ...dt, offset: localOffset, isDir: false,
        }),
        nameBuf,
      ]));
    }

    if (entries.length > 0xFFFE) throw new Error(`条目数超过 65534，本脚本不支持 ZIP64：${entries.length}`);
    const cdOffset = offset;
    for (const c of central) write(c);
    const cdSize = offset - cdOffset;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdSize >>> 0, 12);
    eocd.writeUInt32LE(cdOffset >>> 0, 16);
    eocd.writeUInt16LE(0, 20);
    write(eocd);
  } finally {
    fs.closeSync(fd);
  }
  const bytes = fs.statSync(outPath).size;
  if (log) log(`ZIP 写入完成：${human(bytes)} / ${entries.length} 条目`);
  return { bytes, entries: entries.length };
}

// --- 回读校验：解析中央目录，逐项对名字、大小、UTF-8 标志位 -----------------
function readZipCentral(fileAbs) {
  const buf = fs.readFileSync(fileAbs);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 校验失败：找不到 EOCD');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff + cdSize !== eocd) throw new Error('ZIP 校验失败：中央目录偏移与 EOCD 不吻合');
  const list = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`ZIP 校验失败：第 ${i + 1} 条中央目录签名不对`);
    const flag = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const nameBuf = buf.subarray(p + 46, p + 46 + nlen);
    list.push({ name: nameBuf.toString('utf8'), utf8Flag: !!(flag & FLAG_UTF8), method, csize, usize, isDir: nameBuf.toString('utf8').endsWith('/') });
    p += 46 + nlen + elen + clen;
  }
  return { total, list, bytes: buf.length };
}

function verifyZip(fileAbs, expected) {
  const result = { ok: true, problems: [], entries: 0, files: 0, dirs: 0, utf8FlagAll: true, crossCheck: null, windowsCheck: null, sha256: null };
  result.sha256 = sha256(fs.readFileSync(fileAbs));
  let parsed;
  try {
    parsed = readZipCentral(fileAbs);
  } catch (e) {
    result.ok = false;
    result.problems.push(e.message);
    return result;
  }
  result.entries = parsed.total;
  const got = new Map(parsed.list.map((e) => [e.name, e]));
  result.files = parsed.list.filter((e) => !e.isDir).length;
  result.dirs = parsed.list.filter((e) => e.isDir).length;
  result.utf8FlagAll = parsed.list.every((e) => e.utf8Flag);
  if (!result.utf8FlagAll) { result.ok = false; result.problems.push('存在未置 UTF-8 标志位的条目，中文文件名在非中文系统会乱码'); }

  for (const exp of expected.files) {
    const e = got.get(exp.name);
    if (!e) { result.ok = false; result.problems.push(`ZIP 内缺文件：${exp.name}`); continue; }
    if (e.usize !== exp.size) { result.ok = false; result.problems.push(`大小不一致：${exp.name}（${e.usize} vs ${exp.size}）`); }
  }
  for (const d of expected.dirs) {
    if (!got.has(`${d}/`)) { result.ok = false; result.problems.push(`ZIP 内缺目录条目：${d}/`); }
  }

  // 独立实现交叉校验 1：bsdtar 读 UTF-8 标志位，能正确还原中文名
  try {
    const buf = execFileSync('tar', ['-tf', fileAbs], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    const names = buf.toString('utf8').split(/\r?\n/).filter(Boolean);
    result.crossCheck = {
      tool: 'bsdtar -tf',
      entries: names.length,
      match: names.length === parsed.total,
      note: 'bsdtar 在中文 Windows 上把文件名转成控制台代码页输出，此处只比对条目数，不看名字',
    };
    if (!result.crossCheck.match) {
      result.ok = false;
      result.problems.push(`交叉校验条目数不一致：bsdtar ${names.length} vs 自读 ${parsed.total}`);
    }
  } catch {
    result.crossCheck = { tool: 'bsdtar -tf', entries: null, match: null, note: '系统无 tar，跳过交叉校验' };
  }

  // 独立实现交叉校验 2：Windows 自带解压实现（.NET ZipFile）能否正确读出中文名
  result.windowsCheck = windowsZipCheck(fileAbs, parsed.total, expected.rootName);
  if (result.windowsCheck && result.windowsCheck.ok === false) {
    result.ok = false;
    result.problems.push(`Windows 解压实现读出的条目不对：${result.windowsCheck.reason || '条目数/根目录名不匹配'}`);
  }
  return result;
}

/**
 * 用 Windows 自带解压实现（System.IO.Compression.ZipFile，Explorer/Expand-Archive 同一套）
 * 回读条目名，确认中文文件名在评委机器上不会乱码。非 Windows 或没有 pwsh 时跳过。
 */
function windowsZipCheck(fileAbs, expectedEntries, expectedRootName) {
  if (process.platform !== 'win32') return { skipped: true, reason: '非 Windows 平台，跳过' };
  const esc = (s) => String(s).replace(/'/g, "''");
  const tmp = path.join(os.tmpdir(), `dsh-zipcheck-${process.pid}-${Date.now()}.txt`);
  // 用临时文件而不是管道回传：PowerShell 5.1 往管道写中文会按控制台代码页转码
  const cmd = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${esc(fileAbs)}')`,
    `$z.Entries | ForEach-Object { $_.FullName } | Set-Content -LiteralPath '${esc(tmp)}' -Encoding UTF8`,
    '$z.Dispose()',
  ].join('; ');
  const shells = ['pwsh', 'powershell'];
  let lastErr = null;
  for (const shell of shells) {
    try {
      execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', cmd], { stdio: 'ignore', timeout: 120000 });
      const names = fs.readFileSync(tmp, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
      try { fs.unlinkSync(tmp); } catch { /* 临时文件删不掉不影响结论 */ }
      const rootOk = expectedRootName ? names.includes(`${expectedRootName}/`) : true;
      const countOk = expectedEntries ? names.length === expectedEntries : true;
      return {
        tool: '.NET ZipFile.OpenRead（Windows 资源管理器 / Expand-Archive 同一套实现）',
        shell,
        entries: names.length,
        expectedEntries: expectedEntries ?? null,
        rootFolder: expectedRootName ? `${expectedRootName}/` : null,
        rootFolderReadable: rootOk,
        ok: countOk && rootOk,
        sample: names.slice(0, 3),
        reason: !countOk ? `条目数 ${names.length} ≠ ${expectedEntries}` : !rootOk ? `读不到根目录 ${expectedRootName}/（中文名可能乱码）` : null,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  return { skipped: true, reason: `pwsh/powershell 均不可用：${String(lastErr?.message || '').split('\n')[0].slice(0, 140)}` };
}

// ============================================================================
// 7. 体检：dist 完整性 / PDF 新鲜度 / metrics 对账
// ============================================================================

function checkDist(metrics) {
  const out = { present: exists(DIST), files: 0, bytes: 0, subdirs: {}, metrics: null, issues: [], artPresent: false, audioPresent: false, bgPresent: false, assetsPresent: false, indexPresent: false };
  if (!out.present) { out.issues.push('dist/ 不存在，必须先 npm run build'); return out; }
  const all = walkFiles(DIST);
  out.files = all.length;
  out.bytes = all.reduce((s, f) => s + f.size, 0);
  for (const [key, dir] of Object.entries({ assets: 'assets', art: 'art', bg: 'bg', audio: 'audio' })) {
    const p = path.join(DIST, dir);
    if (!exists(p)) { out.subdirs[key] = { files: 0, bytes: 0, present: false }; out.issues.push(`dist/${dir} 缺失`); continue; }
    const list = walkFiles(p);
    out.subdirs[key] = { files: list.length, bytes: list.reduce((s, f) => s + f.size, 0), present: true };
  }
  out.indexPresent = exists(path.join(DIST, 'index.html'));
  out.assetsPresent = out.subdirs.assets.present && out.subdirs.assets.files > 0;
  out.artPresent = out.subdirs.art.present && out.subdirs.art.files > 0;
  out.bgPresent = out.subdirs.bg.present && out.subdirs.bg.files > 0;
  out.audioPresent = out.subdirs.audio.present && out.subdirs.audio.files > 0;
  if (!out.indexPresent) out.issues.push('dist/index.html 缺失');

  // index.html 相对路径自检（R1 回归：不能再出现 src="/assets/…"）
  if (out.indexPresent) {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const absoluteRefs = [...html.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
    out.absoluteRefs = absoluteRefs;
    if (absoluteRefs.length) out.issues.push(`dist/index.html 仍有根绝对路径引用（${absoluteRefs.length} 处），file:// 与子目录部署会 404`);
  }

  // 与 metrics 对账
  if (metrics?.build) {
    const agree = [];
    const push = (key, expect, actual) => agree.push({ key, metrics: expect, actual, ok: expect === actual });
    push('build.distFiles', metrics.build.distFiles, out.files);
    push('build.jsBytes', metrics.build.jsBytes, (out.subdirs.assets.files ? walkFiles(path.join(DIST, 'assets')).filter((f) => f.rel.endsWith('.js')).reduce((s, f) => s + f.size, 0) : 0));
    push('build.cssBytes', metrics.build.cssBytes, (out.subdirs.assets.files ? walkFiles(path.join(DIST, 'assets')).filter((f) => f.rel.endsWith('.css')).reduce((s, f) => s + f.size, 0) : 0));
    push('images.artFiles', metrics.images?.artFiles, out.subdirs.art.files);
    push('images.backgroundFiles', metrics.images?.backgroundFiles, out.subdirs.bg.present ? walkFiles(path.join(DIST, 'bg')).filter((f) => f.rel.endsWith('.jpg')).length : 0);
    push('audio.files', metrics.audio?.files, out.subdirs.audio.files);
    push('audio.bytes', metrics.audio?.bytes, out.subdirs.audio.bytes);
    const mbMib = Number((out.bytes / 1024 ** 2).toFixed(2));
    agree.push({ key: 'build.distMb', metrics: metrics.build.distMb, actual: mbMib, ok: Math.abs((metrics.build.distMb ?? -1) - mbMib) < 0.05, note: 'MiB（1024²）口径' });
    out.metrics = { agreement: agree, allMatch: agree.every((a) => a.ok) };
    for (const a of agree.filter((x) => !x.ok)) out.issues.push(`与 metrics 不一致：${a.key} 期望 ${a.metrics} 实际 ${a.actual}`);
  }
  return out;
}

/**
 * dist 是否落后于 src/ 与 public/：新改的源码或新放进 public 的素材没进 dist，
 * 包就会「看起来完整、跑起来缺东西」。以 dist/index.html 的 mtime 为构建时间基准。
 */
function checkDistStaleness(distCheck) {
  const BUILD_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json', '.glb', '.gltf', '.bin', '.jpg', '.jpeg', '.png', '.webp', '.ogg', '.mp3', '.wav', '.svg', '.woff2', '.ttf']);
  const out = { distBuiltAt: null, distBuiltAtLocal: null, scannedDirs: [], newerFiles: [], stale: false, newestSourceLocal: null };
  const indexPath = path.join(DIST, 'index.html');
  if (!exists(indexPath)) return out;
  const builtAt = stat(indexPath).mtime;
  out.distBuiltAt = builtAt.toISOString();
  out.distBuiltAtLocal = localTimeString(builtAt);
  const newer = [];
  for (const dir of ['src', 'public']) {
    const p = path.join(ROOT, dir);
    if (!exists(p)) continue;
    out.scannedDirs.push(dir);
    for (const f of walkFiles(p)) {
      if (!BUILD_EXT.has(path.extname(f.rel).toLowerCase())) continue;
      if (f.mtime > builtAt) newer.push({ path: `${dir}/${f.rel}`, mtimeLocal: localTimeString(f.mtime), bytes: f.size });
    }
  }
  newer.sort((a, b) => (a.mtimeLocal < b.mtimeLocal ? 1 : -1));
  out.newerFiles = newer.slice(0, 12);
  out.newerCount = newer.length;
  out.stale = newer.length > 0;
  out.newestSourceLocal = newer[0]?.mtimeLocal || null;
  return out;
}

function checkPdfFreshness() {
  const rows = [];
  for (const p of PDF_SOURCES) {
    const pdfAbs = abs(p.pdf);
    const mdAbs = abs(p.md);
    const row = { pdf: p.pdf, md: p.md, pdfPresent: exists(pdfAbs), mdPresent: exists(mdAbs) };
    if (!row.pdfPresent) { row.status = 'MISSING'; rows.push(row); continue; }
    const st = stat(pdfAbs);
    row.pdfBytes = st.size;
    row.pdfMtime = st.mtime.toISOString();
    row.pdfMtimeLocal = localTimeString(st.mtime);
    if (!row.mdPresent) { row.status = 'NO-SOURCE'; rows.push(row); continue; }
    const mdSt = stat(mdAbs);
    row.mdMtime = mdSt.mtime.toISOString();
    row.mdMtimeLocal = localTimeString(mdSt.mtime);
    row.deltaSeconds = Math.round((st.mtime - mdSt.mtime) / 1000);
    row.status = row.deltaSeconds >= 0 ? 'FRESH' : 'STALE';
    rows.push(row);
  }
  return { rows, allFresh: rows.every((r) => r.status === 'FRESH'), stale: rows.filter((r) => r.status === 'STALE') };
}

function checkScreenshots(files) {
  if (NO_SCREENSHOTS || EXCLUDE_HANDOFF) return { count: 0, expected: 0, ok: true, bytes: 0, names: [] }
  const list = files.filter((f) => f.to.startsWith('05_补充成果材料/screenshots/'));
  return {
    count: list.length,
    expected: 10,
    ok: list.length === 10,
    bytes: list.reduce((s, f) => s + f.size, 0),
    names: list.map((f) => path.posix.basename(f.to)),
  };
}

// ============================================================================
// 8. 主流程
// ============================================================================

function main() {
  let opt;
  try {
    opt = parseArgs(process.argv);
  } catch (e) {
    console.error(`参数错误：${e.message}`);
    process.exit(1);
  }
  if (opt.help) { console.log(usage()); process.exit(0); }

  const startedAt = new Date();
  const log = (...a) => { if (!opt.quiet) console.log(...a); };
  const warnings = [];
  const fatal = [];

  // ---- 名字 / 输出路径 ----
  try { validateName(opt.name, opt.allowOutInRepo); } catch (e) { fatal.push(e.message); }

  let outZip;
  try {
    if (opt.out) {
      const raw = path.resolve(process.cwd(), opt.out);
      const looksDir = /[\\/]$/.test(opt.out) || (exists(raw) && stat(raw).isDirectory());
      outZip = looksDir ? path.join(raw, `${opt.name}.zip`) : raw;
      if (path.extname(outZip).toLowerCase() !== '.zip') outZip += '.zip';
    } else {
      outZip = path.join(DEFAULT_OUT_DIR, `${opt.name}.zip`);
    }
    const rel = path.relative(ROOT, outZip);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && !opt.allowOutInRepo) {
      fatal.push(`--out 落在项目仓库内（${rel}）。ZIP 不应提交进 git；换到 trash/ 或仓库外，或加 --allow-out-in-repo。`);
    }
  } catch (e) {
    fatal.push(`--out 解析失败：${e.message}`);
  }

  if (opt.name.includes(PLACEHOLDER_NAME_HINT)) {
    warnings.push({ id: 'name-placeholder', message: `--name 仍是占位名「${opt.name}」：报名拿到作品编号后必须重跑，见 docs/deliverables/打包说明.md` });
  }

  // ---- 敏感词表 ----
  let kw;
  try {
    kw = loadKeywordTable(opt.keywordsFile);
  } catch (e) {
    fatal.push(`敏感词表读取失败：${e.message}`);
    kw = { table: KEYWORDS, source: '内置默认表（脚本内 KEYWORDS）' };
  }

  if (fatal.length) {
    console.error('打包中止：');
    for (const f of fatal) console.error(`  · ${f}`);
    process.exit(1);
  }

  // ---- 计划 ----
  log(`《把名字留下来》参赛打包   name=${opt.name}${opt.dryRun ? '   [dry-run]' : ''}`);
  const plan = buildPlan();
  const placeholders = placeholderTexts(opt.name, true, true);
  warnings.push(...plan.warnings);

  for (const p of placeholders) {
    warnings.push({ id: 'placeholder', message: `占位：${p.to} —— ${p.reason}` });
  }
  const missingRequired = plan.missing.filter((m) => m.required);

  // ---- 体检 ----
  let metrics = null;
  let metricsRef = null;
  if (exists(METRICS_PATH)) {
    try {
      metrics = readJson(METRICS_PATH);
      metricsRef = { path: path.relative(ROOT, METRICS_PATH).split(path.sep).join('/'), generatedAt: metrics.generatedAt || null };
    } catch (e) {
      warnings.push({ id: 'metrics-unreadable', message: `metrics JSON 解析失败：${e.message}` });
    }
  } else {
    warnings.push({ id: 'metrics-missing', message: '找不到 docs/report/2026-10-22-afternoon-metrics.json（唯一数字源），跳过对账' });
  }

  const distCheck = checkDist(metrics);
  const distStaleness = checkDistStaleness(distCheck);
  distCheck.staleness = distStaleness;
  if (distStaleness.stale) {
    distCheck.issues.push(`dist 早于 src/public 的 ${distStaleness.newerCount} 个改动（最新：${distStaleness.newerFiles[0].path} @ ${distStaleness.newerFiles[0].mtimeLocal}），先 npm run build 再打包`);
  }
  const pdfCheck = checkPdfFreshness();
  const shotCheck = checkScreenshots(plan.files);
  for (const d of distCheck.issues) warnings.push({ id: 'dist', message: d });
  for (const s of pdfCheck.stale) {
    warnings.push({
      id: 'pdf-stale',
      message: `PDF 旧于源 md：${s.pdf}（pdf ${s.pdfMtimeLocal} < md ${s.mdMtimeLocal}，差 ${Math.abs(s.deltaSeconds)}s）→ 需重出 PDF 再打包`,
    });
  }

  // ---- 匿名化扫描 ----
  const anonymity = runAnonymityScan(plan.files, kw.table, kw.source);

  // ---- 汇总 ----
  const totalBytes = plan.files.reduce((s, f) => s + f.size, 0)
    + placeholders.reduce((s, p) => s + Buffer.byteLength(p.text, 'utf8'), 0);
  const byGroup = new Map();
  for (const f of plan.files) {
    const g = byGroup.get(f.group) || { group: f.group, files: 0, bytes: 0 };
    g.files++; g.bytes += f.size;
    byGroup.set(f.group, g);
  }
  for (const p of placeholders) {
    const g = p.to.split('/')[0];
    const row = byGroup.get(g) || { group: g, files: 0, bytes: 0 };
    row.files++; row.bytes += Buffer.byteLength(p.text, 'utf8');
    byGroup.set(g, row);
  }

  // ---- 暂存树 + ZIP ----
  const runId = `${startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const stagingRoot = outZip ? path.join(path.dirname(outZip), '_staging', `${opt.name}__${runId}`) : null;
  const treeRoot = stagingRoot ? path.join(stagingRoot, opt.name) : null;
  let archive = null;
  let verify = null;

  const canBuild = !missingRequired.length && !fatal.length;

  if (opt.dryRun) {
    log(`[dry-run] 不建暂存树、不写 ZIP；预计 ${plan.files.length + placeholders.length} 个文件 / ${human(totalBytes)}`);
  } else if (!canBuild) {
    log('有必交文件缺失，跳过 ZIP 生成（见缺失项）。');
  } else {
    // 建目录
    const dirsToCreate = DIR_SPEC.map((d) => d.p).concat(
      // 目录条目可能被 ENTRY_SPEC 隐含，保证齐全
      plan.files.map((f) => path.posix.dirname(f.to)).filter((d) => d !== '.'),
    );
    const allDirs = [...new Set(dirsToCreate)].sort((a, b) => a.localeCompare(b, 'zh'));
    for (const d of allDirs) fs.mkdirSync(path.join(treeRoot, d), { recursive: true });

    // 拷贝（不删除源文件；保留 mtime）
    let copied = 0;
    for (const f of plan.files) {
      const dest = path.join(treeRoot, f.to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.srcAbs, dest);
      fs.utimesSync(dest, new Date(), f.mtime);
      copied++;
    }
    for (const p of placeholders) {
      const dest = path.join(treeRoot, p.to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, p.text, 'utf8');
    }
    log(`暂存树就绪：${path.relative(ROOT, treeRoot)}（${copied} 个文件从源目录复制，未改动任何源文件）`);

    // ZIP 条目：根目录 = 作品名称_作品编号（规范要求包内第一层就是它）
    const rootDir = `${opt.name}/`;
    const entries = [];
    entries.push({ name: rootDir, isDir: true, mtime: startedAt });
    for (const d of allDirs) entries.push({ name: `${rootDir}${d}`, isDir: true, mtime: startedAt });
    for (const p of placeholders) entries.push({ name: `${rootDir}${p.to}`, data: Buffer.from(p.text, 'utf8'), mtime: startedAt });
    const fileEntries = plan.files.map((f) => ({ name: `${rootDir}${f.to}`, data: fs.readFileSync(path.join(treeRoot, f.to)), mtime: f.mtime }));
    entries.push(...fileEntries.sort((a, b) => a.name.localeCompare(b.name, 'zh')));

    try {
      archive = writeZip(outZip, entries, log);
    } catch (e) {
      fatal.push(`ZIP 写入失败：${e.message}`);
    }

    if (archive) {
      verify = verifyZip(outZip, {
        files: entries.filter((e) => !e.isDir).map((e) => ({ name: e.name, size: e.data.length })),
        dirs: [opt.name, ...allDirs.map((d) => `${opt.name}/${d}`)],
        rootName: opt.name,
      });
      if (!verify.ok) fatal.push(`ZIP 回读校验失败：${verify.problems.slice(0, 5).join('；')}`);
      archive.path = outZip;
      archive.pathRelative = path.relative(ROOT, outZip).split(path.sep).join('/');
      archive.human = human(archive.bytes);
      archive.mib = Number((archive.bytes / 1024 ** 2).toFixed(2));
      archive.ratio = Number((archive.bytes / totalBytes).toFixed(4));
      archive.sha256 = verify.sha256;
      archive.entries = verify.entries;
      archive.files = verify.files;
      archive.dirs = verify.dirs;
      archive.utf8FlagAll = verify.utf8FlagAll;
      archive.crossCheck = verify.crossCheck;
      archive.windowsCheck = verify.windowsCheck;
      archive.stagingDir = treeRoot;
      archive.stagingKept = opt.keepStaging;
    }

    if (!opt.keepStaging && verify?.ok) {
      try { fs.rmSync(stagingRoot, { recursive: true, force: true }); archive.stagingKept = false; } catch { /* 留着更好，失败不致命 */ }
    }
  }

  // ---- 结果判定 ----
  const blockers = [];
  if (missingRequired.length) blockers.push(`必交源文件缺失 ${missingRequired.length} 项`);
  for (const i of distCheck.issues) blockers.push(`dist 体检：${i}`);
  if (pdfCheck.stale.length) blockers.push(`${pdfCheck.stale.length} 份 PDF 旧于源 md（需重出）`);
  if (anonymity.status === 'FAIL') blockers.push(`匿名化检查命中 ${anonymity.counts.block} 处 block 级敏感词`);
  if (opt.name.includes(PLACEHOLDER_NAME_HINT)) blockers.push('目录名/文件名仍是占位「待填编号」');
  if (!EXCLUDE_HANDOFF) {
    blockers.push('02_作品展示视频 为空（评审视频未录制）');
    blockers.push('报名与承诺书（线下办理）为空（线下环节未完成）');
  }

  const ok = !fatal.length && !missingRequired.length && (!verify || verify.ok);
  const submissionReady = ok && blockers.length === 0;
  const exitCode = !ok ? 1 : submissionReady ? 0 : 2;

  // ---- manifest ----
  const manifest = {
    schema: 'dsh/package-manifest/v1',
    project: '《把名字留下来》',
    generatedAt: new Date().toISOString(),
    generatedAtLocal: localTimeString(),
    durationSeconds: Number(((Date.now() - startedAt.getTime()) / 1000).toFixed(2)),
    tool: 'tools/package.mjs',
    command: ['node', 'tools/package.mjs', ...process.argv.slice(2)].join(' '),
    runNote: opt.note || null,
    dryRun: !!opt.dryRun,
    ok,
    exitCode,
    submissionReady,
    name: opt.name,
    nameIsPlaceholder: opt.name.includes(PLACEHOLDER_NAME_HINT),
    git: gitInfo(),
    metrics: metricsRef,
    archive: archive
      ? {
        path: archive.path,
        pathRelative: archive.pathRelative,
        bytes: archive.bytes,
        human: archive.human,
        mib: archive.mib,
        sha256: archive.sha256,
        entries: archive.entries,
        files: archive.files,
        dirs: archive.dirs,
        compressionRatio: archive.ratio,
        utf8FilenameFlag: archive.utf8FlagAll,
        crossCheck: archive.crossCheck,
        windowsCheck: archive.windowsCheck,
        stagingDir: archive.stagingDir,
        stagingKept: archive.stagingKept,
        limitBytes: ZIP_MAX_TOTAL_BYTES,
        limitHuman: '10 GiB',
        withinLimit: archive.bytes <= ZIP_MAX_TOTAL_BYTES,
      }
      : null,
    verification: verify
      ? { ok: verify.ok, problems: verify.problems, checkedFiles: verify.files, checkedDirs: verify.dirs }
      : null,
    totals: {
      files: plan.files.length + placeholders.length,
      dirs: DIR_SPEC.length,
      dirsIncludingRoot: DIR_SPEC.length + 1,
      bytes: totalBytes,
      human: human(totalBytes),
      byGroup: [...byGroup.values()]
        .sort((a, b) => a.group.localeCompare(b.group, 'zh'))
        .map((g) => ({
          ...g,
          human: human(g.bytes),
          label: DIR_SPEC.find((d) => d.p === g.group)?.label || '',
        })),
      distFiles: distCheck.files,
      distBytes: distCheck.bytes,
    },
    directories: DIR_SPEC.map((d) => {
      // 递归口径：目录自身 + 所有子孙目录里的文件
      const own = plan.files.filter((f) => f.to.startsWith(`${d.p}/`));
      const ph = placeholders.filter((p) => p.to.startsWith(`${d.p}/`));
      const files = own.length + ph.length;
      const bytes = own.reduce((s, f) => s + f.size, 0) + ph.reduce((s, p) => s + Buffer.byteLength(p.text, 'utf8'), 0);
      return {
        path: d.p,
        label: d.label,
        required: d.required,
        files,
        bytes,
        human: human(bytes),
        status: files === 0 ? 'empty' : ph.length === files ? 'placeholder' : 'ok',
      };
    }),
    contents: {
      '01_作品及成果文件': {
        source: 'dist/',
        files: distCheck.files,
        bytes: distCheck.bytes,
        human: human(distCheck.bytes),
        subdirs: distCheck.subdirs,
        indexHtmlBytes: exists(path.join(DIST, 'index.html')) ? stat(path.join(DIST, 'index.html')).size : null,
      },
      others: plan.files
        .filter((f) => f.group !== '01_作品及成果文件')
        .map((f) => ({
          packagePath: f.to,
          sourcePath: f.srcRel,
          bytes: f.size,
          mtime: f.mtime.toISOString(),
          mtimeLocal: localTimeString(f.mtime),
          sha256: sha256(fs.readFileSync(f.srcAbs)),
        })),
    },
    placeholders: placeholders.map((p) => ({ packagePath: p.to, whyEmpty: p.reason, bytes: Buffer.byteLength(p.text, 'utf8') })),
    missing: plan.missing.map((m) => ({
      packagePath: m.packagePath,
      expectedSource: m.source,
      required: m.required,
      reason: m.note,
      impact: m.required ? '必交项：缺则不能提交' : '可选/线下项：交前需补或整目录删除',
    })),
    checks: {
      dist: distCheck,
      pdfFreshness: pdfCheck,
      screenshots: shotCheck,
    },
    anonymity,
    warnings,
    readiness: {
      submissionReady: blockers.length === 0,
      blockers,
    },
    nextSteps: [
      '报名后拿到作品编号：node tools/package.mjs --name "把名字留下来_<作品编号>" --out "<仓库外的 zip 路径>"',
      '录好评审视频 → 放入 02_作品展示视频/、删占位说明 → 重跑打包',
      '承诺书盖章扫描 → 放入 报名与承诺书（线下办理）/、删占位说明 → 重跑打包',
      '上传前对包内 ZIP 做一次解压验证（见 docs/deliverables/打包说明.md 检查清单）',
    ],
  };

  fs.mkdirSync(path.dirname(opt.manifest), { recursive: true });
  fs.writeFileSync(opt.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // ---- 控制台汇报 ----
  const line = (s = '') => { if (!opt.quiet) console.log(s); };
  line('');
  line('─ 体检 ────────────────────────────────────────────');
  line(`  dist/          ${distCheck.files} 文件 / ${human(distCheck.bytes)}  ` +
    `art=${distCheck.subdirs.art?.files ?? 0} bg=${distCheck.subdirs.bg?.files ?? 0} ` +
    `audio=${distCheck.subdirs.audio?.files ?? 0} assets=${distCheck.subdirs.assets?.files ?? 0}  ` +
    `${distCheck.issues.length ? `[${distCheck.issues.length} 处问题]` : '[ok]'}`);
  if (distCheck.metrics) line(`  metrics 对账   ${distCheck.metrics.allMatch ? '[全部一致]' : `[${distCheck.metrics.agreement.filter((a) => !a.ok).length} 项不一致]`}`);
  for (const r of pdfCheck.rows) {
    line(`  PDF 新鲜度     ${r.status.padEnd(9)} ${path.posix.basename(r.pdf)}` +
      (r.deltaSeconds != null ? `  (pdf-md ${r.deltaSeconds >= 0 ? '+' : ''}${r.deltaSeconds}s)` : ''));
  }
  line(`  截图           ${shotCheck.count} 张 / ${human(shotCheck.bytes)} ${shotCheck.ok ? '[ok]' : `[应为 ${shotCheck.expected}]`}`);
  line(`  匿名化检查     ${anonymity.status}  block=${anonymity.counts.block} caution=${anonymity.counts.caution} 已豁免=${anonymity.counts.exempted}`);
  line('');
  if (archive) {
    line('─ 产物 ────────────────────────────────────────────');
    line(`  ZIP            ${archive.human}（${archive.bytes} B）/ ${archive.entries} 条目（${archive.files} 文件 + ${archive.dirs} 目录）`);
    line(`  压缩率         ${(archive.ratio * 100).toFixed(1)}%（原文件 ${human(totalBytes)}）`);
    line(`  UTF-8 文件名   ${archive.utf8FlagAll ? '[ok]' : '[fail]'}`);
    line(`  回读校验       ${verify.ok ? `[通过] ${verify.files} 文件 / ${verify.dirs} 目录` : '[失败]'}`);
    const wc = verify.windowsCheck;
    line(`  Windows 解压   ${wc?.skipped ? `[跳过] ${wc.reason}` : wc?.ok ? `[通过] .NET 读出 ${wc.entries} 条目，根目录「${wc.rootFolder}」正常` : `[失败] ${wc?.reason}`}`);
    line(`  SHA256         ${archive.sha256}`);
    line(`  输出           ${archive.path}`);
    line(`  暂存树         ${archive.stagingDir}（保留，可人工核对）`);
  } else if (opt.dryRun) {
    line(`─ dry-run ─ 预计 ${plan.files.length + placeholders.length} 个文件 / ${human(totalBytes)}，未生成 ZIP`);
  }
  line('');
  if (plan.missing.length) {
    line('─ 缺失项 ──────────────────────────────────────────');
    for (const m of plan.missing) line(`  ${m.required ? '[必交缺失]' : '[占位/待补]'} ${m.packagePath}  ← ${m.source}（${m.note}）`);
    line('');
  }
  if (warnings.length) {
    line('─ 提醒 ────────────────────────────────────────────');
    for (const w of warnings) line(`  · ${w.message}`);
    line('');
  }
  if (anonymity.hits.length) {
    line('─ 敏感词命中 ──────────────────────────────────────');
    for (const h of anonymity.hits.slice(0, 20)) {
      line(`  [${h.tier}] ${h.packagePath}${h.line ? `:${h.line}` : ''}  «${h.term}»  ${h.snippet}`);
    }
    if (anonymity.hits.length > 20) line(`  … 其余 ${anonymity.hits.length - 20} 条见 manifest`);
    line('');
  }
  if (anonymity.exempted.length) {
    line('─ 已声明豁免 ──────────────────────────────────────');
    for (const h of anonymity.exempted) line(`  ${h.packagePath}${h.line ? `:${h.line}` : ''}  «${h.term}»  理由：${h.exemptionReason}`);
    line('');
  }
  line(`结论：${!ok ? '打包失败' : submissionReady ? '可交（无阻断项）' : '打包完成，但仍有阻断项，不能直接交'}${blockers.length ? `；${blockers.length} 项待办：` : ''}`);
  for (const b of blockers) line(`  ✗ ${b}`);
  line(`manifest：${path.relative(ROOT, opt.manifest).split(path.sep).join('/')}`);
  line(`退出码：${exitCode}（0=可交 / 2=已出包但有阻断项 / 1=失败）`);
  line('');

  process.exit(exitCode);
}

main();
