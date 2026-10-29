# Roadmap to Shape 1.0

Milestones in dependency order. Every exit criterion is a measurement with a threshold fixed in this document, registered (committed under `experiments/shape-1/` with its date) before any run it governs. A milestone exits only when every criterion is met. A miss reopens the decision it tests (RFC D-numbers), the RFC records the measured number, and the milestone is re-run under criteria registered before the re-run; a criterion may be relaxed only by an owned, dated waiver recorded in the RFC, and never for the release-blocking criteria marked (RB). Commands run under the repository rules (`bun run typecheck`, `bun run lint`, `python3 -I`).

```
M0 ─► M1 ─► M3 ─► M4 ─► M5 ─► M7
 └──► M2 ─────────────►┘      ▲
       └─► M6 ─────────────────┘
```

## M0. Freeze the text, the vectors and the expected outputs

- **Deliverables**: the version 7 documents; `experiments/shape-1/spec/vectors/vectors.py` (113 values); the 52 vectors named in A.11.2.4 as input/expected-output pairs; golden core outputs (`shape.check.output/v1`) for the 21 example inputs in `experiments/shape-1/spec/example-inputs/ex*.json`, regenerated for version 7; a version 7 `manual.json` classifying the 33 H4 cases (23 fixtures, 2 guard fixtures, 8 calibration cases) under version 7's migration; the expected outcome of each H2 seed under version 7, per arm; the M5 criteria below.
- **Exit**: `python3 -I vectors.py` asserts no floats, and a script diff of every 16-hex value in the examples and A.12.11 against its output finds 0 mismatches; every vector pair, golden output, `manual.json` row and H2 expectation carries the recorded sign-off of two reviewers, at least one of whom wrote no part of it, before M1 starts.

## M1. Prototype conforms to version 7 (TypeScript)

- **Deliverables**: `experiments/shape-1/proto` implementing D1–D28: direct summaries and summary protection in P and Lvl; need-side observability from the base and declared-only routes; introducedness (laws through record cones with the counterexample clause, structure by lifted edge, hatch by finest change, relocation, refutations); the reason orders and answer re-evaluation; final-tier rules including two-person coverage; eligibility; audit governance; `except` paths and gha jobs; manifest `refs`, flags and identity; `this.m` resolution; order class; debt rows; judge lines without a relay; the A.15 readings.
- **Exit**: the 21 M0 golden outputs reproduced byte for byte; all 52 M0 vectors pass; 0 wrong and ≤ 2 abstentions on the 33 H4 cases against the M0 `manual.json`; `bun test`, `bun run typecheck` and `bun run lint` clean.

## M2. Kernel conforms and guards its fragment (Lean)

