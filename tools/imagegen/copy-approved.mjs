#!/usr/bin/env node
/**
 * copy-approved.mjs —— 把 VLM 判定为 pass 的图从 D 盘工作目录拷回 public/art/，并生成集成用清单。
 *
 * 用法（在项目根 frontend/2026数字媒体 下）：
 *   node tools/imagegen/copy-approved.mjs \
 *     --report tools/imagegen/out-art/reports/fallback-batch.json \
 *     --src "D:/AI大模型/art-work" \
 *     --dest public/art \
 *     --index public/art/index.json
 *
 * 行为：
 *   - 读 vl_score.py 的批次报告 JSON（items[] 里有 id / image / category / verdict / scores / flags）
 *   - 默认只拷 verdict=pass 的图（可用 --verdicts pass,retry 覆盖）
 *   - 拷 <id>.jpg 与同名 .json（json 里已含 gen 参数 + vl 评分块）
 *   - 生成 index 清单（给 Lead 集成用）：id → 文件路径 / 分类 / 尺寸 / 判定 / 四维分
 *   - --dry-run 只打印不落盘
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..", "..");

function parseArgs(argv) {
  const out = {
    report: "tools/imagegen/out-art/reports/fallback-batch.json",
    src: "D:/AI大模型/art-work",
    dest: "public/art",
    index: "public/art/index.json",
    verdicts: ["pass"],
    dryRun: false,
    overwrite: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") out.report = argv[++i];
    else if (a === "--src") out.src = argv[++i];
    else if (a === "--dest") out.dest = argv[++i];
    else if (a === "--index") out.index = argv[++i];
    else if (a === "--verdicts") out.verdicts = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-overwrite") out.overwrite = false;
    else if (a === "--help" || a === "-h") {
      console.log("用法: node tools/imagegen/copy-approved.mjs --report <vl报告.json> [--src D:/AI大模型/art-work] [--dest public/art] [--index public/art/index.json] [--verdicts pass,retry] [--dry-run]");
      process.exit(0);
    } else {
      console.error(`[fatal] 未知参数: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function abs(p) {
  if (path.isAbsolute(p)) return p;
  // 先按当前工作目录解析（在项目根运行：public/art、tools/...）；不存在再退回项目根
  const fromCwd = path.resolve(process.cwd(), p);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromProj = path.resolve(PROJ, p);
  return fs.existsSync(fromProj) ? fromProj : fromCwd;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function basenameOf(imagePath) {
  if (!imagePath) return null;
  const norm = String(imagePath).replace(/\\/g, "/");
  return norm.split("/").pop();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = abs(args.report);
  if (!fs.existsSync(reportPath)) {
    console.error(`[fatal] 找不到 QA 报告: ${reportPath}`);
    process.exit(2);
  }
  const report = readJson(reportPath);
  const items = Array.isArray(report.items) ? report.items : [];
  const srcDir = abs(args.src);
  const destDir = abs(args.dest);
  const indexAbs = abs(args.index);
  if (!fs.existsSync(srcDir)) {
    console.error(`[fatal] 源目录不存在: ${srcDir}`);
    process.exit(2);
  }

  const chosen = items.filter((it) => args.verdicts.includes(it.verdict));
  const skipped = items.filter((it) => !args.verdicts.includes(it.verdict));

  console.log(`[plan] QA 报告: ${reportPath}`);
  console.log(`[plan] 总 ${items.length} 张；要拷贝（${args.verdicts.join("/")}）${chosen.length} 张；跳过 ${skipped.length} 张`);
  console.log(`[plan] ${srcDir} -> ${destDir}`);
  if (!chosen.length) {
    console.log("[done] 没有要拷贝的图");
    return;
  }
  if (!args.dryRun) fs.mkdirSync(destDir, { recursive: true });

  const index = [];
  const problems = [];
  for (const it of chosen) {
    const base = basenameOf(it.image) || `${it.id}.jpg`;
    const id = it.id || path.basename(base, path.extname(base));
    const srcImg = path.join(srcDir, base);
    const srcJson = path.join(srcDir, path.basename(base, path.extname(base)) + ".json");
    if (!fs.existsSync(srcImg)) {
      problems.push(`${id}: 源图缺失 ${srcImg}`);
      continue;
    }
    const dstImg = path.join(destDir, `${id}.jpg`);
    const dstJson = path.join(destDir, `${id}.json`);
    if (args.dryRun) {
      console.log(`  [dry] ${id} <- ${path.basename(srcImg)}`);
    } else {
      if (!args.overwrite && fs.existsSync(dstImg)) {
        problems.push(`${id}: 目标已存在（--no-overwrite）`);
        continue;
      }
      fs.copyFileSync(srcImg, dstImg);
      if (fs.existsSync(srcJson)) fs.copyFileSync(srcJson, dstJson);
      else problems.push(`${id}: 源 json 缺失（图片已拷）`);
    }
    const sc = it.scores || {};
    index.push({
      id,
      category: it.category || "unknown",
      file: path.relative(PROJ, dstImg).replace(/\\/g, "/"),
      url: "/" + path.relative(path.resolve(PROJ, "public"), dstImg).replace(/\\/g, "/"),
      width: it.width ?? null,
      height: it.height ?? null,
      verdict: it.verdict,
      scores: {
        prompt_fit: sc.prompt_fit ?? null,
        period_fit: sc.period_fit ?? null,
        cleanliness: sc.cleanliness ?? null,
        safety: sc.safety ?? null,
      },
    });
  }

  let indexPath = null;
  if (!args.dryRun && index.length) {
    fs.mkdirSync(path.dirname(indexAbs), { recursive: true });
    // 合并已有 index（重跑增量拷贝时不丢旧条目）
    let merged = { generated_at: new Date().toISOString(), count: 0, items: [] };
    if (fs.existsSync(indexAbs)) {
      try {
        const old = readJson(indexAbs);
        if (Array.isArray(old.items)) merged.items = old.items;
      } catch { /* ignore */ }
    }
    const byId = new Map(merged.items.map((x) => [x.id, x]));
    for (const e of index) byId.set(e.id, e);
    merged.items = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    merged.count = merged.items.length;
    merged.generated_at = new Date().toISOString();
    merged.qa_report = path.relative(PROJ, reportPath).replace(/\\/g, "/");
    fs.writeFileSync(indexAbs, JSON.stringify(merged, null, 2), "utf8");
    indexPath = indexAbs;
  }

  const byCat = {};
  for (const e of index) byCat[e.category] = (byCat[e.category] || 0) + 1;
  console.log(`\n[done] 拷贝 ${index.length} 张${args.dryRun ? "（dry-run 未落盘）" : ""}`);
  console.log(`[done] 分类分布: ${Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (indexPath) console.log(`[done] index -> ${indexPath}（累计 ${index.length} 条更新）`);
  if (problems.length) {
    console.log(`[warn] ${problems.length} 个问题:`);
    for (const p of problems.slice(0, 20)) console.log(`   - ${p}`);
  }
}

main();
