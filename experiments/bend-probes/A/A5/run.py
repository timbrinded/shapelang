#!/usr/bin/env python3
"""Run the A5 mutants: apply each edit to a fresh copy of its demo, run the
unchanged proof gate (whole and per law), compile the mutated main.bend to an
ES module and ask the oracle whether each law holds and whether behaviour
changed. Survivors of the gate are re-run with --verdict.

usage: python3 -I run.py <demos-dir> <work-dir> <out.jsonl>
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mutants import M

BEND = os.environ.get("BEND", "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend")
ENV = {**os.environ, "BEND_NO_TELEMETRY": "1"}
demos, work, outp = sys.argv[1], sys.argv[2], sys.argv[3]
only = set(sys.argv[4:])

def sh(args, t, cwd=None):
    try:
        r = subprocess.run(args, capture_output=True, text=True, env=ENV, timeout=t, cwd=cwd)
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return "timeout", ""

def first_err(out):
    ls = [l.strip() for l in out.splitlines()]
    for i, l in enumerate(ls):
        if l.startswith("- message"):
            return l
        if l.startswith("- expected"):
            return l + (" | " + ls[i + 1] if i + 1 < len(ls) and ls[i + 1].startswith("- observed") else "")
        if l.startswith("Error"):
            return " ".join(ls[i:i + 2])
    return ls[0] if ls else ""

orig_mjs = {}
os.makedirs(work, exist_ok=True)
with open(outp, "w") as fh:
    for m in M:
        if only and m["id"] not in only:
            continue
        demo = m["demo"]
        if demo not in orig_mjs:
            p = os.path.join(work, demo + ".orig.mjs")
            sh([BEND, os.path.join(demos, demo, "main.bend"), "-o", p], 300)
            orig_mjs[demo] = p
        d = os.path.join(work, m["id"])
        if os.path.exists(d):
            shutil.rmtree(d)
        shutil.copytree(os.path.join(demos, demo), d)
        src = open(os.path.join(d, "main.bend")).read()
        for old, new in m["edits"]:
            assert src.count(old) == 1, (m["id"], old)
            src = src.replace(old, new)
        open(os.path.join(d, "main.bend"), "w").write(src)
        row = {k: m[k] for k in ("id", "demo", "kind", "desc")}
        rc, out = sh([BEND, os.path.join(d, "main.bend"), "--check-only"], 300)
        row["main_check"] = "PASS" if out.startswith("ALL PROOFS CHECK") else ("TIMEOUT" if rc == "timeout" else "FAIL")
        row["main_err"] = "" if row["main_check"] == "PASS" else first_err(out)
        rc, out = sh([BEND, os.path.join(d, "PROOF.bend")], 600)
        row["gate"] = "PASS" if out.startswith("ALL PROOFS CHECK") else ("TIMEOUT" if rc == "timeout" else "FAIL")
        row["gate_err"] = "" if row["gate"] == "PASS" else first_err(out)
        rc, out = sh(["python3", "-I", os.path.join(HERE, "..", "perlaw.py"), d, os.path.join(work, "_perlaw", m["id"])], 1800)
        row["perlaw"] = {l.split("\t")[0]: l.split("\t")[1] for l in out.strip().splitlines() if "\t" in l}
        if row["gate"] == "PASS":
            env2 = dict(ENV); env2["PATH"] = os.environ.get("LEAN_PATH_PREFIX", "") + os.environ["PATH"]
            try:
                r = subprocess.run([BEND, os.path.join(d, "PROOF.bend"), "--verdict"], capture_output=True, text=True, env=env2, timeout=600)
                row["verdict"] = (r.stdout + r.stderr).strip().splitlines()[0]
            except subprocess.TimeoutExpired:
                row["verdict"] = "TIMEOUT"
        if row["main_check"] == "PASS":
            mjs = os.path.join(d, "mut.mjs")
            rc, out = sh([BEND, os.path.join(d, "main.bend"), "-o", mjs], 300)
            rc, out = sh(["bun", os.path.join(HERE, "oracle.mjs"), demo, orig_mjs[demo], mjs], 600)
            try:
                row["oracle"] = json.loads(out.strip().splitlines()[-1])
            except Exception:
                row["oracle"] = {"error": out[-300:] if out else str(rc)}
        fh.write(json.dumps(row) + "\n"); fh.flush()
        o = row.get("oracle", {})
        lf = [k for k, v in o.get("laws", {}).items() if not k.startswith("_") and not v["holds"]]
        print(row["id"], row["kind"], "main:" + row["main_check"], "gate:" + row["gate"], "changed:" + str(o.get("changed")), "false:" + ",".join(lf), row.get("verdict", ""), row["gate_err"][:80], flush=True)
