"""H5 step 1b: verify the function-level walk against the recorded E9 per-commit data.

For every row of results/per-commit/<repo>.json.gz, the walk must have a step for the same commit
with identical added_files, verus_files, parse_fail and trust_events (path, t, add, remove, tbody,
tcontract). Prints per-repo agreement and exits 1 on any mismatch.

Usage: python3 -I check_walk.py PER_COMMIT_DIR WALK_DIR
"""
import glob
import gzip
import json
import os
import sys

pc_dir, walk_dir = sys.argv[1], sys.argv[2]
bad = 0
for path in sorted(glob.glob(os.path.join(pc_dir, "*.json.gz"))):
    d = json.load(gzip.open(path))
    repo = d["repo"]
    wp = os.path.join(walk_dir, f"{repo}.walk.json")
    if not os.path.exists(wp):
        print(f"{repo}: no walk")
        bad += 1
        continue
    w = json.load(open(wp))
    steps = {s["commit"]: s for s in w["steps"]}
    rows_ok = rows = 0
    mism = []
    for r in d["rows"]:
        rows += 1
        s = steps.get(r["commit"])
        if s is None:
            mism.append((r["commit"][:10], "missing step"))
            continue
        def norm(evs):
            return sorted(json.dumps({k: e[k] for k in ("path", "t", "add", "remove", "tbody", "tcontract")}, sort_keys=True) for e in evs)
        same = (
            s["added_files"] == r["added_files"]
            and s["verus_files"] == r["verus_files"]
            and s["parse_fail"] == r["parse_fail"]
            and norm(s["trust_events"]) == norm(r.get("trust_events", []))
        )
        if same:
            rows_ok += 1
        else:
            mism.append((r["commit"][:10], "differs"))
    extra = len(steps) - rows
    print(f"{repo:27} rows {rows:5} agree {rows_ok:5} steps {len(steps):5} (extra {extra})")
    for m in mism[:5]:
        print("   ", m)
    bad += len(mism)
sys.exit(1 if bad else 0)
