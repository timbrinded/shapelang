"""Spec-lawyer attacks against the Shape 1.0 Lean kernel (shapek).

Each attack has a control and one or more attack variants, written as shape.kernel.case/v1
files under ./cases/, run through shapek, and summarised in ./kernel-results.json.
Two-phase variants run phase 1 first, read the binding of the target obligation, then add
review lines (phase 2), as A.7.6.3 describes.

Run: python3 -I kattack.py [path/to/shapek]
Builders follow experiments/shape-1/kernel/test/gen_cases.py (copied, no vectors.py dependency)."""
import copy
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cases")
os.makedirs(OUT, exist_ok=True)
SHAPEK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "kernel", ".lake", "build", "bin", "shapek")


def label(s):
    return "sha256:" + hashlib.sha256(s.encode("utf-8")).hexdigest()


def jcs(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def H(x):
    return "sha256:" + hashlib.sha256(jcs(x).encode("utf-8")).hexdigest()


def claim_fp(op, args):
    return H({"v": "shape.claim.v1", "op": op, "args": args})


STD_EFFECTS = [
    {"verb": "Read", "implies": []}, {"verb": "Write", "implies": []},
    {"verb": "Export", "implies": ["Read"]}, {"verb": "Append", "implies": ["Write"]},
    {"verb": "Import", "implies": ["Write"]}, {"verb": "Update", "implies": ["Write"]},
    {"verb": "Redact", "implies": ["Update"]}, {"verb": "LogicalDelete", "implies": ["Update"]},
    {"verb": "HardDelete", "implies": ["Update"]}, {"verb": "Truncate", "implies": ["HardDelete"]},
    {"verb": "DropStorage", "implies": ["Truncate"]}, {"verb": "Hatch", "implies": []},
]
HATCH_KINDS = {"external_body": "verus", "external": "verus", "assume": "verus", "admit": "verus",
               "assume_specification": "verus", "uninterp": "verus", "axiom": "verus", "unsafe": "bend",
               "ts_ignore": "ts"}
STD_HATCHES = [{"kind": k, "lang": l} for k, l in HATCH_KINDS.items()]
STD_KINDS = [{"name": "calls", "from": "component", "to": "component"},
             {"name": "callbacks", "from": "component", "to": "component"},
             {"name": "provides", "from": "component", "to": "resource"},
             {"name": "data_flow", "from": "component", "to": "component"},
             {"name": "coordinated_call", "from": "component", "to": "component"}]
NOW = "2026-10-25T12:00:00Z"
REFACTOR_TEXT = "Changes to this unit preserve the constraint recorded in its memory note."


def tierpol(floor, blocks, max_age, judges):
    return {"floor": floor, "blocks": list(blocks), "maxAge": max_age, "judges": list(judges)}


def policy(low=None, normal=None, critical=None, budget=None):
    d = {"tiers": {"low": low or tierpol("declared", [], 365, ["owner", "agents"]),
                   "normal": normal or tierpol("declared", ["latent-loosening"], 365, ["owner", "agents"]),
                   "critical": critical or tierpol("tested", ["unestablished", "coverage", "latent-loosening"], 90, ["owner"])}}
    if budget is not None:
        d["budget"] = budget
    return d


def esf(q, owner, actors, resources=(), components=(), units=(), claims=(), providers=(), exceptions=(), pol=None):
    d = {"v": "shape.elaborated.v1", "shape": {"q": q, "owner": owner, "policy": "std::DefaultPolicy"},
         "actors": list(actors), "effects": STD_EFFECTS, "kinds": STD_KINDS, "hatches": STD_HATCHES,
         "resources": list(resources), "components": list(components), "units": list(units),
         "claims": list(claims), "templates": [], "exceptions": list(exceptions), "notes": [],
         "providers": list(providers), "errors": []}
    if pol is not None:
        d["policy"] = pol
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


def comp(q, paths, owner, grants=None, tier="normal", boundary=False, allows=()):
    return {"q": q, "boundary": boundary, "owner": owner, "tier": tier, "paths": list(paths), "grants": grants,
            "allows": list(allows), "assumes": [], "complete": [], "was": None, "units": [], "attach": []}


def unit(q, comp_q, name, owner, tier="normal", bind=None):
    return {"q": q, "component": comp_q, "name": name, "owner": owner, "tier": tier, "bind": bind, "was": None,
            "summary": None, "attach": []}


def res(q, owner, bind, tier="normal"):
    return {"q": q, "owner": owner, "tier": tier, "bind": list(bind), "was": None, "attach": []}


def entry(id_, proj, digest, kind="symbol", parent=None, markers=None, scheme=None):
    e = {"id": id_, "projection": proj, "scheme": scheme or (id_.split(":")[0] + "." + proj + ".v2"),
         "digest": digest, "kind": kind, "parent": parent}
    if markers:
        e["markers"] = markers
    return e


def fn_entries(fid, tag, projs=("unit", "own"), markers=None, extra=None):
    """A function identity under its file, with tag-dependent digests per projection."""
    f = fid.split("#")[0]
    out = []
    for p in projs:
        d = (extra or {}).get(p, label(fid + " " + p + ", " + tag))
        out.append(entry(fid, p, d, parent=f, markers=markers if p == "own" else None))
    return out


def file_entries(fid, tag, kind="file", scheme_lang=None):
    lang = scheme_lang or fid.split(":")[0]
    return [entry(fid, "file", label(fid + " file, " + tag), kind=kind, scheme=lang + ".file.v1"),
            entry(fid, "own", label(fid + " own, " + tag), kind=kind, scheme=lang + ".own.v1")]


def manifest(rev, entries):
    return {"_type": "https://in-toto.io/Statement/v1", "subject": [], "predicateType": "https://shapelang.dev/manifest/v1",
            "predicate": {"shape": {"v": "shape.manifest.v1", "revision": rev, "tree": [], "entries": entries}}}


def record(block, authenticated=True):
    return {"_type": "https://in-toto.io/Statement/v1", "subject": [], "predicateType": "https://shapelang.dev/evidence/v1",
            "predicate": {"shape": dict({"v": "shape.evidence.v1"}, **block)}, "authenticated": authenticated}


def cite(id_, proj, digest):
    return {"id": id_, "projection": proj, "scheme": id_.split(":")[0] + "." + proj + ".v2", "digest": digest}


def ent(id_, proj, digest, complete=True):
    return {"id": id_, "projection": proj, "scheme": id_.split(":")[0] + "." + proj + ".v2", "digest": digest,
            "complete": complete, "deps": []}


def dig(man, id_, proj):
    for e in man["predicate"]["shape"]["entries"]:
        if e["id"] == id_ and e["projection"] == proj:
            return e["digest"]
    raise KeyError((id_, proj))


def case(head_esf, head_man, head_rev, base_esf=None, base_man=None, base_rev="b0", records=(), base_records=(),
         authors=(), change_ids=("github:acme/x#1",), cells=(), mode="change", now=NOW, reviews=()):
    return {"contract": "shape.kernel.case/v1", "mode": mode, "now": now, "change": {"ids": list(change_ids)},
            "authors": list(authors),
            "head": {"revision": head_rev, "esf": head_esf, "manifest": head_man},
            "base": None if base_esf is None else {"revision": base_rev, "esf": base_esf, "manifest": base_man},
            "cells": [list(c) for c in cells], "records": list(records), "baseRecords": list(base_records),
            "reviews": list(reviews)}


def run(name, c):
    path = os.path.join(OUT, name + ".json")
    with open(path, "w") as f:
        json.dump(c, f, indent=1, sort_keys=True)
    p = subprocess.run([SHAPEK, path], capture_output=True, text=True)
    try:
        out = json.loads(p.stdout)
    except json.JSONDecodeError:
        out = {"verdict": "PARSE-ERROR", "raw": p.stdout[:400] + p.stderr[:400]}
    with open(os.path.join(OUT, name + ".out.json"), "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    return p.returncode, out


def find_ob(out, **kw):
    for o in out.get("obligations", []):
        if all((o.get(k) == v) if not callable(v) else v(o.get(k)) for k, v in kw.items()):
            return o
    return None


def summarize(rc, out):
    obs = [{k: o.get(k) for k in ("kind", "reason", "severity", "tier", "force", "introduced", "exception", "subject",
                                   "exploited")} | {"claim": (o.get("claim") or {}).get("ids"),
                                                     "binding": o.get("binding", "")[:19]}
           for o in out.get("obligations", [])]
    return {"exit": rc, "verdict": out.get("verdict"), "errors": out.get("errors"), "obligations": obs,
            "answered": out.get("answered"), "debt": out.get("debt")}


RESULTS = {}


def record_result(attack, variant, name, c):
    rc, out = run(name, c)
    RESULTS.setdefault(attack, {})[variant] = dict(summarize(rc, out), case=os.path.relpath(os.path.join(OUT, name + ".json"), HERE))
    return rc, out


def review(actor_q, line, change="github:acme/x#1"):
    return {"actor": actor_q, "line": line, "change": change}


# =============================================================================
# Shared Example-3-like fixture: one CLI unit with a guard law (RefactorSensitive)
# =============================================================================
T = "tooling::"
K = "checker::"
ISO = "ts:packages/shp-cli/src/freshness.ts#isoToday"
ISO_F = "ts:packages/shp-cli/src/freshness.ts"
OWN = T + "ShapeMaintainers"


def actors3(team=("tim",), extra=()):
    a = [actor(OWN, "team", [T + m for m in team])] + [actor(T + m, "person") for m in sorted(set(team) | {"tim"})]
    a += [actor(T + "claude", "agent", operator=T + "tim")]
    a += list(extra)
    return a


CLI = comp(T + "ShpCli", ["packages/shp-cli/src/**/*.ts"], OWN)
UNIT_ISO = unit(T + "ShpCli.isoToday", T + "ShpCli", "isoToday", OWN, bind=ISO)


def guard_law(tier="normal"):
    return claim(["tooling::ShpCli.isoToday/RefactorSensitive/law"], "law",
                 {"on": ["unit tooling::ShpCli.isoToday"], "statement": {"text": REFACTOR_TEXT}}, OWN, tier,
                 req("none", judged=True))


GUARD_ID = "tooling::ShpCli.isoToday/RefactorSensitive/law"
GUARD_FP = claim_fp("law", guard_law()["args"])
RELAY = prov(T + "reviews", ["judgment"], identity='sigstore("relay")', digest="sha256:relay")


def iso_man(rev, tag):
    return manifest(rev, file_entries(ISO_F, "f") + fn_entries(ISO, tag))


def tim_judgment(man):
    return record({"kind": "judgment", "result": "supports", "provider": {"id": T + "reviews", "version": "1.0.0"},
                   "revision": "b3", "time": "2026-09-01T10:00:00Z", "claim": {"id": GUARD_ID, "fp": GUARD_FP},
                   "code": [cite(ISO, "unit", dig(man, ISO, "unit"))], "judge": T + "tim"})


AUTH3 = [T + "claude", T + "tim"]

# -----------------------------------------------------------------------------
# A1: narrowing `judges` in the head (a tightening by A.6.2.6 and L7) enables the
#     self fallback, so the author approves their own loosening / judges their own guard.
# -----------------------------------------------------------------------------
BOB = actor(T + "bob", "person")
base_pol_a1 = policy(normal=tierpol("declared", ["latent-loosening"], 365, ["owner", "agents", T + "bob"]),
                     critical=tierpol("tested", ["unestablished", "coverage", "latent-loosening"], 90, ["owner", T + "bob"]))
head_pol_a1 = policy()  # std DefaultPolicy values: owner, agents / owner
mb = iso_man("b3", "base")
mh = iso_man("h3", "head")
# (a) L4: removing the guard law is a latent loosening, blocking at normal; tim approves.
sb = esf(T + "Shape", OWN, actors3(extra=[BOB]), [], [CLI], [UNIT_ISO], [guard_law()], [RELAY], pol=base_pol_a1)
for variant, hp in [("control_head_policy_unchanged", base_pol_a1), ("attack_head_narrows_judges", head_pol_a1)]:
    sh = esf(T + "Shape", OWN, actors3(extra=[BOB]), [], [CLI], [UNIT_ISO], [], [RELAY], pol=hp)
    c = case(sh, mb, "b3", sb, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3)
    rc, out = run("A1a_" + variant + "_phase1", c)
    ob = find_ob(out, kind="loosening")
    c["reviews"] = [review(T + "tim", "shape approve " + ob["binding"][:19])]
    record_result("A1a_judges_narrowing_L4", variant, "A1a_" + variant, c)
# (b) critical guard on an edited unit; tim writes `shape judge`.
sb = esf(T + "Shape", OWN, actors3(extra=[BOB]), [], [CLI], [UNIT_ISO], [guard_law("critical")], [RELAY], pol=base_pol_a1)
for variant, hp in [("control_head_policy_unchanged", base_pol_a1), ("attack_head_narrows_judges", head_pol_a1)]:
    sh = esf(T + "Shape", OWN, actors3(extra=[BOB]), [], [CLI], [UNIT_ISO], [guard_law("critical")], [RELAY], pol=hp)
    c = case(sh, mh, "h3", sb, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3,
             reviews=[review(T + "tim", "shape judge " + GUARD_ID)])
    record_result("A1b_judges_narrowing_guard", variant, "A1b_" + variant, c)

# (c) exception + exception answer by the author after narrowing (seeded clock, Example 3 step 2).
CF = "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness"
CF_F = "ts:packages/shp-checker/src/checker/rules/guards.ts"
CLOCK = res(T + "SystemClock", OWN, ['ts.call("Date.now")', 'ts.call("Date")', 'ts.call("performance.now")',
                                     'ts.call("process.hrtime")'])
SOURCE = res(T + "ShapeSource", OWN, [])
RULE_ENGINE = comp(K + "ShapeRuleEngine", ["packages/shp-checker/src/checker/rules/**/*.ts"], OWN,
                   grants=["Read<tooling::ShapeSource>"])


def clock_rule(tier="critical", extra_except=()):
    return claim(["tooling::CheckerNeverReadsClock"], "effect.forbid",
                 {"atom": "Read<tooling::SystemClock>", "scope": ["component checker::ShapeRuleEngine"],
                  "except": list(extra_except)}, OWN, tier)


AUTH_RE = claim(["checker::ShapeRuleEngine/authority"], "authority",
                {"component": K + "ShapeRuleEngine", "grants": ["Read<tooling::ShapeSource>"]}, OWN, "normal")
CLOCK_PATHS = ["tools/clock-scan.ts", "tsconfig.json", "package.json", "bun.lock"]


def clock_prov(identity='sigstore("clock")'):
    return prov(T + "tsClockScan", ["observation"],
                observes=['effect(ts.call("Date.now"))', 'effect(ts.call("Date"))', 'effect(ts.call("performance.now"))',
                          'effect(ts.call("process.hrtime"))'], presence=True, absence=True, identity=identity,
                paths=CLOCK_PATHS)


def cf_man(rev, tag, scan_tag="scan-base"):
    return manifest(rev, file_entries(CF_F, tag) + fn_entries(CF, tag) + file_entries("ts:tools/clock-scan.ts", scan_tag))


def clock_obs(rev, man, facts, authenticated=True):
    return record({"kind": "observation", "result": "observes", "provider": {"id": T + "tsClockScan", "version": "1"},
                   "revision": rev, "time": "2026-10-25T10:00:00Z",
                   "scope": {"root": "x", "entries": [ent(CF, "unit", dig(man, CF, "unit")),
                                                      ent(CF_F, "file", dig(man, CF_F, "file"))]},
                   "facts": facts, "harness": []}, authenticated)


DATE_NOW = {"type": "effect", "at": CF, "verb": "Read", "resource": 'ts.call("Date.now")'}
EXC_COMP = {"q": T + "ClockComp", "waives": ["contradiction"], "target": {"kind": "component", "q": K + "ShapeRuleEngine"},
            "for": None, "owner": OWN, "expires": "2026-12-01T00:00:00Z"}
mb4 = cf_man("b4", "base")
mh4 = cf_man("h4", "head")
for variant, hp in [("control_head_policy_unchanged", base_pol_a1), ("attack_head_narrows_judges", head_pol_a1)]:
    sb = esf(T + "Shape", OWN, actors3(extra=[BOB]), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE],
             [RELAY, clock_prov()], pol=base_pol_a1)
    sh = esf(T + "Shape", OWN, actors3(extra=[BOB]), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE],
             [RELAY, clock_prov()], exceptions=[EXC_COMP], pol=hp)
    c = case(sh, mh4, "h4", sb, mb4, "b4", records=[clock_obs("h4", mh4, [DATE_NOW])], authors=AUTH3)
    rc, out = run("A1c_" + variant + "_phase1", c)
    ob = find_ob(out, kind="contradiction")
    c["reviews"] = [review(T + "tim", "shape approve " + ob["binding"][:19])]
    record_result("A1c_judges_narrowing_exception_answer", variant, "A1c_" + variant, c)

