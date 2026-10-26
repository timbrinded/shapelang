"""H5 step 3: recall, precision and obligation volume of the 1.0 replay against E9's ground truth.

Reads the replay outputs (runs/<config>/<repo>.jsonl from replay.ts) and the walk (for renames,
the boundary inventory and markers at base). For each commit in E9's filtered set after the
adoption commit:

  E9 event      the commit has a trust event in results/per-commit (marker add or remove in a
                file, or an edit to a trusted function's body or contract): the ground truth.
  growth        some file's count of some marker kind rises (E9 `add`); net growth: the commit's
                total marker count rises (E9's B2 gate fires).
  B3            E9's per-file count diff fires (some file's marker counts change).
  surfaced      derive raised at least one obligation caused by the commit: introduced
                (model §7.3), or not introduced but absent from derive(base -> base) (a judgment
                staled by a marker removal that took the identity out of Req). Preexisting
                obligations are not counted.
  blocking      at least one surfaced obligation is blocking.

Usage: python3 -I analyze.py RUNS_DIR WALK_DIR CONFIG [CONFIG...] [--json OUT]
"""
import collections
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_glob import in_globs  # noqa: E402

args = [a for a in sys.argv[1:]]
out_json = None
if "--json" in args:
    i = args.index("--json")
    out_json = args[i + 1]
    del args[i:i + 2]
runs_dir, walk_dir, configs = args[0], args[1], args[2:]
REPOS = ["anvil", "atmosphere", "verified-ironkv", "verified-memory-allocator", "verified-node-replication", "verified-nrkernel", "verified-storage", "vest"]


# ---- walk: renames and markers at base, per commit ----------------------------------------------
walk_info = {}


def load_walk(repo):
    if repo in walk_info:
        return walk_info[repo]
    w = json.load(open(os.path.join(walk_dir, f"{repo}.walk.json")))
    tot = {}
    for line in open(os.path.join(walk_dir, f"{repo}.blobs.jsonl")):
        d = json.loads(line)
        r = d["rec"]
        tot[d["sha"]] = sum(r["tcb"].values()) if r else 0
    snap = dict(w["rootSnap"])
    info = {}
    for st in w["steps"]:
        marked_b = {p for p, s in snap.items() if tot.get(s, 0) > 0}
        renames = {n: o for o, n in st["pairs"] if o and n and o != n}
        for o, n in st["pairs"]:
            if o and o in snap:
                del snap[o]
            if n and n in st["new"]:
                snap[n] = st["new"][n]
        marked_h = {p for p, s in snap.items() if tot.get(s, 0) > 0}
        info[st["commit"]] = {"markedB": marked_b, "markedH": marked_h, "renames": renames}
    walk_info[repo] = info
    return info


def pct(a, b):
    return f"{100 * a / b:5.1f}%" if b else "  n/a"


def stats(xs):
    if not xs:
        return {"mean": 0, "median": 0, "p90": 0, "max": 0}
    s = sorted(xs)
    return {"mean": round(sum(s) / len(s), 2), "median": statistics.median(s), "p90": s[int(0.9 * (len(s) - 1))], "max": s[-1]}


def ev_kinds(evs):
    add = any(e["add"] for e in evs)
    rem = any(e["remove"] for e in evs)
    tb = any(e["tbody"] for e in evs)
    tc = any(e["tcontract"] for e in evs)
    net = sum(sum(e["add"].values()) - sum(e["remove"].values()) for e in evs)
    return add, rem, tb, tc, net


def surfaced_obs(d):
    o0 = set(d["o0"]) if d["o0"] is not None else None
    out = []
    for o in d["obligations"]:
        if o["introduced"]:
            out.append(o)
        elif o["kind"] != "contradiction" and o0 is not None and o["key"] not in o0:
            out.append(o)
    return out


def fp_causes(d, sobs, renames):
    """Why a commit with no E9 event raised obligations (one label per obligation identity)."""
    causes = collections.Counter()
    for o in sobs:
        if o["kind"] == "coverage":
            causes["coverage: changed code not hatch-complete"] += 1
            continue
        if o["kind"] == "contradiction":
            path = o["files"][0] if o["files"] else ""
            mv = o["moved"][0] if o["moved"] else {}
            if path in renames:
                causes["contradiction: marked file renamed (new identities)"] += 1
            elif mv.get("mb") is None:
                causes["contradiction: marked function renamed or moved (new identity)"] += 1
            else:
                causes["contradiction: marker moved between identities of one file"] += 1
            continue
        # unestablished ReviewedSurface: classify each moved Req identity
        labels = set()
        for m in o["moved"]:
            mb, mh = m["mb"], m["mh"]
            path = m["id"].split(":", 1)[1].split("#")[0]
            if path in renames:
                labels.add("surface: marked file renamed")
            elif mb is None or mh is None:
                labels.add("surface: marked identity added, removed or renamed (no E9 count change)")
            elif m["file"]:
                labels.add("surface: file-level own digest moved (functions added/removed in a marked file)")
            elif mb == mh and set(mb) <= {"assume", "admit"}:
                labels.add("surface: body edit of a function carrying only assume/admit")
            elif mb == mh:
                labels.add("surface: other edit of a marked function")
            else:
                labels.add("surface: marker kinds moved within a file")
        for lab in sorted(labels):
            causes[lab] += 1
    return causes


