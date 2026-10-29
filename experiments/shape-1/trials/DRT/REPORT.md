# DRT: differential test of the Lean kernel (shapek) against the TypeScript prototype (derive)

## 1. Hypothesis and falsification criterion

SEED.md has no DRT row; its hypothesis table covers only H1 to H6. The claim tested here comes from two places in SEED.md:
- invariant 7: "Meaning is defined once, in the kernel, and every implementation answers to it.";
- the decision "A checker you can audit: an executable Lean model, differential-tested against the TypeScript checker (the Cedar pattern)".

I propose the following. It was not pre-registered.

- **H-DRT.** On every input inside the kernel's fragment, shapek and derive produce the same obligation output. The kernel can therefore act as the reference.
- **Falsified if** on at least 2,000 generated in-fragment cases, plus every fixture that fits, any case differs because of an implementation bug in either program. A difference from a documented kernel gap or a spec ambiguity does not count.
- **Method criterion (the Cedar pattern is usable).** Every disagreement is traced to a named root cause, and the residual is 0 once all root-cause patches are on.

## 2. Verdict

**H-DRT is disproved for the kernel and prototype as built.**
- Implementation bugs alone make 2,212 of 4,000 corpus cases (55.3%) disagree.
  - Kernel-side bugs account for 1,505 cases; prototype-side bugs for 1,263.
- In the fitting fixtures, kernel bugs alone make 22 of 127 P/H4 cases and 129 of 636 H3 cases disagree.

**The method criterion holds.** Every disagreement was attributed to a root cause. With all switches on:
- the corpus agrees on 4,000 of 4,000 cases (21,788 obligations, 392,184 field comparisons);
- the fitting fixtures agree on 837 of 837.

The kernel is the less faithful of the two. It needed fixes for 20 bugs plus the kernel halves of 4 shared deviations, against 10 bugs plus 4 halves for the prototype. It cannot run dogfood-scale input: more than 3,600 s per case.

## 3. Method

### Corpus

The generator is gen.ts, driven by gen-corpus.ts. It builds inputs as follows:
- one module over std, with persons, teams and agents;
- 2 to 3 resources bound to pg.table and ts.call codes;
- 2 to 3 components, plus an optional boundary, with fixed globs;
- explicit unit binds in 85% of units;
- claims: effect, hatch, edge, path and cycle forbids; relations; summaries (with `via`); schema and informal laws; providers and provers; policy; exceptions.

It then applies 0 to 5 edit operators. Operator counts over the corpus:

| Operator | Count |
|---|---:|
| structure | 617 |
| actor | 606 |
| tier | 601 |
| appendOnly | 591 |
| owner | 589 |
| law | 587 |
| provider | 573 |
| summary | 570 |
| exception | 570 |
| forbid | 568 |
| boundary | 555 |
| policy | 540 |
| grants | 525 |
| addUnit | 137 |

Each input also gets manifests and signed records. Feature counts:

| Feature | Count |
|---|---:|
| judgment | 2,484 |
| policy | 1,840 |
| base-observation | 1,562 |
| agent-in-team | 1,412 |
| refactor-sensitive | 1,313 |
| prover | 982 |
| hatch-rule | 950 |
| new-file | 837 |
| new-fn | 714 |
| deleted-fn | 377 |
| stale-test | 358 |
| pkg-changed | 343 |
| harness-changed | 319 |
| stale-observation | 285 |
| via | 272 |
| proof | 249 |

Phase-2 review lines are derived from the unpatched prototype's phase-1 output: 1,556 cases have them. By mode, 3,419 cases are change and 581 are audit.

The generator avoids the kernel's documented out-of-fragment constructs:
- renames and `was`;
- path or binding changes (L6);
- an unreadable base (L0);
- absence-sound call or edge observers;
- unmapped vocabulary;
- relocation;
- equivalence records, ordered templates, Bounded<> templates and equal-specificity globs.

The corpus has two profiles:
- **fragment:** seeds r1 to r2500;
- **clean:** seeds c1 to c1500, retried until the unpatched prototype raises no error.

