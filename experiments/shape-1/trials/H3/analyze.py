"""H3 analysis: kill rate on law-tagged mutants, false-obligation rate on refactors.

Usage: python3 -I analyze.py OUT_JSON ROWS.jsonl... [--validate VALIDATE.json...]

A row is one derive of one (variant, arm, tier, regime, checker). Definitions:
  law obligation   an open obligation of kind contradiction or unestablished (in these models only
                   laws can produce them: every checker-decided claim is unobservable)
  law block        a blocking law obligation, or an E-provider-missing error
  law flag         any law obligation (blocking or owed), or an E-provider-missing error
  law-tagged       a harness mutant whose manifest lists a broken contract law, or a trap
  suite kill       the agent-written law suite fails at least one law test on the head
  loss             law-tagged, suite kill, and no law block (the bug merges although the tests
                   caught it)
"""
import json
import sys
from collections import Counter, defaultdict

args = sys.argv[1:]
out_path = args.pop(0)
rows_paths, val_paths = [], []
cur = rows_paths
for a in args:
    if a == "--validate":
        cur = val_paths
        continue
    cur.append(a)

rows = []
for p in rows_paths:
    with open(p) as f:
        rows.extend(json.loads(line) for line in f if line.strip())


def law_obs(r):
    return [o for o in r.get("obligations", []) if o["kind"] in ("contradiction", "unestablished")]


def pm_errors(r):
    return [e for e in r.get("errors", []) if e["code"] == "E-provider-missing"]


def law_block(r):
    return any(o["severity"] == "blocking" for o in law_obs(r)) or bool(pm_errors(r))


def law_flag(r):
    return bool(law_obs(r)) or bool(pm_errors(r))


def stale_raised(r):
    return any(o["kind"] == "unestablished" and o["reason"] == "stale" for o in law_obs(r))


def contra_raised(r):
    return any(o["kind"] == "contradiction" for o in law_obs(r))


def suite_kill(r):
    return (not all(r["suiteHead"].values())) or r.get("suiteSelfCheckFailed", False)


def law_tagged(r):
    return (r["kind"] == "mutant" and len(r["breaks"]) > 0) or r["kind"] == "trap"


def pct(a, b):
    return f"{a}/{b} ({100.0 * a / b:.1f}%)" if b else f"{a}/0"


cfg_keys = ("arm", "tier", "regime", "checker")
by_cfg = defaultdict(list)
for r in rows:
    if r["checker"] == "kernel":
        continue
    by_cfg[tuple(r[k] for k in cfg_keys)].append(r)

summary = {"configs": [], "tested_scope": {}, "losses": {}, "refactor_obligations": {}, "kernel": {}, "moved": {}}

# tested scope (independent of configuration): take one config's rows
ref_cfg = by_cfg[("C", "critical", "R1c", "stock")]
for task in sorted({r["task"] for r in ref_cfg}):
    tagged = [r for r in ref_cfg if r["task"] == task and law_tagged(r)]
    feat = [r for r in ref_cfg if r["task"] == task and r["kind"] == "mutant" and not r["breaks"]]
    refac = [r for r in ref_cfg if r["task"] == task and r["kind"] == "refactor"]
    fctl = [r for r in ref_cfg if r["task"] == task and r["kind"] == "feature"]
    summary["tested_scope"][task] = {
        "law_tagged": len(tagged),
        "suite_kills": sum(suite_kill(r) for r in tagged),
        "suite_misses": [r["variant"] for r in tagged if not suite_kill(r)],
        "feature_only_mutants": len(feat),
        "feature_only_suite_fails": [r["variant"] for r in feat if suite_kill(r)],
        "refactors": len(refac),
        "refactor_suite_fails": [r["variant"] for r in refac if suite_kill(r)],
        "feature_controls": len(fctl),
        "feature_control_suite_fails": [r["variant"] for r in fctl if suite_kill(r)],
    }
    summary["moved"][task] = {r["variant"]: [m for m in r["moved"] if "#" in m] for r in ref_cfg if r["task"] == task}

