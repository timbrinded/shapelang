"""Summarise walk.py results. Usage: analyse.py RESULTS_DIR HEADS_GLOB_DIR"""
import glob
import json
import os
import statistics
import sys

import re
res_dir, scratch = sys.argv[1], sys.argv[2]
EXCLUDE_MECH = len(sys.argv) > 3 and sys.argv[3] == "--exclude-mechanical"
BULK = 10
MECH = re.compile(r"verusfmt|\bfmt\b|format|migrat|deprecat|adapt|compatib|latest verus|new verus|newer verus|update.* verus|verus update|upgrade|bump|update for|new default|new syntax|syntax", re.I)
mech_contract = {}


def is_mech(r):
    return r.get("toolchain_files", 0) > 0 or bool(MECH.search(r["subject"]))



def pct(a, b):
    return f"{100 * a / b:5.1f}%" if b else "   n/a"


def q(xs, p):
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))]


tot = {}
print("== Review-trigger policies (commit level; first-parent; bulk imports and parse-failure commits excluded) ==")
hdr = f"{'repo':27} {'n':>5} {'P1 any-fn':>10} {'P2 contract':>11} {'P3 clos-lo':>10} {'P3 clos-up':>10} {'trust':>8} {'ghost/proof-only':>16} {'parse-fail':>10}"
print(hdr)
fn_rows = []
tcb_rows = []
size_rows = []
for path in sorted(glob.glob(os.path.join(res_dir, "*.json"))):
    d = json.load(open(path))
    repo = d["repo"]
    rows = [r for r in d["rows"] if r["verus_files"] > 0 and r["added_files"] < BULK]
    mech_all = [r for r in rows if is_mech(r)]
    mech_contract[repo] = (sum(r["exec_contract"] for r in mech_all if r["parse_fail"] == 0),
                           sum(r["exec_contract"] for r in rows if r["parse_fail"] == 0), len(mech_all), len(rows))
    if EXCLUDE_MECH:
        rows = [r for r in rows if not is_mech(r)]
    pf = [r for r in rows if r["parse_fail"] > 0]
    rows = [r for r in rows if r["parse_fail"] == 0]
    n = len(rows)

    def any_fn(r):
        return (r["exec_contract"] + r["exec_body_exec"] + r["exec_ghost_only"] + r["exec_added"] + r["exec_removed"]
                + r["spec_changed"] + r["proof_changed"] + r["trusted_body_changed"] + r["trusted_contract_changed"]) > 0

    def trust(r):
        return bool(r["tcb_add"] or r["tcb_remove"] or r["trusted_body_changed"] or r["trusted_contract_changed"])

    def p2(r):
        return r["exec_contract"] + r["exec_added"] + r["exec_removed"] > 0 or trust(r)

    def p3lo(r):
        return p2(r) or r["closure_lower_only"] > 0

    def p3up(r):
        return p2(r) or r["closure_upper_only"] > 0

    def ghost_proof_only(r):
        return (r["exec_ghost_only"] + r["proof_changed"]) > 0 and not (
            r["exec_contract"] + r["exec_body_exec"] + r["exec_added"] + r["exec_removed"] + r["spec_changed"]) and not trust(r)

    c1 = sum(map(any_fn, rows))
    c2 = sum(map(p2, rows))
    c3l = sum(map(p3lo, rows))
    c3u = sum(map(p3up, rows))
    ct = sum(map(trust, rows))
    cg = sum(map(ghost_proof_only, rows))
    print(f"{repo:27} {n:5} {pct(c1, n):>10} {pct(c2, n):>11} {pct(c3l, n):>10} {pct(c3u, n):>10} {pct(ct, n):>8} {pct(cg, n):>16} {len(pf):>10}")
    for k, v in (("n", n), ("p1", c1), ("p2", c2), ("p3l", c3l), ("p3u", c3u), ("t", ct), ("g", cg), ("pf", len(pf))):
        tot[k] = tot.get(k, 0) + v

    mod = sum(r["exec_contract"] + r["exec_body_exec"] + r["exec_ghost_only"] for r in rows)
    fn_rows.append((repo, mod, sum(r["exec_contract"] for r in rows), sum(r["exec_body_exec"] for r in rows),
                    sum(r["exec_ghost_only"] for r in rows), sum(r["closure_lower_only"] for r in rows),
                    sum(r["closure_upper_only"] for r in rows)))

    adds = [r for r in rows if r["tcb_add"]]
    add_total = sum(sum(r["tcb_add"].values()) for r in rows)
    rem_total = sum(sum(r["tcb_remove"].values()) for r in rows)
    kw = sum(1 for r in adds if r["msg_trust_kw"])
    big = sum(1 for r in adds if r["files"] >= 5)
    tb = sum(1 for r in rows if r["trusted_body_changed"])
    tfiles = sum(1 for r in rows if r["t_files"])
    tcb_rows.append((repo, len(adds), add_total, rem_total, kw, big, tb, tfiles, n))

    h = d["head"]
    per = h["per_fn"]
    ratio_lo = [(p["clause"] + p["closure_lo"]) / p["exec"] for p in per if p["exec"] > 0]
    ratio_up = [(p["clause"] + p["closure_up"]) / p["exec"] for p in per if p["exec"] > 0]
    nolo = sum(1 for p in per if p["clause"] == 0)
    size_rows.append((repo, h["exec_fns"], h["exec_tokens"], h["ghost_tokens_in_exec"], h["exec_clause_tokens"],
                      h["spec_fn_tokens"], h["proof_fn_tokens"], q(ratio_lo, .5), q(ratio_up, .5), q(ratio_up, .9),
                      nolo, h["trusted_fns"]))

