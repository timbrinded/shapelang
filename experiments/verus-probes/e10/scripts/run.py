"""Run E10 mutants against `bun shp check` (default discovery, cwd = worker copy).

usage: run.py OP [--batch component] [--ids-file F] [--out NAME] [--jobs 4]

Single mode runs one check per mutant. Batch mode (M1-style effect additions
only) applies every mutant of one component in a single run and attributes
each diagnostic back to its mutant from the `C.fn emits E<R>.` line.
Results are appended to results/NAME.jsonl; finished ids are skipped on rerun.
"""
import argparse
import hashlib
import json
import multiprocessing as mp
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXP, apply_edits, cause_claims, parse_diagnostics, restore, run_check, short  # noqa: E402

WORK = os.path.join(EXP, "work")
RES = os.path.join(EXP, "results")
RAW = os.path.join(RES, "raw")

_dir = None


def init(q):
    global _dir
    _dir = q.get()


def ensure_workers(n):
    for i in range(n):
        w = os.path.join(WORK, f"w{i}")
        if not os.path.isdir(os.path.join(w, "shape")):
            os.makedirs(w, exist_ok=True)
            shutil.copytree(os.path.join(EXP, "shape"), os.path.join(w, "shape"))
    return [os.path.join(WORK, f"w{i}") for i in range(n)]


def effect_key_from_body(body0):
    # "ShapeBindings.checkBindings emits HardDelete<EffectiveModel>."
    if " emits " not in body0:
        return None
    lhs, _, rhs = body0.partition(" emits ")
    comp, _, fn = lhs.partition(".")
    rhs = rhs.rstrip(".")
    eff, _, res = rhs.partition("<")
    return (comp, fn, eff, res.rstrip(">"))


def classify_single(m, code, blocks):
    attributable = []
    for b in blocks:
        hit = False
        if m["op"] in ("M3", "M3gen", "M4", "M4gen", "M5probe"):
            hit = any(f"relation {m['relation']}" in c for c in b["caused_by"]) or \
                any(m["relation"] in line for line in b["body"])
        elif m["op"] == "M2":
            want = f"{short(m['component'])} does not grant {m['effect']}<{short(m['resource'])}>."
            hit = b["kind"] == "missing grant" and want in b["body"]
        elif m["op"] in ("M1", "M1gen", "HOprobe"):
            k = effect_key_from_body(b["body"][0]) if b["body"] else None
            hit = k == (short(m["component"]), short(m["fn"]).split(".")[-1], m["effect"], short(m["resource"]))
        if hit:
            attributable.append(b)
    others = [b for b in blocks if b not in attributable]
    if code == 0 and not blocks:
        status = "survived"
    elif code != 0 and attributable:
        status = "killed"
    else:
        status = "anomaly"
    rec = {
        "id": m["id"], "status": status, "exit": code,
        "diag_kinds": sorted({b["kind"] for b in attributable}),
        "n_diags": len(attributable),
        "claims": sorted({c for b in attributable for c in cause_claims(b)}),
        "effect_causes": sorted({c.partition(": ")[2] for b in attributable for c in b["caused_by"]
                                 if c.partition(": ")[2].startswith("effect ")}),
        "unattributed": [{"kind": b["kind"], "body": b["body"][:3]} for b in others],
    }
    return rec


def work_single(m):
    t0 = time.time()
    saved = apply_edits(m["edits"], _dir)
    try:
        code, out, err = run_check(_dir)
    finally:
        restore(saved, _dir)
    text = out + err
    blocks = parse_diagnostics(text)
    rec = classify_single(m, code, blocks)
    rec["sha256"] = hashlib.sha256(text.encode()).hexdigest()
    rec["secs"] = round(time.time() - t0, 2)
    rec["output"] = text if len(text) < 20000 else text[:20000] + "\n...[truncated]"
    return rec


def work_batch(args):
    bid, ms = args
    t0 = time.time()
    edits = [e for m in ms for e in m["edits"]]
    saved = apply_edits(edits, _dir)
    try:
        code, out, err = run_check(_dir)
    finally:
        restore(saved, _dir)
    text = out + err
    os.makedirs(RAW, exist_ok=True)
    with open(os.path.join(RAW, f"{bid}.txt"), "w") as f:
        f.write(text)
    blocks = parse_diagnostics(text)
    index = {}
    for m in ms:
        k = (short(m["component"]), short(m["fn"]).split(".")[-1], m["effect"], short(m["resource"]))
        assert k not in index, ("ambiguous batch key", k)
        index[k] = m["id"]
    by_id = {}
    unattributed = []
    for b in blocks:
        k = effect_key_from_body(b["body"][0]) if b["body"] else None
        mid = index.get(k)
        if mid is None:
            unattributed.append({"kind": b["kind"], "body": b["body"][:3]})
        else:
            by_id.setdefault(mid, []).append(b)
    recs = []
    for m in ms:
        bl = by_id.get(m["id"], [])
        recs.append({
            "id": m["id"], "status": "killed" if bl else "survived", "batch": bid, "batch_exit": code,
            "diag_kinds": sorted({b["kind"] for b in bl}), "n_diags": len(bl),
            "claims": sorted({c for b in bl for c in cause_claims(b)}),
        })
    summary = {"batch": bid, "exit": code, "n_mutants": len(ms), "n_blocks": len(blocks),
               "n_unattributed": len(unattributed), "unattributed": unattributed[:20],
               "secs": round(time.time() - t0, 2),
               "sha256": hashlib.sha256(text.encode()).hexdigest()}
    return summary, recs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("op")
    ap.add_argument("--batch", action="store_true")
    ap.add_argument("--ids-file")
    ap.add_argument("--out")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    with open(os.path.join(EXP, "mutants", f"{a.op}.json")) as f:
        ms = json.load(f)
    if a.ids_file:
        with open(a.ids_file) as f:
            want = set(json.load(f))
        ms = [m for m in ms if m["id"] in want]
    name = a.out or a.op
    os.makedirs(RES, exist_ok=True)
    path = os.path.join(RES, f"{name}.jsonl")
    done = set()
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                if "id" in r:
                    done.add(r["id"])
                elif "batch" in r:
                    done.add("batch:" + r["batch"])
    dirs = ensure_workers(a.jobs)
    q = mp.Queue()
    for d in dirs:
        q.put(d)
    t0 = time.time()
    with mp.Pool(a.jobs, initializer=init, initargs=(q,)) as pool, open(path, "a") as out:
        if a.batch:
            groups = {}
            for m in ms:
                groups.setdefault(short(m["component"]), []).append(m)
            tasks = [(f"{name}-{k}", v) for k, v in sorted(groups.items()) if "batch:" + f"{name}-{k}" not in done]
            for i, (summary, recs) in enumerate(pool.imap_unordered(work_batch, tasks), 1):
                for r in recs:
                    out.write(json.dumps(r) + "\n")
                out.write(json.dumps(summary) + "\n")
                out.flush()
                print(f"[{i}/{len(tasks)}] {summary['batch']} n={summary['n_mutants']} blocks={summary['n_blocks']} "
                      f"unattr={summary['n_unattributed']} {summary['secs']}s", flush=True)
        else:
            todo = [m for m in ms if m["id"] not in done]
            for i, rec in enumerate(pool.imap_unordered(work_single, todo, chunksize=1), 1):
                out.write(json.dumps(rec) + "\n")
                out.flush()
                if i % 50 == 0 or i == len(todo):
                    print(f"[{i}/{len(todo)}] {time.time() - t0:.0f}s", flush=True)
    print("done", name, f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
