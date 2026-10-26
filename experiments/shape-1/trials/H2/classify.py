"""H2 drift trial classifier.

  python3 -I experiments/shape-1/trials/H2/classify.py <work-dir> [<seeds.json>]

Reads <work>/rows-<arm>-*.jsonl (written by run.ts) and the seed metadata, diffs each run's
obligations against the arm's no-op run (C00) by obligation key (keys depend only on kind, claim
fp and subject, T7), and classifies every (seed, arm):

  hit           an expected obligation (seed.expect) is introduced at this change, or an expected
                error is raised
  hit-preex     an expected obligation is new or changed against C00 but marked not introduced
  other         no expected match, but an introduced contradiction or a new error points at the
                seeded files
  flag-only     only coverage obligations and/or unestablished guard/doc laws (RefactorSensitive,
                DocumentedBy) are introduced: the change is flagged, the drift is not identified
  miss          nothing introduced, no new error

Writes <work>/classified.json and prints the tables used in the report.
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict

work = sys.argv[1]
seeds_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "seeds.json")
seeds = {s["id"]: s for s in json.load(open(seeds_path))}
order = [s for s in seeds]

rows = defaultdict(dict)
crashes = []
for f in sorted(glob.glob(os.path.join(work, "rows-*-*of*.jsonl"))):
    for line in open(f):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if "crash" in r:
            crashes.append((r["arm"], r["seed"], r["crash"][:300]))
            continue
        rows[r["arm"]][r["seed"]] = r

GUARDISH = ("/RefactorSensitive/", "Documented")


def blob(o):
    return json.dumps([o.get("subject"), o.get("facts"), o.get("witness"), o.get("affected")])


def provider_of(o, row):
    """Which provider's evidence witnesses the obligation (inferred from witness facts/records)."""
    if o["kind"] == "coverage":
        return "none (no absence-sound observer)"
    kinds = {f["type"] for f in o.get("facts") or []}
    res = {f.get("resource") or "" for f in o.get("facts") or []}
    if "effect" in kinds:
        return "tsClockScan" if any(r.startswith("ts.call") for r in res) else "effect observer"
    if "call" in kinds:
        return "tsCalls" + ("+shape" if "declared" in kinds else "")
    if "declared" in kinds:
        return "shape (declared)"
    if o["kind"] == "contradiction" and o.get("claim") and not o.get("witness"):
        # refutation: complete absence-sound entries cover the footprint and report no fact
        return "tsCalls (absence, refutation)"
    if o["kind"] == "contradiction" and o.get("witness"):
        return "bunTest"
    if o["kind"] == "unestablished":
        return "judgment route" if any(g in (o.get("claim") or "") for g in GUARDISH) else "bunTest route"
    return "?"


def matches(exp, o):
    if exp["kind"] != o["kind"]:
        return False
    if exp.get("claim") and not any(c in (o.get("claim") or "") for c in exp["claim"]):
        return False
    if exp.get("at") and exp["at"] not in blob(o):
        return False
    return True


def err_matches(exp, e):
    if exp["kind"] != "error":
        return False
    if exp.get("code") and e["code"] != exp["code"]:
        return False
    if exp.get("at") and exp["at"] not in (e["subject"] + " " + (e.get("message") or "")):
        return False
    return True


def sig(o):
    return (o["introduced"], o["severity"], o.get("reason"), o.get("force"))


