"""H5: how fast a trusted surface declared at the first marked commit drifts away from the code.

For each repository and boundary variant (adoption line of a replay run), prints the share of the
repository's markers (vprobe tcb, all kinds) that lie inside the declared boundary globs at c0 and
at HEAD, the number of files ever marked after c0, and the share of replayed commits whose base
surface held no marked code (the ReviewedSurface judgment then cites nothing and is rejected, RJ10).

Usage: python3 -I surface_drift.py RUNS_DIR WALK_DIR CONFIG
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_glob import in_globs  # noqa: E402

runs, walk, cfg = sys.argv[1:4]
REPOS = ["anvil", "atmosphere", "verified-ironkv", "verified-memory-allocator", "verified-node-replication", "verified-nrkernel", "verified-storage", "vest"]
tot = {"c0in": 0, "c0all": 0, "hin": 0, "hall": 0, "rows": 0, "empty": 0}
print(f"{'repo':27} {'globs':>5} {'c0 markers in':>14} {'HEAD markers in':>16} {'files ever marked':>17} {'commits w/ empty surface':>25}")
for repo in REPOS:
    p = os.path.join(runs, cfg, f"{repo}.jsonl")
    lines = [json.loads(x) for x in open(p)]
    ad = [x for x in lines if x["type"] == "adoption"][0]
    rows = [x for x in lines if x["type"] == "commit"]
    empty = sum(1 for x in rows if x["cited"] == 0)
    w = json.load(open(os.path.join(walk, f"{repo}.walk.json")))
    tcb = {}
    for line in open(os.path.join(walk, f"{repo}.blobs.jsonl")):
        d = json.loads(line)
        tcb[d["sha"]] = sum(d["rec"]["tcb"].values()) if d["rec"] else 0
    snap = dict(w["rootSnap"])
    c0snap = dict(snap) if ad["c0"] == w["root"] else None
    ever = set()
    for st in w["steps"]:
        for o, n in st["pairs"]:
            if o and o in snap:
                del snap[o]
            if n and n in st["new"]:
                snap[n] = st["new"][n]
        if st["commit"] == ad["c0"]:
            c0snap = dict(snap)
        if c0snap is not None:
            ever |= {q for q, s in snap.items() if tcb.get(s, 0) > 0}

    def share(sn):
        a = sum(tcb.get(s, 0) for s in sn.values())
        i = sum(tcb.get(s, 0) for q, s in sn.items() if in_globs(ad["globs"], q))
        return i, a
    ci, ca = share(c0snap)
    hi, ha = share(snap)
    tot["c0in"] += ci
    tot["c0all"] += ca
    tot["hin"] += hi
    tot["hall"] += ha
    tot["rows"] += len(rows)
    tot["empty"] += empty
    print(f"{repo:27} {len(ad['globs']):5} {ci:6}/{ca:<7} {hi:6}/{ha:<9} {len(ever):17} {empty:6}/{len(rows):<6} ({100 * empty / max(1, len(rows)):4.1f}%)")
print(f"{'ALL':27} {'':5} {tot['c0in']:6}/{tot['c0all']:<7} {tot['hin']:6}/{tot['hall']:<9} {'':17} {tot['empty']:6}/{tot['rows']:<6} ({100 * tot['empty'] / tot['rows']:4.1f}%)")
