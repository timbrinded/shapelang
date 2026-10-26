"""DRT leave-one-out attribution: starting from the configuration where every root-cause patch and
normalisation is on (ALL), switches one cause group off at a time and counts the cases (and diffs)
that disagree again. A group is one root cause; a cause that needs a change on both sides is one
group (both switches off together).
Usage: python3 -I loo.py <D> <list.tsv> <tag> [group ...]   (no group: every group in GROUPS)
Writes <D>/cmp/loo-<tag>-<group>.jsonl per group and prints one TSV row per group:
group, side, differing cases, diffs, top signatures, example ids. Needs the ALL outputs in
<D>/out/ts-<ALL_TS> and <D>/out/k-<ALL_K> (run_cfg.py with the ALL sets)."""
import collections, json, os, shutil, subprocess, sys

D, LIST, TAG = sys.argv[1:4]
ONLY = sys.argv[4:]
REPO = "/home/user/shapelang"
TRIAL = f"{REPO}/experiments/shape-1/trials/DRT"
ALL_TS = "T1,T2,T3,T4,T6,T8,T10,T11,T13,T14,T15,T16,T17,T18,A5,A6,A7,A15,A16,G1,G2,G3,GV,GL".split(",")
ALL_K = ("K1,K2,K3,K4,K5,K5J,K6,K7,K7b,K8,K9,K10,K11,K12,K14,K15,K16,K17,K18,K19,K20,K21,K22,K23,KW,"
         "A4,A8,A9,A10,A11,A12,A13,A14").split(",")
ALL_N = "N1,N2,N3,NW".split(",")
GROUPS = [
    # prototype bugs
    ("T1", "ts"), ("T2", "ts"), ("T4", "ts"), ("T8", "ts"), ("T10", "ts"), ("T11", "ts"), ("T13", "ts"),
    ("T14", "ts"), ("T16", "ts"), ("T17", "ts"),
    # both sides deviate from the annex
    ("T3+K6", "both"), ("T6+K5J", "both"), ("T15+K17", "both"), ("T18+K21", "both"),
    # kernel bugs
    ("K1", "k"), ("K2", "k"), ("K3", "k"), ("K4", "k"), ("K5", "k"), ("K7", "k"), ("K7b", "k"), ("K8", "k"),
    ("K9", "k"), ("K10", "k"), ("K11", "k"), ("K12", "k"), ("K14", "k"), ("K15", "k"), ("K16", "k"), ("K18", "k"),
    ("K19", "k"), ("K20", "k"), ("K22", "k"), ("K23", "k"), ("KW", "k"),
    # documented kernel gaps (emulated in the prototype copy)
    ("G1", "gap"), ("G2", "gap"), ("G3", "gap"), ("GV", "gap"), ("GL", "gap"),
    # spec ambiguities (aligned on one side, or normalised in the comparator)
    ("A4", "amb"), ("A5", "amb"), ("A6", "amb"), ("A7", "amb"), ("A8", "amb"), ("A9", "amb"), ("A10", "amb"),
    ("A11", "amb"), ("A12", "amb"), ("A13", "amb"), ("A14", "amb"), ("A15", "amb"), ("A16", "amb"),
    ("N1", "amb"), ("N2", "amb"), ("N3", "amb"), ("NW", "amb"),
]
# one side of a both-sides deviation switched off alone (run only when named on the command line):
# the cases where the annex reading changes that side's output
EXTRA = [("KW+NW", "k+norm"), ("T3", "ts-side"), ("K6", "k-side"), ("T6", "ts-side"), ("K5J", "k-side"), ("T15", "ts-side"),
         ("K17", "k-side"), ("T18", "ts-side"), ("K21", "k-side")]