Regenerating the corpus reproduced all 4,000 files byte for byte.

### Fixtures

Each fixture source and whether it fits the fragment:

| Source | Count | Fit |
|---|---:|---|
| proto-inputs | 21 | all fit |
| H4/out | 122 | 106 fit; the 16 rename fixtures need ρ |
| H3/dump | 636 | all fit |
| H5/xcheck + dumptest | 74 | all fit |
| H2/kx + H3/dogdump | 44 | do not fit (time) |
| kernel/cases | 32 | do not fit (kernel format only) |

### Pre-pass

The pre-pass is in drtlib.ts. It is bridge.ts's kernelCase with four corrections:
1. Drop records the prototype rejects (RJ validation).
2. Use now* = max(now, base committer time).
3. Drop review lines whose change is not among the change ids.
4. Compute cells whenever there is a base outside audit mode. bridge.ts passed no cells when no component had globs, so the universe cell (ungoverned, ungoverned) was missing. This is HB1, found here.

### Comparison

compare.py compares exactly, case by case:
- the 18 core obligation fields: key, kind, reason, questions, introduced, severity, tier, budget, force, owner, group, claim {fp, ids, tier}, subject, witness, exploited, final, binding, exception;
- obligation order;
- errors with kernel codes (E-conduct, E-structure, E-provider-missing, E-exception), as (code, subject);
- answered, as (obligation, as);
- debt, as (obligation, exception, owner, expiresInDays);
- the verdict. Any other error code is a pre-pass error and forces the kernel verdict to blocked.

### Attribution

Each root cause is a switch.
- **Prototype causes** are applied by patch_proto.py to a scratch copy (protodbg), gated by DRT_FIX.
- **Kernel causes** are applied by patch_kernel.py to a scratch copy (kdbg), gated by "drtFix" in the case JSON.
- **Ambiguities** are either aligned on one side (Axx) or normalised in the comparator (Nx).

Three kinds of run:
- **ALL:** every switch on.
- **Leave-one-out (LOO):** ALL minus one cause. A pair of shared causes counts as one cause.
- **Class leave-one-out:** ALL minus a whole class.

I triaged every residual of each intermediate ALL run with why.py and KObDump (raw kernel internals) until none was left.

### Identity checks

- The prototype copy with no switch matches the original on 4,000 of 4,000 cases, ignoring the extra triage fields.
- The kernel copy with no switch matches the original on 4,000 of 4,000 corpus cases and 848 of 848 fixtures. The copy carries always-on, semantics-preserving performance patches: L1 hoisting, a single rawObs, and coverage tables.

## 4. Results

### 4.1 Agreement by configuration

**Corpus (4,000 cases)**

| Configuration | Agree | Differ | Distinct signatures |
|---|---:|---:|---:|
| As built, exact | 446 | 3,554 (88.9%) | 186 |
| As built + N1, N2, N3, NW | 1,308 | 2,692 | 170 |
| ALL | 4,000 | 0 | 0 |

- The as-built differences split by profile as 2,366 of 2,500 fragment cases and 1,188 of 1,500 clean cases.
- As built, 49 cases differ in the verdict itself.
- As built, the prototype has 22,085 obligations and the kernel 22,165. They share 21,498 keys, and 6,757 obligations differ in some field.
- Under ALL, both have 21,788 obligations, and all 392,184 field comparisons agree.

**Fixtures (853)**

| Configuration | Fitting fixtures (837): agree | Fitting fixtures: differ | Rename fixtures (16): differ |
|---|---:|---:|---:|
| As built, exact | 638 | 199 | 16 |
| As built + normalisations | 673 | 164 | 16 |
| ALL | 837 | 0 | 16 |

By source, as built and exact:
- P: 6 of 21 differ;
- H4: 80 of 122;
- H3: 129 of 636, all with the single signature `field:contradiction[sound,law]:witness:n1/n0`;
- H5: 0 of 74. The 5 H5 cases where the original kernel timed out at 300 s use the copy as a stand-in.

**Dogfood scale (44 inputs, 6.8 to 7.2 MB each)**

