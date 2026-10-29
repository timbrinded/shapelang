"""Generate kernel cases (shape.kernel.case/v1) for the worked examples of the core
(version 7) and the annex vectors, with the expected obligations from vectors.py
(experiments/shape-1/spec/vectors/vectors.json, version 7).

Version 7 updates (each case kept; inputs and expectations moved to the version 7 text):
- std: AppendOnly forbids Update (A.3.4.2, D13); hatch kinds add unsafe in rust, ts_expect_error
  and ts_nocheck (A.12.2.8, D20); forbid hatch * elaborates to one clause per declared hatch verb
  plus Undeclared, never Hatch (A.4.2.4, D1);
- manifests: raw executables carry the executable flag instead of kind "exec" (A.12.7.5, D27);
- ex1_first_adoption: an empty base makes every provider head-only, whose records hold no reason,
  so the law's reason is missing, not weak (A.5.4.3, A.6.2.6, D9; golden ex1-empty-base);
- ex1_variant_a: the E-conduct subject is the key preimage (A.16.25); no authority loosening, since
  the final Update forbid still blocks the gained atoms (A.8.2.3 L1, D17; vectors.py errata) and
  summaries have no call channel, so no coverage (A.4.5.1, D2); golden ex1-A;
- ex1_variant_b_no_test: E-provider-missing subject "provider Q claim C", C the first id (A.16.25);
- ex3_refactor_stale, ex3_rejudged: no coverage obligation: the summary's channels are effect(t)
  for bound t only and SystemClock binds none (A.4.5.1, D2), so ShpCli code is covered vacuously
  (A.7.4.5); golden ex3-step1. ex3_rejudged therefore passes.

Run: python3 -I gen_cases.py <out-dir>
Writes <name>.json (the case) and <name>.expect.json (expected verdict and obligations)."""
import copy
import hashlib
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cases")
os.makedirs(OUT, exist_ok=True)


def label(s):
    return "sha256:" + hashlib.sha256(s.encode("utf-8")).hexdigest()


# ---- std pack ---------------------------------------------------------------
STD_EFFECTS = [
    {"verb": "Read", "implies": []}, {"verb": "Write", "implies": []},
    {"verb": "Export", "implies": ["Read"]}, {"verb": "Append", "implies": ["Write"]},
    {"verb": "Import", "implies": ["Write"]}, {"verb": "Update", "implies": ["Write"]},
    {"verb": "Redact", "implies": ["Update"]}, {"verb": "LogicalDelete", "implies": ["Update"]},
    {"verb": "HardDelete", "implies": ["Update"]}, {"verb": "Truncate", "implies": ["HardDelete"]},
    {"verb": "DropStorage", "implies": ["Truncate"]}, {"verb": "Hatch", "implies": []},
]
HATCH_PAIRS = [("external_body", "verus"), ("external", "verus"), ("assume", "verus"), ("admit", "verus"),
               ("assume_specification", "verus"), ("uninterp", "verus"), ("axiom", "verus"), ("unsafe", "bend"),
               ("unsafe", "rust"), ("ts_ignore", "ts"), ("ts_expect_error", "ts"), ("ts_nocheck", "ts")]
STD_HATCHES = [{"kind": k, "lang": l} for k, l in HATCH_PAIRS]
HATCH_VERBS = sorted(set(k for k, _ in HATCH_PAIRS))
STD_KINDS = [{"name": "calls", "from": "component", "to": "component"},
             {"name": "callbacks", "from": "component", "to": "component"},
             {"name": "provides", "from": "component", "to": "resource"},
             {"name": "data_flow", "from": "component", "to": "component"},
             {"name": "coordinated_call", "from": "component", "to": "component"}]
SCHEMA_FP = {
    "std::HistoryPreserved": "sha256:3c5937e280af3a8d80cde26bd287b0a9a5454d81eb01f305653b3e8e978dbeb9",
    "std::Deterministic": "sha256:5dd1f7b8369f9557a9403b64a20f9d62e456c9960127a258755161b56e21d3e0",
}
SURFACE_TEXT = "The trusted surface of this component is acceptable."
REFACTOR_TEXT = "Changes to this unit preserve the constraint recorded in its memory note."
NOW = "2026-10-25T12:00:00Z"


def esf(q, owner, actors, resources=(), components=(), units=(), claims=(), providers=(), exceptions=(), policy=None):
    d = {"v": "shape.elaborated.v1", "shape": {"q": q, "owner": owner, "policy": "std::DefaultPolicy"},
         "actors": list(actors), "effects": STD_EFFECTS, "kinds": STD_KINDS, "hatches": STD_HATCHES,
         "resources": list(resources), "components": list(components), "units": list(units),
         "claims": list(claims), "templates": [], "exceptions": list(exceptions), "notes": [],
         "providers": list(providers), "errors": []}
    if policy is not None:
        d["policy"] = policy
    return d


def actor(q, kind, members=(), operator=None):
    return {"q": q, "kind": kind, "operator": operator, "identities": [], "members": list(members)}


def claim(ids, op, args, owner, tier, req=None):
    return {"ids": ids, "op": op, "args": args, "owner": owner, "tier": tier, "requirement": req}


def req(level, judged=False, pins=(), projection="unit"):
    return {"level": level, "judged": judged, "pins": list(pins), "projection": projection}


def prov(q, produces, observes=(), decides=(), presence=False, absence=False, deps=False, identity=None,
         trusts=(), paths=(), digest=None):
    return {"q": q, "produces": list(produces), "observes": list(observes), "decides": list(decides),
            "presence": presence, "absence": absence, "persist": False, "depsComplete": deps,
            "identity": identity, "trusts": [list(t) for t in trusts],
            "implementation": {"paths": list(paths), "digest": digest}}


def entry(id_, proj, digest, kind="symbol", parent=None, markers=None, scheme=None, executable=False):
    e = {"id": id_, "projection": proj, "scheme": scheme or (id_.split(":")[0] + "." + proj + ".v2"),
         "digest": digest, "kind": kind, "parent": parent, "executable": executable, "hatchComplete": True}
    if markers:
        e["markers"] = markers
    return e


def file_entries(id_, tag, kind="file"):
    return [entry(id_, "file", label(id_ + " file, " + tag), kind=kind),
            entry(id_, "own", label(id_ + " own, " + tag), kind=kind)]


def manifest(rev, entries):
    return {"_type": "https://in-toto.io/Statement/v1", "subject": [], "predicateType": "https://shapelang.dev/manifest/v1",
            "predicate": {"shape": {"v": "shape.manifest.v1", "revision": rev, "tree": [], "entries": entries}}}


def record(block, authenticated=True):
    return {"_type": "https://in-toto.io/Statement/v1", "subject": [], "predicateType": "https://shapelang.dev/evidence/v1",
            "predicate": {"shape": dict({"v": "shape.evidence.v1"}, **block)}, "authenticated": authenticated}


