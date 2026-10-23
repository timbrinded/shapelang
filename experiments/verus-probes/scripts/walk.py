"""Walk a repository's first-parent history and record, per commit, how Verus
functions changed: contract, closure-only, executable body, ghost-only, and
trust-marker deltas. Usage: walk.py REPO_DIR VPROBE_BIN OUT_JSON"""
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict

repo, vprobe, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
SPEC = {"spec"}
TRUST_FLAGS = {"external_body", "external", "external_fn_specification", "uninterp"}


def git(*args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


class Cat:
    def __init__(self):
        self.p = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def get(self, rev, path):
        self.p.stdin.write(f"{rev}:{path}\n".encode())
        self.p.stdin.flush()
        header = self.p.stdout.readline().decode()
        if header.endswith("missing\n"):
            return None
        size = int(header.split()[2])
        data = self.p.stdout.read(size)
        self.p.stdout.read(1)
        return data


cat = Cat()
tmp = tempfile.mkdtemp()


def extract(blobs):
    """blobs: list of (tag, bytes). Returns {tag: record}."""
    paths = []
    for i, (tag, data) in enumerate(blobs):
        fp = os.path.join(tmp, f"{i}.rs")
        with open(fp, "wb") as f:
            f.write(data)
        paths.append((tag, fp))
    res = {}
    for start in range(0, len(paths), 200):
        chunk = paths[start:start + 200]
        out = subprocess.run([vprobe, *[fp for _, fp in chunk]], capture_output=True, text=True).stdout
        for (tag, _), line in zip(chunk, out.splitlines()):
            res[tag] = json.loads(line)
    return res


def base_name(key):
    return key.split("::")[-1].split("#")[0]


def is_verified_exec(f):
    return f["mode"] == "exec" and not (set(f["flags"]) & {"external_body", "external"})


def is_trusted_fn(f):
    return bool(set(f["flags"]) & TRUST_FLAGS) or f["mode"] == "axiom"


# Snapshot: path -> record
commits = git("rev-list", "--first-parent", "--reverse", "HEAD").split()
root = commits[0]
snap = {}
root_files = [p for p in git("ls-tree", "-r", "--name-only", root).splitlines() if p.endswith(".rs")]
recs = extract([(p, cat.get(root, p)) for p in root_files])
snap.update(recs)

# Inverted index ident -> set of (path, key) for spec fns (contract+body ids)
# and verified exec fns (contract ids only), maintained incrementally.
mentions = defaultdict(set)
spec_defs = defaultdict(set)  # spec fn base name -> set of (path, key)
fn_by = {}  # (path, key) -> fn


def index_file(path, rec, add):
    for f in rec.get("fns", []):
        ref = (path, f["key"])
        if f["mode"] in SPEC:
            ids = set(f["cids"]) | set(f["bids"])
            if add:
                spec_defs[base_name(f["key"])].add(ref)
            else:
                spec_defs[base_name(f["key"])].discard(ref)
        elif is_verified_exec(f):
            ids = set(f["cids"])
        else:
            continue
        for i in ids:
            if add:
                mentions[i].add(ref)
            else:
                mentions[i].discard(ref)
        if add:
            fn_by[ref] = f
        else:
            fn_by.pop(ref, None)


for p, r in snap.items():
    index_file(p, r, True)


def affected_exec(changed_names, unambiguous_only):
    """Reverse reachability: exec fns whose contract closure reaches a changed spec name."""
    seen_names = set()
    frontier = [n for n in changed_names if not unambiguous_only or len(spec_defs.get(n, ())) <= 1]
    hit = set()
    while frontier:
        n = frontier.pop()
        if n in seen_names:
            continue
        seen_names.add(n)
        for ref in mentions.get(n, ()):
            f = fn_by.get(ref)
            if f is None:
                continue
            if f["mode"] in SPEC:
                m = base_name(f["key"])
                if unambiguous_only and len(spec_defs.get(m, ())) > 1:
                    continue
                frontier.append(m)
            else:
                hit.add(ref)
    return hit


rows = []
trust_re = re.compile(r"assum|admit|extern|trust|axiom|unverif|uninterp|TODO|unsound", re.I)
for c in commits[1:]:
    diff = git("diff", "--name-status", "-M", f"{c}^1", c, "--", "*.rs").splitlines()
    if not diff:
        continue
    pairs = []  # (old_path, new_path)
    for line in diff:
        parts = line.split("\t")
        st = parts[0]
        if st.startswith("R"):
            pairs.append((parts[1], parts[2]))
        elif st == "A":
            pairs.append((None, parts[1]))
        elif st == "D":
            pairs.append((parts[1], None))
        else:
            pairs.append((parts[1], parts[1]))
    blobs = []
    for o, n in pairs:
        if n is not None:
            data = cat.get(c, n)
            if data is not None:
                blobs.append((("new", n), data))
    new_recs = extract(blobs)
    row = {
        "commit": c,
        "date": git("log", "-1", "--format=%as", c).strip(),
        "files": len(pairs),
        "added_files": sum(1 for o, n in pairs if o is None),
        "subject": git("log", "-1", "--format=%s", c).strip()[:120],
        "toolchain_files": sum(1 for f in git("diff", "--name-only", f"{c}^1", c).splitlines()
                               if re.search(r"rust-toolchain|\.gitmodules|\.github/workflows|(^|/)verus$|verus[-_]version|VERUS", f)),
        "verus_files": 0,
        "parse_fail": 0,
        "exec_contract": 0,
        "exec_body_exec": 0,
        "exec_ghost_only": 0,
        "exec_added": 0,
        "exec_removed": 0,
        "spec_changed": 0,
        "proof_changed": 0,
        "trusted_body_changed": 0,
        "trusted_contract_changed": 0,
        "tcb_add": defaultdict(int),
        "tcb_remove": defaultdict(int),
        "t_files": 0,
        "v_files": 0,
        "trust_events": [],
    }
    changed_spec_names = set()
    direct_contract_refs = set()
    whole_fn_refs = set()
    for o, n in pairs:
        old = snap.get(o) if o else None
        new = new_recs.get(("new", n)) if n else None
        path = n or o
        if path.endswith("_t.rs"):
            row["t_files"] += 1
        if path.endswith("_v.rs"):
            row["v_files"] += 1
        if (old and old.get("verus")) or (new and new.get("verus")):
            row["verus_files"] += 1
        if (old and not old.get("ok") and old.get("verus")) or (new and not new.get("ok") and new.get("verus")):
            row["parse_fail"] += 1
        ot = (old or {}).get("tcb", {})
        nt = (new or {}).get("tcb", {})
        ev = {"path": path, "t": path.endswith("_t.rs"), "add": {}, "remove": {}, "tbody": 0, "tcontract": 0}
        row["trust_events"].append(ev)
        for k in set(ot) | set(nt):
            d = nt.get(k, 0) - ot.get(k, 0)
            if d > 0:
                row["tcb_add"][k] += d
                ev["add"][k] = d
            elif d < 0:
                row["tcb_remove"][k] += -d
                ev["remove"][k] = -d
        ofns = {f["key"]: f for f in (old or {}).get("fns", [])}
        nfns = {f["key"]: f for f in (new or {}).get("fns", [])}
        # Only compare function sets when both sides parsed.
        if old and new and not (old.get("ok") and new.get("ok")):
            continue
        for k in set(ofns) | set(nfns):
            a, b = ofns.get(k), nfns.get(k)
            f = b or a
            if f["mode"] in SPEC:
                if a is None or b is None or a["contract_h"] != b["contract_h"] or a["body_h"] != b["body_h"]:
                    row["spec_changed"] += 1
                    changed_spec_names.add(base_name(k))
                continue
            if f["mode"] in ("proof",) and not is_trusted_fn(f):
                if a is None or b is None or a["contract_h"] != b["contract_h"] or a["body_h"] != b["body_h"]:
                    row["proof_changed"] += 1
                continue
            if is_trusted_fn(f):
                if a and b:
                    if a["contract_h"] != b["contract_h"]:
                        row["trusted_contract_changed"] += 1
                        ev["tcontract"] += 1
                    if a["body_h"] != b["body_h"]:
                        row["trusted_body_changed"] += 1
                        ev["tbody"] += 1
                continue
            if not is_verified_exec(f):
                continue
            if a is None:
                row["exec_added"] += 1
                continue
            if b is None:
                row["exec_removed"] += 1
                continue
            if a["contract_h"] != b["contract_h"]:
                row["exec_contract"] += 1
                direct_contract_refs.add((n, k))
                whole_fn_refs.add((n, k))
            elif a["exec_h"] != b["exec_h"]:
                row["exec_body_exec"] += 1
                whole_fn_refs.add((n, k))
            elif a["body_h"] != b["body_h"]:
                row["exec_ghost_only"] += 1
                whole_fn_refs.add((n, k))
    # Update snapshot and index, then compute closure effects on the new snapshot.
    for o, n in pairs:
        if o and o in snap:
            index_file(o, snap[o], False)
            del snap[o]
        if n and ("new", n) in new_recs:
            snap[n] = new_recs[("new", n)]
            index_file(n, snap[n], True)
    upper = affected_exec(changed_spec_names, False) if changed_spec_names else set()
    lower = affected_exec(changed_spec_names, True) if changed_spec_names else set()
    row["closure_upper_only"] = len(upper - direct_contract_refs)
    row["closure_lower_only"] = len(lower - direct_contract_refs)
    row["msg_trust_kw"] = bool(trust_re.search(git("log", "-1", "--format=%B", c)))
    row["trust_events"] = [e for e in row["trust_events"] if e["add"] or e["remove"] or e["tbody"] or e["tcontract"] or e["t"]]
    row["tcb_add"] = dict(row["tcb_add"])
    row["tcb_remove"] = dict(row["tcb_remove"])
    rows.append(row)

# HEAD size statistics and per-exec-fn closure sizes (in tokens).
def closure_tokens(f, unambiguous_only):
    names, frontier, total = set(), [i for i in f["cids"] if i in spec_defs], 0
    while frontier:
        n = frontier.pop()
        if n in names:
            continue
        defs = spec_defs.get(n, ())
        if not defs or (unambiguous_only and len(defs) > 1):
            continue
        names.add(n)
        for ref in defs:
            g = fn_by.get(ref)
            if g:
                total += g["contract_n"] + g["body_n"]
                frontier.extend(i for i in set(g["cids"]) | set(g["bids"]) if i in spec_defs)
    return total, len(names)

head = {"exec_fns": 0, "exec_tokens": 0, "ghost_tokens_in_exec": 0, "exec_clause_tokens": 0,
        "spec_fn_tokens": 0, "proof_fn_tokens": 0, "trusted_fns": 0, "per_fn": []}
for p, r in snap.items():
    for f in r.get("fns", []):
        if f["mode"] in SPEC:
            head["spec_fn_tokens"] += f["contract_n"] + f["body_n"]
        elif f["mode"] == "proof" and not is_trusted_fn(f):
            head["proof_fn_tokens"] += f["contract_n"] + f["body_n"]
        if is_trusted_fn(f):
            head["trusted_fns"] += 1
        if is_verified_exec(f) and f["body_n"] > 0:
            head["exec_fns"] += 1
            head["exec_tokens"] += f["exec_n"]
            head["ghost_tokens_in_exec"] += f["body_n"] - f["exec_n"]
            head["exec_clause_tokens"] += f["clause_n"]
            up, upn = closure_tokens(f, False)
            lo, lon = closure_tokens(f, True)
            head["per_fn"].append({"exec": f["exec_n"], "clause": f["clause_n"], "closure_up": up, "closure_lo": lo,
                                   "closure_names_up": upn, "closure_names_lo": lon})
json.dump({"repo": os.path.basename(repo.rstrip("/")), "rows": rows, "head": head}, open(out_path, "w"))
print(os.path.basename(repo.rstrip("/")), "commits analysed", len(rows))
