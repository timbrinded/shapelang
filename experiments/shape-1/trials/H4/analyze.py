"""H4 scoring: reads run.ts / run-kernel.ts outputs and manual.json, classifies every case per
tool, scores against the manual reading, and prints the tables used in the report.
Usage: python3 -I analyze.py <outDir> <manual.json> [--json results.json]"""
import json
import os
import sys

OUT, MANUAL = sys.argv[1], sys.argv[2]
JSON_OUT = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
man = json.load(open(MANUAL))["cases"]
summary = {r["id"]: r for r in json.load(open(os.path.join(OUT, "summary.json")))}
ORDER = list(summary)
LOOSE_SIGNALS_EXCLUDED = {"false-completeness"}


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def short(s):
    s = str(s)
    return s[7:19] if s.startswith("sha256:") else s


def fact_texts(o):
    out = {}
    for coll in ("errors", "obligations"):
        for x in o.get(coll, []):
            for c in x.get("causes", []):
                if c.get("type") == "fact" and c.get("text"):
                    out[c["id"]] = c["text"]
    return out


def proto_parts(cid, run):
    o = load(os.path.join(OUT, f"{cid}.{run}.proto.json"))
    if o is None:
        return None, None
    return o.get("loosening", []), o


def kernel_parts(cid, run, variant=""):
    d = load(os.path.join(OUT, f"{cid}.{run}.kdump{variant}.json"))
    k = load(os.path.join(OUT, f"{cid}.{run}.kernel{variant}.json"))
    if d is None:
        return None, k
    parts = []
    for p in d.get("parts", []):
        parts.append({"question": "L7" if p["question"] == "L7?" else p["question"],
                      "answer": "undecided" if p["question"] == "L7?" else "loosened",
                      "subject": p["subject"], "delta": p["delta"], "realise": p["realise"],
                      "realised": p["realised"], "affected": p["affected"]})
    for l in d.get("l3", []):
        v = l["decision"]["verdict"]
        if v in ("edgeCex", "searchCex"):
            parts.append({"question": "L3", "answer": "loosened", "subject": l["subject"], "cex": l["decision"]["cex"]})
        elif v == "budget":
            parts.append({"question": "L3", "answer": "undecided", "subject": l["subject"]})
    return parts, k


def direction(parts):
    if parts is None:
        return "n/a"
    if any(p["answer"] == "loosened" for p in parts):
        return "L"
    if any(p["answer"] == "undecided" for p in parts):
        return "U"
    return "-"


def order_class(fwd, rev):
    if fwd == "n/a":
        return "n/a"
    if fwd == "L":
        return "incomparable" if rev == "L" else "looser"
    if fwd == "U":
        return "undecided"
    return {"L": "tighter", "U": "no-loosening", "-": "equivalent"}.get(rev, "no-loosening")


def binary(cls):
    if cls in ("looser", "incomparable"):
        return "yes"
    if cls in ("tighter", "equivalent", "no-loosening"):
        return "no"
    return "undecided"


def score(truth_loosens, tool_bin):
    if tool_bin == "undecided":
        return "abstain"
    if truth_loosens == "rename":
        return "correct" if tool_bin == "no" else "wrong"
    return "correct" if tool_bin == truth_loosens else "wrong"


def class_ok(ref, cls, loosens):
    if cls == ref:
        return True
    if loosens == "rename" and cls == "undecided":
        return None  # acceptable abstention
    return False


