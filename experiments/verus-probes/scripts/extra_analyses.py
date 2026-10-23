"""Secondary analyses over walk.py results and HEAD extractions.
Usage: extra_analyses.py RESULTS_DIR WORK_DIR   (WORK_DIR holds head_<repo>.jsonl)"""
import glob
import json
import os
import re
import sys
from collections import Counter

res_dir, work = sys.argv[1], sys.argv[2]
MECH = re.compile(r"verusfmt|\bfmt\b|format|migrat|deprecat|adapt|compatib|latest verus|new verus|newer verus|update.* verus|verus update|upgrade|bump|update for|new default|new syntax|syntax", re.I)
TRUST = {"external_body", "external"}
pc = lambda a, b: f"{100 * a / b:5.1f}%" if b else "  n/a"
repos = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(res_dir, "*.json")))]


def clean(rows, mech=False):
    return [r for r in rows if r["verus_files"] > 0 and r["added_files"] < 10 and r["parse_fail"] == 0
            and (mech or not (MECH.search(r["subject"]) or r.get("toolchain_files", 0)))]


print("== Contract share of modified verified-exec-fn events by project-life quartile (non-mechanical) ==")
pool = [[0, 0] for _ in range(4)]
for d in repos:
    rows = clean(d["rows"])
    n, line = len(rows), []
    for q in range(4):
        part = rows[q * n // 4:(q + 1) * n // 4]
        c = sum(r["exec_contract"] for r in part)
        m = c + sum(r["exec_body_exec"] + r["exec_ghost_only"] for r in part)
        if d["repo"] != "vest":
            pool[q][0] += c
            pool[q][1] += m
        line.append(f"Q{q + 1} {pc(c, m)} (n={m})")
    print(f"  {d['repo']:27}", "  ".join(line))
print("  pooled excl. vest           ", "  ".join(f"Q{q + 1} {pc(*pool[q])} (n={pool[q][1]})" for q in range(4)))

print("\n== Net TCB growth per commit (moves within a commit cancel) ==")
for d in repos:
    rows = clean(d["rows"], mech=True)
    up = [r for r in rows if sum(r["tcb_add"].values()) - sum(r["tcb_remove"].values()) > 0]
    kw = sum(1 for r in up if r["msg_trust_kw"])
    print(f"  {d['repo']:27} commits {len(rows):4}  net-growing {len(up):4} ({pc(len(up), len(rows))})  message names it {pc(kw, len(up))}")

print("\n== assume()/admit() proof debt over history (cumulative from root) ==")
for d in repos:
    cur, series = 0, []
    for r in d["rows"]:
        cur += sum(r["tcb_add"].get(k, 0) for k in ("assume", "admit")) - sum(r["tcb_remove"].get(k, 0) for k in ("assume", "admit"))
        series.append(cur)
    runs, run = [], 0
    for x in series:
        if x > 0:
            run += 1
        elif run:
            runs.append(run)
            run = 0
    if run:
        runs.append(run)
    n = len(series)
    print(f"  {d['repo']:27} commits {n:4}  with outstanding debt {sum(1 for x in series if x > 0):4} ({pc(sum(1 for x in series if x > 0), n)})  "
          f"peak {max(series, default=0):3}  at HEAD {series[-1] if series else 0:3}  longest run {max(runs, default=0)}")

print("\n== HEAD: TCB markers and _t.rs share ==")
for p in sorted(glob.glob(os.path.join(work, "head_*.jsonl"))):
    repo = os.path.basename(p)[5:-6]
    rows = [json.loads(l) for l in open(p)]
    tot = Counter()
    for r in rows:
        tot.update(r.get("tcb", {}))
    t = [r for r in rows if r["path"].endswith("_t.rs")]
    in_t = sum(sum(r.get("tcb", {}).values()) for r in t)
    print(f"  {repo:27} {dict(sorted(tot.items()))}  in _t.rs: {in_t}/{sum(tot.values())} ({pc(in_t, sum(tot.values()))})")

print("\n== E7: verified exec fns at HEAD by what the Rust signature bounds ==")
print(f"  {'repo':27} {'n':>5} {'read-only':>10} {'&mut only':>10} {'tracked perm':>13} {'raw/interior/unsafe':>20} | &mut w/ two-state ensures")
for p in sorted(glob.glob(os.path.join(work, "head_*.jsonl"))):
    repo = os.path.basename(p)[5:-6]
    c = Counter()
    for line in open(p):
        for f in json.loads(line)["fns"]:
            if f["mode"] != "exec" or set(f["flags"]) & TRUST or not f.get("body_n"):
                continue
            s = f["sig_feat"]
            c["n"] += 1
            if s["raw"] or s["interior"] or s["unsafe_body"]:
                c["c2b"] += 1
            elif s["tracked"]:
                c["c2a"] += 1
            elif s["mut_ref"]:
                c["c1"] += 1
                c["c1_two"] += s["two_state"]
            else:
                c["c0"] += 1
    print(f"  {repo:27} {c['n']:5} {pc(c['c0'], c['n']):>10} {pc(c['c1'], c['n']):>10} {pc(c['c2a'], c['n']):>13} {pc(c['c2b'], c['n']):>20} | {pc(c['c1_two'], c['c1'])}")

print("\n== Trusted surface in projects with a _t.rs boundary (tokens) ==")
for repo in ("verified-ironkv", "verified-storage"):
    path = os.path.join(work, f"head_{repo}.jsonl")
    if not os.path.exists(path):
        continue
    rows = [json.loads(l) for l in open(path)]
    t = [r for r in rows if r["path"].endswith("_t.rs")]
    v = [r for r in rows if not r["path"].endswith("_t.rs")]
    tok = lambda rs, pred, fn: sum(fn(x) for r in rs for x in r["fns"] if pred(x))
    surface = (tok(t, lambda x: x["mode"] == "spec", lambda x: x["contract_n"] + x["body_n"])
               + tok(t, lambda x: x["mode"] == "exec", lambda x: x["clause_n"])
               + tok(t, lambda x: x["mode"] == "exec" and set(x["flags"]) & TRUST, lambda x: x["body_n"]))
    exec_v = tok(v, lambda x: x["mode"] == "exec" and not set(x["flags"]) & TRUST, lambda x: x["exec_n"])
    exec_all = tok(rows, lambda x: x["mode"] == "exec" and not set(x["flags"]) & TRUST, lambda x: x["exec_n"])
    proof = tok(rows, lambda x: x["mode"] == "proof", lambda x: x["contract_n"] + x["body_n"])
    ghost = tok(rows, lambda x: x["mode"] == "exec" and not set(x["flags"]) & TRUST, lambda x: x["body_n"] - x["exec_n"])
    print(f"  {repo}: trusted surface {surface} vs verified exec outside _t.rs {exec_v} ({surface / exec_v:.2f}x); "
          f"proof+ghost / verified exec {(proof + ghost) / exec_all:.2f}x")