# -----------------------------------------------------------------------------
# A2: producer-changed masks `assumption` (and `missing`): the only answerable law reason.
# -----------------------------------------------------------------------------
I = "ironkv::"
SET = "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set"
SET_F = "verus:ironkv/src/delegation_map_v.rs"
INSERT = "verus:ironkv/src/delegation_map_v.rs#StrictlyOrderedVec::insert"
ACTORS2 = [actor(I + "IronKvTeam", "team", [I + "dana", I + "erin"]), actor(I + "dana", "person"),
           actor(I + "erin", "person"), actor(I + "agent", "agent", operator=I + "erin")]
AUTH2 = [I + "agent", I + "erin"]


def dmap(boundary=False, allows=()):
    return comp(I + "DelegationMap", ["ironkv/src/delegation_map_v.rs"], I + "IronKvTeam", tier="critical",
                boundary=boundary, allows=allows)


UNITS2 = [unit(I + "DelegationMap.set", I + "DelegationMap", "set", I + "IronKvTeam", "critical", bind=SET)]


def law_set(tier="critical"):
    return claim(["ironkv::SetRefinesSpec"], "law", {"on": ["unit ironkv::DelegationMap.set"],
                                                     "statement": {"ref": SET, "projection": "closure"}},
                 I + "IronKvTeam", tier, req("proven", pins=[I + "verus"]))


