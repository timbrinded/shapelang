"""Write id files for the validation / determinism follow-up runs (seed 7)."""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXP, short  # noqa: E402

rng = random.Random(7)
OUT = os.path.join(EXP, "mutants", "ids")
os.makedirs(OUT, exist_ok=True)


def load(op):
    with open(os.path.join(EXP, "mutants", f"{op}.json")) as f:
        return json.load(f)


m1 = load("M1")
granted = [m["id"] for m in m1 if m["granted_already"]]
destructive = [m["id"] for m in m1 if not m["granted_already"] and m["effect"] in
               ("HardDelete", "Truncate", "DropStorage", "Redact", "LogicalDelete")]
dset = set(destructive)
other = [m["id"] for m in m1 if not m["granted_already"] and m["id"] not in dset]
single = rng.sample(granted, 40) + rng.sample(destructive, 20) + rng.sample(other, 20)
json.dump(single, open(os.path.join(OUT, "M1single.json"), "w"))

# determinism: rerun relation / grant mutants singly
for op, k in (("M2", 10), ("M3", 30), ("M4", 30)):
    ids = [m["id"] for m in load(op)]
    json.dump(rng.sample(ids, k), open(os.path.join(OUT, f"{op}rerun.json"), "w"))

# determinism: rerun three whole M1 component batches
comps = sorted({short(m["component"]) for m in m1})
pick = rng.sample(comps, 3)
json.dump([m["id"] for m in m1 if short(m["component"]) in pick], open(os.path.join(OUT, "M1rerun.json"), "w"))
print("M1single", len(single), "M1rerun comps", pick)