rows = []
for cid in ORDER:
    m = man[cid]
    s = summary[cid]
    r = {"id": cid, "family": s["family"], "ref": m["ref"], "loosens": m["loosens"], "specLiteral": m.get("specLiteral", m["ref"])}
    # prototype
    for run in ("fwd", "fwdu", "rev", "orig"):
        parts, o = proto_parts(cid, run)
        r[f"p_{run}"] = direction(parts)
        if run == "fwd" and parts is not None:
            ft = fact_texts(o)
            r["p_parts"] = [{"q": p["question"], "subject": short(p["subject"]), "answer": p["answer"], "exploited": p["exploited"],
                             "final": p["final"], "cx": p["counterexample"],
                             "cxText": ft.get(p["counterexample"]) if isinstance(p["counterexample"], str) else None} for p in parts]
            r["p_verdict"] = o.get("verdict")
            r["p_errors"] = sorted({e["code"] for e in o.get("errors", [])})
    r["proto"] = order_class(r["p_fwd"], r["p_rev"])
    r["proto_u"] = order_class(r["p_fwdu"], r["p_rev"])
    # kernel (as is) and with the default-binding workaround
    for variant, tag in (("", "k"), ("-prebind", "kb")):
        kf, kof = kernel_parts(cid, "fwd", variant)
        kr, _ = kernel_parts(cid, "rev", variant)
        r[f"{tag}_fwd"], r[f"{tag}_rev"] = direction(kf), direction(kr)
        r[tag] = order_class(r[f"{tag}_fwd"], r[f"{tag}_rev"])
        if kf is not None:
            r[f"{tag}_parts"] = [{"q": p["question"], "subject": short(p["subject"]), "answer": p["answer"],
                                  "realised": p.get("realised"), "cex": p.get("cex", (p.get("realise") or [None])[0])} for p in kf]
            obs = [x for x in (kof or {}).get("obligations", []) if x["kind"] == "loosening"]
            r[f"{tag}_obs"] = [{"subject": short(x["subject"]), "questions": x["questions"], "exploited": x["exploited"], "final": x["final"], "binding": x["binding"]} for x in obs]
            r[f"{tag}_verdict"] = (kof or {}).get("verdict")
    # 0.x
    zx = s["zerox"]
    r["zerox"] = "looser" if zx["uniform"]["ruleLoosening"] else "no-loosening"
    r["zerox_parity"] = None if "parity" not in zx else ("looser" if zx["parity"]["ruleLoosening"] else "no-loosening")
    r["zerox_allow"] = "looser" if zx["uniformAllowUnknown"]["ruleLoosening"] else "no-loosening"
    r["zerox_first"] = zx["uniform"]["firstError"]
    # syntactic diff
    sem = s["sem"]
    loose = [f for f in sem["findings"] if f["signal"] not in LOOSE_SIGNALS_EXCLUDED]
    r["sem_signals"] = [f"{f['impact']}/{f['support']}/{f['disposition']} {f['signal']}" for f in sem["findings"]]
    r["sem"] = "looser" if loose else ("equivalent" if not sem["rawChanges"] else "no-loosening")
    r["sem_raw"] = len(sem["rawChanges"])
    # scoring
    for tool in ("proto", "proto_u", "k", "kb", "zerox", "zerox_parity", "sem"):
        cls = r[tool]
        if cls is None:
            continue
        r[f"{tool}_bin"] = binary(cls)
        r[f"{tool}_score"] = score(m["loosens"], binary(cls))
        r[f"{tool}_score_spec"] = score("yes" if m.get("specLiteral") in ("looser", "incomparable") else m["loosens"], binary(cls))
        r[f"{tool}_class_ok"] = class_ok(m["ref"], cls, m["loosens"])
    rows.append(r)


def tally(fam, tool, key="score"):
    sel = [r for r in rows if (fam is None or r["family"] in fam) and r.get(tool) is not None]
    c = sum(r[f"{tool}_{key}"] == "correct" for r in sel)
    w = sum(r[f"{tool}_{key}"] == "wrong" for r in sel)
    a = sum(r[f"{tool}_{key}"] == "abstain" for r in sel)
    return len(sel), c, w, a


def tally5(fam, tool):
    sel = [r for r in rows if (fam is None or r["family"] in fam) and r.get(tool) is not None]
    ok = sum(r[f"{tool}_class_ok"] is True for r in sel)
    acc = sum(r[f"{tool}_class_ok"] is None for r in sel)
    bad = sum(r[f"{tool}_class_ok"] is False for r in sel)
    return len(sel), ok, acc, bad


