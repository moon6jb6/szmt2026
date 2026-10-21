#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""《把名字留下来》图片质检器 —— 本地 Qwen3-VL-2B-Instruct 逐张打分。

四个 0—5 维度：
    prompt_fit   prompt 符合度（图是否呈现提示词里的关键物件/场景/构图）
    period_fit   时代准确性（是否像 1930 年代中国/上海；现代物直接低分）
    cleanliness  画面瑕疵（5=干净；模糊/崩坏/畸形/伪影扣分）
    safety       危险元素（5=无；人脸/文字/现代物/错旗/血腥扣分）

输出判定 pass / retry / reject：
    pass   = 四维全部过线，且无硬性危险元素
    retry  = 有可救项（分数中等或单个危险元素）→ 换 seed 重生成
    reject = 主题/年代/安全严重崩坏或涉及红线 → 记录并跳过

用法：
    # A. 按 glob 扫图（prompt 从同名 .json 读取；适合 public/bg、public/art）
    python vl_score.py --images "public/bg/*.jpg" --out tools/imagegen/vl_calib.json --merge

    # B. 按 manifest + 出图目录（适合主循环，每批 50 张）
    python vl_score.py --manifest docs/art/image-manifest.json --images-dir public/art \
        --limit 50 --ids-out tools/imagegen/batch_queue.json --merge

    # C. 按 gen.py 的 batch json（items 含 out 路径）
    python vl_score.py --batch tools/imagegen/batch-001.json --merge