n = tot["n"]
print(f"{'ALL':27} {n:5} {pct(tot['p1'], n):>10} {pct(tot['p2'], n):>11} {pct(tot['p3l'], n):>10} {pct(tot['p3u'], n):>10} {pct(tot['t'], n):>8} {pct(tot['g'], n):>16} {tot['pf']:>10}")

print("\n== Modified verified exec fns (fn level): what changed ==")
print(f"{'repo':27} {'modified':>8} {'contract':>9} {'exec body':>9} {'ghost only':>10} | {'+closure-only lo':>16} {'up':>6}")
T = [0] * 6
for repo, mod, c, b, g, cl, cu in fn_rows:
    print(f"{repo:27} {mod:8} {pct(c, mod):>9} {pct(b, mod):>9} {pct(g, mod):>10} | {cl:16} {cu:6}")
    for i, v in enumerate((mod, c, b, g, cl, cu)):
        T[i] += v
print(f"{'ALL':27} {T[0]:8} {pct(T[1], T[0]):>9} {pct(T[2], T[0]):>9} {pct(T[3], T[0]):>10} | {T[4]:16} {T[5]:6}")

print("\n== Trust base (TCB) churn ==")
print(f"{'repo':27} {'TCB-adding commits':>18} {'markers +':>9} {'-':>5} {'msg mentions':>12} {'in >=5-file commit':>18} {'trusted-body edits':>18} {'_t.rs commits':>13}")
for repo, nadd, at, rt, kw, big, tb, tf, n in tcb_rows:
    print(f"{repo:27} {nadd:6} ({pct(nadd, n)}) {at:9} {rt:5} {pct(kw, nadd):>12} {pct(big, nadd):>18} {tb:9} ({pct(tb, n)}) {tf:6} ({pct(tf, n)})")

print("\n== HEAD sizes (tokens) and contract+closure vs exec code per verified exec fn ==")
print(f"{'repo':27} {'exec fns':>8} {'exec tok':>9} {'ghost in exec':>13} {'clauses':>8} {'spec fns':>9} {'proof fns':>9} {'med lo':>7} {'med up':>7} {'p90 up':>7} {'no clause':>9} {'trusted fns':>11}")
for r in size_rows:
    repo, nf, et, gt, ct, st, pt, mlo, mup, p90, nolo, tf = r
    print(f"{repo:27} {nf:8} {et:9} {gt:13} {ct:8} {st:9} {pt:9} {mlo:7.2f} {mup:7.1f} {p90:7.1f} {pct(nolo, nf):>9} {tf:11}")

# HEAD TCB inventory from the head_*.jsonl files.
print("\n== Share of contract-change events in mechanical/toolchain commits ==")
for repo, (m, t, nm, nr) in mech_contract.items():
    print(f"{repo:27} mechanical commits {nm}/{nr} ({pct(nm, nr)}) carry {m}/{t} contract-change events ({pct(m, t)})")

print("\n== TCB markers at HEAD (comments excluded) ==")
for p in sorted(glob.glob(os.path.join(scratch, "head_*.jsonl"))):
    tot_tcb = {}
    for line in open(p):
        r = json.loads(line)
        for k, v in r.get("tcb", {}).items():
            tot_tcb[k] = tot_tcb.get(k, 0) + v
    print(f"{os.path.basename(p)[5:-6]:27} {dict(sorted(tot_tcb.items()))}")
