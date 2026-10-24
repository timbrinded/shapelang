# Bend and HVM for Shape: codebase fit analysis

Scope: where Bend 2, HVM, or ideas from Higher Order Company (HOC) could plug into the Shape repository at `/home/user/shapelang` (commit `d92c0f3`, 2026-10-23), measured against Shape's own workloads and constraints. All repository paths are relative to the repository root. All timings were taken on 2026-10-24 on a Linux x64 host with 4 vCPUs (Intel Xeon @ 2.10 GHz), 15 GB RAM, Bun 1.4.2 (the version pinned by `packageManager` in `package.json`). `hyperfine` and `/usr/bin/time` were not installed, so wall times come from bash `time` with `TIMEFORMAT='%R'`. Phase profiles come from small Bun scripts that import the checker's own modules (`parser.ts`, `checker/lowerer.ts`, `checker/rules.ts`, `checker/api.ts`, `checker/incremental.ts`) and time each phase with `performance.now()`. The scripts were kept in the session scratchpad and are described where their numbers appear. No repository file was modified.

## Q1. What does Shape compute today, and how long does it take?

### Takeaway
`shp check` on the repository's own model (242 files, 1.59 M characters) takes about 0.75 s from source and 0.70 s as a compiled binary. Parsing (Langium) takes about 70% of that and module loading about 15%. Lowering takes 23 to 70 ms. All 18 semantic rules together take 8 ms warm and 35 ms cold, about 1 to 5% of wall time. On small fixtures, 0.2 s of startup is nearly the whole run. Rule evaluation becomes expensive only in one pathological case, a failing model with a very large strongly connected `calls` component, where `forbid hypercycle` grows superlinearly. Batch workloads such as E10 are cheap. They already get a 17 to 23x speedup per mutant from the existing in-process `IncrementalShapeChecker`, with no new runtime.

### Cited Findings

**What the checker computes**
- The pipeline has five phases. Every file is parsed with the Langium grammar, then lowered into one `Model` (typed indexes plus `Fact[]` with provenance). The 18 ordered checks in `SEMANTIC_CHECKS` run next, then `checkBindings`. Diagnostics are sorted, by kind and then by rendered text in codepoint order, and rendered. A parse failure in any file stops the run with exit 2 and builds no `Model`. — [docs-site/src/content/docs/inside-shape/checker-pipeline.md](docs-site/src/content/docs/inside-shape/checker-pipeline.md); [packages/shp-checker/src/checker/api.ts](packages/shp-checker/src/checker/api.ts); [packages/shp-checker/src/checker/rules.ts](packages/shp-checker/src/checker/rules.ts)
- No rule reads `model.facts`. Rules read the typed indexes. Facts leave the checker only with `includeFacts`, and their consumers are tests, the Datalog spike, and the semantic-kernel harness. — [docs-site/src/content/docs/inside-shape/fact-lowering.md](docs-site/src/content/docs/inside-shape/fact-lowering.md)
- The rule kinds are simple index lookups and anti-joins (names, grants, final forbids, context obligations, guards, coverage, bindings), plus graph traversals. `forbid path` uses breadth-first search for a canonical fewest-hop witness. `forbid hypercycle` uses Tarjan's SCC algorithm, then a BFS from every vertex inside each cyclic SCC to pick the canonical shortest cycle. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md) (Graph witnesses); [packages/shp-checker/src/checker/rules/relations.ts](packages/shp-checker/src/checker/rules/relations.ts) (`findHypercycle` l.301, `findShortestPath` l.318, `stronglyConnectedComponents` l.412)
- Checker sizes: `checker/**` (rules, lowering, diagnostics, incremental, queries, model) is 10,359 lines of TypeScript, and the Datalog spike is 185 lines. — command: `wc -l packages/shp-checker/src/checker/*.ts packages/shp-checker/src/checker/rules/*.ts packages/shp-checker/src/checker/lowering/*.ts packages/shp-checker/src/experiments/*.ts`

**Model sizes**

The repository model was measured by the phase profiler, which lowers the 242 files and calls `checkLoweredShapeModel` with `includeFacts: true`.
- Files: 242 discovered by `shp check` (6 authored files with 170,034 characters, and 236 generated-AST files with 1,420,943 characters). `find shape -name '*.shape'` finds 246, because Bun's `Glob("shape/**/*.shape")` skips the 4 files under the dot-directory `shape/generated/ast/.github/`. — command: `diff <(find shape -name '*.shape'|sort) <(bun -e '…new Bun.Glob("shape/**/*.shape")…')`; discovery code in [packages/shp-cli/src/shape-files.ts](packages/shp-cli/src/shape-files.ts)
- Whole lowered model:

  | Measure | Total | Authored |
  |---|---:|---:|
  | Modules | 242 | |
  | Components | 226 | 24 |
  | Resources | 1,389 | 79 |
  | Traits (prelude included) | 479 | |
  | Functions | 1,385 | 101 |
  | Effect entries | 572 | 572 |
  | Generated functions with `effects unknown` | 1,284 | |
  | Grants | 181 | |
  | `owns` | 47 | |
  | Rules | 5 | |
  | Implementations | 224 | |
  | Bindings | 7 | |
  | Memories | 35 | |
  | Rationales | 1 | |
  | Reevaluations | 66 | |
  | Attestations | 1 | |

  — command: `bun <scratchpad>/profile.ts /home/user/shapelang 20` (phase profiler)
- Relations: 1,378 hyperedges. Of these, 53 are `calls`, 20 `provides`, 1 `coordinated_call`, and 1,304 `generated_from` (generated-AST anchors). E10 counted 52 authored `calls` at `b52cb5b`. The extra one here presumably comes from the generated drafts. — profiler output; [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md)
- Facts: 15,166 with origins classified as `shp check` does. The largest kinds are 2,761 `hyperedge_member`, 1,389 `resource`, 1,385 `function`, 1,378 `hyperedge`, 1,310 `resource_trait`, 1,306 `resource_fingerprint`, 1,304 `hyperedge_fingerprint_expectation`, 1,284 `effect_unknown`, 673 `shape_update_for` and 572 `effect`. Without origins (every module treated as authored) the count is 16,450. — profiler, and `bun <scratchpad>/facts.ts`
- The authored model per E10 has 5 rules with 18 clauses (14 `forbid provides`, 1 `forbid hypercycle over calls`, 3 `forbid path … over calls`) and no final forbids. — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md)

**End-to-end wall times**

| Command | Runs | Wall time (s) |
|---|---:|---|
| `bun packages/shp-cli/src/index.ts check` (repo model, exit 0) | 7 | 0.684, 0.727, 0.728, **0.747**, 0.748, 0.762, 0.827 (user 1.38–1.52) |
| Compiled binary: `bun build packages/shp-cli/src/index.ts --compile --outfile <scratchpad>/shp`, then `<scratchpad>/shp check` | 5 | 0.674–0.702, median **0.695** |
| `shp --version`, from source | 3 | 0.124–0.186 |
| `shp --version`, compiled | 5 | 0.091–0.129 |
| `bun -e 0` | 3 | 0.005 |
| Authored files only: `bun packages/shp-cli/src/index.ts check shape/{checker,delivery,incremental-checker,language,runtime,tooling}.shape` | 5 | 0.323–0.413, median **0.335** |
| CI mode: `check --changed-files changed.txt --base-ref b52cb5b --check-cited-paths` | 3 | 0.840–0.899 |
| `check --changed-files changed.txt --base-ref b52cb5b --check-loosening` | 3 | 0.810–0.834 |