设计要点：
- 模型只加载一次，逐张推理；单张约 2—4s（RTX 5070 Laptop，bf16）。
- --merge 把评分写进图片同名 .json 的 "vl" 字段（gen.py 已写入 prompt/seed/耗时，合并保留）。
- 每张输出 JSON 判定；--quarantine 目录按 verdict 复制副本便于人工抽查。
- 环境变量默认离线，绝不联网下载模型。
"""
import argparse
import glob
import json
import os
import re
import shutil
import sys
import time

# ---- 必须在 import transformers 之前设置 ----
os.environ.setdefault("HF_HOME", r"D:\AI大模型\hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

DEFAULT_MODEL = r"C:\Users\26298\OneDrive\Desktop\AI大模型\Qwen3-VL-2B-Instruct"
MODEL_TAG = "Qwen3-VL-2B-Instruct (bf16, local)"

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))  # .../2026数字媒体


def _safe_rel(p, base=None):
    """相对项目根的展示路径；跨盘（D: 图 vs C: 项目）时 os.path.relpath 会抛 ValueError，回退绝对路径。"""
    base = base or PROJ
    try:
        return os.path.relpath(p, base).replace("\\", "/")
    except ValueError:
        return os.path.abspath(p).replace("\\", "/")

CATEGORIES = ("scene", "moment", "artifact", "figure", "ending", "ui", "atmo")
# 允许纸面墨迹/字迹纹理的类别（但清晰可读文字仍然不许）
TEXT_TEXTURE_OK = {"artifact", "ui"}
# 允许人物剪影/背影的类别
SILHOUETTE_OK = {"figure"}

CATEGORY_CN = {
    "scene": "场景插画", "moment": "关键瞬间", "artifact": "文物档案",
    "figure": "人物剪影", "ending": "结局插画", "ui": "界面与纹理",
    "atmo": "氛围空镜", "unknown": "未知类别",
}

# 默认判定阈值（可在命令行覆盖；标定后写死为默认值）
DEFAULT_MIN = {"prompt_fit": 3, "period_fit": 3, "cleanliness": 3, "safety": 4}
REJECT_SCORE = 1  # 任一维度 <= 该值 → reject


# --------------------------------------------------------------------------- #
# 任务收集
# --------------------------------------------------------------------------- #
def cat_of(item_id):
    """从 id / 文件名前缀猜类别，如 scene-001 → scene。"""
    if not item_id:
        return "unknown"
    base = os.path.basename(str(item_id))
    for cat in CATEGORIES:
        if base == cat or base.startswith(cat + "-") or base.startswith(cat + "_"):
            return cat
    return "unknown"


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def sibling_meta(image_path):
    """读图片同名 .json（gen.py / 上一轮 vl_score 写的），找不到返回 {}。"""
    base, _ext = os.path.splitext(image_path)
    for cand in (base + ".json", base + ".JSON"):
        if os.path.isfile(cand):
            try:
                return read_json(cand)
            except Exception:
                return {}
    return {}


def normalize_category(raw, item_id, image_path, default="unknown"):
    if raw in CATEGORIES:
        return raw
    guessed = cat_of(item_id or os.path.basename(image_path))
    return guessed if guessed != "unknown" else default


def expand_image_patterns(patterns):
    """支持 glob、目录、单文件；不存在的路径记录警告。"""
    found = []
    for pat in patterns:
        if os.path.isdir(pat):
            for ext in ("jpg", "jpeg", "png", "webp"):
                found.extend(sorted(glob.glob(os.path.join(pat, "*." + ext))))
                found.extend(sorted(glob.glob(os.path.join(pat, "*." + ext.upper()))))
        else:
            hits = glob.glob(pat)
            if hits:
                found.extend(sorted(hits))
            elif os.path.isfile(pat):
                found.append(pat)
            else:
                print(f"[warn] 无匹配: {pat}", flush=True)
    # 去重保持顺序
    seen, out = set(), []
    for p in found:
        ap = os.path.abspath(p)
        if ap not in seen and os.path.isfile(ap):
            seen.add(ap)
            out.append(ap)
    return out


def resolve_image_path(val, bases):
    """把 json 里的图片路径字段解析成存在的绝对路径。
    兼容三种写法：绝对路径 / 相对项目根的 'public/art/x.jpg' / 相对 gen.py CWD 的 '../../public/art/x.jpg'。
    """
    if not val:
        return None
    if os.path.isabs(val):
        return val if os.path.isfile(val) else None
    for base in list(bases) + [PROJ, os.path.join(PROJ, "public", "art"),
                               os.path.join(PROJ, "tools", "imagegen"), os.getcwd()]:
        if not base:
            continue
        p = os.path.normpath(os.path.join(base, val))
        if os.path.isfile(p):
            return os.path.abspath(p)
    if os.path.isfile(val):
        return os.path.abspath(val)
    return None


def image_from_manifest_entry(entry, images_dir, extra_bases=(), image_exts=(".jpg", ".jpeg", ".png", ".webp")):
    """manifest/batch 条目 → 图片绝对路径。支持 image/out/path/file/filename 字段或 id 推导。"""
    bases = [images_dir] + list(extra_bases)
    for key in ("image", "out", "path", "file", "filename"):
        ap = resolve_image_path(entry.get(key), bases)
        if ap:
            return ap
    item_id = entry.get("id")
    if item_id:
        id_bases = [images_dir] if images_dir else []
        id_bases += [os.path.join(PROJ, "public", "art")]
        for base in id_bases:
            for ext in image_exts:
                cand = os.path.join(base, str(item_id) + ext)
                if os.path.isfile(cand):
                    return os.path.abspath(cand)
    return None


def collect_jobs(args):
    jobs = []  # [{image, prompt, category, id}]
    images_dir = os.path.abspath(args.images_dir) if args.images_dir else None

    # A. --images glob
    if args.images:
        for ap in expand_image_patterns(args.images):
            meta = sibling_meta(ap)
            prompt = meta.get("prompt") or meta.get("prompt_raw") or ""
            item_id = meta.get("id") or os.path.splitext(os.path.basename(ap))[0]
            jobs.append({
                "image": ap,
                "prompt": prompt,
                "category": normalize_category(meta.get("category"), item_id, ap, args.default_category),
                "id": item_id,
                "source": "images",
            })

    # B. --manifest + --images-dir
    if args.manifest:
        data = read_json(args.manifest)
        entries = data.get("items", data) if isinstance(data, dict) else data
        if not isinstance(entries, list):
            raise SystemExit(f"[fatal] manifest 不是数组: {args.manifest}")
        for entry in entries:
            if isinstance(entry, str):
                entry = {"id": entry, "prompt": ""}
            ap = image_from_manifest_entry(entry, images_dir, extra_bases=[os.getcwd()])
            if not ap:
                continue
            meta = sibling_meta(ap)
            prompt = (entry.get("prompt") or (meta or {}).get("prompt")
                      or (meta or {}).get("prompt_raw") or "")
            item_id = entry.get("id") or os.path.splitext(os.path.basename(ap))[0]
            jobs.append({
                "image": ap,
                "prompt": prompt,
                "category": normalize_category(entry.get("category"), item_id, ap, args.default_category),
                "id": item_id,
                "source": "manifest",
                "width": entry.get("width"),
                "height": entry.get("height"),
            })

    # C. --batch（gen.py batch json 或 [{image}]）
    if args.batch:
        data = read_json(args.batch)
        if not isinstance(data, list):
            raise SystemExit(f"[fatal] batch 不是数组: {args.batch}")
        batch_dir = os.path.dirname(os.path.abspath(args.batch))
        for i, entry in enumerate(data):
            if isinstance(entry, str):
                entry = {"image": entry}
            ap = image_from_manifest_entry(entry, images_dir or batch_dir,
                                           extra_bases=[batch_dir, os.getcwd()])
            if not ap:
                print(f"[warn] batch #{i} 图片尚未生成，跳过: id={entry.get('id')}", flush=True)
                continue
            meta = sibling_meta(ap)
            prompt = entry.get("prompt") or (meta or {}).get("prompt") or (meta or {}).get("prompt_raw") or ""
            item_id = entry.get("id") or os.path.splitext(os.path.basename(ap))[0]
            jobs.append({
                "image": ap,
                "prompt": prompt,
                "category": normalize_category(entry.get("category"), item_id, ap, args.default_category),
                "id": item_id,
                "source": "batch",
            })

    # 过滤
    if args.only:
        wanted = [x.strip() for x in args.only.split(",") if x.strip()]
        jobs = [j for j in jobs if any(w in j["id"] for w in wanted)
                or any(w == j["category"] for w in wanted)]
    if args.resume:
        # 已在同名 json 里有 vl 评分的跳过
        kept = []
        for j in jobs:
            if args.merge and sibling_meta(j["image"]).get("vl"):
                continue
            kept.append(j)
        jobs = kept
    # 去重
    seen, uniq = set(), []
    for j in jobs:
        if j["image"] in seen:
            continue
        seen.add(j["image"])
        uniq.append(j)
    jobs = uniq
    if args.limit:
        jobs = jobs[: args.limit]
    return jobs


# --------------------------------------------------------------------------- #
# 评分提示词
# --------------------------------------------------------------------------- #
def category_note(cat):
    if cat in TEXT_TEXTURE_OK:
        return ("【本类别特别说明】本类图允许出现纸面墨迹、模糊字迹或印刷纹理（如名册页、家书、报纸、"
                "纸张纹理），但文字必须虚焦、不可读：text_legible=true 仍按危险元素处理。")
    if cat in SILHOUETTE_OK:
        return ("【本类别特别说明】本类图允许出现人物剪影或背影，但面孔不可辨认；"
                "faces=clear（清晰可辨的面孔/五官）仍按严重危险处理。")
    return "【本类别特别说明】本类图禁止出现任何人物、清晰文字/字母/汉字、现代物品。"


SCORE_TEMPLATE = """你是历史题材游戏《把名字留下来》的图片质检员。图片由 SDXL 生成，用于 1937 年淞沪会战·四行仓库题材的 2.5D 叙事游戏背景/插画。请先仔细看图，再对照【生成提示词】逐项严格打分——不放水，也不吹毛求疵。

