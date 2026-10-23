"""E3: decide whether an edited contract is looser than the original, using Verus.

For a function with original contract X and edited contract Y, we add two functions
next to it:
    #[verifier::external_body] fn NEW(params) requires Y.pre ensures Y.post { unimplemented!() }
    fn CHK(params) requires X.pre ensures X.post { NEW(args) }
CHK verifies iff X.pre ==> Y.pre and X.pre && Y.post ==> X.post, i.e. Y is not looser
than X for any caller. Running both directions decides equivalence.

Usage: e3_refine.py WORKDIR BASE_TREE OUT_JSON CASES_JSON
CASES_JSON: list of {"id", "path", "key", "x_tree", "y_tree"} (x = original, y = edited).
"""
import json
import os
import re
import shutil
import subprocess
import sys

VP_WORK = os.environ.get("VP_WORK", "/tmp/verus-probes")
SBX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "sbx")
work, base, out_path, cases_path = sys.argv[1:5]
cases = json.load(open(cases_path))


def load_vprobe(tree):
    path = os.path.join(VP_WORK, "exp/e1", f"{os.path.basename(tree)}.vprobe.jsonl")
    return {(json.loads(l)["path"], f["key"]): f for l in open(path) for f in json.loads(l)["fns"]}


vp = {}


def sig_text(tree, path, key):
    if tree not in vp:
        vp[tree] = load_vprobe(tree)
    f = vp[tree][(path, key)]
    lines = open(os.path.join(tree, path)).read().split("\n")
    (l1, c1), (l2, c2) = f["sig_start"], f["body_open"]
    if l1 == l2:
        return lines[l1 - 1][c1:c2]
    return "\n".join([lines[l1 - 1][c1:]] + lines[l1:l2 - 1] + [lines[l2 - 1][:c2]])


def split_top(s, sep=","):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([{<":
            depth += 1
        elif ch in ")]}>":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def params_of(sig):
    m = re.match(r"\s*fn\s+(\w+)", sig)
    i = m.end()
    # skip generics
    if sig[i:].lstrip().startswith("<"):
        depth = 0
        j = sig.index("<", i)
        for k in range(j, len(sig)):
            if sig[k] == "<":
                depth += 1
            elif sig[k] == ">":
                depth -= 1
                if depth == 0:
                    i = k + 1
                    break
    j = sig.index("(", i)
    depth = 0
    for k in range(j, len(sig)):
        if sig[k] == "(":
            depth += 1
        elif sig[k] == ")":
            depth -= 1
            if depth == 0:
                inner = sig[j + 1:k]
                break
    recv, args = None, []
    for p in split_top(inner):
        p = p.strip()
        if re.fullmatch(r"(&\s*(mut\s+)?)?(mut\s+)?self(\s*:.*)?", p, re.S):
            recv = "self"
            continue
        pat = split_top(p, ":")[0].strip()
        pat = re.sub(r"^mut\s+", "", pat)
        args.append(pat)
    return recv, args


def rename(sig, new):
    return re.sub(r"^(\s*fn\s+)\w+", lambda m: m.group(1) + new, sig, count=1)


shutil.rmtree(work, ignore_errors=True)
shutil.copytree(base, work, ignore=shutil.ignore_patterns("vlog"))
vp_base = load_vprobe(base)
inserts = {}  # path -> list of (after_line, text, names)
meta = {}
for c in cases:
    key, path = c["key"], c["path"]
    if key.startswith("<") or key.startswith("trait "):
        meta[c["id"]] = {"status": "skipped", "reason": "trait method"}
        continue
    x, y = sig_text(c["x_tree"], path, key), sig_text(c["y_tree"], path, key)
    recv, args = params_of(y)
    is_method = "::" in key
    new, chk = f"e3_{c['id']}_new", f"e3_{c['id']}_chk"
    call_args = ", ".join((["self"] if recv else []) + args)
    callee = f"Self::{new}" if is_method else new
    attr = lambda s: "    #[verifier::deprecated_postcondition_mut_ref_style(true)]\n" if "final(" not in s else ""
    text = (f"\n    #[verifier::external_body]\n{attr(y)}    {rename(y, new)}{{ unimplemented!() }}\n"
            f"{attr(x)}    {rename(x, chk)}{{ {callee}({call_args}) }}\n")
    after = vp_base[(path, key)]["body_close"][0]
    inserts.setdefault(path, []).append((after, text))
    meta[c["id"]] = {"status": "pending", "chk": chk, "new": new}

for path, items in inserts.items():
    fp = os.path.join(work, path)
    lines = open(fp).read().split("\n")
    for after, text in sorted(items, key=lambda t: -t[0]):
        lines[after:after] = text.split("\n")
    open(fp, "w").write("\n".join(lines))


def locate():
    """Map wrapper name -> (path, first_line, last_line) in the work tree."""
    spans = {}
    for path in inserts:
        lines = open(os.path.join(work, path)).read().split("\n")
        for i, ln in enumerate(lines):
            m = re.search(r"fn (e3_\w+_chk)\b", ln)
            if m:
                j = i
                while "unimplemented" not in lines[j] and not re.search(r"\{ (Self::)?e3_\w+_new\(", lines[j]):
                    j += 1
                spans[m.group(1)] = (path, i + 1, j + 1)
    return spans


excluded = set()
for attempt in range(6):
    proc = subprocess.run([SBX, work, "--cpus", "3", "--", "verus", "--crate-type=dylib", "--no-report-long-running",
                           "--num-threads", "3", "--smt-option", "smt.random_seed=1", "ironsht/src/lib.rs"],
                          capture_output=True, text=True)
    err = proc.stderr
    spans = locate()
    errors = re.findall(r"^error(?:\[\w+\])?: (.*)\n\s+--> (\S+?):(\d+):\d+", err, re.M)
    verif, other = [], []
    for msg, path, line in errors:
        if msg.startswith("aborting"):
            continue
        hit = [n for n, (p, a, b) in spans.items() if p == path and a <= int(line) <= b]
        kind = "verif" if re.search(r"not satisfied|rlimit|assertion failed", msg) else "other"
        (verif if kind == "verif" else other).append((msg, path, int(line), hit))
    bad_names = {h for _, _, _, hit in other for h in hit}
    if other and not bad_names:
        print("unattributed compile errors:", other[:3])
        break
    if other:
        # remove wrappers that do not compile, then retry
        for cid, m in meta.items():
            if m.get("chk") in bad_names:
                m["status"] = "not_evaluable"
                m["error"] = [o[0] for o in other if m["chk"] in o[3]][:2]
                for path in inserts:
                    fp = os.path.join(work, path)
                    s = open(fp).read()
                    s = re.sub(rf"\n    #\[verifier::external_body\]\n(    #\[verifier::deprecated_postcondition_mut_ref_style\(true\)\]\n)?    fn {m['new']}\b.*?\{{ unimplemented!\(\) \}}\n(    #\[verifier::deprecated_postcondition_mut_ref_style\(true\)\]\n)?    fn {m['chk']}\b.*?\{{ (Self::)?{m['new']}\([^\n]*\) \}}\n", "\n", s, flags=re.S)
                    open(fp, "w").write(s)
        continue
    failed = {h for _, _, _, hit in verif for h in hit}
    for cid, m in meta.items():
        if m["status"] == "pending":
            m["status"] = "looser_or_unknown" if m["chk"] in failed else "not_looser"
            m["errors"] = [v[0] for v in verif if m["chk"] in v[3]][:3]
    break

json.dump(meta, open(out_path, "w"), indent=1)
from collections import Counter
print(Counter(m["status"] for m in meta.values()))
