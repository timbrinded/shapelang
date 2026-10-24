# D: Shape governing Bend projects (D1 to D5)

**Toolchain:** Bend 2.0.39 from source (`bendlang/bend` at `295e996`), Bun 1.4.2, and Lean 4.34 for `--verdict`, which was available for every run below.

**Corpus:** the clone's 16 demos, 20 evals, 1,720 test files and `bend2/base.bend`.

**Files:**
- Scripts are in this directory. `run_all.sh` reruns everything in about 3 minutes.
- Compact outputs are in `results/`; bulky ones are in the scratchpad (`bendexp/work/D`).
- All analysis uses Bend's own parser and checker (`bend2/bend.ts`), imported from Bun (`lib/bendbook.ts`).

| ID | Verdict | Key numbers |
|---|---|---|
| D1 | disproved | Holes and open laws are reported only as a count (8/8). Foreign effects used only in IO code are reported and named (4/4). `bend main.bend` warns about no hatch that doesn't block checking (16/16). |
| D2 | asserted | The gate catches 0/23 weakenings once the proof is minimally edited. The law-set diff flags 20/23 but misses all 3 changes to a def a law uses, and it decides direction for only 7/23. |
| D3 | asserted | 96.9% of 1,050 fns are derived deterministically. The hand audit found 0 errors in 68 fns after one fix. TypeScript types decide 0% of purity. |
| D4 | asserted for demos | Law closures cover 30.9% of code defs in demos with laws (25.5% including the one demo with none); evals 99.2%. |
| D5 | asserted | 16 law violations in 48 calls, in 3 of 4 modules; none on in-domain values. |

## D1. Escape-hatch visibility

**Hypothesis.** Bend's gate names every proof-relevant escape hatch, but not foreign effects inside IO code. Falsified if a proof-relevant hatch goes unreported, or if foreign IO effects are reported.

**Method.**
1. `d1/inventory.ts` parses every file and counts hatches from the parsed book, so comments never count.
2. `d1/probes.ts` writes 34 small projects (`main.bend`, `LAWS.bend`, `PROOF.bend`), one per hatch and context. For each it records `bend main.bend`, `bend main.bend --check-only`, `bend PROOF.bend` and `bend PROOF.bend --verdict`.
3. `d1/demo_gates.sh` runs the gate and `--verdict` on the 15 shipped demos that have a `PROOF.bend`.

**Inventory.**

| Hatch | Demos (16) | Evals (20) | Tests (1,522 parsed) | Base |
|---|---|---|---|---|
| `@unsafe` | 12 defs in 5 demos | 0 | 33 in 15 files | `Array.fork`, `Array.join` |
| `def f?` | 0 | 0 | 7 in 6 files | 0 |
| User foreign def (`import "./x.js"`) | 0 | 0 | 124 in 84 files | 58 effects |
| Open law (law with no def) | 0 | 0 | 14 in 14 files (2 of kind `Type`) | 52 bodiless laws: 36 `F32.*`, `U32.to_f32`, 9 `Array.atomic.*`, 6 handle types |
| `?TODO` / `?name` | 0 / 0 | 0 / 0 | 1 / 1 | 0 |
| Defs using a Base F32 axiom | 201 in 2 demos | 0 | 121 in 63 files | |

- **Negative tests.** 198 test files do not parse. All 198 are negative tests that expect a failure.
- **Shipped demos.** 4 of the 15 demo gates already print SOME PROOFS FAIL as shipped, all for `@unsafe` code that no law uses (the gate prints that hint). `--verdict` agrees on all 15.

| Demo | Defs failing |
|---|---|
| `io_http_server` | 2 |
| `io_tcp_echos` | 4 |
| `app_slash_boss_3d` | 4 |
| `pure_hvm5_mini` | 35 |

**Probes.**

