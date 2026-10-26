"""DRT triage: side-by-side internals of the differing obligations of one case under a fix config.
Usage: python3 -I why.py <D> <caseId> <tsFixes> <kFixes> [norms]
Runs the patched prototype copy (protodbg) and kernel copy (kdbg, via kobdump) on the case."""
import json, os, subprocess, sys

D, cid, TSF, KF = sys.argv[1:5]
norms = sys.argv[5] if len(sys.argv) > 5 else "N1,N2,N3,NW"
sys.path.insert(0, os.path.dirname(__file__))
import compare  # noqa: E402

path = None
for lst in ("corpus/all.tsv", "corpus/fixtures.tsv"):
    p = os.path.join(D, lst)
    if os.path.exists(p):
        for line in open(p):
            if line.split("\t")[0] == cid:
                path = line.rstrip("\n").split("\t")[1]
env = dict(os.environ, DRT_FIX="" if TSF == "-" else TSF)
ts = json.loads(subprocess.run(["bun", f"{D}/protodbg/dbg.ts", path], capture_output=True, text=True, env=env, cwd="/home/user/shapelang").stdout)
k = json.load(open(f"{D}/kcase/{cid}.kcase.json"))
k["drtFix"] = [] if KF == "-" else KF.split(",")
tmp = f"{D}/why.kcase.json"
json.dump(k, open(tmp, "w"))
lean = json.loads(subprocess.run([f"{D}/kdbg/.lake/build/bin/shapek", tmp], capture_output=True, text=True).stdout)
dump = json.loads(subprocess.run([f"{D}/kdbg/.lake/build/bin/kobdump", tmp], capture_output=True, text=True).stdout)
from importlib import import_module  # noqa: E402
sys.path.insert(0, os.path.dirname(__file__))
proj = import_module("project_py") if False else None
tsP = {"verdict": ts["verdict"], "errors": [{"code": e["code"], "subject": e["subject"]} for e in ts["errors"]],
       "obligations": ts["obligations"], "answered": [{"obligation": a["obligation"], "as": a["as"]} for a in ts["answered"]],
       "debt": ts["debt"]}
diffs, stats = compare.compare(tsP, lean, k, set(norms.split(",")))
print(f"{cid}: ts {ts['verdict']} lean {lean['verdict']}; {len(diffs)} diffs")
for d in diffs:
    print("  DIFF", d["sig"], json.dumps(d["detail"])[:240])
keys = {d["detail"].get("key") for d in diffs if isinstance(d["detail"], dict)}
T = {o["key"]: o for o in ts["obligations"]}
R = {o["key"]: o for o in dump["raw"]}
for key in sorted(x for x in keys if x):
    print("=" * 30, key[:16])
    if key in T:
        o = T[key]
        print("  TS  ", o["kind"], o.get("reason"), o.get("questions"), "tier", o["tier"], "sev", o["severity"], "intro", o["introduced"], "expl", o.get("exploited"), "rule", o.get("rule"))
        print("  TS   subject", json.dumps(o["subject"])[:150], "claim", (o.get("claim") or {}).get("ids"))
        print("  TS   affected", o.get("affected"))
        print("  TS   code", o.get("x_code"))
        print("  TS   delta", o.get("x_delta"))
        print("  TS   witness", o.get("witness"), "support", o.get("x_support"))
        print("  TS   causes", [(c["type"], c.get("text", "")[:100]) for c in o.get("causes", [])][:6])
    if key in R:
        r = R[key]
        print("  K   ", r["kind"], r.get("reason"), r.get("questions"), "tier", r["tier"], "intro", r["introduced"], "expl", r.get("exploited"))
        print("  K    affected", r["affected"])
        print("  K    code", r["code"])
        print("  K    delta", r["delta"])
        print("  K    witness", r["witness"])
print("K parts", [(p["subject"][:24], p["question"], p["tier"], p["delta"][:2], p["affected"][:4], p["exploited"]) for p in dump["parts"]][:30])
print("TS loosening rows", [(r["subject"][:24], r["question"], r["answer"], r.get("affected", [])[:4]) for r in ts.get("loosening", [])][:30])
