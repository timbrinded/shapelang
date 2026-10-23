"""Print markdown tables from results.json (pasted into REPORT.md)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXP  # noqa: E402

r = json.load(open(os.path.join(EXP, "results.json")))
s = r["summary"]


def pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


print("### Mutation score per operator (primary universe, full enumeration)\n")
print("| Operator | Generated | Run | Killed | Survived | Anomalies | Score | Killing diagnostics |")
print("|---|---:|---:|---:|---:|---:|---:|---|")
for op, v in s["operators"].items():
    kinds = ", ".join(f"{k} {n}" for k, n in sorted(v["diag_kinds"].items()))
    print(f"| {op} | {v['mutants_generated']} | {v['mutants_run']} | {v['killed']} | {v['survived']} | {v['anomaly']} | {pct(v['mutation_score'])} | {kinds} |")
print("\n### Secondary strata (seeded samples, seed 7)\n")
print("| Stratum | Sampled | Killed | Survived | Anomalies | Score | Killing diagnostics |")
print("|---|---:|---:|---:|---:|---:|---|")
for op, v in s["secondary"].items():
    kinds = ", ".join(f"{k} {n}" for k, n in sorted(v["diag_kinds"].items()))
    print(f"| {op} | {v['mutants_run']} | {v['killed']} | {v['survived']} | {v['anomaly']} | {pct(v['mutation_score'])} | {kinds} |")
print("\n### Probes (not scored)\n")
print("| Probe | Run | Killed | Survived | Anomalies |")
print("|---|---:|---:|---:|---:|")
for op, v in s["probes"].items():
    print(f"| {op} | {v['mutants_run']} | {v['killed']} | {v['survived']} | {v['anomaly']} |")
print("\n### M1 by effect name\n")
print("| Effect | Killed | Survived |")
print("|---|---:|---:|")
for e, v in s["operators"]["M1"]["by_effect"].items():
    print(f"| {e} | {v.get('killed', 0)} | {v.get('survived', 0)} |")
print("\n### Kills per claim\n")
print("| Claim | Type | Kills (total) | By operator | Unique kills |")
print("|---|---|---:|---|---:|")
for c in r["claims"]:
    by = ", ".join(f"{k} {v}" for k, v in sorted(c["kills_by_op"].items())) or "none"
    print(f"| `{c['claim']}` | {c['type']} | {c['kills_total']} | {by} | {c['unique_kills_total']} |")
print("\n### M3 survivors by structural class\n")
print("| Class | Killed | Survived |")
print("|---|---:|---:|")
for k, v in r["M3_classes"].items():
    print(f"| {k} | {v.get('killed', 0)} | {v.get('survived', 0)} |")
if "M4_classes" in r:
    print("\n### M4 by target class\n")
    print("| Class | Killed | Survived |")
    print("|---|---:|---:|")
    for k, v in r["M4_classes"].items():
        print(f"| {k} | {v.get('killed', 0)} | {v.get('survived', 0)} |")
print("\n### M3 by module pair (source module -> target module)\n")
print("| Module pair | Killed | Survived |")
print("|---|---:|---:|")
for k, v in r["M3_by_module_pair"].items():
    print(f"| {k} | {v.get('killed', 0)} | {v.get('survived', 0)} |")
print("\n### Grants: vacuous (M2 survivor) and most-masking\n")
print("| Grant | M2 | Dependent effect entries | M1 mutants it masks |")
print("|---|---|---:|---:|")
rows = sorted(r["grants"], key=lambda g: (g["m2_status"] != "survived", -g["m1_mutants_masked"]))
for g in rows[:15]:
    print(f"| `{g['grant']}` | {g['m2_status']} | {g['dependent_effect_entries']} | {g['m1_mutants_masked']} |")
print("\nM1 survivors by component:", r["M1_survivors_by_component"])