【类别】{category_cn}
【生成提示词】{prompt}

请按以下四个维度各给一个 0—5 的整数分（5 最好）：
- prompt_fit：图片是否呈现提示词里的关键物件、场景与构图（5=关键元素基本齐全，0=完全无关）。
- period_fit：是否像 1930 年代中国/上海的历史场景（5=完全可信；出现现代高楼、霓虹、汽车、塑料、现代设施 → 最多 2 分）。
- cleanliness：画面质量（5=清晰锐利无明显瑕疵；模糊、jpeg 伪影、结构崩坏、透视错乱、纹理重复、色带、鬼影、畸形 → 扣分）。
- safety：无危险元素程度（5=完全没有；0=大量）。危险元素包括：清晰可辨的人脸/人像、任何文字字母汉字（招牌、报纸、水印、签名）、现代物品、旗帜图案明显错误（如星条旗）、血腥或暴行细节。纯黑剪影/背影不算危险。

{category_note}

请再判断以下布尔项（true=存在）：
- faces："none" 无人 / "silhouette" 仅剪影或背影 / "clear" 有清晰面孔
- text_any：画面里是否存在任何文字或文字状符号
- text_legible：文字是否清晰可读（哪怕一个字母/汉字）
- modern_objects：是否有现代物品（汽车、现代高楼、霓虹、塑料、现代路牌等）
- flag_error：旗帜图案是否明显错误（星条旗、乱画旗面等）
- gore：是否有血腥/暴行细节
- danger_notes：危险元素的具体位置与内容，简短中文；没有则空字符串
- reason：一句话总评（不超过 40 字）

