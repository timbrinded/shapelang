"""Aggregate E10 results into results.json (and print summary tables)."""
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXP, load_model, short  # noqa: E402

RES = os.path.join(EXP, "results")
d = load_model()
A_COMPS = [c for c in d["components"] if c["origin"] == "authored"]
A_RES = [r for r in d["resources"] if r["origin"] == "authored"]
FUNCS = {f["id"]: f for f in d["functions"]}


def load_mutants(op):
    with open(os.path.join(EXP, "mutants", f"{op}.json")) as f:
        return {m["id"]: m for m in json.load(f)}


def load_results(name):
    recs, batches = {}, []
    path = os.path.join(RES, f"{name}.jsonl")
    if not os.path.exists(path):
        return None, None
    with open(path) as f:
        for line in f:
            r = json.loads(line)
            if "id" in r:
                recs[r["id"]] = r
            else:
                batches.append(r)
    return recs, batches


# ---------------------------------------------------------------- claims ----
claims = {}  # claim key (caused-by text) -> record


def add_claim(key, ctype, decl, text):
    claims[key] = {"claim": key, "type": ctype, "declaration": decl, "text": text,
                   "kills": Counter(), "unique_kills": Counter()}


for r in d["rules"]:
    if r["origin"] != "authored":
        continue
    rn = r["name"]
    for fp in r["forbidProvides"]:
        key = f"rule {rn} forbids provides {short(fp['target'])}"
        add_claim(key, "rule:forbid provides", rn,
                  f"forbid provides {short(fp['target'])}" + (f" except {short(fp['except'])}" if fp.get("except") else ""))
    for hc in r["forbidHypercycles"]:
        key = f"rule {rn} forbids hypercycle" + (" over " + " or ".join(hc["kinds"]) if hc.get("kinds") else "")
        add_claim(key, "rule:forbid hypercycle", rn, key.split(" forbids ", 1)[1])
    for fp in r["forbidPaths"]:
        key = f"rule {rn} forbids path {short(fp['source'])} -> {short(fp['target'])} over " + " or ".join(fp["kinds"])
        add_claim(key, "rule:forbid path", rn, key.split(" forbids ", 1)[1])
    for fe in r["forbidEffects"]:
        key = f"rule {rn} forbids final {fe}"
        add_claim(key, "rule:forbid final", rn, str(fe))
for c in A_COMPS:
    add_claim(f"component {c['name']}", "component grant boundary", c["id"],
              f"{c['name']} grants only {len(c['grants'])} effect(s)")
n_rule_clauses = sum(1 for v in claims.values() if v["type"].startswith("rule:"))

final_forbids_in_play = []
for r in d["resources"]:
    for t in r["traits"]:
        pass  # trait lists are recorded below; prelude AppendOnly is the only trait with final forbids
trait_use = Counter(t for r in d["resources"] for t in r["traits"])
authored_trait_use = Counter(t for r in A_RES for t in r["traits"])

summary = {"operators": {}, "secondary": {}, "probes": {}}
anomalies = []
mutant_rows = {}


def tally(op, recs, muts, scored=True):
    st = Counter(r["status"] for r in recs.values())
    killed, surv = st.get("killed", 0), st.get("survived", 0)
    row = {"mutants_generated": len(muts), "mutants_run": len(recs), "killed": killed, "survived": surv,
           "anomaly": st.get("anomaly", 0),
           "mutation_score": round(killed / (killed + surv), 4) if killed + surv else None,
           "diag_kinds": dict(Counter(k for r in recs.values() for k in r["diag_kinds"]))}
    for r in recs.values():
        if r["status"] == "anomaly":
            anomalies.append({"id": r["id"], "op": op, "exit": r.get("exit"), "unattributed": r.get("unattributed")})
        if r.get("unattributed"):
            anomalies.append({"id": r["id"], "op": op, "note": "extra unattributed diagnostics",
                              "unattributed": r["unattributed"]})
    return row


def credit(recs, op):
    for r in recs.values():
        if r["status"] != "killed":
            continue
        cl = [c for c in r["claims"] if c in claims]
        unknown = [c for c in r["claims"] if c not in claims]
        if unknown:
            anomalies.append({"id": r["id"], "op": op, "note": "claim not in inventory", "claims": unknown})
        for c in cl:
            claims[c]["kills"][op] += 1
        rule_cl = [c for c in cl if claims[c]["type"].startswith("rule:")]
        comp_cl = [c for c in cl if not claims[c]["type"].startswith("rule:")]
        if len(rule_cl) == 1:
            claims[rule_cl[0]]["unique_kills"][op] += 1
        if not rule_cl and len(comp_cl) == 1:
            claims[comp_cl[0]]["unique_kills"][op] += 1


