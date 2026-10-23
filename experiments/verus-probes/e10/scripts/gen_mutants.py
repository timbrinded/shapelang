"""Generate first-order model mutants for E10.

Writes mutants/*.json. Every mutant is a list of text edits against the
pristine copy plus metadata naming the mutated declaration.

Universes
  M1 add-effect     every authored fn with `effects complete` x 10 effect names
                    x 79 authored resources, skipping effects already present
                    (full enumeration, batched per component at run time).
                    Secondary stratum: seeded sample over generated resources.
  M2 remove-grant   every authored `grants` line (full enumeration, run singly).
  M3 add-calls      every ordered pair of distinct authored components with no
                    existing `calls` relation in that direction (full, singly).
                    Secondary stratum: seeded sample of pairs involving at
                    least one generated-AST component.
  M4 add-provides   every authored component x authored resource pair that no
                    existing relation links (full, singly). Secondary stratum:
                    seeded sample involving generated components/resources.
  M5 probes         no rule constrains `callbacks` or `coordinated_call`, so the
                    operator is skipped as specified; a small labelled probe
                    set confirms the gap (not scored).
  HO probes         higher-order controls (effect + matching grant), batched.
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EFFECTS, EXP, load_model, scan_authored_file, short  # noqa: E402

SEED = 7
OUT = os.path.join(EXP, "mutants")
os.makedirs(OUT, exist_ok=True)

d = load_model()
A_COMPS = [c for c in d["components"] if c["origin"] == "authored"]
G_COMPS = [c for c in d["components"] if c["origin"] != "authored"]
A_RES = [r for r in d["resources"] if r["origin"] == "authored"]
G_RES = [r for r in d["resources"] if r["origin"] != "authored"]
FUNCS = {f["id"]: f for f in d["functions"]}
COMP_BY_ID = {c["id"]: c for c in d["components"]}
AUTHORED_FILES = sorted({c["file"] for c in A_COMPS})

scan = {}
for f in AUTHORED_FILES:
    for comp, info in scan_authored_file(f).items():
        scan[(f, comp)] = info

# ---- validate the text scan against the inspect JSON -----------------------
n_fn = 0
for c in A_COMPS:
    info = scan[(c["file"], c["name"])]
    assert len(info["grants"]) == len(c["grants"]), (c["id"], len(info["grants"]), len(c["grants"]))
    for fid in c["functions"]:
        f = FUNCS[fid]
        if f["effectsComplete"]:
            assert f["name"] in info["fns"], fid
            n_fn += 1
print("authored fns with effects complete:", n_fn)


def m1_line(effect, res):
    return f"      {effect}<{res['id']}>"


mutants = {"M1": [], "M1gen": [], "M2": [], "M3": [], "M3gen": [], "M4": [], "M4gen": [],
           "M5probe": [], "HOprobe": []}

# ---- M1 add-effect (authored resources, full) ------------------------------
for c in A_COMPS:
    info = scan[(c["file"], c["name"])]
    for fid in sorted(c["functions"]):
        f = FUNCS[fid]
        if not f["effectsComplete"]:
            continue
        present = {(e["name"], e.get("target")) for e in f["effects"]}
        line = info["fns"][f["name"]]
        for E in EFFECTS:
            for r in A_RES:
                if (E, r["id"]) in present:
                    continue
                granted = any(g["name"] == E and g["target"] == r["id"] for g in c["grants"])
                mutants["M1"].append({
                    "op": "M1", "component": c["id"], "fn": fid, "effect": E, "resource": r["id"],
                    "granted_already": granted,
                    "edits": [{"file": c["file"], "kind": "insert_after", "line": line,
                               "text": m1_line(E, r)}],
                })

# ---- M1 secondary: generated resources, seeded sample ----------------------
rng = random.Random(SEED)
fn_list = [FUNCS[fid] for c in A_COMPS for fid in sorted(c["functions"]) if FUNCS[fid]["effectsComplete"]]
seen = set()
while len(mutants["M1gen"]) < 1000:
    f = rng.choice(fn_list)
    E = rng.choice(EFFECTS)
    r = rng.choice(G_RES)
    key = (f["id"], E, r["name"])  # unique by printed name to keep attribution unambiguous
    if key in seen:
        continue
    seen.add(key)
    c = COMP_BY_ID[f["component"]]
    line = scan[(c["file"], c["name"])]["fns"][f["name"]]
    mutants["M1gen"].append({
        "op": "M1gen", "component": c["id"], "fn": f["id"], "effect": E, "resource": r["id"],
        "granted_already": False,
        "edits": [{"file": c["file"], "kind": "insert_after", "line": line, "text": m1_line(E, r)}],
    })

# ---- M2 remove-grant (full) ------------------------------------------------
for c in A_COMPS:
    info = scan[(c["file"], c["name"])]
    for idx, E, R in info["grants"]:
        match = [g for g in c["grants"] if g["name"] == E and short(g["target"]) == R.split("::")[-1]]
        assert len(match) == 1, (c["id"], E, R, match)
        g = match[0]
        users = [fid for fid in c["functions"]
                 if any(e["name"] == E and e.get("target") == g["target"] for e in FUNCS[fid]["effects"])]
        mutants["M2"].append({
            "op": "M2", "component": c["id"], "effect": E, "resource": g["target"],
            "fn_users_static": users,
            "edits": [{"file": c["file"], "kind": "delete", "line": idx,
                       "expect": f"  grants {E}<{R}>"}],
        })

# ---- relation helpers ------------------------------------------------------
calls_pairs = set()
linked = set()  # unordered endpoint pairs linked by any relation
for rel in d["relations"]:
    eps = [e["id"] for e in rel["endpoints"]]
    if rel["kind"] == "calls":
        calls_pairs.add((rel["from"], rel["to"]))
    for i in range(len(eps)):
        for j in range(len(eps)):
            if i != j:
                linked.add((eps[i], eps[j]))
step_pairs = set()  # directed traversal steps from any prelude kind
for rel in d["relations"]:
    eps = [e["id"] for e in rel["endpoints"]]
    if rel["kind"] in ("calls", "callbacks", "provides"):
        step_pairs.add((eps[0], eps[1]))
    elif rel["kind"] == "coordinated_call":
        for a, b in zip(eps, eps[1:]):
            step_pairs.add((a, b))


def host_file(*endpoint_ids):
    for eid in endpoint_ids:
        c = COMP_BY_ID.get(eid)
        if c and c["origin"] == "authored":
            return c["file"]
    return "shape/checker.shape"


def relation_mutant(op, n, kind, endpoints, **meta):
    name = f"Mutant{op}x{n:05d}"
    text = "relation %s {\n  kind %s\n  connects %s\n}" % (name, kind, " -> ".join(endpoints))
    return {"op": op, "relation": name, "kind": kind, "endpoints": list(endpoints),
            "edits": [{"file": host_file(*endpoints), "kind": "append", "text": text}], **meta}


# ---- M3 add-calls (authored, full) -----------------------------------------
n = 0
for a in A_COMPS:
    for b in A_COMPS:
        if a["id"] == b["id"] or (a["id"], b["id"]) in calls_pairs:
            continue
        n += 1
        mutants["M3"].append(relation_mutant(
            "M3", n, "calls", [a["id"], b["id"]], source=a["id"], target=b["id"],
            reverse_calls_exists=(b["id"], a["id"]) in calls_pairs,
            other_step_exists=(a["id"], b["id"]) in step_pairs))

# ---- M3 secondary: involving generated components, seeded sample -----------
rng = random.Random(SEED)
all_comps = A_COMPS + G_COMPS
seen = set()
n = 0
while len(mutants["M3gen"]) < 60:
    a = rng.choice(all_comps)
    b = rng.choice(all_comps)
    if a["id"] == b["id"] or (a["origin"] == "authored" and b["origin"] == "authored"):
        continue
    if (a["id"], b["id"]) in calls_pairs or (a["id"], b["id"]) in seen:
        continue
    seen.add((a["id"], b["id"]))
    n += 1
    mutants["M3gen"].append(relation_mutant("M3gen", n, "calls", [a["id"], b["id"]],
                                            source=a["id"], target=b["id"]))

# ---- M4 add-provides (authored, full) --------------------------------------
n = 0
for c in A_COMPS:
    for r in A_RES:
        if (c["id"], r["id"]) in linked:
            continue
        n += 1
        owners = [x["id"] for x in A_COMPS if r["id"] in x.get("owns", [])]
        mutants["M4"].append(relation_mutant(
            "M4", n, "provides", [c["id"], r["id"]], source=c["id"], target=r["id"],
            owners=owners))

# ---- M4 secondary: involving generated comps/resources, seeded sample ------
rng = random.Random(SEED)
all_res = A_RES + G_RES
seen = set()
n = 0
while len(mutants["M4gen"]) < 60:
    c = rng.choice(all_comps)
    r = rng.choice(all_res)
    if c["origin"] == "authored" and r["origin"] == "authored":
        continue
    if (c["id"], r["id"]) in linked or (c["id"], r["id"]) in seen:
        continue
    seen.add((c["id"], r["id"]))
    n += 1
    mutants["M4gen"].append(relation_mutant("M4gen", n, "provides", [c["id"], r["id"]],
                                            source=c["id"], target=r["id"]))

# ---- M5 probes (not scored) ------------------------------------------------
P = "shape.checker::"
targeted = [
    ("callbacks", [P + "ShapeStringHelpers", P + "ShapeChecker"], "callbacks back-edge closing a calls cycle"),
    ("callbacks", [P + "ShapeRuleEngine", "shape.runtime::ExperimentalSemanticKernel"],
     "callbacks edge giving ShapeChecker a route to the kernel"),
    ("callbacks", ["shape.tooling::ShpCli", "shape.runtime::ExperimentalSemanticKernel"],
     "direct callbacks from ShpCli to the kernel"),
    ("coordinated_call", [P + "ShapeChecker", P + "ShapeRuleEngine", "shape.runtime::ExperimentalSemanticKernel"],
     "coordinated_call routing ShapeChecker to the kernel"),
    ("coordinated_call", ["shape.tooling::ShpCli", "shape.runtime::ExperimentalSemanticKernel"],
     "2-party coordinated_call ShpCli -> kernel"),
    ("coordinated_call", [P + "ShapeStringHelpers", P + "ShapeChecker"],
     "coordinated_call back-edge closing a calls cycle"),
    ("calls", ["shape.tooling::ShpCli", "shape.runtime::ExperimentalSemanticKernel"],
     "control: same edge as calls (expected killed)"),
]
n = 0
for kind, eps, why in targeted:
    n += 1
    mutants["M5probe"].append(relation_mutant("M5probe", n, kind, eps, note=why))
rng = random.Random(SEED)
pairs = [(a["id"], b["id"]) for a in A_COMPS for b in A_COMPS if a["id"] != b["id"]]
for a, b in rng.sample(pairs, 20):
    n += 1
    mutants["M5probe"].append(relation_mutant("M5probe", n, "callbacks", [a, b], note="random callbacks"))
for _ in range(10):
    tri = rng.sample([c["id"] for c in A_COMPS], 3)
    n += 1
    mutants["M5probe"].append(relation_mutant("M5probe", n, "coordinated_call", tri, note="random 3-party coordinated_call"))

# ---- Higher-order probes: destructive effect + matching grant --------------
# For each authored resource, pick its owner (or, if unowned, the first
# authored component that already declares an effect on it, else ShpCli)
# and add `grants E<R>` plus `E<R>` in that component's first complete fn.
def home(r):
    for c in A_COMPS:
        if r["id"] in c.get("owns", []):
            return c, "owner"
    for c in A_COMPS:
        for fid in c["functions"]:
            if any(e.get("target") == r["id"] for e in FUNCS[fid]["effects"]):
                return c, "user"
    return COMP_BY_ID["shape.tooling::ShpCli"], "fallback"


for r in A_RES:
    c, why = home(r)
    info = scan[(c["file"], c["name"])]
    fid = next(fid for fid in sorted(c["functions"]) if FUNCS[fid]["effectsComplete"])
    fline = info["fns"][FUNCS[fid]["name"]]
    gline = info["grants"][0][0] if info["grants"] else None
    for E in ("HardDelete", "Truncate", "DropStorage"):
        edits = [{"file": c["file"], "kind": "insert_after", "line": fline, "text": m1_line(E, r)}]
        # insert the grant just before the first grant line (after the previous line)
        edits.append({"file": c["file"], "kind": "insert_after", "line": gline - 1,
                      "text": f"  grants {E}<{r['id']}>"})
        mutants["HOprobe"].append({"op": "HOprobe", "component": c["id"], "fn": fid, "effect": E,
                                   "resource": r["id"], "home": why, "edits": edits})

for op, ms in mutants.items():
    for i, m in enumerate(ms, 1):
        m["id"] = f"{op}-{i:05d}"
    with open(os.path.join(OUT, f"{op}.json"), "w") as f:
        json.dump(ms, f, indent=1)
    print(op, len(ms))
