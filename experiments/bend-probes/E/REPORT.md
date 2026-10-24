# Bend probes, track E/F: E2, E3, E4, E5, F1

Date: 2026-10-24. Shape CLI 0.10.0 run from source with Bun 1.4.2.

- `X` = `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp`.
- Scratch dependencies (`typescript@5.6.3`, `fast-check@3.23.2`) are in `$X/work/E/deps`.
- Seeded violations live only in copies under `$X/work/E/e5/`.
- Outputs are under `$X/work/E/`.

| ID | Verdict | Key numbers |
|---|---|---|
| E2 | disproved | `--check-loosening` matches 1 of 2 guard fixtures, and only incidentally; it passes policy-removal silently. A 170-line inspect diff matches 2/2. |
| E3 | asserted | A purpose-written scan finds 2/2 documented gaps; existing `shp` commands find 0/2. |
| E4 | disproved | 32.2% of conformance claims are deterministically checkable; 63.5% if effect entries are not counted one by one. |
| E5 | asserted | 94.4% of memories translate (83.3% strict); 5/5 checks pass on current source and fire on a seeded violation. |
| F1 | asserted | Intended behaviour synthesised for 6/6 targets (Nat) and 5/6 (JS); every target admits unintended solutions under the author's laws. |

## E2: loosening check on the guard fixtures

**Hypothesis.** `shp check --check-loosening` already reproduces the guard skill's expected verdicts on both guard fixtures. Falsified if either fixture differs.

**Expected verdicts.** `cases.json` requires only that `bun shp check <candidate>` exits 0, and the release config has no evidence markers for the guard cases. The classification therefore comes from the skill itself:

- **policy-removal.** `SKILL.md` uses this diff (`resource AuditEvent : AppendOnly` becomes `resource AuditEvent`) as its canonical finding, and `references/signals.md` lists removal of "a resource protection trait" as high impact. Expected: `advisory`, one finding `high / none / suspicious`, signal `constraint-removal`.
- **equivalent-relocation.** Expected: `pass`, no findings (`examples.md`, "Equivalent Relocation").

**Method.**

- **Fixture repos.** `e2-loosening.sh` builds one scratch git repository per fixture. Tag `base` holds `base/`, HEAD holds `candidate/`, and `changed.txt` comes from `git diff --name-only`.
- **Commands.** Each repository runs `shp check`, then `shp check --changed-files changed.txt --base-ref base --check-loosening`, then the same with `--base-model <git archive of base>`.
- **Controls.** Two controls make the same edit with a component present.
- **Semantic diff.** `e2-semantic-diff.ts` diffs `shp inspect --json` with file locations stripped, adds `shp memory` for rationale, and codes the impact table in `signals.md` as rules.
- **Calibration.** `e2-calibration.ts` encodes the 8 cases in `examples.md` and runs both tools on each.

**Result.**

| Run | Output | Expected | Match |
|---|---|---|---|
| policy-removal, `--base-ref` and `--base-model` | exit 0, `Shape check passed.` | high/none/suspicious | no |
| equivalent-relocation, both modes | exit 0, passed | pass | yes |
| Control: trait removed, and `fn deleteEvent` emits `HardDelete<AuditEvent>` | exit 1, `error: rule loosening`, quoting the silenced `forbidden effect` | high/none/suspicious | yes |
| Control: trait removed, and the component uses only `Append` | exit 0 | high/none/suspicious | no |
| Semantic diff, policy-removal | `high/none/suspicious constraint-removal` | same | yes |
| Semantic diff, relocation | 0 semantic changes, pass | pass | yes |

The check reports an edit only when restoring the base version brings back an error. Its documentation says "an edit that silences nothing ... is not reported". Nothing in the policy-removal fixture depends on the trait, so the edit passes. Relocation passes for the same reason a plain deletion would, which is why its match is incidental.

Calibration on the 8 cases in `examples.md` (finding vs no finding):

