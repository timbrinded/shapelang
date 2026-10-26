"""Run the Lean kernel executable on every case and compare with the expectations.

Run: python3 -I run_tests.py <shapek> <cases-dir> [--perm N]
For each case it also checks byte-identical output under N random permutations (and
duplications) of every input collection (an executable check of T1)."""
import copy
import json
import os
import random
import subprocess
import sys

EXE = sys.argv[1]
DIR = sys.argv[2]
PERM = int(sys.argv[sys.argv.index("--perm") + 1]) if "--perm" in sys.argv else 3


def run(case):
    p = subprocess.run([EXE], input=json.dumps(case).encode(), capture_output=True)
    return p.returncode, p.stdout.decode()


def match_ob(exp, ob):
    for k, v in exp.items():
        if k == "claimFp":
            if (ob.get("claim") or {}).get("fp") != v:
                return False
        elif k == "subject":
            if ob.get("subject") != v:
                return False
        elif ob.get(k) != v:
            return False
    return True


def shuffle_case(case, rng):
    c = copy.deepcopy(case)

    def sh(lst, dup=False):
        lst = list(lst)
        rng.shuffle(lst)
        if dup and lst:
            lst.append(copy.deepcopy(rng.choice(lst)))
        return lst

    c["records"] = sh(c["records"], dup=True)
    c["baseRecords"] = sh(c["baseRecords"], dup=True)
    c["authors"] = sh(c["authors"], dup=True)
    c["cells"] = sh(c["cells"])
    c["change"]["ids"] = sh(c["change"]["ids"])
    for side in ["head", "base"]:
        s = c.get(side)
        if not s:
            continue
        e = s["esf"]
        for k in ["actors", "effects", "hatches", "kinds", "resources", "components", "units", "claims", "providers", "exceptions"]:
            e[k] = sh(e.get(k, []), dup=(k == "claims"))
        m = s["manifest"]["predicate"]["shape"]
        m["entries"] = sh(m["entries"], dup=True)
    return c


passed = failed = 0
names = sorted(f[:-5] for f in os.listdir(DIR) if f.endswith(".json") and not f.endswith(".expect.json"))
for name in names:
    case = json.load(open(os.path.join(DIR, name + ".json")))
    exp = json.load(open(os.path.join(DIR, name + ".expect.json")))
    code, out = run(case)
    problems = []
    try:
        o = json.loads(out)
    except Exception as ex:  # noqa: BLE001
        problems.append("unparsable output: %r" % out[:200])
        o = {}
    if o:
        if o.get("verdict") != exp["verdict"]:
            problems.append("verdict %s != %s" % (o.get("verdict"), exp["verdict"]))
        want_code = {"pass": 0, "owed": 0, "blocked": 1, "invalid": 2}[exp["verdict"]]
        if code != want_code:
            problems.append("exit %d != %d" % (code, want_code))
        if "errors" in exp:
            got = [{"code": e["code"], "subject": e["subject"]} for e in o.get("errors", [])]
            if got != exp["errors"]:
                problems.append("errors %s != %s" % (got, exp["errors"]))
        obs = o.get("obligations", [])
        for eo in exp.get("obligations", []):
            if not any(match_ob(eo, ob) for ob in obs):
                problems.append("missing obligation %s" % json.dumps(eo))
        if exp.get("exact") and len(obs) != len(exp.get("obligations", [])):
            problems.append("obligation count %d != %d: %s" % (len(obs), len(exp["obligations"]),
                            [(x["kind"], x["key"][:19], x.get("reason")) for x in obs]))
        if "answered" in exp:
            got = sorted(a["obligation"] for a in o.get("answered", []))
            if got != sorted(exp["answered"]):
                problems.append("answered %s != %s" % (got, exp["answered"]))
        for ed in exp.get("debt", []):
            if not any(all(d.get(k) == v for k, v in ed.items()) for d in o.get("debt", [])):
                problems.append("missing debt %s" % ed)
        rng = random.Random(name)
        for _ in range(PERM):
            _, out2 = run(shuffle_case(case, rng))
            if out2 != out:
                problems.append("output differs under permutation")
                break
    if problems:
        failed += 1
        print("FAIL", name)
        for p in problems:
            print("   ", p)
    else:
        passed += 1
        print("ok  ", name)
print("passed %d failed %d" % (passed, failed))
sys.exit(1 if failed else 0)
