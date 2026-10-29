# Shape 1.0 model

This directory holds the output of a multi-agent workflow. The workflow specified, formalised, prototyped, tested, red-teamed and crystallised the 1.0 "evidence ledger" model:

- claims are authored;
- providers produce evidence records;
- one deterministic checker derives obligations from a change.

[SEED.md](SEED.md) is the starting point the workflow was given. Nothing in the checker, CLI, docs or release archives depends on this directory.

## Status

- **Version 7 is a release-candidate specification, not an implementation.** The prototype (`proto/`) and the Lean kernel (`kernel/`) implement version 6. Bringing them to version 7 is roadmap milestones M1 and M2.
- **Most of version 7's changes are predictions.** They have mechanisms but no replay. [RFC.md](RFC.md) marks each one, and milestone M5 re-measures H1–H6 against criteria fixed in advance.
- **DRT fixes live outside the repo.** The fixes for the bugs found by differential testing were applied only to scratch copies, so the committed kernel and prototype still contain those bugs.

## Read in this order

| Document | What it is |
|---|---|
| [spec/MODEL.md](spec/MODEL.md) | The normative core: 15 concepts, claims, evidence, derivation, governance, outputs |
| [RFC.md](RFC.md) | Decisions D1–D28, each tied to the experiment number or attack that forced it; what is in, deferred, cut; risks |
| [ROADMAP.md](ROADMAP.md) | Milestones M0–M7 with falsifiable exit criteria; release-blocking criteria marked (RB) |
| [spec/EXAMPLES.md](spec/EXAMPLES.md) | Four worked examples end to end (append-only purge, Verus `assume`, memory → law, `calls` drift) |
| [spec/SYNTAX.md](spec/SYNTAX.md) | Surface syntax and grammar sketch |
| [spec/RECORDS.md](spec/RECORDS.md) | Evidence record profile (in-toto), fingerprints, checker input/output contract |
| [MIGRATION.md](MIGRATION.md) | 0.x → 1.0 mapping for every 0.x construct |
| [spec/ANNEX.md](spec/ANNEX.md) | Reference detail the core points to (A.n); the text both checkers answer to |
| [spec/OPEN_QUESTIONS.md](spec/OPEN_QUESTIONS.md), [spec/CHANGES.md](spec/CHANGES.md) | What is still open; what the final revision changed |
| [spec/CRITIC_DECISIONS.md](spec/CRITIC_DECISIONS.md) | The 139 decisions from three specification rounds |

**Conformance data.**
- [spec/vectors/vectors.py](spec/vectors/vectors.py) prints the 113 hash vectors; its output is [vectors.json](spec/vectors/vectors.json). Run it with `python3 -I vectors.py`.
- [spec/example-inputs/](spec/example-inputs/) holds the 21 checker inputs behind the examples.

## Hypotheses

Each hypothesis was registered in SEED.md with its falsification criterion before the run. Each report is under `trials/<id>/REPORT.md`.

| ID | Hypothesis | Verdict | Key numbers |
|---|---|---|---|
| [H1](trials/H1/REPORT.md) | Routing only judgment obligations halves the per-change judgment budget against 0.x path coverage | **disproved** | 851 judgment obligations vs 690 0.x demands over 82 commits (ratio 1.23); grouped 0.31, but 0.73 on the 22 heads that elaborate cleanly; 494 of 851 were producer-changed, 13/13 sampled false |
| [H2](trials/H2/REPORT.md) | Drift surfaces at the change that causes it | **disproved** | 47/62 seeded drifts flagged at the change; 7/7 call removals never introduced; coverage fired on 7/7 behaviour-preserving controls |
| [H3](trials/H3/REPORT.md) | Behavioural bugs inside a law's jurisdiction don't merge | **disproved** for stock rules | Unit-bound arms block 33/43 and 29/43; with the revised introducedness rule, 43/43 and dogfood 24/24, with 0 false obligations on 51 refactors |
| [H4](trials/H4/REPORT.md) | The loosening decider beats a syntactic diff and is never wrong | **disproved** narrowly | Prototype 20 correct / 1 wrong / 2 undecided of 23; diff 19/4; 0.x 18/5 |
| [H5](trials/H5/REPORT.md) | Escape-hatch growth cannot grow silently | **asserted** | 0/585 growth commits missed with vprobe manifests (11/585 with the prototype scanner) |
| [H6](trials/H6/REPORT.md) | Teeth checks find real vacuity and gaps in Shape's own model | **asserted** | 19 redundant claims, 33/154 claims observably vacuous, 2,049/3,679 identities ungoverned |
| [DRT](trials/DRT/REPORT.md) | Kernel and prototype agree on every in-fragment input | **disproved** as built | 3,554/4,000 cases differ: 20 Lean bugs, 10 TS bugs, 4 shared deviations; 4,000/4,000 agree after the fixes; the kernel takes over 3,600 s on a dogfood case the prototype checks in 5–6 s |

The disproofs drove version 7. In D2–D10 and D21 (RFC):

- summaries became direct;
- coverage is asked only where something can observe;
- law obligations are introduced through record cones;
- producer change cannot mask anything;
- the budget unit became the group.

## What was built

| Component | Path | Size | Tests |
|---|---|---|---|
| Lean kernel (`shapek`) | [kernel/](kernel/README.md) | ~5,200 lines of Lean 4.34.0; 149 theorems; only `propext`, `Quot.sound`, `Classical.choice`; no `sorry` | 57 |
| Prototype checker (`shape1`) | [proto/](proto/README.md) | ~10,000 lines of TypeScript | 131 |
| Providers: laws, observe-ts, trust (Rust/Verus, Lean, Bend), teeth | [proto/providers/](proto/providers/README.md) | ~5,200 lines | 52 |
| Shape's own model in 1.0 form | [dogfood/](dogfood/README.md) | 1.0 sidecar over the migrated 0.x model, with executable law tests | — |

Each component passed a gate run by a separate agent, which rebuilt it and checked its stated paths, commands and numbers. The providers needed two repair passes and the dogfood one.

## Red team

Two red teams generated 110 cases, and 21 were upheld as model gaps after two skeptics tried to refute each one. Version 7 closes every upheld gap; the RFC decisions that close them are D4, D9, D11–D15, D20 and D22. Details are in [redteam/REPORT.md](redteam/REPORT.md).

| Team | Cases | Upheld |
|---|---:|---:|
| Spec lawyer (kernel and prototype) | 41 | 12 |
| Negative conformance suite | 69 | 9 |

## Process

1. **Specify.** Three critic rounds raised 48, 47 and 44 issues (27, 22 and 17 high). The spec grew to 158k characters, then a simplification gate cut it to a 60k-character core plus an annex. A check for lost guarantees found two high-severity losses, which were repaired.
2. **Build.** Kernel, prototype, providers and dogfood, each behind a gate.
3. **Experiment.** H1–H6 and DRT.
4. **Red team.** Spec lawyer, then the negative suite, with batched skeptics.
5. **Crystallize.** A completeness critic raised 23 issues, 18 of them high or medium, and a final revision resolved each one or recorded it as open.

## Reproduce

- **Commands:** each component README and trial report lists its exact commands, run from the repo root. The Lean toolchain is 4.34.0 with lake.
- **Bulky outputs:** replay data, mutant runs and DRT corpora (about 7.7 GB) stayed in the session scratch area and are not committed. Reports give their paths.
- **Dates:** results are from 2026-10-25 to 2026-10-29.