# --------------------------------------------------------------- M1 ---------
M1 = load_mutants("M1")
r1, b1 = load_results("M1")
summary["operators"]["M1"] = tally("M1", r1, M1)
summary["operators"]["M1"]["batches"] = len(b1)
summary["operators"]["M1"]["batch_unattributed_diagnostics"] = sum(b["n_unattributed"] for b in b1)
credit(r1, "M1")
pred = Counter((M1[i]["granted_already"], r["status"]) for i, r in r1.items())
summary["operators"]["M1"]["prediction_check"] = {f"granted_already={k[0]}/{k[1]}": v for k, v in pred.items()}
m1_by_effect = defaultdict(Counter)
for i, r in r1.items():
    m1_by_effect[M1[i]["effect"]][r["status"]] += 1
summary["operators"]["M1"]["by_effect"] = {e: dict(v) for e, v in sorted(m1_by_effect.items())}
m1_surv = [M1[i] for i, r in r1.items() if r["status"] == "survived"]
m1_surv_by_comp = Counter(short(m["component"]) for m in m1_surv)

# grant masking: each surviving M1 mutant is masked by exactly the matching grant
grant_mask = Counter((m["component"], m["effect"], m["resource"]) for m in m1_surv)

# --------------------------------------------------------------- M2 ---------
M2 = load_mutants("M2")
r2, _ = load_results("M2")
summary["operators"]["M2"] = tally("M2", r2, M2)
credit(r2, "M2")
effect_entry_kills = Counter()
grant_rows = []
for i, m in M2.items():
    r = r2[i]
    for e in r.get("effect_causes", []):
        effect_entry_kills[e] += 1
    grant_rows.append({
        "grant": f"{short(m['component'])} grants {m['effect']}<{short(m['resource'])}>",
        "m2_mutant": i, "m2_status": r["status"], "dependent_effect_entries": r["n_diags"],
        "dependent_fns": sorted({e.split(" emits ")[0].replace("effect ", "") for e in r.get("effect_causes", [])}),
        "m1_mutants_masked": grant_mask.get((m["component"], m["effect"], m["resource"]), 0),
    })
vacuous_grants = [g for g in grant_rows if g["m2_status"] == "survived"]
n_effect_entries = sum(len(FUNCS[f]["effects"]) for c in A_COMPS for f in c["functions"])
uniq_effect_entries = len({(f, e["name"], e.get("target")) for c in A_COMPS for f in c["functions"] for e in FUNCS[f]["effects"]})

# --------------------------------------------------------------- M3 ---------
calls = defaultdict(set)
for rel in d["relations"]:
    if rel["kind"] == "calls" and rel["origin"] == "authored":
        calls[rel["from"]].add(rel["to"])


def reach(src):
    seen, stack = set(), [src]
    while stack:
        x = stack.pop()
        for y in calls.get(x, ()):
            if y not in seen:
                seen.add(y)
                stack.append(y)
    return seen


R = {c["id"]: reach(c["id"]) for c in A_COMPS}
M3 = load_mutants("M3")
r3, _ = load_results("M3")
summary["operators"]["M3"] = tally("M3", r3, M3)
credit(r3, "M3")
m3_class = defaultdict(Counter)
m3_rows = []
for i, m in M3.items():
    a, b = m["source"], m["target"]
    if a in R[b]:
        cls = "back-edge (target already reaches source)"
    elif b in R[a]:
        cls = "shortcut (source already reaches target transitively)"
    else:
        cls = "new coupling (neither reaches the other)"
    m3_class[cls][r3[i]["status"]] += 1
    m3_rows.append({"id": i, "edge": f"{short(a)} -> {short(b)}", "class": cls, "status": r3[i]["status"],
                    "claims": r3[i]["claims"]})
mod_pair = defaultdict(Counter)
for i, m in M3.items():
    mod_pair[(m["source"].split("::")[0], m["target"].split("::")[0])][r3[i]["status"]] += 1
prose = {
    "ShapeAnalyzer -> ShapeChecker (rationale AnalyzerCheckerSeparation: 'does not call the authoritative deterministic checker')":
        ("shape.tooling::ShapeAnalyzer", "shape.checker::ShapeChecker"),
    "ShapeAuthoring -> ShapeChecker (reevaluation CriticPromptAdvisoryPassRechecked: critic works 'without calling the checker')":
        ("shape.tooling::ShapeAuthoring", "shape.checker::ShapeChecker"),
}
prose_rows = {}
for label, (a, b) in prose.items():
    hit = [i for i, m in M3.items() if m["source"] == a and m["target"] == b]
    prose_rows[label] = {"mutant": hit[0], "status": r3[hit[0]]["status"]} if hit else "pair not in universe"