| Case | `--check-loosening` | Semantic diff |
|---|---|---|
| 1. Removal + destructive effect | match | match |
| 2. Supported loosening (rationale) | miss | match (high/specific/supported) |
| 3. Relocated rule | match | match |
| 4. Protected → AppendOnly | match | miss (flags removal) |
| 5. Forbid path narrowed + provides route added | match | match |
| 6. Vendored trait loses its final forbid | miss | miss (no traits in inspect) |
| 7. Generic attestation | miss | miss (no attestations in inspect; "generic" is a judgment) |
| 8. `effects unknown` → empty `complete` | miss | match |
| **Agreement** | **4/8** | **5/8** |

**Verdict: disproved.**

- `--check-loosening` reproduces 1 of the 2 fixtures, and that one only incidentally.
- A ~170-line inspect diff reproduces both fixtures and 5 of the 8 calibration cases.
- "Support" (whether a loosening is justified) is only approximated, by matching a new rationale's target.

**Threats.**

- Only 2 fixtures and 8 hand-encoded cases.
- The diff rules were written from `signals.md`.
- `inspect --json` exposes no trait declarations and no attestations.

## E3: deterministic extraction of index gaps

**Hypothesis.** Deterministic extraction finds at least half of the documented gaps in `coverage-gaps`.

**Expected outcomes.** The release markers are `[UploadApi, acceptImage]`, `[ThumbnailWorker, resizeImage]`, `binding` and `docs/images.md`. The gate test accepts the evidence "acceptImage calls resizeImage, while docs/images.md requires a missing binding".

- **G1.** A missing relation, `calls UploadApi -> ThumbnailWorker`.
- **G2.** A missing binding from `src/upload.ts`, `src/worker.ts` and `shape/system.shape` to `docs/images.md`.
- **G3.** An ordering gap, from the skill's step 4 rather than the markers. The doc says uploads complete only after the worker accepts the resize, which calls for a `coordinated_call` or a memory.
- **missing-ast.** Proceed with source navigation, do not run the generator, and record that AST is absent.
- **no-invariant.** Classify `formatLabel` as not architecture-significant.

**Method.**

- The fixtures were copied, at their repository paths, into a git repository at `$X/work/E/e3/root`.
- `shp` commands tried:
  - `check --check-cited-paths`;
  - `check --changed-files` with all 4 files;
  - `coverage`;
  - `analyze --shape-files`;
  - `ast source`, both to stdout and with `--include-ast-layer`.
- `e3-index-scan.ts` combines:
  - `inspect --json`;
  - a call graph built with the TypeScript type checker (`callgraph.ts`);
  - fixed regexes over Markdown;
  - glob coverage;
  - a pure-leaf proxy (no imports, calls, I/O or throws).
- `e3-robustness.sh` applies the suggested fixes and rescans, then perturbs the doc wording and the call syntax.

**Result.**

| Expected | `shp` only | Scan |
|---|---|---|
| G1 calls relation | missed: every command passes, `ast source` emits only `generated_from`, and the AST layer has an unnamed `call_expression` | found (`acceptImage` awaits `resizeImage`) |
| G2 binding | missed: `check --changed-files` passes with the doc changed | found, with exactly the 3 expected `when_changed` paths |
| G3 ordering | missed | found as a candidate |
| missing-ast decision | n/a | found (fixed rule) |
| no-invariant decision | n/a | found (proxy rule) |

With the suggested shapes applied to a copy, `check` passes and the scan reports 0 gaps. Changing `upload.ts` without the doc then fails with `bound docs change missing`.

Robustness:

| Perturbation | Detected |
|---|---|
| Paraphrases of the doc's review sentence | 3/6 |
| Paraphrases of the doc's ordering sentence | 1/4 |
| Call-syntax variants (alias, namespace import, arrow function, dynamic import, call via array), type-checker call graph | 6/6 |
| The same variants, first version of the scan (named-import identifiers only) | 2/6 |

**Verdict: asserted.**

- The scan finds both marker-required gaps, plus G3 as a candidate. Existing `shp` commands find neither.
- This needs a purpose-written scan.
- The doc gap depends on regexes, which caught only half of the paraphrases.

**Threats.**

- One small fixture, and the rules were written with it in view.
- Architecture significance and "strongest honest representation" remain judgments.