The input H2-A-C00 has 7,396 M_h entries, 418 claims, 102 units and 52 records.
- The prototype takes 5 to 6 s.
- The kernel copy timed out at 3,600 s, both with no fixes and with ALL.
- Per stage, parse plus canon alone takes 179 s; conductContras and lawObs each take more than 300 s.
- Trial H2 independently recorded the original kernel at more than 2,700 s (H2/kx/A-C00.lean.time).

These inputs do not fit. The other 43 were not run, being of the same size.

### 4.2 Root causes

"LOO cases" is the number of cases that disagree when only this cause is switched off. "fx" is the same count over the 127 fitting P and H4 fixtures.

**Prototype (TypeScript) bugs: 10**

| ID | Annex | Defect | LOO cases (corpus / fx) | Example |
|---|---|---|---|---|
| T1 | A.7.2.2, A.12.8.6 | Binding code rows are not a set: duplicate (x, own) rows | 142 / 0 | c1065 `field:coverage:binding` |
| T2 | A.5.4.3 | Law `reason` taken from records that do not apply (ineligible judge) or are inconclusive | 817 / 0 | c1004: reason assumption (prototype) vs weak (kernel) |
| T4 | A.6.3.3 | The owner role resolves to members including agents, not to persons | 19 / 0 | c111 `ob-only-ts:contradiction[sound,law]` |
| T8 | A.6.3.3 | Dangling else in eligibleByRole: explicitly listed judges are never eligible | 261 / 0 | c1011: reason missing vs expired |
| T10 | A.6.3.4, A.7.4.4 | Two distinct answerers demanded beyond final loosenings; one eligible answer should settle every coverage item | 73 / 0 | c1020 `ob-only-ts:coverage` |
| T11 | A.5.4.1 | A non-head record with empty deps is reused instead of being stale | 45 / 0 | c1053 |
| T13 | A.7.3.3 | A law contradiction is marked introduced through the producer-changed reason | 11 / 0 | c108: introduced True/False |
| T14 | A.4.2.1 | A self-loop is not treated as a cycle | 11 / 0 | c1131 |
| T16 | A.8.3.2 | L4 affected is all code of the targets, not the Req identities | 5 / 0 | r1279 |
| T17 | A.5.4.3 | Producer-changed affected includes implementation changes of inconclusive records | 3 / 0 | c113 |

**Lean kernel bugs: 20**

| ID | Annex | Defect | LOO cases (corpus / fx) | Example |
|---|---|---|---|---|
| K1 | A.7.2.2 | Coverage binding omits the (d, own) row per changed dependency | 458 / 0 | c1002 `field:coverage:binding` |
| K2 | records §5, A.7.1.1 | Law contradiction witness is empty; it should be the contradicting record | 401 / 0; H3 129 of 636 | c10 witness n1/n0 |
| K3 | A.7.6.5 | Coverage answer items wrong: they should be K plus every claim with an unmet pair | 115 / 0 | c1063 |
| K4 | A.7.2.2 | Producer-changed affected omits implementation finest changes | 260 / 0 | c1008 |
| K5 | A.8.2.2 | Actor subject tier is fixed at normal | 183 / 0 | c1007: L7 tier critical vs normal |
| K7 | A.6.2.1 | L7 heirs by equal NF only, without ⊒ | 68 / 0 | c105 |
| K7b | A.6.2.1/3/5 | tier\*, owner\* and R\* read only the equal-NF base claim | 5 / 0 | c928: owner m::Platform vs m::alice |
| K8 | A.5.4.2, A.7.3.1 | Observation usability ignores revision and deps; base reports come from non-base records | 109 / 0 | c1014 |
| K9 | A.5.2.13 | E-provider-missing raised without channel overlap, or satisfied by stale records | 82 / 0 | c1014 |
| K10 | A.4.5.1, A.7.4.2 | Relations (edge.exists) get no footprint and channels | 105 / 0 | c101 |
| K11 | A.4.4.11 | Edge-forbid support takes all edges between the nodes, not only the (s, k, t) edge | 26 / 0 | c328 |
| K12 | A.5.4.1, A.6.2.6c | An implementation digest change does not make a record producer-changed | 2 / 0 | c1248 |
| K14 | A.4.4.2 | Non-call edges inside one component are dropped | 15 / 0 | c1131 |
| K15 | A.4.4.11 | Path-forbid support lacks the forward and backward passes | 22 / 0 | c155 |
| K16 | A.8.3.1-2 | An L2 part is never exploited | 3 / 0 | c246 |
| K18 | A.4.4.2 | Summary sites omit atoms that W_decl declares for other units | 2 / 0 | c7 |
| K19 | A.4.4.11, A.7.3.1 | Structural support omits declared relation facts | 1 / 0 | r1029 |
| K20 | A.7.4.1 | The coverage set includes deleted identities | 1 / 0 | r2255 |
| K22 | A.3.3.2 | Units of path-less components never bind; the default should search ids(M_h). Trial H4 had already isolated this with its "prebind" variant | 0 / 19 | H4-cal1-removal-destructive.fwd |
| K23 | A.7.4.1 | The coverage set omits F_h(c) ∖ F_b(c) for upper bounds that have an equal-NF base claim | 0 / 3 | H4-governed_directory_moved.rev |