# --------------------------------------------------------------- M4 ---------
M4 = load_mutants("M4")
r4, _ = load_results("M4")
if r4:
    summary["operators"]["M4"] = tally("M4", r4, M4)
    credit(r4, "M4")
    protected = {short(fp["target"]) for r in d["rules"] for fp in r["forbidProvides"]}
    provided = defaultdict(set)
    for rel in d["relations"]:
        if rel["kind"] == "provides":
            provided[rel["to"]].add(rel["from"])
    m4_class = defaultdict(Counter)
    for i, m in M4.items():
        if i not in r4:
            continue
        tgt = m["target"]
        if short(tgt) in protected:
            cls = "target under forbid provides"
        elif provided.get(tgt):
            cls = "second provider for a resource that already has a declared provider (no exclusivity rule)"
        elif m["owners"] and m["source"] not in m["owners"]:
            cls = "non-owner provides an owned resource with no declared provider"
        elif m["owners"]:
            cls = "owner provides its own resource"
        else:
            cls = "unowned, unprovided resource"
        m4_class[cls][r4[i]["status"]] += 1
    unprotected_with_provider = sorted(short(t) for t in provided if short(t) not in protected)

# ------------------------------------------------------ secondary strata ----
for op in ("M1gen", "M3gen", "M4gen"):
    rr, bb = load_results(op)
    if rr:
        summary["secondary"][op] = tally(op, rr, load_mutants(op))
        if bb:
            summary["secondary"][op]["batches"] = len(bb)
            summary["secondary"][op]["batch_unattributed_diagnostics"] = sum(b["n_unattributed"] for b in bb)
for op in ("M5probe", "HOprobe", "HOcontrol"):
    rr, bb = load_results(op)
    if rr:
        mm = load_mutants(op)
        summary["probes"][op] = tally(op, rr, mm)
        if op == "M5probe":
            summary["probes"][op]["rows"] = [
                {"id": i, "kind": mm[i]["kind"], "endpoints": [short(e) for e in mm[i]["endpoints"]],
                 "note": mm[i]["note"], "status": rr[i]["status"], "claims": rr[i]["claims"]} for i in sorted(rr)]
        if op in ("HOprobe", "HOcontrol"):
            summary["probes"][op]["home"] = dict(Counter(mm[i]["home"] for i in rr))
            summary["probes"][op]["resources_silently_destructible"] = len({mm[i]["resource"] for i in rr if rr[i]["status"] == "survived"})

# ------------------------------------------------------------- claims out ---
claim_rows = []
for k, v in claims.items():
    total = sum(v["kills"].values())
    claim_rows.append({"claim": k, "type": v["type"], "declaration": v["declaration"],
                       "kills_total": total, "kills_by_op": dict(v["kills"]),
                       "unique_kills_total": sum(v["unique_kills"].values()),
                       "unique_kills_by_op": dict(v["unique_kills"])})
claim_rows.sort(key=lambda x: (x["type"], x["claim"]))
vacuous = [c for c in claim_rows if c["kills_total"] == 0]
subsumed = [c for c in claim_rows if c["kills_total"] > 0 and c["unique_kills_total"] == 0 and c["type"].startswith("rule:")]
# pairwise subsumption among rule clauses: kill set of A is a subset of kill set of B
kill_sets = defaultdict(set)
for name in ("M1", "M2", "M3", "M4"):
    rr, _ = load_results(name)
    for i, rec in (rr or {}).items():
        if rec["status"] == "killed":
            for c in rec["claims"]:
                if c in claims and claims[c]["type"].startswith("rule:"):
                    kill_sets[c].add(i)
for c in subsumed:
    a = kill_sets[c["claim"]]
    c["kill_set_subset_of"] = [b for b in kill_sets if b != c["claim"] and a <= kill_sets[b]]
    c["kill_set_equal_to"] = [b for b in kill_sets if b != c["claim"] and a == kill_sets[b]]

