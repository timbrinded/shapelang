#!/usr/bin/env python3
"""M0 hash check (ROADMAP M0 exit criterion, m0/REGISTERED.md).

Extracts every 16-hex value, and every longer hex digest (compared on its first 16 hex digits,
and on every digit it shows), from

    spec/EXAMPLES.md, spec/RECORDS.md, spec/MODEL.md and annex section A.12.11 of spec/ANNEX.md,

gives each the name the text gives it (the NAMES table below: a phrase that must end the text
before the value), and compares it with the named value that spec/vectors/vectors.py prints.

It also checks that spec/vectors/vectors.json is byte-identical to vectors.py's output, and audits
the no-float assertion: every SHA-256/SHA-1 input vectors.py hashes is recorded at run time, every
input that is a JSON text is re-parsed and must be canonical (sorted keys, no whitespace), ASCII-keyed,
float-free and within the safe-integer range, and every other input must be a non-JSON byte string
(a label or illustrative file bytes, which hold no JSON numbers at all).

Run (writes nothing unless --json is given):
    python3 -I experiments/shape-1/m0/hexcheck.py [--spec DIR] [--extras] [--json OUT]

--extras also reports, without gating, the hex values elsewhere in the annex (A.4.4.9, A.14) and in
SYNTAX.md, which the registered criterion does not cover.

Exit 0 iff: 0 mismatches, 0 unnamed values, every name rule used as often as declared,
vectors.json identical to the output, and the float audit clean. Otherwise exit 1.
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import re
import runpy
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HEX = re.compile(r"(?<![0-9A-Za-z])([0-9a-fA-F]{16,})(?![0-9A-Za-z])")
PREFIX = re.compile(r"(sha256:|bd:|ob:|g:|c:)$")
SHORT_DIGEST = re.compile(r"(?<![0-9A-Za-z])(sha256:|bd:|ob:|g:|c:)([0-9a-f]{1,15})(?![0-9a-fA-F])")

# ---------------------------------------------------------------------------------------------
# Names. Each rule: (anchor, vector, uses). A value is named by the rule whose anchor is the
# longest suffix of the text before it on its line (whitespace collapsed, every hex run of 16 or
# more digits written <hex>). `vector` is a key of vectors.py's output, or "input:<name>" for a
# vectors.py input constant (INPUTS), "derived:<name>" for a value computed with vectors.py's own
# functions (DERIVED, extras only), or None for an illustrative value no vector defines (extras only).
# `uses` is how many values the rule must name.
# ---------------------------------------------------------------------------------------------
BROAD = ["ts:experiments/bend-probes/E/f1-synth.ts#synthesize",
         "ts:experiments/semantic-kernel/harness/benchmark.ts#medianDuration",
         "ts:packages/shp-checker/src/behavioural/determinism.test.ts",
         "ts:packages/shp-cli/src/commands/update/impl.ts#replaceWindowsBinary"]

NAMES = {
    "EXAMPLES.md": [
        # Example 1
        ("AppendOnly gives `forbid Update<audit::AuditEvent>` over `*` (fp `", "fp ex1.appendonly", 1),
        ("`authority(AuditStore)` is `", "fp ex1.authority.base", 1),
        ("is `<hex>…`; the law `", "fp ex1.history.law", 1),
        ("canonically `pg.table(\"audit_events\")` (fact `", "factId ex1.purge", 1),
        ("authority a cause: `ob:", "key ex1.B.contradiction", 1),
        ("authority a cause: `ob:<hex>…`, binding `bd:", "binding ex1.B.contradiction", 1),
        ("authority a cause: `ob:<hex>…`, binding `bd:<hex>…`, group `g:", "group ex1.B", 1),
        ("is `ungoverned` but under `*`: blocking `ob:", "key ex1.Bprime.contradiction", 1),
        ("no observer reads shell, so coverage `ob:", "key ex1.Bsecond.coverage.ungoverned", 1),
        ("no observer reads shell, so coverage `ob:<hex>…` (binding `bd:",
         "binding ex1.Bsecond.coverage.ungoverned", 1),
        ("`ungoverned`): `ob:", "key ex1.C.forbid", 1),
        ("`ungoverned`): `ob:<hex>…`, binding `bd:", "binding ex1.C.forbid", 1),
        ("bounded by its summary): `ob:", "key ex1.C.authority", 1),
        ("bounded by its summary): `ob:<hex>…`, binding `bd:", "binding ex1.C.authority", 1),
        ("Both are exploited and block, in group `g:", "group ex1.C", 1),
        ("Phase 1 prints `shape approve bd:", "ref ex1.C.forbid", 1),
        ("Phase 1 prints `shape approve bd:<hex> bd:", "ref ex1.C.authority", 1),
        ("carol (second person for the final one) writes `shape approve bd:", "ref ex1.C.forbid", 1),
        # Example 2
        ("(`assume` `", "fp ex2.confine assume", 1),
        ("; `external_body` `", "fp ex2.confine external_body", 1),
        ("excepting HostTrusted; `Undeclared` `", "fp ex2.confine Undeclared", 1),
        ("the fact `(set, assume<Trust>, 1)` (`", "factId ex2.hatch", 1),
        ("mechanical contradiction `ob:", "key ex2.contradiction", 1),
        ("mechanical contradiction `ob:<hex>…`, binding `bd:", "binding ex2.contradiction", 1),
        ("**SetRefinesSpec** (`", "fp ex2.law.set", 1),
        ("introduced, blocking at critical, `ob:", "key ex2.unestablished", 1),
        ("introduced, blocking at critical, `ob:<hex>…`, binding `bd:", "binding ex2.unestablished", 1),
        ("Two blocking mechanical obligations, group `g:", "group ex2", 1),
        ("also writes `shape approve bd:", "ref ex2.contradiction", 1),
        ("also writes `shape approve bd:<hex> bd:", "ref ex2.unestablished", 1),
        # Example 3
        ("The law (`", "fp ex3.refactor.law", 1),
        ("gives unestablished `stale`, `ob:", "key ex3.unestablished.refactor", 1),
        ("gives unestablished `stale`, `ob:<hex>…`, binding `bd:", "binding ex3.unestablished.refactor", 1),
        ("deciding `Deterministic`: rule `", "fp ex3.clock.checker", 1),
        ("(9 checker components, A.14.3), law `", "fp ex3.det.law", 1),
        ("is L4 loosened, latent (`ob:", "key ex3.loosening.refactor.removed", 1),
        ("makes the law producer-changed (`ob:", "key ex3.unestablished.det", 1),
        ("seeded `Date.now()` in `checkFreshness` (fact `", "factId ex3.clock", 1),
        ("sound, introduced, blocking contradiction, `ob:", "key ex3.contradiction", 1),
        # Example 4
        ("Relation `", "fp ex4.relation", 1),
        ("Relation `<hex>…`, rule `", "fp ex4.cycle", 1),
        ("The declared edge (`", "factId ex4.declared", 1),
        ("observed reverse edge (representative `", "ex4 representative call fact", 1),
        ("one heuristic contradiction, `ob:", "key ex4.cycle", 1),
        ("one heuristic contradiction, `ob:<hex>…`, binding `bd:", "binding ex4.cycle", 1),
        ("one heuristic contradiction, `ob:<hex>…`, binding `bd:<hex>…`, group `g:", "group ex4", 1),
        ("`relations complete over calls` on ShapeRuleEngine (`", "fp ex4.complete", 1),
        ("L3 loosened, exploited, `ob:", "key ex4.complete.loosening", 1),
    ],
    "RECORDS.md": [
        ("with scope root `sha256:", "scope root ex1", 1),
        ("\"projection\": \"unit\", \"scheme\": \"ts.unit.v2\", \"digest\": \"sha256:",
         "input:scope root ex1 entry ts:src/audit/purge.ts#purgeOldEvents unit digest", 1),
    ],
    "MODEL.md": [],
    "ANNEX.md A.12.11": [
        ("schemaFp AppendOnly ", "schemaFp std::AppendOnly", 1),
        (", RefactorSensitive ", "schemaFp std::RefactorSensitive", 1),
        (", Verified ", "schemaFp std::Verified", 1),
        (", ReviewedSurface ", "schemaFp std::ReviewedSurface", 1),
        (", Deterministic ", "schemaFp std::Deterministic", 1),
        (", HistoryPreserved ", "schemaFp std::HistoryPreserved", 1),
        (", Bounded ", "schemaFp std::Bounded", 1),
        ("Variant C head authority ", "fp ex1.authority.headC", 1),
        ("kernel isolation ", "fp kernel.isolation", 1),
        ("hatch clauses external_body ", "fp ex2.confine external_body", 1),
        (", Undeclared ", "fp ex2.confine Undeclared", 1),
        (", ts_ignore ", "fp ex2.confine ts_ignore", 1),
        (", ts_expect_error ", "fp ex2.confine ts_expect_error", 1),
        (", ts_nocheck ", "fp ex2.confine ts_nocheck", 1),
        # an unlabelled list; its order is A.14.3.2's, which is identity order
        ("Example 3 broad-clause keys ", "key ex3.broad " + BROAD[0], 1),
        ("Example 3 broad-clause keys <hex>, ", "key ex3.broad " + BROAD[1], 1),
        ("Example 3 broad-clause keys <hex>, <hex>, ", "key ex3.broad " + BROAD[2], 1),
        ("Example 3 broad-clause keys <hex>, <hex>, <hex>, ", "key ex3.broad " + BROAD[3], 1),
    ],
}

# Not gated: values outside the registered scope (--extras).
EXTRA_NAMES = {
    "ANNEX.md rest": [
        ("true sorts before false (Example 4's ", "ex4 representative call fact", 1),
        ("all complete; facts HardDelete and Append on pg.table(\"public.audit_events\"); scope root ",
         "scope root ex1", 1),
        ("about {github:acme/audit#57, [bd:", "ref ex1.C.authority", 1),
        ("about {github:acme/audit#57, [bd:<hex>, bd:", "ref ex1.C.forbid", 1),
        ("]}, subject digest ", "answer subject digest ex1.C bob", 1),
        ("]}, subject digest <hex>; carol's ", "answer subject digest ex1.C carol", 1),
        ("set digests: unit ", "input:SET_UNIT_B", 1),
        ("set digests: unit <hex> → ", "input:SET_UNIT_H", 1),
        ("set digests: unit <hex> → <hex>, own ", "label set own base", 1),
        ("set digests: unit <hex> → <hex>, own <hex> → ", "label set own head", 1),
        ("(code space, ", None, 1),
        ("(code space, <hex> → ", None, 1),
        ("the Hatch clause ", "derived:v6 Hatch clause fp", 1),
        ("isoToday's unit digest ", "input:ISO_B", 1),
        ("isoToday's unit digest <hex> → ", "input:ISO_H", 1),
        ("call facts ", "factId ex4.call facts.ts->requirementsForTarget", 1),
        ("call facts <hex>, ", "factId ex4.call facts.ts->shapeTraitBearers", 1),
        ("call facts <hex>, <hex>, ", "factId ex4.call context.ts->requiresReevaluation", 1),
    ],
    "SYNTAX.md": [
        ("\"version\": \"1.0.0\", \"digest\": \"sha256:", None, 1),
    ],
}


def inputs(ns):
    """vectors.py input constants that a document cites (they feed a named output)."""
    e = [x for x in ns["entries"] if x["id"] == "ts:src/audit/purge.ts#purgeOldEvents" and x["projection"] == "unit"]
    assert len(e) == 1
    return {
        "scope root ex1 entry ts:src/audit/purge.ts#purgeOldEvents unit digest": e[0]["digest"],
        "SET_UNIT_B": ns["SET_UNIT_B"], "SET_UNIT_H": ns["SET_UNIT_H"],
        "ISO_B": ns["ISO_B"], "ISO_H": ns["ISO_H"],
    }


def derived(ns):
    """Values computed with vectors.py's functions that it does not print (extras only)."""
    return {"v6 Hatch clause fp": ns["H"](ns["nf"]("effect.forbid",
                                                    {"atom": "Hatch<std::Trust>", "scope": ["*"], "except": []}))}