**Deviations shared by both: 4**

Both programs deviate from the annex here. "Both off" counts the disagreements when both halves are off; "T half / K half" switches off only one side.

| ID | Annex | Defect | Both off | T half / K half | Example |
|---|---|---|---:|---|---|
| T3 / K6 | A.8.2.2 | Provider subject tier. The prototype counts only effect forbids and authority; the kernel counts every non-law claim for any observer | 115 | 73 / 63 | r5, c1248 |
| T6 / K5J | A.8.2.2 | "Owns or judges": both ignore judges. Found by reading the annex | 0 | 3 / 3 | r687 |
| T15 / K17 | A.4.4.10/11/13 | Summary contradiction. The prototype keeps only calls on the shortest chain; the kernel has no call support and a wrong force rule | 11 | 1 / 11 | r130 |
| T18 / K21 | A.8.4.2, A.8.3.1 | Neither runs L3's first pass over W_eval. The kernel orders edge-forbid counterexamples by (kind, to); the prototype counts only observed edges as realised | 2 | 5 / 5 | r1460 (kernel says exploited, prototype not), r2307 (the reverse) |

**Kernel gaps: 6**

These are emulated in the prototype copy.

| ID | Status | Gap | LOO cases (corpus / fx) | Example |
|---|---|---|---|---|
| G1 | documented | Exploitation through uncovered changed code (A.8.3.1, second clause) | 109 / 0 | c1074: L1 exploited |
| G2 | documented | Test or proof cone not closed under observed calls | 16 / 0 | c1064 |
| G3 | documented | L6 not implemented. The generator leaked it through addUnit | 6 / 10 | r1097 |
| GL | documented | Refutation of lower bounds (effects.lower, edge.exists) | 1 / 0 | c1021 |
| GV | undocumented | The kernel parser drops `a via v` in summaries (A.4.4.4) | 70 / 0 | c1088 |
| GR | undocumented (only "no ρ-renamed fps" is mentioned) | No ρ: no rename inference (A.8.1); the prototype applies rule 3, "hint" | 0 / 16 rename fixtures, excluded as out of fragment | H4-renamed_component.fwd: L3 undecided only in the prototype |

**Spec ambiguities: 16**

| ID | Question the annex leaves open | LOO cases (corpus / fx) |
|---|---|---|
| A4 | Is a pkgjson or gha identity command code only when marked executable? | 685 / 0 |
| A6 | Debt owner: the obligation's owner\* or the exception's owner? | 385 / 0 |
| A7 | How is a law with an empty Req attributed? | 74 / 0 |
| A8 | Is coverage met by a complete entry on an ancestor? | 189 / 0 |
| A9 | L3 affected: code of the claim's sources, or of the counterexample's sources? | 36 / 0 |
| A10 | Groups join by shared support facts or by affected finest changes | 38 / 5 |
| A11 | Path forbids with s = t | 22 / 0 |
| A12 | Is a removed law "changed" or "removed"? | 11 / 0 |
| A13 | A unit without a summary: L2 unknown or L2 removed? | 8 / 1 |
| A14 | Does a fact anchor to the nearest usable entry? | 2 / 0 |
| A15 | L2 affected for a removed unit: base binding over M_h, or empty? | 0 / 8 |
| A16 | Does an unbound unit contribute a Req pair? | 0 / 2 |
| N1 | Error subjects and granularity are unspecified; compare the set of codes | 2,495 / 5 |
| N2 | The `claim` field of a loosening obligation | 964 / 56 |
| N3 | Is E-exception raised by the elaborator or the kernel? | 324 / 0 |
| NW | Canonical witness, or all support facts? | 74 / 2 |