LAW_SET_FP = claim_fp("law", law_set()["args"])
assert LAW_SET_FP.startswith("sha256:60a867af53d80a7f"), LAW_SET_FP  # vectors.py value


def verus_prov():
    return prov(I + "verus", ["proof"], decides=["statements verus"], presence=True, deps=True, identity='sigstore("verus")',
                trusts=[("z3", "4.12.5"), ("verus", "dccae1d")], paths=["ironkv/Cargo.toml", "ironkv/Cargo.lock"])


def man2(rev, tag, set_markers=None, lock_tag="lock-base", closure_tag="closure", contract_tag="contract"):
    e = file_entries(SET_F, tag)
    e += [entry(SET, "unit", label("set unit " + tag), parent=SET_F),
          entry(SET, "own", label("set own " + tag), parent=SET_F, markers=set_markers),
          entry(SET, "contract", label("set " + contract_tag), parent=SET_F, scheme="verus.contract.vir.v2"),
          entry(SET, "closure", label("set " + closure_tag), parent=SET_F, scheme="verus.closure.vir.v2"),
          entry(INSERT, "unit", label("insert unit"), parent=SET_F), entry(INSERT, "own", label("insert own"), parent=SET_F),
          entry(INSERT, "contract", label("insert contract"), parent=SET_F, scheme="verus.contract.vir.v2")]
    e += file_entries("raw:ironkv/Cargo.toml", "toml", scheme_lang="raw") + file_entries("raw:ironkv/Cargo.lock", lock_tag, scheme_lang="raw")
    return manifest(rev, e)


def proof_rec(man, rev, assumptions=None):
    return record({"kind": "proof", "result": "supports", "provider": {"id": I + "verus", "version": "dccae1d"},
                   "revision": rev, "time": "2026-10-25T10:00:00Z", "claim": {"id": "ironkv::SetRefinesSpec", "fp": LAW_SET_FP},
                   "code": [cite(SET, "unit", dig(man, SET, "unit")), cite(SET, "closure", dig(man, SET, "closure"))],
                   "deps": [cite(INSERT, "contract", label("insert contract"))], "harness": [],
                   "assumptions": assumptions if assumptions is not None else
                   [{"id": SET + "/assume", "kind": "hatch"}, {"id": "z3@4.12.5", "kind": "tool"}, {"id": "verus@dccae1d", "kind": "tool"}],
                   "counterexample": None})


for tier in ["critical", "final"]:
    for variant, lock in [("control_no_lockfile_edit", "lock-base"), ("attack_lockfile_bumped", "lock-head")]:
        s2 = esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], [dmap()], UNITS2, [law_set(tier)], [verus_prov()])
        mb2 = man2("b2", "base")
        mh2 = man2("h2", "head", set_markers={"assume": 1}, lock_tag=lock)
        c = case(s2, mh2, "h2", s2, mb2, "b2", records=[proof_rec(mh2, "h2")], authors=AUTH2,
                 change_ids=["github:acme/ironkv#12"])
        rc, out = run("A2a_%s_%s_phase1" % (tier, variant), c)
        ob = find_ob(out, kind="unestablished")
        c["reviews"] = [review(I + "dana", "shape approve " + ob["binding"][:19], change="github:acme/ironkv#12")]
        record_result("A2a_pc_masks_assumption_" + tier, variant, "A2a_%s_%s" % (tier, variant), c)

# A2b: a critical schema law whose authenticated decider timed out (inconclusive: counts as
#      supplied for E-provider-missing, gives `missing`); the agent adds a head-only provider
#      whose implementation globs the changed code and a supporting record.
CHECK = "ts:packages/shp-checker/src/checker/check.ts#checkShapeModules"
CHECK_F = "ts:packages/shp-checker/src/checker/check.ts"
DET_SCHEMA = "sha256:5dd1f7b8369f9557a9403b64a20f9d62e456c9960127a258755161b56e21d3e0"
SHAPE_CHECKER = comp(K + "ShapeChecker", ["packages/shp-checker/src/**/*.ts"], OWN, tier="critical")
UNIT_CHECK = unit(K + "ShapeChecker.checkShapeModules", K + "ShapeChecker", "checkShapeModules", OWN, "critical", bind=CHECK)
LAW_DET = claim(["tooling::CheckIsDeterministic"], "law",
                {"on": ["unit checker::ShapeChecker.checkShapeModules"],
                 "statement": {"schema": "std::Deterministic", "schemaFp": DET_SCHEMA, "args": ["unit checker::ShapeChecker.checkShapeModules"]}},
                OWN, "critical", req("tested", pins=[]))
LAW_DET_FP = claim_fp("law", LAW_DET["args"])
BUNTEST = prov(T + "bunTest", ["test"], decides=["template std::Deterministic"], presence=True, identity='sigstore("bun")',
               paths=["bunfig.toml", "package.json", "bun.lock"])
FAKE = prov(T + "quickCheck", ["test"], decides=["template std::Deterministic"], presence=False, identity=None,
            paths=["packages/shp-checker/src/**"])
ANN = actor(T + "ann", "person")


def check_man(rev, tag):
    return manifest(rev, file_entries(CHECK_F, tag) + fn_entries(CHECK, tag))


def test_rec(provider, man, rev, result, authenticated=True):
    return record({"kind": "test", "result": result, "provider": {"id": provider, "version": "1"}, "revision": rev,
                   "time": "2026-10-25T10:00:00Z", "claim": {"id": "tooling::CheckIsDeterministic", "fp": LAW_DET_FP},
                   "code": [cite(CHECK, "unit", dig(man, CHECK, "unit"))], "deps": [], "harness": [],
                   "assumptions": [], "counterexample": None}, authenticated)