只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字：
{"prompt_fit":0,"period_fit":0,"cleanliness":0,"safety":0,"faces":"none","text_any":false,"text_legible":false,"modern_objects":false,"flag_error":false,"gore":false,"danger_notes":"","reason":""}"""


# --------------------------------------------------------------------------- #
# 模型
# --------------------------------------------------------------------------- #
def build_model(args):
    import torch
    from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

    t0 = time.perf_counter()
    print(f"[load] {args.model_dir}", flush=True)
    processor = AutoProcessor.from_pretrained(args.model_dir, local_files_only=True)
    dtype = torch.float32 if args.cpu else torch.bfloat16
    kwargs = dict(dtype=dtype, local_files_only=True)
    if args.cpu:
        kwargs["device_map"] = "cpu"
    else:
        kwargs["device_map"] = "cuda"
    model = Qwen3VLForConditionalGeneration.from_pretrained(args.model_dir, **kwargs).eval()
    load_s = time.perf_counter() - t0
    device = "cpu" if args.cpu else f"cuda:{torch.cuda.current_device()}"
    vram = ""
    if not args.cpu:
        vram = f" vram={torch.cuda.memory_allocated() / (1024 ** 3):.2f}GiB"
    print(f"[load] done in {load_s:.2f}s device={device}{vram}", flush=True)
    return processor, model, load_s


# --------------------------------------------------------------------------- #
# 解析 / 判定
# --------------------------------------------------------------------------- #
def extract_json(text):
    """从模型输出里抠出第一个合法 JSON 对象。"""
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except Exception:
        pass
    start = t.find("{")
    while start >= 0:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(t)):
            c = t[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(t[start:i + 1])
                        except Exception:
                            break
        start = t.find("{", start + 1)
    return None


def as_score(obj, key):
    try:
        v = float(obj.get(key))
    except (TypeError, ValueError):
        return None
    return max(0, min(5, int(round(v))))


def as_bool(obj, key):
    v = obj.get(key)
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in ("true", "yes", "1", "是", "有")
    return None


def normalize_faces(obj):
    v = obj.get("faces")
    if isinstance(v, bool):
        return "clear" if v else "none"
    s = str(v or "").strip().lower()
    if s in ("clear", "face", "visible", "true", "yes", "清晰", "有"):
        return "clear"
    if s in ("silhouette", "back", "剪影", "背影"):
        return "silhouette"
    if s in ("none", "no", "false", "无", ""):
        return "none"
    return "none"


def decide(scores, flags, cat, mins):
    """返回 (verdict, fail_types list, reasons list)。"""
    reasons, fail = [], []
    hard = 0
    if flags["faces"] == "clear":
        hard += 2
        fail.append("faces")
        reasons.append("有清晰面孔")
    if flags["text_legible"]:
        hard += 2
        fail.append("text_legible")
        reasons.append("有可读文字")
    if flags["modern_objects"]:
        hard += 2
        fail.append("modern_objects")
        reasons.append("出现现代物品")
    if flags["flag_error"]:
        hard += 2
        fail.append("flag_error")
        reasons.append("旗帜图案错误")
    if flags["gore"]:
        return "reject", ["gore"], ["血腥/暴行细节（红线）"]

    if flags["text_any"] and cat not in TEXT_TEXTURE_OK:
        hard += 1
        fail.append("text_any")
        reasons.append("出现文字/文字状符号")

    low = [k for k in ("prompt_fit", "period_fit", "cleanliness", "safety")
           if scores.get(k) is not None and scores[k] <= REJECT_SCORE]
    if low:
        for k in low:
            fail.append(k + "_low")
        reasons.append("严重崩坏: " + "/".join(f"{k}={scores[k]}" for k in low))
        return "reject", fail, reasons

    # 主题与提示词完全脱节，且时代/安全也差 → reject（重生成意义不大）
    if (scores.get("prompt_fit") is not None and scores["prompt_fit"] <= 1
            and scores.get("period_fit") is not None and scores["period_fit"] <= 2):
        return "reject", fail + ["prompt_fit_low", "period_fit_low"], reasons + ["主题脱节且年代错误"]

    if hard >= 4:
        return "reject", fail, reasons + ["多个硬性危险元素"]

    below = []
    for k, mn in mins.items():
        if scores.get(k) is not None and scores[k] < mn:
            below.append(k)
            fail.append(k + "_low")
            reasons.append(f"{k}={scores[k]}<{mn}")
    if hard == 0 and not below:
        return "pass", fail, reasons
    return "retry", fail, reasons


# --------------------------------------------------------------------------- #
# 单张评分
# --------------------------------------------------------------------------- #
def score_one(processor, model, job, args):
    import torch
    from PIL import Image

    image = Image.open(job["image"]).convert("RGB")
    orig_w, orig_h = image.size
    if args.max_side:
        w, h = image.size
        if max(w, h) > args.max_side:
            scale = args.max_side / float(max(w, h))
            image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    cat = job["category"]
    prompt = (job.get("prompt") or "").strip() or "（无提示词，只做通用画面/年代/危险元素检查）"
    # 注意：SCORE_TEMPLATE 里含 JSON 花括号，不能用 str.format，改用 replace 占位
    text = (SCORE_TEMPLATE
            .replace("{category_cn}", CATEGORY_CN.get(cat, cat))
            .replace("{category_note}", category_note(cat))
            .replace("{prompt}", prompt))
    messages = [{
        "role": "user",
        "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": text},
        ],
    }]
    inputs = processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True,
        return_dict=True, return_tensors="pt",
    )
    device = "cpu" if args.cpu else "cuda"
    inputs = inputs.to(device)

    t0 = time.perf_counter()
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=args.max_new_tokens, do_sample=False)
    elapsed = time.perf_counter() - t0
    answer = processor.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]

    obj = extract_json(answer)
    if obj is None:
        return {
            "scores": {}, "flags": {}, "verdict": "error",
            "fail_types": ["parse_error"], "reasons": ["模型输出无法解析为 JSON"],
            "raw": answer[:600], "elapsed_s": round(elapsed, 3),
            "width": orig_w, "height": orig_h,
        }

    scores = {k: as_score(obj, k) for k in ("prompt_fit", "period_fit", "cleanliness", "safety")}
    missing = [k for k, v in scores.items() if v is None]
    flags = {
        "faces": normalize_faces(obj),
        "text_any": as_bool(obj, "text_any"),
        "text_legible": as_bool(obj, "text_legible"),
        "modern_objects": as_bool(obj, "modern_objects"),
        "flag_error": as_bool(obj, "flag_error"),
        "gore": as_bool(obj, "gore"),
        "danger_notes": str(obj.get("danger_notes") or "")[:200],
        "reason": str(obj.get("reason") or "")[:200],
    }
    if missing:
        return {
            "scores": scores, "flags": flags, "verdict": "error",
            "fail_types": ["missing_score:" + ",".join(missing)], "reasons": ["模型输出缺字段"],
            "raw": answer[:600], "elapsed_s": round(elapsed, 3),
            "width": orig_w, "height": orig_h,
        }

    mins = args.mins
    verdict, fail, reasons = decide(scores, flags, cat, mins)
    return {
        "scores": scores, "flags": flags, "verdict": verdict,
        "fail_types": fail, "reasons": reasons, "elapsed_s": round(elapsed, 3),
        "width": orig_w, "height": orig_h,
    }


# --------------------------------------------------------------------------- #
# 输出
# --------------------------------------------------------------------------- #
def merge_into_json(image_path, record, args):
    base, _ext = os.path.splitext(image_path)
    json_path = base + ".json"
    meta = {}
    if os.path.isfile(json_path):
        try:
            meta = read_json(json_path)
        except Exception:
            meta = {}
    meta.setdefault("output", os.path.basename(image_path))
    meta["vl"] = {
        "model": MODEL_TAG,
        "scores": record["scores"],
        "flags": record["flags"],
        "verdict": record["verdict"],
        "fail_types": record["fail_types"],
        "reasons": record["reasons"],
        "scored_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "thresholds": args.mins,
    }
    if record.get("raw"):
        meta["vl"]["raw_answer"] = record["raw"]
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)


def quarantine_copy(image_path, verdict, qdir):
    dst_dir = os.path.join(qdir, verdict)
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, os.path.basename(image_path))
    try:
        if os.path.abspath(image_path) != os.path.abspath(dst):
            shutil.copy2(image_path, dst)
    except Exception as exc:
        print(f"[warn] quarantine 复制失败: {exc}", flush=True)


def print_table(items):
    print("\n#  id                  类别      prompt period clean safe verdict fail", flush=True)
    print("-" * 96, flush=True)
    for i, it in enumerate(items, 1):
        s = it.get("scores") or {}
        fmt = lambda k: (s.get(k) if s.get(k) is not None else "-")
        print(f"{i:<3} {it['id'][:20]:<20} {it['category']:<8} "
              f"{fmt('prompt_fit'):^6} {fmt('period_fit'):^6} {fmt('cleanliness'):^6} {fmt('safety'):^6} "
              f"{it['verdict']:<7} {','.join(it.get('fail_types') or [])}", flush=True)


def build_summary(items):
    total = len(items)
    counts = {v: sum(1 for x in items if x["verdict"] == v) for v in ("pass", "retry", "reject", "error")}
    scored = total - counts["error"]
    pass_rate = (counts["pass"] / scored) if scored else 0.0
    mean = {}
    for k in ("prompt_fit", "period_fit", "cleanliness", "safety"):
        vals = [x["scores"][k] for x in items if x.get("scores") and x["scores"].get(k) is not None]
        mean[k] = round(sum(vals) / len(vals), 2) if vals else None
    fail_types = {}
    for x in items:
        for f in x.get("fail_types") or []:
            fail_types[f] = fail_types.get(f, 0) + 1
    return {
        "total": total,
        "scored": scored,
        "pass": counts["pass"],
        "retry": counts["retry"],
        "reject": counts["reject"],
        "error": counts["error"],
        "pass_rate": round(pass_rate, 4),
        "retry_rate": round(counts["retry"] / scored, 4) if scored else 0.0,
        "reject_rate": round(counts["reject"] / scored, 4) if scored else 0.0,
        "mean_scores": mean,
        "fail_types": dict(sorted(fail_types.items(), key=lambda kv: -kv[1])),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Qwen3-VL-2B 图片质检器（pass/retry/reject）")
    src = ap.add_argument_group("图片来源（至少给一个）")
    src.add_argument("--images", nargs="+", help="图片 glob/目录/文件，可多个")
    src.add_argument("--manifest", help="docs/art/image-manifest.json")
    src.add_argument("--images-dir", default="public/art", help="manifest 对应的出图目录")
    src.add_argument("--batch", help="gen.py 的 batch json（或 [{image}]）")
    ap.add_argument("--out", default="tools/imagegen/vl_report.json", help="汇总报告 JSON")
    ap.add_argument("--merge", action="store_true", help="把 vl 评分合并进图片同名 .json")
    ap.add_argument("--resume", action="store_true", help="跳过同名 json 已有 vl 评分的图")
    ap.add_argument("--quarantine", help="按 verdict 复制图片到该目录便于人工抽查")
    ap.add_argument("--only", help="只跑 id 包含/类别等于这些值（逗号分隔）")
    ap.add_argument("--default-category", default="unknown", choices=list(CATEGORIES) + ["unknown"],
                    help="无法从文件名/id 推断类别时用的默认类别")
    ap.add_argument("--limit", type=int, help="只跑前 N 张")
    ap.add_argument("--max-side", type=int, default=768, help="送模型前长边缩到多少（省显存/提速）")
    ap.add_argument("--max-new-tokens", type=int, default=220)
    ap.add_argument("--cpu", action="store_true", help="CPU 推理（极慢，仅排障）")
    ap.add_argument("--model-dir", default=DEFAULT_MODEL)
    ap.add_argument("--min-prompt", type=int, default=DEFAULT_MIN["prompt_fit"])
    ap.add_argument("--min-period", type=int, default=DEFAULT_MIN["period_fit"])
    ap.add_argument("--min-clean", type=int, default=DEFAULT_MIN["cleanliness"])
    ap.add_argument("--min-safety", type=int, default=DEFAULT_MIN["safety"])
    ap.add_argument("--dry-run", action="store_true", help="只列任务，不加载模型")
    args = ap.parse_args(argv)
    args.mins = {
        "prompt_fit": args.min_prompt,
        "period_fit": args.min_period,
        "cleanliness": args.min_clean,
        "safety": args.min_safety,
    }

    jobs = collect_jobs(args)
    print(f"[plan] {len(jobs)} 张待质检  thresholds={args.mins}", flush=True)
    for j in jobs[:5]:
        print(f"       - {j['id']:<20} {j['category']:<8} {_safe_rel(j['image'])}", flush=True)
    if len(jobs) > 5:
        print(f"       ... 其余 {len(jobs) - 5} 张", flush=True)
    if not jobs:
        print("[fatal] 没有可质检的图片", flush=True)
        return 2
    if args.dry_run:
        return 0

    processor, model, load_s = build_model(args)

    items, t_start = [], time.perf_counter()
    for i, job in enumerate(jobs, 1):
        rec = score_one(processor, model, job, args)
        item = {
            "id": job["id"],
            "image": _safe_rel(job["image"]),
            "category": job["category"],
            "prompt": job.get("prompt") or "",
            **rec,
        }
        items.append(item)
        if args.merge:
            merge_into_json(job["image"], rec, args)
        if args.quarantine and rec["verdict"] in ("retry", "reject", "error"):
            quarantine_copy(job["image"], rec["verdict"], args.quarantine)
        eta = (time.perf_counter() - t_start) / i * (len(jobs) - i)
        print(f"[{i}/{len(jobs)}] {job['id'][:24]:<24} scores="
              f"{rec['scores'].get('prompt_fit')}/{rec['scores'].get('period_fit')}/"
              f"{rec['scores'].get('cleanliness')}/{rec['scores'].get('safety')} "
              f"-> {rec['verdict']:<7} {','.join(rec['fail_types'])}  "
              f"{rec['elapsed_s']:.2f}s  eta={eta / 60:.1f}min", flush=True)

    summary = build_summary(items)
    report = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": MODEL_TAG,
        "model_dir": args.model_dir,
        "load_s": round(load_s, 3),
        "wall_s": round(time.perf_counter() - t_start, 2),
        "thresholds": args.mins,
        "summary": summary,
        "items": items,
    }
    out_path = args.out
    if not os.path.isabs(out_path):
        out_path = os.path.join(PROJ, out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    print_table(items)
    print(f"\n===== SUMMARY =====", flush=True)
    print(f"total={summary['total']} pass={summary['pass']} retry={summary['retry']} "
          f"reject={summary['reject']} error={summary['error']} "
          f"pass_rate={summary['pass_rate'] * 100:.1f}%", flush=True)
    print(f"mean_scores={summary['mean_scores']}", flush=True)
    print(f"fail_types={summary['fail_types']}", flush=True)
    print(f"-> {out_path}", flush=True)
    return 0 if summary["error"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
