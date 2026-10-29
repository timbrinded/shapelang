"""Shape 1.0 model v7 (derived from v4 vectors.py; changes: AppendOnly forbids Update; hatch * = declared kinds + Undeclared; v7 L1 deltas; coverage delta pairs):
Shape 1.0 model v4: conformance vectors for claim NFs, template fingerprints, fact ids,
obligation keys, bindings, group ids and answer refs, exactly as the record schema (v4) defines them.

Run: python3 -I vectors.py            (prints JSON)
JCS: RFC 8785. Every hashed value here is an object with ASCII keys, arrays, strings,
safe integers, booleans or null; no floats occur (asserted), and for such values
json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) is byte-identical to JCS.

Changes from v3's vectors.py:
- loosening keys carry no `question` (one obligation per base item, EM3-1);
- binding `code` entries are [id, projection, base digest|null, head digest|null]; unestablished
  obligations cite every Req pair (IMP3-05, U1);
- loosening deltas are prefixed by their question;
- cells are keyed by attribution pairs (IMP3-11);
- `forbid hatch * outside boundaries` elaborates to effect.forbid clauses (EM3-6), one per
  hatch kind in the down-set of Hatch, Hatch itself included (IMP3-07);
- the PostgreSQL resource-code tag is `pg.table` (IMP3-12);
- answer refs are 16-hex binding prefixes (S3-12, U7); gfp is gone (EM3-10).
"""
import hashlib
import json
import sys


def no_floats(v):
    if isinstance(v, float):
        raise AssertionError("float in hashed value: %r" % (v,))
    if isinstance(v, int) and not isinstance(v, bool):
        assert -(2**53 - 1) <= v <= 2**53 - 1, v
    if isinstance(v, dict):
        for k, x in v.items():
            assert isinstance(k, str)
            no_floats(x)
    if isinstance(v, list):
        for x in v:
            no_floats(x)


def jcs(v):
    no_floats(v)
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def hexh(v):
    return hashlib.sha256(jcs(v)).hexdigest()


def H(v):
    return "sha256:" + hexh(v)


def label(s):
    """Illustrative code digest: SHA-256 of a descriptive label (no real code was fingerprinted)."""
    return "sha256:" + hashlib.sha256(s.encode("utf-8")).hexdigest()


def nf(op, args):
    return {"v": "shape.claim.v1", "op": op, "args": args}


def template_nf(name, params, body, order=(), notes=()):
    return {"v": "shape.template.v1", "name": name,
            "params": [[p, k] for p, k in params],
            "body": sorted(body, key=lambda b: jcs(b)),
            "order": sorted([[p, o] for p, o in order]),
            "notes": sorted(notes)}


out = {}

# ---- templates (schema laws: a law in a body with no statement is {"op":"law","args":{"on":[...]}}) ----
t_det = template_nf("std::Deterministic", [("F", "unit")], [{"op": "law", "args": {"on": ["$0"]}}])
t_hist = template_nf("std::HistoryPreserved", [("R", "resource")], [{"op": "law", "args": {"on": []}}])
t_bounded = template_nf("std::Bounded", [("F", "unit"), ("Lo", "value"), ("Hi", "value")],
                        [{"op": "law", "args": {"on": ["$0"]}}], order=[("Lo", "geq"), ("Hi", "leq")])
t_verified = template_nf("std::Verified", [("K", "component")], [{"op": "law", "args": {"on": ["$0"]}}])
SURFACE_TEXT = "The trusted surface of this component is acceptable."
REFACTOR_TEXT = "Changes to this unit preserve the constraint recorded in its memory note."
t_surface = template_nf("std::ReviewedSurface", [("B", "component")],
                        [{"op": "law", "args": {"on": ["$0"], "statement": {"text": SURFACE_TEXT}}}])
t_refactor = template_nf("std::RefactorSensitive", [("U", "unit")],
                         [{"op": "law", "args": {"on": ["$0"], "statement": {"text": REFACTOR_TEXT}}}],
                         notes=["memory"])
# AppendOnly carries no tier in v4 (U8); its body is one effect.forbid on $0.
t_append = template_nf("std::AppendOnly", [("R", "resource")],
                       [{"op": "effect.forbid", "args": {"atom": "Update<$0>", "scope": ["*"], "except": []}}])
for k, t in {"std::Deterministic": t_det, "std::HistoryPreserved": t_hist, "std::Bounded": t_bounded,
             "std::Verified": t_verified, "std::ReviewedSurface": t_surface,
             "std::RefactorSensitive": t_refactor, "std::AppendOnly": t_append}.items():
    out["schemaFp " + k] = H(t)

