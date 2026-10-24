# Bend probes

Thirty experiments on one question. Can Bend 2, or ideas borrowed from it, close the loop between Shape claims and generated code deterministically, so that less of that loop depends on the LLM-powered CI jobs (`shape-review`, `shape-contract-guard`, `shape-index`)? Speed is out of scope. The measures are generated-code quality, detection, gaming, and the cost of evidence.

The plan, with each hypothesis and its falsification criterion, is in [PLAN.md](PLAN.md). Each track has its own report:

| Track | Report | Experiments |
|---|---|---|
| A | [A/REPORT.md](A/REPORT.md) | Bend as the oracle for Shape's claims |
| B | [B/RESULTS.md](B/RESULTS.md) | Agents writing Bend proofs |
| C | [C/REPORT.md](C/REPORT.md) | Bend's ideas in TypeScript, without Bend |
| D | [D/REPORT.md](D/REPORT.md) | Shape governing Bend projects |
| E, F | [E/REPORT.md](E/REPORT.md) | Mechanising the LLM CI jobs; synthesis without an LLM |
| G | [G/REPORT.md](G/REPORT.md) | Generated-code quality under deterministic gates |

Nothing in the checker, CLI, docs or release archives depends on this directory.

**Setup.**
- **Toolchain.** Bend 2.0.39 (`bendlang/bend` at `295e996`), run from source with Bun 1.4.2, plus Lean 4.34.0 for `--verdict`.
- **Agents.** Every agent trial (B1, G1–G8) was a fresh Claude Code subagent; no Claude API key was available.
- **Date.** Results are from 2026-10-24.

## Results

| ID | Hypothesis (short) | Verdict | Key number |
|---|---|---|---|
| A1 | Contract laws make Bend separate the review fixtures; `calls` is not a law | asserted | Both behavioural fixtures separated; reverting `normalizeRange` alone turns 6/6 laws green |
| A2 | Every Bend encoding of null→throw is rejected or named | asserted, qualified | 0/18 pass, but 8/18 are kernel-accepted total programs that only the laws reject, and 4 of these stop the process at run time without being named |
| A3 | Purity by construction: at least 8/10 effect injections rejected; foreign imports are the gap | asserted; the gap prediction was wrong | 10/10 rejected; foreign imports must be IO-typed. The real gaps are type aliases, structural IO, host callbacks across `.mjs`, and IO returned to an IO caller |
| A4 | Affine tokens encode grants but can be forged | asserted | Copy and smuggle attempts 8/8 blocked; forgery 3 ways; no constructor privacy |
| A5 | Demo laws kill ≥70% of mutants; ≥20% of refactors break proofs | asserted | 92% killed (39/39 law-false); 0 unsound; 28% of refactors break the proof |
| B1 | Agents solve easy/firm evals, fail hell | **disproved** | 5/5 tiers solved, hell included; all pass `--verdict` |
| C1 | TS property laws separate both behavioural fixtures | asserted | 23 + 19 lines of laws; counterexample within 1–2 runs |
| C2 | Small-scope exhaustive testing kills ≥95% of law-false mutants | **disproved** | 79.8% overall, 100% on standard operators; all misses are large-input mutants |
| C3 | Throw/I-O scan verifies effect claims at ≥80% precision | **disproved** | 65.6% per flag, 85% per function; 21 real discrepancies in Shape's own model |
| C4 | Call graph checks `calls` relations at ≥80% precision | **disproved** | stale-model flagged; 43.5% (symbol level) to 70% (file level) on Shape's own model |
| C5 | Standard types or lint catch cross-object | asserted, narrowly | Only type-aware lint (`no-unnecessary-condition`), and only in the unchanged caller |
| D1 | Bend's gate names every proof-relevant hatch, but not foreign IO | **disproved** | Holes and open laws reported only as a count; foreign IO is reported; run mode warns about nothing |
| D2 | Bend's gate catches no law weakening; a law-set diff catches deletions but not semantic weakening | asserted | Gate catches 0/23; diff flags 20/23 and decides the direction of only 7/23 |
| D3 | Shape models of Bend apps are ≥80% derivable from source | asserted | 96.9% of 1,050 fns; TypeScript types decide 0% of purity |
| D4 | Laws cover under half of a Bend app's defs | asserted | 30.9% of code defs in demos (evals 99%) |
| D5 | A proven `.mjs` can be made to break its law from TS | asserted | 16 violations in 48 calls, in 3 of 4 modules |
| E1 | ≥ half the skill-fixture judgments become deterministic | asserted; residual-judgment prediction partly wrong | See matrix below |
| E2 | `--check-loosening` reproduces the guard fixtures | **disproved** | 1/2, only incidentally; an inspect diff gets 2/2 and 5/8 of the skill's examples |
| E3 | Deterministic extraction finds ≥ half the index gaps | asserted | 2/2 with a new scan; existing `shp` commands find 0/2 |
| E4 | ≥60% of Shape's own conformance claims are deterministically checkable | **disproved** | 32.2%; 99.7% once resources are bound to code |
| E5 | ≥30% of design memories translate into deterministic checks | asserted | 94.4% (83.3% strict); 5/5 implemented checks fire on seeded violations |
| F1 | Enumeration synthesises leaf functions and exposes under-specified laws | asserted | Intended behaviour found for 6/6 (Nat) and 5/6 (JS); every target admits unintended programs |
| G1 | Gated conditions ship fewer hidden-test failures | **disproved** | 0 failures in all 18 trials, in every condition |
| G2 | At least half of ungated agents take the trap | **disproved** | 0/6 |
| G3 | Gaming under 20%, detected deterministically | asserted | 0/12 gated trials gamed |
| G4 | Proof ≥ 3× code; TS laws ≤ 1× code | **disproved as stated** | Proofs 3.1–4.6× code (holds); given TS laws 1.6–2.6× code (fails) |
| G5 | At least 2/3 of Bend trials finish with verified proofs | asserted | 6/6, all `--verdict` |
| G6 | Bend needs more gate iterations | **disproved** (logged runs) | 1.0 vs 1.17 runs, but 2.5× wall time and 1.6× tokens |
| G7 | Compiled Bend passes the TS hidden tests through a value adapter | asserted | 6/6 |
| G8 | Agent-written laws match the reference laws | asserted | 39/39 law mutants killed, identical to the reference laws; 4/4 traps rejected |

