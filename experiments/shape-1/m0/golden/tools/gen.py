"""Golden core outputs (shape.check.output/v1, core form) for the 21 example inputs under version 7.

  python3 -I gen.py <v7 inputs dir> <v6 outputs dir> <out dir>

Every value is written out from the version 7 text (clauses in the comments); hashes come from
experiments/shape-1/spec/vectors/vectors.py's functions, and where vectors.py names a value it is asserted.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (FP, V, H, binding, check_groups, claim_ref, creates, declared_only, dis, fact_id, fp_of,  # noqa: E402
                    group_id, health, input_digest, jcs, label, ob_key, obligation, output, record_id, serialise)

IN, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def inp(name):
    return load(os.path.join(IN, name + ".json"))


def rec_id_where(inputd, pred):
    from common import statement_of
    ids = [record_id(r) for r in inputd["records"] if pred(statement_of(r)["predicate"]["shape"])]
    assert len(ids) == 1, ids
    return ids[0]


def eq(a, b, what):
    assert a == b, (what, a, b)


# =========================================================================================================
# Example 1
# =========================================================================================================
AE = "audit::AuditEvent"
PG = 'pg.table("audit_events")'
P_FN, P_FILE = "ts:src/audit/purge.ts#purgeOldEvents", "ts:src/audit/purge.ts"
ST_FN, ST_FILE = "ts:src/audit/store.ts#appendEvent", "ts:src/audit/store.ts"
PKG, LOCK, HIST = "pkgjson:package.json", "raw:bun.lock", "ts:test/audit/history.test.ts"
Q_FN = "ts:scripts/purge-audit.ts#purgeOldEvents"
SH = "raw:src/audit/purge.sh"
CELL_A = 'cell:["audit::AuditStore.*","audit::AuditStore.*"]'
CELL_U = 'cell:["ungoverned","ungoverned"]'
TEAM, PLAT = "audit::AuditTeam", "audit::Platform"
BOB, CAROL = "audit::bob", "audit::carol"

# D13, syntax §4: std AppendOnly<R> { forbid Update<R> }; tier final from its bearer AuditEvent (A.4.1.3)
FP_FORBID = fp_of("effect.forbid", {"atom": "Update<audit::AuditEvent>", "scope": ["*"], "except": []})
eq(FP_FORBID, FP["ex1.appendonly"], "fp ex1.appendonly")
ID_FORBID = "audit::AuditEvent/AppendOnly/effect.forbid-Update"  # A.4.1.1 <bearer>/<Template>/<op>-<arg>
FP_AUTH = FP["ex1.authority.base"]
FP_LAW = FP["ex1.history.law"]
FP_LOWER_PURGE = fp_of("effects.lower", {"unit": "audit::AuditStore.purgeOldEvents", "atoms": ["HardDelete<audit::AuditEvent>"]})
FP_UP_APP = fp_of("effects.upper", {"unit": "audit::AuditStore.appendEvent", "atoms": ["Append<audit::AuditEvent>"]})
FP_LO_APP = fp_of("effects.lower", {"unit": "audit::AuditStore.appendEvent", "atoms": ["Append<audit::AuditEvent>"]})

F_PURGE = {"type": "effect", "at": P_FN, "verb": "HardDelete", "resource": PG}
FID_PURGE = fact_id(F_PURGE)
eq(FID_PURGE, V.out["factId ex1.purge"], "factId ex1.purge")
F_Q = {"type": "effect", "at": Q_FN, "verb": "HardDelete", "resource": PG}
FID_Q = fact_id(F_Q)


def with_n(f, n):
    # obligation.facts maps a fact id to the fact; n is part of the fact (records §2, A.12.8.4), the id is not
    return dict(f, n=n)


def ex1_final_contra_dis():
    # A.7.1.3: sound contradiction: edit code; (exception: not at tier final, A.4.6.7); edit shape, which creates
    # a final loosening answered by two persons of the claim's owner* and the base shape owner (A.6.3.4)
    return [dis("edit-code", "author", True),
            dis("edit-shape", "author", True, [], creates("loosening", "final", 2, [TEAM, PLAT]))]


def ex1_health(**kw):
    base = dict(coverage={"num": 2, "den": 2}, ungoverned={"num": 3, "den": 7},
                executesHead=["audit::fastCheck"], baseObservations="missing")
    base.update(kw)
    return health(**base)


def ex1_B(name, weak=False):
    i = inp(name)
    kB = ob_key({"kind": "contradiction", "claim": FP_FORBID, "subject": {"code": P_FN, "atom": "HardDelete<audit::AuditEvent>"}})
    eq(kB, V.out["key ex1.B.contradiction"], "key ex1.B")
    # A.7.2.2: affected = support code (the fact's identity); code = (x, own) per affected finest change
    bB = binding(kB, [P_FN], [[P_FN, "own", None, label(P_FN + " own, head")]])
    eq(bB, V.out["binding ex1.B.contradiction"], "binding ex1.B")
    gB = group_id([kB])
    eq(gB, V.out["group ex1.B"], "group ex1.B")
    obs = [obligation(
        key=kB, kind="contradiction", introduced=True, severity="blocking", tier="final", budget="mechanical",
        force="sound", owner=TEAM, group=gB, claim=claim_ref(FP_FORBID, [ID_FORBID], "final"),
        subject={"code": P_FN, "atom": "HardDelete<audit::AuditEvent>"}, witness=[FID_PURGE],
        facts={FID_PURGE: with_n(F_PURGE, 1)}, final=True, binding=bB, dischargers=ex1_final_contra_dis(),
        causes=[{"type": "fact", "id": FID_PURGE}, {"type": "binding", "id": "resource audit::AuditEvent"},
                {"type": "code", "id": P_FN}, {"type": "claim", "id": FP_AUTH}, {"type": "claim", "id": FP_FORBID}])]
    loosening = []
    order = "equivalent"
    if weak:
        kL = ob_key({"kind": "loosening", "subject": "provider audit::sqlEffects"})
        bL = binding(kL, [], [], ["L7 presence true false"])  # A.12.8.7 L7 <field> <JCS(base)> <JCS(head)>
        obs.append(obligation(
            key=kL, kind="loosening", questions=["L7"], introduced=True, severity="blocking", tier="final",
            budget="judgment", owner=PLAT, group=group_id([kL]), subject="provider audit::sqlEffects",
            exploited=False, final=True, binding=bL,
            dischargers=[dis("revert", "author", True), dis("answer", "judges", False, [CAROL])],
            causes=[{"type": "base-claim", "id": "provider audit::sqlEffects"}]))
        loosening = [{"question": "L7", "subject": "provider audit::sqlEffects", "answer": "undecided",
                      "exploited": False, "final": True, "affected": [], "counterexample": None, "obligation": kL}]
        order = "undecided"
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=obs,
                  loosening=loosening, order=order, budget={"limit": None, "used": 0, "overflow": []},
                  health=ex1_health())


def ex1_A(name):
    i = inp(name)
    key_json = jcs({"v": "shape.obligation.v1", "kind": "contradiction", "claim": FP_FORBID,
                    "subject": {"code": P_FN, "atom": "HardDelete<audit::AuditEvent>"}}).decode("utf-8")
    decl = H({"type": "declared", "claim": FP_LOWER_PURGE, "atom": "HardDelete<audit::AuditEvent>"})
    err = {"code": "E-conduct", "subject": key_json,
           "causes": [{"type": "fact", "id": decl}, {"type": "code", "id": P_FN}],
           "dischargers": [dis("edit-shape", "author", True)]}
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", errors=[err], obligations=[],
                  order="tighter", budget={"limit": None, "used": 0, "overflow": []}, health=ex1_health())


CX_PURGE = {"at": P_FN, "verb": "HardDelete", "resource": PG}  # A.8.3.2, A.12.8.8 [D17]


def ex1_C_parts():
    kCf = ob_key({"kind": "loosening", "subject": FP_FORBID})
    kCa = ob_key({"kind": "loosening", "subject": "component audit::AuditStore"})
    eq(kCf, V.out["key ex1.C.forbid"], "key ex1.C.forbid")
    eq(kCa, V.out["key ex1.C.authority"], "key ex1.C.authority")
    all_ids = [PKG, LOCK, P_FILE, P_FN, ST_FILE, ST_FN, HIST]
    aff_f = sorted(all_ids + [CELL_A, CELL_U])
    aff_a = sorted([P_FILE, P_FN, ST_FILE, CELL_A])
    code = [[P_FILE, "own", None, label(P_FILE + " own, head")], [P_FN, "own", None, label(P_FN + " own, head")]]
    delta_f = ["L1 level %s<audit::AuditEvent> final>%s" % (a, t)
               for a in ["DropStorage", "HardDelete", "LogicalDelete", "Redact", "Truncate", "Update"]
               for t in ["critical", "none"]]
    delta_a = ["L1 authority+ HardDelete<audit::AuditEvent>", "L1 authority+ Update<audit::AuditEvent>"]
    bCf = binding(kCf, aff_f, code, delta_f)
    bCa = binding(kCa, aff_a, code, delta_a)
    eq(bCf, V.out["binding ex1.C.forbid"], "binding ex1.C.forbid")
    eq(bCa, V.out["binding ex1.C.authority"], "binding ex1.C.authority")
    gC = group_id([kCf, kCa])
    eq(gC, V.out["group ex1.C"], "group ex1.C")
    of = obligation(key=kCf, kind="loosening", questions=["L1"], introduced=True, severity="blocking", tier="final",
                    budget="judgment", owner=TEAM, group=gC, claim=claim_ref(FP_FORBID, [ID_FORBID], "final"),
                    subject=FP_FORBID, counterexample=CX_PURGE, exploited=True, final=True, binding=bCf,
                    dischargers=[dis("revert", "author", True), dis("answer", "judges", False, [BOB, CAROL])],
                    causes=[{"type": "base-claim", "id": FP_FORBID}])
    oa = obligation(key=kCa, kind="loosening", questions=["L1"], introduced=True, severity="blocking",
                    tier="critical", budget="judgment", owner=TEAM, group=gC, subject="component audit::AuditStore",
                    counterexample=CX_PURGE, exploited=True, final=False, binding=bCa,
                    dischargers=[dis("revert", "author", True), dis("answer", "judges", False, [BOB])],
                    causes=[{"type": "base-claim", "id": "component audit::AuditStore"}])
    rows = [{"question": "L1", "subject": "component audit::AuditStore", "answer": "loosened", "exploited": True,
             "final": False, "affected": aff_a, "counterexample": CX_PURGE, "obligation": kCa},
            {"question": "L1", "subject": FP_FORBID, "answer": "loosened", "exploited": True, "final": True,
             "affected": aff_f, "counterexample": CX_PURGE, "obligation": kCf}]
    return of, oa, rows, gC


def ex1_C(name):
    i = inp(name)
    of, oa, rows, _ = ex1_C_parts()
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[of, oa],
                  loosening=rows, order="incomparable", budget={"limit": None, "used": 0, "overflow": []},
                  health=ex1_health())


def ex1_C_answered(name):
    i = inp(name)
    of, oa, rows, gC = ex1_C_parts()
    rb = rec_id_where(i, lambda s: s.get("judge") == BOB)
    rc = rec_id_where(i, lambda s: s.get("judge") == CAROL)
    answered = [{"obligation": oa["key"], "records": [rb], "self": False, "exploited": True, "as": "discharge"},
                {"obligation": of["key"], "records": sorted([rb, rc]), "self": False, "exploited": True,
                 "as": "discharge"}]
    out = output(mode="change", inputDigest=input_digest(i), verdict="pass", obligations=[], answered=answered,
                 loosening=rows, order="incomparable", budget={"limit": None, "used": 0, "overflow": []},
                 health=ex1_health())
    return out


def ex1_Bprime(name):
    i = inp(name)
    k = ob_key({"kind": "contradiction", "claim": FP_FORBID, "subject": {"code": Q_FN, "atom": "HardDelete<audit::AuditEvent>"}})
    eq(k, V.out["key ex1.Bprime.contradiction"], "key ex1.Bprime")
    b = binding(k, [Q_FN], [[Q_FN, "own", None, label("purge-audit fn own")]])
    obs = [obligation(
        key=k, kind="contradiction", introduced=True, severity="blocking", tier="final", budget="mechanical",
        force="sound", owner=TEAM, group=group_id([k]), claim=claim_ref(FP_FORBID, [ID_FORBID], "final"),
        subject={"code": Q_FN, "atom": "HardDelete<audit::AuditEvent>"}, witness=[FID_Q],
        facts={FID_Q: with_n(F_Q, 1)}, final=True, binding=b, dischargers=ex1_final_contra_dis(),
        causes=[{"type": "fact", "id": FID_Q}, {"type": "binding", "id": "resource audit::AuditEvent"},
                {"type": "code", "id": Q_FN}, {"type": "claim", "id": FP_FORBID}])]
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=obs, order="equivalent",
                  budget={"limit": None, "used": 0, "overflow": []},
                  health=ex1_health(ungoverned={"num": 5, "den": 7}))


def ex1_Bsecond(name):
    i = inp(name)
    k = ob_key({"kind": "coverage", "subject": "ungoverned"})
    eq(k, V.out["key ex1.Bsecond.coverage.ungoverned"], "key Bsecond")
    b = binding(k, [SH], [[SH, "own", None, label(SH + " own, head")]], [FP_FORBID + " " + "effect(" + PG + ")"])
    eq(b, V.out["binding ex1.Bsecond.coverage.ungoverned"], "binding Bsecond")
    obs = [obligation(
        key=k, kind="coverage", introduced=True, severity="blocking", tier="final", budget="judgment", owner=PLAT,
        group=group_id([k]), subject="ungoverned", final=True, binding=b,
        dischargers=[dis("answer", "judges", False, [BOB, CAROL]), dis("declare", "author", True),
                     dis("provide", "author", True)],
        causes=[{"type": "code", "id": SH}])]
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=obs, order="equivalent",
                  budget={"limit": None, "used": 0, "overflow": []},
                  health=ex1_health(coverage={"num": 0, "den": 1}, ungoverned={"num": 4, "den": 6}))


def ex1_audit(name):
    i = inp(name)
    return output(mode="audit", inputDigest=input_digest(i), verdict="pass", obligations=[], order=None,
                  budget={"limit": None, "used": 0, "overflow": []},
                  health=health(ungoverned={"num": 3, "den": 5}, executesHead=["audit::fastCheck"]))


def ex1_empty_base(name):
    i = inp(name)
    k = ob_key({"kind": "unestablished", "claim": FP_LAW, "subject": None})
    su = "sha256:df38d45acb53c51e2faaca77f1229602ab595acdd158a52f2a526d1fa3408f08"
    so = label(ST_FILE + " own")
    b = binding(k, [ST_FN, ST_FILE], [[ST_FN, "unit", su, su], [ST_FILE, "own", so, so]])
    obs = [obligation(
        key=k, kind="unestablished", reason="missing", introduced=False, severity="owed", tier="critical",
        budget="mechanical", owner=TEAM, subject=None, group=group_id([k]),
        claim=claim_ref(FP_LAW, ["audit::EventsArePreserved"], "critical"), final=False, binding=b,
        dischargers=[dis("rerun", "ci", True), dis("exception", "judges", False, []),
                     dis("lower-requirement", "author", True, [], creates("loosening", "critical", 1, [TEAM]))],
        causes=[])]
    h = health(
        declaredOnly=[declared_only(FP_FORBID, "final", "declared-only"), declared_only(FP_AUTH, "critical", "declared-only"),
                      declared_only(FP_UP_APP, "critical", "declared-only"), declared_only(FP_LO_APP, "critical", "declared-only")],
        ungoverned={"num": 3, "den": 5},
        unauthenticated=["manifest base", "manifest head", "provider audit::fastCheck", "provider audit::reviews",
                         "provider audit::sqlEffects"],
        executesHead=["audit::fastCheck"], baseDefects=["E-parse shape"], preexisting=1)
    return output(mode="change", inputDigest=input_digest(i), verdict="owed", obligations=obs, order="tighter",
                  preexisting=[{"obligation": k, "owner": TEAM}], budget={"limit": None, "used": 0, "overflow": []},
                  health=h)


# =========================================================================================================
# Example 2
# =========================================================================================================
SET = "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set"
KV = "ironkv::IronKvTeam"
DANA = "ironkv::dana"
FP_ASSUME = FP["ex2.confine.assume"]
FP_UNDECLARED = FP["ex2.confine.Undeclared"]
FP_SETLAW = FP["ex2.law.set"]
F_HATCH = {"type": "hatch", "at": SET, "kind": "assume"}
FID_HATCH = fact_id(F_HATCH)
eq(FID_HATCH, V.out["factId ex2.hatch"], "factId ex2.hatch")


def ex2_obs(i, exception=False):
    k2, k2u = V.out["key ex2.contradiction"], V.out["key ex2.unestablished"]
    eq(k2, ob_key({"kind": "contradiction", "claim": FP_ASSUME, "subject": {"code": SET, "atom": "assume<std::Trust>"}}), "k2")
    eq(k2u, ob_key({"kind": "unestablished", "claim": FP_SETLAW, "subject": None}), "k2u")
    b2 = binding(k2, [SET], [[SET, "own", label("ironkv set own, base"), label("ironkv set own, head")]])
    b2u = binding(k2u, [SET], [[SET, "closure", V.SET_CLOSURE, V.SET_CLOSURE], [SET, "unit", V.SET_UNIT_B, V.SET_UNIT_H]])
    eq(b2, V.out["binding ex2.contradiction"], "b2")
    eq(b2u, V.out["binding ex2.unestablished"], "b2u")
    g = group_id([k2, k2u])
    eq(g, V.out["group ex2"], "group ex2")
    proof = rec_id_where(i, lambda s: s["kind"] == "proof")
    sev = "owed" if exception else "blocking"
    exc = "ironkv::SetAssumeAccepted" if exception else None
    c = obligation(
        key=k2, kind="contradiction", introduced=True, severity=sev, tier="critical", budget="mechanical",
        force="sound", owner=KV, group=g,
        claim=claim_ref(FP_ASSUME, ["ironkv::NoHatchesOutsideBoundaries/" + FP_ASSUME[7:19]], "critical"),
        subject={"code": SET, "atom": "assume<std::Trust>"}, witness=[FID_HATCH], facts={FID_HATCH: with_n(F_HATCH, 1)},
        final=False, binding=b2, exception=exc,
        dischargers=[dis("edit-code", "author", True), dis("exception", "judges", False, [DANA]),
                     dis("edit-shape", "author", True, [], creates("loosening", "critical", 1, [KV]))],
        causes=[{"type": "fact", "id": FID_HATCH}, {"type": "code", "id": SET}, {"type": "claim", "id": FP_ASSUME}])
    u = obligation(
        key=k2u, kind="unestablished", reason="assumption", subject=None, introduced=True, severity=sev, tier="critical",
        budget="mechanical", owner=KV, group=g, claim=claim_ref(FP_SETLAW, ["ironkv::SetRefinesSpec"], "critical"),
        final=False, binding=b2u, exception=exc,
        dischargers=[dis("edit-code", "author", True),
                     dis("declare", "author", False, [], creates("loosening", "critical", 1, [KV])),
                     dis("exception", "judges", False, [DANA]),
                     dis("lower-requirement", "author", True, [], creates("loosening", "critical", 1, [KV]))],
        causes=[{"type": "record", "id": proof}])
    return c, u


def ex2_health(**kw):
    base = dict(coverage={"num": 1, "den": 1},
                declaredOnly=[declared_only(FP_UNDECLARED, "critical", "declared-only")],
                openAuthority=["ironkv::DelegationMap", "ironkv::HostTrusted"], ungoverned={"num": 2, "den": 7},
                unauthenticated=["manifest base", "manifest head"], executesHead=["ironkv::verus", "ironkv::verusRefines"])
    base.update(kw)
    return health(**base)


DANA_LINE = "review ironkv::dana: shape approve bd:2ea660886d27e5e3 bd:1da36a42e325dc5a"


def ex2(name):
    i = inp(name)
    c, u = ex2_obs(i)
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[c, u],
                  order="equivalent", budget={"limit": None, "used": 0, "overflow": []}, health=ex2_health())


def ex2_approve_only(name):
    i = inp(name)
    c, u = ex2_obs(i)
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[c, u],
                  order="equivalent", budget={"limit": None, "used": 0, "overflow": []},
                  health=ex2_health(unauthenticated=["manifest base", "manifest head", DANA_LINE]))


def ex2_exception_approve(name):
    i = inp(name)
    c, u = ex2_obs(i, exception=True)
    src = "review:" + H(i["reviews"][0])[7:23]  # the prototype's reference for a CI-supplied approve line
    eq(src, "review:5f62d3b48c30dc6b", "review source")
    answered = [{"obligation": c["key"], "records": [src], "self": False, "exploited": None, "as": "exception-answer"},
                {"obligation": u["key"], "records": [src], "self": False, "exploited": None, "as": "exception-answer"}]
    import calendar
    import time
    now = calendar.timegm(time.strptime(i["now"], "%Y-%m-%dT%H:%M:%SZ"))
    exp = calendar.timegm(time.strptime("2026-12-15T00:00:00Z", "%Y-%m-%dT%H:%M:%SZ"))
    days = -(-(exp - now) // 86400)  # ceil((expires - now*)/86400), A.7.7.1, A.12.10.6
    eq(days, 51, "expiresInDays")
    debt = [{"obligation": x["key"], "exceptions": ["ironkv::SetAssumeAccepted"], "exception": "ironkv::SetAssumeAccepted",
             "owner": KV, "expiresInDays": days} for x in (c, u)]
    return output(mode="change", inputDigest=input_digest(i), verdict="owed", obligations=[c, u], answered=answered,
                  debt=debt, order="equivalent", budget={"limit": None, "used": 0, "overflow": []},
                  health=ex2_health(unauthenticated=["manifest base", "manifest head", DANA_LINE], trustDebt=2))


# =========================================================================================================
# Example 3
# =========================================================================================================
ISO = "ts:packages/shp-cli/src/freshness.ts#isoToday"
SM = "tooling::ShapeMaintainers"
TIM, ANN = "tooling::tim", "tooling::ann"
FP_REF = FP["ex3.refactor.law"]
ID_REF = "tooling::ShpCli.isoToday/RefactorSensitive/law"
FP_ISO_UP = fp_of("effects.upper", {"unit": "tooling::ShpCli.isoToday", "atoms": ["Read<tooling::SystemClock>"]})
FP_ISO_LO = fp_of("effects.lower", {"unit": "tooling::ShpCli.isoToday", "atoms": ["Read<tooling::SystemClock>"]})


def ex3s1_health(**kw):
    base = dict(coverage={"num": 2, "den": 2},
                declaredOnly=[declared_only(FP_ISO_LO, "normal", "declared-only"),
                              declared_only(FP_ISO_UP, "normal", "declared-only")],
                openAuthority=["tooling::ShpCli"], ungoverned={"num": 0, "den": 3},
                unauthenticated=["manifest base", "manifest head"])
    base.update(kw)
    return health(**base)


def ex3_step1(name):
    i = inp(name)
    k = V.out["key ex3.unestablished.refactor"]
    eq(k, ob_key({"kind": "unestablished", "claim": FP_REF, "subject": None}), "k3r")
    b = binding(k, [ISO], [[ISO, "unit", V.ISO_B, V.ISO_H]])
    eq(b, V.out["binding ex3.unestablished.refactor"], "b3r")
    tim_j = rec_id_where(i, lambda s: s["kind"] == "judgment" and s.get("revision", "").startswith("4444"))
    obs = [obligation(
        key=k, kind="unestablished", reason="stale", subject=None, introduced=True, severity="owed", tier="normal", budget="judgment",
        owner=SM, assignee="agents", group=group_id([k]), claim=claim_ref(FP_REF, [ID_REF], "normal"), final=False,
        binding=b,
        dischargers=[dis("judge", "judges", True, [TIM]), dis("exception", "judges", False, [TIM]),
                     dis("lower-requirement", "author", True, [], creates("loosening", "normal", 1, [SM]))],
        causes=[{"type": "record", "id": tim_j}])]
    return output(mode="change", inputDigest=input_digest(i), verdict="owed", obligations=obs, order="equivalent",
                  budget={"limit": None, "used": 1, "overflow": []},
                  health=ex3s1_health(budget={"limit": None, "used": 1, "overflow": 0}))


def ex3_step1_judged(name):
    i = inp(name)
    return output(mode="change", inputDigest=input_digest(i), verdict="pass", obligations=[], order="equivalent",
                  budget={"limit": None, "used": 0, "overflow": []},
                  health=ex3s1_health(self=["judgment " + ID_REF + " by " + TIM]))


CSM = "ts:packages/shp-checker/src/checker/api.ts#checkShapeModules"
FRESH = "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness"
DET = "ts:packages/shp-checker/src/behavioural/determinism.test.ts"
FP_DET = FP["ex3.det.law"]
FP_RULE = FP["ex3.clock.checker"]
FP_AUTH_SRE = fp_of("authority", {"component": "checker::ShapeRuleEngine", "grants": []})
OPEN8 = ["checker.incremental::ShapeIncrementalChecker", "checker::ShapeBindings", "checker::ShapeDiagnostics",
         "checker::ShapeModelLowerer", "checker::ShapeModuleResolver", "checker::ShapePreludeRegistry",
         "checker::ShapeStringHelpers", "tooling::ShpCli"]


def ex3s2_health(**kw):
    base = dict(openAuthority=OPEN8, ungoverned={"num": 2, "den": 8}, unauthenticated=["manifest base", "manifest head"],
                executesHead=["checker::bunTest"], baseObservations="missing")
    base.update(kw)
    return health(**base)


def ex3_step2(name):
    i = inp(name)
    return output(mode="change", inputDigest=input_digest(i), verdict="pass", obligations=[], order="equivalent",
                  budget={"limit": None, "used": 0, "overflow": []}, health=ex3s2_health())


def det_ob(i, reason):
    k = V.out["key ex3.unestablished.det"]
    eq(k, ob_key({"kind": "unestablished", "claim": FP_DET, "subject": None}), "kdet")
    pc = reason == "producer-changed"
    # A.7.2.2: affected = Req identities plus, when producer-changed, the harness finest change
    b = binding(k, [CSM, DET] if pc else [CSM], [[CSM, "unit", label("csm unit"), label("csm unit")]])
    if pc:
        test = rec_id_where(i, lambda s: s["kind"] == "test")
        d = [dis("answer", "judges", False, [ANN]), dis("exception", "judges", False, [ANN]),
             dis("lower-requirement", "author", True, [], creates("loosening", "critical", 1, [SM]))]
        return obligation(key=k, kind="unestablished", reason=reason, subject=None, introduced=True, severity="blocking",
                          tier="critical", budget="judgment", owner=SM, group=group_id([k]),
                          claim=claim_ref(FP_DET, ["checker::CheckIsDeterministic"], "critical"), final=False,
                          binding=b, dischargers=d, causes=[{"type": "record", "id": test}])
    d = [dis("rerun", "ci", True), dis("exception", "judges", False, [ANN]),
         dis("lower-requirement", "author", True, [], creates("loosening", "critical", 1, [SM]))]
    return obligation(key=k, kind="unestablished", reason=reason, subject=None, introduced=False, severity="owed", tier="critical",
                      budget="mechanical", owner=SM, group=group_id([k]),
                      claim=claim_ref(FP_DET, ["checker::CheckIsDeterministic"], "critical"), final=False, binding=b,
                      dischargers=d, causes=[])


def ex3_step2_harness_edited(name):
    i = inp(name)
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[det_ob(i, "producer-changed")],
                  order="equivalent", budget={"limit": None, "used": 0, "overflow": []},
                  health=ex3s2_health(coverage={"num": 1, "den": 1}))


def ex3_step2_record_dropped(name):
    i = inp(name)
    o = det_ob(i, "missing")
    err = {"code": "E-provider-missing", "subject": "provider checker::bunTest claim checker::CheckIsDeterministic",
           "causes": [{"type": "provider", "id": "checker::bunTest"}, {"type": "claim", "id": FP_DET}],
           "dischargers": [dis("rerun", "ci", True)]}
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", errors=[err], obligations=[o],
                  order="equivalent", preexisting=[{"obligation": o["key"], "owner": SM}],
                  budget={"limit": None, "used": 0, "overflow": []},
                  health=ex3s2_health(coverage={"num": 1, "den": 1}, preexisting=1))


def ex3_step2_refactor_sensitive_removed(name):
    i = inp(name)
    k = V.out["key ex3.loosening.refactor.removed"]
    eq(k, ob_key({"kind": "loosening", "subject": FP_REF}), "k refactor removed")
    b = binding(k, [ISO], [], ["L4 removed"])  # A.8.3.2 L4 affected Req; A.12.8.7 L4 removed
    o = obligation(key=k, kind="loosening", questions=["L4"], introduced=True, severity="blocking", tier="normal",
                   budget="judgment", owner=SM, group=group_id([k]), claim=claim_ref(FP_REF, [ID_REF], "normal"),
                   subject=FP_REF, exploited=False, final=False, binding=b,
                   dischargers=[dis("revert", "author", True), dis("answer", "judges", False, [ANN])],
                   causes=[{"type": "base-claim", "id": FP_REF}])
    rows = [{"question": "L4", "subject": FP_REF, "answer": "loosened", "exploited": False, "final": False,
             "affected": [ISO], "counterexample": None, "obligation": k}]
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[o], loosening=rows,
                  order="looser", budget={"limit": None, "used": 0, "overflow": []}, health=ex3s2_health())


def ex3_step2_seeded_clock(name):
    i = inp(name)
    k = V.out["key ex3.contradiction"]
    eq(k, ob_key({"kind": "contradiction", "claim": FP_RULE, "subject": {"code": FRESH, "atom": "Read<tooling::SystemClock>"}}), "k3")
    f = {"type": "effect", "at": FRESH, "verb": "Read", "resource": 'ts.call("Date.now")'}
    fid = fact_id(f)
    eq(fid, V.out["factId ex3.clock"], "factId ex3.clock")
    b = binding(k, [FRESH], [[FRESH, "own", label("fresh own b"), label("fresh own h")]])
    o = obligation(
        key=k, kind="contradiction", introduced=True, severity="blocking", tier="critical", budget="mechanical",
        force="sound", owner=SM, group=group_id([k]), claim=claim_ref(FP_RULE, ["tooling::CheckerNeverReadsClock"], "critical"),
        subject={"code": FRESH, "atom": "Read<tooling::SystemClock>"}, witness=[fid], facts={fid: with_n(f, 1)}, final=False,
        binding=b,
        dischargers=[dis("edit-code", "author", True), dis("exception", "judges", False, [ANN]),
                     dis("edit-shape", "author", True, [], creates("loosening", "critical", 1, [SM]))],
        causes=[{"type": "fact", "id": fid}, {"type": "binding", "id": "resource tooling::SystemClock"},
                {"type": "code", "id": FRESH}, {"type": "claim", "id": FP_AUTH_SRE}, {"type": "claim", "id": FP_RULE}])
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[o], order="equivalent",
                  budget={"limit": None, "used": 0, "overflow": []}, health=ex3s2_health(coverage={"num": 2, "den": 2}))


# =========================================================================================================
# Example 4
# =========================================================================================================
CSMN = "checker::ShapeMaintainers"
CTIM = "checker::tim"
D4 = "ts:packages/shp-checker/src/checker/derivations.ts"
FP_REL = FP["ex4.relation"]
FP_CYC = FP["ex4.cycle"]
FP_COMPLETE_B = FP["ex4.complete"]
FP_COMPLETE_H = fp_of("edge.forbid", {"from": ["component checker::ShapeRuleEngine"], "exceptFrom": [], "kind": "calls",
                                      "to": ["*"], "exceptTo": ["component checker::ShapeDiagnostics", "component checker::ShapeModelLowerer"]})
FP_REL_SD = fp_of("edge.exists", {"from": "checker::ShapeRuleEngine", "kind": "calls", "to": "checker::ShapeDiagnostics"})
OPEN4 = ["checker::ShapeChecker", "checker::ShapeDiagnostics", "checker::ShapeModelLowerer", "checker::ShapeRuleEngine"]


def cycle_ob():
    k = V.out["key ex4.cycle"]
    g = V.out["group ex4"]
    b = V.out["binding ex4.cycle"]
    rep = V.out["ex4 representative call fact"]
    decl = V.out["factId ex4.declared"]
    rep_fact = [f for f in V.calls if fact_id(f) == rep][0]
    decl_fact = {"type": "declared", "claim": FP_REL}
    eq(fact_id(decl_fact), decl, "declared fact ex4")
    # A.4.4.9-10, A.15.4: the witness lists the canonical witness's fact ids, in cycle order from the least node
    # (ShapeModelLowerer -> ShapeRuleEngine by the representative call fact, back by the declared edge);
    # call facts carry no n (tsCallGraph is not presence-sound, so RJ14 asks none)
    facts = {rep: rep_fact, decl: decl_fact}
    return obligation(
        key=k, kind="contradiction", introduced=False, severity="owed", tier="normal", budget="judgment",
        force="heuristic", owner=CSMN, assignee="agents", group=g, claim=claim_ref(FP_CYC, ["checker::no_runtime_dependency_cycles"], "normal"),
        subject={"nodes": ["checker::ShapeModelLowerer", "checker::ShapeRuleEngine"]}, witness=[rep, decl], facts=facts,
        final=False, binding=b,
        dischargers=[dis("answer", "judges", False, [CTIM]), dis("edit-code", "author", True),
                     dis("exception", "judges", False, [CTIM]),
                     dis("edit-shape", "author", True, [], creates("loosening", "normal", 1, [CSMN]))],
        causes=[{"type": "fact", "id": rep}, {"type": "fact", "id": decl}, {"type": "claim", "id": FP_CYC}])


def ex4_health(**kw):
    base = dict(declaredOnly=[declared_only(FP_REL, "normal", "contradiction-only"),
                              declared_only(FP_CYC, "normal", "contradiction-only")],
                openAuthority=OPEN4, ungoverned={"num": 1, "den": 8}, unauthenticated=["manifest base", "manifest head"],
                baseObservations="missing", budget={"limit": None, "used": 1, "overflow": 0}, preexisting=1)
    base.update(kw)
    return health(**base)


def ex4(name):
    i = inp(name)
    o = cycle_ob()
    return output(mode="change", inputDigest=input_digest(i), verdict="owed", obligations=[o], order="equivalent",
                  preexisting=[{"obligation": o["key"], "owner": CSMN}], budget={"limit": None, "used": 1, "overflow": []},
                  health=ex4_health())


def ex4_closing(name):
    i = inp(name)
    c = cycle_ob()
    k = V.out["key ex4.complete.loosening"]
    eq(k, ob_key({"kind": "loosening", "subject": FP_COMPLETE_B}), "k complete")
    aff = [D4, D4 + "#requirementsForTarget", D4 + "#requiresReevaluation", D4 + "#shapeTraitBearers"]
    b = binding(k, aff, [], ["L3 head " + FP_COMPLETE_H, "L3 head " + FP_CYC])
    cx = [{"from": "checker::ShapeRuleEngine", "kind": "calls", "to": "checker::ShapeDiagnostics"}]
    l3 = obligation(key=k, kind="loosening", questions=["L3"], introduced=True, severity="blocking", tier="normal",
                    budget="judgment", owner=CSMN, group=group_id([k]),
                    claim=claim_ref(FP_COMPLETE_B, ["checker::ShapeRuleEngine/relations.complete-calls"], "normal"),
                    subject=FP_COMPLETE_B, counterexample=cx, exploited=True, final=False, binding=b,
                    dischargers=[dis("revert", "author", True), dis("answer", "judges", False, [CTIM])],
                    causes=[{"type": "base-claim", "id": FP_COMPLETE_B}])
    rows = [{"question": "L3", "subject": FP_COMPLETE_B, "answer": "loosened", "exploited": True, "final": False,
             "affected": aff, "counterexample": cx, "obligation": k}]
    h = ex4_health(declaredOnly=[declared_only(FP_REL, "normal", "contradiction-only"),
                                 declared_only(FP_CYC, "normal", "contradiction-only"),
                                 declared_only(FP_COMPLETE_H, "normal", "contradiction-only"),
                                 declared_only(FP_REL_SD, "normal", "contradiction-only")])
    return output(mode="change", inputDigest=input_digest(i), verdict="blocked", obligations=[c, l3], loosening=rows,
                  order="looser", preexisting=[{"obligation": c["key"], "owner": CSMN}],
                  budget={"limit": None, "used": 1, "overflow": []}, health=h)


BUILD = {
    "ex1-audit": ex1_audit, "ex1-empty-base": ex1_empty_base, "ex1-A": ex1_A,
    "ex1-B": lambda n: ex1_B(n), "ex1-B-weak-observer": lambda n: ex1_B(n, weak=True), "ex1-Bprime": ex1_Bprime,
    "ex1-Bsecond": ex1_Bsecond, "ex1-C": ex1_C, "ex1-C-answered": ex1_C_answered,
    "ex2": ex2, "ex2-approve-only": ex2_approve_only, "ex2-exception-approve": ex2_exception_approve,
    "ex3-step1": ex3_step1, "ex3-step1-judged": ex3_step1_judged, "ex3-step2": ex3_step2,
    "ex3-step2-harness-edited": ex3_step2_harness_edited, "ex3-step2-record-dropped": ex3_step2_record_dropped,
    "ex3-step2-refactor-sensitive-removed": ex3_step2_refactor_sensitive_removed,
    "ex3-step2-seeded-clock": ex3_step2_seeded_clock, "ex4": ex4, "ex4-closing-the-set": ex4_closing,
}

if __name__ == "__main__":
    for name in sorted(BUILD):
        out = BUILD[name](name)
        check_groups(out, {V.out["group ex1.C"]: [V.out["key ex1.C.forbid"], V.out["key ex1.C.authority"]]}
                     if name == "ex1-C-answered" else None)
        with open(os.path.join(OUT, name + ".output.json"), "wb") as f:
            f.write(serialise(out))
        print(name, out["verdict"], len(out["obligations"]), "obligations", out["inputDigest"][:23])