def analyse(config):
    rows = []
    adoption = {}
    for repo in REPOS:
        p = os.path.join(runs_dir, config, f"{repo}.jsonl")
        if not os.path.exists(p):
            continue
        for line in open(p):
            d = json.loads(line)
            if d["type"] == "adoption":
                adoption[repo] = d
            else:
                rows.append(d)
    per = collections.OrderedDict()
    tot = collections.Counter()
    vol = collections.defaultdict(list)
    misses = collections.Counter()
    fps = collections.Counter()
    fp_commits = collections.Counter()
    file_tot = collections.Counter()
    verdicts = collections.Counter()
    obkinds = collections.Counter()
    examples = collections.defaultdict(list)
    for d in rows:
        repo = d["repo"]
        wi = load_walk(repo)[d["commit"]]
        c = per.setdefault(repo, collections.Counter())
        evs = d["gt"]
        ev = bool(evs)
        add, rem, tb, tc, net = ev_kinds(evs)
        b3 = add or rem
        sobs = surfaced_obs(d)
        s = bool(sobs)
        sb = any(o["severity"] == "blocking" for o in sobs)
        # counterfactual rule: an edit to an identity that already carries a contradicted hatch fact
        # (preexisting contradiction whose identity's digests moved) also counts as introduced
        cf = s or any(o["kind"] == "contradiction" and not o["introduced"] and o.get("codeChanged") for o in d["obligations"])
        nonrem = add or tb or tc
        for k, v in (
            ("commits", 1), ("event", ev), ("grow", add), ("netgrow", net > 0), ("bodyonly", ev and not b3), ("remonly", ev and rem and not add),
            ("b3", ev and b3), ("b2", ev and net > 0),
            ("surf", s), ("surfB", sb), ("tp", ev and s), ("tpB", ev and sb),
            ("growS", add and s), ("growSB", add and sb), ("netS", net > 0 and s), ("netSB", net > 0 and sb),
            ("bodyS", ev and not b3 and s), ("remS", ev and rem and not add and s),
            ("b3growMiss", add and not b3),
            ("nonrem", ev and nonrem), ("nonremS", ev and nonrem and s), ("nonremB3", ev and nonrem and b3),
            ("cf", cf), ("cfTp", ev and cf), ("cfNonrem", ev and nonrem and cf), ("cfBody", ev and not b3 and cf),
            ("trustedEdit", ev and (tb or tc)), ("trustedEditS", ev and (tb or tc) and s), ("trustedEditCf", ev and (tb or tc) and cf), ("trustedEditB3", ev and (tb or tc) and b3),
        ):
            c[k] += int(bool(v))
            tot[k] += int(bool(v))
        verdicts[d["verdict"]] += 1
        for o in d["obligations"]:
            obkinds[(o["kind"], o["reason"], o["introduced"], o["severity"])] += 1
        # volume
        vol["all"].append(len(d["obligations"]))
        vol["surf"].append(len(sobs))
        vol["surfBlocking"].append(sum(1 for o in sobs if o["severity"] == "blocking"))
        vol["surfJudgment"].append(sum(1 for o in sobs if o["budget"] == "judgment"))
        vol["surfGroups"].append(len({o["group"] for o in sobs}))
        vol["preexisting"].append(sum(1 for o in d["obligations"] if o not in sobs))
        if ev:
            vol["surfEvent"].append(len(sobs))
            vol["allEvent"].append(len(d["obligations"]))
        # event-level (per file) recall
        sfiles = set()
        for o in sobs:
            sfiles.update(o["files"])
        if adoption.get(repo) and d["variant"] != "M":
            globs = adoption[repo]["globs"]
        else:
            globs = adoption.get(repo, {}).get("globs", []) + sorted(wi["markedB"])
        for e in evs:
            kind = "add" if e["add"] else ("remove" if e["remove"] else "trusted-edit")
            inside = in_globs(globs, e["path"])
            hit = e["path"] in sfiles
            file_tot[("events", kind, inside)] += 1
            file_tot[("hit", kind, inside)] += int(hit)
            if not hit:
                misses[(kind, "inside" if inside else "outside")] += 1
                if len(examples[(kind, inside)]) < 3:
                    examples[(kind, inside)].append(f"{repo} {d['commit'][:10]} {e['path']} add={e['add']} remove={e['remove']} tbody={e['tbody']} tcontract={e['tcontract']}")
        if s and not ev:
            cz = fp_causes(d, sobs, wi["renames"])
            fps.update(cz)
            fp_commits[sorted(cz)[0] if cz else "?"] += 1
    return {"config": config, "per": per, "tot": tot, "vol": {k: stats(v) for k, v in vol.items()}, "misses": misses, "fps": fps, "fpCommits": fp_commits, "files": file_tot, "verdicts": verdicts, "obkinds": obkinds, "adoption": adoption, "examples": examples}


