#!/usr/bin/env python3
"""Recompute the per-law gate column of an A5 results file in place of the
first run's (whose per-law work dir sat inside the copied project).

usage: python3 -I redo_perlaw.py <work-dir> <in.jsonl> <out.jsonl>
"""
import json, os, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
work, inp, outp = sys.argv[1:4]
with open(outp, "w") as fh:
    for l in open(inp):
        r = json.loads(l)
        d = os.path.join(work, r["id"])
        shutil.rmtree(os.path.join(d, "_perlaw"), ignore_errors=True)
        out = subprocess.run(["python3", "-I", os.path.join(HERE, "..", "perlaw.py"), d, os.path.join(work, "_perlaw", r["id"])],
                             capture_output=True, text=True, timeout=3600).stdout
        r["perlaw"] = {x.split("\t")[0]: x.split("\t")[1] for x in out.strip().splitlines() if "\t" in x}
        fh.write(json.dumps(r) + "\n"); fh.flush()
        print(r["id"], r["perlaw"], flush=True)