out = {
    "experiment": "E10 model-level mutation testing of Shape's own architecture model",
    "meta": {
        "snapshot": "copy of /home/user/shapelang/shape taken 2026-10-23T10:16Z at HEAD b52cb5b (clean tree). HEAD later moved to 12391bd (another session, 11:03Z); the six authored .shape files are byte-identical at both commits, only generated-AST files differ.",
        "checker": "shp 0.10.0 (packages/shp-cli/src/index.ts), Bun 1.4.2",
        "oracle_command": "cd <worker copy> && bun /home/user/shapelang/packages/shp-cli/src/index.ts check  (default discovery shape/**/*.shape: 222 files; baseline 'Shape check passed.', exit 0)",
        "kill_criterion": "exit != 0 and at least one diagnostic attributable to the mutated declaration (relation name in caused-by for M3-M5; '<C> does not grant E<R>.' for M2; '<C>.<fn> emits E<R>.' for M1/HO). Baseline has zero diagnostics, so any attributable diagnostic is new.",
        "parallelism": "4 worker processes, each with a private copy of shape/; mutated file restored after each run",
        "seed": 7,
        "references_in_mutants": "module-qualified (module::Name) for every effect target and relation endpoint",
    },
    "claims_inventory": {
        "rule_clauses": n_rule_clauses,
        "rules": [r["name"] for r in d["rules"] if r["origin"] == "authored"],
        "final_forbids_in_play": 0,
        "final_forbid_note": "No authored resource carries any trait (authored trait use: %s); no rule has a forbid final clause. Generated resources carry only the member-less trait GeneratedAstAnchor (%d resources). The prelude AppendOnly trait is applied nowhere." % (dict(authored_trait_use) or "none", sum(v for k, v in trait_use.items() if k.endswith("::GeneratedAstAnchor"))),
        "grants": len(grant_rows),
        "components_authored": len(A_COMPS),
        "resources_authored": len(A_RES),
        "effect_entries": n_effect_entries,
        "effect_entries_unique_per_fn": uniq_effect_entries,
        "owns_declarations": sum(len(c.get("owns", [])) for c in A_COMPS),
    },
    "summary": summary,
    "claims": claim_rows,
    "vacuous_claims": vacuous,
    "rule_clauses_with_no_unique_kill": subsumed,
    "grants": grant_rows,
    "vacuous_grants": vacuous_grants,
    "effect_entries_cited_by_M2_kills": len(effect_entry_kills),
    "M1_survivors_by_component": dict(m1_surv_by_comp.most_common()),
    "M1_survivors": [{"component": short(m["component"]), "fn": short(m["fn"]), "effect": f"{m['effect']}<{short(m['resource'])}>"} for m in m1_surv],
    "M3_classes": {k: dict(v) for k, v in m3_class.items()},
    "M3_by_module_pair": {f"{a} -> {b}": dict(v) for (a, b), v in sorted(mod_pair.items())},
    "M3_prose_constraints": prose_rows,
    "M3_rows": m3_rows,
    "anomalies": anomalies,
}
if r4:
    out["M4_classes"] = {k: dict(v) for k, v in m4_class.items()}
    out["M4_unprotected_resources_with_existing_provider"] = unprotected_with_provider
    out["M4_survivors_nonowner_of_owned"] = [
        f"{short(M4[i]['source'])} provides {short(M4[i]['target'])} (owner {', '.join(short(o) for o in M4[i]['owners'])})"
        for i, r in r4.items() if r["status"] == "survived" and M4[i]["owners"] and M4[i]["source"] not in M4[i]["owners"]]
extra = os.path.join(EXP, "results", "extra.json")
if os.path.exists(extra):
    with open(extra) as f:
        out.update(json.load(f))
with open(os.path.join(EXP, "results.json"), "w") as f:
    json.dump(out, f, indent=1)

print(json.dumps(summary["operators"], indent=1))
print(json.dumps(summary["secondary"], indent=1))
print({k: {kk: vv for kk, vv in v.items() if kk != "rows"} for k, v in summary["probes"].items()})
print("\nclaims:")
for c in claim_rows:
    print(f"  {c['kills_total']:5d} uniq {c['unique_kills_total']:5d}  {c['type']:28s} {c['claim']}  {c['kills_by_op']}")
print("vacuous:", [c["claim"] for c in vacuous])
print("rule clauses with no unique kill:", [c["claim"] for c in subsumed])
print("vacuous grants:", [g["grant"] for g in vacuous_grants])
print("M3 classes:", json.dumps(out["M3_classes"], indent=1))
if r4:
    print("M4 classes:", json.dumps(out["M4_classes"], indent=1))
print("prose:", json.dumps(prose_rows, indent=1))
print("anomalies:", len(anomalies), anomalies[:5])
