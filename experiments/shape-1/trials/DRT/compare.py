"""DRT comparator: exact comparison of prototype and kernel outputs over the kernel's core fields.
Usage: python3 -I compare.py <list.tsv> <tsDir> <kDir> <kcaseDir> <norms|-> <out.jsonl>
norms (comma list) are normalisations for confirmed spec ambiguities / documented differences:
  N1  errors compared as the set of kernel error codes present (subjects and granularity unspecified)
  N2  a loosening obligation's `claim` field ignored (base claim vs null: unspecified)
  N3  E-exception raised by the prototype's elaborator counts as a pre-pass error (interface split)
  NW  witness: kernel lists all support facts, prototype the canonical witness (A.4.4.8); equal when
      kernel witness == prototype support minus declared facts and prototype witness (minus declared
      facts) is inside it
Output: one JSON line per case {id, status, diffs:[{sig, detail}], stats}."""
import hashlib, json, os, sys

KCODES = {"E-conduct", "E-structure", "E-provider-missing", "E-exception"}
FIELDS = ["key", "kind", "reason", "questions", "introduced", "severity", "tier", "budget", "force", "owner", "group",
          "claim", "subject", "witness", "exploited", "final", "binding", "exception"]


def jcs(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def H(v):
    return "sha256:" + hashlib.sha256(jcs(v).encode()).hexdigest()


def declared_fids(kcase):
    out = set()
    for c in (kcase.get("head") or {}).get("esf", {}).get("claims", []):
        if c["op"] == "effects.lower":
            for entry in c["args"].get("atoms", []):
                atom, _, via = entry.partition(" via ")
                out.add(H({"type": "declared", "claim": c["fp"], "atom": entry}))
                out.add(H({"type": "declared", "claim": c["fp"], "atom": atom}))
                if via:
                    out.add(H({"type": "declared", "claim": c["fp"], "atom": atom, "unit": via}))
        elif c["op"] == "edge.exists":
            out.add(H({"type": "declared", "claim": c["fp"]}))
    return out


def proj(o, norms):
    p = {f: o.get(f) for f in FIELDS}
    if p["claim"]:
        p["claim"] = {"fp": p["claim"]["fp"], "ids": sorted(p["claim"]["ids"]), "tier": p["claim"].get("tier")}
    if "N2" in norms and o.get("kind") == "loosening":
        p["claim"] = None
    return p


def kind_q(o):
    k = o["kind"]
    if k == "loosening":
        return f"loosening[{'+'.join(o.get('questions') or [])}]"
    if k == "unestablished":
        return f"unestablished[{o.get('reason')}]"
    if k == "contradiction":
        return f"contradiction[{o.get('force')}{',law' if o.get('subject') is None else ''}]"
    return k


def short(v):
    s = v if isinstance(v, str) else jcs(v)
    return s if len(s) <= 90 else s[:87] + "..."


def compare(ts, ln, kcase, norms):
    diffs = []
    add = lambda sig, d: diffs.append({"sig": sig, "detail": d})
    tsErr = ts.get("errors", [])
    prepass = [e for e in tsErr if e["code"] not in KCODES]
    tsK = [e for e in tsErr if e["code"] in KCODES]
    lnErr = list(ln.get("errors", []))
    if "N3" in norms:
        have = {(e["code"], e["subject"]) for e in lnErr}
        for e in tsErr:
            if e["code"] == "E-exception" and (e["code"], e["subject"]) not in have:
                lnErr.append(e)
    lv = "blocked" if prepass and ln.get("verdict") != "invalid" else ln.get("verdict")
    if lnErr and lv == "owed" or lnErr and lv == "pass":
        lv = "blocked"
    if ts["verdict"] != lv:
        add(f"verdict:{ts['verdict']}/{lv}", {"ts": ts["verdict"], "lean": ln.get("verdict")})
    if "N1" in norms:
        a = sorted({e["code"] for e in tsK})
        b = sorted({e["code"] for e in lnErr})
        for c in sorted(set(a) - set(b)):
            add(f"err-only-ts:{c}", {"ts": [e["subject"] for e in tsK if e["code"] == c]})
        for c in sorted(set(b) - set(a)):
            add(f"err-only-lean:{c}", {"lean": [e["subject"] for e in lnErr if e["code"] == c]})
    else:
        from collections import Counter
        ca = Counter(e["code"] for e in tsK)
        cb = Counter(e["code"] for e in lnErr)
        for c in sorted(set(ca) | set(cb)):
            if ca[c] > cb[c]:
                add(f"err-only-ts:{c}", {"ts": [e["subject"] for e in tsK if e["code"] == c], "lean": [e["subject"] for e in lnErr if e["code"] == c]})
            elif cb[c] > ca[c]:
                add(f"err-only-lean:{c}", {"ts": [e["subject"] for e in tsK if e["code"] == c], "lean": [e["subject"] for e in lnErr if e["code"] == c]})
        sa = {(e["code"], e["subject"]) for e in tsK}
        sb = {(e["code"], e["subject"]) for e in lnErr}
        if sa != sb and not any(d["sig"].startswith("err-only") for d in diffs):
            codes = sorted({c for c, _ in sa ^ sb})
            add("err-subject:" + ",".join(codes), {"ts": sorted(s for c, s in sa - sb), "lean": sorted(s for c, s in sb - sa)})
    T = {o["key"]: o for o in ts.get("obligations", [])}
    L = {o["key"]: o for o in ln.get("obligations", [])}
    dec = declared_fids(kcase) if "NW" in norms else set()
    ftot = fok = 0
    for k, o in T.items():
        l = L.get(k)
        if l is None:
            add(f"ob-only-ts:{kind_q(o)}", {"key": k, "subject": short(o.get("subject")), "claim": (o.get("claim") or {}).get("ids", [None])[0], "severity": o["severity"], "tier": o["tier"]})
            continue
        po, pl = proj(o, norms), proj(l, norms)
        for f in FIELDS:
            ftot += 1
            if jcs(po[f]) == jcs(pl[f]):
                fok += 1
                continue
            if f == "witness" and "NW" in norms:
                lw = set(pl[f] or [])
                tw = set(po[f] or []) - dec
                sup = set(o.get("x_support") or []) - dec
                if lw == sup and tw <= lw:
                    fok += 1
                    continue
            hint = ""
            if f in ("tier", "severity", "reason", "force", "introduced", "exploited", "final", "budget", "kind", "owner", "exception"):
                hint = f":{po[f]}/{pl[f]}"
            elif f == "questions":
                hint = f":{'+'.join(po[f] or [])}/{'+'.join(pl[f] or [])}"
            elif f == "witness":
                hint = f":n{len(po[f] or [])}/n{len(pl[f] or [])}"
            add(f"field:{kind_q(o)}:{f}{hint}", {"key": k, "claim": (o.get("claim") or {}).get("ids", [None])[0], "subject": short(o.get("subject")), "ts": short(po[f]), "lean": short(pl[f])})
    for k, o in L.items():
        if k not in T:
            add(f"ob-only-lean:{kind_q(o)}", {"key": k, "subject": short(o.get("subject")), "claim": (o.get("claim") or {}).get("ids", [None])[0], "severity": o["severity"], "tier": o["tier"]})
    ta = {(a["obligation"], a["as"]) for a in ts.get("answered", [])}
    la = {(a["obligation"], a["as"]) for a in ln.get("answered", [])}
    for a in sorted(ta - la):
        add(f"answered-only-ts:{a[1]}", {"key": a[0]})
    for a in sorted(la - ta):
        add(f"answered-only-lean:{a[1]}", {"key": a[0]})
    td = {d["obligation"]: jcs({k: d[k] for k in ("exception", "owner", "expiresInDays")}) for d in ts.get("debt", [])}
    ld = {d["obligation"]: jcs({k: d[k] for k in ("exception", "owner", "expiresInDays")}) for d in ln.get("debt", [])}
    for k in td:
        if k not in ld:
            add("debt-only-ts", {"key": k})
        elif td[k] != ld[k]:
            add("debt-field", {"key": k, "ts": td[k], "lean": ld[k]})
    for k in ld:
        if k not in td:
            add("debt-only-lean", {"key": k})
    if set(T) == set(L) and [o["key"] for o in ts.get("obligations", [])] != [o["key"] for o in ln.get("obligations", [])]:
        add("ob-order", {})
    return diffs, {"tsObs": len(T), "leanObs": len(L), "shared": len(set(T) & set(L)), "fieldTotal": ftot, "fieldAgree": fok,
                   "prepass": sorted({e["code"] for e in prepass}), "tsVerdict": ts["verdict"], "leanVerdict": ln.get("verdict")}


def main():
    listf, tsdir, kdir, kcdir, norms, outf = sys.argv[1:7]
    norms = set() if norms == "-" else set(norms.split(","))
    with open(outf, "w") as out:
        for line in open(listf):
            if not line.strip():
                continue
            cid = line.split("\t")[0]
            tp, kp, cp = f"{tsdir}/{cid}.json", f"{kdir}/{cid}.json", f"{kcdir}/{cid}.kcase.json"
            row = {"id": cid}
            ts = json.load(open(tp)) if os.path.exists(tp) else {"status": "missing"}
            if ts.get("status") != "ok":
                row["status"] = "ts-" + ts.get("status", "missing")
                row["error"] = ts.get("error")
            elif ts["verdict"] == "invalid":
                row["status"] = "ts-invalid"
                row["error"] = [e["subject"] for e in ts.get("errors", [])][:5]
            elif not os.path.exists(kp):
                row["status"] = "kernel-missing"
            else:
                ln = json.load(open(kp))
                if ln.get("status") != "ok":
                    row["status"] = "kernel-" + ln.get("status", "?")
                    row["ms"] = ln.get("ms")
                elif ln.get("verdict") == "invalid":
                    row["status"] = "kernel-invalid"
                    row["error"] = ln.get("errors")
                else:
                    kcase = json.load(open(cp)) if "NW" in norms else {}
                    diffs, stats = compare(ts, ln, kcase, norms)
                    row.update({"status": "agree" if not diffs else "differ", "diffs": diffs, "stats": stats,
                                "tsMs": ts.get("ms"), "leanMs": ln.get("ms")})
            out.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