## E4: verification routes for Shape's own claims

**Hypothesis.** At least 60% of the source-conformance claims in Shape's own model are deterministically checkable, by call graph, purity scan, types or a law.

**Method.** `e4-classify.ts` enumerates atoms from `shp inspect --json` over the 6 `shape/*.shape` files (generated AST excluded), plus 1 rationale from `shp memory`. Each atom gets one route:

- (i) already enforced;
- (ii) checkable now;
- (ii-b) checkable only after a binding from resource to code is authored;
- (iii) a behavioural law;
- (iv) judgment.

Routes by kind:

| Kind | Route |
|---|---|
| Resources and components | vocabulary, not conformance claims: (iv) |
| Grants, fn traits, bindings, rule clauses | (i), not conformance claims |
| Anchored fn source refs | (ii) |
| File-only fn source refs | (i), because `--check-cited-paths` runs in `shape:ci` |
| `calls` / `coordinated_call` relations | (ii) when both endpoints have code anchors |
| `owns`, effect entries, `provides`, effects-complete closures | (ii) only if every resource involved has a code-level name; otherwise (ii-b) |
| Implementations | (ii) |
| Descriptions | by hand (`e4-descriptions.json`) |
| Memories | from E5 |

Not counted: 66 reevaluations and 1 attestation, which are review records. A seeded random sample of 40 atoms was checked by hand.

**Result.** 1,363 atoms, of which 1,019 are source-conformance claims.

| Kind | n | Conformance claim | i | ii | ii-b | iii | iv |
|---|---:|---|---:|---:|---:|---:|---:|
| Resource / component | 103 | no | | | | | 103 |
| Grant / fn-trait / binding / rule clause | 241 | no | 241 | | | | |
| owns | 47 | yes | | 7 | 40 | | |
| fn source ref | 101 | yes | 17 | 84 | | | |
| Effect entry | 572 | yes | | 44 | 528 | | |
| Effects-complete closure | 101 | yes | | | 101 | | |
| Description | 67 | yes | | 17 | | 48 | 2 |
| calls / coordinated / provides | 73 | yes | | 54 | 19 | | |
| Implementation | 22 | yes | | 22 | | | |
| Memory + rationale | 36 | yes | | 19 | | 16 | 1 |

Shares of the 1,019 conformance claims:

| Measure | Share |
|---|---|
| (ii) + (iii) | 311 = 30.5% |
| (i) + (ii) + (iii) | 328 = **32.2%** |
| (ii-b), needs a resource binding | 688 = 67.5% |
| Function as the counting unit (effect entries not counted one by one, n = 447), (i)+(ii)+(iii) | 63.5% |
| With every resource binding authored | 99.7% |
| Resource declarations counted as (iv) conformance claims | 29.9% |

Only 9 of the 79 resources have a code-level name, which is why (ii-b) is so large.

The hand check of 40 found 37 agreeing, 3 that depend on the rule for resource declarations, and 0 disagreeing. The prose kinds were classified in full by hand rather than sampled.

By-products of the mechanical checks:

- 101/101 source refs resolve, 84 of them with anchors.
- 572/572 evidence refs resolve, 69 with anchors.
- 21/22 implementations cover their component's fn sources.
- One discrepancy was found. `packages/shp-cli/src/freshness.ts` holds `ShpCli.isoToday`, which the `ClockReadAtCliBoundary` memory guards, yet the file is in no `CliSource` path and not in the `CliDocs` `when_changed` list.

**Verdict: disproved** (32.2% < 60%).

- The shortfall is one class of claim: effects on abstract resources that have no code referent.
- 60% is crossed only by changing the counting unit (63.5%) or by authoring about 70 resource bindings.

**Threats.**

- The name-based binding heuristic gave 2 weak matches out of 9.
- Route (iii) means a law could be written, not that one exists.
- The description routes are a reading, not a measurement.

## E5: design memories as deterministic checks

**Hypothesis.** At least 30% of the design memories translate into a deterministic check.

**Method.**

