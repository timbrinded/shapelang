# H3: behavioural bugs inside laws (Shape 1.0, v6 model)

## Hypothesis and falsification criterion (SEED.md)

**H3.** Behavioural bugs inside a law's jurisdiction do not merge.

**Falsified if** planted bugs survive at a higher rate than the tested scope's measured miss rate.

How the terms are used here:
- The **tested scope** is the executable law tests: the agent-written g8 suites for T1, T3 and T4, and the dogfood law tests.
- A planted bug **survives** when the change does not block on a law obligation, that is, it would merge with at most owed work.
- The checker under test is the v6 prototype (`experiments/shape-1/proto/src/derive.ts`), cross-checked against the Lean kernel `shapek`.

## Verdict: disproved for v6 as specified

H3 holds in three settings:
- laws bound `on component`;
- the provider re-runs at head and emits counterexamples;
- either of two one-rule amendments, V-new or V-new2, in every binding.

H3 fails with the spec's own canonical law form, a unit-bound template (`Property<F,…>`, `Deterministic<F>`). It also fails with the stock laws-provider route at normal tier.

In those settings, bugs the tests catch merge as "preexisting" owed contradictions:
- 29/43 law-tagged changes blocked (32.6% survive) against a 0% miss rate;
- in Shape's own code, 11 of 24 (45.8%) test-killed mutants were not blocked by the law that caught them.

The cause is one rule. Model §7.3 / A.7.3.3 counts a law obligation as introduced only if `Req(c)` meets Δcode. A unit's digest resolves its callees by identity, not by content (A.5.7.2), so a bug in a callee never meets Req.

## Method

### Subjects

These are the Bend-probe generation tasks in their TypeScript form (`bendexp/tasks`, `hidden`, `g8`):

| Task | Law-tagged mutants | Traps | Feature-only mutants | Refactors (mine) | Law-preserving feature changes |
|---|---|---|---|---|---|
| T1 wrap board | 13 | 1 | 7 | 13 | ref + 3 alternative solutions |
| T3 audit log | 14 | 1 | 5 | 13 | ref |
| T4 ledger | 12 | 2 | 6 | 13 | ref |

That is 106 (base, head) variants:
- mutants and refactors use base = the reference solution;
- traps and feature changes use base = the pre-feature code.

"Law-tagged" means the harness manifest lists a broken contract law. T1 has 13 such mutants, not the 11 that DESIGN.md's prose says; m18 and m19 are tagged too.

### Tested scope

The agent-written suites in `g8/<T>/test/laws.test.ts`.

### 1.0 model (per task, `lib.ts` `sourceFor`)

- **Translated from 0.x:**
  - shape owner team Maintainers (alice, bob) and an agent codeAgent;
  - resources;
  - a component with `paths: ["src/**"]`, grants, and units bound `ts("src/<m>.ts#f")` with `effects complete` summaries;
  - T3 `AuditLog : AppendOnly`;
  - T4 `Conserved` with final forbids of HardDelete and Truncate.
- **Laws:** one `Contract<"Lk: text">` law per contract law, `evidence tested by lawSuite`.
- **Provider:** `lawSuite` produces test, decides `template Contract`, `sound presence`, trusts bun, `implementation paths ["package.json"]`.
- **Binding arms:**
  - **C:** `on component K`. Req is every unit at `unit` plus the module file at `own`.
  - **N:** `on unit K.f` for each API function the law's statement names. For example, T1 NoWin binds `isWon, replay, start`.
  - **P:** one principal unit, the dogfood `Property<F, text>` convention. For example, T1 NoWin/FlagUnreachable/FlagIsLive bind `step`, ReplayInOrder binds `replay`.
- **Tiers:** normal or critical, under DefaultPolicy.

### Provider adapter (built here, `lib.ts`)

The stock `laws run --bind` turns a failing plain bun:test file into `inconclusive`. My adapter does the following:
- runs the suite with `bun test --reporter=junit`;
- maps each test case to a law by its name;
- emits one signed in-toto Test Result record per law claim through the prototype's `emit`, citing:
  - code = Req(c, test), computed with the prototype's `reqOf`;
  - deps = the module closure;
  - harness = the law file.

A failing test with an error message becomes `contradicts`, with that message as the counterexample. An `inconcl` mapping reproduces the stock behaviour.

### Regimes

