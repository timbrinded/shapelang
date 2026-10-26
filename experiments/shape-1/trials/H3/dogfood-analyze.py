"""H3 dogfood analysis: blocking of screened mutants of Shape's own tested laws, and obligations on
law-preserving refactors, under the stock prototype and the V-new introduced rule.

Usage: python3 -I dogfood-analyze.py OUT_JSON BASE_JSON SCREEN_JSON[,SCREEN_JSON] ROWS.jsonl...

A dogfood change's verdict is usually `blocked` for reasons unrelated to laws (introduced critical
coverage on components whose channels no provider observes), so blocking is judged per law: a
mutant is "law-blocked" when some law whose test fails at head has a blocking obligation, and
"law-flagged" when it has any open obligation.
"""
import json
import sys
from collections import Counter, defaultdict

out_path, base_path, screen_paths, *row_paths = sys.argv[1:]
base = json.load(open(base_path))
base_holds = {v["law"]: v["holds"] for v in base["lawVerdicts"]}
screen = []
for p in screen_paths.split(","):
    screen.extend(json.load(open(p)))

rows = []
for p in row_paths:
    with open(p) as f:
        rows.extend(json.loads(line) for line in f if line.strip())
crashes = [r for r in rows if "crash" in r]
rows = [r for r in rows if "crash" not in r]

tested = {law for law, h in base_holds.items() if h}


def law_obs(r, laws):
    return [o for o in r["obligations"] if o["kind"] in ("contradiction", "unestablished") and o["claim"] in laws]


summary = {"screen": {}, "mutants": {}, "refactors": {}, "crashes": [c["variant"] for c in crashes]}

# screening: law-test miss rate per location
loc = defaultdict(lambda: [0, 0])
for entry in screen:
    for c in entry.get("candidates", []):
        loc[c["where"]][1] += 1
        loc[c["where"]][0] += 1 if c["killed"] else 0
summary["screen"] = {w: {"killed": k, "candidates": n} for w, (k, n) in loc.items()}
print("== screening (law test vs candidate mutants)")
for w, (k, n) in sorted(loc.items()):
    print(f"  {w:7} killed {k}/{n} ({100.0 * k / n:.1f}%)")

for checker in ("stock", "vnew"):
    rs = [r for r in rows if r["checker"] == checker]
    muts = [r for r in rs if r["kind"] == "mutant"]
    table = defaultdict(lambda: Counter())
    details = []
    for r in muts:
        head = {v["law"]: v["holds"] for v in r["lawVerdicts"]}
        failing = {law for law in tested if head.get(law) is not True}
        obs = law_obs(r, failing)
        blocked = any(o["severity"] == "blocking" for o in obs) or any(e["code"] == "E-provider-missing" for e in r["errors"])
        flagged = bool(obs)
        intro = any(o["introduced"] for o in obs)
        t = table[r["where"]]
        t["n"] += 1
        t["suite_kill"] += 1 if failing else 0
        t["law_blocked"] += 1 if blocked else 0
        t["law_flagged"] += 1 if flagged else 0
        t["introduced"] += 1 if intro else 0
        t["loss"] += 1 if failing and not blocked else 0
        details.append({"variant": r["variant"], "where": r["where"], "at": r["at"], "mutant": r["mutant"], "failing": sorted(failing),
                        "obligations": [f"{o['kind']}:{o['claim'].split('::')[-1]}:{o['force'] or o['reason']}:{'intro' if o['introduced'] else 'pre'}:{o['severity']}" for o in obs],
                        "law_blocked": blocked, "verdict": r["verdict"], "moved": r["moved"]})
    summary["mutants"][checker] = {"by_location": {w: dict(c) for w, c in table.items()}, "details": details}
    print(f"\n== mutants, {checker} checker")
    for w, c in sorted(table.items()):
        print(f"  {w:7} n={c['n']} suite-kill={c['suite_kill']} law-blocked={c['law_blocked']} law-flagged={c['law_flagged']} introduced={c['introduced']} loss={c['loss']}")
    refs = [r for r in rs if r["kind"] == "refactor"]
    rdet = []
    for r in refs:
        tobs = law_obs(r, tested)
        allintro = [o for o in r["obligations"] if o["introduced"]]
        informal = [o for o in allintro if o["kind"] in ("contradiction", "unestablished") and o["claim"] not in tested]
        cov = [o for o in allintro if o["kind"] == "coverage"]
        rdet.append({"variant": r["variant"], "where": r["where"], "note": r["note"], "moved": r["moved"], "verdict": r["verdict"],
                     "tested_law_obligations": [f"{o['kind']}:{o['claim']}:{o['severity']}" for o in tobs],
                     "tested_laws_failing": sorted(law for law in tested if {v["law"]: v["holds"] for v in r["lawVerdicts"]}.get(law) is not True),
                     "introduced_other_law_obligations": [f"{o['kind']}:{o['claim']}:{o['reason']}:{o['severity']}" for o in informal],
                     "introduced_coverage": [f"{o['subject']}:{o['severity']}" for o in cov],
                     "errors": [e["code"] for e in r["errors"]]})
    summary["refactors"][checker] = rdet
    print(f"\n== refactors, {checker} checker ({len(refs)})")
    for d in rdet:
        print(f"  {d['variant']:32} moved={len(d['moved'])} tested-law obligations={d['tested_law_obligations']} failing={d['tested_laws_failing']} "
              f"other law (introduced)={d['introduced_other_law_obligations']} coverage={d['introduced_coverage']} errors={d['errors']}")

print(f"\ncrashes: {summary['crashes']}")
json.dump(summary, open(out_path, "w"), indent=1)
