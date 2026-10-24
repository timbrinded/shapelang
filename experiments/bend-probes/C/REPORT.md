# Bend probes, track C: Bend's ideas in TypeScript (C1–C5)

**Toolchain:**
- Bun 1.4.2
- fast-check 3.23.2
- TypeScript 5.9.3 (compiler API and `tsc`)
- tsgo 7.0.0-dev.20260421.2 (the repository's)
- oxlint 1.66.0 with oxlint-tsgolint 7.0.2005
- ESLint 9.37.0 with typescript-eslint 8.46.0

Third-party packages are installed under `$CWORK` (scratch), not in the repository. Scripts are in this directory; bulky outputs are in `$CWORK/c{1..5}/`.

| ID | Verdict | Key number |
|---|---|---|
| C1 | asserted | Both fixtures separated; 23 + 19 law lines; first counterexample after 1–2 runs |
| C2 | disproved as stated (residue clause holds) | Small scope kills 67/84 law-false mutants (79.8%); all 17 survivors are the large-input mutants |
| C3 | disproved | 32 flags, 21 real discrepancies (65.6%); per function 17/20 (85%) |
| C4 | disproved (stale-model part holds) | stale-model flagged; precision on Shape's model 43.5% at symbol level, 70.0% at file level |
| C5 | asserted, narrowly | Only type-aware lint (`no-unnecessary-condition`) flags it, in the unchanged caller; compilers and the repo's lint do not |

## C1: executable laws on the behavioural review fixtures

**Hypothesis.** Executable laws (property tests) separate base from candidate on both behavioural review fixtures, with no proof effort. Falsified if either fixture is not separated.

**Method.** `bun c1/run-c1.mjs`.
- Laws were written from the contracts: `c1/laws-root-cause.mjs` (4 laws) and `c1/laws-cross-object.mjs` (3 laws).
- `base/` holds only the changed file, so "base" means `base/` overlaid on `candidate/`.
- Each law ran in fast-check with 1,000 runs and seed 42.

**Result.**

| Fixture | Law | Base | Candidate (shrunk counterexample, runs to failure) |
|---|---|---|---|
| root-cause-grouping | Normalization preserves both endpoints | holds | fails `(0,0)`, 1 run |
| | Both endpoints are included | holds | fails `[0,0]`, 1 run |
| | inclusiveSize counts the included integers | holds | **holds** |
| | One-point range has size 1 | holds | fails `0`, 1 run |
| cross-object | Unknown ids present as "not found" | holds | fails `""` (throws `missing record`), 1 run |
| | Known ids present their catalog label | holds | holds |
| | presentRecord never throws | holds | fails `""`, 2 runs |

Law-writing effort: 23 and 19 non-blank, non-comment lines, generators included. No proofs.

**Verdict: asserted.** Both fixtures separate. The consistency law alone (size agrees with membership) does not separate root-cause-grouping, because both metrics read the same shifted normalization. Only the endpoint laws taken from the contract catch it.

**Threats.**
- The laws were written knowing the bugs.
- The "known id" set (`"known"`) comes from reading the base code.
- stale-model has no behaviour to state a law about.

## C2: bounded-exhaustive law testing against mutants

**Hypothesis.** Bounded-exhaustive law testing kills at least 95% of the mutants whose law is false (the set a proof would reject), and the residue is large-input or overflow mutants. Falsified if under 95%.

**Method.**

Three modules in `c2/modules/`, each with a law checker in `c2/laws/` (line counts exclude generators):

| Module | Code lines | Law-checker lines |
|---|---:|---:|
| ranges | 27 | 33 |
| ledger | 44 | 41 |
| log | 57 | 49 |

The laws:
- **ranges:** normalize orders the endpoints and preserves them. Merge keeps the covered set (decided exactly by probing every boundary ±1), outputs sorted, disjoint, non-adjacent ranges, and does not mutate its input. `contains` agrees with coverage.
- **ledger:** total balance is conserved; balances stay in U32; a rejection changes nothing; unknown accounts are rejected; untouched accounts are unchanged; the receiver gets exactly `amount`; a positive transfer credits a positive fee to account 0; a self-transfer costs exactly the fee; a transfer with ample funds and headroom succeeds.
- **log:** ids are 0..n−1 and keep their prefix; the count never decreases; append, redact and retention change exactly the specified entries; `find` agrees; no operation modifies the previous log.

**Mutants.** `c2/mutants.mjs` defines 98 single-edit mutants: 34 for ranges, 32 for ledger and 32 for log.
- **Operators:** arithmetic, relational, boundary ±1, constant, statement deletion, argument swap, stale read, return default, variable replacement.
- **Large-input tag (17 mutants):**
  - U32 overflow via `|0`, `>>>0` and `Math.imul`, and a missing overflow check;
  - lexicographic sorting, which fails only from two-digit values;
  - segment arithmetic, which fails only beyond 7–9 log entries;
  - G27, a retention change that deletes sealed, fully redacted segments.

**Techniques.** `bun c2/run-c2.mjs` runs each mutant in its own process:
- **(a) pbt:** fast-check, 1,000 runs, seed 42, generic generators (U32 values; up to 16 ranges; up to 8 accounts; up to 32 operations with ids ≤32).
- **(b) small:** exhaustive over values 0..5, lists of up to 4 and operation sequences of up to 4. That is 1,727,605 inputs for ranges, 335,664 for ledger and 41,371 for log.
- **(c) ground truth,** for mutants that (a) and (b) did not both kill:
  - a larger exhaustive scope plus boundary values: 20,050,386, 3,139,228 and 309,217 inputs, including logs with up to 40 appends;
  - then 100,000 boundary-biased fast-check runs with seed 7;
  - then manual analysis of every survivor (`c2/summarize-c2.mjs`, `LAW_TRUE`).

Every check of the original modules passed. A mutant is law-false if any technique found a counterexample. All 14 survivors were argued law-true by hand.

**Result.** From `bun c2/summarize-c2.mjs`; per-mutant rows are in `c2/mutants.csv`. Kill rates are relative to the law-false set.

| Set | Mutants | Law-true | Law-false | tsc rejects | pbt | small | pbt ∪ small |
|---|---:|---:|---:|---:|---:|---:|---:|
| ranges | 34 | 4 | 30 | 1 | 29 (96.7%) | 26 (86.7%) | 30 (100%) |
| ledger | 32 | 6 | 26 | 0 | 22 (84.6%) | 20 (76.9%) | 24 (92.3%) |
| log | 32 | 4 | 28 | 1 | 23 (82.1%) | 21 (75.0%) | 23 (82.1%) |
| Standard operators | 81 | 14 | 67 | 2 | 64 (95.5%) | **67 (100%)** | 67 (100%) |
| Tagged large-input | 17 | 0 | 17 | 0 | 10 (58.8%) | **0 (0%)** | 10 (58.8%) |
| **All** | 98 | 14 | 84 | 2 (2.4%) | 74 (88.1%) | **67 (79.8%)** | 77 (91.7%) |

- **The small-scope residue** is exactly the 17 tagged mutants: four in ranges, six in ledger and seven in log. pbt kills 10 of them.
- **Seven survive both pbt and small scope:**
  - L21 and L22: fee-account overflow at exactly 2^32;
  - G01, G02, G12, G20 and G27: they need 8–10 appends. G20 fell only to the large exhaustive scope.
- **pbt misses three standard boundary mutants** that small scope kills: R12 (merging across a one-value gap), and L09 and L12 (exact-balance overdraft).
- **The 14 law-true mutants** are 7 equivalent mutants and 7 behaviour changes the laws permit: the fee schedule (L04, L05, L06, L31), boundary rejections (L10, L23) and aliasing in `normalize` (R05). A proof would accept these too; laws are not a full specification.

**Verdict: disproved as stated.**
- Small-scope exhaustive testing kills 79.8% of law-false mutants, not 95%.
- The residue clause holds exactly: every survivor is a large-input or overflow mutant, and small scope kills 100% of the law-false standard-operator mutants.
- The overall rate is set by the mutant mix: 17 of the 84 law-false mutants were large-input by instruction.

**Threats.**
- The mutants were written knowing the laws.
- The ground truth for law-true mutants rests on manual argument, not proof.
- pbt results depend on generator choices (sequence length 32, ids ≤32).

## C3: deterministic purity and throw scan

**Hypothesis.** A deterministic source scan for throws and I/O verifies `effects complete` claims and finds real discrepancies in Shape's own model at 80% precision or better. Falsified if precision is under 80%, or if there are no discrepancies and no verified claims.

**Method.** `bun c3/scan-effects.mjs` runs the TypeScript compiler API over the repository's tsconfig roots plus the fixtures (`c3/graph.mjs`).
- **Resolution.** Each `source ts("path#symbol")` resolves to a function, a variable or a class method. Scanning a body includes its closures and default parameters.
- **What is collected:**
  - I/O sites, classified by import specifier or global into channels: fs-read, fs-write, subprocess, env, stdio, process, clock, random, network, module-load;
  - `throw` statements and throwing built-ins (`JSON.parse`, `new URL`, `structuredClone`, dynamic `RegExp`), unless caught by a lexically enclosing try/catch;
  - edges to repo-local units: calls, `new`, value references (callbacks and handler tables), and `import("./x")`.
- **Propagation.** Effects propagate transitively, reported at depths 0–8 and at the fixpoint.
- **Effect mapping.** `c3/effects-map.mjs`, written from resource names before any results were seen, maps declared effects to the channels they justify. Examples:
  - Read<SystemClock> → clock;
  - file resources → fs;
  - ChangedFileList and BaseShapeModel → git and fs;
  - DiagnosticText and EditorOutput → stdio;
  - CommandLineInterface → env, process and stdio.

  Shape's model declares effects on logical resources, so the table is permissive.
- **Classification.** Every flag was classified by reading its code path (`bun c3/manual.mjs`).

**Result.** There are 107 authored functions: 101 in `shape/` and 6 in fixtures. 82 have `ts#symbol` sources, and all 82 resolve. The other 25 were not scanned: 6 have file-only TypeScript sources and 19 have YAML, shell, Rust, Langium or MJS sources.

| Depth | 0 | 1 | 2 | 3 | 4 | 6 | ∞ |
|---|---:|---:|---:|---:|---:|---:|---:|
| Consistent with claim | 74 | 69 | 63 | 62 | 62 | 62 | 62 |
| … with fully resolved closure | 66 | 50 | 41 | 37 | 35 | 34 | 34 |
| Functions flagged / flags | 8/10 | 13/16 | 19/25 | 20/27 | 20/30 | 20/32 | 20/32 |
| Can throw (uncaught) | 9 | 20 | 24 | 26 | 27 | 27 | 27 |
| Mean closure units | 1.0 | 5.9 | 17.2 | 37.6 | 68.3 | 116.8 | 142.1 |

The deepest closure is 14 levels (`ShpCli.main`, 1,067 units). Both Read<SystemClock> claims (`isoToday`, `main`) are confirmed from depth 6.

| Class of the 32 flags (depth ∞) | Count | Channels |
|---|---:|---|
| true (the I/O happens and no declared effect denotes it) | 21 | env 17: `process.cwd()` fallbacks in the checker, CLI and LSP; platform detection for the native parser; `Bun.argv`; `process.env` passed to canaries. process 3: `process.exitCode`, `process.report`. clock 1. |
| map (the I/O happens and a declared effect cites that code, but the table missed it) | 7 | subprocess 5: git, canaries, `node --check`. network 2: update downloads. |
| fp (the I/O does not happen) | 4 | fs-read 3: Langium `NodeFileSystem` is wired in but parsing reads a string. 1: a pure `Bun.YAML.parse` flagged as unknown. |

- **Precision:** 65.6% of flags are true discrepancies, and 87.5% are real I/O (true plus map).
- **By function:** 17 of 20 flagged functions (85%) have at least one true discrepancy. The 21 true flags come from 13 source sites.
- **Known false negatives, so "consistent" does not mean verified:**
  - stdout written through `context.process` (dependency injection);
  - implicit `cwd` reads in `path.resolve`;
  - external packages are opaque;
  - 54 unresolved callees in `main`'s closure.

**cross-object.**
- In the candidate, `getLabel` is flagged as throwing (catalog.ts:3, depth 0), and `presentRecord` as throwing through `getLabel` (depth 1).
- In the base neither throws, and none of the three functions has any I/O.
- All three claim `effects complete {}`. Shape's prelude has no Throw effect and effect names are free identifiers, so the throw contradicts no claim. The scan can only report it as a change from base to candidate.
- A `Throw` effect name or a totality trait would turn it into a claim violation.

**Verdict: disproved.** Precision of real discrepancies is 65.6% at flag level, below 80%. The other clause holds: 62 claims are consistent and 21 real discrepancies were found. At function level precision is 85%.

**Threats.**
- The channel table is a judgment, and it decides the 7 "map" flags.
- Counting `process.cwd()` defaults as true discrepancies is a judgment. They make the checker's output depend on the working directory when `repoRoot` is omitted.
- Closures over-approximate, for example through value references.

## C4: conformance of calls relations

**Hypothesis.** A TypeScript call graph confirms or contradicts authored `calls` relations: it flags stale-model and checks Shape's own relations at 80% precision or better. Falsified if stale-model is not flagged, or if precision is under 80%.

**Method.** `bun c4/calls.mjs`, on the same graph as C3.
- **Membership.** A component's members are the units its functions' sources name: the symbol for `#symbol` sources, and every top-level unit of the file for file-only sources. The file-level variant also adds every top-level unit of each cited file.
- **Edges.** Component A calls component B if the closure of A's members, taken through units that belong to no component, reaches a member of B. Every edge kind counts; a calls-only count is reported alongside.
- **Verdicts.** A relation is "contradicted" when A's closure has no unresolved callee, and "unconfirmed" otherwise.
- **Scope.** `coordinated_call` was not checked.
- **Classification.** Every flag was classified by hand (`bun c4/manual.mjs`).

**Result.**

Fixtures: root-cause-grouping and cross-object are confirmed by a direct call. stale-model is **contradicted**: `loadReport` calls nothing, and `RemoteTemplate` has no functions.

Shape's own model has 52 relations: 50 distinct pairs, 2 of them uncheckable.

| | Symbol level | File level |
|---|---:|---:|
| Confirmed (any edge / call or `new` only / direct only) | 34 / 26 / 19 | 37 / 29 / 31 |
| Contradicted / unconfirmed with unresolved calls | 7 / 7 | 4 / 7 |
| Observed edges with no authored relation | 9 | 19 |
| True flags / all flags | 10/23 = **43.5%** | 21/30 = **70.0%** |

- **True flags, missing calls.** Four authored relations have no call in the code: ShapeBindings→ShapeModelLowerer, ShapeDiagnostics→ShapeRuleEngine, ShapeModelLowerer→ShapeParser and ShapeRuleEngine→ShapeModelLowerer. All four record data dependencies under `kind calls`, and the code calls in the opposite direction, from the lowerer to `derivations.ts`.
- **True flags, undeclared calls.** The rest are undeclared calls; at file level, mostly calls to utilities (`compareCodepointStrings`, `splitModuleReference`).
- **False positives** have three causes:
  - non-TypeScript endpoints: CI YAML, Rust/WASM, the Langium grammar, Astro (6);
  - two components citing the same file (2–3);
  - helpers that are not modelled, at symbol level (4).
- **Spot check.** The 8 confirmations that rest only on references or `import()` (sort comparators, prelude constants, the CLI's lazy command loaders) were checked; all are real.

**Verdict: disproved.** stale-model is flagged, but precision on Shape's own relations is 43.5% at symbol level and 70.0% at file level, both below 80%.

**Limits.**
- Calls the graph cannot resolve: interface methods, callback parameters and injected services.
- Generated code.
- Cross-language and CI-driven relations, which cannot be confirmed at all.
- Results move with the choice of membership granularity.

## C5: types and lint on cross-object

**Hypothesis.** Off-the-shelf types and lint catch cross-object (the dead null check after the return type narrowed). Falsified if no standard tool flags it.

**Method.** `bun c5/run-c5.mjs` ran each tool on base and candidate, each consisting of `catalog.ts` and `presenter.ts`. Exact outputs are in `$CWORK/c5/transcript.md`.

| Tool | Base | Candidate |
|---|---|---|
| `tsc -p` (strict plus every strictness flag), TS 5.9.3 | exit 0, no output | exit 0, no output |
| `tsgo -p` (strict) | exit 0, no output | exit 0, no output |
| oxlint with the repo's `.oxlintrc.json --deny-warnings` | exit 0, no output | exit 0, no output |
| oxlint `-W all -W nursery` (no type information) | style warnings only | style warnings only |
| oxlint `--type-aware -W all` | no relevant finding | no relevant finding |
| oxlint `--type-aware -W all -W nursery` | — | `presenter.ts:5:10: warning typescript(no-unnecessary-condition): This condition will always return the same value since the types have no overlap. help: The left side has type string, and the right side has type null.` |
| typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` | exit 1 (`prefer-nullish-coalescing` only) | exit 1, adding `5:10 error Unnecessary conditional, the types have no overlap @typescript-eslint/no-unnecessary-condition` |
| typescript-eslint, four typed rules | exit 0 | exit 1 (the same `no-unnecessary-condition` error) |
| The same, linting only the changed file `catalog.ts` | exit 0 | exit 0 |

**Verdict: asserted, narrowly.**
- Only type-aware lint flags the bug: typescript-eslint's `no-unnecessary-condition`, or oxlint's equivalent, which is a nursery rule in 1.66. The compilers and the repository's lint configuration do not.
- The flag points at the dead branch in the unchanged caller, not at the new throw, so lint run only on changed files misses it.
- No tool reports that unknown ids now throw.

**Threats.**
- A single fixture.
- The null-check symptom exists only because the caller kept a now-dead branch. A caller written without the check would get no warning at all.

## Reproduction

```sh
cd $CWORK && bun add typescript@5.9.3 fast-check@3.23.2 eslint@9.37.0 typescript-eslint@8.46.0 oxlint@1.66.0 oxlint-tsgolint@7.0.2005
cd experiments/bend-probes/C        # CWORK defaults to the session scratch path (lib/work.mjs)
bun c1/run-c1.mjs
bun c2/run-c2.mjs && bun c2/summarize-c2.mjs     # about 3 minutes on 4 cores
bun c3/scan-effects.mjs && bun c3/manual.mjs
bun c4/calls.mjs && bun c4/manual.mjs
bun c5/run-c5.mjs
```