| Regime | Evidence the change carries | Provider |
|---|---|---|
| R1c | provider re-run at head; failure → `contradicts` with counterexample | authenticated |
| R1i | provider re-run at head; failure → `inconclusive` (stock `--bind`) | authenticated |
| R2u | base records only | unauthenticated, `deps complete` |
| R2a | base records only | authenticated, `deps complete` |
| R2r | base records only | authenticated, revision-tied (default) |

### Checkers

- **Stock:** the v6 prototype.
- **V-new** (`variant-checker.ts`): a copy of `proto/src` with one change to `laws.ts`. A sound law contradiction is also introduced when the contradicting record's code ∪ deps meets Δcode and no base-revision record contradicted the claim.
- **V-new2:** additionally, a contradiction the base already had is not re-introduced by an edit inside Req.
- **Kernel:** `shapek`, run on every critical-tier R1c, R2u and R2a input (954 cases).

Scale:
- 3 arms × 2 tiers × 5 regimes × 106 variants = 3,180 derives per checker;
- median derive 17 ms, p95 74 ms;
- V-new2 was replayed on the 636 dumped critical-tier R1c/R2u inputs.

### Dogfood

The subject is Shape's own model (`experiments/shape-1/dogfood`). It has 19 tested laws that hold at base, bound by `Property<F,…>` to 12 distinct units; most are critical.

1. **Screen** (`dogfood-screen.ts`):
   - Take the laws provider's operator mutants (`mutate.ts`): up to 6 per location, in the bound unit, its same-file callees, and its cross-file (imported) callees.
   - Run each against that law's own test in a materialised tree.
2. **Derive** (`dogfood-run.ts`):
   - For up to 2 killed mutants per law and location (24 in all) and 12 refactors I wrote, rebuild the tree.
   - Re-run bunTest, tsClockScan and tsCalls at head (regime R1c).
   - Derive against the base: revision 95b84025…, with 52 base records including base law records.

### Commands (repo root)

```
bun experiments/shape-1/trials/H3/validate.ts T1 > validate-T1.json        # also T3, T4
bun experiments/shape-1/trials/H3/run.ts --tasks T1 --out rows-T1.jsonl \
    --kernel experiments/shape-1/kernel/.lake/build/bin/shapek --dump dump/  # 451 s; T3 970 s; T4 442 s (run concurrently)
python3 -I experiments/shape-1/trials/H3/analyze.py data/summary.json rows-T*.jsonl --validate validate-T*.json
bun experiments/shape-1/trials/H3/dogfood-screen.ts --out dog-screen.json --per 6
bun experiments/shape-1/trials/H3/dogfood-screen.ts --out dog-screen-import.json --per 6 --where import --box screen2
bun experiments/shape-1/trials/H3/dogfood-run.ts prep --work dogrun                       # 41 s
bun experiments/shape-1/trials/H3/dogfood-run.ts run --work dogrun --screen dog-screen.json,dog-screen-import.json --per 2 --shard i/3 --dump dogdump   # about 30 s per variant
python3 -I experiments/shape-1/trials/H3/dogfood-analyze.py data/dog-summary.json dogrun/base.json dog-screen.json,dog-screen-import.json dogrun/dog-rows-*of3.jsonl
bun experiments/shape-1/trials/H3/replay-dumps.ts --out replay-T.jsonl dump/*.json
bun experiments/shape-1/trials/H3/replay-dumps.ts --out replay-dog.jsonl dogdump/*.json
python3 -I experiments/shape-1/trials/H3/replay-analyze.py data/replay-summary.json replay-T.jsonl rows-T*.jsonl -- replay-dog.jsonl dogrun/base.json dogrun/dog-rows-*of3.jsonl
bun experiments/shape-1/trials/H3/probe.ts T1 <ref game.ts> <mutant.ts>   # one pair, every arm and regime
```

Bulky outputs are under `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H3/`. `bun run typecheck` and `oxlint` pass; nothing was committed.

## Results

### 1. Tested scope

| | Law-tagged changes | g8 suite kills | C1 reference suite kills | Hidden law tests kill |
|---|---|---|---|---|
| T1 | 14 | 14 | 14 | 9 (hidden [law] tests cover L1/L2 only) |
| T3 | 15 | 15 | 15 | 15 |
| T4 | 14 | 14 | 14 | 14 |
| **Total** | **43** | **43 (miss rate 0%)** | **43** | 38 |