# whole classes switched off at once: the cases each class of root cause accounts for
ALIASES = {
    "CLS-TS": "T1+T2+T4+T8+T10+T11+T13+T14+T16+T17",
    "CLS-K": "K1+K2+K3+K4+K5+K7+K7b+K8+K9+K10+K11+K12+K14+K15+K16+K18+K19+K20+K22+K23+KW",
    "CLS-BOTH": "T3+K6+T6+K5J+T15+K17+T18+K21",
    "CLS-GAP": "G1+G2+G3+GV+GL",
    "CLS-AMB": "A4+A5+A6+A7+A8+A9+A10+A11+A12+A13+A14+A15+A16+N1+N2+N3+NW",
    # every kernel-side bug fix (kernel-only plus the kernel half of both-sides causes), and the same for the prototype
    "CLS-KALL": "K1+K2+K3+K4+K5+K7+K7b+K8+K9+K10+K11+K12+K14+K15+K16+K18+K19+K20+K22+K23+KW+K6+K5J+K17+K21",
    "CLS-TSALL": "T1+T2+T4+T8+T10+T11+T13+T14+T16+T17+T3+T6+T15+T18",
    "CLS-BUGS": "T1+T2+T4+T8+T10+T11+T13+T14+T16+T17+T3+T6+T15+T18+K1+K2+K3+K4+K5+K7+K7b+K8+K9+K10+K11+K12+K14+K15+K16+K18+K19+K20+K22+K23+KW+K6+K5J+K17+K21",
}
EXTRA += [(a, "class") for a in ALIASES]
if ONLY:
    GROUPS = GROUPS + [g for g in EXTRA if g[0] in ONLY]
tag = lambda fs: "none" if not fs else "+".join(fs)


def run_ts(fs, outdir):
    env = dict(os.environ, DRT_FIX=",".join(fs))
    ps = [subprocess.Popen(["bun", f"{TRIAL}/run-ts.ts", f"{D}/protodbg/src/derive.ts", LIST, outdir, "--shard", f"{i}/4"],
                           cwd=REPO, env=env, stdout=subprocess.DEVNULL) for i in range(4)]
    for p in ps:
        p.wait()


def run_k(fs, outdir):
    ps = [subprocess.Popen(["bun", f"{TRIAL}/run-k.ts", f"{D}/kdbg/.lake/build/bin/shapek", LIST, f"{D}/kcase", outdir,
                            ",".join(fs) or "-", "600000", "--shard", f"{i}/4"], cwd=REPO, stdout=subprocess.DEVNULL)
          for i in range(4)]
    for p in ps:
        p.wait()


print("group\tside\tcases\tdiffs\ttop signatures\texamples")
for g, side in GROUPS:
    if ONLY and g not in ONLY:
        continue
    parts = set(ALIASES.get(g, g).split("+"))
    ts = [f for f in ALL_TS if f not in parts]
    ks = [f for f in ALL_K if f not in parts]
    ns = [f for f in ALL_N if f not in parts]
    tsdir = f"{D}/out/ts-{tag(ALL_TS)}"
    kdir = f"{D}/out/k-{tag(ALL_K)}"
    if ts != ALL_TS:
        tsdir = f"{D}/out/loo-ts-{g}"
        shutil.rmtree(tsdir, ignore_errors=True)
        run_ts(ts, tsdir)
    if ks != ALL_K:
        kdir = f"{D}/out/loo-k-{g}"
        shutil.rmtree(kdir, ignore_errors=True)
        run_k(ks, kdir)
    out = f"{D}/cmp/loo-{TAG}-{g}.jsonl"
    subprocess.run(["python3", "-I", f"{TRIAL}/compare.py", LIST, tsdir, kdir, f"{D}/kcase", ",".join(ns) or "-", out],
                   check=True, stdout=subprocess.DEVNULL)
    rows = [json.loads(line) for line in open(out)]
    bad = [r for r in rows if r["status"] != "agree"]
    sigs = collections.Counter(s for r in bad for s in {d["sig"] for d in r.get("diffs", [])})
    nd = sum(len(r.get("diffs", [])) for r in bad)
    top = "; ".join(f"{s} x{n}" for s, n in sigs.most_common(3))
    print(f"{g}\t{side}\t{len(bad)}\t{nd}\t{top}\t{','.join(r['id'] for r in bad[:3])}", flush=True)
