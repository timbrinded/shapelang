"""Compare follow-up runs with the main runs: batch-vs-single agreement for M1,
and byte-identical reruns (determinism). Writes results/extra.json."""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXP  # noqa: E402

RES = os.path.join(EXP, "results")


def load(name):
    recs, batches = {}, []
    with open(os.path.join(RES, f"{name}.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            (recs.__setitem__(r["id"], r) if "id" in r else batches.append(r))
    return recs, batches


out = {}
main1, mainb = load("M1")
single, _ = load("M1single")
agree = [i for i in single if single[i]["status"] == main1[i]["status"]
         and single[i]["diag_kinds"] == main1[i]["diag_kinds"]]
out["batch_validation_M1"] = {
    "sample": len(single), "seed": 7,
    "strata": "40 predicted-survivor (already granted) + 20 destructive-effect + 20 other, seeded",
    "agree_status_and_kind": len(agree),
    "disagreements": [{"id": i, "single": single[i]["status"], "batch": main1[i]["status"]}
                      for i in single if i not in agree],
    "single_run_anomalies": [i for i in single if single[i]["status"] == "anomaly"],
}
det = {}
_, rb = load("M1rerun")
mb = {b["batch"].replace("M1-", ""): b for b in mainb}
det["M1_batches"] = [{"batch": b["batch"], "identical_output": b["sha256"] == mb[b["batch"].replace("M1rerun-", "")]["sha256"]}
                     for b in rb]
for op in ("M2", "M3", "M4"):
    a, _ = load(op)
    b, _ = load(f"{op}rerun")
    det[op] = {"rerun": len(b), "identical_output": sum(1 for i in b if b[i]["sha256"] == a[i]["sha256"])}
base = []
for p in sorted(glob.glob(os.path.join(RES, "baseline_*.txt"))):
    with open(p) as f:
        base.append(f.read())
det["baseline_runs"] = {"runs": len(base), "distinct_outputs": len(set(base)), "output": base[0] if base else None}
out["determinism"] = det
ci = os.path.join(RES, "extra_ci.json")
if os.path.exists(ci):
    with open(ci) as f:
        out.update(json.load(f))
with open(os.path.join(RES, "extra.json"), "w") as f:
    json.dump(out, f, indent=1)
print(json.dumps(out, indent=1)[:3000])
