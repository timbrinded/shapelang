"""H5 step 1: function-level walk of one Verus repository's first-parent history.

Mirrors experiments/verus-probes/scripts/walk.py (same commit list, same `git diff -M` pairs, same
vprobe binary) but keeps what the E9 rows aggregate away: per-blob, per-function records (key,
mode, flags, assume/admit counts, contract and body hashes) and the file-level tcb counts. The
1.0 replay (replay.ts) builds Shape manifests from these records.

It also recomputes E9's per-commit trust events from the records with walk.py's exact rules and
writes them alongside, so check_walk.py can verify the walk against results/per-commit/*.json.gz.

Usage: python3 -I walk_fn.py REPO_DIR VPROBE_BIN OUT_DIR
Writes OUT_DIR/<repo>.walk.json (steps) and OUT_DIR/<repo>.blobs.jsonl (blob sha -> record).
"""
import json
import os
import subprocess
import sys
import tempfile

repo, vprobe, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
name = os.path.basename(os.path.normpath(repo))
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
            return None, None
        sha, _, size = header.split()
        data = self.p.stdout.read(int(size))
        self.p.stdout.read(1)
        return sha, data


cat = Cat()
tmp = tempfile.mkdtemp()
blobs = {}  # sha -> minimal record (None when vprobe printed nothing)


def minimal(rec):
    fns = []
    for f in rec.get("fns", []):
        fns.append({
            "key": f["key"],
            "mode": f["mode"],
            "flags": sorted(f.get("flags", [])),
            "assume": f.get("assume", 0),
            "admit": f.get("admit", 0),
            "contract_h": f.get("contract_h", ""),
            "body_h": f.get("body_h", ""),
        })
    return {"ok": bool(rec.get("ok")), "verus": bool(rec.get("verus")), "tcb": rec.get("tcb", {}), "fns": fns}


def extract(items):
    """items: list of (sha, bytes) not yet in blobs."""
    todo = [(s, d) for s, d in items if s not in blobs]
    seen = set()
    uniq = []
    for s, d in todo:
        if s not in seen:
            seen.add(s)
            uniq.append((s, d))
    for start in range(0, len(uniq), 200):
        chunk = uniq[start:start + 200]
        paths = []
        for i, (s, d) in enumerate(chunk):
            fp = os.path.join(tmp, f"{i}.rs")
            with open(fp, "wb") as f:
                f.write(d)
            paths.append(fp)
        out = subprocess.run([vprobe, *paths], capture_output=True, text=True).stdout
        lines = out.splitlines()
        for (s, _), line in zip(chunk, lines):
            blobs[s] = minimal(json.loads(line))
        for s, _ in chunk[len(lines):]:
            blobs[s] = None


def is_trusted_fn(f):
    return bool(set(f["flags"]) & TRUST_FLAGS) or f["mode"] == "axiom"


commits = git("rev-list", "--first-parent", "--reverse", "HEAD").split()
root = commits[0]
snap = {}  # path -> sha (only when vprobe produced a record)
root_items = []
for p in [p for p in git("ls-tree", "-r", "--name-only", root).splitlines() if p.endswith(".rs")]:
    sha, data = cat.get(root, p)
    if sha is not None:
        root_items.append((p, sha, data))
extract([(s, d) for _, s, d in root_items])
for p, s, _ in root_items:
    if blobs.get(s) is not None:
        snap[p] = s
root_snap = dict(snap)

steps = []
for c in commits[1:]:
    diff = git("diff", "--name-status", "-M", f"{c}^1", c, "--", "*.rs").splitlines()
    if not diff:
        continue
    pairs = []
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
    new_items = []
    for o, n in pairs:
        if n is not None:
            sha, data = cat.get(c, n)
            if sha is not None:
                new_items.append((n, sha, data))
    extract([(s, d) for _, s, d in new_items])
    new_sha = {n: s for n, s, _ in new_items if blobs.get(s) is not None}
    # E9 trust events, walk.py rules
    evs = []
    verus_files = parse_fail = 0
    for o, n in pairs:
        old = blobs.get(snap.get(o)) if o and o in snap else None
        new = blobs.get(new_sha.get(n)) if n and n in new_sha else None
        path = n or o
        if (old and old["verus"]) or (new and new["verus"]):
            verus_files += 1
        if (old and not old["ok"] and old["verus"]) or (new and not new["ok"] and new["verus"]):
            parse_fail += 1
        ot = (old or {}).get("tcb", {})
        nt = (new or {}).get("tcb", {})
        ev = {"path": path, "t": path.endswith("_t.rs"), "add": {}, "remove": {}, "tbody": 0, "tcontract": 0}
        for k in sorted(set(ot) | set(nt)):
            d = nt.get(k, 0) - ot.get(k, 0)
            if d > 0:
                ev["add"][k] = d
            elif d < 0:
                ev["remove"][k] = -d
        ofns = {f["key"]: f for f in (old or {}).get("fns", [])}
        nfns = {f["key"]: f for f in (new or {}).get("fns", [])}
        both = not (old and new and not (old["ok"] and new["ok"]))
        if both:
            for k in set(ofns) | set(nfns):
                a, b = ofns.get(k), nfns.get(k)
                f = b or a
                if f["mode"] in SPEC:
                    continue
                if f["mode"] in ("proof",) and not is_trusted_fn(f):
                    continue
                if is_trusted_fn(f) and a and b:
                    if a["contract_h"] != b["contract_h"]:
                        ev["tcontract"] += 1
                    if a["body_h"] != b["body_h"]:
                        ev["tbody"] += 1
        if ev["add"] or ev["remove"] or ev["tbody"] or ev["tcontract"] or ev["t"]:
            evs.append(ev)
    steps.append({
        "commit": c,
        "parent": git("rev-parse", f"{c}^1").strip(),
        "pairs": pairs,
        "new": new_sha,
        "added_files": sum(1 for o, n in pairs if o is None),
        "verus_files": verus_files,
        "parse_fail": parse_fail,
        "trust_events": evs,
    })
    for o, n in pairs:
        if o and o in snap:
            del snap[o]
        if n and n in new_sha:
            snap[n] = new_sha[n]

os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, f"{name}.walk.json"), "w") as f:
    json.dump({"repo": name, "commits": commits, "root": root, "rootSnap": root_snap, "steps": steps}, f)
with open(os.path.join(out_dir, f"{name}.blobs.jsonl"), "w") as f:
    for s in sorted(blobs):
        f.write(json.dumps({"sha": s, "rec": blobs[s]}, sort_keys=True) + "\n")
print(f"{name}: {len(commits)} commits, {len(steps)} steps with .rs diffs, {len(blobs)} blobs")