- The compiled binary in that table is 83,133,920 bytes (about 79 MiB, with the Bun runtime embedded). It was built without the tree-sitter parser assets that the real release build also passes.
- Small fixtures from source: `fixtures/fail/append_only_hard_delete` (859 chars, exit 1) took 0.211–0.239 s. `fixtures/fail/hypercycle_calls` took 0.231–0.273 s, `fixtures/fail/forbidden_path` 0.223–0.277 s, `fixtures/pass/memory_guard_modify_with_reevaluation` 0.238–0.286 s, and `fixtures/projects/domain-pack-consumer` 0.220–0.238 s. The compiled binary on `append_only_hard_delete` took 0.184–0.218 s. — command: `time bun packages/shp-cli/src/index.ts check <fixture files>`, 5 runs each
- The brief's figure of "about 1.1 s per check run" for E10 does not appear in the committed E10 artifacts (`REPORT.md`, `tables.md`, `results.json`, `scripts/`). E10 ran on 222 files with 4 parallel worker processes. — command: `grep -rn -E "1\.1 ?s|per check|seconds|wall" experiments/verus-probes/e10/`; [experiments/verus-probes/e10/results.json](experiments/verus-probes/e10/results.json) `meta.parallelism`

**Phase profile on the repository model**

Profiler: `bun <scratchpad>/profile.ts /home/user/shapelang 20`. Times are in ms; the "warm" column is the average after 5 untimed iterations (`<scratchpad>/warm.ts`, average of 30).

| Phase | Cold (single run) | Warm |
|---|---:|---:|
| Module import (`parser.ts`, `lowerer.ts`, `rules.ts`, `api.ts`, …) | 109 | |
| Parse, 6 authored files | 152 | |
| Parse, 236 generated files | 313 | |
| Read and parse, total | 543 | 348 |
| Lower | 70 | 22.6 |
| 18 rules | 35.0 | 8.0 |
| `checkBindings` | 0.2 | |
| `formatDiagnostics` | 0.2 | |

- The costliest rules, cold: `checkForbiddenPaths` 13.7 ms, `checkResolvedNames` 4.5, `checkHypercycles` 3.8, `checkFingerprintExpectations` 3.4.
- The costliest rules, warm: `forbiddenPaths` 2.29 ms, `fingerprints` 1.72, `names` 1.68, `requiredContext` 0.76, `functions` 0.44, `hypercycles` 0.22.
- With authored modules only (6 files), warm lowering takes 3.9 ms and the 18 rules 1.7 ms. — `bun <scratchpad>/warm.ts authored`

**Scaling with synthetic models**
- Setup: N components with one function each and about 3N forward `calls` edges, plus `forbid hypercycle over calls` and `forbid path C0 -> C(N-1)`. Each model is a single file, parsed, lowered, and checked once. — `bun <scratchpad>/synth2.ts N acyclic|cyclic`
- **Acyclic, passing.** Times are in ms.

  | N | Relations | Size | Parse | Lower | Rules | `forbidPaths` | `hypercycles` |
  |---:|---:|---:|---:|---:|---:|---:|---:|
  | 1,000 | 2,998 | 296 KB | 390 | 46 | 30 | | |
  | 5,000 | 14,998 | 1.54 MB | 2,903 | 185 | 150 | | |
  | 20,000 | 59,998 | 6.36 MB | 26,711 | 693 | 1,029 | 682 | 206 |

- **Cyclic.** One back edge `C(N-1) -> C0` closes a giant SCC, so the model fails. The `checkHypercycles` cost was 442 ms at N=1,000, 3,001 ms at N=2,000 (`synth2.ts`), and 33,177 ms at N=5,000 (`synth.ts`). That is about N^2.7, consistent with the BFS from every vertex in the SCC described in rule-evaluation.md. A run at N=20,000 was stopped after it exceeded the 10-minute tool timeout.

**Batch workloads (mutation testing)**
- E10 checked about 82,000 mutants of `shape/*.shape` with `shp check`:

  | Operator | Mutants |
  |---|---:|
  | M1, add an effect | 79,415 |
  | M2, remove a grant | 181 |
  | M3, add a `calls` edge | 502 |
  | M4, add a `provides` edge | 1,876 |
  | Secondary samples | 1,120 |
  | Probes (37 M5, 237 destructive-plus-grant, 79 `AppendOnly` controls) | 353 |

  M1 was batched per component (24 batches), with 80 single-run validations. The other operators ran one process per mutant on 4 workers, each with a private copy of `shape/`. — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md); [experiments/verus-probes/e10/scripts/run.py](experiments/verus-probes/e10/scripts/run.py); [experiments/verus-probes/e10/scripts/run_all.sh](experiments/verus-probes/e10/scripts/run_all.sh); [experiments/verus-probes/e10/results.json](experiments/verus-probes/e10/results.json)