- There are 35 memories plus 1 rationale. All 35 guards are `on_change require ReEvaluation<Self>`, which the checker already enforces.
- Each summary was split into clauses, and each clause was given a route (`e5-memories.json`; counts from `e5-summary.py`).
- `e5-checks.ts` implements 5 checks.
- `e5-seed.sh` seeds one violation per check into a copy of `packages/` and reruns it.

**Classification.** The summaries contain 74 normative clauses: 49 laws, 11 call-graph rules, 10 static scans, 2 artefact/CI-state checks and 2 judgments. Another 4 clauses are "why" sentences.

- 34 of 36 entries translate fully (**94.4%**).
- 1 translates partly.
- 1 does not: `DiagnosticContract`, whose clause is "understandable".
- Strict count (30/36, 83.3%): excludes 2 entries that need only a phrase check and 2 that need release artefacts.

**Implemented checks.**

| Check | Memory | Method | Current source | Seeded violation |
|---|---|---|---|---|
| A. Clock boundary | ClockReadAtCliBoundary | TS AST scan of 113 files | pass (see note 1) | `Date.now()` in `checkFreshness`: fires |
| B. Analyzer separation | AnalyzerCheckerSeparation | Import scan plus call-graph closure (note 2) | pass | import and call of `checkShapeModules`: fires |
| C. Path normalization | ShapeSourceNormalizationContract | Cross-surface law: 7 ref spellings × 3 changed-path spellings, plus a negative control | pass, 21/21 agree | analyzer drops `normalizeShapeSourcePath`: fires |
| D. Formatter | FormatterCanonicalDiffs | Idempotence and inspect-equality on 357 `.shape` files; fast-check permutation law, 300 runs | pass | grants left unsorted: permutation law fails after 2 runs, while idempotence still passes |
| E. Path witness | ForbiddenPathWitness | fast-check on 400 random graphs (154 with a path): fewest hops, canonical tie-break, order independence | pass | BFS replaced by DFS: fails after 6 runs |

Notes:

1. In the CLI, the clock is read only in `isoToday`. There is also a `Date.now()` in `update/impl.ts#replaceWindowsBinary`, which is flagged only under a strict reading.
2. The closure covers 81 functions. The only module reachable outside the analyzer is `shape-strings.ts`.

The first version of check C was a call-graph rule, and it gave 2 false positives. Coverage and bindings compare paths that lowering has already normalised, so the dependency is data flow, not call flow. The call-graph version is kept as `C0` in the script.

**Verdict: asserted** (94.4%; strict 83.3%). All 5 checks pass on the current source, and all 5 fire on their seeded violation.

**Threats.**

- These memories are unusually precise contracts.
- The routes are a judgment, and 49 of them are laws nobody has written yet.
- C0 shows that a first formalisation can be wrong.
- Whether existing tests already cover these laws was not measured.

## F1: bounded enumerative synthesis

**Hypothesis.** Bounded enumeration synthesises law-satisfying functions for at least 4 of 6 targets, and also finds law-satisfying programs that differ from the intent.

**Method.** `f1-synth.ts` enumerates programs bottom-up by AST size.

- **Grammar.** Variables, constants, `+`, `-`, `min`, `max`, `<`, `<=`, `==`, booleans and if-then-else.
  - Constants are {0, 1, 2}, or {0, 1} for 3-variable targets.
  - The fee target gets {0, 1, 2, 100} and floor division by 2 or 100.
- **Semantics.** Nat (saturating `-`, inputs ≥ 0) and JS integers.
- **Deduplication.** Programs that behave identically on a large test set (300–1,596 domain points) are merged, so each kept program is a distinct behaviour.
- **Law checking.** Laws are checked on a bounded input set: values 0..6 (JS −4..6), and amounts 0..650 for the fee.
- **Unintended solutions** come in two kinds:
  - *under-specified*: the program already differs from the intent on the law inputs;
  - *bound artefact*: it matches the intent on every law input and differs only beyond them.
- **Size bounds.** 9 in general; 7 per field for the pair target; 13 for ringMove, capped at 2.5M programs.

