# Bend probes, track A (A1–A5): report

**Setup**
- **Toolchain:** Bend 2.0.39 from source under Bun 1.4.2, with `BEND_NO_TELEMETRY=1`.
- **Gate:** `bend PROOF.bend`, or `bend f.bend --check-only` for a file without a `PROOF.bend`.
- **`--verdict`** (Lean 4.34 kernel): run on every A1–A4 gate result and on every A5 survivor. It agreed with the plain gate every time.
- **Files:** scripts are in this directory, bulky outputs under `$X/work/A/` (A5 raw data in `A5final.jsonl`), small tables in `results/`.

| ID | Verdict | Key numbers |
|---|---|---|
| A1 | asserted | Both behavioural fixtures are separated; a `calls` relation cannot be stated as a law |
| A2 | asserted, with a qualification | 0/18 encodings pass the gate; 8/18 are total programs that only the protected laws reject, and 4 of them stop the process at run time without being named |
| A3 | asserted on the criterion (10/10); the predicted gap is wrong | Foreign defs must be typed `IO(...)`. The real routes are type aliases, structural IO, host callbacks across `.mjs`, and IO values returned to IO callers |
| A4 | asserted | Copy and smuggle attempts are blocked (8/8); forgery works 3 ways; Bend has no constructor privacy |
| A5 | asserted | Mutation score 92%; mutants with a false law killed 39/39; 0 unsound; 28% of refactors break the proof |

## A1. Bend as oracle for the three review fixtures

**Hypothesis.** Laws written from the fixtures' contracts make Bend reject both behavioural candidates and accept both bases; `stale-model` cannot be stated as a law.

**Method.**
- **Ports:** TS `number` becomes `Nat`; `string | null` becomes `Maybe<String>`.
- **Laws:** taken only from `contract.md` and the Shape model. cross-object has no `contract.md`, so its laws state the contract implied by `getLabel: string | null` and by `presentRecord` answering "not found".
- **Proofs:** each candidate keeps the base `PROOF.bend` unchanged.
- **Per-law gating:** `perlaw.py` gates each law on its own, keeping only that law, the laws its proof uses, and the helpers they reach.
- **Refutation:** false laws are refuted by machine-checked counterexamples (`REFUTE.bend`). Each refutation fails against the control, so the method is not vacuous.
- **Shape models:** `shp check` passes all three (exit 0).

**root-cause-grouping**

| Law (contract source) | Base | Candidate | Truth for candidate | Candidate metrics + base normalizer |
|---|---|---|---|---|
| preserves_start (preserved) | PASS | PASS | holds | PASS |
| preserves_end (preserved) | PASS | FAIL | false, refuted at (0,1) | PASS |
| size_inclusive (inclusive) | – | FAIL | false, refuted at (0,1) | PASS |
| includes_start (inclusive) | – | FAIL | false, refuted at (1,0) | PASS |
| includes_end (inclusive) | – | FAIL | false, refuted at (0,1) | PASS |
| excludes_after_end (inclusive) | – | FAIL | holds; re-proved for the candidate | PASS |

- **Root cause:** reverting only `normalizeRange` turns all 6 laws green with the unchanged proof. That pins the single root cause the release config expects (`RangeNormalizer.normalizeRange`, `end - 1`).
- **Brittle proof:** one of the five failures (excludes_after_end) is a proof that broke while its law still holds.
- **U32 instead of Nat:**
  - Base has one U32 algebra lemma (`U32.add_comm`), so `{==}` cannot close `U32.sub(U32.add(s,k),s)+1 == k+1`.
  - The inclusive-size law is also false for a correct implementation at k = 2^32−1.
  - U32 laws would therefore need preconditions and a bit-vector lemma library.

**cross-object.** The base proves 3/3 laws (`label_unknown_is_null`, `present_unknown`, `present_known`). All 18 candidate encodings fail the gate (see A2).

**stale-model.** The authored relation says ReportLoader calls RemoteTemplate; the code returns "local".