# ---- claims ----------------------------------------------------------------
C = {}
C["ex1.appendonly"] = nf("effect.forbid", {"atom": "Update<audit::AuditEvent>", "scope": ["*"], "except": []})
C["ex1.authority.base"] = nf("authority", {"component": "audit::AuditStore",
                                           "grants": sorted(["Append<audit::AuditEvent>", "Read<audit::AuditEvent>"])})
C["ex1.authority.headC"] = nf("authority", {"component": "audit::AuditStore",
                                            "grants": sorted(["Append<audit::AuditEvent>", "HardDelete<audit::AuditEvent>", "Read<audit::AuditEvent>"])})
C["ex1.history.law"] = nf("law", {"on": ["component audit::AuditStore"],
                                  "statement": {"schema": "std::HistoryPreserved", "schemaFp": out["schemaFp std::HistoryPreserved"],
                                                "args": ["resource audit::AuditEvent"]}})
# Example 2: HatchesStayAtBoundaries<> elaborates to one effect.forbid per hatch kind in the down-set of Hatch.
HATCH_KINDS = {"external_body": "verus", "external": "verus", "assume": "verus", "admit": "verus",
               "assume_specification": "verus", "uninterp": "verus", "axiom": "verus", "unsafe": "bend",
               "ts_ignore": "ts", "ts_expect_error": "ts", "ts_nocheck": "ts"}  # unsafe is also declared in rust (one verb, two languages)
HOST_ALLOWS = {"external_body", "external", "uninterp"}
confine = {}
for h in sorted(list(HATCH_KINDS) + ["Undeclared"]):
    exc = ["component ironkv::HostTrusted"] if h in HOST_ALLOWS else []
    confine[h] = nf("effect.forbid", {"atom": "%s<std::Trust>" % h, "scope": ["*"], "except": exc})
    out["fp ex2.confine " + h] = H(confine[h])
C["ex2.confine.assume"] = confine["assume"]
C["ex2.confine.Undeclared"] = confine["Undeclared"]
C["ex2.law.set"] = nf("law", {"on": ["unit ironkv::DelegationMap.set"],
                              "statement": {"ref": "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set", "projection": "closure"}})
C["ex2.law.faithful"] = nf("law", {"on": ["unit ironkv::DelegationMap.set"],
                                   "statement": {"text": "The ensures clause of set states the map update the protocol layer relies on."}})
C["ex2.surface"] = nf("law", {"on": ["component ironkv::HostTrusted"], "statement": {"text": SURFACE_TEXT}})
CHECKER = ["checker::ShapeBindings", "checker::ShapeChecker", "checker::ShapeDiagnostics", "checker::ShapeModelLowerer",
           "checker::ShapeModuleResolver", "checker::ShapePreludeRegistry", "checker::ShapeRuleEngine",
           "checker::ShapeStringHelpers", "checker.incremental::ShapeIncrementalChecker"]
C["ex3.clock.checker"] = nf("effect.forbid", {"atom": "Read<tooling::SystemClock>",
                                              "scope": sorted("component " + q for q in CHECKER), "except": []})
C["ex3.clock.broad"] = nf("effect.forbid", {"atom": "Read<tooling::SystemClock>", "scope": ["*"],
                                            "except": ["unit tooling::ShpCli.isoToday"]})
C["ex3.det.law"] = nf("law", {"on": ["unit checker::ShapeChecker.checkShapeModules"],
                              "statement": {"schema": "std::Deterministic", "schemaFp": out["schemaFp std::Deterministic"],
                                            "args": ["unit checker::ShapeChecker.checkShapeModules"]}})
C["ex3.refactor.law"] = nf("law", {"on": ["unit tooling::ShpCli.isoToday"], "statement": {"text": REFACTOR_TEXT}})
C["ex4.relation"] = nf("edge.exists", {"from": "checker::ShapeRuleEngine", "kind": "calls", "to": "checker::ShapeModelLowerer"})
C["ex4.cycle"] = nf("cycle.forbid", {"kinds": ["calls"]})
C["ex4.complete"] = nf("edge.forbid", {"from": ["component checker::ShapeRuleEngine"], "exceptFrom": [], "kind": "calls",
                                       "to": ["*"], "exceptTo": ["component checker::ShapeModelLowerer"]})
