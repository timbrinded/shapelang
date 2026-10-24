"""Grade G8: law suites written once by an agent from the contract prose.

Usage: python3 -I grade_g8.py X_DIR OUT_JSON TASK...

Each suite (the agent's g8/<task>/test/laws.test.ts, and for comparison the
harness's protected C1 laws) runs against the pre-feature code, the reference
solution, the trap, and every mutant, by swapping the module under src/.
"""
import json
import os
import shutil
import subprocess
import sys

X, OUT, TASKS_ARG = sys.argv[1], sys.argv[2], sys.argv[3:]
CFG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.json")))


def run_suite(workspace, module_rel, impl, scratch):
    shutil.rmtree(scratch, ignore_errors=True)
    shutil.copytree(workspace, scratch, symlinks=True)
    if impl:
        shutil.copy(impl, os.path.join(scratch, module_rel))
    try:
        p = subprocess.run(["bun", "test", "test/laws.test.ts"], cwd=scratch, capture_output=True, text=True, timeout=600)
        return p.returncode == 0
    except subprocess.TimeoutExpired:
        return False


results = {}
for task in TASKS_ARG:
    cfg = CFG[task]
    hid = os.path.join(X, "hidden", task)
    module = cfg["ts"]
    impls = {"pre_feature": None, "ref": os.path.join(hid, "ref", "ts", os.path.basename(module))}
    trap_dir = os.path.join(hid, "trap", "ts")
    for f in sorted(os.listdir(trap_dir)):
        if f.endswith(".ts"):
            impls[f"trap:{f}"] = os.path.join(trap_dir, f)
    manifest = json.load(open(os.path.join(hid, "mutants", "manifest.json")))
    entries = manifest if isinstance(manifest, list) else [dict(v, file=k) if isinstance(v, dict) else {"file": k, "breaks": v} for k, v in manifest.items()]
    tags = {}
    for e in entries:
        f = e.get("file") or e.get("path") or e.get("name")
        f = os.path.basename(f)
        if not f.endswith(".ts"):
            f += ".ts"
        impls[f"mutant:{f}"] = os.path.join(hid, "mutants", f)
        tags[f"mutant:{f}"] = e
    suites = {"agent": os.path.join(X, "g8", task), "reference": os.path.join(X, "tasks", task, "C1")}
    table = {}
    for sname, ws in suites.items():
        for iname, path in impls.items():
            if path and not os.path.exists(path):
                table.setdefault(sname, {})[iname] = "missing"
                continue
            ok = run_suite(ws, module, path, os.path.join(X, "work", "g8grade", task, sname))
            table.setdefault(sname, {})[iname] = "pass" if ok else "fail"
    results[task] = {"table": table, "mutant_tags": tags}
    agent, ref = table["agent"], table["reference"]
    muts = [k for k in impls if k.startswith("mutant:")]
    ref_kills = {k for k in muts if ref[k] == "fail"}
    agent_kills = {k for k in muts if agent[k] == "fail"}
    print(f"{task}: agent pre={agent['pre_feature']} ref={agent['ref']} traps={[agent[k] for k in impls if k.startswith('trap:')]} "
          f"| reference-law kills {len(ref_kills)}/{len(muts)}, agent-law kills {len(agent_kills)}/{len(muts)}, "
          f"agent kills of reference-killed {len(agent_kills & ref_kills)}/{len(ref_kills)}, agent-only kills {sorted(agent_kills - ref_kills)}", flush=True)
json.dump(results, open(OUT, "w"), indent=1)
