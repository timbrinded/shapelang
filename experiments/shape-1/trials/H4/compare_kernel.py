"""Obligation-level comparison of the prototype and the Lean kernel on every H4 run: loosening
obligations matched by key; fields questions, exploited, final, tier, severity and binding.
Usage: python3 -I compare_kernel.py <outDir> [variant]   (variant: '' or '-prebind')"""
import json, os, sys
OUT = sys.argv[1]
VAR = sys.argv[2] if len(sys.argv) > 2 else ""
FIELDS = ["questions", "exploited", "final", "tier", "severity", "binding"]
tot = agree_cases = 0
field_tot = field_ok = 0
only_p = only_k = 0
diffs = {}
for f in sorted(os.listdir(OUT)):
    if not f.endswith(".proto.json"):
        continue
    stem = f[: -len(".proto.json")]
    p = json.load(open(os.path.join(OUT, f)))
    kp = os.path.join(OUT, f"{stem}.kernel{VAR}.json")
    if not os.path.exists(kp):
        continue
    k = json.load(open(kp))
    P = {o["key"]: o for o in p.get("obligations", []) if o["kind"] == "loosening"}
    K = {o["key"]: o for o in k.get("obligations", []) if o["kind"] == "loosening"}
    tot += 1
    d = []
    for key in P.keys() - K.keys():
        only_p += 1; d.append(f"only proto {P[key]['subject'][:40]} {P[key]['questions']}")
    for key in K.keys() - P.keys():
        only_k += 1; d.append(f"only kernel {K[key]['subject'][:40]} {K[key]['questions']}")
    for key in P.keys() & K.keys():
        for fld in FIELDS:
            field_tot += 1
            pv, kv = P[key].get(fld), K[key].get(fld)
            if fld == "questions":
                pv = sorted(q for q in pv if q != "L6"); kv = sorted(kv)
            if pv == kv:
                field_ok += 1
            else:
                d.append(f"{P[key]['subject'][:40]} {fld}: proto={pv} kernel={kv}")
    if p.get("verdict") != k.get("verdict"):
        d.append(f"verdict proto={p.get('verdict')} kernel={k.get('verdict')}")
    if not d:
        agree_cases += 1
    else:
        diffs[stem] = d
print(f"runs {tot}; runs with identical loosening obligations and verdict: {agree_cases}; obligations only in proto: {only_p}, only in kernel: {only_k}; shared fields equal: {field_ok}/{field_tot} (L6 removed from proto questions, the kernel has no L6)")
for s, d in diffs.items():
    print(f"- {s}")
    for x in d:
        print(f"    {x}")