C["kernel.isolation"] = nf("path.forbid", {"from": sorted(["component tooling::ShpCli", "component checker::ShapeChecker",
                                                           "component tooling::ShapeEditorServices"]),
                                           "to": ["component runtime::ExperimentalSemanticKernel"],
                                           "kinds": ["calls"], "exceptVia": []})
for k, v in C.items():
    out["nf " + k] = jcs(v).decode("utf-8")
    out["fp " + k] = H(v)
fp = {k: H(v) for k, v in C.items()}


# ---- facts, keys, bindings ---------------------------------------------------
def fact_id(f):
    return H(f)


def ob_key(o):
    return "ob:" + hexh(dict(o, v="shape.obligation.v1"))


def binding(key, affected, code, delta=()):
    """code entries: [id, projection, baseDigest|null, headDigest|null]."""
    return "bd:" + hexh({"v": "shape.binding.v1", "key": key, "affected": sorted(affected),
                         "code": sorted(code, key=lambda c: (c[0], c[1])), "delta": sorted(delta)})


def group_id(keys):
    return "g:" + hexh(sorted(keys))


def ref(b):
    """The answer ref a review line uses: 'bd:' + the first 16 hex of the binding."""
    return b[:3 + 16]


# Example 1
f_purge = {"type": "effect", "at": "ts:src/audit/purge.ts#purgeOldEvents", "verb": "HardDelete",
           "resource": "pg.table(\"audit_events\")"}
out["fact ex1.purge"] = jcs(f_purge).decode()
out["factId ex1.purge"] = fact_id(f_purge)
f_append = {"type": "effect", "at": "ts:src/audit/store.ts#appendEvent", "verb": "Append",
            "resource": "pg.table(\"audit_events\")"}
out["factId ex1.append"] = fact_id(f_append)
purge_fn_own = label("ts:src/audit/purge.ts#purgeOldEvents own, head")
purge_file_own = label("ts:src/audit/purge.ts own, head")
kB = ob_key({"kind": "contradiction", "claim": fp["ex1.appendonly"],
             "subject": {"code": "ts:src/audit/purge.ts#purgeOldEvents", "atom": "HardDelete<audit::AuditEvent>"}})
out["key ex1.B.contradiction"] = kB
bB = binding(kB, ["ts:src/audit/purge.ts#purgeOldEvents"],
             [["ts:src/audit/purge.ts#purgeOldEvents", "own", None, purge_fn_own]])
out["binding ex1.B.contradiction"] = bB
out["group ex1.B"] = group_id([kB])
kB2 = ob_key({"kind": "contradiction", "claim": fp["ex1.appendonly"],
              "subject": {"code": "ts:scripts/purge-audit.ts#purgeOldEvents", "atom": "HardDelete<audit::AuditEvent>"}})
out["key ex1.Bprime.contradiction"] = kB2
kBsh = ob_key({"kind": "coverage", "subject": "ungoverned"})
out["key ex1.Bsecond.coverage.ungoverned"] = kBsh
sh_own = label("raw:src/audit/purge.sh own, head")
out["binding ex1.Bsecond.coverage.ungoverned"] = binding(kBsh, ["raw:src/audit/purge.sh"],
                                                         [["raw:src/audit/purge.sh", "own", None, sh_own]],
                                                         [fp["ex1.appendonly"] + " effect(pg.table(\"audit_events\"))"])

kCf = ob_key({"kind": "loosening", "subject": fp["ex1.appendonly"]})
kCa = ob_key({"kind": "loosening", "subject": "component audit::AuditStore"})
out["key ex1.C.forbid"] = kCf
out["key ex1.C.authority (also Variant A)"] = kCa
CELL_A = 'cell:["audit::AuditStore.*","audit::AuditStore.*"]'
CELL_U = 'cell:["ungoverned","ungoverned"]'
ALL_IDS = ["pkgjson:package.json", "raw:bun.lock", "ts:src/audit/purge.ts", "ts:src/audit/purge.ts#purgeOldEvents",
           "ts:src/audit/store.ts", "ts:src/audit/store.ts#appendEvent", "ts:test/audit/history.test.ts"]
codeC = [["ts:src/audit/purge.ts", "own", None, purge_file_own],
         ["ts:src/audit/purge.ts#purgeOldEvents", "own", None, purge_fn_own]]