def case(head_esf, head_man, head_rev, base_esf=None, base_man=None, base_rev="b0", records=(), base_records=(),
         authors=(), change_ids=("github:acme/audit#57",), cells=(), mode="change", now=NOW):
    return {"contract": "shape.kernel.case/v1", "mode": mode, "now": now, "change": {"ids": list(change_ids)},
            "authors": list(authors),
            "head": {"revision": head_rev, "esf": head_esf, "manifest": head_man},
            "base": None if base_esf is None else {"revision": base_rev, "esf": base_esf, "manifest": base_man},
            "records": list(records), "baseRecords": list(base_records)}


def write(name, c, expect):
    with open(os.path.join(OUT, name + ".json"), "w") as f:
        json.dump(c, f, indent=1, sort_keys=True)
    with open(os.path.join(OUT, name + ".expect.json"), "w") as f:
        json.dump(expect, f, indent=1, sort_keys=True)


# =============================================================================
# Example 1
# =============================================================================
A = "audit::"
ACTORS1 = [actor(A + "Platform", "team", [A + "alice", A + "carol"]), actor(A + "AuditTeam", "team", [A + "bob"]),
           actor(A + "alice", "person"), actor(A + "carol", "person"), actor(A + "bob", "person"),
           actor(A + "codeAgent", "agent", operator=A + "alice")]
RES1 = [{"q": A + "AuditEvent", "owner": A + "AuditTeam", "tier": "final", "bind": ['pg.table("audit_events")'],
         "was": None, "attach": ["std::AppendOnly"]}]


def comp1(grants=("Append<audit::AuditEvent>", "Read<audit::AuditEvent>")):
    return {"q": A + "AuditStore", "boundary": False, "owner": A + "AuditTeam", "tier": "critical",
            "paths": ["src/audit/**/*.ts"], "grants": list(grants), "allows": [], "assumes": [], "complete": [],
            "was": None, "units": [], "attach": []}


UNIT_APPEND = {"q": A + "AuditStore.appendEvent", "component": A + "AuditStore", "name": "appendEvent",
               "owner": A + "AuditTeam", "tier": "critical", "bind": None, "was": None, "summary": None, "attach": []}
UNIT_PURGE = {"q": A + "AuditStore.purgeOldEvents", "component": A + "AuditStore", "name": "purgeOldEvents",
              "owner": A + "AuditTeam", "tier": "critical", "bind": None, "was": None, "summary": None, "attach": []}
C_APPENDONLY = claim(["audit::AuditEvent/AppendOnly/effect.forbid-Update"], "effect.forbid",
                     {"atom": "Update<audit::AuditEvent>", "scope": ["*"], "except": []}, A + "AuditTeam", "final")


def c_authority(grants):
    return claim(["audit::AuditStore/authority"], "authority", {"component": A + "AuditStore", "grants": sorted(grants)},
                 A + "AuditTeam", "critical")


C_SUM_UP = claim(["audit::AuditStore.appendEvent/effects"], "effects.upper",
                 {"unit": A + "AuditStore.appendEvent", "atoms": ["Append<audit::AuditEvent>"]}, A + "AuditTeam", "critical")
C_SUM_LO = claim(["audit::AuditStore.appendEvent/effects"], "effects.lower",
                 {"unit": A + "AuditStore.appendEvent", "atoms": ["Append<audit::AuditEvent>"]}, A + "AuditTeam", "critical")
C_PURGE_UP = claim(["audit::AuditStore.purgeOldEvents/effects"], "effects.upper",
                   {"unit": A + "AuditStore.purgeOldEvents", "atoms": ["HardDelete<audit::AuditEvent>"]}, A + "AuditTeam", "critical")
C_LAW1 = claim(["audit::EventsArePreserved"], "law",
               {"on": ["component audit::AuditStore"],
                "statement": {"schema": "std::HistoryPreserved", "schemaFp": SCHEMA_FP["std::HistoryPreserved"],
                              "args": ["resource audit::AuditEvent"]}},
               A + "AuditTeam", "critical", req("tested", pins=[A + "fastCheck"]))
PROV1 = [prov(A + "sqlEffects", ["observation"], observes=['effect(pg.table("*"))'], presence=True, absence=True, deps=True,
              identity='sigstore("https://github.com/acme/audit/.github/workflows/sql.yml@refs/heads/main")',
              digest="sha256:sql-effects-2.3.1"),
         prov(A + "fastCheck", ["test"], decides=["template std::HistoryPreserved"], presence=True,
              identity='sigstore("https://github.com/acme/audit/.github/workflows/test.yml@refs/heads/main")',
              paths=["package.json", "bun.lock", "bunfig.toml"]),
         prov(A + "reviews", ["judgment"],
              identity='sigstore("https://github.com/acme/audit/.github/workflows/relay.yml@refs/heads/main")',
              digest="sha256:shape-review-relay-1.0.0")]

D_PURGE_FILE = "sha256:ba062333d9091f522631b641c25afdab1107d546f76d365933ecd3cfdff77e61"
D_PURGE_UNIT = "sha256:f60c501bff9e4c1bde932d78e58977e86d40c7890605c25bedbc684a1aa4bcc7"
D_STORE_FILE = "sha256:a955648ac042149dbcf0ad36204b4e22132bec3f16e7b60385bb4cdced0b4138"
D_APPEND_UNIT = "sha256:df38d45acb53c51e2faaca77f1229602ab595acdd158a52f2a526d1fa3408f08"
PURGE = "ts:src/audit/purge.ts#purgeOldEvents"
PURGE_F = "ts:src/audit/purge.ts"
STORE = "ts:src/audit/store.ts#appendEvent"
STORE_F = "ts:src/audit/store.ts"


def base_entries1():
    return ([entry("pkgjson:package.json", "file", label("package.json file"), kind="file"),
             entry("pkgjson:package.json", "own", label("package.json own"), kind="file"),
             entry("raw:bun.lock", "file", label("bun.lock file"), kind="file", scheme="raw.file.v1"),
             entry("raw:bun.lock", "own", label("bun.lock own"), kind="file", scheme="raw.own.v1"),
             entry(STORE_F, "file", D_STORE_FILE, kind="file"), entry(STORE_F, "own", label("store.ts own"), kind="file"),
             entry(STORE, "unit", D_APPEND_UNIT, parent=STORE_F), entry(STORE, "own", label("appendEvent own"), parent=STORE_F),
             entry("ts:test/audit/history.test.ts", "file", label("history.test.ts file"), kind="file"),
             entry("ts:test/audit/history.test.ts", "own", label("history.test.ts own"), kind="file")])


def head_entries1(extra=()):
    return base_entries1() + [
        entry(PURGE_F, "file", D_PURGE_FILE, kind="file"),
        entry(PURGE_F, "own", label("ts:src/audit/purge.ts own, head"), kind="file"),
        entry(PURGE, "unit", D_PURGE_UNIT, parent=PURGE_F),
        entry(PURGE, "own", label("ts:src/audit/purge.ts#purgeOldEvents own, head"), parent=PURGE_F)] + list(extra)


def sql_obs(rev, entries, facts):
    return record({"kind": "observation", "result": "observes", "provider": {"id": A + "sqlEffects", "version": "2.3.1"},
                   "revision": rev, "time": "2026-10-25T09:12:44Z",
                   "scope": {"root": "sha256:ae2c60231357f6ff", "entries": entries}, "facts": facts,
                   "harness": [], "assumptions": []})