mbc = check_man("b5", "base")
mhc = check_man("h5", "head")
for variant, extra_prov, extra_rec in [("control_timeout_only", [], []),
                                       ("attack_fake_headonly_provider", [FAKE], [test_rec(T + "quickCheck", mhc, "h5", "supports", False)])]:
    sb = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [], [SHAPE_CHECKER], [UNIT_CHECK], [LAW_DET], [BUNTEST])
    sh = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [], [SHAPE_CHECKER], [UNIT_CHECK], [LAW_DET], [BUNTEST] + extra_prov)
    c = case(sh, mhc, "h5", sb, mbc, "b5", records=[test_rec(T + "bunTest", mhc, "h5", "inconclusive")] + extra_rec,
             authors=AUTH3)
    rc, out = run("A2b_" + variant + "_phase1", c)
    ob = find_ob(out, kind="unestablished")
    c["reviews"] = [review(T + "ann", "shape approve " + ob["binding"][:19])]
    record_result("A2b_pc_masks_missing_fake_provider", variant, "A2b_" + variant, c)

# -----------------------------------------------------------------------------
# A3: two exceptions, each matching one excluding claim; the debt reports one expiry.
# -----------------------------------------------------------------------------
RULE_FP = claim_fp("effect.forbid", clock_rule()["args"])
AUTH_FP = claim_fp("authority", AUTH_RE["args"])
X_LONG = {"q": T + "AaaRuleWaiver", "waives": ["contradiction"], "target": {"kind": "claim", "fps": [RULE_FP]},
          "for": None, "owner": OWN, "expires": "2027-09-01T00:00:00Z"}
X_SHORT = {"q": T + "ZzzAuthorityWaiver", "waives": ["contradiction"], "target": {"kind": "claim", "fps": [AUTH_FP]},
           "for": None, "owner": OWN, "expires": "2026-10-30T00:00:00Z"}
mh4u = cf_man("h4", "base")  # code unchanged: the drift is preexisting
for variant, now in [("now_2026-10-25", NOW), ("now_2026-11-01_after_short_expiry", "2026-11-01T12:00:00Z")]:
    s = esf(T + "Shape", OWN, actors3(), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE],
            [RELAY, clock_prov()], exceptions=[X_LONG, X_SHORT])
    readme = file_entries("raw:README.md", "readme " + variant, scheme_lang="raw")
    hm = manifest("h4", mh4u["predicate"]["shape"]["entries"] + readme)
    bm = manifest("b4", mh4u["predicate"]["shape"]["entries"] + file_entries("raw:README.md", "readme base", scheme_lang="raw"))
    c = case(s, hm, "h4", s, bm, "b4", records=[clock_obs("h4", hm, [DATE_NOW])],
             base_records=[clock_obs("b4", bm, [DATE_NOW])], authors=AUTH3, now=now)
    record_result("A3_two_exceptions_expiry", variant, "A3_" + variant, c)

# -----------------------------------------------------------------------------
# A4: coverage answer: the kernel checks only K's owner and final unmet claims' owners;
#     A.7.6.5 requires an eligible answer for each unmet claim's owner*.
# -----------------------------------------------------------------------------
X = "x::"
ACTORS4 = [actor(X + "StoreTeam", "team", [X + "kate"]), actor(X + "SecTeam", "team", [X + "sam"]),
           actor(X + "Platform", "team", [X + "alex"]), actor(X + "kate", "person"), actor(X + "sam", "person"),
           actor(X + "alex", "person"), actor(X + "bot", "agent", operator=X + "alex")]
LEDGER = res(X + "Ledger", X + "SecTeam", ['pg.table("ledger")'], tier="critical")
STORE = comp(X + "Store", ["src/store/**/*.ts"], X + "StoreTeam")
LEDGER_FORBID = claim(["x::LedgerIsAppendOnly"], "effect.forbid", {"atom": "HardDelete<x::Ledger>", "scope": ["*"], "except": []},
                      X + "SecTeam", "critical")
NEWF = "ts:src/store/purge.ts#purge"
mb_a4 = manifest("b6", file_entries("ts:src/store/a.ts", "a") + fn_entries("ts:src/store/a.ts#f", "a"))
mh_a4 = manifest("h6", mb_a4["predicate"]["shape"]["entries"] + file_entries("ts:src/store/purge.ts", "new") + fn_entries(NEWF, "new"))
s4 = esf(X + "Shop", X + "Platform", ACTORS4, [LEDGER], [STORE], [], [LEDGER_FORBID], [])
for variant, who in [("control_sam_only", X + "sam"), ("attack_kate_only", X + "kate")]:
    c = case(s4, mh_a4, "h6", s4, mb_a4, "b6", authors=[X + "bot", X + "alex"])
    rc, out = run("A4_" + variant + "_phase1", c)
    ob = find_ob(out, kind="coverage")
    c["reviews"] = [review(who, "shape approve " + ob["binding"][:19])]
    record_result("A4_coverage_unmet_claim_owner", variant, "A4_" + variant, c)

# -----------------------------------------------------------------------------
# A5: a final informal law is established by ONE judgment, from an agent if critical's
#     judges list agents (core §6.3: final needs two persons, no agent).
#     Also: a heuristic contradiction of a final forbid dismissed by an agent's answer.
# -----------------------------------------------------------------------------
pol_agents = policy(critical=tierpol("tested", ["unestablished", "coverage", "latent-loosening"], 90, ["owner", "agents"]))
REVIEWBOT = actor(T + "reviewBot", "agent", operator=T + "ann")
for variant, who in [("control_no_judgment", None), ("attack_one_agent_judges", T + "reviewBot"),
                     ("attack_one_person_judges", T + "ann")]:
    s = esf(T + "Shape", OWN, actors3(team=("tim", "ann"), extra=[REVIEWBOT]), [], [CLI], [UNIT_ISO], [guard_law("final")],
            [RELAY], pol=pol_agents)
    rv = [review(who, "shape judge " + GUARD_ID)] if who else []
    c = case(s, mh, "h3", s, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3, reviews=rv)
    record_result("A5a_final_informal_law_single_judge", variant, "A5a_" + variant, c)

FINAL_CLOCK = clock_rule("final")
for variant, who in [("control_no_answer", None), ("attack_agent_dismisses", T + "reviewBot")]:
    hprov = prov(T + "tsClockScan", ["observation"], observes=clock_prov()["observes"], presence=False, absence=True,
                 identity='sigstore("clock")', paths=CLOCK_PATHS)
    s = esf(T + "Shape", OWN, actors3(team=("tim", "ann"), extra=[REVIEWBOT]), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [],
            [FINAL_CLOCK], [RELAY, hprov], pol=pol_agents)
    c = case(s, mh4, "h4", s, mb4, "b4", records=[clock_obs("h4", mh4, [DATE_NOW])], authors=AUTH3)
    rc, out = run("A5b_" + variant + "_phase1", c)
    ob = find_ob(out, kind="contradiction")
    if who:
        c["reviews"] = [review(who, "shape approve " + ob["binding"][:19])]
    record_result("A5b_final_heuristic_agent_dismissal", variant, "A5b_" + variant, c)

# -----------------------------------------------------------------------------
# A6: rebinding the resource code of a final forbid's resource (kernel L1 keys atoms by Q).
# -----------------------------------------------------------------------------
A = "audit::"
ACTORS1 = [actor(A + "Platform", "team", [A + "alice", A + "carol"]), actor(A + "AuditTeam", "team", [A + "bob"]),
           actor(A + "alice", "person"), actor(A + "carol", "person"), actor(A + "bob", "person"),
           actor(A + "codeAgent", "agent", operator=A + "alice")]


def res1(bind='pg.table("audit_events")'):
    return {"q": A + "AuditEvent", "owner": A + "AuditTeam", "tier": "final", "bind": [bind], "was": None,
            "attach": ["std::AppendOnly"]}


def comp1(grants=("Append<audit::AuditEvent>", "Read<audit::AuditEvent>")):
    return comp(A + "AuditStore", ["src/audit/**/*.ts"], A + "AuditTeam", grants=list(grants), tier="critical")


C_APPENDONLY = claim(["audit::AuditEvent/AppendOnly/effect.forbid-HardDelete"], "effect.forbid",
                     {"atom": "HardDelete<audit::AuditEvent>", "scope": ["*"], "except": []}, A + "AuditTeam", "final")
