"""Summarise G1-G7 from results/grades.json plus file sizes in the trial workspaces.
Usage: python3 -I summarize_g.py X_DIR"""
import json, os, sys
X = sys.argv[1]
g = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "grades.json")))
cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.json")))

def loc(p):
    if not os.path.exists(p):
        return 0
    return sum(1 for l in open(p, errors="replace") if l.strip() and not l.strip().startswith(("#", "//")))

rows = []
for r in g:
    t, c = r["task"], r["cond"]
    d = os.path.join(X, "trials", r["id"])
    code = loc(os.path.join(d, cfg[t]["bend"] if c == "C2" else cfg[t]["ts"]))
    proof = loc(os.path.join(d, "PROOF.bend")) if c == "C2" else None
    laws = loc(os.path.join(d, "test", "laws.test.ts")) if c == "C1" else None
    lawsb = loc(os.path.join(d, "LAWS.bend")) if c == "C2" else None
    own_tests = r["lines_changed"].get("tests", [0, 0])[0]
    h = r["hidden"]
    rows.append({"id": r["id"], "task": t, "cond": c, "gate_runs": r["gate_runs"], "final_gate": r["final_gate_pass"],
                 "feature_fail": h["feature_fail"], "law_fail": h["law_fail"], "protected_modified": len(r["protected_modified"]),
                 "verdict": r.get("verdict"), "hatches": len(r.get("escape_hatches") or {}),
                 "code_loc": code, "proof_loc": proof, "given_law_loc": laws if c == "C1" else lawsb,
                 "code_lines_changed": sum(r["lines_changed"].get("code", [0, 0])),
                 "proof_lines_changed": sum(r["lines_changed"].get("proof", [0, 0])) if c == "C2" else None,
                 "agent_test_lines_added": own_tests})
print(f"{'trial':12} {'gate':>4} {'feat_f':>6} {'law_f':>5} {'tamper':>6} {'code':>5} {'proof':>5} {'laws':>5} {'dCode':>5} {'dProof':>6} {'ownTests':>8}")
for x in rows:
    print(f"{x['id']:12} {x['gate_runs']:>4} {x['feature_fail']:>6} {x['law_fail']:>5} {x['protected_modified']:>6} {x['code_loc']:>5} {str(x['proof_loc'] or '-'):>5} {str(x['given_law_loc'] or '-'):>5} {x['code_lines_changed']:>5} {str(x['proof_lines_changed'] if x['proof_lines_changed'] is not None else '-'):>6} {x['agent_test_lines_added']:>8}")
json.dump(rows, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "G_summary.json"), "w"), indent=1)
