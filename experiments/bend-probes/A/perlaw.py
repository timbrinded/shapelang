#!/usr/bin/env python3
"""Run the Bend proof gate once per law.

usage: python3 -I perlaw.py <project-dir> <work-dir>

<project-dir> holds LAWS.bend, PROOF.bend and the code they import. For each
`law NAME` in LAWS.bend, a copy of the project is made under
<work-dir>/<NAME>/ whose LAWS.bend states only that law and whose PROOF.bend
keeps every helper def but drops the `def Laws.OTHER` fillers of the other
laws. `bend PROOF.bend` is run there; one TSV line per law is printed:
NAME, PASS/FAIL, exit code, first error line.
"""
import os, re, shutil, subprocess, sys

BEND = os.environ.get("BEND", "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend")

def blocks(src):
    """Split a .bend file into top-level blocks (comments stick to the next block)."""
    out, cur = [], []
    for line in src.splitlines(keepends=True):
        top = line[:1] not in (" ", "\t", "\n", "#", "") and not line.startswith("#")
        if top and any(l.strip() and not l.startswith("#") for l in cur):
            out.append("".join(cur)); cur = []
        cur.append(line)
    if cur:
        out.append("".join(cur))
    return out

def head(b):
    for l in b.splitlines():
        if l.strip() and not l.startswith("#"):
            return l
    return ""

def main():
    proj, work = sys.argv[1], sys.argv[2]
    laws_src = open(os.path.join(proj, "LAWS.bend")).read()
    proof_src = open(os.path.join(proj, "PROOF.bend")).read()
    lb, pb = blocks(laws_src), blocks(proof_src)
    names = [re.match(r"law\s+([\w.]+)", head(b)).group(1) for b in lb if head(b).startswith("law ")]
    for n in names:
        d = os.path.join(work, n)
        if os.path.exists(d):
            shutil.rmtree(d)
        shutil.copytree(proj, d)
        keep_l = [b for b in lb if not head(b).startswith("law ") or re.match(r"law\s+" + re.escape(n) + r"\s*:", head(b))]
        keep_p = []
        for b in pb:
            m = re.match(r"(?:@unsafe\s+)?def\s+Laws\.([\w.]+?)\??\s*\(", head(b))
            if m and m.group(1) != n:
                continue
            keep_p.append(b)
        open(os.path.join(d, "LAWS.bend"), "w").write("".join(keep_l))
        open(os.path.join(d, "PROOF.bend"), "w").write("".join(keep_p))
        r = subprocess.run([BEND, os.path.join(d, "PROOF.bend")], capture_output=True, text=True,
                           env={**os.environ, "BEND_NO_TELEMETRY": "1"}, timeout=600)
        out = (r.stdout + r.stderr).strip().splitlines()
        verdict = "PASS" if out and out[0] == "ALL PROOFS CHECK" else "FAIL"
        err = next((l.strip() for l in out[1:] if l.strip().startswith(("- message", "- expected", "Error"))), "")
        exp = next((l.strip() for l in out if l.strip().startswith("- expected")), "")
        obs = next((l.strip() for l in out if l.strip().startswith("- observed")), "")
        msg = next((l.strip() for l in out if l.strip().startswith("- message")), "")
        detail = msg or (exp + " | " + obs if exp else (out[1] if len(out) > 1 else ""))
        print("\t".join([n, verdict, str(r.returncode), detail]))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