print("== tested scope (agent-written g8 suites)")
for t, s in summary["tested_scope"].items():
    print(f"  {t}: law-tagged {s['law_tagged']}, suite kills {s['suite_kills']}, misses {s['suite_misses']}; "
          f"feature-only {s['feature_only_mutants']} (suite fails {s['feature_only_suite_fails']}); "
          f"refactors {s['refactors']} (suite fails {s['refactor_suite_fails']}); feature controls {s['feature_controls']}")

print("\n== per configuration (all three tasks pooled)")
print(f"  {'arm':3} {'tier':8} {'reg':4} {'checker':6} | {'law block (kill)':>20} {'law flag':>20} {'loss':>14} | {'refactor flag':>18} {'refactor block':>18} | {'feature-ctl flag':>16} | {'feat-only flag':>16}")
for key in sorted(by_cfg):
    rs = by_cfg[key]
    tagged = [r for r in rs if law_tagged(r)]
    refac = [r for r in rs if r["kind"] == "refactor"]
    fctl = [r for r in rs if r["kind"] == "feature"]
    fonly = [r for r in rs if r["kind"] == "mutant" and not r["breaks"]]
    kills = sum(law_block(r) for r in tagged)
    flags = sum(law_flag(r) for r in tagged)
    loss = [f"{r['task']}:{r['variant']}" for r in tagged if suite_kill(r) and not law_block(r)]
    per_task = {}
    for t in sorted({r["task"] for r in rs}):
        tt = [r for r in tagged if r["task"] == t]
        rf = [r for r in refac if r["task"] == t]
        per_task[t] = {
            "kill": [sum(law_block(r) for r in tt), len(tt)],
            "flag": [sum(law_flag(r) for r in tt), len(tt)],
            "refactor_flag": [sum(law_flag(r) for r in rf), len(rf)],
            "refactor_block": [sum(law_block(r) for r in rf), len(rf)],
        }
    entry = {
        "arm": key[0], "tier": key[1], "regime": key[2], "checker": key[3],
        "law_tagged": len(tagged), "kills": kills, "flags": flags, "loss": loss,
        "contradiction_raised": sum(contra_raised(r) for r in tagged), "stale_raised": sum(stale_raised(r) for r in tagged),
        "refactors": len(refac), "refactor_flags": sum(law_flag(r) for r in refac), "refactor_blocks": sum(law_block(r) for r in refac),
        "refactor_flagged": [f"{r['task']}:{r['variant']}" for r in refac if law_flag(r)],
        "refactor_verdicts": dict(Counter(r["verdict"] for r in refac)),
        "refactor_coverage_obligations": sum(1 for r in refac for o in r.get("obligations", []) if o["kind"] == "coverage"),
        "feature_controls": len(fctl), "feature_control_flags": sum(law_flag(r) for r in fctl), "feature_control_blocks": sum(law_block(r) for r in fctl),
        "feature_only": len(fonly), "feature_only_flags": sum(law_flag(r) for r in fonly), "feature_only_blocks": sum(law_block(r) for r in fonly),
        "per_task": per_task,
    }
    summary["configs"].append(entry)
    print(f"  {key[0]:3} {key[1]:8} {key[2]:4} {key[3]:6} | {pct(kills, len(tagged)):>20} {pct(flags, len(tagged)):>20} {len(loss):>14} | "
          f"{pct(entry['refactor_flags'], len(refac)):>18} {pct(entry['refactor_blocks'], len(refac)):>18} | "
          f"{pct(entry['feature_control_flags'], len(fctl)):>16} | {pct(entry['feature_only_flags'], len(fonly)):>16}")

print("\n== losses (suite killed, checker did not block), stock checker")
for e in summary["configs"]:
    if e["checker"] == "stock" and e["loss"]:
        print(f"  {e['arm']} {e['tier']} {e['regime']}: {len(e['loss'])}: {' '.join(e['loss'])}")

