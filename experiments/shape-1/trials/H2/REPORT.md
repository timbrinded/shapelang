# H2: drift surfaces at the change that causes it

## Verdict

H2 is disproved in the form SEED.md states it ("drift surfaces as a stale or contradicted obligation at the change that causes it").

On Shape's own repository with the dogfood 1.0 model, the prototype flagged 47 of 62 seeded drifts (75.8%) at the seeding change, in both arms. A flag here means an introduced contradiction, a stale or unestablished law, or a blocking binding error. The remaining 15 split into:
- 3 drifts (arm A) or 10 (arm X) where the right contradiction was raised but marked preexisting and owed;
- 12 drifts (arm A) or 5 (arm X) flagged only by coverage obligations, which also fire on refactors that preserve behaviour.

Read literally, the falsification criterion ("seeded drift goes unflagged") is not met: every one of the 62 drift runs introduced at least one obligation. That depends entirely on coverage, though. Coverage was raised on 7/7 control edits to governed code, and blocked 4 of them, so it carries no drift-specific signal.

H2 holds without exception for these classes:
- upper-bound effect drift on an observed resource (16/16);
- structure drift that a forbid or a conduct summary excludes (11/11);
- binding rot through moves and renames of bound symbols (12/12);
- behaviour drift inside a tested law's own unit (5/5).

It fails for these classes:
- removed declared calls: 0/7 introduced in either arm;
- behaviour drift routed through a dependency of the law's unit: 0/4 introduced;
- drift on channels nothing observes: cross-language call, fs write, aliased clock read, resource-code rename (0/4);
- a law violation outside the test's sampled domain (0/1).

## Hypothesis and criterion (SEED.md)

- **H2:** "Intent stops rotting: drift surfaces as a stale or contradicted obligation at the change that causes it."
- **Falsified if:** "Seeded drift goes unflagged."

**How I operationalised it.** For each seed, `derive(base = HEAD, head = HEAD + one edit)`.

**Tiers:**
- **T1:** an introduced contradiction or stale/unestablished law obligation at the seeded code, or a blocking error naming the drifted item.
- **T2:** the right obligation raised, but not introduced (preexisting, owed).
- **T3:** only coverage obligations or law reopenings that are not drift-specific.
- **T4:** nothing introduced.

## Setup

**Repository and model.**
- Repository: HEAD 7a8e27b plus the current dogfood files; base tree id 95b84025a172bc12ede051f46198f42c463ef05b.
- Model: experiments/shape-1/dogfood (418 claims, 24 components, 102 units).
- Every component has explicit grants, and only ShpCli grants Read<SystemClock>.
- Rules: CheckerNeverReadsClock (critical), ClockReadOnlyAtCliBoundary (normal), AnalyzerStaysAdvisory (path), ExperimentalSemanticKernelIsolation (path), no_runtime_dependency_cycles, and 76 calls/provides relations.

**Providers.** I used the dogfood providers unchanged:
- tsClockScan: four ts.call channels, presence and absence soundness, file-level completeness;
- tsCalls: call(ts), presence only, never complete;
- bunTest: 21 executable law tests, presence; it emits inconclusive records for the 29 untested laws it decides.

Base records are the observers only.

**Arms** (applied identically to base and head):
- **A:** the dogfood model as built.
- **X:** A plus three changes:
  - `relations complete over calls` on all 24 components;
  - tsCalls declared absence-sound, with its entries marked complete (**counterfactual**: the scanner misses injected-object calls and callbacks);
  - an ed25519 identity for timbrinded and 34 signed base-era claim judgments, one for every law that admits judgment. The 27 RefactorSensitive guards and the DocumentedBy laws need no laws skipped, except 3 guards bound to raw or file identities, which have no `unit` projection.

**Baselines (C00, no edit):**
- Arm A: verdict owed; 414 obligations (348 preexisting contradictions, 66 unestablished `missing`); 0 introduced.
- Arm X: 425 obligations (393 contradictions: 348 plus 31 from relations complete plus 14 refutations of unrealised relations; 32 unestablished); 0 introduced. The judgments satisfy all 34 judged laws.

**Expectations.** Every seed carries an a-priori expectation (the "right" obligation under MODEL §4.4, §5.3 and §7.3) and a prediction, both written in seeds.ts before any run.

## Commands

