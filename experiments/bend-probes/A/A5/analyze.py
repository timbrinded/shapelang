#!/usr/bin/env python3
"""Classify the A5 results.

usage: python3 -I analyze.py <results.jsonl>

Ground truth comes from the oracle only (laws evaluated on enumerated inputs,
behaviour compared with the original); the gate result never decides it.
"""
import json, sys, collections

rows = [json.loads(l) for l in open(sys.argv[1])]

def cls(r):
    if r["main_check"] != "PASS":
        return "stillborn"            # main.bend itself fails type/termination check
    o = r.get("oracle", {})
    if "laws" not in o:
        return "oracle-error"
    lf = any(not v["holds"] for k, v in o["laws"].items() if not k.startswith("_"))
    killed = r["gate"] != "PASS"
    if killed and lf: return "true-kill"
    if killed and not lf: return "killed-law-holds"
    if not killed and not lf: return "survived-law-holds"
    return "UNSOUND"

def falses(r):
    o = r.get("oracle", {})
    return [k for k, v in o.get("laws", {}).items() if not k.startswith("_") and not v["holds"]]

print("| id | kind | behaviour changed | false laws | gate | class | --verdict | note |")
print("|---|---|---|---|---|---|---|---|")
for r in rows:
    o = r.get("oracle", {})
    ch = "n/a" if r["main_check"] != "PASS" else ("yes" if o.get("changed") else "no")
    note = r["main_err"][:60] if r["main_check"] != "PASS" else ""
    print(f"| {r['id']} | {r['kind']} | {ch} | {','.join(falses(r)) or '-'} | {r['gate']} | {cls(r)} | {r.get('verdict', '')} | {note} |")

C = collections.Counter((r["kind"], cls(r), "chg" if r.get("oracle", {}).get("changed") else ("n/a" if r["main_check"] != "PASS" else "same")) for r in rows)
print()
for k, v in sorted(C.items()):
    print(k, v)

mut = [r for r in rows if r["kind"] == "mutant"]
comp = [r for r in mut if r["main_check"] == "PASS"]
nonequiv = [r for r in comp if r["oracle"].get("changed")]
equiv = [r for r in comp if not r["oracle"].get("changed")]
lawfalse = [r for r in comp if falses(r)]
k_ne = [r for r in nonequiv if r["gate"] != "PASS"]
k_lf = [r for r in lawfalse if r["gate"] != "PASS"]
ref = [r for r in rows if r["kind"] == "refactor"]
ref_same = [r for r in ref if r["main_check"] == "PASS" and not r["oracle"].get("changed")]
ref_broken = [r for r in ref_same if r["gate"] != "PASS"]
eq_broken = [r for r in equiv if r["gate"] != "PASS"]
lh_changed = [r for r in nonequiv if not falses(r)]
lh_changed_killed = [r for r in lh_changed if r["gate"] != "PASS"]
print()
print("mutants", len(mut), "stillborn", len(mut) - len(comp), "compiled", len(comp))
print("non-equivalent (behaviour changed)", len(nonequiv), "killed", len(k_ne), "score %.1f%%" % (100 * len(k_ne) / len(nonequiv)))
print("  of which law false", len(lawfalse), "killed", len(k_lf))
print("  of which law holds", len(lh_changed), "killed (brittle)", len(lh_changed_killed))
print("score incl. stillborn as kills: %d/%d = %.1f%%" % (len(k_ne) + len(mut) - len(comp), len(nonequiv) + len(mut) - len(comp), 100 * (len(k_ne) + len(mut) - len(comp)) / (len(nonequiv) + len(mut) - len(comp))))
print("equivalent mutants", len(equiv), "proof broke", len(eq_broken))
print("refactors", len(ref), "confirmed equivalent", len(ref_same), "proof broke", len(ref_broken), "brittleness %.1f%%" % (100 * len(ref_broken) / len(ref_same)))
allpres = ref_same + equiv
print("all behaviour-preserving edits", len(allpres), "proof broke", len(ref_broken) + len(eq_broken), "%.1f%%" % (100 * (len(ref_broken) + len(eq_broken)) / len(allpres)))
lawpres = allpres + lh_changed
print("all edits where every law still holds", len(lawpres), "proof broke", len([r for r in lawpres if r["gate"] != "PASS"]))
print("unsound (gate PASS, law false)", len([r for r in comp if r["gate"] == "PASS" and falses(r)]))

# per-law pairs
pairs = collections.Counter()
for r in rows:
    if r["main_check"] != "PASS" or "laws" not in r.get("oracle", {}):
        continue
    for law, v in r["oracle"]["laws"].items():
        if law.startswith("_"): continue
        g = r["perlaw"].get(law, "?")
        pairs[("law-false" if not v["holds"] else "law-holds", "gate-" + g)] += 1
print()
print("per (edit, law) pairs:", dict(pairs))
for r in rows:
    if r["main_check"] == "PASS" and "laws" in r.get("oracle", {}):
        for law, v in r["oracle"]["laws"].items():
            if not law.startswith("_") and not v["holds"] and r["perlaw"].get(law) == "PASS":
                print("UNSOUND PAIR", r["id"], law)