affected_forbid = ALL_IDS + [CELL_A, CELL_U]
affected_auth = ["ts:src/audit/purge.ts", "ts:src/audit/purge.ts#purgeOldEvents", "ts:src/audit/store.ts", CELL_A]
delta_forbid = ["L1 level %s<audit::AuditEvent> final>%s" % (a, t)
                for a in ["DropStorage", "LogicalDelete", "Redact", "Truncate"] for t in ["critical", "none"]] + \
               ["L1 level HardDelete<audit::AuditEvent> final>none", "L1 level Update<audit::AuditEvent> final>none"]
delta_auth = ["L1 authority+ HardDelete<audit::AuditEvent>", "L1 authority+ Update<audit::AuditEvent>"]
bCf = binding(kCf, affected_forbid, codeC, delta_forbid)
bCa = binding(kCa, affected_auth, codeC, delta_auth)
out["binding ex1.C.forbid"] = bCf
out["binding ex1.C.authority"] = bCa
out["group ex1.C"] = group_id([kCf, kCa])
out["ref ex1.C.forbid"] = ref(bCf)
out["ref ex1.C.authority"] = ref(bCa)
about_bob = {"change": "github:acme/audit#57", "refs": sorted([ref(bCf), ref(bCa)])}
about_carol = {"change": "github:acme/audit#57", "refs": [ref(bCf)]}
out["answer subject digest ex1.C bob"] = H(about_bob)
out["answer subject digest ex1.C carol"] = H(about_carol)

# Example 2
f_hatch = {"type": "hatch", "at": "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set", "kind": "assume"}
out["factId ex2.hatch"] = fact_id(f_hatch)
SET = "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set"
set_own_b = label("ironkv set own, base")
set_own_h = label("ironkv set own, head")
SET_UNIT_B = "sha256:6f1180911c9d6b41b4441e993941c6b6b61d238815faa7cbde959751ae1b03ff"
SET_UNIT_H = "sha256:5ab2582637d304f0050e6e6eb48b9a3f0ddca246e9d3777c775b0673f6034faf"
SET_CLOSURE = "sha256:447e6db6d5159076b32ae28c0f6c41582e1c285506d6182931d52d7d9a1b1d0b"
k2 = ob_key({"kind": "contradiction", "claim": fp["ex2.confine.assume"],
             "subject": {"code": SET, "atom": "assume<std::Trust>"}})
k2u = ob_key({"kind": "unestablished", "claim": fp["ex2.law.set"], "subject": None})
out["key ex2.contradiction"] = k2
out["key ex2.unestablished"] = k2u
b2 = binding(k2, [SET], [[SET, "own", set_own_b, set_own_h]])
b2u = binding(k2u, [SET], [[SET, "closure", SET_CLOSURE, SET_CLOSURE], [SET, "unit", SET_UNIT_B, SET_UNIT_H]])
out["binding ex2.contradiction"] = b2
out["binding ex2.unestablished"] = b2u
out["ref ex2.contradiction"] = ref(b2)
out["ref ex2.unestablished"] = ref(b2u)
out["group ex2"] = group_id([k2, k2u])

# Example 3
f_clock = {"type": "effect", "at": "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness",
           "verb": "Read", "resource": "ts.call(\"Date.now\")"}
out["factId ex3.clock"] = fact_id(f_clock)
k3 = ob_key({"kind": "contradiction", "claim": fp["ex3.clock.checker"],
             "subject": {"code": "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness",
                         "atom": "Read<tooling::SystemClock>"}})
out["key ex3.contradiction"] = k3
k3r = ob_key({"kind": "unestablished", "claim": fp["ex3.refactor.law"], "subject": None})
out["key ex3.unestablished.refactor"] = k3r
ISO = "ts:packages/shp-cli/src/freshness.ts#isoToday"
ISO_B = "sha256:3018423164cf0d769cf3a0b13c4f5a70297ad51908b34467dcf8eb9ca4193703"
ISO_H = "sha256:6f68619e784427af2372e479a15e284f6054a0fb6540a8287959d16cd4cc02fb"
b3r = binding(k3r, [ISO], [[ISO, "unit", ISO_B, ISO_H]])
out["binding ex3.unestablished.refactor"] = b3r
out["key ex3.unestablished.det"] = ob_key({"kind": "unestablished", "claim": fp["ex3.det.law"], "subject": None})
out["key ex3.loosening.refactor.removed"] = ob_key({"kind": "loosening", "subject": fp["ex3.refactor.law"]})
broad = {
    "ts:experiments/bend-probes/E/f1-synth.ts#synthesize": "performance.now",
    "ts:experiments/semantic-kernel/harness/benchmark.ts#medianDuration": "performance.now",
    "ts:packages/shp-checker/src/behavioural/determinism.test.ts": "Date",
    "ts:packages/shp-cli/src/commands/update/impl.ts#replaceWindowsBinary": "Date.now",
}
for at, callee in broad.items():
    f = {"type": "effect", "at": at, "verb": "Read", "resource": "ts.call(\"%s\")" % callee}
    out["factId ex3.broad " + at] = fact_id(f)
    out["key ex3.broad " + at] = ob_key({"kind": "contradiction", "claim": fp["ex3.clock.broad"],
                                         "subject": {"code": at, "atom": "Read<tooling::SystemClock>"}})