```
cd /home/user/shapelang
W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H2
bun experiments/shape-1/trials/H2/probe.ts $W                       # base map: 83 component edges, 23 clock facts
bun experiments/shape-1/trials/H2/run.ts dry --work $W              # 76/76 seeds apply, 0 parse errors
bun experiments/shape-1/trials/H2/run.ts prep --arm A --work $W     # 16.6 s
bun experiments/shape-1/trials/H2/run.ts prep --arm X --work $W     # 34 judgments, 3 laws skipped
experiments/shape-1/trials/H2/runall.sh $W                          # 152 runs, 3 workers, ~75 min wall
python3 -I experiments/shape-1/trials/H2/classify.py $W             # -> $W/classified.json (copied to trials/H2/results.json, results.txt)
H2_DUMP_INPUT=$W/kx/inputs bun experiments/shape-1/trials/H2/run.ts run --arm A --work $W/kx --only C00,E01,S05,M03,L01,R01   # determinism rerun
bun experiments/shape-1/trials/H2/kernel-xcheck.ts --emit $W/kx/A-C00.case.json $W/kx/inputs/A-C00.input.json
timeout 2700 experiments/shape-1/kernel/.lake/build/bin/shapek $W/kx/A-C00.case.json   # exit 124 after 2,700 s, no output
node_modules/.bin/oxlint --deny-warnings experiments/shape-1/trials/ ; bun run typecheck   # both clean
```

## Results by category (tiers T1/T2/T3/T4)

| Category | n | Arm A | Arm X |
|---|---|---|---|
| S: undeclared call | 12 | 11/0/1/0 | 11/0/1/0 |
| R: removed declared call | 7 | 0/0/7/0 | 0/7/0/0 |
| E: undeclared effect via bound resource | 18 | 16/0/2/0 | 16/0/2/0 |
| M: moved function | 6 | 6/0/0/0 | 6/0/0/0 |
| N: renamed symbol | 7 | 6/0/1/0 | 6/0/1/0 |
| L: law-covered behaviour change | 12 | 8/3/1/0 | 8/3/1/0 |
| **Total** | **62** | **47/3/12/0** | **47/10/5/0** |

**Verdicts.** 54 of the 62 drift runs were blocked in each arm.

**T1 in arm A, by provider and force:**

| Provider | Count | Force and severity | Seeds |
|---|---|---|---|
| tsClockScan | 17 | sound, blocking (rule 7) | E01–E11, E14–E16, E18, M03, M04 |
| tsCalls plus declared edges | 13 | sound, blocking | S01, S02, S04–S08, M06, E13; and S09–S12 through effects.upper |
| elaborator E-unbound | 8 | error | M01, M02, M05, N01, N02, N03, N05, N06 |
| bunTest | 5 | sound, blocking | L01, L02, L03, L05, L09 |
| judgment-route unestablished | 4 | 3 blocking critical (rule 9), 1 owed | L08, L10, L11 guards; N07 |

In arm X, S09–S12 are caught directly by the `relations.complete-calls` edge forbid (sound, blocking), and the guards report `stale` instead of `missing`.

## Per-seed results

Obligations are listed as kind, claim, [provider, force, severity].