- An in-process mutant loop with the existing incremental checker, `bun <scratchpad>/mutbench.ts`:
  - Method: load all 242 documents into `IncrementalShapeChecker`, then for each mutant append one `relation MutI { kind calls connects A -> B }` with module-qualified endpoints to one authored file and call `check(...)`. Only the mutated document is reparsed (the invalidation report confirms one).
  - The initial check took about 600 ms.
  - `shape/runtime.shape` (7,160 chars): 200 mutants, median **32.1 ms**, mean 34.1, p90 43.6. 63 were killed (31.5%, close to E10's 34.3% M3 score).
  - `shape/checker.shape` (52,803 chars): 100 mutants, median **43.9 ms**, p90 61.7, 36 killed.
  - Against the 0.75 s CLI process, that is a 17 to 23x per-mutant speedup with existing code.
- `IncrementalShapeChecker` reparses only changed documents, but any document change rebuilds the whole `Model`, because imports, duplicates, `change` blocks and derived facts cross file boundaries. — [docs-site/src/content/docs/inside-shape/checker-pipeline.md](docs-site/src/content/docs/inside-shape/checker-pipeline.md) (Incremental checking); [packages/shp-checker/src/checker/incremental.ts](packages/shp-checker/src/checker/incremental.ts)
- `--check-loosening` is Shape's built-in "many model variants" workload. For each rule-layer declaration the change removed or edited, it puts back the base version, lowers and checks the copy, and shares the unchanged parsed declarations across copies. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md); [packages/shp-checker/src/checker/loosening.ts](packages/shp-checker/src/checker/loosening.ts)

**Fact projection cost (what a facts-in backend would pay)**
- `checkLoweredShapeModel` on the repository model takes 60.0 ms without `includeFacts` and 1,098.9 ms with it (16,450 facts in that run).
- Sorting the facts with precomputed `JSON.stringify` keys still takes 958 ms. So the cost is in `compareCodepointStrings`, which runs `Array.from()` on both strings in every comparison.
- The JSON fact envelope is about 8.0 MB.
- — command: `bun <scratchpad>/facts.ts`; code in [packages/shp-checker/src/shape-strings.ts](packages/shp-checker/src/shape-strings.ts) (l.11) and `compareFacts` in [packages/shp-checker/src/checker/api.ts](packages/shp-checker/src/checker/api.ts)
- The semantic-kernel benchmark (2026-07-26, Bun 1.3.14) at 1,000 candidate pins: the TypeScript full check (parse, lower, all rules) took 88.53 ms, against 6.96 ms for the native Rust process and 5.75 ms for an in-process WASM call. The two kernel columns run one rule on already projected JSON. The README says the numbers "establish feasibility and scaling data, not a production speedup". The WASM artifact is 202.9 KiB. — [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)

### Inferences
- On the real model, rule evaluation is about 1% of a `shp check` run (8 ms of about 750 ms), and parsing plus process startup are about 85%. Any alternative rule backend can remove at most about 8 to 35 ms per run. Langium parsing and module load are where the time goes.
- Rule evaluation matters only for failing models with very large cyclic `calls` components, and for models of 20,000+ components, where parsing a single 6 MB file already takes about 27 s. The hypercycle hotspot is algorithmic: a BFS from every SCC vertex plus comparisons of cycle sequences. The deterministic min-selection over candidates can be fixed or bounded in TypeScript.
- Batch workloads are small for this repository. E10's roughly 2,900 single-mutant process runs at about 0.75 s are about 36 CPU-minutes. Even all 82,000 mutants unbatched at the measured in-process 32 to 44 ms would be about 45 to 60 CPU-minutes, about 12 to 15 minutes on 4 cores.

### Gaps
- No measurement on Windows, macOS, or ARM. Release archives target those platforms, but this host is Linux x64 only.
- Langium parser internals were not profiled (lexing against parsing against AST linking), so no estimate of how much of the 348 to 543 ms parse time is reducible.
- The 1.1 s per-run E10 figure could not be traced to a committed artifact.
- The synthetic models are single files. Real large models would span many files, which would change parse scaling.

## Q2. What are Shape's non-negotiable constraints, and where are they stated?

### Takeaway
Shape's hard constraints are:
- the read boundary: `shp check` reads only `.shape` files and options, never application source;
- determinism: byte-stable, codepoint-sorted diagnostics and canonical witnesses, with no clock reads;
- final-forbid precedence;
- a single self-contained binary per platform: Linux x64 and arm64, macOS arm64, and Windows x64, with no Bun or Node needed and an offline bundle;
- a conservative dependency policy: any engine or dependency must pass offline release, binary packaging, browser and supported-platform checks, and must beat explicit "reopen" triggers.

Bend 2 and HVM already fail the Windows constraint natively. Bend 2's JavaScript target is the only way in that stays inside it. No written startup-time budget exists.

### Cited Findings

**The read boundary**
- "It never opens or runs the source code the claims reference, so it does not prove that the implementation matches them." — [README.md](README.md)
- "The checker reads `.shape` files and check options, and nothing else." — [docs-site/src/content/docs/inside-shape/checker-pipeline.md](docs-site/src/content/docs/inside-shape/checker-pipeline.md)
- Diagrams must not imply that "`shp check` reads or runs application source". — [DESIGN.md](DESIGN.md) (Content rules)
- `--check-cited-paths` takes a list of repository files, and "The checker reads no files". — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md) (Cited paths)
- "Shape does not derive an authoritative model from source": `shp ast` and `shp author` emit conservative drafts with `effects unknown`. — [docs-site/src/content/docs/inside-shape/design-rationale.md](docs-site/src/content/docs/inside-shape/design-rationale.md)
- `shp author` modes "are advisory. None of them calls a model provider, a subprocess, a network service, or the checker." — [docs-site/src/content/docs/guides/authoring.md](docs-site/src/content/docs/guides/authoring.md)
- `shp analyze` output is advisory and "`shp check` never reads it". — [docs-site/src/content/docs/guides/analyzer.md](docs-site/src/content/docs/guides/analyzer.md)

**Determinism and byte-stable diagnostics**
- "The same `.shape` files and check options produce the same lowered model, facts, and diagnostics". Diagnostics are sorted by kind, then rendered text, in codepoint order (not locale). Facts are sorted by their JSON text. Witnesses are canonical. "The checker never reads the system clock." — [docs-site/src/content/docs/inside-shape/checker-pipeline.md](docs-site/src/content/docs/inside-shape/checker-pipeline.md) (Determinism)
- An automated test enforces byte-identical output across repeated runs of every public surface, identical diagnostics under a permutation of top-level declarations, and no clock reads. — [packages/shp-checker/src/behavioural/determinism.test.ts](packages/shp-checker/src/behavioural/determinism.test.ts)
- "Diagnostics are a product surface … Keep diagnostics, formatting, graph output, and witnesses deterministic so review and CI can compare them." — [CONTRIBUTING.md](CONTRIBUTING.md)
- Shape's model encodes these as design memory that guards code:

  | Memory | Location |
  |---|---|
  | `ClockReadAtCliBoundary` | [shape/tooling.shape](shape/tooling.shape) l.909 |
  | `FreshnessDeterminism` | [shape/checker.shape](shape/checker.shape) l.796 |
  | `ForbiddenPathWitness` (deterministic fewest-hop witness) | [shape/checker.shape](shape/checker.shape) l.780 |
  | `HypercycleWitness` | [shape/checker.shape](shape/checker.shape) l.841 |
  | `DiagnosticContract` | [shape/checker.shape](shape/checker.shape) l.748 |
  | `FinalForbidPrecedence` | [shape/checker.shape](shape/checker.shape) l.764 |

**Semantic invariants any backend must keep**
- Final forbids suppress `missing_grant` for the same entry and are never waived by rationale, memory, reevaluations, attestations, or grants. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md) (Interactions); [CONTRIBUTING.md](CONTRIBUTING.md)

**Single-binary releases on three operating systems, Windows included**
- The four archive targets are:

  | Archive | Bun target |
  |---|---|
  | `shp-linux-x64` | `bun-linux-x64-baseline` |
  | `shp-linux-arm64` | `bun-linux-arm64` |
  | `shp-darwin-arm64` | `bun-darwin-arm64` |
  | `shp-windows-x64` | `bun-windows-x64-baseline` |

  — [packages/shp-checker/src/tree-sitter-native-targets.ts](packages/shp-checker/src/tree-sitter-native-targets.ts)
