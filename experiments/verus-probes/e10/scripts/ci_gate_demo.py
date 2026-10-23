"""Supplementary: replay a few plain-check survivors under the CI gate's
changed-files mode (`--changed-files` + `--base-model <pristine copy>`), to see
whether docs bindings on shape/*.shape files catch them, and whether that
catch depends on what the edit says. Writes results/extra_ci.json.
"""
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CLI, EXP, apply_edits, parse_diagnostics, restore  # noqa: E402

W = os.path.join(EXP, "work", "ci")
if not os.path.isdir(os.path.join(W, "shape")):
    os.makedirs(W, exist_ok=True)
    shutil.copytree(os.path.join(EXP, "shape"), os.path.join(W, "shape"))


def load(op):
    with open(os.path.join(EXP, "mutants", f"{op}.json")) as f:
        return {m["id"]: m for m in json.load(f)}


def status(op):
    out = {}
    with open(os.path.join(EXP, "results", f"{op}.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            if "id" in r:
                out[r["id"]] = r["status"]
    return out


M3, M4, M1, HO = load("M3"), load("M4"), load("M1"), load("HOprobe")
s3, s4, s1 = status("M3"), status("M4"), status("M1")
analyzer = next(i for i, m in M3.items() if m["source"] == "shape.tooling::ShapeAnalyzer"
                and m["target"] == "shape.checker::ShapeChecker")
deliv = next(i for i, m in sorted(M4.items()) if s4.get(i) == "survived" and m["edits"][0]["file"] == "shape/delivery.shape")
checker_m1 = next(i for i, m in sorted(M1.items()) if s1.get(i) == "survived" and m["edits"][0]["file"] == "shape/checker.shape")

ho_deliv = next(i for i, m in sorted(HO.items()) if m["effect"] == "HardDelete"
                and all(e["file"] == "shape/delivery.shape" for e in m["edits"]))
cases = [
    ("pristine model, changed list names shape/tooling.shape", None, None, ["shape/tooling.shape"]),
    ("M3 survivor ShapeAnalyzer -> ShapeChecker, only the .shape file changed", "M3", analyzer, ["shape/tooling.shape"]),
    ("same mutant, plus one bound docs file in the changed list", "M3", analyzer,
     ["shape/tooling.shape", "docs-site/src/content/docs/reference/cli.md"]),
    ("M4 survivor hosted in shape/delivery.shape (no binding names that file)", "M4", deliv, ["shape/delivery.shape"]),
    ("M1 survivor hosted in shape/checker.shape, only the .shape file changed", "M1", checker_m1, ["shape/checker.shape"]),
    ("HO probe (HardDelete effect + matching grant) in shape/delivery.shape, with --check-loosening", "HO", ho_deliv,
     ["shape/delivery.shape"], ["--check-loosening"]),
]
rows = []
for case in cases:
    label, op, mid, changed = case[:4]
    flags = case[4] if len(case) > 4 else []
    m = {"M3": M3, "M4": M4, "M1": M1, "HO": HO}[op][mid] if op else None
    saved = apply_edits(m["edits"], W) if m else {}
    with open(os.path.join(W, "changed.txt"), "w") as f:
        f.write("\n".join(changed) + "\n")
    cmd = ["bun", CLI, "check", "--changed-files", "changed.txt", "--base-model", EXP] + flags
    try:
        p = subprocess.run(cmd, cwd=W, capture_output=True, text=True, timeout=600)
    finally:
        restore(saved, W)
    blocks = parse_diagnostics(p.stdout + p.stderr)
    rows.append({"case": label, "mutant": mid, "changed_files": changed, "exit": p.returncode,
                 "diagnostics": [{"kind": b["kind"], "body": b["body"][:2]} for b in blocks],
                 "command": "cd work/ci && bun %s check --changed-files changed.txt --base-model %s %s" % (CLI, EXP, " ".join(flags))})
    print(label, "->", p.returncode, [b["kind"] + ": " + (b["body"][0] if b["body"] else "") for b in blocks])
with open(os.path.join(EXP, "results", "extra_ci.json"), "w") as f:
    json.dump({"ci_gate_demo": rows}, f, indent=1)