| Target | Author laws | First solution (Nat) | Intended found, Nat / JS | Distinct solutions under author laws, Nat / JS | Unintended example | Laws added to reach intent |
|---|---|---|---|---|---|---|
| normalizeRange | 3: contains start, contains end, ordered | `{start, end}`, size 2, 0.2 s | yes / yes | 38,936 / 106,984 (pairs) | `{start: 0, end: end}` | +1 (size preserved), see note 1 |
| inclusiveSize | 3: size(x,x) = 1, ≥ 1, monotone | `1 + (end - start)`, size 5, 21 ms | yes / yes | 7 / 3 | `if start == end then 1 else end + end` | +1 (unit step) |
| includesValue | 4: includes start, includes end, excludes below, excludes above | `v == max(start, min(end, v))`, size 7, 0.1 s | yes / yes | 2 / 2 | endpoints only: `start == (if end == v then start else v)` | +1 (convexity) |
| clamp | 2: in bounds, identity inside | `max(lo, min(x, hi))`, size 5, 12 ms | yes / yes | 5 / 5 | `min(hi, if x < lo then hi else x)` | +1 (monotone in x) |
| ringMove | 3: stays on ring, zero delta, wraps at edge | `if delta == 0 then pos else 0`, size 6, 57 ms (unintended) | yes (size 12, 16 s) / no | 810 / 390 | `if delta == 1 then 0 else pos` | Nat: +2 (single step, additive). JS: see note 2 |
| ledgerFee | 3: ≥ 1, monotone, fee(100k) = k | `max(1, div(amount, 100))`, size 5, 46 ms | yes / yes | 13 / 11 | `max(1, div(amount + 1, 100))` | +1 (100·fee ≤ max(100, amount)) |

Notes:

1. After the extra law, normalizeRange still has 3 (Nat) and 8 (JS) bound artefacts, such as `min(end, 2+2+2)`. They disappear when the law inputs are widened.
2. For JS ringMove, the same strengthened laws leave 0 programs within the bound.

Runtime and scale:

- Wall time was 2 min 27 s for five targets, and 2 min 22 s for ringMove alone.
- ringMove enumerated 1.41M programs in Nat, and in JS hit the 2.5M cap at size 13.
- JS ringMove needs at least 16 nodes; the smallest form found by hand has 16.
- The fee target is unreachable without division and the spec constant 100.

**Verdict: asserted.**

- The intended behaviour was found for 6/6 targets in Nat and 5/6 in JS.
- All 6 targets admit unintended solutions under the author's laws, and ringMove's first solution is wrong.
- Reaching intent-only took 1 extra law for 5 targets and 2 for ringMove.
- normalizeRange also needed a wider law-input bound: bounded checking cannot exclude constants that the size bound can build, whereas a proof would.

**Threats.**

- The grammar is tiny and the size bounds are small.
- Merging by test-set behaviour can join programs that differ beyond the test set, so the counts are lower bounds.
- The laws were written knowing the intended implementations.
- For the pair target, per-field prefilters derived from N1/N2 prune the product before the full laws are checked.

## Inputs for E1

| Fixture | Deterministic with existing `shp` | Deterministic with new tooling | Still judgment |
|---|---|---|---|
| guard policy-removal | no | yes (inspect diff) | — |
| guard relocation | yes (incidental) | yes | — |
| index coverage-gaps G1, G2 | no | yes (call graph, doc regex) | significance; choice of representation |
| index missing-ast | — | yes (constant rule) | — |
| index no-invariant | — | yes (pure-leaf proxy) | — |

Across all fixtures, the guard's notion of "support" (whether a loosening is justified) stays partly judgment.

## Scripts

- E2: `e2-loosening.sh`, `e2-semantic-diff.ts`, `e2-calibration.ts`
- E3: `e3-index-scan.ts`, `e3-robustness.sh`, `callgraph.ts`
- E4: `e4-classify.ts`, `e4-descriptions.json`, `e4-handcheck.json`
- E5: `e5-memories.json`, `e5-summary.py`, `e5-checks.ts`, `e5-seed.sh`
- F1: `f1-synth.ts`