| Law form | Candidate (no call) | No call, template returns "local" | Calls | Calls, discards result |
|---|---|---|---|---|
| Concrete: `loadReport() == template()` | FAIL | PASS | PASS | – |
| Parametric: `∀fetch. loadReport(fetch) == fetch()` (callee must be injected) | FAIL (refuted) | – | PASS | FAIL |

A law is an equality up to normalization, and Bend has no reflection over def bodies.
- The concrete law can pass on a coincidence of values.
- The parametric law states data flow, not calls. It rejects a function that does call the callee but ignores the result, and it applies only after the code is changed to take the callee as a parameter.

**Verdict: asserted.**

**Threats.**
- One author wrote both the laws and the ports.
- The Nat port removes overflow.
- The metric laws are one reading of "inclusive".

## A2. Totality vs the cross-object change (null to throw)

**Hypothesis.** Every Bend encoding of the change is rejected or named by the gate.

**Method.**
- **Encodings:** `A2/gen.py` generates 18 encodings plus 2 controls. Each keeps `LAWS.bend` and `PROOF.bend` byte-identical to the base.
- **Program:** each `main` prints `presentRecord("known")`, then `presentRecord("missing")`.
- **Recorded per encoding (`A2/run.sh`):**
  - the gate, plain and `--verdict`;
  - `main.bend --check-only`, plain and `--verdict`;
  - run mode (`bend main.bend`, 20 s cap);
  - the per-law gate.
- **Re-proof:** where the presenter keeps its type `String -> String`, a fresh proof of only the caller's laws was attempted (`A2/gen_reproof.py`, 600 s cap).

| id | Encoding | `main.bend` check | Run mode | Gate | Caller law / re-proof |
|---|---|---|---|---|---|
| E1 | `String`, default "missing record" | PASS | "missing record" | FAIL (law type) | false, refuted |
| E1b | `String`, default "not found" | PASS | "not found" | FAIL (law type) | holds; re-proof passes |
| E2 | unknown branch calls an `@unsafe` loop | FAIL, names 5 defs | hangs, no warning | FAIL | checker > 600 s |
| E3 | `def getLabel?` | FAIL, names 3 defs | hangs | FAIL | checker stack overflow |
| E4 | foreign JS throw, `IO(String)` | FAIL, names 5 (foreign) | `Error: missing record`, exit 1 | FAIL (law type) | n/a |
| E4b | foreign JS def typed `String` | FAIL ("foreign definition returning base IO") | refused | FAIL | – |
| E5 | `?TODO` | FAIL ("1 TODO") | refused | FAIL | – |
| E6 | precondition evidence, Empty branch, caller decides | PASS | "not found" | FAIL (law type) | holds; re-proof passes |
| E6b | E6, caller passes `?TODO` | FAIL (TODO) | refused | FAIL | – |
| E7 | `IO.die` | PASS | exit 1 | FAIL (law type) | n/a |
| E7b | `IO.die`, laws restated over IO | PASS | exit 1 | FAIL (`Halt{1,..}` vs `k("not found")`) | false |
| E8 | `Result`, failure propagated | PASS | `<thrown: ..>` | FAIL (law type) | n/a |
| E9 | `Empty.absurd(@unsafe bottom())` | FAIL, names 5 | hangs | FAIL | > 600 s |
| E10 | open law used as a function | FAIL ("unfilled law is a dead claim") | refused | FAIL | – |
| E11 | unknown case omitted | FAIL ("cases for False") | refused | FAIL | – |
| E12 | erased `Empty` spent live | FAIL (quantity) | refused | FAIL | – |
| E13 | `IO.exit(1)` | PASS | exit 1, silent | FAIL (law type) | n/a |
| E14 | base type kept; effect applied to a continuation in pure code | PASS | `runtime fail-stop`, exit 1 | FAIL (stuck term ≠ None) | unprovable |
| E0, E7c | controls | PASS | "not found" | PASS | holds |