**Harness bug: 1**

HB1: bridge.ts omitted the universe cell. Fixing it changed 103 H4 kernel cases. It removed 8 disagreements at the normalised baseline and 9 under ALL. The corpus was unaffected: all 4,000 kernel cases are byte-identical.

**No measured effect, so not counted as causes**

- KW, the kernel witness representative: 0 kernel outputs changed, alone or within ALL.
- A5, explicit team judges resolved to persons: 0 prototype outputs changed.

### 4.3 Class-level counts

Each figure is the number of cases that disagree when only that class is left unaddressed.

| Class | Corpus (4,000) | P + H4-fit (127) |
|---|---:|---:|
| Prototype bugs | 1,206 | 0 |
| Lean bugs | 1,458 | 22 |
| Shared deviations | 126 | 0 |
| All prototype-side (bugs + T halves) | 1,263 | 0 |
| All kernel-side (bugs + K halves) | 1,505 | 22 |
| Any implementation bug | 2,212 | 22 |
| Gaps | 194 | 10 |
| Ambiguities (A + N) | 3,221 | 61 |

In H3, K2 alone accounts for all 129 disagreements: ALL minus K2 reproduces exactly those 129 cases.

### 4.4 Performance

| Program | Set | Mean | Median | p99 | Max | Total |
|---|---|---:|---:|---:|---:|---:|
| Original kernel | corpus | 1.04 s | 0.27 s | 10.0 s | 42.5 s | 4,158 s |
| Patched copy (no fixes) | corpus | 0.052 s | 0.037 s | 0.20 s | 0.35 s | 206 s |
| Prototype | corpus | 0.016 s | | | 0.26 s | 62 s |
| Original kernel | fixtures | | | | 274 s | 2,733 s over 848 cases; 5 timeouts at 300 s, all H5 |
| Patched copy | fixtures | | | | 159 s | 856 s over all 853 |

Speculation: most of the cost is quadratic list code, namely insertion-sort sortStrs with a `contains`-based deduplication, and repeated rawObs.

## 5. Exact commands