Of the 30 experiments, 19 were asserted (some qualified or narrow), 10 disproved and 1 disproved as stated.

## E1: which LLM-CI judgments become deterministic

Each judgment the three Claude CI skills are tested on in `fixtures/skills` is classified below. "Deterministic" means a tool reaches the expected outcome without reading the code for meaning.

| Skill fixture | Judgment | Existing `shp` | With a Bend-style mechanism | Still judgment |
|---|---|---|---|---|
| review / root-cause-grouping | off-by-one in `normalizeRange` | no | yes: contract laws (TS property tests C1; Bend proof A1) | grouping is localised by reverting one function (A1), which is mechanical for this fixture |
| review / cross-object | null → throw breaks caller | no | yes: laws (C1, A1); type-aware lint (C5) | — |
| review / stale-model | authored `calls` relation no longer true | no | yes: call graph flags it (C4) | whether the model or the code is wrong |
| guard / policy-removal | trait removed, silently | no (E2) | yes: semantic inspect diff (E2) | whether the loosening is supported |
| guard / equivalent-relocation | no semantic change | yes (incidental) | yes | — |
| index / coverage-gaps | missing `calls` relation and doc binding | no | yes: call graph + doc scan (E3) | architectural significance; the ordering claim |
| index / missing-ast | proceed without AST | n/a | yes: fixed rule | — |
| index / no-invariant | formatter is not architecture-significant | n/a | yes: pure-leaf proxy | — |

8 of 8 fixture judgments reach the expected outcome deterministically, against 1 of 8 with existing commands.

The judgment that remains is narrower than predicted. It covers whether a loosening is justified, whether the model or the code is the stale side, and what is architecturally significant. The prediction that stale-model warnings and root-cause grouping would stay judgment was wrong for these fixtures.

The fixtures are small and were designed for the skills. The detectors were written with the fixtures in view.

## Reproduce

- **Scripts:** in each track directory, with the commands in that track's report.
- **Bulky outputs:** in the session scratch area. Paths are given in each report.
- **Generation-trial workspaces and hidden tests:** in the scratch area, not committed. The grading code and the per-trial results are committed under `G/`.
