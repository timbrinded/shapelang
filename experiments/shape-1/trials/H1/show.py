"""Print one 1.0 obligation with its commit context, for hand checking.

python3 -I experiments/shape-1/trials/H1/show.py <outdir-with-*.out.json.gz> <commit> <obligation key prefix>
"""

import glob
import gzip
import json
import subprocess
import sys

outdir, commit, key = sys.argv[1], sys.argv[2], sys.argv[3]
path = glob.glob(f"{outdir}/{commit}*.out.json.gz")[0]
commit = path.rsplit("/", 1)[1].split(".")[0]
out = json.loads(gzip.open(path).read())
obs = [o for o in out["obligations"] if o["key"].startswith(key)]
for o in obs:
    slim = {k: o.get(k) for k in ["key", "kind", "reason", "questions", "introduced", "severity", "tier", "budget", "force", "owner", "group", "claim", "subject", "affected", "rule", "exploited", "final", "facts", "counterexample"]}
    print(json.dumps(slim, indent=1)[:6000])
    print("message:", (o.get("message") or "")[:3000])
    for c in o.get("causes", [])[:12]:
        print("  cause:", c.get("type"), c.get("id"), (c.get("text") or "")[:300])
    for d in o["dischargers"]:
        print("  discharger:", d["act"], d["by"], d.get("agentSafe"), d.get("command", ""))
    for lo in out.get("loosening", []):
        if lo["obligation"] == o["key"]:
            print("  loosening part:", json.dumps(lo)[:1500])
print(subprocess.run(["git", "-C", "/home/user/shapelang", "show", "--stat=200", "--format=%h %s%n%b", commit], capture_output=True, text=True).stdout[:4000])