The g8 suites fail on none of the 39 refactors or the 6 law-preserving feature changes, and on none of the 18 feature-only mutants. The C1 suites and the hidden tests (feature and law) also pass on all 39 refactors and 6 feature changes.

### 2. Kill rate on law-tagged changes

A change counts as blocked when it has a blocking law obligation or an E-provider-missing error. All 43 changes raised at least one law obligation in every configuration; the table shows how many were blocking.

| Regime | Tier | C stock | N stock | P stock | V-new / V-new2 (C, N, P) |
|---|---|---|---|---|---|
| R1c | normal | 43/43 | 33/43 (76.7%) | 29/43 (67.4%) | 43, 43, 43 |
| R1c | critical | 43/43 | 33/43 | 29/43 | 43, 43, 43 |
| R1i | normal | **0/43** | **0/43** | **0/43** | 0, 0, 0 |
| R1i | critical | 43/43 | 33/43 | 29/43 | 43, 33, 29 (V-new) |
| R2u | normal | **0/43** (owed stale) | 0/43 | 0/43 | same as stock |
| R2u | critical | 43/43 | 33/43 | 31/43 | same as stock |
| R2a | either | 43/43 (E-provider-missing) | 43/43 | 43/43 | same |
| R2r | either | 43/43 (E-provider-missing) | 43/43 | 43/43 | same |

The R1c survivors under the stock checker, all as owed "preexisting" sound contradictions:

- **Arm N (10, all T1):**
  - the trap, which changes upY, downY, leftX and rightX;
  - m01 to m04, m06 and m18, which change `isWall`;
  - m05 and m11, which change the private helper `moveTo`;
  - m10, which changes the private helper `onFlag`.

  None of these identities is a unit the law names, and the unit digests of `step`, `replay` and `isWon` do not move. A concrete case: `probe.ts T1 ref m01` gives verdict `owed`, with `contradiction:NoWin:sound:pre:owed` and `contradiction:FlagUnreachable:sound:pre:owed`. In arm C the same change is `blocked`.
- **Arm P (14):** the 10 above, plus:
  - T1 m07, where `isWon` is not the principal unit;
  - T3 m09, which changes `purge`, while the contradicted laws L0 and L5 are bound to `get` and `append`;
  - T3 m10;
  - T3 m12, which changes `list`.

**Kernel cross-check.** `shapek` and the stock prototype were identical on 954/954 cases: verdict, error codes, law obligations, and every obligation key. Both checkers implement the stock rule (`Kernel/Laws.lean`: `introduced := hasBase && (lawReqInDelta … || producerChanged)`), so the kernel shows the same survivals.

### 3. False obligations on law-preserving refactors (39) and feature changes (6)

A refactor is flagged when it has any law obligation or E-provider-missing error, and blocked when that is blocking.

| Regime | Tier | Flagged (C / N / P) | Blocked (C / N / P) |
|---|---|---|---|
| R1c | either | **0/39 / 0/39 / 0/39** | 0 / 0 / 0 |
| R1i | either | 0/39 | 0 |
| R2u | normal | 33/39 (84.6%), stale, in every arm | 0 |
| R2u | critical | 33/39 | 33 / 24 / 21 of 39 |
| R2a | either | 33/39 | 33/39 (E-provider-missing) |
| R2r | either | 39/39 | 39/39 (E-provider-missing) |

- **Same in every checker:** V-new and V-new2 change only contradictions, so they give identical refactor rows.
- **Law-preserving feature changes:** 0/6 flagged in R1c.
- **Never flagged in any regime (6/39):** the formatting-only and line-comment-only refactors, r02 and r13 in each task; no digest moves.
- **JSDoc-only edits (r01) are flagged:** the prototype treats JSDoc as non-inert, so the file digest moves and the deps go stale.
- **Non-law obligations in R1c:** 25/39 refactors end `owed`, because conduct summaries need a `call(ts)` channel that no provider observes, so every edited unit raises coverage. The other 14 `pass`.

### 4. Dogfood (Shape's own laws, R1c, all three providers re-run)

**Screening: what the law tests themselves catch, among candidate mutants**

| Location | Killed by the law's own test |
|---|---|
| bound unit | 23/85 (27.1%) |
| same-file callee | 12/84 (14.3%) |
| cross-file callee | 12/54 (22.2%) |

The units of lowerChange and findShortestPath are one- and three-line wrappers with no mutable operators, so all of their laws' behaviour lives in callees.