- **Deliverables**:
  - fixes for the 20 Lean bugs and the kernel halves of the 4 shared deviations found by DRT;
  - the kernel gaps: ρ with the rule-3 hint, L6, lower-bound refutation, `via`, G1 (exploitation through uncovered changed code), G2 (cones closed under observed calls and refs), cells computed in the kernel;
  - the version 7 rules D1, D2, D3, D4, D5, D6, D7, D9, D11, D12, D14, D15, D17, D27 (manifest flags) and D28, and the two L38 kernel fixes (equal-fp merging per A.4.1.7; provider channels intersected with each claim's T(c));
  - fragment rejection with a named reason; the `shape.kernel.case/v1` reader;
  - proofs redone for the version 7 rules: `stale_iff` with the harness clause, T2 for laws under a fixed base policy, T2′ with its eligibility clause, T6, T6′, T9, introducedness (A.7.3.3), `raw_fact_exact` with summaries, the D11 tier\* rule;
  - the DRT generator extended to the version 7 rules, with a per-feature coverage report.
- **Exit**: the DRT gate (≥ 4,000 generated cases across both profiles, the 853 fixtures including the 16 rename fixtures, and the 52 M0 vectors) reports 0 residual with no normalisation and no patch flags; the coverage report shows each of D1, D2, D4, D5, D6, D7, D9, D11, D12, D14 and D15 in ≥ 100 corpus cases; `lake build` succeeds and `AxiomsCheck` lists only `propext`, `Quot.sound` and `Classical.choice` for every theorem named above; `dfs_complete` is proved or, if still open, 10^5 fuzz instances show 0 disagreements and A.1.2 records it as open.

## M3. Providers and manifest builder to the version 7 contract

- **Deliverables**: the laws provider emitting `contradicts` with `{seed, inputs, assertion}` and `bound.mutants`; observe-ts with injected-call incompleteness, supplier attribution and the fixed `ts.call` invocation forms; tsCalls with honest per-file completeness; `shp manifest` emitting `refs`, `executable` and `hatchComplete` per A.12.7.5, signing under a manifest identity, and using the trust provider's vprobe port for Verus markers; pkgjson identities in implementations.
- **Exit**: observe-ts reports the replaceWindowsBinary `Date.now()` drift through `runUpdate` (dogfood finding (d)) as a fact or as an incomplete entry; the vprobe port matches vprobe on ≥ 16,611/16,612 blobs; the laws provider turns the H3 dogfood mutants into 24/24 sound contradictions; `shp manifest` reproduces git's tree id for HEAD and for 100 sampled historical commits of Shape and of the Verus corpus; its `hatchComplete` flags match the expected value on the 4 macro vectors of A.11.2.4; no record or manifest from Shape's own run is rejected.

## M4. Migration and Shape's adoption

- **Deliverables**: `shp migrate` per A.11.1, with one fixture per row of the migration guide; a version 7 re-migration of the 82 governed historical heads used by H1 and of every H2 and H3 base; a staged adoption of Shape (providers first) in at most 3 changes, binding bunTest's implementation as `pkgjson("package.json#scripts.test")`, `bunfig.toml` and `bun.lock`; the sidecar overlay merged into the tool, so `shape1 check --model . --sidecar` is the path (build/dogfood awkward point 1).
- **Exit**: Shape migrated has 0 E-route, 0 E-unbound and only the 2 known E-overlaps, which the first adoption change fixes; 0 errors from minted exclusivity (version 6: 35); 0 effects.upper contradictions witnessed only through call hops (version 6: 336); the number of re-migrated historical heads that elaborate with 0 errors is reported (version 6: 22 of 82); the A.11.5 acceptance tests pass; after the last adoption change a no-op change to Shape is `pass` or `owed` with nothing blocking at normal tier.

## M5. Re-measure the hypotheses on version 7

Runs use the stock version 7 prototype (no patched copy), M3's providers and M4's re-migrated models; corpora and seeds are version 6's unless stated.

- **H1′** (budget; the 82 governed commits replayed with providers rerun at head): pooled judgment **groups** / 0.x demand ≤ 0.5 with a bootstrap 95% upper bound ≤ 0.6 on all 82 commits, and ≤ 0.5 with an upper bound ≤ 0.75 on the subset whose re-migrated heads elaborate with 0 errors (version 6: 0.31 and 0.73); pooled judgment **obligations** / 0.x demand ≤ 1.0 on both sets; producer-changed obligations ≤ 50 (version 6: 494); ≤ 6 of 20 sampled judgment obligations false (version 6: 16). Both sets are reported whatever the outcome.
- **H2′** (62 seeded drifts and 14 controls): arm X ≥ 55/62 flagged as introduced at the seeding change, including 7/7 call removals (RB); arm A ≥ 47/62, with every unflagged arm-A drift either one of the 11 expected by construction (the 7 call removals, which no absence-sound call observer can see, and S09–S12, which no structure claim covers) or one of at most 4 others (RB); in each arm, controls blocked ≤ 1/14 and coverage raised on ≤ 1 control (version 6: 5 and 7); 8/8 reruns identical.
- **H3′** (T1, T3, T4 law-tagged changes and dogfood mutants): with providers rerun, 43/43 blocked in every binding arm (RB) and dogfood 24/24 (RB); without reruns at critical tier, 43/43 in every arm (version 6: 43, 33, 31); 0 law obligations on the 39 task refactors and the 12 dogfood refactors; with the version 7 laws provider at normal tier, 43/43 test-killed bugs raise a sound contradiction.
- **H4′** (23 fixtures plus 10 cases): 0 wrong classifications (RB); ≤ 2 abstentions (renames without `was`); order class equal to the M0 manual reading on ≥ 31/33; the kernel identical to the prototype on all 33.
- **H5′** (2,201 Verus commits, M3's manifest builder): 0/585 growth commits missed (RB); frozen-surface recall over all trust events ≥ 87% and precision ≥ 75%; anvil a27a5959 raises 0 hatch contradictions; Vest's coverage commits fall from 383 to ≤ 40.
- **H6′** (dogfood model): teeth reports observably vacuous claims, declared-only routes per tier and the ungoverned gap class; all 7 retired-guard laws assessed through `bound.mutants`.
- **Exit**: every criterion met, under the rule at the top of this document.

## M6. Kernel performance

- **Deliverables**: the semantics-preserving optimisations measured in DRT (sorting, observation indexing) made permanent; complexity fixes for parse and canon on large inputs.
- **Exit**: the 71 sampled H5 commits in ≤ 49 s in total (10 times the prototype's 4.9 s); the dogfood case H2-A-C00 in ≤ 600 s; the DRT corpus in ≤ 300 s on 4 cores. A miss keeps A.11.2.5 in force (the kernel is an offline oracle on sampled cases) and needs an owned waiver.

## M7. Release

- **Deliverables**: the reference CI workflow (phases 1 and 2, the relay, a manifest job with its own identity, every deciding provider run on every change); the DRT gate in CI; release notes listing deferred items, open questions and every waiver; RELEASING.md followed.
- **Exit**: M0–M4 met; every (RB) criterion of M5 met with no waiver (H2′ in both arms, H3′ with reruns and on the dogfood, H4′ wrong classifications, H5′ growth commits); every other M5 and M6 criterion met or covered by an owned, dated waiver recorded in the RFC and the release notes; the gate reports 0 residual on the release commit; Examples 1–4 and the acceptance tests run in CI and pass; a 0.x user can follow the migration guide end to end on fixtures/pass with no hand edit beyond those the guide lists.