| Seed | Drift | A | Arm A obligation | X | Arm X obligation |
|---|---|---|---|---|---|
| S01 | Analyzer calls Checker | T1 | contradiction AnalyzerStaysAdvisory [tsCalls, sound, blocking]; plus 29 effects.upper | T1 | same, plus Analyzer/relations.complete |
| S02 | Analyzer → EditorServices → Checker | T1 | AnalyzerStaysAdvisory (2-hop) [tsCalls+decl, sound, blocking] | T1 | same, plus relations.complete |
| S03 | ShpCli spawns the Rust kernel | T3 | coverage owed | T3 | coverage owed |
| S04 | ShpCli → kernel harness (declared Harness→Kernel) | T1 | ExperimentalSemanticKernelIsolation [tsCalls+decl, sound, blocking] | T1 | same |
| S05 | Grammar → Parser (new cycle) | T1 | no_runtime_dependency_cycles [sound, blocking] | T1 | same |
| S06 | StringHelpers → Formatter | T1 | cycle, plus 103 effects.upper, 41 old obligations flipped | T1 | plus StringHelpers/relations.complete |
| S07 | Diagnostics → Checker | T1 | cycle (old key flipped owed→blocking), plus 118 effects.upper | T1 | Diagnostics/relations.complete |
| S08 | RuleEngine → Bindings (inside the SCC) | T1 | cycle (flipped), plus 4 effects.upper | T1 | RuleEngine/relations.complete |
| S09 | Authoring → Formatter (no forbid) | T1 | 3× reviewShapeAuthoringProposal/effects.upper [sound, blocking] | T1 | Authoring/relations.complete |
| S10 | LanguageServer → Parser | T1 | 2× serve/effects.upper | T1 | LanguageServer/relations.complete |
| S11 | EditorServices → Analyzer | T1 | 4× effects.upper | T1 | EditorServices/relations.complete |
| S12 | Harness → Formatter (low tier) | T1 | 13× effects.upper (low, blocking) | T1 | Harness/relations.complete |
| R01–R07 | Remove the single call realising a relation (2 of them inline the callee, behaviour kept) | T3 | coverage only (blocking for critical components R01, R04, R06; owed otherwise) | T2 | edge.exists refuted [tsCalls absence, sound] but owed, rule 6, not introduced |
| E01 | Date.now in RuleEngine.checkFreshness | T1 | CheckerNeverReadsClock and checkFreshness/effects.upper [tsClockScan, sound, blocking critical] | T1 | same |
| E02, E03, E11, E15 | Clock read in Lowerer, StringHelpers helper, PreludeRegistry, Bindings (globalThis.Date.now) | T1 | CheckerNeverReadsClock at the site, plus 10–25 effects.upper on transitive callers | T1 | same |
| E04, E05, E14 | process.hrtime in Diagnostics; Date.now in incremental check; new helper | T1 | CheckerNeverReadsClock at the site, plus the caller summary | T1 | same |
| E06, E07, E08, E18 | Formatter, Analyzer, ShpCli inspect, Authoring | T1 | ClockReadOnlyAtCliBoundary [sound, blocking normal] plus summary | T1 | same |
| E09 | new Date() in a DocsSite test file | T1 | DocsSite/authority [sound, blocking low] | T1 | same |
| E10 | Date.now in parseShapeModule | T1 | ShapeParser/authority (critical authority outranks the normal forbid) plus 20 summaries | T1 | same |
| E12 | Clock read through an alias | T3 | coverage blocking (the scan marks api.ts incomplete; no fact) | T3 | same |
| E13 | Checker calls ShpCli.isoToday | T1 | explainShapeModules/effects.upper via the call hop, plus a cycle | T1 | plus relations.complete |
| E16 | performance.now in harness createKernelRequestV1 | T1 | Harness/authority plus summary (low, blocking) | T1 | same |
| E17 | Formatter writes a .shape file (fs.path) | T3 | no observer; coverage plus 2 flipped old law contradictions | T3 | same |
| M01, M02, M05 | Move bound units (same component, other component, ungoverned) | T1 | E-unbound (plus E-provider-missing for M01's tested law) | T1 | same |
| M03 | Move replaceWindowsBinary (under exception) to windows.ts | T1 | ClockReadOnlyAtCliBoundary at the new identity, introduced, unmatched by the exception, blocking | T1 | same |
| M04 | Move isoToday (the excepted unit) | T1 | E-unbound, plus ClockReadOnlyAtCliBoundary at shape-files.ts#isoToday | T1 | same |
| M06 | Move getEditorDiagnostics into analyzer-shape.ts | T1 | E-unbound, plus AnalyzerStaysAdvisory | T1 | same |
| N01, N02, N05, N06 | Rename bound symbols; rename prelude.ts | T1 | E-unbound (N01, N02 also E-provider-missing for tested laws) | T1 | same |
| N03 | Rename isoToday | T1 | E-unbound only; the rename hint suppresses the clock contradiction | T1 | same |
| N04 | Rename the type a resource binds (ts.type) | T3 | coverage owed; resource-code rot is silent | T3 | same |
| N07 | Rename cli.md (the CliDocumented target) | T1 | CliDocumented unestablished, missing, owed (flip) | T1 | CliDocumented stale, owed |
| L01, L02, L03, L05, L09 | Break a tested law inside its unit | T1 | law contradiction [bunTest, sound, blocking] | T1 | same |
| L04 | Cross-file dependency (compareCodepointStrings) | T2 | InspectionCodepointOrder contradiction, sound, owed, preexisting | T2 | same |
| L06, L07 | Same-file callee | T2 | SourcePathRulesShared / UpdateDraftsPreferUnknown contradiction, owed, preexisting | T2 | same |
| L08 | Unsorted diagnostics (same-file callee of checkShapeModules) | T1 | guard on the edited unit (missing, blocking); the CheckIsDeterministic contradiction was preexisting and owed | T1 | guard stale |
| L10, L11 | Behaviour change in RefactorSensitive / untested-law units | T1 | guard unestablished, missing, blocking critical | T1 | guard stale, blocking |
| L12 | Violation outside the test generator's spellings | T3 | coverage only; the law is still supported | T3 | same |

## Controls (should raise nothing)

| Control | Arm A introduced | Arm X introduced |
|---|---|---|
| C00 no edit; C01 comment; C03 README; C08 clock in ungoverned code; C11 docs page; C12 shape whitespace | 0 | 0 |
| C02 formatting only | RuleEngineDocumented reopened (only the `file` digest moved), owed | 0 |
| C04 rename a local in formatShapeModule | coverage, plus 2 already-contradicted formatter laws flipped owed→**blocking** | same |
| C05 extract constant; C06 reorder functions; C07 extract helper | coverage **blocking** (critical) | same |
| C09 allowed clock read in ShpCli.main | coverage owed, plus 5 law reopenings | same (guard stale) |
| C10 rename a private helper | coverage owed, plus doc law | same |
| C13 new test file inside ShapeChecker's glob | old cycle flipped owed→**blocking**, plus coverage blocking | same |

Summary of the controls:
- 0/14 produced a new contradiction or error.
- 5/14 were blocked.
- Every coverage obligation on a drift seed in tier T3 has the same form as the ones these controls raise.

## Noise and cost

**Fan-out.** Introduced obligations per drift run: median 4, maximum 120 (S07). This is driven by transitive effects.upper summaries: S06 produced 103 summary contradictions and S07 118.

**Groups.** Measured in arm X only (arm A rows predate group capture). All introduced obligations fell into 1 group in 55/62 runs; the maximum was 7.

**Flipped obligations (arm A drift runs):**
- 82 preexisting contradictions flipped from owed to introduced and blocking;
- 11 unestablished obligations flipped owed→blocking;
- 54 flipped owed→owed.

**Run time:**
- Median 25.9 s (arm A) and 26.9 s (arm X) per run end to end, with derive at 5.8 s and 6.0 s (maximum 12.3 s).
- Total run time 2,336 s (arm A) and 2,102 s (arm X).

**Determinism.** A rerun of 8 runs gave obligation sets identical to the first runs.

**Lean kernel cross-check.** Not obtained. With the bridge's `kernelCase`, shapek ran CPU-bound at about 50 MB RSS and was killed by the 2,700 s cap without output on C00.

## What the misses have in common

1. **No rule makes an absence introduced.**
   - Lower-bound drift needs refutation, and refutation has no "new fact".
   - In arm A, tsCalls is never absence-sound, so the 7 removals were coverage only.
   - In arm X they are refuted but stay preexisting.
2. **Req is the law's unit, not what it calls.** Unit digests include the identities that free names resolve to, not their contents. Breaking a callee (L04, L06, L07, L08) leaves Req unchanged, so the fresh contradicting test record yields a preexisting, owed contradiction.
3. **Nothing observes the channel.** This covers an aliased clock read (designed coverage), an fs.path write, a subprocess into Rust code, and a ts.type rename.
4. **The test misses the case.** L12 is a sampling miss, which is H3's territory.

Two misses in the opposite direction came from the attribution rules:
- C13 and S08: fact-level newness flips old SCC obligations.
- C04: touching a unit flips its already-contradicted laws.

## Things H2 should keep

- Effect drift surfaces at the site with the right excluding claim. When both apply, authority and forbid are chosen by tier: critical authority outranks a normal forbid (E10).
- Effect drift also surfaces as transitive conduct-summary contradictions.
- Structure forbids catch new edges, including 2-hop paths and paths completed by declared edges (S02, S04).
- `effects complete` summaries catch undeclared calls even with no structure forbid (S09–S12, arm A). This was predicted as a miss.
- Moves and renames of bound code are blocking E-unbound errors.
- Moving excepted code drops the exception and re-raises the violation (M03).
- With base judgments, guard laws report `stale` exactly when their Req moves. Comment, formatting and reorder edits that do not touch the cited digests do not stale them (C02 is clean in arm X).
