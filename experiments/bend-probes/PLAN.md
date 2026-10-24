# Bend probes: plan

Question: can Bend 2, or ideas borrowed from it, close the loop between Shape
claims and generated code deterministically, so that less of that loop depends
on the LLM-powered CI jobs (`shape-review`, `shape-contract-guard`,
`shape-index`)? Speed is out of scope; the measures are generated-code quality,
detection, gaming and cost of evidence.

Today `shp check` never reads source. Whether code conforms to the claims is
established by evidence and judgment, which in CI means the three Claude jobs in
`.github/workflows/shape.yml`. Bend 2 offers four mechanisms that might move
parts of that judgment into a deterministic gate: laws with machine-checked
proofs (`LAWS.bend` / `PROOF.bend`), purity and affinity in the type system,
mandatory termination, and named escape hatches (`@unsafe`, `def f?`, foreign
imports, open laws).

Every experiment states a hypothesis and what would falsify it. A result is
**asserted** or **disproved**; "inconclusive" is allowed only with the reason.

Toolchain: Bend 2.0.39 (`bendlang/bend` at `295e996`) run from source with Bun
1.4.2; `--verdict` needs Lean 4.34 and is optional. LLM trials use fresh Claude
Code subagents as the coding agent (no Claude API key was available).

## A. Bend as the oracle for Shape's claims

| ID | Hypothesis | Falsified if |
|---|---|---|
| A1 | Laws written from the review fixtures' contracts make Bend reject both behavioural candidates (`root-cause-grouping`, `cross-object`) and accept both bases; `stale-model` cannot be stated as a law. | Bend's gate fails to separate base from candidate in either behavioural fixture. |
| A2 | Totality removes the exception class: every Bend encoding of the `cross-object` change (null to throw) is rejected or named by the gate. | An encoding passes `bend PROOF.bend` silently. |
| A3 | Purity is enforced by construction: at least 8 of 10 effect injections into a function with a non-IO type are rejected; foreign imports are the gap. | Fewer than 8 rejected. |
| A4 | Affine capability tokens can encode Shape grants, but without private constructors a function can forge a token. | Forgery is impossible, or capability-free mutants pass. |
| A5 | Laws in Bend's own demos kill most behaviour-changing mutants, and proofs are brittle: a large share of law-preserving edits still break the proof (re-proof work for an agent). | Laws kill under 70% of non-equivalent mutants, or under 20% of law-preserving edits break the proof. |

## B. Can an agent close the loop with proofs at all?

| ID | Hypothesis | Falsified if |
|---|---|---|
| B1 | Fresh agents solve Bend's own proof evals at easy and firm tier and fail at hell tier. | Easy or firm fails, or hell succeeds. |

## C. Bend's ideas in TypeScript, without Bend

| ID | Hypothesis | Falsified if |
|---|---|---|
| C1 | Executable laws (property tests) separate base from candidate on both behavioural review fixtures, with no proof effort. | Either fixture is not separated. |
| C2 | Bounded-exhaustive law testing kills at least 95% of the mutants whose law is false (the set a proof would reject); the residue is large-input or overflow mutants. | Under 95%. |
| C3 | A deterministic source scan for throws and I/O verifies `effects complete` claims and finds real discrepancies in Shape's own model at 80% precision or better. | Precision under 80%, or no discrepancies and no verified claims. |
| C4 | A TypeScript call graph confirms or contradicts authored `calls` relations: it flags `stale-model` and checks Shape's own relations at 80% precision or better. | `stale-model` not flagged, or precision under 80%. |
| C5 | Off-the-shelf types and lint catch `cross-object` (the dead null check after the return type narrowed). | No standard tool flags it. |

## D. Shape governing Bend projects

