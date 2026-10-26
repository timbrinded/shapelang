"""H1 analysis: per-commit and pooled judgment-obligation ratios, 1.0 against 0.x coverage.

python3 -I experiments/shape-1/trials/H1/analyze.py <zerox.json> <rows.jsonl> <outdir>
        [--tip <zerox-tipmodel.json>] [--seed N] [--label L]

Reads the 0.x demand (zerox.ts) and the 1.0 replay rows (replay.ts), joins them by commit and writes
<outdir>/per-commit.json, <outdir>/summary.json and <outdir>/sample20.json (seeded sample of 1.0
judgment-class obligations from the governed population, for hand checking). Prints the summary.

Numerators (1.0, introduced obligations only; preexisting ones are owed and never per-change work):
  b_J           budget == judgment (first discharger not checker-verifiable): the primary count
  b_J_blocking  of those, severity blocking
  b_J_groups    distinct groups among b_J (the spec's budget unit)
  b_J_no_pc     b_J without producer-changed unestablished obligations
  b_judges_any  any discharger acted by judges (includes exception routes: an upper bound)
Denominators (0.x, shp coverage semantics):
  a             governed changed files (shape_update globs) + guarded sources: the primary count
  a_bind        a + DocumentedBy-style bindings triggered (shp check, not coverage)
  a_comp        governing components with demand + guarded sources
  a_tip         a, computed with the master-tip 0.x model instead of each commit's own
"""

import json
import random
import statistics
import sys
from collections import Counter

zx_path, rows_path, outdir = sys.argv[1], sys.argv[2], sys.argv[3]


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


seed = int(arg("--seed", "20261026"))
label = arg("--label", "commits")
tip = {r["commit"]: r for r in json.load(open(arg("--tip")))} if arg("--tip") else {}

zx = {r["commit"]: r for r in json.load(open(zx_path))}
rows = {}
for line in open(rows_path):
    if line.strip():
        r = json.loads(line)
        rows[r["commit"]] = r


def judges(o):
    return any(a.endswith("/judges") for a in o["acts"])


def kind(o):
    return o["kind"] + ("/" + o["reason"] if o["reason"] else "") + ("/" + "+".join(o["questions"]) if o["questions"] else "")


per = []
for c, z in zx.items():
    r = rows.get(c)
    a_files = len(z["demand"]["files"])
    a_guards = len(z["demand"]["guards"])
    t = tip.get(c)
    rec = {
        "commit": c[:7],
        "full": c,
        "date": z["date"][:10],
        "subject": z["subject"][:70],
        "changed": len(z["changed"]),
        "governed": a_files + a_guards > 0,
        "a_files": a_files,
        "a_guards": a_guards,
        "a": a_files + a_guards,
        "a_residual": len(z["residual"]["files"]) + len(z["residual"]["guards"]),
        "a_bindings": len(z["demand"]["bindings"]),
        "a_bind": a_files + a_guards + len(z["demand"]["bindings"]),
        "a_comp": len(z["demand"].get("components", [])) + a_guards,
        "a_tip": (len(t["demand"]["files"]) + len(t["demand"]["guards"])) if t else None,
        "ok": bool(r and r.get("ok")),
    }
    if r and r.get("ok"):
        obs = r["obligations"]  # introduced only
        J = [o for o in obs if o["budget"] == "judgment"]
        rec.update(
            {
                "verdict": r["verdict"],
                "errors": len(r["errors"]),
                "finest": len(r["finest"]),
                "b_introduced": len(obs),
                "b_J": len(J),
                "b_J_blocking": sum(1 for o in J if o["severity"] == "blocking"),
                "b_J_groups": len({o["group"] for o in J}),
                "b_J_no_pc": sum(1 for o in J if o["reason"] != "producer-changed"),
                "b_judges_any": sum(1 for o in obs if judges(o)),
                "b_mech": sum(1 for o in obs if o["budget"] == "mechanical"),
                "b_mech_blocking": sum(1 for o in obs if o["budget"] == "mechanical" and o["severity"] == "blocking"),
                "b_J_kinds": dict(Counter(kind(o) for o in J)),
                "b_mech_kinds": dict(Counter(kind(o) for o in obs if o["budget"] == "mechanical")),
                "preexisting": len(r["preexisting"]),
                "preexisting_J": sum(1 for o in r["preexisting"] if o["budget"] == "judgment"),
                "laws": r["laws"],
                "seconds": r["seconds"],
            }
        )
        # which 0.x demand files does 1.0 ask anything about? (an introduced obligation whose
        # affected identities include the file or a symbol in it)
        def paths(o):
            return {a.split(":", 1)[1].split("#", 1)[0] for a in (o.get("affected") or []) if ":" in a}

        anyp = set().union(*[paths(o) for o in obs]) if obs else set()
        jp = set().union(*[paths(o) for o in J]) if J else set()
        rec["files_asked_any"] = sum(1 for f in z["demand"]["files"] if f in anyp)
        rec["files_asked_J"] = sum(1 for f in z["demand"]["files"] if f in jp)
        rec["files_silent"] = [f for f in z["demand"]["files"] if f not in anyp]
    per.append(rec)

per.sort(key=lambda x: (x["date"], x["full"]))
NUMS = ["b_J", "b_J_blocking", "b_J_groups", "b_J_no_pc", "b_judges_any"]
DENS = ["a", "a_bind", "a_comp", "a_tip"]


