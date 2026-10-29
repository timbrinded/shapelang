"""Shared helpers for the M0 golden outputs (version 7): hashing via vectors.py, canonical input,
obligation/discharger/health builders, JCS serialisation."""
import base64
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vec  # noqa: E402

V = vec.load()
H, hexh, jcs, nf, label = V.H, V.hexh, V.jcs, V.nf, V.label
ob_key, binding, group_id, fact_id, ref = V.ob_key, V.binding, V.group_id, V.fact_id, V.ref
FP = V.fp
C = V.C


def fp_of(op, args):
    return H(nf(op, args))


# ---- canonical input (A.12.7.6) ---------------------------------------------------------------------------

def _jcs_s(x):
    return jcs(x).decode("utf-8")


def _sorted_set(xs):
    return sorted(xs) if isinstance(xs, list) else xs


def _canon_decl(d):
    d = copy.deepcopy(d)
    k = d.get("decl")
    if k == "component":
        if "units" in d:
            d["units"] = sorted(d["units"], key=lambda u: u["name"])
        if isinstance(d.get("grants"), list):
            d["grants"] = sorted(d["grants"])
        for f in ("paths", "exceptPaths", "allows", "relationsComplete"):  # exceptPaths: version 7 (A.16.2(g), A.16.3)
            if f in d:
                d[f] = _sorted_set(d[f])
        if "assumes" in d:
            d["assumes"] = sorted(d["assumes"], key=lambda a: a["id"])
    elif k == "resource":
        if "bind" in d:
            d["bind"] = _sorted_set(d["bind"])
    elif k == "actor":
        for f in ("identities", "members"):
            if f in d:
                d[f] = _sorted_set(d[f])
    elif k == "provider":
        for f in ("observes", "decides", "produces", "sound"):
            if f in d:
                d[f] = _sorted_set(d[f])
    elif k == "note":
        d["about"] = sorted(d["about"])
    return d


def _decl_key(d):
    return d["decl"] + "\u0000" + (",".join(d["names"]) if d["decl"] == "hatch" else d.get("name", ""))


def _canon_source(s):
    if s is None:
        return None
    s = copy.deepcopy(s)
    mods = []
    for m in s.get("modules", []):
        m = dict(m)
        m.pop("file", None)
        m["imports"] = sorted(m.get("imports", []))
        ds = [_canon_decl(d) for d in m["decls"]]
        m["decls"] = sorted(ds, key=lambda d: (_decl_key(d), _jcs_s(d)))
        mods.append(m)
    s["modules"] = sorted(mods, key=lambda m: m["module"])
    return s


def _canon_manifest(st):
    if isinstance(st, dict) and isinstance(st.get("predicate"), dict) and isinstance(st["predicate"].get("shape"), dict):
        p = st["predicate"]["shape"]
        if isinstance(p.get("tree"), list) and isinstance(p.get("entries"), list):
            st = copy.deepcopy(st)
            p = st["predicate"]["shape"]
            st["predicate"]["shape"] = {
                "v": "shape.manifest.v1", "revision": p["revision"],
                "tree": sorted(p["tree"], key=lambda t: t["path"]),
                "entries": sorted(p["entries"], key=lambda e: (e["id"], e["projection"], e["scheme"])),
            }
    return st  # a DSSE envelope is kept as it is: its payload is already JCS


def statement_of(r):
    if isinstance(r, dict) and isinstance(r.get("payload"), str) and isinstance(r.get("payloadType"), str):
        return json.loads(base64.b64decode(r["payload"]).decode("utf-8"))
    return r


def record_id(r):
    return H(statement_of(r))


def canonical_input(inp):
    c = copy.deepcopy(inp)
    for side in ("head", "base"):
        r = c.get(side)
        if r:
            r["source"] = _canon_source(r.get("source"))
            r["manifest"] = _canon_manifest(r["manifest"])
    c["change"] = {"ids": sorted(c["change"]["ids"])}
    c["authors"] = sorted(c["authors"], key=lambda a: (a["identity"], _jcs_s(a)))
    c["reviews"] = sorted(c["reviews"], key=lambda r: (r.get("change", ""), r["identity"], r.get("time", ""), r["line"], _jcs_s(r)))
    for lst in ("records", "baseRecords"):
        c[lst] = sorted(c[lst], key=lambda r: (record_id(r), _jcs_s(r)))
    c["persisted"] = {k: sorted(c["persisted"][k], key=lambda p: (p["path"], _jcs_s(p))) for k in ("base", "head")}
    return c


def input_digest(inp):
    return H(canonical_input(inp))


# ---- output builders ----------------------------------------------------------------------------------------

def dis(act, by, agentSafe, eligible=(), creates=None):
    return {"act": act, "by": by, "agentSafe": agentSafe, "eligible": sorted(eligible), "creates": creates}


def creates(kind, tier, answers, owners):
    return {"kind": kind, "tier": tier, "answers": answers, "owners": sorted(owners)}


OB_FIELDS = ["key", "kind", "reason", "questions", "introduced", "severity", "tier", "budget", "force", "owner",
             "assignee", "group", "claim", "subject", "witness", "facts", "counterexample", "exploited", "final",
             "binding", "exception", "dischargers", "causes"]