**Derived changes: 24 test-killed mutants**

| Location | n | Stock: law-blocked | V-new / V-new2: law-blocked |
|---|---|---|---|
| bound unit (in Req) | 13 | 13 | 13 |
| same-file callee | 7 | **0** | 7 |
| cross-file callee | 4 | **0** | 4 |
| **All** | 24 | **13 (54.2%)** | **24** |

- **Per (mutant, failing law) pair:** 70 pairs, 66 sound contradictions and 4 unestablished (a law file crashed). The stock checker blocks 19 of these pairs and V-new 66.
- **Change verdict under the stock checker:** 23/24 changes are `blocked`. For 10 of the 11 out-of-Req mutants, the only blocking obligation is an introduced critical coverage obligation, which one `shape approve` line discharges. The law contradiction stays owed, so the bug merges after an approval that never mentions the law.
- **Merges outright:** M-UpdateDraftsPreferUnknown-callee-1 (uniqueFunctionName `+→-`) has verdict `owed`.

**Dogfood refactors (12)**

- **Tested laws:** 0/12 refactors raise an obligation on a tested law, and 0/12 make one fail.
- **Informal laws (judgment):** 7/12 raise an owed `unestablished missing` obligation on an informal law (DocumentedBy, RefactorSensitive), as designed.
- **Coverage:** 11/12 introduce coverage.
- **D10** (a local rename in formatShapeModule) **re-introduces 2 blocking contradictions** of the two already-failing formatter laws under stock and V-new, because their Req moved. Under V-new2 that drops to 0.
- **D02** (an inert line comment) moved guards.ts@file. The cause is a fingerprint defect: the raw comment scanner loses sync after a `${…}` template at line 81, so a later comment is kept in the file canonical text. That move introduced the RuleEngineDocumented informal-law obligation.

## Answers to the brief

- **Kill rate on law-tagged mutants:**
  - stock R1c: 100% with component binding, 76.7% (N) and 67.4% (P) with unit binding;
  - 100% under V-new and V-new2;
  - 0% under the stock `--bind` mapping or without a re-run at normal tier.
- **False-obligation rate on refactors:**
  - 0% (0/39) when providers re-run;
  - 84.6% stale without a re-run, blocking 54–85% of refactors at critical tier;
  - 100% blocked when an authenticated, revision-tied provider is not re-run.

## Threats

- **Mutants:** the T-task mutants are harness-designed and the dogfood mutants are operator swaps. The g8 suites are unusually strong (0% miss), so any loss counts as falsification.
- **Provider adapter:** the contradicts-with-counterexample adapter is mine. The stock provider gives regime R1i.
- **Binding arms:** the arms and models are my translations. P's principal-unit choice is a judgment call; N is mechanical.
- **Refactors:**
  - I wrote them; 2 of 13 per task are digest-invisible by construction.
  - r06 (T1) changes `isWall` behaviour off the board, which the API leaves unspecified.
- **Counterfactual checkers:** V-new and V-new2 are patches to a copied prototype. They are not in the kernel and not proved.
- **Dogfood:**
  - Judged per law.
  - A sample of 24 mutants.
  - No kernel run; shapek timed out at 2,700 s on dogfood inputs in H2.
- **Other limits:**
  - The T-task modules are single files.
  - Only DefaultPolicy was used.
  - TypeScript 6.0 is used for fingerprints.

## Files

Under `experiments/shape-1/trials/H3/`:

- **Library and model:** `lib.ts` (tasks, 1.0 model, provider adapter, derive), `variants.ts`.
- **Matrix runs:** `validate.ts`, `run.ts`, `variant-checker.ts`, `replay-dumps.ts`, `probe.ts`.
- **Analysis:** `analyze.py`, `replay-analyze.py`, `dogfood-analyze.py`.
- **Dogfood:** `dogfood-screen.ts`, `dogfood-run.ts`, `dogfood-refactors.ts`.
- **Refactors:** `refactors/T1|T3|T4/` (39).
- **Data:** `data/{summary.json, replay-summary.json, dog-summary.json, dog-screen.json, dog-screen-import.json}`.
- **Bulky outputs:** `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H3/`, containing `rows-T1|T3|T4.jsonl`, `validate-T*.json`, `dump/`, `dogrun/`, `dogdump/`, `replay-T.jsonl` and `replay-dog.jsonl`.