| Hatch (contexts) | n | `bend main.bend` | PROOF gate | Names the hatch | Names dependents |
|---|---|---|---|---|---|
| `@unsafe` (pure, value main, law's def, proof of a false law, IO, IO loop, dead code, library) | 8 | runs, exit 0, no warning (8/8) | FAIL 8/8 | 8/8 | 7/8 |
| `def f?` (pure, law's def, IO) | 3 | runs silently 3/3 | FAIL 3/3 | 3/3 | 3/3 |
| Base `@unsafe` `Array.fork` | 2 | runs silently | FAIL 2/2 | 2/2 | 2/2 |
| User foreign effect, IO-typed (main, unused, library, under a law) | 4 | runs, exit 0, no warning (4/4) | FAIL 4/4 | 4/4 | 4/4 |
| Foreign def with a non-IO type | 1 | refused by the checker | refused | yes | |
| Base effects (`IO.print`) | 1 | runs | PASS | | |
| `?TODO` (pure, proof, IO, dead code) | 4 | refused when in main's imports (3/3) | FAIL 4/4 | 0/4 | |
| `?name` (proof, pure) | 2 | refused (1/1) | FAIL 2/2 | 2/2 (goal + `Location:`) | |
| Open law (LAWS.bend, main.bend, IO file, `law Token: Type`) | 4 | refused when in main's file (3/3) | FAIL 4/4 | 0/4 | |
| Open law in main.bend, filled in PROOF.bend | 1 | refused (TODO) | PASS | | |
| F32 axiom (law-covered def, value law, IO) | 3 | runs | PASS 2/3 | | |

Details:
- **`--verdict`** printed the same text as the gate in 34/34 probes, because the hatch check runs before the kernel. The kernel accepted all 5 passing probes.
- **Holes and open laws** both print only `Error: 1 TODO found.` There is no name, and no way to tell the two apart.
- **The one unnamed dependent** is a law-covered def that calls `@unsafe` only in dead code (`(y => 0n)(halve(8, 0))`). The gate names the `@unsafe` def and says no law uses it, which matches Bend's rule that dead code is erased.
- **F32 operations are opaque.** A law that holds in IEEE arithmetic (`F32.add(1.0, 1.0) == 2.0`) is not provable; the gate reports expected `F32.add(1.0, 1.0)`, observed `2.0`. F32 code therefore passes silently but cannot carry value laws.
- **Negative datatypes.** Three attempts at a negative-datatype paradox were rejected by affinity.
- **`--check-only` on `main.bend`** cannot see a hatch in `LAWS.bend` or `PROOF.bend` (4 probes).

**Verdict: disproved, on both clauses.**
- Holes and open laws are reported only as a count, never by name (8/8).
- User foreign effects used only in IO code are reported and named, with their dependents (4/4).
- Running a program (`bend main.bend`) gives no warning for any hatch that sits in main's imports and does not block checking (16/16).

**Threats.**
- The probes are small and written by the experimenter.
- Hub packages, which are imported by hash, were not tested offline.
- The path where bend2 and the kernel disagree was never triggered.

**What a Shape trust declaration would need to cover:**
- Each def that relies on `@unsafe` or a foreign def, with its dependents. This is deterministic: it is the gate's own list.
- Each hole and open law by name. This needs a parser, because the gate gives only a count.
- The host files behind foreign defs, with hashes. The checker reads their type, never their code.
- The Base trust base: 58 foreign effects, 52 bodiless laws, 2 `@unsafe` defs, and native compiled arithmetic.
- Whether a claim rests on bend2 alone or on `--verdict`.
- The runtime caps listed in WONTFIX: Nat at 2^48-1, JS stack depth, and F32 NaN on JS.
- The JS boundary (D5).

## D2. Law weakening

**Hypothesis.** Bend's gate catches no law weakening. A deterministic law-set diff catches deletions and renames, but semantic weakening needs a proof of implication or judgment. Falsified if the gate catches a weakening, or if the diff catches every semantic weakening.

**Method.** `d2/weakenings.ts` applies 23 weakenings and 4 controls to copies of 7 demos: insertion sort, win-is-bug, numerics, par sort, typed eval, HTTP server and triangle. For each one:
- **(a)** run the gate with the proof unchanged;
- **(b)** run the gate and `--verdict` after the minimal proof edit an agent would make (written by the experimenter);
- **(c)** run `d2/lawdiff.ts` between the original and (b). It produces three diffs:
  - *book diff:* the laws reachable from `PROOF.bend`, compared by name and by an alpha-normal form of the statement;
  - *closure diff:* the statement plus the type and body of every non-proof def it reaches;
  - *dir diff:* law names declared in any file;
- **(d)** in `d2/implications/*.bend`, state the old and new laws over an abstracted implementation, prove `old -> new`, and refute `new -> old` with a counterexample implementation.

| Category | n | (a) gate fails, proof unchanged | (b) gate passes after edit | Book diff | Closure diff | Dir diff | (d) |
|---|---|---|---|---|---|---|---|
| Delete law (one kept as a lemma) | 4 | 4 | 4 | 4 | 4 | 4 | n/a |
| Rename law and proof | 2 | 2 | 2 | 2 (as rename, same statement) | 2 | 2 | n/a |
| Move law to a file PROOF.bend does not import | 1 | 1 | 1 | 1 (as removed) | 1 | 0 | n/a |
| Narrow the domain (precondition, instantiation) | 6 | 6 | 6 | 6 | 6 | 0 | 2 attempted, 2 shown strictly weaker |
| Weaken the conclusion | 5 | 5 | 4 + 1* | 5 | 5 | 0 | 4 attempted: 4 refuted `new -> old`, 3 proved `old -> new` |
| Trivially true body | 2 | 2 | 2 | 2 | 2 | 0 | not attempted |
| Change a def the law mentions (`Sorted.from`, `count`, `is_won`) | 3 | 2 | 3 | **0** | 3 | 0 | 1 attempted, shown strictly weaker |
| Control: equivalent restatement | 2 | 1 | 2 | 2 (false alarm) | 2 | 0 | 2 equivalences proved |
| Control: refactor, out-of-domain code change | 2 | 0 | 2 | 0 | 2 (false alarm) | 0 | n/a |

\* H1 (an HTTP response without the blank line): the edited proof checks, but the demo's gate already fails on its `@unsafe` accept loop.

**Result.**
- **Gate:** it rejects 22 of 23 weakenings until the proof is edited, then accepts 22 of 23; the 23rd fails only for the pre-existing reason. `--verdict` agrees. In the final state the gate catches 0 of 23.
- **Proof edits** ranged from -38 to +18 lines; 15 of 22 shrank the proof or kept its length.
- **Book diff:** flags 20 of 23 and misses all 3 def changes. It cannot tell weaker from stronger, and it flags the 2 equivalent restatements the same way. Only 7 of 23 (the deletions, the move, and renames with identical statements) have a direction the diff alone decides.
- **Closure diff:** flags 23 of 23, but also all 4 controls.
- **Dir diff:** flags 6 of 23 and misses the move.
- **Implication proofs:** all 7 attempted files check, `--verdict` included, at 29 to 67 lines each (plus 2 control files). Stating the implication about the demo's *own* sort is provable but uninformative, because the old law is already a theorem (`concrete_new_old` in `IS6-le.bend`).

**Verdict: asserted.**
- The gate never catches a weakening.
- The diff detects changes deterministically, but decides their direction only for deletions and moves.
- Semantic weakening needed either a proof over an abstracted implementation or a reviewer. Choosing what to abstract, and finding the counterexample, are themselves judgment.

**Who guards the law file.** A deterministic layer can turn every change to the law set, the statement hashes or the statement closures into a review obligation. The verdict on such a change stays with the guard skill. The 3 def changes show that protecting `LAWS.bend` alone is not enough: the predicates the laws use (`Sorted`, `count`, `is_won`) live in the AI-owned `main.bend`.

**Threats.**
- The weakenings and proof edits were written by one experimenter agent, not by independent agents.
- 9 of the 16 semantic weakenings got no implication attempt.
- The closure fingerprint is syntactic (alpha-normal), not equality up to evaluation.

## D3. Deterministic indexing of a Bend app into Shape

**Hypothesis.** Shape declarations for a Bend app (components, fns, purity, calls) are derivable deterministically from source at 80% or better, unlike TypeScript, where purity is not in the types. Falsified if under 80%.

**Method.** `d3/extract.ts` loads every `.bend` file of a project with Bend's checker and writes:
- one component per module, and one fn per def, each with `source bend("file#name")`;
- `effects complete {}` for a def whose type mentions no IO and that relies on no `@unsafe` or foreign def;
- typed effects for an IO def, from the Base effect defs its body reaches through all bodies, Base included (for example, `TCP.send` becomes `Write<Network>` and `IO.die` becomes `Exit<Process>`);
- `effects unknown` for an IO def that reaches a user foreign def;
- an untargeted `ReliesOnUnsafe` for any def that relies on `@unsafe`;
- grants equal to the effects used;
- `calls` relations between module pairs whose bodies call each other.

The extractor ran on all 16 demos, and the outputs were checked with strict `shp check`. `d3/audit_sample.ts` resolves every source ref and draws stratified samples for a hand audit. `d3/ts_purity.ts` classifies Shape's own TypeScript functions with the TypeScript 6.0.3 compiler API.

**Result.**
- **Output:** 16 demos gave 46 components, 1,050 fns and 42 `calls` relations. Strict `shp check` passed 16/16, and 1,050/1,050 source refs resolve.
- **Effects:** 903 fns are pure by type, 147 are IO-typed and 51 rely on `@unsafe`. None is `unknown`, since the demos have no user foreign defs.
- **Foreign probes:** on the D1 foreign-effect probes the extractor wrote `effects unknown`. Strict `shp check` then fails, and `--allow-unknown-effects` passes with warnings.

| Audit | Sampled | Errors | Needs judgment |
|---|---|---|---|
| Sample 1 (20 IO, 20 pure, 8 `@unsafe`-reliant) | 48 | 1 before the fix, 0 after | 4 IO fns take IO callbacks; 1 mode hidden (`File.open(path, "w")` listed as `Open<FileSystem>`) |
| Sample 2 (20 IO, drawn after the fix) | 20 | 0 | 7 take IO callbacks |
| `calls` relations | 42 | 0 (all match imports and body references) | 37 involve LAWS/PROOF and 5 link code modules; LAWS -> PROOF edges come from filing a law's proof under LAWS |

- **The one error** was a law about an IO value (`main == IO.print(...)`) that got `Write<Console>`. Proofs are erased, so laws now get no effects.
- **Callbacks:** 33 of the 147 IO fns take IO-typed callbacks. The extractor attributes those effects to whoever builds the closure.
- **Fully derived** without a policy choice: 1,017 of 1,050 fns (96.9%).

| TypeScript, Shape's own source (114 files, 886 functions) | Count |
|---|---|
| Purity decided by types | 0 (there are no effect types) |
| E7-style signature bound (primitive or readonly params, value return) | 221 (24.9%); 42 of them have a local throw, await, host global or mutation |
| No local effect syntax | 566 (63.9%); 328 of them call other functions, so need a call graph |
| Leaf with no effect syntax | 238 (26.9%) |

**Verdict: asserted.** 96.9% are derived, the audit found 0 errors in 68 fns after one fix, and TypeScript types decide 0% of purity.

Still needing judgment:
- effects that arrive through callbacks;
- effect targets and modes, which are runtime strings (file path, host, `"w"`);
- grants as permissions, since derived grants make Shape's grant check vacuous;
- every normative declaration: forbids, rules, rationale, memory.

**Threats.**
- The sample audit was done by the experimenter, and the 48-fn sample was also the one used to find the bug.
- The effect vocabulary is a convention.
- The TypeScript scan is syntactic and over-approximates; for example, a local `Map.set` counts as mutation.

## D4. Law coverage

**Hypothesis.** In Bend's own demos fewer than half of the defs fall under any law's dependency closure. Falsified if half or more are covered.

**Method.** `d4/coverage.ts`:
- **Laws:** the `law` declarations of `LAWS.bend` (demos) or those above `# solution` (evals). Laws declared in `PROOF.bend` are treated as lemmas.
- **Laws as code:** a law whose statement is a data type counts as code to write. 4 evals declare their function this way.
- **Closure:** every def a law's statement names, then everything the types and bodies of those defs name, transitively, excluding Base.
- **Denominators:** covered defs are counted against non-proof *code* defs (defs that do not return a sort) and against *program* defs (code plus predicates).

| Project | Laws | Code covered | Project | Laws | Code covered |
|---|---|---|---|---|---|
| app_pong_game_2d | 2 | 4/18 | proof_insertion_sort | 2 | 6/7 |
| app_ray_tracer_3d | 2 | 5/33 | proof_numerics | 5 | 6/7 |
| app_slash_boss_3d | 7 | 121/428 | proof_typed_eval | 2 | 8/10 |
| app_triangle_2d | 3 | 5/12 | pure_hvm5_mini | 8 | 32/160 |
| app_win_is_bug_2d | 2 | 32/34 | pure_par_sort | 2 | 5/8 |
| io_hello_world | 1 | 1/1 | pure_par_sum | 1 | 3/4 |
| io_http_fetch | 2 | 2/13 | io_rollback_netcode | 0 | 0/160 |
| io_http_server | 2 | 1/7 | **Demos with laws, pooled** | 43 | **232/750 (30.9%)** |
| io_tcp_echos | 2 | 1/8 | **Evals (20), pooled** | 47 | **118/119 (99.2%)** |

- **Other cuts:**
  - program defs (code plus predicates) give 238/767 (31.0%);
  - including `io_rollback_netcode`, which has no laws, gives 232/910 (25.5%);
  - the per-demo median is 41.7%, and 7 of 15 demos are at least half covered.
- **Uncovered:** by a name and type heuristic, the 518 uncovered code defs in demos are 335 other logic, 81 rendering, 74 IO, 14 `main`, and 14 parsing or text.
- **Widest closures:** slash boss `pause_freezes` (114 defs) and `back_to_title` (111), which name the frame step.

**Verdict: asserted for the demos** (30.9%). Evals are built around their laws and are almost fully covered.

**Threats.**
- Closure membership is an upper bound on what a law constrains. `pause_freezes` reaches 114 defs but constrains them only while the game is paused; A5's mutant kills measure the other side.
- The proof/code split and the categories are heuristics.

## D5. The JS boundary

**Hypothesis.** A law-proven Bend module compiled to `.mjs` does not defend its domain: TypeScript callers can violate the law with out-of-domain values. Falsified if no violation is reachable.

**Method.** `d5/build.sh` checks and compiles four modules with `-o x.mjs`:

| Module | Laws |
|---|---|
| insertion sort | `sort_sorted`, `sort_perm`, over `List<Nat>` |
| numerics | `add_comm`, `mul_comm`, `divmod_ok`, over `Nat` |
| `d5/u32` | `add_comm`, plus a new `add_zero` over U32 (proven by induction on the word) |
| `d5/arr` | `mark_reads_b`: writing array `a` does not change what is read from `b` |

`d5/boundary.ts` makes 48 calls, each in its own process with a 5 s timeout, and checks the law's conclusion in TypeScript.

| Input class | Calls | Holds | VIOLATION | Rejected by the module | Crash | Hang |
|---|---|---|---|---|---|---|
| In domain | 9 | 6 | 0 | 0 | 1 | 2 |
| Nat above the runtime cap (2^48-1) | 3 | 0 | 0 | 2 | 0 | 1 |
| Outside the type (negative, fraction, BigInt, string, NaN, Infinity, null/undefined, ≥ 2^32 for U32, objects) | 26 | 1 | 14 | 6 | 2 | 3 |
| Malformed structure (undefined list, wrong tag, missing field, cyclic, empty or frozen array) | 6 | 2 | 0 | 0 | 4 | 0 |
| Aliasing (same array twice, two views of one buffer, retained argument) | 4 | 1 | 2 + 1 affinity breach | 0 | 0 | 0 |

**Violations by module:**
- **sort, 7:** e.g. `[3, -1, 2]` sorts to `[2, 3, -1]`; also digit strings, NaN, Infinity and `null`.
- **u32, 7:** `add(2^32+5, 0) = 5`; `add(-1, 0) = 4294967295`; `add("1", 2) = 12` but `add(2, "1") = 21`.
- **arr, 2:** an aliased `mark(a, a)` reads 99, not 7. In addition, the caller's retained array was mutated.
- **numerics, 0.**

**What the export wrapper checks.** It checks top-level `Nat` parameters (`nat_in`, 0 to 2^53), so numerics rejected all 8 out-of-domain or over-cap values. It does not check nested `Nat` elements, U32 parameters, constructor tags (`{$: "Cons"}` is read as `Con`), or array ownership.

**In-domain failures** come from unary `Nat`. `le_case` costs O(value), so sorting `[2^32+1, 2^32, 7]` hangs, and `add(2^47, 2^47)` overflows the JS stack.

**Verdict: asserted.** 16 law violations in 48 calls, reachable in 3 of 4 modules; none on in-domain values.

**What a Shape boundary claim would need to state,** per exported def:
- **Domain** of each parameter, including nested values: `Nat` is an integer from 0 to 2^48-1; U32 is an integer from 0 to 2^32-1; constructor tags and required fields; array length a power of two.
- **Ownership:** an `Array` argument is consumed, must not alias another argument, and must not be used by the caller afterwards.
- **Cost:** unary `Nat` is O(value) in time and stack.
- **Scope of the law:** it holds only under these conditions, with evidence such as a generated validating adapter.

Shape has no value-domain or ownership construct today. A rationale with evidence would leave the check to judgment.

**Threats.**
- The four modules are small, and the inputs were chosen by the experimenter.
- Native C binaries were not tested; the C lane has its own caps, such as 2^24 copies.

## Files

All under this directory:

- **Scripts:**
  - `lib/bendbook.ts`
  - `d1/inventory.ts`, `d1/probes.ts`, `d1/demo_gates.sh`
  - `d2/weakenings.ts`, `d2/lawdiff.ts`, `d2/implications/*.bend`, `d2/implications/run.sh`
  - `d3/extract.ts`, `d3/audit_sample.ts`, `d3/ts_purity.ts`
  - `d4/coverage.ts`
  - `d5/build.sh`, `d5/boundary.ts`
  - `run_all.sh`
- **Bend modules written for D5:** `d5/u32/` and `d5/arr/`, each with `main.bend`, `LAWS.bend` and `PROOF.bend`.
- **Results in `results/`:**
  - `d1_inventory.json`, `d1_probes.json`, `d1_demo_gates.txt`
  - `d2_weakenings.json`, `d2_implications.txt`
  - `d3_summary.json`, `d3_ts_purity.json`, `d3_example_io_tcp_echos.shape`
  - `d4_coverage.json`
  - `d5_boundary.json`