# ---------------------------------------------------------------------------------------------
def norm(s):
    return " ".join(HEX.sub("<hex>", s).split())


def sources(spec, extras):
    """(source name, path, [(line number, text)]) for each scanned region."""
    out = []
    for f in ["EXAMPLES.md", "RECORDS.md", "MODEL.md"]:
        p = os.path.join(spec, f)
        with open(p, encoding="utf-8") as fh:
            out.append((f, p, list(enumerate(fh.read().split("\n"), 1)), True))
    p = os.path.join(spec, "ANNEX.md")
    with open(p, encoding="utf-8") as fh:
        lines = list(enumerate(fh.read().split("\n"), 1))
    sec = [(n, t) for n, t in lines if t.startswith("A.12.11 ")]
    if len(sec) != 1:
        raise SystemExit("hexcheck: expected exactly one line starting 'A.12.11 ' in ANNEX.md, found %d" % len(sec))
    out.append(("ANNEX.md A.12.11", p, sec, True))
    if extras:
        out.append(("ANNEX.md rest", p, [(n, t) for n, t in lines if not t.startswith("A.12.11 ")], False))
        p = os.path.join(spec, "SYNTAX.md")
        with open(p, encoding="utf-8") as fh:
            out.append(("SYNTAX.md", p, list(enumerate(fh.read().split("\n"), 1)), False))
    return out