# reasons for losses in R1c: the law obligations of lost variants
print("\n== R1c stock losses in detail (law obligations on the lost variant)")
for key in sorted(by_cfg):
    if key[2] != "R1c" or key[3] != "stock" or key[1] != "critical":
        continue
    for r in by_cfg[key]:
        if law_tagged(r) and suite_kill(r) and not law_block(r):
            obs = [f"{o['kind']}:{(o['claim'] or '').split('::')[-1]}:{o['force'] or o['reason']}:{'intro' if o['introduced'] else 'pre'}:{o['severity']}" for o in law_obs(r)]
            moved = [m.split('#')[1] for m in r["moved"] if "#" in m]
            print(f"  {key[0]} {r['task']}:{r['variant']:28} moved={moved} -> {' '.join(obs)}")

# kernel agreement
krows = [r for r in rows if r["checker"] == "kernel"]
stock_index = {(r["task"], r["variant"], r["arm"], r["tier"], r["regime"]): r for r in rows if r["checker"] == "stock"}


def lawsig(r):
    return sorted((o["kind"], o["claim"], o["severity"], o["reason"], o["force"], o["introduced"]) for o in law_obs(r))


agree = Counter()
disagreements = []
for k in krows:
    s = stock_index.get((k["task"], k["variant"], k["arm"], k["tier"], k["regime"]))
    if s is None or "crash" in k:
        agree["crash_or_missing"] += 1
        disagreements.append({"variant": k["variant"], "arm": k["arm"], "regime": k["regime"], "crash": k.get("crash")})
        continue
    v_ok = s["verdict"] == k["verdict"]
    e_ok = sorted(e["code"] for e in s["errors"]) == sorted(e["code"] for e in k["errors"])
    l_ok = lawsig(s) == lawsig(k)
    keys_ok = sorted(o["key"] for o in s["obligations"]) == sorted(o["key"] for o in k["obligations"])
    agree["cases"] += 1
    agree["verdict"] += v_ok
    agree["errors"] += e_ok
    agree["law_obligations"] += l_ok
    agree["all_keys"] += keys_ok
    if not (v_ok and e_ok and l_ok and keys_ok):
        disagreements.append({"task": k["task"], "variant": k["variant"], "arm": k["arm"], "regime": k["regime"],
                              "stock": {"verdict": s["verdict"], "errors": [e["code"] for e in s["errors"]], "law": lawsig(s), "keys": sorted(o["key"] for o in s["obligations"])},
                              "kernel": {"verdict": k["verdict"], "errors": [e["code"] for e in k["errors"]], "law": lawsig(k), "keys": sorted(o["key"] for o in k["obligations"])}})
summary["kernel"] = {"agreement": dict(agree), "disagreements": disagreements[:40], "n_disagreements": len(disagreements)}
print(f"\n== kernel (shapek) vs stock prototype: {dict(agree)}; disagreements {len(disagreements)}")
for d in disagreements[:10]:
    print("  ", json.dumps(d)[:600])

# validation (law-preservation of refactors, suite results)
if val_paths:
    vals = []
    for p in val_paths:
        vals.extend(json.load(open(p)))
    summary["validation"] = vals
    bad = [v for v in vals if v["kind"] in ("refactor", "feature") and (v["g8Fail"] or v["c1Fail"] or v["hidden"]["featureFail"] or v["hidden"]["lawFail"])]
    print(f"\n== validation: {len(vals)} variants; refactors/feature controls failing any suite: {[(v['task'], v['id']) for v in bad]}")
    for t in sorted({v["task"] for v in vals}):
        lt = [v for v in vals if v["task"] == t and ((v["kind"] == "mutant" and v["breaks"]) or v["kind"] == "trap")]
        print(f"  {t}: law-tagged {len(lt)}; g8 kills {sum(bool(v['g8Fail']) for v in lt)}; C1 kills {sum(v['c1Fail'] > 0 for v in lt)}; hidden-law kills {sum(v['hidden']['lawFail'] > 0 for v in lt)}")

json.dump(summary, open(out_path, "w"), indent=1)