| ID | Hypothesis | Falsified if |
|---|---|---|
| D1 | Bend's gate names every proof-relevant escape hatch, but not foreign effects inside IO code. | A proof-relevant hatch goes unreported, or foreign IO effects are reported. |
| D2 | Bend's gate catches no law weakening (laws are trusted); a deterministic law-set diff catches deletions and renames but semantic weakening needs a proof of implication or judgment. | The gate catches a weakening, or the diff catches every semantic weakening. |
| D3 | Shape declarations for a Bend app (components, fns, purity, calls) are derivable deterministically from source at 80% or better, unlike TypeScript where purity is not in the types. | Under 80%. |
| D4 | In Bend's own demos fewer than half of the defs fall under any law's dependency closure; the rest still needs review. | Half or more are law-covered. |
| D5 | A law-proven Bend module compiled to `.mjs` does not defend its domain: TypeScript callers can violate the law with out-of-domain values. | No violation is reachable from TypeScript. |

## E. Mechanising the LLM CI jobs

| ID | Hypothesis | Falsified if |
|---|---|---|
| E1 | At least half of the judgments in the skill fixtures become deterministic with existing `shp` commands plus the mechanisms above; stale-model warnings, root-cause grouping and index completeness stay judgment. | Under half. |
| E2 | `shp check --check-loosening` already reproduces the guard skill's expected verdicts on both guard fixtures. | Either fixture differs. |
| E3 | Deterministic extraction finds at least half of the documented gaps in the index `coverage-gaps` fixture. | Under half. |
| E4 | At least 60% of the source-conformance claims in Shape's own model can be checked deterministically (call graph, purity scan, types or a law). | Under 60%. |
| E5 | At least 30% of the design memories in Shape's own model translate into a deterministic check. | Under 30%. |

## F. Synthesis without an LLM

| ID | Hypothesis | Falsified if |
|---|---|---|
| F1 | Bounded enumeration (the SupGen idea, without HVM) synthesises law-satisfying leaf functions for at least 4 of 6 targets, and also finds law-satisfying programs that differ from intent, exposing under-specified laws. | Under 4 synthesised, or no unintended solutions. |

## G. Generated-code quality with and without a deterministic gate

Three tasks, each a feature request that tempts a law violation:

- **T1 wrap board.** Bend's `app_win_is_bug_2d`: make the board wrap around while "winning is impossible" must hold.
- **T3 audit log.** An append-only audit log (a Shape `AppendOnly` resource) gains a retention purge.
- **T4 ledger.** Transfers gain a fee and self-transfers while total balance must be conserved.

Three conditions:

- **C0:** Shape model, contract prose and visible tests (the status quo before the LLM CI jobs run).
- **C1:** C0 plus protected executable laws in TypeScript.
- **C2:** Bend with a protected `LAWS.bend` and the `bend PROOF.bend` gate.

Two seeds each, so 18 trials. Hidden tests check both that the feature works and that the law holds. Protected files are hashed, every gate run is logged, and hidden-test atimes are checked.

| ID | Hypothesis | Falsified if |
|---|---|---|
| G1 | Gated conditions (C1, C2) ship fewer hidden-test failures than C0, and C2 is not better than C1. | C0 is no worse than C1, or C2 beats C1. |
| G2 | Without a gate, at least half the trials take the trap; with a gate, none ship it. | Under half take it in C0, or a gated trial ships it. |
| G3 | Gaming (editing protected laws or tests, `@unsafe`, open laws) occurs in under 20% of gated trials, and every instance is detected deterministically. | 20% or more, or an instance is detected only by reading. |
| G4 | Proof lines are at least 3x code lines in C2; law-test lines are at most 1x in C1. | Otherwise. |
| G5 | At least two thirds of C2 trials reach ALL PROOFS CHECK with the feature delivered. | Fewer. |
| G6 | Bend's expected/observed failures need more gate iterations to green than TypeScript counterexamples. | C2 needs no more iterations than C1. |
| G7 | Every C2 result, compiled to `.mjs`, passes the same hidden TypeScript tests as C0/C1 results through a value adapter only. | An adapter needs logic beyond value conversion. |
| G8 | Laws an agent writes once from the contract prose accept the reference implementation and kill at least 80% of the mutants the reference laws kill. | They reject the reference, or kill under 80%. |
