"""Supplementary seeded sample: 20 introduced judgment-class 1.0 obligations that are NOT
producer-changed, from the governed population (H1 hand check, stratum 2).

python3 -I experiments/shape-1/trials/H1/sample_nonpc.py <outdir-of-analyze.py> <rows.jsonl> [--seed N]
"""

import json
import random
import sys

outdir, rows_path = sys.argv[1], sys.argv[2]
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261027
gov = {p["full"]: p["subject"] for p in json.load(open(f"{outdir}/per-commit.json")) if p["governed"] and p["ok"]}
pool = []
for line in open(rows_path):
    r = json.loads(line)
    if r["commit"] not in gov:
        continue
    for o in r["obligations"]:
        if o["budget"] == "judgment" and o["reason"] != "producer-changed":
            pool.append({"commit": r["commit"], "subject_line": gov[r["commit"]], **o})
sample = random.Random(seed).sample(pool, 20)
json.dump(sample, open(f"{outdir}/sample20-nonpc.json", "w"), indent=1)
print(len(pool))
for i, o in enumerate(sample):
    print(i + 1, o["commit"][:7], o["key"][:16], o["kind"], o["reason"], o["questions"], o["severity"], o["tier"], o["claim"], json.dumps(o["subject"])[:70], "|", o["subject_line"][:45])