BASE_GRANTS = ["Append<audit::AuditEvent>", "Read<audit::AuditEvent>"]
C_AUTH1 = claim(["audit::AuditStore/authority"], "authority", {"component": A + "AuditStore", "grants": sorted(BASE_GRANTS)},
                A + "AuditTeam", "critical")
SQL = prov(A + "sqlEffects", ["observation"], observes=['effect(pg.table("*"))'], presence=True, absence=True, deps=True,
           identity='sigstore("sql")', digest="sha256:sql-effects-2.3.1")
PURGE = "ts:src/audit/purge.ts#purgeOldEvents"
PURGE_F = "ts:src/audit/purge.ts"
STORE1 = "ts:src/audit/store.ts#appendEvent"
STORE1_F = "ts:src/audit/store.ts"
mb1 = manifest("b0", file_entries(STORE1_F, "s") + fn_entries(STORE1, "s"))
mh1 = manifest("h1", mb1["predicate"]["shape"]["entries"] + file_entries(PURGE_F, "p") + fn_entries(PURGE, "p"))


def sql_obs(rev, man, ids, facts):
    es = []
    for i in ids:
        es.append(ent(i, "unit" if "#" in i else "file", dig(man, i, "unit" if "#" in i else "file")))
    return record({"kind": "observation", "result": "observes", "provider": {"id": A + "sqlEffects", "version": "2.3.1"},
                   "revision": rev, "time": "2026-10-25T09:12:44Z", "scope": {"root": "x", "entries": es},
                   "facts": facts, "harness": [], "assumptions": []})


FACT_PURGE = {"type": "effect", "at": PURGE, "verb": "HardDelete", "resource": 'pg.table("public.audit_events")'}
FACT_APPEND = {"type": "effect", "at": STORE1, "verb": "Append", "resource": 'pg.table("public.audit_events")'}
CELLS1 = [["audit::AuditStore.*", "audit::AuditStore.*"], ["ungoverned", "ungoverned"]]
sb1 = esf(A + "AuditService", A + "Platform", ACTORS1, [res1()], [comp1()], [], [C_APPENDONLY, C_AUTH1], [SQL])
for variant, bind in [("control_binding_kept", 'pg.table("audit_events")'), ("attack_binding_moved", 'pg.table("audit_events_v2")')]:
    sh1 = esf(A + "AuditService", A + "Platform", ACTORS1, [res1(bind)], [comp1()], [], [C_APPENDONLY, C_AUTH1], [SQL])
    c = case(sh1, mh1, "h1", sb1, mb1, "b0", records=[sql_obs("h1", mh1, [PURGE_F, PURGE, STORE1_F, STORE1], [FACT_PURGE, FACT_APPEND])],
             base_records=[sql_obs("b0", mb1, [STORE1_F, STORE1], [FACT_APPEND])], authors=[A + "codeAgent", A + "alice"],
             cells=CELLS1, change_ids=["github:acme/audit#57"])
    record_result("A6_rebind_resource_code_final", variant, "A6_" + variant, c)

# -----------------------------------------------------------------------------
# A7: L3 counterexample order: the kernel's DFS finds a latent completing set first, so a
#     loosening realised by an observed edge is reported unexploited (low tier: owed).
# -----------------------------------------------------------------------------
Y = "y::"
ACTORS7 = [actor(Y + "Team", "team", [Y + "pat"]), actor(Y + "pat", "person"), actor(Y + "bot", "agent", operator=Y + "pat")]
COMPS7 = [comp(Y + n, ["src/%s/**/*.ts" % n.lower()], Y + "Team", tier="low") for n in ("A", "B", "C")]
PATH_AC = claim(["y::AdoesNotReachC"], "path.forbid", {"from": ["component y::A"], "to": ["component y::C"], "kinds": ["calls"],
                                                       "exceptVia": []}, Y + "Team", "low")
CALLS = prov(Y + "calls", ["observation"], observes=["call(ts)"], identity='sigstore("calls")', digest="sha256:calls")
FA, FC = "ts:src/a/a.ts#f", "ts:src/c/c.ts#g"
m7 = manifest("h7", file_entries("ts:src/a/a.ts", "a") + fn_entries(FA, "a") + file_entries("ts:src/c/c.ts", "c") + fn_entries(FC, "c")
              + file_entries("ts:src/b/b.ts", "b"))
def call_obs(facts):
    return record({"kind": "observation", "result": "observes", "provider": {"id": Y + "calls", "version": "1"}, "revision": "h7",
                   "time": "2026-10-25T10:00:00Z", "scope": {"root": "x", "entries": [ent(FA, "unit", dig(m7, FA, "unit"), complete=False)]},
                   "facts": facts, "harness": []})
sb7 = esf(Y + "S", Y + "Team", ACTORS7, [], COMPS7, [], [PATH_AC], [CALLS])
sh7 = esf(Y + "S", Y + "Team", ACTORS7, [], COMPS7, [], [], [CALLS])
for variant, recs in [("control_no_observed_edge", [call_obs([])]),
                      ("attack_observed_edge_A_to_C", [call_obs([{"type": "call", "at": FA, "to": FC}])])]:
    c = case(sh7, m7, "h7", sb7, m7, "h7", records=recs, authors=[Y + "bot", Y + "pat"])
    record_result("A7_L3_search_order_exploited", variant, "A7_" + variant, c)

# -----------------------------------------------------------------------------
# A8: base glob tie (E-overlap is head-only, so the base may have one): the kernel's L1 uses the
#     codepoint-least component, A.6.4.4 the strictest view; the verdict depends on names.
# -----------------------------------------------------------------------------
Z = "z::"
ACTORS8 = [actor(Z + "Team", "team", [Z + "pat"]), actor(Z + "pat", "person"), actor(Z + "bot", "agent", operator=Z + "pat")]
R8 = res(Z + "R", Z + "Team", ['pg.table("r")'], tier="critical")
m8 = manifest("h8", file_entries("ts:src/m.ts", "m") + fn_entries("ts:src/m.ts#f", "m"))
for variant, (lax, strict) in [("lax_component_sorts_first", ("z::Alpha", "z::Beta")),
                               ("strict_component_sorts_first", ("z::Beta", "z::Alpha"))]:
    lax_c = comp(lax, ["src/**/*.ts"], Z + "Team", grants=["Read<z::R>", "Write<z::R>"], tier="critical")
    strict_c = comp(strict, ["src/**/*.ts"], Z + "Team", grants=["Read<z::R>"], tier="critical")
    auth_lax = claim([lax + "/authority"], "authority", {"component": lax, "grants": ["Read<z::R>", "Write<z::R>"]}, Z + "Team", "critical")
    auth_strict = claim([strict + "/authority"], "authority", {"component": strict, "grants": ["Read<z::R>"]}, Z + "Team", "critical")
    sb8 = esf(Z + "S", Z + "Team", ACTORS8, [R8], [lax_c, strict_c], [], [auth_lax, auth_strict], [])
    sh8 = esf(Z + "S", Z + "Team", ACTORS8, [R8], [lax_c], [], [auth_lax], [])
    least = min(lax, strict)
    c = case(sh8, m8, "h8", sb8, m8, "h8", authors=[Z + "bot", Z + "pat"],
             cells=[[least + ".*", lax + ".*"], ["ungoverned", "ungoverned"]])
    record_result("A8_base_glob_tie_name_dependence", variant, "A8_" + variant, c)