```
R=/home/user/shapelang
T=$R/experiments/shape-1/trials/DRT
D=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/DRT
export PATH=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/lean/lean-4.34.0-linux/bin:$PATH

# Scratch copies. kdbg/lakefile adds the exes kobdump, ktime, kdump; Kernel.orig is pristine.
python3 -I $T/patch_proto.py $R/experiments/shape-1/proto/src $D/protodbg
cd $D/kdbg && rm -rf Kernel && cp -r Kernel.orig Kernel && cp $R/experiments/shape-1/kernel/Kernel.lean Kernel.lean \
  && python3 -I $T/patch_kernel.py $D/kdbg && lake build

# Corpus
for i in 0 1 2 3; do bun $T/gen-corpus.ts $D/corpus/random 1 2500 --shard $i/4 & done; wait
for i in 0 1 2 3; do bun $T/gen-corpus.ts $D/corpus/clean 1 1500 --profile clean --shard $i/4 & done; wait
for i in 0 1 2 3; do bun $T/prep.ts $D/corpus/all.tsv $D/kcase $D/out/ts-base --shard $i/4 & done; wait   # (from $R)

# Original kernel (also run on corpus/fixtures.tsv with a 300000 ms limit)
for i in 0 1 2 3; do bun $T/run-k.ts $R/experiments/shape-1/kernel/.lake/build/bin/shapek $D/corpus/all.tsv $D/kcase $D/out/k-orig - 600000 --shard $i/4 & done

# Baseline comparisons
python3 -I $T/compare.py $D/corpus/all.tsv $D/out/ts-base $D/out/k-orig $D/kcase - $D/cmp/base-raw.jsonl
python3 -I $T/compare.py $D/corpus/all.tsv $D/out/ts-base $D/out/k-orig $D/kcase N1,N2,N3,NW $D/cmp/base-norm.jsonl

# ALL
TSALL=T1,T2,T3,T4,T6,T8,T10,T11,T13,T14,T15,T16,T17,T18,A5,A6,A7,A15,A16,G1,G2,G3,GV,GL
KALL=K1,K2,K3,K4,K5,K5J,K6,K7,K7b,K8,K9,K10,K11,K12,K14,K15,K16,K17,K18,K19,K20,K21,K22,K23,KW,A4,A8,A9,A10,A11,A12,A13,A14
python3 -I $T/run_cfg.py $D $D/corpus/all.tsv $TSALL $KALL N1,N2,N3,NW all10 4

# Attribution: every cause, then single halves and classes
python3 -I $T/loo.py $D $D/corpus/all.tsv corpus
python3 -I $T/loo.py $D $D/corpus/all.tsv corpus KW+NW T3 K6 T6 K5J T15 K17 T18 K21
python3 -I $T/loo.py $D $D/corpus/all.tsv corpus CLS-TS CLS-K CLS-BOTH CLS-GAP CLS-AMB CLS-KALL CLS-TSALL CLS-BUGS
python3 -I $T/loo.py $D $D/corpus/fx-fit-small.tsv fxs [same group lists]
python3 -I $T/loo.py $D $D/corpus/h3.tsv h3 K2

# Triage of one case
python3 -I $T/why.py $D <case> $TSALL $KALL
```

Checks:
- `node_modules/.bin/oxlint --deny-warnings experiments/shape-1/trials/DRT/` reports 0 findings. I fixed 3 lint errors in gen.ts without changing behaviour; the corpus still regenerates byte for byte.
- `bun run typecheck` exits 0.

## 6. Threats

- **Bug versus ambiguity is my judgment.** Each patch is my reading of annex v6, and a different reading moves cases between classes.
- **Shared misreadings stay invisible.** For example, neither implementation applies A.6.2.3's witness condition.
- **Leave-one-out counts are lower bounds** where causes are redundant (for example P-ex4), and interactions mean they do not sum to the baseline.
- **The normalisations hide real output differences.** N1 alone covers 2,495 cases.
- **The generator is biased.**
  - It avoids out-of-fragment features by design.
  - 93.7% of verdicts are blocked; the field comparisons carry the signal.
  - It still leaked L6 (6 cases) and a lower bound (1 case), and its `via` feature hit an undocumented gap (70 cases).
- **Kernel-copy identity is empirical.** It rests on 4,848 cases and is not proved.
- **Fixture fit was decided after the fact.** The 16 rename fixtures were excluded once I found the kernel has no ρ.
- **Only 1 of 44 dogfood inputs was tried**, at a 3,600 s limit.
- **Timings were taken on 4 cores under parallel load.**
- **The patches exist only in scratch copies.** The original kernel and prototype are unchanged.

## 7. Spec implications

1. **The kernel is not yet a reference.** Use the annex plus test vectors as the reference until the kernel-side fixes land and DRT reaches 0 residual.
2. **Gate releases on DRT.** Run the generator, the fixtures and the comparator, and require 0 residual. Write the 16 ambiguity readings into the annex so that N1 to NW can be removed. The most urgent are error subjects, the loosening `claim` field and the witness.
3. **Give the kernel a checkable fragment.** Document `via` and ρ, and have the kernel flag out-of-fragment input rather than answer it.
4. **Use per-rule vectors derived from the annex.** Differential testing cannot catch the misreadings both implementations share.
5. **Remove cells from the input**, or specify the pre-pass.
6. **Fix the kernel's complexity** before using it as a CI oracle.