results = []
for cfg in configs:
    r = analyse(cfg)
    results.append(r)
    t = r["tot"]
    print(f"\n=== {cfg}: {t['commits']} commits, {t['event']} with an E9 trust event ({pct(t['event'], t['commits'])}) ===")
    print(f"{'repo':27} {'commits':>7} {'events':>6} | {'B3':>6} {'1.0':>6} {'1.0 blk':>7} | {'grow':>4} {'1.0':>6} {'blk':>6} | {'body-only':>9} {'1.0':>6} | {'prec':>6} {'precB':>6}")
    for repo, c in list(r["per"].items()) + [("ALL", t)]:
        print(f"{repo:27} {c['commits']:7} {c['event']:6} | {pct(c['b3'], c['event']):>6} {pct(c['tp'], c['event']):>6} {pct(c['tpB'], c['event']):>7} | {c['grow']:4} {pct(c['growS'], c['grow']):>6} {pct(c['growSB'], c['grow']):>6} | {c['bodyonly']:9} {pct(c['bodyS'], c['bodyonly']):>6} | {pct(c['tp'], c['surf']):>6} {pct(c['tpB'], c['surfB']):>6}")
    print(f"net growth commits {t['netgrow']}: surfaced {pct(t['netS'], t['netgrow'])}, blocking {pct(t['netSB'], t['netgrow'])}; removal-only event commits {t['remonly']}: surfaced {pct(t['remS'], t['remonly'])}")
    print(f"surfaced commits {t['surf']} (blocking {t['surfB']}); false positives vs E9: {t['surf'] - t['tp']} (blocking {t['surfB'] - t['tpB']})")
    print(f"events excluding removal-only commits {t['nonrem']}: 1.0 {pct(t['nonremS'], t['nonrem'])}, B3 {pct(t['nonremB3'], t['nonrem'])}; commits with a trusted body/contract edit {t['trustedEdit']}: 1.0 {pct(t['trustedEditS'], t['trustedEdit'])}, B3 {pct(t['trustedEditB3'], t['trustedEdit'])}")
    print(f"counterfactual (edits to contradicted hatch identities introduce): recall {pct(t['cfTp'], t['event'])}, excluding removal-only {pct(t['cfNonrem'], t['nonrem'])}, body-only {pct(t['cfBody'], t['bodyonly'])}, trusted-edit commits {pct(t['trustedEditCf'], t['trustedEdit'])}, precision {pct(t['cfTp'], t['cf'])} ({t['cf']} commits)")
    f = r["files"]
    print("file-level events (E9 per file) surfaced at that file:")
    for kind in ("add", "remove", "trusted-edit"):
        for inside in (True, False):
            n = f[("events", kind, inside)]
            if n:
                print(f"   {kind:12} {'inside ' if inside else 'outside'} boundary: {f[('hit', kind, inside)]}/{n} ({pct(f[('hit', kind, inside)], n)})")
    tn = sum(v for k, v in f.items() if k[0] == "events")
    th = sum(v for k, v in f.items() if k[0] == "hit")
    print(f"   all file events: {th}/{tn} ({pct(th, tn)})")
    print("volume per commit (obligations):", json.dumps(r["vol"]))
    print("verdicts:", dict(r["verdicts"]))
    print("false-positive causes (obligations; commits by first cause):", dict(r["fps"]), dict(r["fpCommits"]))
    for k, v in r["examples"].items():
        print("   miss example", k, v[:2])

if out_json:
    def enc(o):
        if isinstance(o, collections.Counter) or isinstance(o, dict):
            return {(" ".join(map(str, k)) if isinstance(k, tuple) else str(k)): enc(v) for k, v in o.items()}
        if isinstance(o, list):
            return [enc(x) for x in o]
        return o
    json.dump([enc(r) for r in results], open(out_json, "w"), indent=1, sort_keys=True)

# ---- one row per configuration ----------------------------------------------------------------------
print("\nconfig                 events  B3     recall  blk     growth  g.blk   body    rem     norem   prec    FP   surf/commit(mean,med,p90,max)  open/commit(mean,med,max)  judg/commit  cf.recall cf.prec")
for r in results:
    t = r["tot"]
    v = r["vol"]
    print(
        f"{r['config']:22} {t['event']:6} {pct(t['b3'], t['event'])} {pct(t['tp'], t['event'])} {pct(t['tpB'], t['event'])} "
        f"{pct(t['growS'], t['grow'])} {pct(t['growSB'], t['grow'])} {pct(t['bodyS'], t['bodyonly'])} {pct(t['remS'], t['remonly'])} {pct(t['nonremS'], t['nonrem'])} "
        f"{pct(t['tp'], t['surf'])} {t['surf'] - t['tp']:4}   "
        f"{v['surf']['mean']:5} {v['surf']['median']:4} {v['surf']['p90']:4} {v['surf']['max']:4}           "
        f"{v['all']['mean']:7} {v['all']['median']:5} {v['all']['max']:5}      {v['surfJudgment']['mean']:5}      {pct(t['cfTp'], t['event'])} {pct(t['cfTp'], t['cf'])}"
    )