# Example 4
calls = [
    {"type": "call", "at": "ts:packages/shp-checker/src/checker/lowering/facts.ts",
     "to": "ts:packages/shp-checker/src/checker/derivations.ts#requirementsForTarget"},
    {"type": "call", "at": "ts:packages/shp-checker/src/checker/lowering/facts.ts",
     "to": "ts:packages/shp-checker/src/checker/derivations.ts#shapeTraitBearers"},
    {"type": "call", "at": "ts:packages/shp-checker/src/checker/lowering/context.ts",
     "to": "ts:packages/shp-checker/src/checker/derivations.ts#requiresReevaluation"},
]
for f in calls:
    out["factId ex4.call " + f["at"].split("/")[-1] + "->" + f["to"].split("#")[1]] = fact_id(f)
d_rel = {"type": "declared", "claim": fp["ex4.relation"]}
out["factId ex4.declared"] = fact_id(d_rel)
rep = min(fact_id(f) for f in calls)
out["ex4 representative call fact"] = rep
k4 = ob_key({"kind": "contradiction", "claim": fp["ex4.cycle"],
             "subject": {"nodes": ["checker::ShapeModelLowerer", "checker::ShapeRuleEngine"]}})
out["key ex4.cycle"] = k4
out["binding ex4.cycle"] = binding(k4, ["ts:packages/shp-checker/src/checker/lowering/context.ts",
                                        "ts:packages/shp-checker/src/checker/lowering/facts.ts"], [])
out["group ex4"] = group_id([k4])
out["key ex4.complete.loosening"] = ob_key({"kind": "loosening", "subject": fp["ex4.complete"]})

# ---- scope root (Example 1 observation) -------------------------------------
entries = [
    {"id": "ts:src/audit/purge.ts", "projection": "file", "scheme": "ts.file.v1", "digest": "sha256:ba062333d9091f522631b641c25afdab1107d546f76d365933ecd3cfdff77e61"},
    {"id": "ts:src/audit/purge.ts#purgeOldEvents", "projection": "unit", "scheme": "ts.unit.v2", "digest": "sha256:f60c501bff9e4c1bde932d78e58977e86d40c7890605c25bedbc684a1aa4bcc7"},
    {"id": "ts:src/audit/store.ts", "projection": "file", "scheme": "ts.file.v1", "digest": "sha256:a955648ac042149dbcf0ad36204b4e22132bec3f16e7b60385bb4cdced0b4138"},
    {"id": "ts:src/audit/store.ts#appendEvent", "projection": "unit", "scheme": "ts.unit.v2", "digest": "sha256:df38d45acb53c51e2faaca77f1229602ab595acdd158a52f2a526d1fa3408f08"},
]
out["scope root ex1"] = H({"v": "shape.scope.v1", "entries": entries})
out["label purge own fn"] = purge_fn_own
out["label purge own file"] = purge_file_own
out["label purge.sh own"] = sh_own
out["label set own base"] = set_own_b
out["label set own head"] = set_own_h
for lab in ["determinism.test.ts own", "behavioural/harness.ts own", "history.test.ts own"]:
    out["label " + lab] = label(lab)

# ---- pack digest (input packs; illustrative file bytes) ----------------------
std_files = [["std/std.shape", hashlib.sha256(b"module std\n").hexdigest()]]
out["pack digest std (illustrative bytes)"] = H({"v": "shape.pack.v1", "files": sorted(std_files)})

# ---- git blob id check for shape files (S3-2(b)): blob = SHA-1("blob <len>\0" + bytes) ----
lock = b'{"v": "shape.lock.v1", "packs": []}\n'
out["git blob id of an empty-pack shape.lock (illustrative)"] = hashlib.sha1(b"blob %d\0" % len(lock) + lock).hexdigest()

json.dump(out, sys.stdout, indent=1, sort_keys=True, ensure_ascii=False)
print()
