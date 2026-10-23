"""E9: cheap trust-governance baselines vs function-level fingerprints.
Ground truth = trust events found by the function-level extractor:
  add/remove of TCB markers, edits to trusted fn bodies, edits to trusted fn contracts.
Baselines:
  B1 CODEOWNERS on *_t.rs  - catches an event iff it happens in a _t.rs file
  B2 count gate            - catches a commit iff its total TCB marker count rises
  B3 per-file count diff   - catches an event iff that file's marker counts change
  B1+B2                    - either
Usage: e9_baselines.py RESULTS_DIR"""
import glob
import json
import os
import sys

BULK = 10
print(f"{'repo':27} {'commits':>7} {'w/ trust event':>14} | recall: {'B1 _t.rs':>9} {'B2 count+':>9} {'B3 file-count':>13} {'B1+B2':>7} | {'B1 flags':>8} {'B1 flags w/o event':>18} | {'trusted-body-only commits':>25}")
tot = {}
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    d = json.load(open(path))
    repo = d["repo"]
    uses_t = any(e["t"] for r in d["rows"] for e in r.get("trust_events", []))
    rows = [r for r in d["rows"] if r["verus_files"] > 0 and r["added_files"] < BULK and r["parse_fail"] == 0]
    n = len(rows)
    with_event = b1 = b2 = b3 = b12 = b1_flags = b1_noevent = body_only = 0
    for r in rows:
        evs = [e for e in r["trust_events"] if e["add"] or e["remove"] or e["tbody"] or e["tcontract"]]
        t_touched = any(e["t"] for e in r["trust_events"])
        b1_flags += t_touched
        if not evs:
            b1_noevent += t_touched
            continue
        with_event += 1
        net = sum(sum(e["add"].values()) - sum(e["remove"].values()) for e in evs)
        c1 = any(e["t"] for e in evs)
        c2 = net > 0
        c3 = any(e["add"] or e["remove"] for e in evs)
        b1 += c1
        b2 += c2
        b3 += c3
        b12 += c1 or c2
        body_only += not c3 and all(not (e["add"] or e["remove"]) for e in evs)
    pc = lambda a, b: f"{100 * a / b:5.1f}%" if b else "  n/a"
    print(f"{repo:27} {n:7} {with_event:5} ({pc(with_event, n)}) | {pc(b1, with_event) if uses_t else '  (no _t)':>9} {pc(b2, with_event):>9} {pc(b3, with_event):>13} {pc(b12, with_event):>7} | {b1_flags:8} {b1_noevent:18} | {body_only:6} ({pc(body_only, with_event)})")
    for k, v in (("n", n), ("ev", with_event), ("b1", b1 if uses_t else 0), ("ev_t", with_event if uses_t else 0), ("b2", b2), ("b3", b3), ("b12", b12), ("bo", body_only)):
        tot[k] = tot.get(k, 0) + v
pc = lambda a, b: f"{100 * a / b:5.1f}%" if b else "  n/a"
print(f"{'ALL':27} {tot['n']:7} {tot['ev']:5} ({pc(tot['ev'], tot['n'])}) | {pc(tot['b1'], tot['ev_t']):>9} {pc(tot['b2'], tot['ev']):>9} {pc(tot['b3'], tot['ev']):>13} {pc(tot['b12'], tot['ev']):>7} |          |                    | {tot['bo']:6} ({pc(tot['bo'], tot['ev'])})")
print("B1 recall is computed only over repos that use the _t.rs convention.")
