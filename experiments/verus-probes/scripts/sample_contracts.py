"""Sample contract-change events from non-mechanical commits and classify what
changed: clauses (requires/ensures/...) vs signature only. Prints examples.
Usage: sample_contracts.py SCRATCH"""
import json
import os
import random
import re
import subprocess
import sys
import tempfile

sp = sys.argv[1]
vprobe = os.path.join(sp, "vprobe/target/release/vprobe")
MECH = re.compile(r"verusfmt|\bfmt\b|format|migrat|deprecat|adapt|compatib|latest verus|new verus|newer verus|update.* verus|verus update|upgrade|bump|update for|new default|new syntax|syntax", re.I)
rng = random.Random(7)
tmp = tempfile.mkdtemp()


def show(repo, rev, path):
    r = subprocess.run(["git", "-C", repo, "show", f"{rev}:{path}"], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def extract(data):
    fp = os.path.join(tmp, "x.rs")
    open(fp, "wb").write(data)
    out = subprocess.run([vprobe, fp], capture_output=True, text=True, env={**os.environ, "VPROBE_TEXT": "1"}).stdout
    return json.loads(out)


totals = {"clauses": 0, "sig_only": 0}
examples = []
for name in sorted(os.listdir(os.path.join(sp, "results"))):
    if not name.endswith(".json"):
        continue
    d = json.load(open(os.path.join(sp, "results", name)))
    repo = os.path.join(sp, "repos", d["repo"])
    cands = [r for r in d["rows"] if r["exec_contract"] > 0 and r["parse_fail"] == 0 and r["added_files"] < 10
             and not MECH.search(r["subject"]) and r.get("toolchain_files", 0) == 0]
    rng.shuffle(cands)
    per = {"clauses": 0, "sig_only": 0}
    for r in cands[:25]:
        c = r["commit"]
        files = subprocess.run(["git", "-C", repo, "diff", "--name-only", "--diff-filter=M", f"{c}^1", c, "--", "*.rs"],
                               capture_output=True, text=True).stdout.split()
        for f in files:
            a, b = show(repo, f"{c}^1", f), show(repo, c, f)
            if not a or not b:
                continue
            ea, eb = extract(a), extract(b)
            fa = {x["key"]: x for x in ea["fns"]}
            for x in eb["fns"]:
                y = fa.get(x["key"])
                if not y or x["mode"] != "exec" or set(x["flags"]) & {"external_body", "external"}:
                    continue
                if y["contract_h"] == x["contract_h"]:
                    continue
                kind = "clauses" if y["clause_h"] != x["clause_h"] else "sig_only"
                per[kind] += 1
                if len(examples) < 400:
                    examples.append((d["repo"], r["subject"][:70], x["key"], kind, y["contract_txt"], x["contract_txt"]))
    print(f"{d['repo']:27} sampled commits {min(25, len(cands))}: clause changes {per['clauses']}, signature-only {per['sig_only']}")
    for k in totals:
        totals[k] += per[k]
print("TOTAL", totals)
json.dump(examples, open(os.path.join(sp, "contract_examples.json"), "w"))
