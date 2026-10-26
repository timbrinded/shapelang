"""Compare stock / V-new / V-new2 (/ kernel) on the dumped H3 inputs.

Usage: python3 -I replay-analyze.py OUT_JSON REPLAY_T.jsonl ROWS_T*.jsonl -- REPLAY_DOG.jsonl DOG_BASE.json DOG_ROWS*.jsonl
T inputs are named <task>-<variant>-<arm>-<regime>.input.json (all at tier critical); dogfood inputs
<variant>.input.json.
"""
import json
import sys
from collections import Counter, defaultdict

args = sys.argv[1:]
cut = args.index("--")
out_path, replay_t, *rows_t = args[:cut]
replay_dog, dog_base, *dog_rows = args[cut + 1:]


def jl(p):
    with open(p) as f:
        return [json.loads(x) for x in f if x.strip()]


def law_obs(r):
    return [o for o in r.get("obligations", []) if o["kind"] in ("contradiction", "unestablished")]


def blocks(r):
    return any(o["severity"] == "blocking" for o in law_obs(r)) or any(e["code"] == "E-provider-missing" for e in r.get("errors", []))


meta = {}
for p in rows_t:
    for r in jl(p):
        meta[(r["task"], r["variant"])] = (r["kind"], r["breaks"])

res = {"T": {}, "dog": {}}
tab = defaultdict(lambda: Counter())
for r in jl(replay_t):
    name = r["input"].removesuffix(".input.json")
    task, rest = name.split("-", 1)
    variant, arm, regime = rest.rsplit("-", 2)
    kind, breaks = meta[(task, variant)]
    tagged = (kind == "mutant" and breaks) or kind == "trap"
    k = (arm, regime, r["checker"])
    if tagged:
        tab[k]["tagged"] += 1
        tab[k]["blocked"] += blocks(r)
    if kind == "refactor":
        tab[k]["refactors"] += 1
        tab[k]["refactor_flagged"] += bool(law_obs(r)) or any(e["code"] == "E-provider-missing" for e in r["errors"])
        tab[k]["refactor_blocked"] += blocks(r)
print("== T tasks, critical tier: law-tagged blocked / refactors flagged / refactors blocked")
for k in sorted(tab):
    c = tab[k]
    print(f"  {k[0]} {k[1]} {k[2]:6} blocked {c['blocked']}/{c['tagged']}  refactor flagged {c['refactor_flagged']}/{c['refactors']} blocked {c['refactor_blocked']}/{c['refactors']}")
res["T"] = {" ".join(k): dict(v) for k, v in tab.items()}

# dogfood
base = json.load(open(dog_base))
tested = {v["law"] for v in base["lawVerdicts"] if v["holds"]}
dmeta = {}
heads = {}
for p in dog_rows:
    for r in jl(p):
        if "crash" in r or r["checker"] != "stock":
            continue
        dmeta[r["variant"]] = (r["kind"], r["where"])
        heads[r["variant"]] = {v["law"]: v["holds"] for v in r["lawVerdicts"]}
dtab = defaultdict(lambda: Counter())
rows_by = defaultdict(dict)
for r in jl(replay_dog):
    v = r["input"].removesuffix(".input.json")
    rows_by[v][r["checker"]] = r
    kind, where = dmeta[v]
    failing = {law for law in tested if heads[v].get(law) is not True}
    obs = [o for o in law_obs(r) if o["claim"] in failing]
    key = (kind, where, r["checker"])
    dtab[key]["n"] += 1
    if kind == "mutant":
        dtab[key]["law_blocked"] += any(o["severity"] == "blocking" for o in obs)
    else:
        # refactor: any blocking or owed law obligation that is introduced (tested or not)
        intro = [o for o in law_obs(r) if o["introduced"]]
        dtab[key]["intro_law_obligations"] += bool(intro)
        dtab[key]["intro_blocking_contradiction"] += any(o["kind"] == "contradiction" and o["severity"] == "blocking" for o in intro)
    if "crash" in r:
        dtab[key]["crash"] += 1
print("\n== dogfood (R1c): per kind/location/checker")
for k in sorted(dtab):
    print(f"  {k[0]:8} {k[1]:6} {k[2]:6} {dict(dtab[k])}")
# kernel agreement on dogfood inputs
agree = Counter()
dis = []
for v, by in rows_by.items():
    s, kk = by.get("stock"), by.get("kernel")
    if not s or not kk:
        continue
    if "crash" in kk:
        agree["kernel_crash"] += 1
        continue

    def sig(r):
        return sorted((o["kind"], o["claim"], o["severity"], o["introduced"], o["reason"], o["force"]) for o in law_obs(r))

    agree["cases"] += 1
    agree["verdict"] += s["verdict"] == kk["verdict"]
    agree["law_obligations"] += sig(s) == sig(kk)
    if s["verdict"] != kk["verdict"] or sig(s) != sig(kk):
        dis.append({"variant": v, "stock": [s["verdict"], sig(s)], "kernel": [kk["verdict"], sig(kk)]})
print(f"\n== kernel vs stock on dogfood inputs: {dict(agree)}")
for d in dis[:6]:
    print("  ", json.dumps(d)[:700])
res["dog"] = {"table": {" ".join(k): dict(v) for k, v in dtab.items()}, "kernel": dict(agree), "kernel_disagreements": dis}
json.dump(res, open(out_path, "w"), indent=1)
