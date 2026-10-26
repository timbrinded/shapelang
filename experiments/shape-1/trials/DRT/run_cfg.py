"""DRT configuration driver: runs the patched prototype copy and the patched kernel copy with given
fix sets over a case list (cached per fix set), compares with given normalisations and prints the
residual signatures.
Usage: python3 -I run_cfg.py <D> <list.tsv> <tsFixes|-> <kFixes|-> <norms|-> <name> [shards] [--fresh]
<D> is the scratch work dir holding protodbg/, kdbg/, kcase/, out/, cmp/."""
import collections, json, os, shutil, subprocess, sys

D, LIST, TSF, KF, NORMS, NAME = sys.argv[1:7]
SH = int(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7].isdigit() else 4
FRESH = "--fresh" in sys.argv
REPO = "/home/user/shapelang"
TRIAL = f"{REPO}/experiments/shape-1/trials/DRT"
tag = lambda f: "none" if f == "-" else f.replace(",", "+")
tsdir = f"{D}/out/ts-{tag(TSF)}"
kdir = f"{D}/out/k-{tag(KF)}"
for d in (tsdir, kdir):
    if FRESH and os.path.isdir(d):
        shutil.rmtree(d)
env = dict(os.environ, DRT_FIX="" if TSF == "-" else TSF)
procs = [subprocess.Popen(["bun", f"{TRIAL}/run-ts.ts", f"{D}/protodbg/src/derive.ts", LIST, tsdir, "--shard", f"{i}/{SH}"], cwd=REPO, env=env) for i in range(SH)]
for p in procs:
    p.wait()
procs = [subprocess.Popen(["bun", f"{TRIAL}/run-k.ts", f"{D}/kdbg/.lake/build/bin/shapek", LIST, f"{D}/kcase", kdir, "-" if KF == "-" else KF, "600000", "--shard", f"{i}/{SH}"], cwd=REPO) for i in range(SH)]
for p in procs:
    p.wait()
os.makedirs(f"{D}/cmp", exist_ok=True)
out = f"{D}/cmp/{NAME}.jsonl"
subprocess.run(["python3", "-I", f"{TRIAL}/compare.py", LIST, tsdir, kdir, f"{D}/kcase", NORMS, out], check=True)
rows = [json.loads(l) for l in open(out)]
st = collections.Counter(r["status"] for r in rows)
c = collections.Counter()
ex = {}
for r in rows:
    for s in set(d["sig"] for d in r.get("diffs", [])):
        c[s] += 1
        ex.setdefault(s, r["id"])
print(NAME, dict(st))
for k, v in c.most_common(int(os.environ.get("TOP", "60"))):
    print(f"  {v:5d} {k}  e.g. {ex[k]}")
print("  distinct signatures:", len(c))
