"""DRT triage viewer: for a saved differing case, prints each differing obligation from the
prototype (full output: affected, rule, causes) next to the kernel's internals (kobdump).
Usage: python3 -I show.py <saveDir> <stem> [<kobdump>]   (stem e.g. s17)"""
import json, subprocess, sys

save, stem = sys.argv[1], sys.argv[2]
kob = sys.argv[3] if len(sys.argv) > 3 else None
ts = json.load(open(f"{save}/{stem}.ts.json"))
lean = json.load(open(f"{save}/{stem}.lean.json"))
dump = None
if kob:
    out = subprocess.run([kob, f"{save}/{stem}.kcase.json"], capture_output=True, text=True).stdout
    dump = json.loads(out)
F = ["kind", "reason", "questions", "introduced", "severity", "tier", "budget", "force", "owner", "group", "claim", "subject", "witness", "exploited", "final", "binding", "exception"]
T = {o["key"]: o for o in ts["obligations"]}
L = {o["key"]: o for o in lean["obligations"]}
R = {o["key"]: o for o in (dump or {}).get("raw", [])}
print("verdict ts", ts["verdict"], "lean", lean["verdict"])
print("errors ts", [(e["code"], e["subject"]) for e in ts["errors"]])
print("errors lean", [(e["code"], e["subject"]) for e in lean["errors"]])
print("answered ts", [(a["obligation"][:14], a["as"]) for a in ts["answered"]], "lean", [(a["obligation"][:14], a["as"]) for a in lean["answered"]])
print("debt ts", ts["debt"], "lean", lean["debt"])
for k in sorted(set(T) | set(L)):
    t, l = T.get(k), L.get(k)
    diff = [f for f in F if (t or {}).get(f) != (l or {}).get(f)] if t and l else ["(missing)"]
    if t and l and f"{t.get('claim') and {**t['claim'], 'ids': sorted(t['claim']['ids'])}}" == f"{l.get('claim')}":
        diff = [f for f in diff if f != "claim"]
    if not diff:
        continue
    print("=" * 100)
    print(k[:20], "only-ts" if not l else "only-lean" if not t else "diff " + ",".join(diff))
    if t:
        print("  TS  ", {f: t.get(f) for f in ["kind", "reason", "questions", "severity", "tier", "force", "introduced", "exploited", "owner", "exception", "budget"]})
        print("  TS   subject", json.dumps(t.get("subject")), "claim", (t.get("claim") or {}).get("ids"), "rule", t.get("rule"), "matched", t.get("matched"))
        print("  TS   affected", t.get("affected"), "witness", [w[:15] for w in t.get("witness", [])])
        print("  TS   causes", [(c["type"], c["id"][:30], c.get("text", "")[:120]) for c in t.get("causes", [])][:8])
        print("  TS   dischargers", [(d["act"], d.get("eligible")) for d in t.get("dischargers", [])])
    if l:
        print("  LEAN", {f: l.get(f) for f in ["kind", "reason", "questions", "severity", "tier", "force", "introduced", "exploited", "owner", "exception", "budget"]})
        print("  LEAN witness", [w[:15] for w in l.get("witness", [])])
    if k in R:
        r = R[k]
        print("  KOB  affected", r["affected"], "code", r["code"], "delta", r["delta"])
        print("  KOB  excl", [x[:15] for x in r["excl"]], "exclOwners", r["exclOwners"], "answerable", r["answerable"], "mech", r["mechanical"], "unmetFinal", r["unmetFinal"], "reqInDelta", r["reqInDelta"])
if dump:
    print("=" * 100)
    for law in dump["laws"]:
        print("LAW", law["ids"], "R*", law["reqStar"], "sat", law["sat"], "req", law["req"])
        for rec in law["records"]:
            print("   rec", rec["id"][:15], {k: v for k, v in rec.items() if k not in ("id",)})
    print("PARTS", [(p["subject"][:20], p["question"], p["tier"], p["delta"], p["affected"], p["exploited"]) for p in dump["parts"]])
    print("UNCOVERED", dump["uncovered"], "coverageSet", dump["coverageSet"])
    print("discharged", [d[:14] for d in dump["discharged"]], "authors", dump["authors"])
    print("lean loosening rows ts:", [(r["subject"][:20], r["question"], r["answer"], r["affected"]) for r in ts.get("loosening", [])])