def obligation(**kw):
    o = {"reason": None, "questions": None, "force": None, "assignee": None, "claim": None, "witness": [],
         "facts": {}, "counterexample": None, "exploited": None, "exception": None, "causes": []}
    o.update(kw)
    missing = [f for f in OB_FIELDS if f not in o]
    extra = [f for f in o if f not in OB_FIELDS]
    assert not missing and not extra, (missing, extra)
    mech = o["dischargers"] and o["dischargers"][0]["act"] in ("rerun", "provide", "edit-code", "add-was")
    assert o["budget"] == ("mechanical" if mech else "judgment"), (o["key"], o["budget"])  # A.7.1.4
    assert o["final"] == (o["tier"] == "final")
    return o


def claim_ref(fp, ids, tier):
    return {"fp": fp, "ids": sorted(ids), "tier": tier}


SEV_ORDER = {"blocking": 0, "owed": 1}


def sort_obligations(obs):
    # A.12.10.5 and records §5: obligations by (severity, kind, key), codepoint order
    return sorted(obs, key=lambda o: (o["severity"], o["kind"], o["key"]))


HEALTH_KEYS = ["coverage", "unobservable", "declaredOnly", "unanswered", "openAuthority", "ungoverned", "unmapped",
               "externalCalls", "ungovernedCalls", "unanchored", "droppedEdges", "unauthenticated", "unrecorded",
               "rejected", "executesHead", "baseObservations", "baseDefects", "clockClamped", "trustDebt",
               "finalDrift", "lawsContradictedAtBase", "inertExceptions", "vacuousLaws", "budget", "self",
               "preexisting", "renames", "assumption"]


def health(**kw):
    h = {"coverage": {"num": 0, "den": 0}, "unobservable": [], "declaredOnly": [], "unanswered": [],
         "openAuthority": [], "ungoverned": {"num": 0, "den": 0}, "unmapped": [], "externalCalls": 0,
         "ungovernedCalls": 0, "unanchored": 0, "droppedEdges": 0, "unauthenticated": [], "unrecorded": [],
         "rejected": {"count": 0, "rj06": 0}, "executesHead": [], "baseObservations": "present",
         "baseDefects": [], "clockClamped": False, "trustDebt": 0, "finalDrift": [],
         "lawsContradictedAtBase": [], "inertExceptions": [], "vacuousLaws": [],
         "budget": {"limit": None, "used": 0, "overflow": 0}, "self": [], "preexisting": 0, "renames": 0,
         "assumption": "dependency code and configuration data"}
    for k, v in kw.items():
        assert k in h, k
        h[k] = v
    for k in ("unobservable", "openAuthority", "unmapped", "unauthenticated", "unrecorded", "executesHead",
              "baseDefects", "finalDrift", "inertExceptions", "vacuousLaws", "self"):
        h[k] = sorted(h[k])
    h["declaredOnly"] = sorted(h["declaredOnly"], key=lambda d: d["claim"])
    h["unanswered"] = sorted(h["unanswered"], key=lambda d: d["key"])
    assert list(h) == HEALTH_KEYS
    return h


def declared_only(fp, tier, route):
    assert route in ("declared-only", "contradiction-only")
    return {"claim": fp, "route": route, "tier": tier}


OUT_FIELDS = ["contract", "mode", "inputDigest", "verdict", "errors", "rejected", "obligations", "answered",
              "loosening", "order", "renames", "debt", "preexisting", "budget", "health"]


def output(**kw):
    o = {"contract": "shape.check.output/v1", "errors": [], "rejected": [], "answered": [], "loosening": [],
         "renames": [], "debt": [], "preexisting": []}
    o.update(kw)
    assert sorted(o) == sorted(OUT_FIELDS), sorted(set(o) ^ set(OUT_FIELDS))
    o["obligations"] = sort_obligations(o["obligations"])
    o["errors"] = sorted(o["errors"], key=lambda e: (e["code"], e["subject"]))
    o["answered"] = sorted(o["answered"], key=lambda a: a["obligation"])
    o["loosening"] = sorted(o["loosening"], key=lambda r: (r["subject"], r["question"]))
    o["debt"] = sorted(o["debt"], key=lambda r: r["obligation"])
    o["preexisting"] = sorted(o["preexisting"], key=lambda r: r["obligation"])
    # verdict (A.10.2, A.7.5): blocked if any error or blocking obligation; owed if any obligation; else pass
    blocked = bool(o["errors"]) or any(x["severity"] == "blocking" for x in o["obligations"])
    want = "blocked" if blocked else ("owed" if o["obligations"] else "pass")
    assert o["verdict"] == want, (o["verdict"], want)
    # every group id is the hash of its sorted member keys (A.7.2.3)
    groups = {}
    for x in o["obligations"]:
        groups.setdefault(x["group"], []).append(x["key"])
    return o


def check_groups(out, discharged_groups=None):
    """Group ids of the open obligations equal g:(sorted member keys), adding members that were discharged."""
    groups = {}
    for x in out["obligations"]:
        groups.setdefault(x["group"], []).append(x["key"])
    for g, ks in (discharged_groups or {}).items():
        groups.setdefault(g, []).extend(ks)
    for g, ks in groups.items():
        assert g == group_id(sorted(set(ks))), (g, ks)


def serialise(out):
    """The golden serialisation: RFC 8785 JCS bytes of the core output, UTF-8, no trailing newline."""
    return jcs(out)
