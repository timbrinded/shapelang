"""E2: exact spec closure from Verus VIR vs the name-based bracket.
Usage: e2_closure.py VIR_FILE VPROBE_HEAD_JSONL PATH_PREFIX OUT_JSON"""
import json
import re
import statistics
import sys
from collections import defaultdict

vir_path, head_path, prefix, out_path = sys.argv[1:5]
src = open(vir_path).read()


def group_after(text, key):
    """Return the balanced s-expression that follows `key` in text, or ''."""
    i = text.find(key)
    if i < 0:
        return ""
    j = text.find("(", i + len(key))
    # The value may be an atom (e.g. `None`) rather than a group.
    k = i + len(key)
    while k < len(text) and text[k] == " ":
        k += 1
    if k >= len(text) or text[k] != "(":
        return ""
    depth = 0
    for p in range(k, len(text)):
        c = text[p]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return text[k:p + 1]
    return ""


FUN = re.compile(r"\(Fun :path ([^\s()]+)\)")
funs = {}
for block in src.split("\n;; ")[1:]:
    header, _, body = block.partition("\n")
    if not body.lstrip().startswith("(Function"):
        continue
    m = re.match(r"(\S+?):(\d+):\d+:", header)
    name = re.search(r":name \(Fun :path ([^\s()]+)\)", body).group(1)
    mm = re.search(r":owning_module\s+\S+\s+:mode\s+(\w+)", body)
    if not mm:
        continue
    mode = mm.group(1)
    req, ens = group_after(body, ":require "), group_after(body, ":ensure ")
    fbody = group_after(body, ":body ")
    ext = ":is_external_body true" in body
    funs[name] = {
        "file": m.group(1) if m else "", "line": int(m.group(2)) if m else 0, "mode": mode, "ext": ext,
        "contract_refs": set(FUN.findall(req + ens)) - {name},
        "body_refs": set(FUN.findall(fbody)) - {name},
        "size": len(req) + len(ens) + (len(fbody) if mode == "Spec" else 0),
    }


def vir_closure(f, crate_only):
    seen, stack = set(), [r for r in funs[f]["contract_refs"]]
    while stack:
        g = stack.pop()
        if g in seen or g not in funs or funs[g]["mode"] != "Spec":
            continue
        if crate_only and not g.startswith("lib::"):
            continue
        seen.add(g)
        stack.extend(funs[g]["contract_refs"] | funs[g]["body_refs"])
    return seen


# Name-based closure from the syntactic extractor (same algorithm as walk.py).
rows = [json.loads(l) for l in open(head_path)]
spec_defs = defaultdict(list)
fn_rec = []
for r in rows:
    for f in r["fns"]:
        f["path"] = r["path"]
        if f["mode"] == "spec":
            spec_defs[f["key"].split("::")[-1].split("#")[0]].append(f)
        fn_rec.append(f)


def name_closure(f, unambiguous_only):
    names, frontier, tokens = set(), [i for i in f["cids"] if i in spec_defs], 0
    while frontier:
        n = frontier.pop()
        if n in names:
            continue
        defs = spec_defs[n]
        if unambiguous_only and len(defs) > 1:
            continue
        names.add(n)
        for g in defs:
            tokens += g["contract_n"] + g["body_n"]
            frontier.extend(i for i in set(g["cids"]) | set(g["bids"]) if i in spec_defs)
    return names, tokens


by_loc = defaultdict(list)
for f in fn_rec:
    by_loc[(f["path"].split(prefix, 1)[-1], f["key"].split("::")[-1].split("#")[0])].append(f)

# vprobe token size for a VIR spec fn, via (file, name) with the nearest start line.
def vprobe_for(g):
    cands = by_loc.get((funs[g]["file"], g.split("::")[-1]), [])
    if not cands:
        return None
    return min(cands, key=lambda f: abs(f["span"][0] - funs[g]["line"]))


out = []
for name, fv in funs.items():
    if fv["mode"] != "Exec" or fv["ext"] or not name.startswith("lib::"):
        continue
    f = vprobe_for(name)
    if f is None or f["mode"] != "exec":
        continue
    exact = vir_closure(name, crate_only=True)
    exact_all = vir_closure(name, crate_only=False)
    exact_tokens = sum((vprobe_for(g) or {}).get("contract_n", 0) + (vprobe_for(g) or {}).get("body_n", 0) for g in exact)
    lo, lo_t = name_closure(f, True)
    up, up_t = name_closure(f, False)
    out.append({"fn": name, "exec_n": f["exec_n"], "clause_n": f["clause_n"], "exact_n": len(exact), "exact_all_n": len(exact_all),
                "exact_tokens": exact_tokens, "lo_n": len(lo), "lo_tokens": lo_t, "up_n": len(up), "up_tokens": up_t})

json.dump(out, open(out_path, "w"))
n = len(out)
med = lambda k: statistics.median([o[k] for o in out])
print(f"matched exec fns: {n}")
print(f"spec fns in closure (crate only): median exact {med('exact_n')}, name-lower {med('lo_n')}, name-upper {med('up_n')}; incl. vstd exact {med('exact_all_n')}")
print(f"closure tokens: median exact {med('exact_tokens')}, lower {med('lo_tokens')}, upper {med('up_tokens')}")
inside = sum(1 for o in out if o["lo_tokens"] <= o["exact_tokens"] <= o["up_tokens"])
below = sum(1 for o in out if o["exact_tokens"] < o["lo_tokens"])
above = sum(1 for o in out if o["exact_tokens"] > o["up_tokens"])
print(f"exact inside [lower, upper]: {inside}/{n}; below lower: {below}; above upper: {above}")
ratio = [(o["clause_n"] + o["exact_tokens"]) / o["exec_n"] for o in out if o["exec_n"] > 0]
print(f"(clauses + exact closure) / exec tokens per fn: median {statistics.median(ratio):.2f}, p75 {sorted(ratio)[int(.75*len(ratio))]:.2f}, p90 {sorted(ratio)[int(.9*len(ratio))]:.2f}")
rel = [o["exact_tokens"] / o["lo_tokens"] for o in out if o["lo_tokens"] > 0]
if rel:
    print(f"exact / lower token ratio where lower>0: median {statistics.median(rel):.2f} (n={len(rel)})")