# -----------------------------------------------------------------------------
# A9: an observer whose implementation the change edits (producer-changed) and that reports
#     nothing: at normal tier the only trace is owed coverage (no rule-8 analog for observers).
# A29: E-provider-missing for observers is met by any authenticated record, even one from
#     the base revision whose entries no longer match.
# -----------------------------------------------------------------------------
RE_NORMAL = dict(RULE_ENGINE)
for variant, scan_tag, recs in [
        ("control_scanner_reports", "scan-base", lambda m: [clock_obs("h4", m, [DATE_NOW])]),
        ("attack_scanner_edited_reports_nothing", "scan-head", lambda m: [clock_obs("h4", m, [])]),
        ("attack_only_base_revision_record", "scan-base", lambda m: [clock_obs("b4", mb4, [])]),
        ("control_scanner_edited_still_reports", "scan-head", lambda m: [clock_obs("h4", m, [DATE_NOW])])]:
    s = esf(T + "Shape", OWN, actors3(), [CLOCK, SOURCE], [CLI, RE_NORMAL], [], [clock_rule("normal"), AUTH_RE],
            [RELAY, clock_prov()])
    hm = cf_man("h4", "head", scan_tag=scan_tag)
    c = case(s, hm, "h4", s, mb4, "b4", records=recs(hm), authors=AUTH3)
    record_result("A9_A29_observer_silence_normal_tier", variant, "A9_" + variant, c)

# -----------------------------------------------------------------------------
# A10: `shape judge` review lines carry no revision or digest: the same line judges any push.
# -----------------------------------------------------------------------------
ANNTEAM = actors3(team=("tim", "ann"))
mh_push2 = iso_man("h3b", "head-push-2")
s = esf(T + "Shape", OWN, ANNTEAM, [], [CLI], [UNIT_ISO], [guard_law("critical")], [RELAY])
for variant, m, rev in [("push1_reviewed_by_ann", mh, "h3"), ("push2_never_reviewed", mh_push2, "h3b")]:
    c = case(s, m, rev, s, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3,
             reviews=[review(T + "ann", "shape judge " + GUARD_ID)])
    record_result("A10_judge_line_not_bound_to_revision", variant, "A10_" + variant, c)
# approve lines, by contrast, are bound: ann's approve of the push-1 L4 loosening does not act on push 2.
sb10 = esf(T + "Shape", OWN, ANNTEAM, [], [CLI], [UNIT_ISO], [guard_law()], [RELAY])
sh10 = esf(T + "Shape", OWN, ANNTEAM, [], [CLI], [UNIT_ISO], [], [RELAY])
c1 = case(sh10, mh, "h3", sb10, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3)
rc, out = run("A10_approve_push1_phase1", c1)
bd = find_ob(out, kind="loosening")["binding"][:19]
c2 = case(sh10, mh_push2, "h3b", sb10, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3,
          reviews=[review(T + "ann", "shape approve " + bd)])
record_result("A10_judge_line_not_bound_to_revision", "control_approve_line_push2", "A10_approve_push2", c2)

# -----------------------------------------------------------------------------
# A11: a law with empty Req is "attributed to" every component (Req ⊆ code(K) vacuously).
# -----------------------------------------------------------------------------
EMPTY = comp(T + "Empty", ["nothing/**/*.ts"], OWN)
EMPTY_LAW = claim(["tooling::EmptyDocumented"], "law", {"on": ["component tooling::Empty"], "statement": {"text": "Documented."}},
                  OWN, "normal", req("none", judged=True))
X_OTHER = {"q": T + "CliWaiver", "waives": ["unestablished"], "target": {"kind": "component", "q": T + "ShpCli"},
           "for": [{"kind": "sel", "sel": "component tooling::ShpCli"}], "owner": OWN, "expires": "2026-12-01T00:00:00Z"}
s = esf(T + "Shape", OWN, actors3(), [], [CLI, EMPTY], [UNIT_ISO], [EMPTY_LAW], [RELAY], exceptions=[X_OTHER])
c = case(s, mb, "b3", s, mb, "b3", authors=AUTH3)
record_result("A11_empty_req_vacuous_exception", "attack_cli_exception_matches_empty_component_law", "A11_attack", c)

# -----------------------------------------------------------------------------
# A12: policy* judges are intersected as strings: a semantically narrower head list
#      (a named member of the owner team) is an L7 loosening that nobody can answer.
# -----------------------------------------------------------------------------
pol_b12 = policy(normal=tierpol("declared", ["latent-loosening"], 365, ["owner"]))
pol_h12 = policy(normal=tierpol("declared", ["latent-loosening"], 365, [T + "ann"]))
for variant, hp in [("control_unchanged", pol_b12), ("attack_judges_owner_to_member", pol_h12)]:
    sb = esf(T + "Shape", OWN, ANNTEAM, [], [CLI], [UNIT_ISO], [], [RELAY], pol=pol_b12)
    sh = esf(T + "Shape", OWN, ANNTEAM, [], [CLI], [UNIT_ISO], [], [RELAY], pol=hp)
    c = case(sh, mb, "b3", sb, mb, "b3", authors=AUTH3)
    rc, out = run("A12_" + variant + "_phase1", c)
    ob = find_ob(out, kind="loosening")
    if ob:
        c["reviews"] = [review(T + "ann", "shape approve " + ob["binding"][:19])]
    record_result("A12_judges_string_intersection", variant, "A12_" + variant, c)

# -----------------------------------------------------------------------------
# A13: named judges satisfy the final two-person rule without belonging to the item owner
#      or the shape owner; the owners themselves can no longer answer.
# -----------------------------------------------------------------------------
DAVE, ERIN = actor(A + "dave", "person"), actor(A + "erin", "person")
pol13 = policy(critical=tierpol("tested", ["unestablished", "coverage", "latent-loosening"], 90, [A + "dave", A + "erin"]))
headC = esf(A + "AuditService", A + "Platform", ACTORS1 + [DAVE, ERIN],
            [dict(res1(), attach=[])], [comp1(BASE_GRANTS + ["HardDelete<audit::AuditEvent>"])],
            [unit(A + "AuditStore.purgeOldEvents", A + "AuditStore", "purgeOldEvents", A + "AuditTeam", "critical")],
            [claim(["audit::AuditStore/authority"], "authority", {"component": A + "AuditStore",
                   "grants": sorted(BASE_GRANTS + ["HardDelete<audit::AuditEvent>"])}, A + "AuditTeam", "critical")], [SQL], pol=pol13)
baseC = esf(A + "AuditService", A + "Platform", ACTORS1 + [DAVE, ERIN], [res1()], [comp1()], [], [C_APPENDONLY, C_AUTH1], [SQL], pol=pol13)
cC = case(headC, mh1, "h1", baseC, mb1, "b0", records=[sql_obs("h1", mh1, [PURGE_F, PURGE, STORE1_F, STORE1], [FACT_PURGE, FACT_APPEND])],
          base_records=[sql_obs("b0", mb1, [STORE1_F, STORE1], [FACT_APPEND])], authors=[A + "codeAgent", A + "alice"],
          cells=CELLS1, change_ids=["github:acme/audit#57"])
rc, out = run("A13_phase1", cC)
refs = [o["binding"][:19] for o in out["obligations"] if o["kind"] == "loosening"]
for variant, who in [("owners_bob_and_carol_answer", [A + "bob", A + "carol"]), ("outsiders_dave_and_erin_answer", [A + "dave", A + "erin"])]:
    c = copy.deepcopy(cC)
    c["reviews"] = [review(w, "shape approve " + " ".join(refs), change="github:acme/audit#57") for w in who]
    record_result("A13_named_judges_final_two_person", variant, "A13_" + variant, c)

# -----------------------------------------------------------------------------
# A14: a hosted law's NF carries no closure digest; weakening the Verus spec keeps the fp, so
#      the kernel sees no L4 question (A.4.3.8 / A.8.2.3 L4: closure changes are undecided).
# -----------------------------------------------------------------------------
s14 = esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], [dmap()], UNITS2, [law_set()], [verus_prov()])
mb14 = man2("b2", "base")
for variant, ctag in [("control_spec_unchanged", "closure"), ("attack_spec_weakened", "closure weakened")]:
    mh14 = man2("h2", "head", closure_tag=ctag, contract_tag="contract" if ctag == "closure" else "contract weakened")
    c = case(s14, mh14, "h2", s14, mb14, "b2", records=[proof_rec(mh14, "h2", assumptions=[])], authors=AUTH2,
             change_ids=["github:acme/ironkv#12"])
    record_result("A14_hosted_law_closure_change", variant, "A14_" + variant, c)