TOOLS = [("proto", "prototype (fwd + rev)"), ("proto_u", "prototype, fwd over union code"), ("k", "Lean kernel as built"),
         ("kb", "Lean kernel + default-binding workaround"), ("zerox", "0.x --check-loosening (uniform)"),
         ("zerox_parity", "0.x --check-loosening (repo parity form)"), ("sem", "syntactic inspect diff")]
FAMS = [(("loosening",), "fixtures/loosening (23)"), (("guard", "calibration"), "guard + calibration (10)"), (None, "all (33)")]

print("## Per case\n")
print("| case | manual (ref) | proto fwd/rev → class | kernel → class | kernel+bind → class | 0.x | syntactic diff |")
print("|---|---|---|---|---|---|---|")
for r in rows:
    ref = r["ref"] + (f" (literal: {r['specLiteral']})" if r["specLiteral"] != r["ref"] else "")
    mark = lambda t: {"correct": "", "wrong": " ✗", "abstain": " ?"}.get(r.get(f"{t}_score"), "")
    print(f"| {r['id']} | {ref} | {r['p_fwd']}/{r['p_rev']} → {r['proto']}{mark('proto')} | {r['k_fwd']}/{r['k_rev']} → {r['k']}{mark('k')} | "
          f"{r['kb_fwd']}/{r['kb_rev']} → {r['kb']}{mark('kb')} | {r['zerox']}{mark('zerox')} | {r['sem']}{mark('sem')} |")

print("\n## Binary (does the change loosen?) against the manual reading: n, correct, wrong, abstained\n")
print("| tool | " + " | ".join(f for _, f in FAMS) + " |")
print("|---|" + "---|" * len(FAMS))
for t, name in TOOLS:
    print(f"| {name} | " + " | ".join("%d: %d / %d / %d" % tally(f, t) for f, _ in FAMS) + " |")
print("\n## Binary against the literal v6 text (read_only_function_added = loosens)\n")
print("| tool | " + " | ".join(f for _, f in FAMS) + " |")
print("|---|" + "---|" * len(FAMS))
for t, name in TOOLS:
    print(f"| {name} | " + " | ".join("%d: %d / %d / %d" % tally(f, t, "score_spec") for f, _ in FAMS) + " |")
print("\n## Five-class order (looser / tighter / equivalent / incomparable / undecided): n, exact, acceptable abstention, wrong\n")
print("| tool | " + " | ".join(f for _, f in FAMS) + " |")
print("|---|" + "---|" * len(FAMS))
for t, name in TOOLS:
    print(f"| {name} | " + " | ".join("%d: %d / %d / %d" % tally5(f, t) for f, _ in FAMS) + " |")

print("\n## Prototype forward parts and counterexamples\n")
for r in rows:
    if not r.get("p_parts"):
        continue
    print(f"- {r['id']} (verdict {r['p_verdict']}, errors {r['p_errors']}):")
    for p in r["p_parts"]:
        cx = p["cxText"] or json.dumps(p["cx"])
        print(f"    {p['q']} {p['subject']} {p['answer']} exploited={p['exploited']} final={p['final']} cx={cx[:160]}")

print("\n## Kernel forward parts (KDump) and obligations\n")
for r in rows:
    if not r.get("k_parts"):
        continue
    qs = {}
    for p in r["k_parts"]:
        qs.setdefault((p["q"], p["subject"], p["answer"]), []).append(p)
    print(f"- {r['id']} (verdict {r.get('k_verdict')}):")
    for (q, sub, ans), ps in qs.items():
        ex = ps[0]["cex"]
        print(f"    {q} {sub} {ans} parts={len(ps)} realised={any(p['realised'] for p in ps)} cex={json.dumps(ex)[:150]}")
    for o in r.get("k_obs", []):
        print(f"    ob {o['subject']} {o['questions']} exploited={o['exploited']} final={o['final']}")

if JSON_OUT:
    json.dump(rows, open(JSON_OUT, "w"), indent=1)
