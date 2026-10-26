"""Which forward L1 parts would vanish if L1 counted the head's own complete summaries?
For each L1 part the kernel reports (KDump, default-binding workaround), a (position, atom) pair is
'summary-bounded' when the position is the bound identity of a head unit with effects.upper(u, C)
and the atom is outside cl(C) (C closed under std `implies`); such a world is rejected by the
head's summary, so the pair is not a world the head admits. A loosening obligation is spurious
under that reading when every pair of every part is summary-bounded (cells never are).
Usage: python3 -I summary_bound.py <outDir>"""
import json, os, sys

OUT = sys.argv[1]
IMPLIES = {"Export": ["Read"], "Append": ["Write"], "Import": ["Write"], "Update": ["Write"], "Redact": ["Update"],
           "LogicalDelete": ["Update"], "HardDelete": ["Update"], "Truncate": ["HardDelete"], "DropStorage": ["Truncate"]}


def up(v):
    out, todo = {v}, [v]
    while todo:
        for w in IMPLIES.get(todo.pop(), []):
            if w not in out:
                out.add(w); todo.append(w)
    return out


def closure(atoms):
    cl = set()
    for a in atoms:
        verb, res = a.split("<", 1)
        cl |= {f"{w}<{res}" for w in up(verb)}
    return cl


tot_obs = spurious_obs = 0
rows = []
for f in sorted(os.listdir(OUT)):
    if not f.endswith(".fwd.kdump-prebind.json"):
        continue
    cid = f.split(".")[0]
    d = json.load(open(os.path.join(OUT, f)))
    kc = json.load(open(os.path.join(OUT, f"{cid}.fwd.kcase-prebind.json")))
    esf = kc["head"]["esf"]
    bind = {u["q"]: u.get("bind") for u in esf["units"]}
    summ = {}
    for c in esf["claims"]:
        if c["op"] == "effects.upper":
            b = bind.get(c["args"]["unit"])
            if b:
                summ[b] = closure(c["args"]["atoms"])
    by = {}
    for p in d["parts"]:
        if p["question"] != "L1":
            continue
        by.setdefault(p["subject"], []).append(p)
    for subj, ps in by.items():
        pairs = [tuple(r) for p in ps for r in p["realise"]]
        cells = sum(1 for p in ps for a in p["affected"] if a.startswith("cell:"))
        bounded = [pr for pr in pairs if pr[0] in summ and pr[1] not in summ[pr[0]]]
        spurious = cells == 0 and len(pairs) > 0 and len(bounded) == len(pairs)
        tot_obs += 1
        spurious_obs += spurious
        rows.append((cid, subj[:40], len(pairs), cells, len(bounded), spurious))
print(f"forward L1 obligations: {tot_obs}; spurious when head summaries count: {spurious_obs}")
for r in rows:
    print("  %-34s %-40s pairs=%d cells=%d summary-bounded=%d spurious=%s" % r)