def classify(arm, sid):
    r = rows[arm].get(sid)
    base = rows[arm].get("C00")
    if r is None or base is None:
        return None
    s = seeds[sid]
    exps = s["expect"].get(arm, s["expect"].get("A", [])) or []
    bmap = {o["key"]: o for o in base["obligations"]}
    berr = {(e["code"], e["subject"]) for e in base["errors"]}
    new_err = [e for e in r["errors"] if (e["code"], e["subject"]) not in berr]
    intro = [o for o in r["obligations"] if o["introduced"]]
    changed = [o for o in r["obligations"] if o["key"] not in bmap or sig(o) != sig(bmap[o["key"]])]
    gone = [k for k in bmap if k not in {o["key"] for o in r["obligations"]}]
    hit = []
    for e in exps:
        if e["kind"] == "error":
            hit += [("error", x) for x in new_err if err_matches(e, x)]
        else:
            hit += [("ob", o) for o in intro if matches(e, o)]
    pre = []
    if not hit:
        for e in exps:
            if e["kind"] != "error":
                pre += [o for o in changed if not o["introduced"] and matches(e, o)]
    touched = [t.split("/")[-1] for t in r.get("touched", [])]
    new_keys = [o for o in intro if o["key"] not in bmap]
    flipped = [o for o in intro if o["key"] in bmap]
    def is_drifty(o):
        return o["kind"] == "contradiction" or (o["kind"] == "unestablished" and not any(g in (o.get("claim") or "") for g in GUARDISH))

    # a new obligation counts if it points at the seeded files anywhere; an old obligation that
    # flipped to introduced counts only if a witness fact sits in the seeded files (the new fact)
    other = [o for o in new_keys if is_drifty(o) and any(t in blob(o) for t in touched)]
    other += [o for o in flipped if is_drifty(o) and any(t in json.dumps(o.get("facts")) for t in touched)]
    if hit:
        cls = "hit"
    elif pre:
        cls = "hit-preex"
    elif other or new_err:
        cls = "other"
    elif intro:
        cls = "flag-only"
    else:
        cls = "miss"
    best = None
    obs_hit = [x for t, x in hit if t == "ob"]
    if obs_hit:
        # report the strongest matched obligation: blocking first, then sound
        best = sorted(obs_hit, key=lambda o: (o["key"] in bmap, o["severity"] != "blocking", o.get("force") != "sound", o["kind"]))[0]
    elif pre:
        best = pre[0]
    return {
        "arm": arm,
        "seed": sid,
        "cat": s["cat"],
        "kind": s["kind"],
        "title": s["title"],
        "predict": s["predict"].get(arm, s["predict"].get("A")),
        "class": cls,
        "verdict": r["verdict"],
        "applyError": r.get("applyError"),
        "parseErrors": r.get("parseErrors"),
        "newErrors": [f'{e["code"]} {e["subject"]}' for e in new_err],
        "introduced": Counter(f'{o["kind"]}/{o["severity"]}' for o in intro),
        "introducedList": [f'{o["kind"]}:{o.get("claim") or o.get("subject")}:{o["severity"]}:{o.get("force")}:{o.get("reason")}' for o in intro],
        "matched": None
        if best is None
        else {
            "kind": best["kind"],
            "claim": best.get("claim"),
            "subject": best.get("subject"),
            "severity": best["severity"],
            "tier": best["tier"],
            "force": best.get("force"),
            "reason": best.get("reason"),
            "introduced": best["introduced"],
            "rule": best.get("rule"),
            "provider": provider_of(best, r),
            "newKey": best["key"] not in bmap,
        },
        "matchedErrors": [f'{x["code"]} {x["subject"]}' for t, x in hit if t == "error"],
        "introducedNew": Counter(f'{o["kind"]}/{o["severity"]}' for o in new_keys),
        "introducedFlipped": Counter(f'{o["kind"]}/{o["severity"]}' for o in flipped),
        "flippedList": [f'{o["kind"]}:{o.get("claim")}:{bmap[o["key"]]["severity"]}->{o["severity"]}' for o in flipped],
        "nIntroduced": len(intro),
        "groups": len({o.get("group") for o in intro}) if all("group" in o for o in intro) else None,
        "otherDrift": [f'{o["kind"]}:{o.get("claim")}:{o["severity"]}:{o.get("force")}' for o in other],
        "changedNotIntroduced": [f'{o["kind"]}:{o.get("claim") or o.get("subject")}:{o["severity"]}' for o in changed if not o["introduced"]],
        "gone": len(gone),
        "laws": Counter(l["result"] for l in r.get("laws", [])),
        "lawsContradicting": sorted(l["law"] for l in r.get("laws", []) if l["result"] == "contradicts"),
        "seconds": r["seconds"],
    }


out = []
for arm in sorted(rows):
    for sid in order:
        c = classify(arm, sid)
        if c:
            out.append(c)
json.dump({"classified": out, "crashes": crashes}, open(os.path.join(work, "classified.json"), "w"), indent=1, default=dict)

by = {(c["arm"], c["seed"]): c for c in out}
print(f"rows: {', '.join(f'{a}={len(rows[a])}' for a in sorted(rows))}; crashes: {len(crashes)}")
for a, sid, msg in crashes:
    print(f"  CRASH {a} {sid}: {msg}")
print()
print("| seed | cat | A class | A matched (kind / claim / force / severity / provider) | X class | X matched |")
print("|---|---|---|---|---|---|")
for sid in order:
    cells = []
    for arm in ("A", "X"):
        c = by.get((arm, sid))
        if not c:
            cells += ["-", "-"]
            continue
        m = c["matched"]
        if m:
            desc = f'{m["kind"]} / {m["claim"]} / {m["force"]} / {m["severity"]} {m["tier"]} r{m["rule"]} / {m["provider"]}{"" if m["newKey"] else " / FLIPPED"}'
        elif c["matchedErrors"]:
            desc = "; ".join(c["matchedErrors"])
        else:
            desc = "; ".join(c["introducedList"])[:160] or "(nothing introduced)"
        cells += [c["class"], desc]
    print(f'| {sid} | {seeds[sid]["cat"]} | {cells[0]} | {cells[1]} | {cells[2]} | {cells[3]} |')
print()
for arm in ("A", "X"):
    cs = [c for c in out if c["arm"] == arm]
    if not cs:
        continue
    print(f"== arm {arm}")
    for cat in "SRENMLC":
        cc = [c for c in cs if c["cat"] == cat]
        if not cc:
            continue
        print(f"  {cat}: n={len(cc)} {dict(Counter(c['class'] for c in cc))} blocking-verdict={sum(c['verdict'] == 'blocked' for c in cc)}")
    drift = [c for c in cs if c["kind"] == "drift"]
    print(f"  drift total n={len(drift)} {dict(Counter(c['class'] for c in drift))}")
    hits = [c for c in drift if c["class"] == "hit"]
    print(f"  hits by matched kind: {dict(Counter((c['matched'] or {}).get('kind', 'error') for c in hits))}")
    print(f"  hits by provider: {dict(Counter((c['matched'] or {}).get('provider', 'elaborator (error)') for c in hits))}")
    print(f"  hits by force: {dict(Counter(str((c['matched'] or {}).get('force', 'error')) for c in hits))}")
    print(f"  hits by severity: {dict(Counter((c['matched'] or {}).get('severity', 'error-blocks') for c in hits))}")
    ctl = [c for c in cs if c["kind"] == "control"]
    for c in ctl:
        print(f"  control {c['seed']} {c['class']} verdict={c['verdict']} new={dict(c['introducedNew'])} flipped={c['flippedList']} errors={c['newErrors']}")
    print(f"  introduced per drift run: {sorted(c['nIntroduced'] for c in drift)}")
    print(f"  groups per drift run: {sorted(c['groups'] for c in drift if c['groups'] is not None)}")
    print(f"  flipped (old obligations newly introduced) per drift run: {[(c['seed'], len(c['flippedList'])) for c in drift if c['flippedList']]}")
    print()