**Verdict: asserted, with a qualification.**
- **Gate:** 0 of the 18 encodings pass.
- **Rejected by the code alone:** 10 of 18 are refused through a named hatch or a totality, coverage or quantity error.
- **Rejected only by the laws:** 8 of 18 (E1, E1b, E6, E7, E7b, E8, E13, E14) are total programs the kernel accepts; only the protected laws reject them.
- **Unnamed process exits:** 4 of those 8 (E7, E7b, E13, E14) end the process at run time and are never named. They would pass if no law covered the unknown path. E14 keeps the base type, and its `present_known` law passes on its own.
- **Run mode** never prints the verdict, so `@unsafe` code just hangs with no warning.
- **Checker limits:** a proof attempt that unfolds an `@unsafe` def ran past 600 s (E2, E9) or overflowed the checker's stack (E3).

**Threats.**
- The encoding list was chosen by one author.
- Which ports count as a faithful "throw" is a judgment.

## A3. Purity by construction

**Hypothesis.** At least 8 of 10 effect injections into a non-IO def are rejected; foreign imports are the gap.

**Method.** `A3/gen.py` generates 59 files around `def tag(x: String) -> String`.
- **Injections:** 47, covering 13 effects plus foreign JS and C, in three forms:
  - F1: use the effect directly (17);
  - F2: build the IO value and drop it (16);
  - F3: apply the IO value to a continuation, `E(Unit, v => Exit{0})`, and match the resulting `IO.OP` in pure code (14).
- **Other files:** 7 routes that hide or pass IO around (R3, a JS host callback, built by hand), plus 5 positive controls.
- **Observation:** `A3/run.py` runs check, run and `--verdict`, and watches stdout, marker files, a TCP listener and wall time.
- **Controls:** all 5 effects were detected (sleep took 1.8 s vs 0.4 s).

| Form | Cases | Rejected | Accepted | Effect seen |
|---|---|---|---|---|
| F1, the 10 listed classes | 10 | 10 | 0 | 0 |
| F1, all | 17 | 17 | 0 | 0 |
| F2 (including closure, list) | 16 | 1 (foreign, named) | 15 | 0 |
| F3 | 14 | 1 (foreign, named) | 13 (11 fail-stop; 2 return `Halt`/`Exit` as data) | 0 |

| Route | check / `--verdict` | Effect |
|---|---|---|
| R1: alias `Pure(A) = IO(A)` | PASS / PASS | yes |
| R2: structural IO (`-> IO.OP<R>`) | PASS / PASS | yes |
| R3: proven pure def called from JS (`.mjs`) with an effectful closure | PASS / PASS | yes (file written) |
| R4: returns `Unit -> IO` or `List<IO>` | PASS / PASS | yes, when an IO caller runs it |
| R5: polymorphic `A = IO(Unit)` | PASS / PASS | yes, by the caller |
| R6: `@unsafe` loop | FAIL, named | hangs |
| R7: `Array.fork` aliasing | FAIL, named | mutation visible (41 instead of 0) |

**Verdict: asserted on the criterion (10/10). The predicted gap is wrong.** A foreign def must return `IO(...)` directly, so foreign imports cannot enter non-IO code. No def whose type normalizes to non-IO performed an I/O effect inside Bend. The real gaps:
- IO-typed defs whose signature hides the IO (R1, R2).
- Host callbacks across `.mjs` (R3).
- IO values returned to an IO caller (R4, R5).
- F3: well-typed, kernel-accepted pure defs that crash the runtime. The checker treats the effect as a stuck term, but the JS runtime hands back an `IO.OP` value whose shape `match` does not cover.

**Threats.**
- Only the JS lane was run.
- Observation is limited to stdout, files, TCP and time.

## A4. Grants as affine capability tokens

**Hypothesis.** Affine tokens can encode Shape grants, but without private constructors a function can forge a token.

**Method.**
- **Tokens:** `A4/caps.bend` declares `ReadCap`, `AppendCap` and `DeleteCap` as `is Type`.
- **Operations:** `Log.read` and `Log.append` take a token and hand it back; `Log.hard_delete` consumes one.
- **Grant:** `main` gives the service only an `AppendCap`.
- **Cases:** `A4/gen.py` builds 20 mutants, a defence (D01) and a control. `A4/handle_token` tests a Base handle used as the token (D03).