- The archives are built with `bun build … --compile --target=…` from a single entry point, with tree-sitter native assets beside the binary. — [scripts/build-release-assets.sh](scripts/build-release-assets.sh)
- "The binary needs neither Bun nor Node." — [README.md](README.md)
- The Release workflow's `verify` job installs the release and runs `shp check` on Linux x64, Linux ARM64, macOS ARM64, and Windows x64. The candidate smoke-tests each archive on native runners. — [RELEASING.md](RELEASING.md)
- "Release archives bundle the parsers beside `shp`, so generation downloads nothing". The Windows archives include a native binding that loads inside the compiled executable. — [docs-site/src/content/docs/guides/ast-drafts.md](docs-site/src/content/docs/guides/ast-drafts.md)
- Windows is actively maintained: PR #164, "fix: load native parsers in Windows release archives". — command: `git log --oneline` (`5d033ae`)

**Dependency policy and isolation**
- From the Datalog decision: "no current maintenance or performance result justifies another production dependency". Among the parity requirements: "Any external dependency passes offline release, binary packaging, browser, and supported-platform checks"; "Benchmarks use representative large models and show a benefit large enough to justify the added concepts." — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md) (Why rules are direct TypeScript checks)
- The decision reopens only on a trigger:
  - several rules duplicate the same multi-relation join or recursive derivation;
  - "Representative profiling identifies semantic rule evaluation, rather than parsing or lowering, as a meaningful bottleneck";
  - incremental checking needs dependency-tracked derived facts.

  — same source
- The semantic kernel's adoption criteria: a versioned protocol for every migrated rule, production-parity fixtures, a browser integration strategy, an explicit ownership decision for parsing, lowering, orchestration and rendering, and release packaging plus a compatibility policy. — [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)
- The isolation rule `ExperimentalSemanticKernelIsolation` forbids a `calls` path from `ShapeChecker`, `ShapeEditorServices`, or `ShpCli` to `ExperimentalSemanticKernel`. — [shape/runtime.shape](shape/runtime.shape) l.175
- E10 found leaks in that isolation rule: direct `calls` edges from `ShapeIncrementalChecker`, `DocsSite`, `DocsShapeBlockVerifier` and `ReleasePipeline` pass, and so does any `callbacks` or `coordinated_call` route. — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md)
- Production dependencies today: `langium` and `@kreuzberg/tree-sitter-language-pack` (checker), plus `@stricli/core` and `vscode-languageserver` (CLI). — [packages/shp-checker/package.json](packages/shp-checker/package.json); [packages/shp-cli/package.json](packages/shp-cli/package.json)
- Experiments are isolated: "The checker, CLI, and release archives do not depend on" `experiments/semantic-kernel`. — [CONTRIBUTING.md](CONTRIBUTING.md) (Repository layout)
- Toolchains are pinned: Bun 1.4.2 (`packageManager`), Node 24, and Rust 1.96.0 for the kernel. — [package.json](package.json); [CONTRIBUTING.md](CONTRIBUTING.md); [experiments/semantic-kernel/rust-toolchain.toml](experiments/semantic-kernel/rust-toolchain.toml)

**Startup time**
- No written budget was found. A grep of the repository's Markdown for "startup", "cold start" and "start-up" matches only the semantic-kernel README's note that its native measurement includes process startup. — command: `grep -rn -i "startup\|cold start\|start-up" --include=*.md .`
- Measured floor (Q1): compiled `shp --version` takes 0.09–0.13 s, and a check of a tiny fixture about 0.19–0.22 s.

**Bend 2 and HVM against these constraints**
- Bend 2's README lists these limitations:
  - "No Windows (WSL works)".
  - "A binary needs clang 14+; ! needs 19+, Metal or CUDA 12".
  - "Targets are C, Metal, CUDA and JavaScript".
  - "The JavaScript target runs on one core".
  - "Numbers are Nat, U32 and F32 only".
  - "Strings are linked lists of characters, so text processing is slow".
  - "No TLS, HTTP library, JSON or regex".
  - "The compiler (not kernel) is 99% AI-written and not yet fully audited".
  - "Bend 2 is a new language. Bend 1 programs and HVM do not carry over."

  — [Bend README](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/README.md)
