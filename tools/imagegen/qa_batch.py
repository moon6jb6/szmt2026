#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 vl_score.py 的批次报告变成可执行的三件套：
  1) attempt 台账（每张图被生成/重生成了几次、seed、分数、判定）
  2) 下一轮 retry 批次 json（换 seed，直接喂 gen.py --batch；Lead 执行）
  3) 批次 QA markdown（给 Lead 看的通过率/失败类型/retry 清单）

用法（在 tools/imagegen 目录下）：
    python qa_batch.py \
        --report out-art/reports/pilot-001-a1.json \
        --batch ../../docs/art/batches/pilot-001.json \
        --tag pilot-001-a1 \
        --retry-out out-art/reports/retry-pilot-001-a1.json \
        --md-out out-art/reports/pilot-001-a1-qa.md

规则（按任务书）：
- pass  → 记入通过
- retry → 换 seed 重生成；同一 id 最多 3 次尝试（首轮 + 2 次 retry）
- reject/error → reject 记录后跳过；error 只重评分不重生成
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
MAX_ATTEMPTS = 3  # 首轮 + 最多 2 次 retry


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj):
    path = path if os.path.isabs(path) else os.path.join(os.getcwd(), path)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
    return path


def load_state(path):
    if path and os.path.isfile(path):
        try:
            st = read_json(path)
            st.setdefault("version", 1)
            st.setdefault("ids", {})
            st.setdefault("batches", {})
            return st
        except Exception:
            pass
    return {"version": 1, "ids": {}, "batches": {}}


def next_seed(old_seed, attempt):
    """确定性换 seed（可复现）：LCG 混合，避免与原 seed 相同。"""
    try:
        old = int(old_seed)
    except (TypeError, ValueError):
        old = 1937
    s = (old * 1103515245 + 12345 + attempt * 7919) & 0x7FFFFFFF
    s = s % (2 ** 31 - 2) + 1
    if s == old:
        s = (s + 104729) % (2 ** 31 - 2) + 1
    return s


def sibling_seed(image_rel):
    """从图片同名 json 读实际使用的 seed（读不到就用 batch 里的）。"""
    if not image_rel:
        return None
    base = os.path.splitext(os.path.join(PROJ, image_rel))[0]
    for cand in (base + ".json",):
        if os.path.isfile(cand):
            try:
                return read_json(cand).get("seed")
            except Exception:
                return None
    return None


def fmt_scores(scores):
    if not scores:
        return "-/-/-/-"
    return "/".join(str(scores.get(k, "-")) for k in ("prompt_fit", "period_fit", "cleanliness", "safety"))