def ratio(pop, num, den):
    d = sum(p[den] or 0 for p in pop)
    return (sum(p[num] for p in pop) / d) if d else None


def boot(pop, num, den, reps=10000):
    rng = random.Random(seed)
    vals = []
    for _ in range(reps):
        s = [pop[rng.randrange(len(pop))] for _ in pop]
        v = ratio(s, num, den)
        if v is not None:
            vals.append(v)
    vals.sort()
    return [round(vals[int(0.025 * len(vals))], 3), round(vals[int(0.975 * len(vals)) - 1], 3)]


def summarize(pop, name):
    out = {"population": name, "commits": len(pop), "sums": {}, "pooled": {}}
    for k in NUMS + DENS + ["a_files", "a_guards", "a_residual", "a_bindings", "b_mech", "b_mech_blocking", "b_introduced", "preexisting_J"]:
        out["sums"][k] = sum(p.get(k) or 0 for p in pop)
    for den in DENS:
        if den == "a_tip" and not tip:
            continue
        for num in NUMS:
            v = ratio(pop, num, den)
            out["pooled"][f"{num}/{den}"] = {"ratio": round(v, 3) if v is not None else None, "ci95": boot(pop, num, den) if v is not None else None}
    rs = [p["b_J"] / p["a"] for p in pop if p["a"] > 0]
    out["per_commit"] = {
        "mean_a": round(statistics.mean(p["a"] for p in pop), 2),
        "mean_b_J": round(statistics.mean(p["b_J"] for p in pop), 2),
        "mean_b_J_groups": round(statistics.mean(p["b_J_groups"] for p in pop), 2),
        "median_a": statistics.median(p["a"] for p in pop),
        "median_b_J": statistics.median(p["b_J"] for p in pop),
        "median_b_J_groups": statistics.median(p["b_J_groups"] for p in pop),
        "median_ratio_b_J_over_a": round(statistics.median(rs), 3) if rs else None,
        "median_ratio_groups_over_a": round(statistics.median([p["b_J_groups"] / p["a"] for p in pop if p["a"] > 0]), 3) if rs else None,
        "commits_with_a_gt_0": sum(1 for p in pop if p["a"] > 0),
        "commits_b_J_halved_or_better": sum(1 for p in pop if p["a"] > 0 and 2 * p["b_J"] <= p["a"]),
        "commits_groups_halved_or_better": sum(1 for p in pop if p["a"] > 0 and 2 * p["b_J_groups"] <= p["a"]),
        "commits_b_J_gt_a": sum(1 for p in pop if p["b_J"] > p["a"]),
        "commits_b_J_zero": sum(1 for p in pop if p["b_J"] == 0),
        "commits_a_zero_b_J_pos": sum(1 for p in pop if p["a"] == 0 and p["b_J"] > 0),
    }
    out["errors_commits"] = sum(1 for p in pop if p.get("errors", 0) > 0)
    silent = Counter()
    for p in pop:
        for f in p.get("files_silent", []):
            ext = f.rsplit("/", 1)[-1]
            silent[ext.rsplit(".", 1)[-1] if "." in ext else "(none)"] += 1
    out["files_vs_1_0"] = {
        "a_files": out["sums"]["a_files"],
        "asked_by_any_introduced": sum(p.get("files_asked_any", 0) for p in pop),
        "asked_by_judgment": sum(p.get("files_asked_J", 0) for p in pop),
        "silent_by_extension": dict(silent.most_common()),
    }
    kinds, mkinds = Counter(), Counter()
    for p in pop:
        kinds.update(p.get("b_J_kinds", {}))
        mkinds.update(p.get("b_mech_kinds", {}))
    out["b_J_by_kind"] = dict(kinds.most_common())
    out["b_mech_by_kind"] = dict(mkinds.most_common())
    return out


ok = [p for p in per if p["ok"]]
gov = [p for p in ok if p["governed"]]
clean = [p for p in gov if p.get("errors", 0) == 0]
summary = {
    "label": label,
    "replayable": len(per),
    "replayed_ok": len(ok),
    "failed": sorted(c for c, r in rows.items() if not r.get("ok")),
    "not_run": [p["full"] for p in per if p["full"] not in rows],
    "governed": summarize(gov, "governed (0.x demand >= 1)"),
    "last60": summarize(gov[-60:], "last 60 governed"),
    "all": summarize(ok, "all replayed"),
    "governed_no_errors": summarize(clean, "governed, head model elaborates with 0 errors") if clean else None,
    "governed_no_pc_commits": summarize([p for p in gov if not any(k.endswith("producer-changed") for k in p.get("b_J_kinds", {}))], "governed, commits without producer-changed"),
}
json.dump(per, open(f"{outdir}/per-commit.json", "w"), indent=1)
json.dump(summary, open(f"{outdir}/summary.json", "w"), indent=1)

pool = []
for p in gov:
    for i, o in enumerate(rows[p["full"]]["obligations"]):
        if o["budget"] == "judgment":
            pool.append({"commit": p["full"], "subject_line": p["subject"], "index": i, **o})
rng = random.Random(seed)
sample = rng.sample(pool, min(20, len(pool)))
json.dump(sample, open(f"{outdir}/sample20.json", "w"), indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != "not_run"}, indent=1))
print("not_run", len(summary["not_run"]), "pool", len(pool))
