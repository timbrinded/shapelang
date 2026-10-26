"""H6 analysis: aggregates the teeth, change-mode P1, law-adequacy and fixtures/skills outputs.

Usage: python3 -I analyze.py WORK_DIR OUT_JSON

WORK_DIR holds teeth-decl.json, teeth-obs.json, teeth-extra.json, validate.json, w2-edges.json,
p1-rows-*.jsonl, p1-setup.json, law-plan.json, law-baseline.json, law-rows-*.jsonl and
teeth-skills.json (written by the scripts in this directory). Prints the report tables and writes
the summary JSON.
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict

work, out_path = sys.argv[1], sys.argv[2]


def load(name):
    with open(os.path.join(work, name)) as f:
        return json.load(f)


def rows(pattern):
    out = []
    for p in sorted(glob.glob(os.path.join(work, pattern))):
        with open(p) as f:
            out.extend(json.loads(line) for line in f if line.strip())
    return out


S = {}

# ---- 1. teeth provider on the dogfood model ----------------------------------------------------
decl, obs, extra, val = load("teeth-decl.json"), load("teeth-obs.json"), load("teeth-extra.json"), load("validate.json")
S["teeth"] = {}
for name, r in (("decl", decl), ("obs", obs)):
    S["teeth"][name] = {
        "operators": {o["op"]: [o["killed"], o["mutants"]] for o in r["operators"]},
        "claimsAssessed": len(r["claims"]),
        "notAssessed": len(r["notAssessed"]),
        "vacuous": r["vacuous"],
        "redundant": len(r["redundant"]),
        "redundantPairs": {c["id"]: c["redundantWith"] for c in r["claims"] if c["redundantWith"]},
        "unusedGrants": r["unusedGrants"],
        "gapsW1": r["gaps"]["W1"],
        "gapsW2": r["gaps"]["W2"],
        "P1": {"resources": r["gaps"]["P1"]["resources"], "uncaught": len(r["gaps"]["P1"]["uncaught"])},
        "sources": r["sources"],
        "laws": dict(Counter(l["verdict"] for l in r["laws"])),
    }
S["teeth"]["validate"] = {"sampled": val["sampled"], "agree": val["agree"], "byOp": val["byOp"], "seconds": round(val["ms"] / 1000)}
print("== teeth provider (dogfood)")
for name in ("decl", "obs"):
    t = S["teeth"][name]
    print(f"  {name}: " + ", ".join(f"{k} {v[0]}/{v[1]}" for k, v in t["operators"].items()) + f"; vacuous {len(t['vacuous'])}, redundant {t['redundant']}, unused {len(t['unusedGrants'])}, P1 uncaught {t['P1']['uncaught']}/{t['P1']['resources']}, W1 gaps {t['gapsW1']}")
print(f"  validate: {val['agree']}/{val['sampled']} {val['byOp']}")

# redundancy classes (decl)
red = S["teeth"]["decl"]["redundantPairs"]
red_cls = Counter()
for cid, w in red.items():
    if "NoHatchesOutsideBoundaries" in cid:
        red_cls["hatch forbid <= catch-all Hatch forbid"] += 1
    elif cid.endswith("/effects.upper") and all(x.endswith("/authority") for x in w):
        red_cls["unit summary <= its component's authority"] += 1
    else:
        red_cls["other"] += 1
S["teeth"]["redundantClassesDecl"] = dict(red_cls)
red_o = S["teeth"]["obs"]["redundantPairs"]
red_cls_o = Counter()
for cid, w in red_o.items():
    if "NoHatchesOutsideBoundaries" in cid:
        red_cls_o["hatch forbid <= catch-all Hatch forbid"] += 1
    elif cid.endswith("/effects.upper") and all(x.endswith("/authority") for x in w):
        red_cls_o["unit summary <= its component's authority"] += 1
    elif cid.endswith("/effects.upper") and any(x.endswith("/effects.upper") for x in w):
        red_cls_o["unit summary <= a caller's summary (observed calls)"] += 1
    else:
        red_cls_o["other"] += 1
S["teeth"]["redundantClassesObs"] = dict(red_cls_o)
print("  redundancy classes decl:", dict(red_cls), " obs:", dict(red_cls_o))

# ---- 2. observability and E10-comparable W1 ----------------------------------------------------
d = extra["decl"]
S["observability"] = {
    "resources": d["resourceObservability"]["total"],
    "resourcesBound": d["resourceObservability"]["bound"],
    "resourcesObservable": d["resourceObservability"]["observable"],
    "presenceChannels": d["presenceChannels"],
    "reportedVerbs": extra["reportedVerbs"],
    "W1all": S["teeth"]["decl"]["operators"]["W1"],
    "W1observableChannel": [d["observableW1"]["killed"], d["observableW1"]["n"]],
    "W1observableChannelGap": d["observableW1"]["gap"],
    "W1observableVerbs": [d["observableW1verbs"]["killed"], d["observableW1verbs"]["n"]],
    "W1observableVerbsGap": d["observableW1verbs"]["gap"],
    "summariesWithObservableAtom": [d["summaries"]["withAnyObservableAtom"], d["summaries"]["total"]],
    "observablyVacuousW1Channel": d["observablyVacuousW1"],
    "observablyVacuousW1Verbs": d["observablyVacuousW1verbs"],
    "kindObservability": d["kindObservability"],
    "ungovernedIds": [extra["ungovernedIds"], extra["ids"]],
}
# structure claims whose kinds no provider observes
unobs_kinds = {k["kind"] for k in d["kindObservability"] if not k["observedPresence"]}
struct_unobs = [c["id"] for c in decl["claims"] if c["op"] in ("edge.forbid",) and any(k in unobs_kinds for k in [c.get("kind")] if k)]
# edge.forbid kind is not in the teeth row; derive it from the W2 kills: every edge.forbid in the dogfood is over provides
edge_forbids = [c["id"] for c in decl["claims"] if c["op"] == "edge.forbid"]
S["observability"]["structureClaimsOverUnobservedKinds"] = len(edge_forbids)
ov = d["observablyVacuousW1verbs"]["count"] + len(edge_forbids)
S["observability"]["observablyVacuousTotal"] = [ov, len(decl["claims"])]
print("== observability")
print(f"  resources observable {len(d['resourceObservability']['observable'])}/{d['resourceObservability']['total']} (bound {d['resourceObservability']['bound']})")
print(f"  W1 observable (channel) {d['observableW1']['n']} of {S['teeth']['decl']['operators']['W1'][1]}; killed {d['observableW1']['killed']}; gap {d['observableW1']['gap']}")
print(f"  W1 observable (reported verbs) {d['observableW1verbs']['n']}; killed {d['observableW1verbs']['killed']}; gap {d['observableW1verbs']['gap']}")
print(f"  summaries with any observable atom {d['summaries']['withAnyObservableAtom']}/{d['summaries']['total']}")
print(f"  observably vacuous: W1 claims {d['observablyVacuousW1verbs']['count']} {d['observablyVacuousW1verbs']['byOp']} + {len(edge_forbids)} edge.forbid over provides = {ov}/{len(decl['claims'])}")
print(f"  ungoverned identities {extra['ungovernedIds']}/{extra['ids']}")
e = d["e10W1"]
S["e10W1"] = {"n": e["n"], "killed": e["killed"], "byKiller": e["byKiller"], "survivorClass": e["survivorClass"], "survivors": e["survivors"]}
print(f"  E10-comparable W1 (unit positions x 10 verbs x 79 resources): {e['killed']}/{e['n']} killed; survivors {e['n'] - e['killed']} {e['survivorClass']}")

# ---- 3. W2 per E10 row ------------------------------------------------------------------------
w2 = load("w2-edges.json")
S["w2"] = w2
print("== W2 calls classes", w2["calls"]["classes"])
print("  named", [(x["edge"], x["killed"]) for x in w2["named"]])
print("  into kernel", w2["intoKernel"])

# ---- 4. change-mode P1 --------------------------------------------------------------------------
# first run (no escalation tracking): keep its shape-only rows (G1, G2); code-edit variants come from
# the resumed run (-r2), which records escalated preexisting obligations too
p1_first = [r for r in rows("p1-rows-*of3.jsonl") if r["variant"] in ("G1", "G2")]
p1_r2 = rows("p1-rows-*of3-r2.jsonl")
seen = {(r["variant"], r["verb"], r["resource"]) for r in p1_r2}
p1 = p1_r2 + [r for r in p1_first if (r["variant"], r["verb"], r["resource"]) not in seen]
setup = load("p1-setup.json")
crash = [r for r in p1 if "crash" in r]
p1 = [r for r in p1 if "crash" not in r]


def counts(lst):
    """Per-variant counts over obligations with new keys (escalated preexisting keys counted apart:
    with no base-revision records, every observed fact at edited code counts as new, so code-edit
    variants escalate preexisting summary contradictions; G1/G2 edit no code)."""
    c = Counter()
    for r in lst:
        fresh = [o for o in r["obligations"] if not o.get("escalated")]
        esc = [o for o in r["obligations"] if o.get("escalated")]

        def has(pred):
            return any(pred(o) for o in fresh)

        l1 = lambda o: o["kind"] == "loosening" and o["questions"] and "L1" in o["questions"]  # noqa: E731
        c["L1 blocking"] += has(lambda o: l1(o) and o["severity"] == "blocking")
        c["L1 owed"] += has(lambda o: l1(o) and o["severity"] == "owed")
        c["L1 exploited"] += has(lambda o: l1(o) and o["exploited"])
        c["L2 blocking"] += has(lambda o: o["kind"] == "loosening" and o["questions"] and "L2" in o["questions"] and o["severity"] == "blocking")
        c["authority contradiction blocking"] += has(lambda o: o["kind"] == "contradiction" and (o["claim"] or "").endswith("/authority") and o["severity"] == "blocking")
        c["summary contradiction blocking"] += has(lambda o: o["kind"] == "contradiction" and (o["claim"] or "").endswith("/effects.upper") and o["severity"] == "blocking")
        c["coverage"] += has(lambda o: o["kind"] == "coverage")
        c["coverage blocking"] += has(lambda o: o["kind"] == "coverage" and o["severity"] == "blocking")
        c["errors"] += bool(r["errors"])
        c["escalated preexisting to blocking"] += any(o["severity"] == "blocking" for o in esc)
        c["verdict blocked"] += r["verdict"] == "blocked"
        c["no new-key blocking item"] += not r["errors"] and not any(o["severity"] == "blocking" for o in fresh)
    return dict(c)


by = defaultdict(list)
for r in p1:
    by[(r["variant"], r["verb"])].append(r)
S["p1change"] = {"setup": {"components": len(setup["comps"]), "componentTiers": dict(Counter(c["tier"] for c in setup["comps"])), "resources": setup["resources"], "baseline": setup["baseline"]}, "crashes": len(crash), "rows": len(p1), "variants": {}}
print("== change-mode P1 (rows", len(p1), "crashes", len(crash), ")")
for key in sorted(by):
    lst = by[key]
    agg = {"n": len(lst), "tiers": dict(Counter(r["tier"] for r in lst)), "all": counts(lst), "byTier": {t: counts([r for r in lst if r["tier"] == t]) for t in ("critical", "normal", "low")}, "medianMs": sorted(r["ms"] for r in lst)[len(lst) // 2]}
    S["p1change"]["variants"][f"{key[0]} {key[1]}"] = agg
    print(f"  {key[0]} {key[1]} n {len(lst)}: {agg['all']}")
    print(f"      low: {agg['byTier']['low']}")

# ---- 5. law adequacy ----------------------------------------------------------------------------
plan = load("law-plan.json")
base = load("law-baseline.json")["all"]
lr = rows("law-rows-*of2.jsonl")
units = {u["unit"]: u for u in plan["units"]}


def unit_kind(u):
    ks = {l["kind"] for l in u["laws"]}
    if "tested" in ks:
        return "tested"
    if "untested" in ks:
        return "untested-only" if not any(k.startswith("informal") for k in ks) else "untested+informal"
    return "informal-only"


agg = defaultdict(lambda: Counter())
per_unit = {}
for r in lr:
    u = units[r["unit"]]
    k = unit_kind(u)
    own_laws = {l["law"] for l in u["laws"] if l["kind"] == "tested"}
    killed = len(r["killedBy"]) > 0
    by_own = bool(own_laws & set(r["killedBy"]))
    status = "unreached" if not r["ran"] else ("killed-own" if by_own else "killed-other" if killed else "survived")
    agg[(k, r["where"])][status] += 1
    agg[("all", r["where"])][status] += 1
    pu = per_unit.setdefault(r["unit"], {"kind": k, "laws": [f"{l['kind']}:{l['law'].split('::')[1]}" for l in u["laws"]], "n": 0, "killed": 0, "killedOwn": 0, "unreached": 0, "survivors": []})
    pu["n"] += 1
    pu["killed"] += killed
    pu["killedOwn"] += by_own
    pu["unreached"] += status == "unreached"
    if not killed:
        pu["survivors"].append(f"{r['where']} {r['at'].split('#')[-1]} {r['mutant']}")
S["laws"] = {
    "per": plan["per"],
    "unitsLawBound": len(plan["units"]),
    "unitsTsFunctions": sum(1 for u in plan["units"] if not u["skip"]),
    "skipped": {u["unit"]: u["skip"] for u in plan["units"] if u["skip"]},
    "nonUnitLaws": len(plan["nonUnitLaws"]),
    "mutantsAvailable": {"unit": sum(u["mutants"] for u in plan["units"]), "callee": sum(u.get("calleeMutants") or 0 for u in plan["units"])},
    "rows": len(lr),
    "baselineHolds": sum(base.values()),
    "baselineLaws": len(base),
    "table": {f"{k[0]} / {k[1]}": dict(v) for k, v in sorted(agg.items())},
    "perUnit": per_unit,
}
print("== law adequacy (rows", len(lr), ")")
for k, v in sorted(agg.items()):
    tot = sum(v.values())
    print(f"  {k[0]:18s} {k[1]:6s} n {tot:3d} " + ", ".join(f"{s} {v[s]}" for s in ("killed-own", "killed-other", "survived", "unreached")))
# what 1.0 does with a mutant no law test kills (by the severity rules, not run): a unit with an
# informal (RefactorSensitive) law gets a stale judgment obligation; one with an untested law gets an
# introduced unestablished obligation (its Req meets the code delta); one whose laws are all tested
# and still pass gets nothing from the law layer ("silent")
TIER = {"low": 0, "normal": 1, "critical": 2, "final": 3}
outcome = Counter()
outcome_tier = Counter()
for r in lr:
    if r["killedBy"]:
        continue
    u = units[r["unit"]]
    inf = [l for l in u["laws"] if l["kind"].startswith("informal")]
    unt = [l for l in u["laws"] if l["kind"] == "untested"]
    if inf:
        cls, ls = "guard judgment (stale informal law)", inf
    elif unt:
        cls, ls = "unestablished (untested law)", unt
    else:
        cls, ls = "silent at the law layer (tested laws still pass)", []
    t = max((l["tier"] for l in ls), key=lambda x: TIER.get(x, 1)) if ls else "-"
    outcome[cls] += 1
    outcome_tier[(cls, t)] += 1
S["laws"]["survivorOutcome"] = dict(outcome)
S["laws"]["survivorOutcomeByTier"] = {f"{k[0]} @ {k[1]}": v for k, v in sorted(outcome_tier.items())}
print("  survivor outcomes:", dict(outcome))
print("  by tier:", {f"{k[0][:20]} @ {k[1]}": v for k, v in sorted(outcome_tier.items())})
tot = len(lr)
killed = sum(1 for r in lr if r["killedBy"])
unreached = sum(1 for r in lr if not r["ran"])
S["laws"]["totals"] = {"mutants": tot, "killed": killed, "survivedRan": tot - killed - unreached, "unreached": unreached}
print(f"  totals: {tot} mutants, {killed} killed by some law, {tot - killed - unreached} ran and survived, {unreached} in files no law test imports")

# teeth-provider law verdicts from own-law mutants on tested laws' units (unit + callee rows)
law_mut = defaultdict(lambda: [0, 0])
for r in lr:
    u = units[r["unit"]]
    for l in u["laws"]:
        if l["kind"] != "tested" or not base.get(l["law"], False):
            continue
        law_mut[l["law"]][0] += 1
        law_mut[l["law"]][1] += l["law"] in r["killedBy"]
verdicts = {}
for law, (tot, k) in sorted(law_mut.items()):
    verdicts[law] = {"total": tot, "killed": k, "verdict": "unassessed" if tot == 0 else "vacuous" if k == 0 else "weak" if 2 * k < tot else "teeth"}
S["laws"]["teethVerdicts"] = verdicts
S["laws"]["teethVerdictCounts"] = dict(Counter(v["verdict"] for v in verdicts.values()))
print("  teeth law verdicts (own-law kill share over unit+callee mutants):", S["laws"]["teethVerdictCounts"])
for law, v in verdicts.items():
    print(f"    {law.split('::')[1]:40s} {v['killed']:2d}/{v['total']:2d} {v['verdict']}")

# ---- 6. fixtures/skills ------------------------------------------------------------------------
sk = load("teeth-skills.json")
S["skills"] = {
    "models": len(sk),
    "withClaims": sum(1 for r in sk if r.get("claims", 0) > 0),
    "claims": sum(r.get("claims", 0) for r in sk),
    "vacuous": [v for r in sk for v in r.get("vacuous", [])],
    "redundant": [v for r in sk for v in r.get("redundant", [])],
    "unusedGrants": [v for r in sk for v in r.get("unusedGrants", [])],
    "P1uncaught": [v for r in sk for v in r["P1"]["uncaught"]] if all("P1" in r for r in sk) else None,
    "errors": {r["case"]: r["errors"] for r in sk if r.get("errors")},
    "perModel": {r["case"]: {"claims": r.get("claims"), "vacuous": len(r.get("vacuous", [])), "redundant": len(r.get("redundant", [])), "W1gap": r.get("gapsW1")} for r in sk},
}
print("== fixtures/skills:", {k: (len(v) if isinstance(v, list) else v) for k, v in S["skills"].items() if k != "perModel"})

with open(out_path, "w") as f:
    json.dump(S, f, indent=1, sort_keys=True)