# -----------------------------------------------------------------------------
# A34: phase 2 after the relay commits judgments: same manifest, new commit; revision-tied
#      test records are now "not at head" and stale.
# -----------------------------------------------------------------------------
s34 = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [], [SHAPE_CHECKER], [UNIT_CHECK], [LAW_DET], [BUNTEST])
for variant, rev in [("phase1_head_h5", "h5"), ("phase2_after_relay_commit_h5r", "h5r")]:
    c = case(s34, mhc, rev, s34, mbc, "b5", records=[test_rec(T + "bunTest", mhc, "h5", "supports")], authors=AUTH3)
    record_result("A34_relay_commit_stales_revision_tied_records", variant, "A34_" + variant, c)

# -----------------------------------------------------------------------------
# A38: a proof record's own hatch assumption (set/assume) is ignored when the manifest counts
#      no marker (e.g. a statement-position macro from a dependency).
# A39: "a final law is never satisfied through an assume" names one hatch kind: admit passes.
# -----------------------------------------------------------------------------
for variant, markers, assumptions in [
        ("control_manifest_marker", {"assume": 1}, None),
        ("attack_record_lists_hatch_manifest_silent", None, None)]:
    s = esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], [dmap()], UNITS2, [law_set()], [verus_prov()])
    mh38 = man2("h2", "head", set_markers=markers)
    c = case(s, mh38, "h2", s, man2("b2", "base"), "b2", records=[proof_rec(mh38, "h2", assumptions)], authors=AUTH2,
             change_ids=["github:acme/ironkv#12"])
    record_result("A38_record_hatch_assumption_ignored", variant, "A38_" + variant, c)
for variant, kind in [("control_assume_allowed_by_boundary", "assume"), ("attack_admit_allowed_by_boundary", "admit")]:
    s = esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], [dmap(boundary=True, allows=[kind])], UNITS2, [law_set("final")], [verus_prov()])
    mh39 = man2("h2", "head", set_markers={kind: 1})
    mb39 = man2("b2", "base", set_markers={kind: 1})
    c = case(s, mh39, "h2", s, mb39, "b2", records=[proof_rec(mh39, "h2", [{"id": SET + "/" + kind, "kind": "hatch"}])],
             authors=AUTH2, change_ids=["github:acme/ironkv#12"])
    record_result("A39_final_law_through_admit", variant, "A39_" + variant, c)

# -----------------------------------------------------------------------------
# A50: moving code out of a FINAL component into a low component with equal grants: no L1
#      change (Perm equal, no forbid levels), L6's tuples omit authority, coverage tier low.
# -----------------------------------------------------------------------------
W = "w::"
ACTORS50 = [actor(W + "Team", "team", [W + "pat", W + "quinn"]), actor(W + "pat", "person"), actor(W + "quinn", "person"),
            actor(W + "bot", "agent", operator=W + "pat")]
R50 = res(W + "Ledger", W + "Team", ['pg.table("ledger")'], tier="final")
VAULT = lambda paths: comp(W + "Vault", paths, W + "Team", grants=["Read<w::Ledger>"], tier="final")
SCRATCH = lambda paths: comp(W + "Scratch", paths, W + "Team", grants=["Read<w::Ledger>"], tier="low")
AUTH_V = claim(["w::Vault/authority"], "authority", {"component": W + "Vault", "grants": ["Read<w::Ledger>"]}, W + "Team", "final")
AUTH_S = claim(["w::Scratch/authority"], "authority", {"component": W + "Scratch", "grants": ["Read<w::Ledger>"]}, W + "Team", "low")
NEW50 = "ts:src/vault/purge/p.ts#purge"
mb50 = manifest("b9", file_entries("ts:src/vault/v.ts", "v") + fn_entries("ts:src/vault/v.ts#read", "v"))
mh50 = manifest("h9", mb50["predicate"]["shape"]["entries"] + file_entries("ts:src/vault/purge/p.ts", "p") + fn_entries(NEW50, "p"))
sb50 = esf(W + "S", W + "Team", ACTORS50, [R50], [VAULT(["src/vault/**/*.ts"]), SCRATCH(["src/scratch/**/*.ts"])], [], [AUTH_V, AUTH_S], [])
for variant, scratch_paths, cells in [
        ("control_new_code_stays_in_final_component", ["src/scratch/**/*.ts"],
         [["w::Vault.*", "w::Vault.*"], ["w::Scratch.*", "w::Scratch.*"], ["ungoverned", "ungoverned"]]),
        ("attack_glob_moves_new_code_to_low_component", ["src/scratch/**/*.ts", "src/vault/purge/**/*.ts"],
         [["w::Vault.*", "w::Vault.*"], ["w::Vault.*", "w::Scratch.*"], ["w::Scratch.*", "w::Scratch.*"], ["ungoverned", "ungoverned"]])]:
    sh50 = esf(W + "S", W + "Team", ACTORS50, [R50], [VAULT(["src/vault/**/*.ts"]), SCRATCH(scratch_paths)], [], [AUTH_V, AUTH_S], [])
    c = case(sh50, mh50, "h9", sb50, mb50, "b9", authors=[W + "bot", W + "pat"], cells=cells)
    record_result("A50_move_code_out_of_final_authority", variant, "A50_" + variant, c)

# -----------------------------------------------------------------------------
# NM: non-monotone exit from final drift. Base: final forbid with a preexisting sound
#     contradiction. (a) unrelated change: blocked by rule 2. (b) lower the forbid to critical
#     (same NF), two persons answer the final loosening: still blocked (tier* keeps final).
#     (c) remove the forbid, same two answers: owed. (d) perturb the NF at critical: owed.
# -----------------------------------------------------------------------------
ACT_NM = actors3(team=("tim", "ann", "bob"))
mbn = manifest("b4", mb4["predicate"]["shape"]["entries"] + file_entries("raw:README.md", "base", scheme_lang="raw"))
mhn = manifest("h4", mb4["predicate"]["shape"]["entries"] + file_entries("raw:README.md", "head", scheme_lang="raw"))
CELLS_NM = [["checker::ShapeRuleEngine.*", "checker::ShapeRuleEngine.*"], ["tooling::ShpCli.*", "tooling::ShpCli.*"],
            ["ungoverned", "ungoverned"]]
sbn = esf(T + "Shape", OWN, ACT_NM, [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule("final"), AUTH_RE], [RELAY, clock_prov()])
for variant, head_claims in [("a_unrelated_change", [clock_rule("final"), AUTH_RE]),
                             ("b_lower_to_critical_same_nf", [clock_rule("critical"), AUTH_RE]),
                             ("c_remove_forbid", [AUTH_RE]),
                             ("d_perturbed_nf_at_critical", [clock_rule("critical", ["component tooling::ShpCli"]), AUTH_RE])]:
    shn = esf(T + "Shape", OWN, ACT_NM, [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], head_claims, [RELAY, clock_prov()])
    c = case(shn, mhn, "h4", sbn, mbn, "b4", records=[clock_obs("h4", mhn, [DATE_NOW])],
             base_records=[clock_obs("b4", mbn, [DATE_NOW])], authors=AUTH3, cells=CELLS_NM)
    rc, out = run("NM_" + variant + "_phase1", c)
    refs = [o["binding"][:19] for o in out["obligations"] if o["kind"] == "loosening"]
    if refs:
        c["reviews"] = [review(T + w, "shape approve " + " ".join(refs)) for w in ("ann", "bob")]
    record_result("NM_final_drift_exit_non_monotone", variant, "NM_" + variant, c)

# -----------------------------------------------------------------------------
# HS: a heuristic contradiction answered (dismissed), then the head grants presence: the key
#     is the same (force is not in the key or binding), but the kernel recomputes answerability.
# -----------------------------------------------------------------------------
for variant, head_presence in [("phase1_heuristic_dismissed", False), ("phase2_head_declares_presence", True)]:
    pb = prov(T + "tsClockScan", ["observation"], observes=clock_prov()["observes"], presence=False, absence=True,
              identity='sigstore("clock")', paths=CLOCK_PATHS)
    ph = dict(pb, presence=head_presence)
    sb = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE], [RELAY, pb])
    sh = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE], [RELAY, ph])
    c0 = case(sb, mh4, "h4", sb, mb4, "b4", records=[clock_obs("h4", mh4, [DATE_NOW])], authors=AUTH3)
    rc, out = run("HS_phase1_probe", c0)
    bd = find_ob(out, kind="contradiction")["binding"][:19]
    c = case(sh, mh4, "h4", sb, mb4, "b4", records=[clock_obs("h4", mh4, [DATE_NOW])], authors=AUTH3,
             reviews=[review(T + "ann", "shape approve " + bd)])
    record_result("HS_heuristic_answer_survives_force_upgrade", variant, "HS_" + variant, c)