def run_vectors(vpy):
    r = subprocess.run([sys.executable, "-I", vpy], capture_output=True, check=False)
    if r.returncode != 0:
        raise SystemExit("hexcheck: vectors.py exited %d: %s" % (r.returncode, r.stderr.decode()[-2000:]))
    return r.stdout


def float_audit(vpy):
    """Run vectors.py in-process with hashlib's constructors wrapped; classify every hashed input."""
    calls = []
    orig = {n: getattr(hashlib, n) for n in ("sha256", "sha1")}

    def wrap(name):
        def f(data=b"", **kw):
            calls.append((name, bytes(data)))
            return orig[name](data, **kw)
        return f

    buf = io.StringIO()
    try:
        for n in orig:
            setattr(hashlib, n, wrap(n))
        with contextlib.redirect_stdout(buf):
            ns = runpy.run_path(vpy, run_name="vectors_audit")
    finally:
        for n, f in orig.items():
            setattr(hashlib, n, f)
    problems, json_inputs, raw_inputs = [], 0, []
    for name, data in calls:
        try:
            text = data.decode("utf-8")
            found = []

            def pf(s, found=found):
                found.append("float " + s)
                return float(s)

            def pc(s, found=found):
                found.append("constant " + s)
                return 0
            val = json.loads(text, parse_float=pf, parse_constant=pc)
        except (UnicodeDecodeError, ValueError):
            raw_inputs.append((name, data))
            continue
        json_inputs += 1
        bad = list(found)

        def walk(v):
            if isinstance(v, dict):
                for k, x in v.items():
                    if not k.isascii():
                        bad.append("non-ASCII key %r" % k)
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
            elif isinstance(v, int) and not isinstance(v, bool) and not -(2**53 - 1) <= v <= 2**53 - 1:
                bad.append("unsafe integer %d" % v)
        walk(val)
        if json.dumps(val, sort_keys=True, separators=(",", ":"), ensure_ascii=False) != text:
            bad.append("not in canonical form")
        if bad:
            problems.append("%s input %s: %s" % (name, text[:80], "; ".join(bad)))
    # every JSON hash goes through jcs, which calls no_floats first (static check of the call chain)
    chain = {"jcs": "no_floats", "hexh": "jcs", "H": "hexh", "ob_key": "hexh", "binding": "hexh",
             "group_id": "hexh", "fact_id": "H"}
    for fn, callee in chain.items():
        if callee not in ns[fn].__code__.co_names:
            problems.append("%s does not call %s" % (fn, callee))
    # the assertion rejects floats wherever JSON can hold them (a tuple serialises as an array)
    probes = {"float": {"x": 1.0}, "nested float": {"x": [{"y": 0.5}]}, "float in tuple": {"x": (1.0,)},
              "non-ASCII key": {"é": 1}, "unsafe integer": {"x": 2**53}}
    probe_results = {}
    for label, v in probes.items():
        try:
            ns["jcs"](v)
            probe_results[label] = "accepted"
            problems.append("jcs accepts a value with a %s" % label)
        except AssertionError:
            probe_results[label] = "rejected"
    raw_kinds = []
    for name, data in raw_inputs:
        raw_kinds.append("%s %r" % (name, data[:48]))
    return {"calls": len(calls), "json": json_inputs, "raw": len(raw_inputs), "rawInputs": raw_kinds,
            "probes": probe_results, "problems": problems, "stdout": buf.getvalue()}, ns