def ent(id_, proj, digest, complete=True):
    return {"id": id_, "projection": proj, "scheme": id_.split(":")[0] + "." + proj + ".v2", "digest": digest,
            "complete": complete, "deps": []}


def fast_record(rev, code):
    return record({"kind": "test", "result": "supports", "provider": {"id": A + "fastCheck", "version": "3.0.0"},
                   "revision": rev, "time": "2026-10-25T09:30:00Z",
                   "claim": {"id": "audit::EventsArePreserved", "fp": "sha256:2da8fb7008513c5d4434893c76fcb70a4dab922e56ed89f988b390962a63dff3"},
                   "code": code, "deps": [],
                   "harness": [{"id": "ts:test/audit/history.test.ts", "projection": "own", "scheme": "ts.own.v2",
                                "digest": label("history.test.ts own")}],
                   "assumptions": [], "counterexample": None})


def cite(id_, proj, digest):
    return {"id": id_, "projection": proj, "scheme": id_.split(":")[0] + "." + proj + ".v2", "digest": digest}


BASE_CODE1 = [cite(STORE, "unit", D_APPEND_UNIT), cite(STORE_F, "own", label("store.ts own"))]
HEAD_CODE1 = BASE_CODE1 + [cite(PURGE, "unit", D_PURGE_UNIT), cite(PURGE_F, "own", label("ts:src/audit/purge.ts own, head"))]
FACT_PURGE = {"type": "effect", "at": PURGE, "verb": "HardDelete", "resource": 'pg.table("public.audit_events")'}
FACT_APPEND = {"type": "effect", "at": STORE, "verb": "Append", "resource": 'pg.table("public.audit_events")'}
OBS_ENTRIES_H = [ent(PURGE_F, "file", D_PURGE_FILE), ent(PURGE, "unit", D_PURGE_UNIT),
                 ent(STORE_F, "file", D_STORE_FILE), ent(STORE, "unit", D_APPEND_UNIT)]
OBS_ENTRIES_B = [ent(STORE_F, "file", D_STORE_FILE), ent(STORE, "unit", D_APPEND_UNIT)]
BASE_GRANTS = ["Append<audit::AuditEvent>", "Read<audit::AuditEvent>"]


def base_esf1():
    return esf(A + "AuditService", A + "Platform", ACTORS1, RES1, [comp1()], [UNIT_APPEND],
               [C_APPENDONLY, c_authority(BASE_GRANTS), C_SUM_UP, C_SUM_LO, C_LAW1], PROV1)


