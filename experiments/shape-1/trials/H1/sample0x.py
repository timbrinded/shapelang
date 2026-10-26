"""Seeded sample of 20 0.x coverage demands (commit, governed file) for hand checking.

python3 -I experiments/shape-1/trials/H1/sample0x.py <zerox.json> <out.json> [--seed N]
"""

import json
import random
import sys

rows = json.load(open(sys.argv[1]))
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261026
pool = [{"commit": r["commit"], "subject": r["subject"], "file": f} for r in rows for f in r["demand"]["files"]]
pool += [{"commit": r["commit"], "subject": r["subject"], "guard": g} for r in rows for g in r["demand"]["guards"]]
sample = random.Random(seed).sample(pool, 20)
json.dump(sample, open(sys.argv[2], "w"), indent=1)
print(len(pool))
for s in sample:
    print(s["commit"][:7], s.get("file") or s.get("guard"), "|", s["subject"][:60])