| Outcome | Cases |
|---|---|
| Rejected (type or quantity) | M01 no token; M02 wrong token; M06 same-named type redeclared; M07 `+DeleteCap`; M08 used twice; M09 returned twice; M10 closure called twice; M11 Data box (kind error); M12 polymorphic dup; M13 `List.replicate`; M15 `?TODO`; M17 open law; M18 erased |
| Rejected, hatch named | M14 `Array.fork`; M16 `@unsafe` mint; M19 foreign mint |
| Accepted: forgery works (log purged, entries = 0) | M03 builds `C.DeleteCap{}`; M04 rebuilds it from the held `AppendCap`; M05 calls the root's mint |
| Accepted, harmless | M20 `Empty.absurd` (needs an `Empty`, so it cannot be called) |
| D01: opaque `law DeleteCap: Type` | "1 TODO found": only Base may leave a type law open (WONTFIX #825) |
| D03: Base `Listener` as token | pure forgery rejected 2/2; IO forgery via `TCP.listen` accepted, `--verdict` PASS, not named |

Bend has no constructor privacy. There is no visibility syntax, and any imported constructor can be used. Types are nominal per module (M06), and only Base handle laws are opaque.

**Verdict: asserted.**
- Capability-free calls (2/2) and copy or smuggle attempts (8/8) are rejected or named.
- 3 of 10 forgery attempts succeed.
- A deterministic source rule ("no `DeleteCap{` and no `root_caps` call outside the root") would catch M03–M05, but that rule lives outside Bend.

**Threats.** One resource and one author.

## A5. Law mutation score and proof brittleness on Bend's demos

**Hypothesis.** Laws kill at least 70% of non-equivalent mutants, and at least 20% of law-preserving edits break the proof.

**Method.**
- **Edits:** six demos with substantive laws. `A5/mutants.py` defines 60 mutants and 25 refactors, all edits to `main.bend` only. None touches proofs, laws, or the defs the laws are stated with.
- **Per edit (`A5/run.py`):**
  - run the unchanged gate, whole and per law, plus `--verdict` on survivors;
  - compile to `.mjs`;
  - call `A5/oracle.mjs`.
- **Oracle:** never consults proofs. It evaluates every law on enumerated inputs and compares behaviour with the original:
  - insertion_sort: lists over {0..3} up to length 5;
  - typed_eval: 14,832 expressions up to depth 2;
  - numerics: all triples in 0..7;
  - par_sum: d ≤ 5, i ≤ 6;
  - par_sort: all trees up to depth 3;
  - win_is_bug: exact BFS reachability over `step`, plus a check that `replay` equals folding `step` over every move list up to length 6.
- **Oracle sanity:** every original satisfies its laws, and all 25 refactors are behaviour-equivalent.

| Demo | Mutants | Rejected by `main.bend` check | Non-equiv (killed) | Law false (killed) | Changed, law holds (killed) | Equivalent (proof broke) | Refactors (proof broke) |
|---|---|---|---|---|---|---|---|
| insertion_sort | 11 | 3 | 8 (8) | 8 (8) | 0 | 0 | 5 (1) |
| typed_eval | 10 | 0 | 8 (8) | 8 (8) | 0 | 2 (0) | 4 (1) |
| numerics | 11 | 1 | 10 (9) | 9 (9) | 1 (0) | 0 | 5 (2) |
| par_sum | 6 | 0 | 6 (6) | 6 (6) | 0 | 0 | 3 (2) |
| par_sort | 9 | 0 | 7 (6) | 3 (3) | 4 (3) | 2 (2) | 3 (1) |
| win_is_bug | 13 | 1 | 11 (9) | 5 (5) | 6 (4) | 1 (0) | 5 (0) |
| **Total** | **60** | **5** | **50 (46)** | **39 (39)** | **11 (7)** | **5 (2)** | **25 (7)** |

Of the 5 mutants rejected by the `main.bend` check, 3 are semantic: two fail on the types of the comparison evidence, one on termination. The other 2 were artifacts of the edits (an affinity error and an inference error); well-formed replacements were added (NU-m03b, WB-m12b).

| Measure | Value |
|---|---|
| Mutation score (killed / non-equivalent) | 46/50 = 92% |
| Killed / mutants with a false law | 39/39 = 100% |
| Unsound (gate PASS, law false) | 0 mutants; 0 of 56 (mutant, law) pairs |
| Brittleness, refactors | 7/25 = 28% |
| Brittleness, all behaviour-preserving edits | 9/30 = 30% |
| Kills where the law still holds | 7/46 |

**Survivors** (all pass `--verdict`):
- NU-m09: division by zero, outside what the law covers.
- PO-m09: changes `gen`, which no law covers.
- WB-m01 and WB-m04: the geometry changed but the flag is still unreachable; the computed certificates adapt.

**Brittleness explained.**
- **Broken refactors:** all 7 change the definitional normal form: commuting an addition (4), commuting a xor, a tail-recursive `add`, reordering a helper's parameters.
- **Surviving refactors:** all 18 keep the normal form: renames, case reorders, helper extraction or inlining, operator sugar, closed-constant rewrites.

**Lucky kills.** PO-m03, PO-m05 and PO-m06 are real sort bugs that the sum-only laws don't express. The gate caught them only because the proof broke; a re-proof would ship them.

| Demo | Code LOC (defs) | Laws | Law LOC | Proof LOC (defs) | Proof/code |
|---|---|---|---|---|---|
| insertion_sort | 57 (10) | 2 | 9 | 56 (7) | 0.98 |
| typed_eval | 88 (11) | 2 | 10 | 40 (4) | 0.45 |
| numerics | 37 (7) | 5 | 26 | 119 (16) | 3.22 |
| par_sum | 23 (4) | 1 | 6 | 35 (4) | 1.52 |
| par_sort | 61 (9) | 2 | 13 | 91 (9) | 1.49 |
| win_is_bug | 166 (34) | 2 | 10 | 391 (38) | 2.36 |

LOC counts non-blank, non-comment lines. The gate takes 0.2–1 s per run.

**Verdict: asserted** (92% ≥ 70%, 28% ≥ 20%, no unsound survivor).

**Threats.**
- The mutants were written by the experimenter and may lean toward the operators the plan names.
- The oracle's search is bounded for 5 of the 6 demos (exact only for win_is_bug), so "law holds" is evidence, not proof.
- Behaviour is compared at the exported API, on the same bounded inputs.
- Bend's authors wrote the demos with their proofs in mind.

## Reproduce

```sh
X=$S/bendexp; export BEND_NO_TELEMETRY=1 PATH=$LEAN_BIN:$PATH
bend A1/root-cause-grouping/{base,candidate,candidate-fixed}/PROOF.bend [--verdict]
python3 -I perlaw.py A1/root-cause-grouping/candidate $X/work/A/perlaw/rcg; sh A1/stale-model/gen.sh
python3 -I A2/gen.py $X/work/A/A2enc && sh A2/run.sh $X/work/A/A2enc $X/work/A/A2out && sh A2/summarize.sh $X/work/A/A2out
python3 -I A2/gen_reproof.py $X/work/A/A2enc $X/work/A/A2reproof
python3 -I A3/gen.py $X/work/A/A3inj $X/work/A/A3obs 47011 && python3 -I A3/run.py $X/work/A/A3inj $X/work/A/A3obs 47011 out.tsv
python3 -I A4/gen.py $X/work/A/A4mut && sh A4/run.sh $X/work/A/A4mut out.tsv
LEAN_PATH_PREFIX=$LEAN_BIN: python3 -I -B A5/run.py $X/work/A/demos $X/work/A/A5 out.jsonl && python3 -I -B A5/analyze.py out.jsonl
```