# -----------------------------------------------------------------------------
# D13: core §7.3 "a law obligation ... whose producer changed" vs A.7.3.3 "reason producer-changed":
#      a record that is stale (revision-tied, older revision) AND whose harness changed.
# DH:  a record whose harness digest no longer matches M_h, harness not in this change's delta
#      (kernel: usable; prototype: producer-changed).
# -----------------------------------------------------------------------------
HARN = "ts:packages/shp-checker/src/behavioural/determinism.test.ts"
def check_man2(rev, tag, harn_tag):
    return manifest(rev, file_entries(CHECK_F, tag) + fn_entries(CHECK, tag) + file_entries(HARN, harn_tag))
def test_rec2(man, rev, harn_digest):
    return record({"kind": "test", "result": "supports", "provider": {"id": T + "bunTest", "version": "1"}, "revision": rev,
                   "time": "2026-10-25T10:00:00Z", "claim": {"id": "tooling::CheckIsDeterministic", "fp": LAW_DET_FP},
                   "code": [cite(CHECK, "unit", dig(man, CHECK, "unit"))], "deps": [],
                   "harness": [{"id": HARN, "projection": "own", "scheme": "ts.own.v1", "digest": harn_digest}],
                   "assumptions": [], "counterexample": None})
s_d = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [], [SHAPE_CHECKER], [UNIT_CHECK], [LAW_DET], [BUNTEST])
mb_d = check_man2("b5", "same", "harness base")
mh_d = check_man2("h5", "same", "harness head")
s_d13 = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [], [SHAPE_CHECKER], [UNIT_CHECK], [LAW_DET], [dict(BUNTEST, identity=None)])
c = case(s_d13, mh_d, "h5", s_d13, mb_d, "b5", records=[test_rec2(mh_d, "b5", dig(mh_d, HARN, "own"))], authors=AUTH3)
record_result("D13_introduced_core_vs_annex", "stale_record_and_harness_edited", "D13_stale_and_pc", c)
s_dh = esf(T + "Shape", OWN, actors3(team=("tim", "ann")), [], [SHAPE_CHECKER], [UNIT_CHECK], [LAW_DET], [dict(BUNTEST, depsComplete=True)])
mh_dh = check_man2("h5", "same", "harness now")
mb_dh = check_man2("b5", "same", "harness now")
r_dh = test_rec2(mh_dh, "b5", label("harness older"))
r_dh["predicate"]["shape"]["deps"] = [cite(CHECK_F, "own", dig(mh_dh, CHECK_F, "own"))]
c = case(s_dh, mh_dh, "h5", s_dh, mb_dh, "b5", records=[r_dh], authors=AUTH3)
record_result("DH_stale_harness_digest", "harness_digest_mismatch_not_in_delta", "DH_harness_mismatch", c)

# -----------------------------------------------------------------------------
# OLD: the change rewrites an existing violating site (digest moves) into a worse one with the
#      same fact (verb, resource, n): not a new fact, so the critical contradiction is preexisting.
# VETO: a non-author agent eligible at normal writes `shape reject`: a sound blocking contradiction
#      that no answer or exception answer by the owner can clear in this change... except an exception.
# XF: an exception `for code <file>` does not cover a fact at a symbol in that file (kernel: exact id).
# -----------------------------------------------------------------------------
for variant, tag in [("unchanged_site", "base"), ("site_rewritten_same_fact", "head-worse")]:
    s_old = esf(T + "Shape", OWN, actors3(), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE], [RELAY, clock_prov()])
    hm = cf_man("h4", tag)
    c = case(s_old, hm, "h4", s_old, mb4, "b4", records=[clock_obs("h4", hm, [DATE_NOW])], base_records=[clock_obs("b4", mb4, [DATE_NOW])],
             authors=AUTH3)
    record_result("OLD_rewritten_violation_not_new", variant, "OLD_" + variant, c)
for variant, line in [("control_bot_judges", "shape judge " + GUARD_ID), ("attack_bot_rejects", "shape reject " + GUARD_ID + " no")]:
    s_v = esf(T + "Shape", OWN, actors3(team=("tim", "ann"), extra=[REVIEWBOT]), [], [CLI], [UNIT_ISO], [guard_law()], [RELAY])
    c = case(s_v, mh, "h3", s_v, mb, "b3", records=[tim_judgment(mb)], authors=AUTH3, reviews=[review(T + "reviewBot", line)])
    record_result("VETO_agent_reject_is_sound", variant, "VETO_" + variant, c)
for variant, subj in [("for_code_symbol", CF), ("for_code_file", CF_F)]:
    x = {"q": T + "ClockFile", "waives": ["contradiction"], "target": {"kind": "component", "q": K + "ShapeRuleEngine"},
         "for": [{"kind": "code", "id": subj}], "owner": OWN, "expires": "2026-12-01T00:00:00Z"}
    s_x = esf(T + "Shape", OWN, actors3(), [CLOCK, SOURCE], [CLI, RULE_ENGINE], [], [clock_rule(), AUTH_RE], [RELAY, clock_prov()], exceptions=[x])
    hm = manifest("h4", mb4["predicate"]["shape"]["entries"])
    c = case(s_x, hm, "h4", s_x, mb4, "b4", records=[clock_obs("h4", hm, [DATE_NOW])], base_records=[clock_obs("b4", mb4, [DATE_NOW])],
             authors=AUTH3)
    record_result("XF_exception_for_file_subject", variant, "XF_" + variant, c)

# -----------------------------------------------------------------------------
# GSTAR: the head adds `trusts z3@4.13.0` to the proof provider; the proof rests on z3 4.13.0.
# -----------------------------------------------------------------------------
for variant, head_trusts in [("control_head_unchanged", [("z3", "4.12.5"), ("verus", "dccae1d")]),
                             ("attack_head_adds_trust", [("z3", "4.12.5"), ("z3", "4.13.0"), ("verus", "dccae1d")])]:
    pb = verus_prov()
    ph = dict(verus_prov(), trusts=[list(t) for t in head_trusts])
    sb = esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], [dmap()], UNITS2, [law_set()], [pb])
    sh = esf(I + "IronKV", I + "IronKvTeam", ACTORS2, [], [dmap()], UNITS2, [law_set()], [ph])
    mh_g = man2("h2", "head")
    c = case(sh, mh_g, "h2", sb, man2("b2", "base"), "b2",
             records=[proof_rec(mh_g, "h2", [{"id": "z3@4.13.0", "kind": "tool"}, {"id": "verus@dccae1d", "kind": "tool"}])],
             authors=AUTH2, change_ids=["github:acme/ironkv#12"])
    record_result("GSTAR_head_trusts_not_in_run", variant, "GSTAR_" + variant, c)

with open(os.path.join(HERE, "kernel-results.json"), "w") as f:
    json.dump(RESULTS, f, indent=1, sort_keys=True)
for a, vs in sorted(RESULTS.items()):
    print("==", a)
    for v, r in sorted(vs.items()):
        obs = "; ".join("%s/%s/%s/%s%s%s" % (o["kind"], o["reason"] or o["force"] or "-", o["severity"], o["tier"],
                                             "/exc=" + o["exception"] if o["exception"] else "",
                                             "/expl" if o["exploited"] else "") for o in r["obligations"])
        print("  %-48s exit=%s %-8s errs=%s ans=%s debt=%s | %s" % (
            v, r["exit"], r["verdict"], [e["code"] for e in (r["errors"] or [])],
            [x["as"] for x in (r["answered"] or [])], [(d["exception"], d["expiresInDays"]) for d in (r["debt"] or [])], obs))
