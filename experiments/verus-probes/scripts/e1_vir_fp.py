"""E1: per-function VIR contract fingerprints with optional normalisation rules.
Usage: e1_vir_fp.py VIR_A VIR_B"""
import hashlib
import re
import sys


def group_after(text, key):
    i = text.find(key)
    if i < 0:
        return ""
    k = i + len(key)
    while k < len(text) and text[k] == " ":
        k += 1
    if k >= len(text) or text[k] != "(":
        return ""
    depth = 0
    for p in range(k, len(text)):
        if text[p] == "(":
            depth += 1
        elif text[p] == ")":
            depth -= 1
            if depth == 0:
                return text[k:p + 1]
    return ""


RULES = {
    "read_kind": (r"\(UnfinalizedReadKind :preliminary_kind \(ReadKind \w+\) :id _\)", "(UnfinalizedReadKind)"),
    "rustc_ids": (r"\(VarIdentDisambiguate RustcId \d+\)", "(VarIdentDisambiguate RustcId _)"),
    "true_conjuncts": (r"\(> Const \(Constant Bool true\)\) ?", ""),
}


def fps(path, rules):
    out = {}
    for block in open(path).read().split("\n;; ")[1:]:
        _, _, body = block.partition("\n")
        if not body.lstrip().startswith("(Function"):
            continue
        name = re.search(r":name \(Fun :path ([^\s()]+)\)", body).group(1)
        c = group_after(body, ":require ") + group_after(body, ":ensure ")
        c = re.sub(r":id \d+", ":id _", re.sub(r"\s+", " ", c))
        for r in rules:
            pat, rep = RULES[r]
            c = re.sub(pat, rep, c)
        # Hash the token sequence so whitespace left by a rewrite cannot matter.
        toks = re.findall(r"\(|\)|[^\s()]+", c)
        out[name] = hashlib.sha256(" ".join(toks).encode()).hexdigest()
    return out


a_path, b_path = sys.argv[1], sys.argv[2]
for rules in ([], ["read_kind"], ["read_kind", "rustc_ids"], ["read_kind", "rustc_ids", "true_conjuncts"]):
    a, b = fps(a_path, rules), fps(b_path, rules)
    changed = sorted(k for k in a if k in b and a[k] != b[k])
    print(f"rules={rules or ['none']}: changed {len(changed)} {changed[:6]}")