def main(argv=None):
    ap = argparse.ArgumentParser(description="批次 QA → retry 批次 + 台账 + markdown")
    ap.add_argument("--report", required=True, help="vl_score.py 输出的批次报告 json")
    ap.add_argument("--batch", required=True, help="该批次生成用的 gen.py batch json（取 prompt/negative/尺寸/out）")
    ap.add_argument("--tag", required=True, help="本轮标签，如 pilot-001-a1 / retry-batch-001-r1")
    ap.add_argument("--state", default="out-art/qa_state.json")
    ap.add_argument("--retry-out", default=None, help="输出 retry batch json（默认 out-art/reports/retry-<tag>.json）")
    ap.add_argument("--md-out", default=None, help="输出批次 QA markdown（默认 out-art/reports/<tag>-qa.md）")
    ap.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS)
    args = ap.parse_args(argv)

    report = read_json(args.report)
    batch = read_json(args.batch)
    batch_by_id = {}
    for e in batch:
        if not isinstance(e, dict):
            continue
        bid = e.get("id")
        if not bid and e.get("out"):
            # gen 批次可能没有 id 字段：用输出文件名（如 scene-001.jpg）当 id
            bid = os.path.splitext(os.path.basename(str(e["out"]).replace("\\", "/")))[0]
        if bid:
            batch_by_id[bid] = e

    state = load_state(args.state)
    tag = args.tag
    prev = state["batches"].get(tag, {})
    if prev.get("applied"):
        print(f"[warn] tag {tag} 已入账过一次，仍继续（重复运行会重复记 attempt）", flush=True)

    items = report.get("items", [])
    summary = report.get("summary", {})

    retry_entries, retry_rows = [], []
    reject_rows, pass_rows, error_rows = [], [], []
    missing_meta = []

    for item in items:
        item_id = item["id"]
        verdict = item.get("verdict", "error")
        scores = item.get("scores") or {}
        fail_types = item.get("fail_types") or []
        st = state["ids"].setdefault(item_id, {
            "category": item.get("category"),
            "first_batch": tag,
            "attempts": [],
        })
        st["category"] = st.get("category") or item.get("category")

        # 记录 attempt（按 tag 幂等）
        attempt_entry = {
            "tag": tag,
            "verdict": verdict,
            "scores": scores,
            "fail_types": fail_types,
            "seed": None,
        }
        entry = batch_by_id.get(item_id)
        seed_hint = (entry or {}).get("seed")
        actual_seed = sibling_seed(item.get("image"))
        attempt_entry["seed"] = actual_seed if actual_seed is not None else seed_hint
        if not any(a.get("tag") == tag for a in st["attempts"]):
            st["attempts"].append(attempt_entry)
        attempts = len(st["attempts"])

        row = {
            "id": item_id,
            "category": item.get("category", "?"),
            "scores": fmt_scores(scores),
            "verdict": verdict,
            "fail_types": fail_types,
            "attempts": attempts,
            "image": item.get("image"),
            "seed": attempt_entry["seed"],
        }

        if verdict == "pass":
            pass_rows.append(row)
        elif verdict == "retry":
            if attempts >= args.max_attempts:
                row["note"] = f"已达最大尝试次数 {attempts}，停止重生成，按 reject 记录"
                reject_rows.append(row)
            elif entry is None:
                missing_meta.append(item_id)
                row["note"] = "batch json 里找不到该 id，无法换 seed 重生成"
                reject_rows.append(row)
            else:
                old_seed = attempt_entry["seed"] if attempt_entry["seed"] is not None else entry.get("seed")
                row["old_seed"] = old_seed
                row["new_seed"] = next_seed(old_seed, attempts + 1)
                retry_rows.append(row)
                new_entry = dict(entry)
                new_entry["seed"] = row["new_seed"]
                new_entry["retry_round"] = attempts  # 这是第几次重生成（1=第一次 retry）
                new_entry["retry_of_seed"] = old_seed
                new_entry["retry_tag"] = tag
                retry_entries.append(new_entry)
        elif verdict == "reject":
            reject_rows.append(row)
        else:  # error：解析失败，只需重评分
            error_rows.append(row)

    # ---- 写 retry batch ----
    retry_out = args.retry_out or os.path.join("out-art", "reports", f"retry-{tag}.json")
    if retry_entries:
        retry_path = write_json(retry_out, retry_entries)
    else:
        retry_path = None

    # ---- 写 markdown ----
    md_out = args.md_out or os.path.join("out-art", "reports", f"{tag}-qa.md")
    total = len(items)
    n_pass = len(pass_rows)
    n_retry = len(retry_rows)
    n_reject = len(reject_rows)
    n_error = len(error_rows)
    scored = total - n_error
    pass_rate = (n_pass / scored * 100) if scored else 0.0
    fail_dist = summary.get("fail_types") or {}
    mean = summary.get("mean_scores") or {}

    lines = []
    lines.append(f"# 图片质检 · {tag}\n")
    lines.append(f"- 模型：{report.get('model', '?')}；加载 {report.get('load_s', '?')}s；"
                 f"本批评分耗时 {report.get('wall_s', '?')}s")
    lines.append(f"- 评分张数：{total}；**pass {n_pass} / retry {n_retry} / reject {n_reject} / error {n_error}**")
    lines.append(f"- **通过率（pass/已评分）**：{pass_rate:.1f}%")
    lines.append(f"- 四维均分：prompt {mean.get('prompt_fit', '?')} / period {mean.get('period_fit', '?')} / "
                 f"clean {mean.get('cleanliness', '?')} / safety {mean.get('safety', '?')}")
    if fail_dist:
        lines.append("- 失败类型分布：" + "，".join(f"{k}×{v}" for k, v in fail_dist.items()))
    lines.append("")
    if retry_rows:
        lines.append(f"## 需要重生成 retry（{len(retry_rows)} 张，seed 已换好，直接 `gen.py --batch {retry_path}`）\n")
        lines.append("| id | 类别 | 四维分 | 失败类型 | 已尝试 | 旧 seed | 新 seed |")
        lines.append("|---|---|---|---|---|---|---|")
        for r in retry_rows:
            lines.append(f"| {r['id']} | {r['category']} | {r['scores']} | {','.join(r['fail_types'])} | "
                         f"{r['attempts']} | {r['old_seed']} | {r['new_seed']} |")
        lines.append("")
    if reject_rows:
        lines.append(f"## reject / 停止重生成（{len(reject_rows)} 张，记录并跳过）\n")
        lines.append("| id | 类别 | 四维分 | 失败类型 | 已尝试 | 备注 |")
        lines.append("|---|---|---|---|---|---|")
        for r in reject_rows:
            lines.append(f"| {r['id']} | {r['category']} | {r['scores']} | {','.join(r['fail_types'])} | "
                         f"{r['attempts']} | {r.get('note', '')} |")
        lines.append("")
    if error_rows:
        lines.append(f"## error（{len(error_rows)} 张，模型输出解析失败，只需重评分）\n")
        for r in error_rows:
            lines.append(f"- {r['id']}：{','.join(r['fail_types'])}")
        lines.append("")
    if pass_rows:
        lines.append(f"## pass（{n_pass} 张，明细）\n")
        lines.append("| id | 四维分 |")
        lines.append("|---|---|")
        for r in pass_rows:
            lines.append(f"| {r['id']} | {r['scores']} |")
        lines.append("")

    md_out_abs = os.path.abspath(md_out)  # 与 --retry-out / --state 一致：相对 CWD（通常在 tools/imagegen）
    os.makedirs(os.path.dirname(md_out_abs), exist_ok=True)
    with open(md_out_abs, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    # ---- 更新 state ----
    state["batches"][tag] = {
        "report": os.path.basename(args.report),
        "batch": os.path.basename(args.batch),
        "total": total, "pass": n_pass, "retry": n_retry, "reject": n_reject, "error": n_error,
        "pass_rate": round(pass_rate, 2),
        "retry_out": os.path.basename(retry_path) if retry_path else None,
        "applied": True,
    }
    state_path = write_json(args.state, state)

    # ---- 打印 ----
    print(f"[qa] {tag}: total={total} pass={n_pass} retry={n_retry} reject={n_reject} error={n_error} "
          f"pass_rate={pass_rate:.1f}%", flush=True)
    print(f"[qa] retry batch -> {retry_path if retry_path else '(none)'}", flush=True)
    print(f"[qa] markdown    -> {md_out_abs}", flush=True)
    print(f"[qa] state       -> {state_path}", flush=True)
    if retry_rows:
        print("\nretry 清单（id / 旧seed -> 新seed / 失败类型）:", flush=True)
        for r in retry_rows:
            print(f"  {r['id']:<14} {r['old_seed']} -> {r['new_seed']}  [{','.join(r['fail_types'])}]", flush=True)
    if reject_rows:
        print("\nreject/停止 清单:", flush=True)
        for r in reject_rows:
            print(f"  {r['id']:<14} [{','.join(r['fail_types'])}] {r.get('note', '')}", flush=True)
    if missing_meta:
        print(f"\n[warn] batch json 缺这些 id 的元数据（无法换 seed）：{missing_meta}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