def vector_hex(v):
    """(prefix, hex) of a printed vector value, or None when it is not a digest form."""
    m = re.fullmatch(r"(sha256:|bd:|ob:|g:)?([0-9a-f]{16,})", v)
    return (m.group(1) or "", m.group(2)) if m else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--spec", default=os.path.normpath(os.path.join(HERE, "..", "spec")))
    ap.add_argument("--extras", action="store_true")
    ap.add_argument("--json", metavar="OUT")
    a = ap.parse_args()
    vpy = os.path.join(a.spec, "vectors", "vectors.py")
    vjson = os.path.join(a.spec, "vectors", "vectors.json")
    printed = run_vectors(vpy)
    V = json.loads(printed)
    audit, ns = float_audit(vpy)
    with open(vjson, "rb") as fh:
        json_same = fh.read() == printed
    inproc_same = audit.pop("stdout").encode("utf-8") == printed
    IN, DER = inputs(ns), derived(ns)

    def resolve(name):
        if name is None:
            return None
        if name.startswith("input:"):
            return IN.get(name[6:])
        if name.startswith("derived:"):
            return DER.get(name[8:])
        return V.get(name)

    by_hex = {}
    for k, v in list(V.items()) + [("input:" + k, v) for k, v in IN.items()]:
        vh = vector_hex(v) if isinstance(v, str) else None
        if vh:
            by_hex.setdefault(vh[1][:16], []).append(k)

    rows, unnamed, short = [], [], []
    used = {}
    tables = dict(NAMES)
    tables.update(EXTRA_NAMES)
    for src, path, lines, gated in sources(a.spec, a.extras):
        rules = tables.get(src, [])
        for n, text in lines:
            for m in SHORT_DIGEST.finditer(text):
                if text[m.end():m.end() + 1] in ("…", "`", " ", ",", ")", ".", "\"", ";", "") and gated:
                    short.append({"source": src, "line": n, "value": m.group(0)})
            for m in HEX.finditer(text):
                hx = m.group(1)
                before = text[:m.start()]
                pm = PREFIX.search(before)
                prefix = pm.group(1) if pm else ""
                ctx = norm(before)
                cands = [r for r in rules if ctx.endswith(norm(r[0]))]
                cands.sort(key=lambda r: -len(norm(r[0])))
                row = {"source": src, "line": n, "col": m.start() + 1, "gated": gated, "shown": prefix + hx,
                       "truncated": text[m.end():m.end() + 1] == "…", "context": ctx[-90:]}
                if not cands or (len(cands) > 1 and len(norm(cands[0][0])) == len(norm(cands[1][0]))):
                    row.update(status="unnamed" if not cands else "ambiguous",
                               candidates=[r[1] for r in cands], alsoEquals=by_hex.get(hx.lower()[:16], []))
                    (unnamed.append(row) if gated else rows.append(row))
                    continue
                anchor, name, _ = cands[0]
                used[(src, anchor)] = used.get((src, anchor), 0) + 1
                row.update(textName=anchor.strip(), vector=name)
                val = resolve(name)
                if name is None:
                    row.update(status="unvectored", expected=None)
                elif val is None:
                    row.update(status="no such vector", expected=None)
                else:
                    vh = vector_hex(val)
                    row["expected"] = val
                    why = []
                    if vh is None:
                        why.append("named value is not a digest")
                    else:
                        if hx != hx.lower():
                            why.append("upper-case hex")
                        if prefix and vh[0] and prefix != vh[0]:
                            why.append("prefix %s, vector has %s" % (prefix, vh[0]))
                        if prefix and not vh[0] and prefix != "sha256:":
                            why.append("prefix %s on a bare digest" % prefix)
                        if vh[1][:16] != hx.lower()[:16]:
                            why.append("first 16 hex differ")
                        elif not vh[1].startswith(hx.lower()):
                            why.append("digits beyond 16 differ")
                        if name.startswith("ref ") and not row["truncated"] and len(hx) != 16:
                            why.append("a ref is bd: + 16 hex")
                    if why:
                        row.update(status="MISMATCH", reason="; ".join(why),
                                   alsoEquals=[k for k in by_hex.get(hx.lower()[:16], []) if k != name])
                    else:
                        row["status"] = "match"
                rows.append(row)
    unused = []
    for src, rules in tables.items():
        if src in EXTRA_NAMES and not a.extras:
            continue
        for anchor, name, uses in rules:
            got = used.get((src, anchor), 0)
            if got != uses:
                unused.append({"source": src, "anchor": anchor, "vector": name, "declared": uses, "used": got})
    gated_rows = [r for r in rows if r["gated"]]
    mism = [r for r in gated_rows if r["status"] != "match"]
    extra_rows = [r for r in rows if not r["gated"]]
    gated_unused = [u for u in unused if u["source"] in NAMES]

    print("vectors.py: %d values printed (%s)" % (len(V), vpy))
    print("vectors.json byte-identical to vectors.py output: %s" % ("yes" if json_same else "NO"))
    print("in-process run prints the same bytes: %s" % ("yes" if inproc_same else "NO"))
    print("float audit: %d hash calls, %d JSON inputs (canonical, float-free, ASCII keys, safe integers), "
          "%d non-JSON byte inputs; probes %s; %d problems"
          % (audit["calls"], audit["json"], audit["raw"],
             ", ".join("%s %s" % kv for kv in audit["probes"].items()), len(audit["problems"])))
    for p in audit["problems"]:
        print("  FLOAT-AUDIT " + p)
    print()
    for r in gated_rows:
        if r["status"] == "match":
            print("  match    %-18s %4d  %-26s %s" % (r["source"], r["line"], r["shown"][:26], r["vector"]))
    for r in mism + unnamed:
        print("  %-8s %-18s %4d  %-26s %s  [%s]  context: ...%s"
              % (r["status"], r["source"], r["line"], r["shown"][:26], r.get("vector", r.get("candidates")),
                 r.get("reason", "also equals: %s" % r.get("alsoEquals")), r["context"][-60:]))
    for u in gated_unused:
        print("  RULE     %-18s anchor %r -> %s used %d times, declared %d"
              % (u["source"], u["anchor"], u["vector"], u["used"], u["declared"]))
    for s in short:
        print("  SHORT    %-18s %4d  %s (digest form with fewer than 16 hex digits)" % (s["source"], s["line"], s["value"]))
    print()
    counted = len(gated_rows) + len(unnamed)
    print("checked %d hex values (%s): %d match, %d mismatches, %d unnamed, %d unused name rules, %d short digests"
          % (counted, ", ".join("%s %d" % (s, sum(1 for r in gated_rows + unnamed if r["source"] == s))
                                for s in NAMES),
             counted - len(mism) - len(unnamed), len(mism), len(unnamed), len(gated_unused), len(short)))
    if a.extras:
        print()
        print("extras (not gated):")
        for r in extra_rows:
            print("  %-10s %-14s %4d  %-26s %s%s"
                  % (r["status"], r["source"], r["line"], r["shown"][:26], r.get("vector", r.get("candidates")),
                     ("  [" + r["reason"] + "]") if r.get("reason") else ""))
        for u in unused:
            if u["source"] in EXTRA_NAMES:
                print("  RULE       %-14s anchor %r -> %s used %d times, declared %d"
                      % (u["source"], u["anchor"], u["vector"], u["used"], u["declared"]))
    ok = json_same and inproc_same and not audit["problems"] and not mism and not unnamed and not gated_unused
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"vectors": len(V), "vectorsJsonIdentical": json_same, "floatAudit": audit,
                       "checked": counted, "mismatches": len(mism), "unnamed": len(unnamed),
                       "unusedRules": gated_unused, "short": short, "rows": rows + unnamed, "ok": ok},
                      fh, indent=1, ensure_ascii=False)
            fh.write("\n")
    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