- The Bend 2 installer (version 2.0.39) ships darwin-arm64, darwin-x64, linux-arm64, and linux-x64 archives from `bendlang/bend`, and fails on `MINGW*|MSYS*|CYGWIN*|Windows*` with "Bend needs Linux, macOS or WSL." The installed `bend` checks for updates once a day unless `BEND_NO_TELEMETRY=1` is set. — [bend-lang.com/install.sh](https://bend-lang.com/install.sh)
- The Bend 2 compiler is TypeScript run by Bun (`#!/usr/bin/env bun`, `VERSION = "2.0.39"`).
  - Imported, `main.ts` is a loader: a Bun plugin that "makes `import Game from "./x.bend"` work", and can be handed to `Bun.build`.
  - A `.bend` module exports its defs as JS functions returning plain values (constructors as `{$: "Name", …}`, Nat as number, String native).
  - `bend <file.bend> -o <out>` builds "a binary, or C, JS, .mjs or BendTT by extension".
  - The license is Apache-2.0.

  — [bend2/main.ts](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/bend2/main.ts); [LICENSE](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/LICENSE)
- HVM2: "DISCLAIMER: Windows is currently not supported, please use WSL"; its CUDA runtime "currently only works on Nvidia GPUs". — [HVM2 README](https://raw.githubusercontent.com/HigherOrderCO/HVM2/main/README.md)
- HVM4: "NOTE: you're here before launch. Use at your own risk." It is built with `clang -O2 -o src/hvm src/hvm.c`. — [HVM4 README](https://raw.githubusercontent.com/HigherOrderCO/HVM4/main/README.md)
- The `HigherOrderCO/HVM` repository is titled HVM1 (2022) and calls itself a prototype. — [github.com/HigherOrderCO/HVM](https://github.com/HigherOrderCO/HVM)

### Inferences
- The native Bend and HVM runtimes (C, CUDA, Metal) cannot ship in `shp` without dropping `shp-windows-x64`, which RELEASING.md verifies on every release. They would also add a clang dependency to the release build.
- Bend 2's JS output is plain JavaScript that Bun could bundle into the existing `bun build --compile` binary, which keeps the single binary and Windows. This is untested. It would give up parallelism (one core) and carry an unaudited, mostly AI-written compiler into the build chain, which a project whose product is trustworthy review gates would have to justify.
- Shape's data are mostly strings: module-qualified names, provenance labels, and codepoint-sorted rendered text. Bend's string representation is linked lists of characters, with no JSON. That is a poor match for Shape's data.
- The read boundary rules out any Bend or HVM use that inspects application code inside `shp check`. That kind of work belongs to advisory tools (`shp ast`, `shp analyze`, `shp author`) or to research harnesses.

### Gaps
- No hands-on Bend 2 run. Installing it would have meant writing outside the permitted locations, so it is untested whether Bend 2's JS output bundles cleanly into `bun build --compile` for `bun-windows-x64-baseline`.
- No written Shape policy on startup latency or binary size was found. The measured numbers are the only reference.

## Q3. Candidate overview: how do (a)–(f) fare?

### Takeaway

| Candidate | Fits constraints? | Effort | Expected benefit | Verdict |
|---|---|---|---|---|
| (a) Rule evaluation on HVM via Bend | No natively (Windows, single binary). JS target only, single core. | XL: 18 rules, an incomplete fact contract, canonical witnesses | ≤8–35 ms per run; rules are about 1% of wall time | Ruled out |
| (b) Batch workloads with superposition | Allowed only as an isolated research harness, not in `shp` | L–XL | Small: the existing in-process TS path already gives 17–23x | Not worth it now |
| (c) HOC-style synthesis to draft models | Only as advisory output; must never decide pass or fail | M–L | The idea of enumerating candidate rules has value; HOC tech is unnecessary at Shape's search sizes | Borrow the idea in TS |
| (d) `fold`/`bend` structured recursion, idea only | Yes; no dependency | S–M | Modest: a design discipline for deterministic parallel or incremental evaluation and for fixing the hypercycle hotspot | Reasonable as internal design; not in the user-facing rule language |
| (e) Bend 2 / Kind proofs of checker rules | Research only; creates a second semantic representation | XL | Research value; proofs cover the Bend model, not the TS code | Research only |
| (f) Shape modelling Bend programs | Already works via `bend("…")` refs; drafting unsupported | S (refs) to M (AST drafts) | No observed demand | Wait for demand |

### Cited Findings
- Rule evaluation is 8.0 ms warm of about 750 ms per run, against 348–543 ms of parsing. — Q1 measurements (`profile.ts`, `warm.ts`)
- The reopen triggers require profiling to show "semantic rule evaluation, rather than parsing or lowering" as a meaningful bottleneck. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- Bend 2 does not run natively on Windows, and its JS target is single-core. — [Bend README](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/README.md)

### Inferences
- Ranking by fit: (d) > (c, idea only) > (f) > (b) > (e) > (a). Only (d) and the idea half of (c) need no HOC runtime.

### Gaps
- None beyond the per-candidate gaps below.

## Q3a. Running Shape's rule evaluation (graph rules, effect and forbid checks, Datalog spike) on HVM via Bend

### Takeaway
This is ruled out. There is no performance problem to solve, since rules take 8 ms warm. The fact stream cannot express the rules without extensions, canonical witnesses and diagnostic precedence live in control flow, and native Bend or HVM cannot ship for Windows. Bend's JS target would keep the binary but not the parallelism. The only rule with superlinear cost, `forbid hypercycle` on giant SCCs in failing models, is fixable in TypeScript.

### Cited Findings
- The 18 rules take 8.0 ms warm and 35 ms cold on the repository model. The largest single rule is `checkForbiddenPaths`, at 2.3 ms warm. — `warm.ts`, `profile.ts` (Q1)
- On a 20,000-component synthetic model, all rules take 1.03 s against 26.7 s of parsing. `checkHypercycles` reaches 33 s only on a cyclic (failing) 5,000-node model. — `synth.ts`, `synth2.ts` (Q1)
- The fact stream "is not a complete rule database":
  - `rule` facts lack conditions;
  - `context_required` omits `satisfiedBy`;
  - change events are not facts;
  - final-forbid precedence lives in control flow;
  - path and hypercycle checks need canonical traversal and witness selection;
  - `trait_final_forbid` lacks a `final` flag;
  - replaced declarations leave stale facts.

  — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- The Datalog spike covers only `missing_grant`. It has "no recursion, fixpoint iteration, aggregation, or stratification planner", no cross-rule precedence, and no path or hypercycle witnesses. Its tests confirm it reports a `missing_grant` that production suppresses for a `HardDelete` on an `AppendOnly` resource. — [packages/shp-checker/src/experiments/datalog-rule-engine-spike.ts](packages/shp-checker/src/experiments/datalog-rule-engine-spike.ts); [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- History: the semantic kernel was prototyped on 2026-07-26 (`3f7bfaf`) and the Datalog spike added on 2026-07-27 (`0870fe1`). Direct TS rules were decided on 2026-07-26 (issue #39). Issues #36 ("Prototype Rust semantic kernel", effort XL, "Measure whether the added complexity is justified") and #38 ("Add WASM build", "Keep CLI packaging unaffected") are closed. — command: `git log -- packages/shp-checker/src/experiments experiments/semantic-kernel`; `gh api repos/timbrinded/shapelang/issues/{36,38,39}`
- Graph witnesses must be canonical: neighbours are sorted by target, then relation kind, then name, by codepoint. BFS picks the fewest hops, and hypercycle candidates are compared by length, then vertex sequence, then relation kind and name. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md) (Graph witnesses)
- Platforms and targets: Bend 2 has no native Windows support, the JS target runs on one core, and "Parallelism requires balanced calls". HVM2 has no Windows support. — [Bend README](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/README.md); [HVM2 README](https://raw.githubusercontent.com/HigherOrderCO/HVM2/main/README.md)
- The HVM1 FAQ says it "will always behave deterministically". — [github.com/HigherOrderCO/HVM](https://github.com/HigherOrderCO/HVM)

### Inferences
- Determinism is not the blocker: a pure, confluent evaluator gives deterministic results. The blockers are three:
  - **No benefit.** At most 8 to 35 ms per run could be saved.
  - **Duplicated semantics.** Rules would have to be re-encoded with a richer fact contract, which is exactly the "two semantic representations" the Datalog decision rejected.
  - **Platforms.** Windows rules out the native runtimes, and string-heavy data suit Bend poorly.
- The hypercycle hotspot is embarrassingly parallel: one BFS per SCC vertex, then a deterministic min over candidates. That has the "split, then fold back" structure Bend parallelises. But it appears only for failing models with huge SCCs, and a TypeScript fix (pruning BFS sources by current best length, or bounding comparison cost) is far cheaper than a new runtime.
- Effort estimate: XL. It needs all 18 rules plus `checkBindings`, a protocol extension for each of the listed fact gaps, witness parity, differential tests over the whole fixture corpus (34 fixture cases under `fixtures/pass` and `fixtures/fail`), and release packaging.

### Gaps
- No Bend implementation of any Shape rule was written or timed, so a Bend-against-TypeScript comparison on the same projected facts is not measured.

## Q3b. Bend or HVM for batch workloads (mutation testing, model variants with shared work)

### Takeaway
Batch workloads are the only place where many near-identical checks run, but they are small. E10 is about 2,900 process runs, roughly half an hour of CPU. The work they share (parsing 241 unchanged files and most of the lowered model) is already reusable in-process with `IncrementalShapeChecker`, at 32 to 44 ms per mutant against 750 ms per process. Superposition-based sharing would need the whole pipeline (parser, lowering, rules) inside HVM or Bend. As a research harness it could run on Linux without breaking release constraints, but the benefit is small compared with a cheap TypeScript harness.

### Cited Findings
- The E10 workload sizes (Q1 and REPORT): 79,415 M1 mutants (batched in 24 runs, with 80 single-run validations), 181 M2, 502 M3, 1,876 M4, 1,120 secondary, and probes. Reruns were byte-identical. — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md); [experiments/verus-probes/e10/results.json](experiments/verus-probes/e10/results.json)
- M1 outcomes "are predicted exactly by one fact: a mutant survives iff its component already grants that effect". — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md)
- The in-process incremental checker runs mutants at a median of 32.1 ms (`runtime.shape`, 200 mutants) and 43.9 ms (`checker.shape`, 100 mutants), with about 600 ms for the first check. — `bun <scratchpad>/mutbench.ts` (Q1)
- Warm lowering takes 22.6 ms and warm rules 8.0 ms on the full model. That is the ceiling on what deeper sharing (incremental lowering or rules) could still save per mutant. — `warm.ts` (Q1)
- `--check-loosening` already re-checks model variants while sharing unchanged parsed declarations. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- Superposition-based search, from the HOC demo:
  - It uses SUP nodes to share work across candidate programs. It reports an XOR-XNOR search taking 0.0085 s on HVM against 2.8 s for a Haskell brute force.
  - It needs the `dup_labels` branch of HVM1 and is limited to simple single-pass recursive functions.
  - A commenter notes the Haskell baseline's `Applicative Omega` instance "isn't diagonal", which made it slower than necessary.
  - The author notes Bend lacked "lazy mode, 64-bit dup labels and SUP-node quoting".

  — [VictorTaelin gist](https://gist.github.com/VictorTaelin/7fe49a99ebca42e5721aa1a3bb32e278)
- Experiments may run in CI but must not be depended on by the checker, CLI, or release archives. — [CONTRIBUTING.md](CONTRIBUTING.md); [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)

### Inferences
- With E10's 4 workers, switching E10's harness from per-mutant `bun shp check` processes to one in-process `IncrementalShapeChecker` per worker would cut its single-mode wall time from about 9 to 12 minutes to under 1 minute. Unbatched M1 would become feasible, about 45 to 60 CPU-minutes. This needs no new dependency.
- Superposition pays off when a search space is huge and the candidates share structure inside one pure term. Shape's mutation operators produce independent edits of a text model checked by a TypeScript pipeline. To share work in HVM, the model (or a fact projection of it) and every rule would have to be encoded as interaction-net terms: the effort of Q3a, for a workload measured in minutes.
- If a future workload grows by orders of magnitude, for example exhaustive higher-order mutants (pairs of edits, about 82,000² candidates) or rule mining over all candidate rules, the first step would still be a fact-level, rules-only evaluator over the projected model. The semantic-kernel protocol (Q4) already defines how such a component plugs in. The Datalog-style anti-join for `missing_grant` is the obvious kernel.

### Gaps
- No experiment measured how much of the 22.6 ms lowering could be shared across mutants (incremental lowering is not implemented: "Any document change rebuilds the complete Model").
- HVM or Bend 2 throughput on string-keyed relational joins is unmeasured.

## Q3c. HOC program-synthesis ideas to draft Shape models or claims from code

### Takeaway
Shape deliberately keeps drafting outside the checker and conservative (`effects unknown`, advisory only). `shp check` has no oracle about code semantics, by design, so synthesis from code has nothing in the checker to synthesise against. The transferable idea is enumerating candidate claims against the model itself: for example, proposing `forbid provides` or `forbid path` rules that the current model satisfies and that kill E10 survivors. Those search spaces are small (hundreds of candidates at about 8 ms each), so plain TypeScript enumeration suffices.

### Cited Findings
- `shp ast source` emits drafts in which every generated function keeps `effects unknown`. Candidate effects are keyword guesses with `confidence low` that the checker "never treats … as a declared effect". — [docs-site/src/content/docs/guides/ast-drafts.md](docs-site/src/content/docs/guides/ast-drafts.md)
- The `AstGenerationUnknownSafety` and `AuthoringUnknownSafety` memories guard the draft generators. — [shape/tooling.shape](shape/tooling.shape) l.845, l.877
- "Agents scaffold, humans review, and the checker rejects incoherent claims." — [docs-site/src/content/docs/inside-shape/design-rationale.md](docs-site/src/content/docs/inside-shape/design-rationale.md)
- E10's coverage gaps:
  - 65 of 79 resources have no provider-exclusivity rule;
  - 1,554 `provides` mutants pass, 897 of them a non-owner providing an owned resource;
  - 232 of 256 new `calls` couplings pass, and 0 of 98 shortcuts are caught;
  - 47 edges from core checker or language components into tooling components pass;
  - no resource carries `AppendOnly`.

  — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md)
- The superposition demo covers enumeration of small functional programs against examples (Q3b source). — [VictorTaelin gist](https://gist.github.com/VictorTaelin/7fe49a99ebca42e5721aa1a3bb32e278)
- An unofficial HVM-Zig port lists "SupGen primitives: superposition-based program enumeration for discrete search". This is a secondary source; no official HOC SupGen documentation was found. — [WebSearch result](https://ohotnik.duckdns.org/Lulzx/hvm)

### Inferences
- **Claim mining as an advisory tool.** Enumerate the candidate rules (79 `forbid provides R except <owner>`, 552 `forbid path A -> B over calls` among the 24 authored components), keep those the current model passes, and rank them by how many E10 mutants each kills. Print them as suggestions in the `shp author` or critic style. At about 8 ms of rules per candidate check, plus the mutant sets, this takes seconds in TypeScript.
- Synthesising effect summaries from code would violate the read boundary if it ran in `shp check`, and would duplicate `shp ast` and `shp analyze` if it did not. HOC tooling adds nothing Shape's existing tree-sitter path lacks, apart from search over program space, which Shape does not need.
- Effort: M for a TypeScript claim-mining advisory command or script; L to XL for anything HVM-based.

### Gaps
- No primary, current HOC source describing SupGen's interface or availability was found. The status of HOC's synthesis stack is left to the adjacent research notes.

## Q3d. Bend-style `fold`/`bend` structured recursion for Shape's rule language or engine (idea only)

### Takeaway
This is the most compatible candidate. Expressing each rule as a map over independent units (functions, hyperedges, SCC vertices) followed by an associative, commutative fold into a canonically sorted diagnostic multiset would make parallel or incremental evaluation provably order-independent. Shape already gets the same property by sorting at the end. The fold idea also gives a clean shape for fixing the hypercycle hotspot. Exposing recursion in the user-facing rule language would cut against Shape's "small, explicit" design pressure and its fixed rule forms.

### Cited Findings
- Diagnostic order "depends on neither the `SEMANTIC_CHECKS` order nor declaration order", because results are sorted by kind and then rendered text. — [docs-site/src/content/docs/inside-shape/checker-pipeline.md](docs-site/src/content/docs/inside-shape/checker-pipeline.md)
- `findHypercycle` runs BFS from every vertex in each cyclic SCC and selects the smallest candidate by (length, vertex sequence, relation kind and name). That is a min over a total order: associative, commutative, and order-independent. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- Measured cost of `checkHypercycles` on cyclic synthetic models: 442 ms at N=1,000, 3.0 s at 2,000, and 33.2 s at 5,000. — `synth.ts`, `synth2.ts` (Q1)
- The design pressure asks of any feature: "Can the checker reject contradictions deterministically? … Can diagnostics explain the failure without requiring internal knowledge?"; otherwise it "probably belongs in docs, authoring prompts, analyzer hints, or tests rather than in the core language." — [docs-site/src/content/docs/inside-shape/design-rationale.md](docs-site/src/content/docs/inside-shape/design-rationale.md)
- Rules today come in fixed forms (`forbid provides`, `forbid path … over`, `forbid hypercycle over`, `forbid final` with `when T has Trait`), and a rule must "not adjudicate taste". — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md) (Adding a rule; Rule-derived final forbids)
- A reopen trigger for an engine is "Several new rules duplicate the same multi-relation join or recursive derivation logic". — same source
- In Bend 2, "Recursion must terminate; `@unsafe` or `def f?(..)` turns the check off", and "Parallelism == divide-and-conquer" via balanced recursive calls. — [Bend README](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/README.md)

### Inferences
- Internal adoption could take the form of a small helper in `checker/rules/` that runs `(units) -> map(check) -> fold(mergeSorted)`. It would document that every check's unit function is pure and that the fold is canonical. A cheap property test would check output equality under shuffled unit order, building on `determinism.test.ts`. It needs no runtime dependency and no behaviour change. Its value is preparing for incremental or parallel evaluation if a reopen trigger ever fires.
- For the hypercycle rule, the fold view says each BFS source can stop as soon as its partial cycle exceeds the current best (length, sequence). That pruning keeps canonical results and bounds the superlinear case. This is an inference, not measured.
- Adding user-visible `fold`/`bend` recursion to `.shape` rules would make the rule language Turing-adjacent (termination would need checking) and weaken "explain the failure without internal knowledge". It is not recommended.
- Effort: S for documentation plus a helper, M including the hypercycle rewrite with witness-parity tests.

### Gaps
- The pruning's effect on the hypercycle hotspot was not implemented or measured.

## Q3e. Kind / Bend 2-style proofs to verify Shape's checker rules

### Takeaway
Bend 2 now combines a language and a prover (`LAWS.bend` and `PROOF.bend`, with a Lean-formalised `--verdict` kernel). Proving properties of Shape's rules would mean re-implementing them in Bend 2. The proofs would cover that model, not the production TypeScript, recreating the two-representation problem. At best it is a research reference specification, cross-checked against TypeScript by differential tests (the Datalog-spike pattern). Shape's current verification research direction is Verus, for application code governance.

### Cited Findings
- From the Bend README:
  - `LAWS.bend` declares "rules that your app must not break"; the compiler demands "mathematical proof whenever your code is edited"; "`LAWS.bend` is `AGENTS.md` backed by proof".
  - "Laws are proven about Bend's semantics. The backends can still differ"; "`--verdict` checks the translated terms, the parser and translation into the kernel are not proven"; "The checker has no proof and may have bugs; `--verdict` uses a proven kernel"; "Bend has no tactics or proof search".
  - The `--verdict` kernel is formalised in `bendtt.lean`.

  — [Bend README](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/README.md)
- The Datalog decision: "Direct checks keep one authoritative semantic implementation instead of two semantic representations of the same model". — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- The incremental checker and the Datalog spike are validated by differential tests against the authoritative full check. — [docs-site/src/content/docs/inside-shape/checker-pipeline.md](docs-site/src/content/docs/inside-shape/checker-pipeline.md); [packages/shp-checker/src/experiments/datalog-rule-engine-spike.test.ts](packages/shp-checker/src/experiments/datalog-rule-engine-spike.test.ts)
- Properties already enforced by tests: byte-identical output, permutation invariance, and no clock reads. — [packages/shp-checker/src/behavioural/determinism.test.ts](packages/shp-checker/src/behavioural/determinism.test.ts)
- Shape's design memory states the provable candidates in prose: `FinalForbidPrecedence`, `ForbiddenPathWitness` (fewest-hop) and `HypercycleWitness` (shortest). — [shape/checker.shape](shape/checker.shape) l.764, l.780, l.841
- The Verus probes (E1 to E10) explore Shape governing a Verus project's trust base and specs. E3 found that a solver can decide whether an edited contract is looser: it proved 42 of 44 equivalences on a migration, and flagged 11 of 14 dropped-clause mutants as looser. — [experiments/verus-probes/README.md](experiments/verus-probes/README.md)

### Inferences
- Candidate laws, if a reference model were built: final forbid implies no `missing_grant` for the same entry; diagnostics are invariant under permutation of declarations; the `forbid path` witness has minimal length; the hypercycle witness is a minimal cycle in the SCC; the attestation and coverage rules are monotone.
- Bend 2's restrictions make encoding Shape's data clumsy: affine values ("closures and arrays cannot be shared"), no type classes, Nat/U32 only, and linked-list strings. A Lean or Rocq model, or property-based tests in TypeScript, would be more conventional, with no Bend-specific advantage beyond checker speed.
- Effort: XL. Benefit: assurance about a model of the rules, not the shipped checker, unless paired with differential testing.

### Gaps
- No Kind or Bend 2 encoding of any Shape rule was attempted. The "Kind" language's current status was not checked; Bend 2 appears to have absorbed its proof role.

## Q3f. Shape modelling or checking Bend or HVM programs as a target language (is there demand?)

### Takeaway
Shape can already model a Bend codebase. `SourceRef` is `language=ID '(' path=STRING ')'`, so `bend("src/Game.bend#Game.reset")` parses and drives normal diagnostics. Only `shp ast source` drafting lacks Bend. No user demand was found: none of 166 repository issues or PRs, nor any file, mentions Bend or HVM. The interesting overlap is conceptual. Bend 2's `LAWS.bend` proves code-level laws, while Shape governs architectural claims without reading code. Shape could treat Bend's `@unsafe` and `def f?` escape hatches as trust markers, as the Verus probes did for `external_body` and `assume`.

### Cited Findings
- Grammar: `SourceRef: language=ID '(' path=STRING ')';` — [packages/shp-checker/src/language/shape.langium](packages/shp-checker/src/language/shape.langium) l.191
- A scratch model with `resource Board : AppendOnly` and a function citing `bend("src/Game.bend#Game.reset")` that emits `HardDelete<Board>` fails `shp check` with `error: forbidden effect … evidence: bend("src/Game.bend#Game.reset")`, exit 1. — command: `cd <scratchpad>/bendmodel && bun /home/user/shapelang/packages/shp-cli/src/index.ts check`
- `shp ast source --language bend` fails: "unsupported source language bend; expected javascript, typescript, tsx, rust, go, python, swift". — command output; [packages/shp-checker/src/source-languages.ts](packages/shp-checker/src/source-languages.ts)
- Demand: no issue or PR title among the 166 returned (#1 to #169) mentions Bend, HVM, interaction nets, or superposition. A repository-wide grep for `bend|hvm|interaction.net|superposition|higherorder|kind2|bend2` (excluding `node_modules` and `research_notes`) returns nothing. — commands: `gh api "repos/timbrinded/shapelang/issues?state=all&per_page=100&page=1|2"`; `grep -rn -i -E …`
- Bend 2's own governance mechanism is `LAWS.bend`. Its escape hatches are `@unsafe` and `def f?(..)`, which turn off termination checking, and `@unsafe` is also required for atomic shared arrays. — [Bend README](https://raw.githubusercontent.com/HigherOrderCO/Bend/main/README.md)
- The Verus probes counted trust markers (`external_body`, `assume`, `admit`, …) per commit. E9 found 49% of commits have a trust event, and a per-file count diff catches 85% of them. — [experiments/verus-probes/README.md](experiments/verus-probes/README.md)

### Inferences
- **Minimal support** (S effort) already exists: authored Shape claims with `bend(...)` refs. Coverage, bindings, and cited-path checks treat the path as an ordinary repository path.
- **AST drafts** (M effort) would need a Bend tree-sitter grammar inside `@kreuzberg/tree-sitter-language-pack`, plus a new entry in `SOURCE_LANGUAGES`. Shape's AST drafting does not cover the Verus language either: E4 found `shp ast` sees no functions inside `verus!`.
- **A trust-marker probe** in the style of Verus E9 could count `@unsafe`, `def f?` and foreign-function declarations, and check law edits for loosening against `LAWS.bend`. That would be the most Shape-like contribution to Bend users. It belongs in an experiment until a user asks for it.
- With no demand signal, building Bend-specific features now would be speculative.

### Gaps
- Whether `@kreuzberg/tree-sitter-language-pack` or any tree-sitter grammar for Bend 2 exists was not checked.
- Bend 2's own issue tracker (`github.com/bendlang/bend/issues`) was not searched for interest in architecture governance. Session GitHub access is limited to the Shape repository.

## Q4. What does the semantic-kernel experiment's design imply for any alternative evaluation backend?

### Takeaway
The kernel sets the integration contract for any Bend, HVM, Datalog, or Rust backend:
- versioned, strict JSON facts in and structured diagnostics with causal provenance out;
- TypeScript keeps ownership of parsing, lowering, orchestration, and rendering;
- a parity harness compares normalized diagnostic sets with production, and checks byte-identical output across surfaces;
- the isolation is enforced by a Shape rule and CI;
- adoption needs per-rule protocols, a browser strategy, and release packaging.

Measured on the repository model, the projection itself (sorted facts, about 8 MB of JSON, about 1 s) costs more than all rules combined. A backend would also need the fact contract extended for most rules.

### Cited Findings
- **Boundary.** The kernel "accepts only protocol-v1 JSON, never Shape source". It reads only `resource`, `resource_fingerprint` and `candidate_effect` facts, and emits only `candidate_pin_fingerprint_mismatch` with structured provenance. "The production TypeScript checker remains the only semantic authority for parsing, lowering, rule orchestration, diagnostic rendering, the CLI, and editor services." — [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)
- **Strictness.** `schemaVersion` must be 1. Unknown fields, duplicate fact identities, explicit `null` optionals, and malformed JSON are all rejected. A rejected request exits 2 from the native binary and throws from WASM. "Successful requests produce byte-identical responses from both surfaces." — same source; [experiments/semantic-kernel/schema/kernel-protocol-v1.schema.json](experiments/semantic-kernel/schema/kernel-protocol-v1.schema.json)
- **Ordering mismatch.** Protocol diagnostics are sorted by qualified fields, while production sorts by kind and then rendered text (local display names). So "The two orders can therefore differ", and the parity harness compares normalized semantic sets and tests protocol ordering separately. — [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)
- **Projection.** `harness/protocol.ts` projects facts from the public `Fact[]` (`includeFacts: true`). The harness depends on the production parser and checker, not the other way round. — same source; [experiments/semantic-kernel/harness/protocol.ts](experiments/semantic-kernel/harness/protocol.ts)
- **Isolation and CI.** The Shape rule `ExperimentalSemanticKernelIsolation` forbids modelled `calls` paths into the kernel. The CI job "Semantic Kernel Prototype" runs `kernel:check`, `kernel:build` and `kernel:e2e`, and uploads the WASM build as a 7-day diagnostic artifact that is "not release assets". — [shape/runtime.shape](shape/runtime.shape) l.175; [CONTRIBUTING.md](CONTRIBUTING.md) (CI); [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)
- **Adoption criteria:** a versioned protocol for every migrated rule; parity fixtures for precedence, ordering, malformed input, and provenance; a browser integration strategy including initialization and delivery costs; an explicit ownership decision; release packaging and a compatibility policy. — [experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md)
- **Projection cost on the real model:** `includeFacts` raises `checkLoweredShapeModel` from 60 ms to 1,099 ms (16,450 facts). Sorting with precomputed keys still takes 958 ms, because of `compareCodepointStrings` (`Array.from` per comparison). The JSON envelope is about 8.0 MB. — `bun <scratchpad>/facts.ts`; [packages/shp-checker/src/shape-strings.ts](packages/shp-checker/src/shape-strings.ts)
- **Fact-contract gaps** that block migrating most rules are listed in Q3a. — [docs-site/src/content/docs/inside-shape/rule-evaluation.md](docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- **E10 leaks.** E10 showed the isolation rule leaves routes open: direct `calls` edges from `ShapeIncrementalChecker`, `DocsSite`, `DocsShapeBlockVerifier` and `ReleasePipeline`, and all `callbacks` and `coordinated_call` routes. — [experiments/verus-probes/e10/REPORT.md](experiments/verus-probes/e10/REPORT.md)

### Inferences
- A Bend or HVM backend would plug in exactly where the Rust kernel does: an isolated `experiments/` component fed by `harness/protocol.ts`-style projections, with a native process and (for Bend) a JS module standing in for the WASM surface, under the same parity harness. The Bend 2 JS loader (`import X from "./x.bend"`) makes the in-process JS surface easy to wire in a Bun harness. The production checker must still not call it.
- A protocol-based backend cannot be faster end to end on Shape-sized models until projection is cheap. Today the sorted projection costs about 1 s, against about 30 ms for lowering plus rules. A backend would therefore need either an unsorted or streamed projection (and its own canonical ordering) or a fix to `compareCodepointStrings`. The fix is a cheap TypeScript change that benefits `includeFacts` and `shp inspect`-style consumers regardless of any backend.
- Any new backend should come with a tighter isolation rule, such as `forbid path … over calls or callbacks or coordinated_call` from every production component. Otherwise the leaks E10 found apply to it too.

### Gaps
- Whether `shp inspect --json` also hits the slow comparator path was not measured.
- The browser integration cost of a Bend-generated JS module, in size and startup, was not measured. The kernel's WASM artifact is the only comparison point (202.9 KiB).