AUTHORS1 = [A + "codeAgent", A + "alice"]
V = json.load(open(os.environ.get("VECTORS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "spec", "vectors", "vectors.json"))))

base_rec1 = sql_obs("b0", OBS_ENTRIES_B, [FACT_APPEND])

# --- Variant B ---------------------------------------------------------------
c = case(base_esf1(), manifest("h1", head_entries1()), "h1", base_esf1(), manifest("b0", base_entries1()),
         records=[sql_obs("h1", OBS_ENTRIES_H, [FACT_PURGE, FACT_APPEND]), fast_record("h1", HEAD_CODE1)],
         base_records=[base_rec1], authors=AUTHORS1)
write("ex1_variant_b", c, {"verdict": "blocked", "errors": [], "obligations": [
    {"key": V["key ex1.B.contradiction"], "binding": V["binding ex1.B.contradiction"], "group": V["group ex1.B"],
     "kind": "contradiction", "force": "sound", "introduced": True, "tier": "final", "severity": "blocking",
     "budget": "mechanical", "witness": [V["factId ex1.purge"]]}], "exact": True})

# Aliases (A.14.1.6): AUDIT_EVENTS and quoted "audit_events" give the same contradiction.
for alias_name, alias in [("upper", 'pg.table("AUDIT_EVENTS")'), ("quoted", 'pg.table("\\"audit_events\\"")')]:
    f2 = dict(FACT_PURGE, resource=alias)
    c2 = case(base_esf1(), manifest("h1", head_entries1()), "h1", base_esf1(), manifest("b0", base_entries1()),
              records=[sql_obs("h1", OBS_ENTRIES_H, [f2, FACT_APPEND]), fast_record("h1", HEAD_CODE1)],
              base_records=[base_rec1], authors=AUTHORS1)
    write("ex1_variant_b_alias_" + alias_name, c2, {"verdict": "blocked", "obligations": [
        {"key": V["key ex1.B.contradiction"], "binding": V["binding ex1.B.contradiction"], "severity": "blocking",
         "witness": [V["factId ex1.purge"]]}], "exact": True})

# --- Weakened observer (A.14.1.5): head drops presence; force stays sound -----
h = base_esf1()
h["providers"] = copy.deepcopy(PROV1)
h["providers"][0]["presence"] = False
c = case(h, manifest("h1", head_entries1()), "h1", base_esf1(), manifest("b0", base_entries1()),
         records=[sql_obs("h1", OBS_ENTRIES_H, [FACT_PURGE, FACT_APPEND]), fast_record("h1", HEAD_CODE1)],
         base_records=[base_rec1], authors=AUTHORS1)
write("ex1_weakened_observer", c, {"verdict": "blocked", "obligations": [
    {"key": V["key ex1.B.contradiction"], "force": "sound", "severity": "blocking"},
    {"kind": "loosening", "subject": "provider audit::sqlEffects"}]})

# --- B' : ungoverned script ---------------------------------------------------
SCRIPT = "ts:scripts/purge-audit.ts#purgeOldEvents"
SCRIPT_F = "ts:scripts/purge-audit.ts"
extra = [entry(SCRIPT_F, "file", label("purge-audit.ts file"), kind="file"),
         entry(SCRIPT_F, "own", label("purge-audit.ts own"), kind="file"),
         entry(SCRIPT, "unit", label("purge-audit unit"), parent=SCRIPT_F),
         entry(SCRIPT, "own", label("purge-audit own"), parent=SCRIPT_F)]
hm = base_entries1() + extra
c = case(base_esf1(), manifest("h2", hm), "h2", base_esf1(), manifest("b0", base_entries1()),
         records=[sql_obs("h2", OBS_ENTRIES_B + [ent(SCRIPT_F, "file", label("purge-audit.ts file")),
                                                 ent(SCRIPT, "unit", label("purge-audit unit"))],
                          [dict(FACT_PURGE, at=SCRIPT), FACT_APPEND]),
                  fast_record("h2", BASE_CODE1)],
         base_records=[base_rec1], authors=AUTHORS1)
write("ex1_variant_b_prime", c, {"verdict": "blocked", "obligations": [
    {"key": V["key ex1.Bprime.contradiction"], "force": "sound", "severity": "blocking", "tier": "final"}], "exact": True})

# --- B'' : raw shell executable, no observer reads shell -----------------------
SH = "raw:src/audit/purge.sh"
hm = base_entries1() + [entry(SH, "file", label("purge.sh file"), kind="file", scheme="raw.file.v1", executable=True),
                        entry(SH, "own", label("raw:src/audit/purge.sh own, head"), kind="file", scheme="raw.own.v1", executable=True)]
c = case(base_esf1(), manifest("h3", hm), "h3", base_esf1(), manifest("b0", base_entries1()),
         records=[sql_obs("h3", OBS_ENTRIES_B, [FACT_APPEND]), fast_record("h3", BASE_CODE1)],
         base_records=[base_rec1], authors=AUTHORS1)
write("ex1_variant_b_second", c, {"verdict": "blocked", "obligations": [
    {"key": V["key ex1.Bsecond.coverage.ungoverned"], "binding": V["binding ex1.Bsecond.coverage.ungoverned"],
     "kind": "coverage", "tier": "final", "severity": "blocking"}], "exact": True})

# B'' answered by bob (AuditTeam) and carol (Platform): coverage discharged.
def answer(judge, refs, change="github:acme/audit#57", prov_id=A + "reviews", authenticated=True):
    return record({"kind": "judgment", "result": "approves", "provider": {"id": prov_id, "version": "1.0.0"},
                   "revision": "h", "time": "2026-10-25T11:00:00Z", "judge": judge,
                   "identity": 'github("%s")' % judge.split("::")[-1], "about": {"change": change, "refs": refs}},
                  authenticated)


ref_cov = V["binding ex1.Bsecond.coverage.ungoverned"][:19]
c2 = copy.deepcopy(c)
c2["records"] += [answer(A + "bob", [ref_cov]), answer(A + "carol", [ref_cov])]
write("ex1_variant_b_second_answered", c2, {"verdict": "pass", "obligations": [],
                                            "answered": [V["key ex1.Bsecond.coverage.ungoverned"]], "exact": True})
c3 = copy.deepcopy(c)
c3["records"] += [answer(A + "codeAgent", [ref_cov]), answer(A + "alice", [ref_cov])]
write("ex1_variant_b_second_author_answers", c3, {"verdict": "blocked", "obligations": [
    {"key": V["key ex1.Bsecond.coverage.ungoverned"], "severity": "blocking"}], "exact": True})

# --- Variant C: drop AppendOnly, add the grant, declare the unit ---------------
CELLS1 = [["audit::AuditStore.*", "audit::AuditStore.*"], ["ungoverned", "ungoverned"]]
headC = esf(A + "AuditService", A + "Platform", ACTORS1,
            [dict(RES1[0], attach=[])], [comp1(BASE_GRANTS + ["HardDelete<audit::AuditEvent>"])], [UNIT_APPEND, UNIT_PURGE],
            [c_authority(BASE_GRANTS + ["HardDelete<audit::AuditEvent>"]), C_SUM_UP, C_SUM_LO, C_LAW1], PROV1)
cC = case(headC, manifest("h1", head_entries1()), "h1", base_esf1(), manifest("b0", base_entries1()),
          records=[sql_obs("h1", OBS_ENTRIES_H, [FACT_PURGE, FACT_APPEND]), fast_record("h1", HEAD_CODE1)],
          base_records=[base_rec1], authors=AUTHORS1, cells=CELLS1)
write("ex1_variant_c", cC, {"verdict": "blocked", "errors": [], "obligations": [
    {"key": V["key ex1.C.forbid"], "binding": V["binding ex1.C.forbid"], "group": V["group ex1.C"],
     "kind": "loosening", "tier": "final", "severity": "blocking", "exploited": True},
    {"key": V["key ex1.C.authority"], "binding": V["binding ex1.C.authority"], "group": V["group ex1.C"],
     "kind": "loosening", "tier": "critical", "severity": "blocking", "exploited": True}], "exact": True})

# Variant C answered: bob answers both, carol (second person) answers the final one.
refs_bob = [V["binding ex1.C.forbid"][:19], V["binding ex1.C.authority"][:19]]
cC2 = copy.deepcopy(cC)
cC2["records"] += [answer(A + "bob", refs_bob), answer(A + "carol", [V["binding ex1.C.forbid"][:19]])]
write("ex1_variant_c_answered", cC2, {"verdict": "pass", "obligations": [],
                                      "answered": [V["key ex1.C.forbid"], V["key ex1.C.authority"]], "exact": True})
# Only bob: the final loosening needs a second person; the critical one is discharged.
cC3 = copy.deepcopy(cC)
cC3["records"] += [answer(A + "bob", refs_bob)]
write("ex1_variant_c_one_person", cC3, {"verdict": "blocked", "obligations": [
    {"key": V["key ex1.C.forbid"], "severity": "blocking"}], "answered": [V["key ex1.C.authority"]], "exact": True})
# Another change id never matches.
cC4 = copy.deepcopy(cC)
cC4["records"] += [answer(A + "bob", refs_bob, change="github:acme/audit#58"),
                   answer(A + "carol", [V["binding ex1.C.forbid"][:19]], change="github:acme/audit#58")]
write("ex1_variant_c_other_change", cC4, {"verdict": "blocked", "obligations": [
    {"key": V["key ex1.C.forbid"]}, {"key": V["key ex1.C.authority"]}], "exact": True})

# --- Variant A: keep AppendOnly, add the grant, declare the unit -> E-conduct + L1 --
headA = esf(A + "AuditService", A + "Platform", ACTORS1, RES1,
            [comp1(BASE_GRANTS + ["HardDelete<audit::AuditEvent>"])], [UNIT_APPEND, UNIT_PURGE],
            [C_APPENDONLY, c_authority(BASE_GRANTS + ["HardDelete<audit::AuditEvent>"]), C_SUM_UP, C_SUM_LO, C_PURGE_UP,
             dict(C_PURGE_UP, op="effects.lower"), C_LAW1], PROV1)
cA = case(headA, manifest("h1", head_entries1()), "h1", base_esf1(), manifest("b0", base_entries1()),
          records=[sql_obs("h1", OBS_ENTRIES_H, [FACT_PURGE, FACT_APPEND]), fast_record("h1", HEAD_CODE1)],
          base_records=[base_rec1], authors=AUTHORS1, cells=CELLS1)
CONDUCT_A = json.dumps({"claim": V["fp ex1.appendonly"], "kind": "contradiction",
                        "subject": {"atom": "HardDelete<audit::AuditEvent>", "code": PURGE}, "v": "shape.obligation.v1"},
                       sort_keys=True, separators=(",", ":"))
write("ex1_variant_a", cA, {"verdict": "blocked", "errors": [{"code": "E-conduct", "subject": CONDUCT_A}],
                            "obligations": [], "exact": True})

# --- Audit mode on the base: pass --------------------------------------------
c = case(base_esf1(), manifest("b0", base_entries1()), "b0", records=[sql_obs("b0", OBS_ENTRIES_B, [FACT_APPEND]),
         fast_record("b0", BASE_CODE1)], mode="audit")
write("ex1_audit_base", c, {"verdict": "pass", "obligations": [], "errors": [], "exact": True})

# --- First adoption: empty base shape, same tree -> owed (law preexisting weak) --
empty = esf(A + "AuditService", A + "Platform", ACTORS1)
c = case(base_esf1(), manifest("b0", base_entries1()), "b0", empty, manifest("b0", base_entries1()),
         records=[sql_obs("b0", OBS_ENTRIES_B, [FACT_APPEND]), fast_record("b0", BASE_CODE1)], authors=AUTHORS1)
write("ex1_first_adoption", c, {"verdict": "owed", "obligations": [
    {"kind": "unestablished", "reason": "missing", "introduced": False, "severity": "owed",
     "claimFp": "sha256:2da8fb7008513c5d4434893c76fcb70a4dab922e56ed89f988b390962a63dff3"}], "exact": True})

# --- Variant B with the fastCheck record dropped: E-provider-missing ----------
c = case(base_esf1(), manifest("h1", head_entries1()), "h1", base_esf1(), manifest("b0", base_entries1()),
         records=[sql_obs("h1", OBS_ENTRIES_H, [FACT_PURGE, FACT_APPEND])], base_records=[base_rec1], authors=AUTHORS1)
write("ex1_variant_b_no_test", c, {"verdict": "blocked", "errors": [
    {"code": "E-provider-missing", "subject": "provider audit::fastCheck claim audit::EventsArePreserved"}],
    "obligations": [{"key": V["key ex1.B.contradiction"]},
                    {"kind": "unestablished", "reason": "missing", "severity": "blocking"}]})

# =============================================================================
# Example 2 (Verus)
# =============================================================================
I = "ironkv::"
SET = "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set"
SET_F = "verus:ironkv/src/delegation_map_v.rs"
INSERT = "verus:ironkv/src/delegation_map_v.rs#StrictlyOrderedVec::insert"
HOST = "verus:ironkv/src/host_t.rs#send"
HOST_F = "verus:ironkv/src/host_t.rs"
SET_UNIT_B = "sha256:6f1180911c9d6b41b4441e993941c6b6b61d238815faa7cbde959751ae1b03ff"
SET_UNIT_H = "sha256:5ab2582637d304f0050e6e6eb48b9a3f0ddca246e9d3777c775b0673f6034faf"
SET_CLOSURE = "sha256:447e6db6d5159076b32ae28c0f6c41582e1c285506d6182931d52d7d9a1b1d0b"
SET_CONTRACT = label("ironkv set contract")
ACTORS2 = [actor(I + "IronKvTeam", "team", [I + "dana", I + "erin"]), actor(I + "dana", "person"),
           actor(I + "erin", "person"), actor(I + "agent", "agent", operator=I + "erin")]
COMPS2 = [{"q": I + "HostTrusted", "boundary": True, "owner": I + "IronKvTeam", "tier": "critical",
           "paths": ["ironkv/src/**/*_t.rs"], "grants": None, "allows": ["external_body", "external", "uninterp"],
           "assumes": [], "complete": [], "was": None, "units": [], "attach": ["std::ReviewedSurface"]},
          {"q": I + "DelegationMap", "boundary": False, "owner": I + "IronKvTeam", "tier": "critical",
           "paths": ["ironkv/src/delegation_map_v.rs"], "grants": None, "allows": [], "assumes": [], "complete": [],
           "was": None, "units": [], "attach": []}]
UNITS2 = [{"q": I + "DelegationMap.set", "component": I + "DelegationMap", "name": "set", "owner": I + "IronKvTeam",
           "tier": "critical", "bind": SET, "was": None, "summary": None, "attach": []}]
HOST_ALLOWS = {"external_body", "external", "uninterp"}
CONFINE = [claim(["ironkv::NoHatchesOutsideBoundaries/" + h], "effect.forbid",
                 {"atom": "%s<std::Trust>" % h, "scope": ["*"], "except": ["component ironkv::HostTrusted"] if h in HOST_ALLOWS else []},
                 I + "IronKvTeam", "critical") for h in HATCH_VERBS + ["Undeclared"]]
LAW_SET = claim(["ironkv::SetRefinesSpec"], "law", {"on": ["unit ironkv::DelegationMap.set"],
                                                   "statement": {"ref": SET, "projection": "closure"}},
                I + "IronKvTeam", "critical", req("proven", pins=[I + "verus"]))
LAW_FAITH = claim(["ironkv::SetContractFaithful"], "law", {"on": ["unit ironkv::DelegationMap.set"],
                  "statement": {"text": "The ensures clause of set states the map update the protocol layer relies on."}},
                  I + "IronKvTeam", "critical", req("none", judged=True, projection="contract"))
LAW_SURF = claim(["ironkv::HostTrusted/ReviewedSurface/law"], "law",
                 {"on": ["component ironkv::HostTrusted"], "statement": {"text": SURFACE_TEXT}},
                 I + "IronKvTeam", "critical", req("none", judged=True, projection="trust"))
PROV2 = [prov(I + "verus", ["proof"], decides=["statements verus"], presence=True, deps=True,
              identity='sigstore("verus")', trusts=[("z3", "4.12.5"), ("verus", "dccae1d")], digest="sha256:verus-ci"),
         prov(I + "verusRefines", ["equivalence"], decides=["equivalence"], presence=True, identity='sigstore("refines")',
              digest="sha256:refines"),
         prov(I + "reviews", ["judgment"], identity='sigstore("relay")', digest="sha256:relay")]


def esf2(exceptions=()):
    return esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], COMPS2, UNITS2, CONFINE + [LAW_SET, LAW_FAITH, LAW_SURF], PROV2,
               exceptions=exceptions)


def entries2(head):
    tag = "head" if head else "base"
    e = [entry(SET_F, "file", label("delegation_map_v.rs file, " + tag), kind="file"),
         entry(SET_F, "own", label("delegation_map_v.rs own"), kind="file"),
         entry(SET, "unit", SET_UNIT_H if head else SET_UNIT_B, parent=SET_F),
         entry(SET, "own", label("ironkv set own, " + tag), parent=SET_F, markers={"assume": 1} if head else None),
         entry(SET, "contract", SET_CONTRACT, parent=SET_F, scheme="verus.contract.vir.v2"),
         entry(SET, "closure", SET_CLOSURE, parent=SET_F, scheme="verus.closure.vir.v2"),
         entry(INSERT, "unit", label("insert unit"), parent=SET_F),
         entry(INSERT, "own", label("insert own"), parent=SET_F),
         entry(INSERT, "contract", label("insert contract"), parent=SET_F, scheme="verus.contract.vir.v2"),
         entry(HOST_F, "file", label("host_t.rs file"), kind="file"),
         entry(HOST_F, "own", label("host_t.rs own"), kind="file"),
         entry(HOST, "unit", label("host send unit"), parent=HOST_F),
         entry(HOST, "own", label("host send own"), parent=HOST_F, markers={"external_body": 1})]
    return e


proof = record({"kind": "proof", "result": "supports", "provider": {"id": I + "verus", "version": "dccae1d"},
                "revision": "h2", "time": "2026-10-25T10:00:00Z",
                "claim": {"id": "ironkv::SetRefinesSpec", "fp": "sha256:60a867af53d80a7f7691530f9ae5869779c05abccd602cd75b2baad28a85db38"},
                "code": [cite(SET, "unit", SET_UNIT_H), cite(SET, "closure", SET_CLOSURE)],
                "deps": [cite(INSERT, "contract", label("insert contract"))], "harness": [],
                "assumptions": [{"id": "set/assume", "kind": "hatch"}, {"id": "z3", "kind": "tool"}, {"id": "verus", "kind": "tool"}],
                "bound": {"rlimit": 10}, "counterexample": None})
dana_j = record({"kind": "judgment", "result": "supports", "provider": None, "revision": "b2", "time": "2026-10-20T10:00:00Z",
                 "claim": {"id": "ironkv::SetContractFaithful", "fp": "sha256:3d6b9e247facc73677afbf88e873548e4c05981cb24d158eee0bc01fb1ad7b68"},
                 "code": [cite(SET, "contract", SET_CONTRACT)], "judge": I + "dana"})
surf_j = record({"kind": "judgment", "result": "supports", "provider": {"id": I + "reviews", "version": "1.0.0"}, "revision": "b2",
                 "time": "2026-10-20T10:00:00Z",
                 "claim": {"id": "ironkv::HostTrusted/ReviewedSurface/law", "fp": "sha256:f3119983e55f6aae012d4804f39af9f73ecafb27fc5fdccc6040b906efb7b03a"},
                 "code": [cite(HOST, "unit", label("host send unit"))], "judge": I + "dana"})
AUTHORS2 = [I + "agent", I + "erin"]
c2base = case(esf2(), manifest("h2", entries2(True)), "h2", esf2(), manifest("b2", entries2(False)), "b2",
              records=[proof, dana_j, surf_j], authors=AUTHORS2, change_ids=["github:acme/ironkv#12"])
EX2_OBS = [{"key": V["key ex2.contradiction"], "binding": V["binding ex2.contradiction"], "group": V["group ex2"],
            "kind": "contradiction", "force": "sound", "introduced": True, "severity": "blocking", "budget": "mechanical"},
           {"key": V["key ex2.unestablished"], "binding": V["binding ex2.unestablished"], "group": V["group ex2"],
            "kind": "unestablished", "reason": "assumption", "introduced": True, "severity": "blocking", "budget": "mechanical"}]
# Version 6 also expected a preexisting contradiction of the Hatch clause at host_t.rs#send's
# external_body marker. Version 7 has no Hatch clause (A.4.2.4, D1): external_body is allowed at the
# HostTrusted boundary, so the base raises nothing there (A.11.2.4 "allowed hatch at a boundary
# raises nothing"; vector allowed-hatch-at-boundary; golden ex2).
write("ex2_assume", c2base, {"verdict": "blocked", "errors": [], "obligations": EX2_OBS, "exact": True})

refs2 = [V["binding ex2.contradiction"][:19], V["binding ex2.unestablished"][:19]]
c = copy.deepcopy(c2base)
c["records"].append(answer(I + "dana", refs2, change="github:acme/ironkv#12", prov_id=I + "reviews"))
write("ex2_approve_without_exception", c, {"verdict": "blocked", "obligations": EX2_OBS, "answered": [], "exact": True})

EXC2 = {"q": I + "SetAssume", "waives": ["contradiction", "unestablished"],
        "target": {"kind": "component", "q": I + "DelegationMap"}, "for": [{"kind": "code", "id": SET}],
        "owner": I + "IronKvTeam", "expires": "2026-12-15T00:00:00Z", "expiresText": "2026-12-15"}
c = copy.deepcopy(c2base)
c["head"]["esf"] = esf2([EXC2])
c["records"].append(answer(I + "dana", refs2, change="github:acme/ironkv#12", prov_id=I + "reviews"))
write("ex2_exception_answered", c, {"verdict": "owed", "obligations": [
    dict(EX2_OBS[0], severity="owed", exception=I + "SetAssume"), dict(EX2_OBS[1], severity="owed", exception=I + "SetAssume")],
    "debt": [{"obligation": V["key ex2.contradiction"], "expiresInDays": 51},
             {"obligation": V["key ex2.unestablished"], "expiresInDays": 51}], "exact": True})
c = copy.deepcopy(c2base)
c["head"]["esf"] = esf2([EXC2])
write("ex2_exception_unanswered", c, {"verdict": "blocked", "obligations": EX2_OBS, "exact": True})
c = copy.deepcopy(c2base)
c["head"]["esf"] = esf2([EXC2])
c["records"].append(answer(I + "agent", refs2, change="github:acme/ironkv#12", prov_id=I + "reviews"))
write("ex2_exception_agent_answer", c, {"verdict": "blocked", "obligations": EX2_OBS, "exact": True})

# =============================================================================
# Example 3
# =============================================================================
T = "tooling::"
K = "checker::"
ISO = "ts:packages/shp-cli/src/freshness.ts#isoToday"
ISO_F = "ts:packages/shp-cli/src/freshness.ts"
ISO_B = "sha256:3018423164cf0d769cf3a0b13c4f5a70297ad51908b34467dcf8eb9ca4193703"
ISO_H = "sha256:6f68619e784427af2372e479a15e284f6054a0fb6540a8287959d16cd4cc02fb"
ACTORS3 = [actor(T + "ShapeMaintainers", "team", [T + "tim"]), actor(T + "tim", "person"),
           actor(T + "claude", "agent", operator=T + "tim")]
CHECKER = ["checker::ShapeBindings", "checker::ShapeChecker", "checker::ShapeDiagnostics", "checker::ShapeModelLowerer",
           "checker::ShapeModuleResolver", "checker::ShapePreludeRegistry", "checker::ShapeRuleEngine",
           "checker::ShapeStringHelpers", "checker.incremental::ShapeIncrementalChecker"]


def comp(q, paths, grants=None, tier="normal", owner=T + "ShapeMaintainers", boundary=False):
    return {"q": q, "boundary": boundary, "owner": owner, "tier": tier, "paths": paths, "grants": grants, "allows": [],
            "assumes": [], "complete": [], "was": None, "units": [], "attach": []}


CLI = comp(T + "ShpCli", ["packages/shp-cli/src/**/*.ts"])
UNIT_ISO = {"q": T + "ShpCli.isoToday", "component": T + "ShpCli", "name": "isoToday", "owner": T + "ShapeMaintainers",
            "tier": "normal", "bind": ISO, "was": None, "summary": None, "attach": ["std::RefactorSensitive"]}
CLOCK_UNBOUND = {"q": T + "SystemClock", "owner": T + "ShapeMaintainers", "tier": "normal", "bind": [], "was": None, "attach": []}
LAW_REF = claim(["tooling::ShpCli.isoToday/RefactorSensitive/law"], "law",
                {"on": ["unit tooling::ShpCli.isoToday"], "statement": {"text": REFACTOR_TEXT}},
                T + "ShapeMaintainers", "normal", req("none", judged=True))
ISO_SUM = claim(["tooling::ShpCli.isoToday/effects"], "effects.upper",
                {"unit": T + "ShpCli.isoToday", "atoms": ["Read<tooling::SystemClock>"]}, T + "ShapeMaintainers", "normal")
PROV3 = [prov(T + "reviews", ["judgment"], identity='sigstore("relay")', digest="sha256:relay")]


def esf3(claims, resources=(CLOCK_UNBOUND,), comps=(CLI,), units=(UNIT_ISO,), providers=PROV3):
    return esf(T + "Shape", T + "ShapeMaintainers", ACTORS3, list(resources), list(comps), list(units), claims, list(providers))


def entries3(head):
    return [entry(ISO_F, "file", label("freshness.ts file, " + ("head" if head else "base")), kind="file"),
            entry(ISO_F, "own", label("freshness.ts own"), kind="file"),
            entry(ISO, "unit", ISO_H if head else ISO_B, parent=ISO_F),
            entry(ISO, "own", label("isoToday own, " + ("head" if head else "base")), parent=ISO_F)]


tim_j = record({"kind": "judgment", "result": "supports", "provider": {"id": T + "reviews", "version": "1.0.0"},
                "revision": "b3", "time": "2026-09-01T10:00:00Z",
                "claim": {"id": "tooling::ShpCli.isoToday/RefactorSensitive/law", "fp": "sha256:c414eadc238d87c4e004899e9f2fe5a2ecfe615dae7eb8a242714426a059a077"},
                "code": [cite(ISO, "unit", ISO_B)], "judge": T + "tim"})
s3 = esf3([LAW_REF, ISO_SUM])
c = case(s3, manifest("h3", entries3(True)), "h3", s3, manifest("b3", entries3(False)), "b3", records=[tim_j],
         authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#3"])
write("ex3_refactor_stale", c, {"verdict": "owed", "obligations": [
    {"key": V["key ex3.unestablished.refactor"], "binding": V["binding ex3.unestablished.refactor"], "kind": "unestablished",
     "reason": "stale", "introduced": True, "severity": "owed", "tier": "normal"}], "exact": True})
# Re-judged by one line (self fallback, Claude authored): pass.
tim_j2 = copy.deepcopy(tim_j)
tim_j2["predicate"]["shape"]["code"] = [cite(ISO, "unit", ISO_H)]
tim_j2["predicate"]["shape"]["revision"] = "h3"
c2 = copy.deepcopy(c)
c2["records"] = [tim_j2]
write("ex3_rejudged", c2, {"verdict": "pass", "obligations": [], "exact": True})
# Unchanged isoToday: the old judgment stays usable.
c3 = case(s3, manifest("b3", entries3(False)), "b3", s3, manifest("b3", entries3(False)), "b3", records=[tim_j],
          authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#3"])
write("ex3_unchanged", c3, {"verdict": "pass", "obligations": [], "exact": True})
# Removing RefactorSensitive: L4 loosened (removed), latent, blocked under DefaultPolicy normal.
s3h = esf3([ISO_SUM])
c4 = case(s3h, manifest("b3", entries3(False)), "b3", s3, manifest("b3", entries3(False)), "b3", records=[tim_j],
          authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#3"])
write("ex3_refactor_removed", c4, {"verdict": "blocked", "obligations": [
    {"key": V["key ex3.loosening.refactor.removed"], "kind": "loosening", "tier": "normal", "severity": "blocking",
     "exploited": False}], "exact": True})

# Step 2: the seeded Date.now() in checkFreshness.
CF = "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness"
CF_F = "ts:packages/shp-checker/src/checker/rules/guards.ts"
CLOCK = {"q": T + "SystemClock", "owner": T + "ShapeMaintainers", "tier": "normal",
         "bind": ['ts.call("Date.now")', 'ts.call("Date")', 'ts.call("performance.now")', 'ts.call("process.hrtime")'],
         "was": None, "attach": []}
RULE_ENGINE = comp(K + "ShapeRuleEngine", ["packages/shp-checker/src/checker/rules/**/*.ts"],
                   grants=["Read<tooling::ShapeSource>"])
SOURCE = {"q": T + "ShapeSource", "owner": T + "ShapeMaintainers", "tier": "normal", "bind": [], "was": None, "attach": []}
RULE_CLOCK = claim(["tooling::CheckerNeverReadsClock"], "effect.forbid",
                   {"atom": "Read<tooling::SystemClock>", "scope": sorted("component " + q for q in CHECKER), "except": []},
                   T + "ShapeMaintainers", "critical")
AUTH_RE = claim(["checker::ShapeRuleEngine/authority"], "authority",
                {"component": K + "ShapeRuleEngine", "grants": ["Read<tooling::ShapeSource>"]}, T + "ShapeMaintainers", "normal")
PROV3b = PROV3 + [prov(T + "tsClockScan", ["observation"],
                       observes=['effect(ts.call("Date.now"))', 'effect(ts.call("Date"))', 'effect(ts.call("performance.now"))',
                                 'effect(ts.call("process.hrtime"))'], presence=True, absence=True, identity='sigstore("clock")',
                       paths=["tools/clock-scan.ts", "tsconfig.json", "package.json", "bun.lock"])]
s3b = esf3([RULE_CLOCK, AUTH_RE], resources=(CLOCK, SOURCE), comps=(CLI, RULE_ENGINE), units=(), providers=PROV3b)
ent3b = [entry(CF_F, "file", label("guards.ts file"), kind="file"), entry(CF_F, "own", label("guards.ts own"), kind="file"),
         entry(CF, "unit", label("checkFreshness unit"), parent=CF_F), entry(CF, "own", label("checkFreshness own"), parent=CF_F)]
ent3b_h = [entry(CF_F, "file", label("guards.ts file h"), kind="file"), entry(CF_F, "own", label("guards.ts own"), kind="file"),
           entry(CF, "unit", label("checkFreshness unit h"), parent=CF_F), entry(CF, "own", label("checkFreshness own h"), parent=CF_F)]
clock_obs = record({"kind": "observation", "result": "observes", "provider": {"id": T + "tsClockScan", "version": "1"},
                    "revision": "h4", "time": "2026-10-25T10:00:00Z",
                    "scope": {"root": "x", "entries": [ent(CF, "unit", label("checkFreshness unit h")),
                                                       ent(CF_F, "file", label("guards.ts file h"))]},
                    "facts": [{"type": "effect", "at": CF, "verb": "Read", "resource": 'ts.call("Date.now")'}], "harness": []})
c = case(s3b, manifest("h4", ent3b_h), "h4", s3b, manifest("b4", ent3b), "b4", records=[clock_obs],
         authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#4"])
write("ex3_seeded_clock", c, {"verdict": "blocked", "obligations": [
    {"key": V["key ex3.contradiction"], "kind": "contradiction", "force": "sound", "introduced": True, "severity": "blocking",
     "tier": "critical", "witness": [V["factId ex3.clock"]]}], "exact": True})
# An exception on the rule alone does not match (authority also excludes the fact).
EXC3 = {"q": T + "ClockException", "waives": ["contradiction"],
        "target": {"kind": "claim", "fps": ["sha256:866e06e6bddd0add1cd7a6103d38d09c31bed7b56936712bd6318cd6497ba0f1"], "ref": "rule"},
        "for": None, "owner": T + "ShapeMaintainers", "expires": "2026-12-01T00:00:00Z", "expiresText": "2026-12-01"}
c2 = copy.deepcopy(c)
c2["head"]["esf"]["exceptions"] = [EXC3]
write("ex3_rule_exception_no_match", c2, {"verdict": "blocked", "obligations": [
    {"key": V["key ex3.contradiction"], "severity": "blocking", "exception": None}], "exact": True})
# A component exception matches both excluding claims but still needs an exception answer (A.14.3.5).
EXC3c = dict(EXC3, q=T + "ClockComp", target={"kind": "component", "q": K + "ShapeRuleEngine"})
c3 = copy.deepcopy(c)
c3["head"]["esf"]["exceptions"] = [EXC3c]
write("ex3_component_exception_unanswered", c3, {"verdict": "blocked", "obligations": [
    {"key": V["key ex3.contradiction"], "severity": "blocking", "exception": None}], "exact": True})

# =============================================================================
# Example 4
# =============================================================================
P = "ts:packages/shp-checker/src/checker/"
REL = claim(["checker::ShapeRuleEngineReadsLoweredFacts"], "edge.exists",
            {"from": K + "ShapeRuleEngine", "kind": "calls", "to": K + "ShapeModelLowerer"}, T + "ShapeMaintainers", "normal")
CYC = claim(["checker::no_runtime_dependency_cycles"], "cycle.forbid", {"kinds": ["calls"]}, T + "ShapeMaintainers", "normal")
COMPS4 = [comp(K + "ShapeChecker", ["packages/shp-checker/src/**/*.ts"]),
          comp(K + "ShapeRuleEngine", ["packages/shp-checker/src/checker/derivations.ts", "packages/shp-checker/src/checker/rules/**/*.ts"]),
          comp(K + "ShapeModelLowerer", ["packages/shp-checker/src/checker/lowering/**/*.ts"]),
          comp(K + "ShapeDiagnostics", ["packages/shp-checker/src/checker/diagnostics/**/*.ts"])]
PROV4 = [prov(T + "tsCallGraph", ["observation"], observes=["call(ts)"], identity='sigstore("calls")', paths=["tools/callgraph.ts"])]
ent4 = []
for f in ["lowering/facts.ts", "lowering/context.ts", "derivations.ts"]:
    ent4 += [entry(P + f, "file", label(f + " file"), kind="file"), entry(P + f, "own", label(f + " own"), kind="file")]
for s in ["requirementsForTarget", "shapeTraitBearers", "requiresReevaluation"]:
    ent4 += [entry(P + "derivations.ts#" + s, "unit", label(s + " unit"), parent=P + "derivations.ts"),
             entry(P + "derivations.ts#" + s, "own", label(s + " own"), parent=P + "derivations.ts")]
calls = [{"type": "call", "at": P + "lowering/facts.ts", "to": P + "derivations.ts#requirementsForTarget"},
         {"type": "call", "at": P + "lowering/facts.ts", "to": P + "derivations.ts#shapeTraitBearers"},
         {"type": "call", "at": P + "lowering/context.ts", "to": P + "derivations.ts#requiresReevaluation"}]
call_obs = record({"kind": "observation", "result": "observes", "provider": {"id": T + "tsCallGraph", "version": "1"},
                   "revision": "h5", "time": "2026-10-25T10:00:00Z",
                   "scope": {"root": "x", "entries": [ent(P + "lowering/facts.ts", "file", label("lowering/facts.ts file")),
                                                      ent(P + "lowering/context.ts", "file", label("lowering/context.ts file"))]},
                   "facts": calls, "harness": []})
s4 = esf(T + "Shape", T + "ShapeMaintainers", ACTORS3, [], COMPS4, [], [REL, CYC], PROV4)
c = case(s4, manifest("h5", ent4), "h5", s4, manifest("h5", ent4), "h5", records=[call_obs],
         authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#5"])
write("ex4_cycle", c, {"verdict": "owed", "obligations": [
    {"key": V["key ex4.cycle"], "binding": V["binding ex4.cycle"], "group": V["group ex4"], "kind": "contradiction",
     "force": "heuristic", "introduced": False, "severity": "owed", "budget": "judgment"}], "exact": True})

COMPLETE = claim(["checker::ShapeRuleEngine/relations-complete-calls"], "edge.forbid",
                 {"from": ["component checker::ShapeRuleEngine"], "exceptFrom": [], "kind": "calls", "to": ["*"],
                  "exceptTo": ["component checker::ShapeModelLowerer"]}, T + "ShapeMaintainers", "normal")
COMPLETE_H = claim(["checker::ShapeRuleEngine/relations-complete-calls"], "edge.forbid",
                   {"from": ["component checker::ShapeRuleEngine"], "exceptFrom": [], "kind": "calls", "to": ["*"],
                    "exceptTo": sorted(["component checker::ShapeModelLowerer", "component checker::ShapeDiagnostics"])},
                   T + "ShapeMaintainers", "normal")
REL2 = claim(["checker::ShapeRuleEngineReportsDiagnostics"], "edge.exists",
             {"from": K + "ShapeRuleEngine", "kind": "calls", "to": K + "ShapeDiagnostics"}, T + "ShapeMaintainers", "normal")
s4b = esf(T + "Shape", T + "ShapeMaintainers", ACTORS3, [], COMPS4, [], [REL, COMPLETE], [])
s4h = esf(T + "Shape", T + "ShapeMaintainers", ACTORS3, [], COMPS4, [], [REL, REL2, COMPLETE_H], [])
c = case(s4h, manifest("h5", ent4), "h5", s4b, manifest("h5", ent4), "h5", records=[],
         authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#6"])
write("ex4_complete_widened", c, {"verdict": "blocked", "obligations": [
    {"key": V["key ex4.complete.loosening"], "kind": "loosening", "severity": "blocking", "exploited": True}], "exact": True})

# Path forbid loosening found by the L3 search (kernel isolation narrowed).
ISO_P = claim(["checker::KernelIsolation"], "path.forbid",
              {"from": ["component checker::ShapeChecker"], "to": ["component checker::ShapeDiagnostics"], "kinds": ["calls"],
               "exceptVia": []}, T + "ShapeMaintainers", "critical")
s4pb = esf(T + "Shape", T + "ShapeMaintainers", ACTORS3, [], COMPS4, [], [ISO_P], [])
s4ph = esf(T + "Shape", T + "ShapeMaintainers", ACTORS3, [], COMPS4, [], [], [])
c = case(s4ph, manifest("h5", ent4), "h5", s4pb, manifest("h5", ent4), "h5", records=[],
         authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#7"])
write("ex4_path_removed", c, {"verdict": "blocked", "obligations": [
    {"kind": "loosening", "tier": "critical", "severity": "blocking", "exploited": False}], "exact": True})
# The same path forbid kept: no loosening.
c = case(s4pb, manifest("h5", ent4), "h5", s4pb, manifest("h5", ent4), "h5", records=[],
         authors=[T + "claude", T + "tim"], change_ids=["github:acme/shape#8"])
write("ex4_path_kept", c, {"verdict": "pass", "obligations": [], "exact": True})

print(len([f for f in os.listdir(OUT) if f.endswith(".expect.json")]), "cases written to", OUT)
