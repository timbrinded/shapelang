# H4: loosening decider (Shape 1.0 prototype and Lean kernel)

## Hypothesis and falsification criterion (SEED.md)
**H4:** loosening becomes a decision, with a counterexample.

**Falsified if:** the decider classifies fewer rule changes in `fixtures/loosening` than a syntactic diff, or classifies any wrongly.

I read "classifies" as "gives a correct definite answer" (looser, tighter, equivalent or incomparable), and count `undecided` as an abstention. Read literally as "gives any answer", the diff classifies more cases (23 against 21), but only because it answers both renames, and both of those answers are wrong.

## Verdict: disproved, narrowly
The prototype gets **1 of 23 fixtures wrong**: read_only_function_added. It reports a latent L1 loosening, and DefaultPolicy blocks the change at tier normal. The case only adds a unit whose own complete summary allows nothing but `Read`.

The cause is a single rule in the spec, not the implementation: L1 builds Perm and Lvl from grants and forbids only, and ignores the head's effect summaries. Under the literal v6 text, the prototype is 21 correct, 0 wrong, 2 undecided.

The kernel gets 3 fixtures wrong: the same one, plus two renames, because it has no ρ.

On correct definite answers the decider beats both baselines: 20 against 19 (syntactic diff) and 18 (0.x).

The counterexample half is weaker than claimed. 8 of the 31 counterexamples printed are worlds that the head itself rejects.

## Setup
**Cases (33).**
- The 23 `fixtures/loosening` base/head pairs.
- `fixtures/skills/guard`: policy-removal and equivalent-relocation.
- The 8 calibration cases from `experiments/bend-probes/E/e2-calibration.ts`, frozen in `trials/H4/cases/`.

**Code worlds** (`build.ts`). Code is synthesised exactly as `shape1 check --synthesize` writes it. "Completion" adds only code the case implies:
- `changed-files.txt` and `repository.txt`;
- one identity for each `fn` without a `source`;
- an edited body for guarded_fn_edited_in_place.

Completion changed no forward class compared with plain `--synthesize` on the untouched fixture directories. It removed 5 E-unbound errors.

Three directory pairs per case:
- **fwd**: base code against head code.
- **fwdu**: base and head over the union of their code.
- **rev**: head shape as base and base shape as head, over the union code. This answers "tightens iff not S_b ⊑ S_h".

fwd and fwdu gave the same class in all 33 cases.

**Class rule.**
- Forward loosened, reverse loosened: incomparable.
- Forward loosened only: looser.
- Forward undecided only: undecided.
- Reverse loosened only: tighter.
- Neither direction loosened: equivalent.

**Tools.**
- Prototype: `shape1 check` (fwd, fwdu, rev, plus the original fixture directories).
- Lean kernel: `shapek` on the same inputs, converted as `kernel/test/bridge.ts` does. One change: the cells always include (ungoverned, ungoverned), as the prototype's own cells do.
- `KDump.lean` (new, in the trial dir): prints the kernel's parts, realisable (identity, atom) pairs and `l3Decide` verdicts with completing sets.
- A kernel "binding workaround" run that pre-binds the units of path-less components (see the kernel section below).
- 0.x: `shp check --base-model B --check-loosening [--changed-files]`, in my form and in the repository's parity-test form. Both gave the same results.
- Syntactic diff: `e2-semantic-diff.ts` `classify`. Any signal other than `false-completeness` counts as loosening; with no signal and no raw changes the class is equivalent.

**Reference.** `manual.json`, my reading of v6 applied to migrate(base) and migrate(head): worlds (A.4.4.3) plus governance. It counts a unit's own complete summary as protection. Where the literal v6 text differs, it records that as `specLiteral`. I wrote it after seeing only grant_added's output and before the full runs.

## Headline results
Each cell gives the number of cases, then correct / wrong / undecided.

| Tool | fixtures/loosening (23) | guard + calibration (10) | all (33) |
|---|---|---|---|
| Prototype (fwd + rev) | 20 / 1 / 2 | 10 / 0 / 0 | 30 / 1 / 2 |
| Lean kernel, as built | 20 / 3 / 0 | 10 / 0 / 0 | 30 / 3 / 0 |
| Lean kernel, binding workaround | 20 / 3 / 0 | 10 / 0 / 0 | 30 / 3 / 0 |
| 0.x `--check-loosening` | 18 / 5 / 0 | 7 / 3 / 0 | 25 / 8 / 0 |
| Syntactic inspect diff | 19 / 4 / 0 | 8 / 2 / 0 | 27 / 6 / 0 |

Against the literal v6 text, where read_only_function_added counts as loosening:

| Tool | fixtures/loosening (23) | all (33) |
|---|---|---|
| Prototype | 21 / 0 / 2 | 31 / 0 / 2 |
| Kernel | 21 / 2 / 0 | 31 / 2 / 0 |
| Syntactic diff | 18 / 5 / 0 | 26 / 7 / 0 |
| 0.x | 17 / 6 / 0 | 24 / 9 / 0 |

Five-way class, as exact / acceptable abstention / wrong:

| Tool | fixtures/loosening (23) | all (33) |
|---|---|---|
| Prototype | 20 / 2 / 1 | 30 / 2 / 1 |
| Kernel, as built | 20 / 0 / 3 | 28 / 0 / 5 |
| Kernel, binding workaround | 20 / 0 / 3 | 30 / 0 / 3 |
| Syntactic diff (binary tool) | 8 exact | 14 exact |
| 0.x (binary tool) | 4 exact | 5 exact |

Under E2's finding/no-finding lens on the 8 calibration cases, the prototype matches 6/8, against 0.x 4/8 and the diff 5/8. Its two misses are cases 7 (generic attestation) and 8 (false completeness), which are not loosenings: it classifies them equivalent and tighter, which I judge correct. On the guard fixtures the prototype gets 2/2, 0.x 1/2 and the diff 2/2. Rerunning E2's scripts reproduced E2's numbers exactly.

## Per case: decision, counterexample and correctness
Prototype decisions come from the forward and reverse runs. Abbreviations:
- **expl**: exploited.
- **cx**: counterexample.
- **decl(u, a)**: the declared fact that the head's summary of unit u gives for atom a.

| Case | Manual | Prototype decision and counterexample | OK | Kernel | 0.x | Diff |
|---|---|---|---|---|---|---|
| claim_misdescribes_code | tighter | tighter (reverse: L2 removed for shareDraft's new summary) | ✓ | ✓ | ✓ | ✓ |
| draft_trait_removed | incomparable | L1 final forbid + L1 Sharing authority+, cx decl(shareDraft, Export<PrivateDraft>), expl; L7 PrivateDraft tier final>normal; reverse: L2 | ✓ | ✓ | ✓ | ✓ |
| effects_unknown | incomparable | L1 Owns level, cx {purge.ts#purgeOldRevisions, Append<Revision>}, latent | ✓ | ✓ | ✗ | ✗ |
| governed_directory_moved | incomparable | L1 Sharing, cx cell (Sharing.*, ungoverned) `src/share/.ts` Append<PrivateDraft>, latent | ✓ | ✓ | ✓ | ✓ |
| governed_paths_narrowed | looser | L1 Sharing, cx {src/share/button.ts, Append<PrivateDraft>}, latent | ✓ | ✓ | ✓ | ✓ |
| grant_added | incomparable | E-conduct; L1 RevisionLog authority+, cx {appendRevision, Update<Revision>}: rejected by the head's own summary, spurious; L1 Owns, cx decl(purge, HardDelete), which the head's final AppendOnly rejects | ✓ class, cx ✗ | ✓ | ✗ | ✓ |
| guarded_fn_edited_in_place | equivalent | none; the law is unestablished (missing) | ✓ | ✓ | ✓ | ✓ |
| memory_and_trait_removed | looser | L4 removed (no cx by design), latent, blocks | ✓ | ✓ | ✓ | ✓ |
| memory_guard_removed | equivalent | none: both migrated shapes carry the same RefactorSensitive law | ✓ | ✓ | ✗ | ✗ |
| path_rule_narrowed | looser | L3, cx Feed -calls-> Recommender -provides-> PrivateDraft, expl | ✓ | ✓ (completing set []) | ✓ | ✓ |
| path_rule_removed | looser | L3, same cx, expl | ✓ | ✓ | ✓ | ✓ |
| read_only_function_added | tighter (literal: incomparable) | **L1 Owns level, cx {log.ts#listRevisions, Append<Revision>}, which the head's `effects complete {Read}` rejects; blocks (rule 9)** | **✗** | ✗ | ✓ | ✓ |
| relation_left_out | equivalent | none (identical shapes) | ✓ | ✓ | ✓ | ✓ |
| renamed_component | equivalent (rename) | undecided (L3 Feed unmapped) | abstain | ✓, but by vacuity | ✓ | ✗ |
| renamed_component_and_narrowed_rule | looser | L3 under the rule-3 hint, cx PublicFeed -calls-> Recommender -provides-> PrivateDraft, expl | ✓ | **✗ ('ga': implied vacuously)** | ✗ | ✓ |
| resource_renamed_trait_dropped | incomparable | L1 final, cx decl(purge, HardDelete<Ledger>), expl; L1 Owns; L1 RevisionLog (spurious); L2/L3 undecided parts | ✓ | ✓ (exploited flags differ) | ✓ | ✓ |
| resource_renamed_trait_kept | equivalent (rename) | undecided (5 undecided parts) | abstain | **✗ (final L1)** | ✓ | ✗ |
| rule_added | tighter | tighter (reverse: L3, cx Recommender -calls-> Feed) | ✓ | ✓ | ✓ | ✓ |
| rule_and_trait_removed_together | incomparable | L1 final + Owns, cx decl(purge, HardDelete), expl, one group; L1 RevisionLog authority+ {listRevisions, HardDelete} (spurious) in a second group | ✓ | ✓ | ✓ | ✓ |
| rule_moved_between_files | equivalent | none | ✓ | ✓ | ✓ | ✓ |
| rule_removed | incomparable | as rule_and_trait_removed_together | ✓ | ✓ | ✓ | ✓ |
| trait_removed_from_resource | incomparable | L1 final, cx decl(purge, HardDelete), expl; L7 Revision tier; L1 RevisionLog (spurious) | ✓ | ✓ | ✓ | ✓ |
| unused_rule_removed | looser | L3, cx Feed -calls-> Recommender (new) + declared provides, latent | ✓ | ✓ (completing set [Feed calls Recommender]) | ✗ | ✓ |
| guard-policy-removal | looser | L1 final, cx cell (ungoverned, ungoverned) `a` DropStorage<AuditEvent>; L7; blocks (rule 4) | ✓ | ✓ | ✗ | ✓ |
| guard-equivalent-relocation | equivalent | none | ✓ | ✓ | ✓ | ✓ |
| cal1 removal + destructive effect | incomparable | L1 final, cx decl(deleteEvent, HardDelete), expl; L7; AuditStore authority+ (spurious) | ✓ | as built: looser; with the workaround ✓ | ✓ | ✓ |
| cal2 supported loosening | looser | L1 final cell + L7; the rationale note decides nothing | ✓ | ✓ | ✗ | ✓ |
| cal3 relocated rule | equivalent | none (E-shadow on both sides, unrelated) | ✓ | ✓ | ✓ | ✓ |
| cal4 Protected → AppendOnly | equivalent | none (identical NF) | ✓ | ✓ | ✓ | ✗ |
| cal5 path forbid weakened | looser | L3, cx BuildOrchestrator -provides-> ProductionStore, expl | ✓ | ✓ | ✓ | ✓ |
| cal6 vendored final forbid removed | looser | L1 final, cx {store.ts#appendEvent, DropStorage} (a level drop only); L7 | ✓ | ✓ | ✗ | ✗ |
| cal7 generic attestation | equivalent | none (`attest` migrates to nothing) | ✓ | ✓ | ✓ | ✓ |
| cal8 false completeness | tighter | tighter (reverse: L2 unknown) | ✓ | as built: equivalent; with the workaround ✓ | ✓ | ✓ |

Notes on the table:
- In the 0.x and Diff columns, ✓ and ✗ score only whether the tool's loosening / no-loosening answer is right. Neither tool can tell tighter, equivalent and incomparable apart.
- 0.x misses grant_added because it reports `forbidden effect`, not a loosening.
- 0.x flags memory_guard_removed by its 0.x meaning; the case is equivalent after migration.

## Counterexamples
Across the forward obligations, the prototype prints 31 counterexamples:
- **22** are worlds the head admits and the base rejects.
- **1** shows only a protection-level drop (cal6: final > none at a position where authority still excludes the atom).
- **8** are worlds the head itself rejects:
  - 7 sit at units whose own complete summary excludes the atom: read_only_function_added, plus the component authority+ parts in grant_added, trait_removed_from_resource, rule_removed, rule_and_trait_removed_together, resource_renamed_trait_dropped and cal1;
  - 1 is grant_added's Owns part, whose "least realising fact" is a HardDelete that the head's final forbid excludes. The real gain there is Update and Write at purge.

`summary_bound.py` measures the same thing on the kernel's parts. Of 29 forward L1 obligations, 6 have every (position, atom) pair excluded by the head's own summary. Only in read_only_function_added is such an obligation the case's only loosening.

Fact-id counterexamples are opaque in the output. All four I checked were declared facts from the head's own `effects.lower`, and resolving them needed recomputing `H({type: declared, claim, atom})`.

The two tools report L3 counterexamples differently:
- **Kernel:** a completing set: `[]` when the declared edges already violate the claim, and `[Feed calls Recommender]` for unused_rule_removed.
- **Prototype:** the full path.

0.x quotes the silenced error only when it is realised. The syntactic diff gives no counterexample.

## Renames
Without `was`, 2 of the 23 fixtures are undecided, as A.8.1.6 intends. With one `was` sidecar line, all 4 rename fixtures are decided correctly, and in both directions:

| Case | Decision with `was` |
|---|---|
| renamed_component | equivalent |
| renamed_component_and_narrowed_rule | looser (L3, exploited) |
| resource_renamed_trait_kept | equivalent |
| resource_renamed_trait_dropped | incomparable (L1 final + L7, no undecided parts) |

## Kernel
- **Binding defect.** `unitBind` searches only the component's globs, so units of path-less components never bind. A.3.3.2 says ids(M_h) is searched when the component has no paths. This affects 10 of 33 cases, and changes cal1 (incomparable read as looser) and cal8 (tighter read as equivalent). With the binding workaround, 29 of 33 forward runs have identical loosening obligations (keys, bindings, exploited flags, tier, severity); as built, 24 of 33.
- **No ρ.**
  - renamed_component_and_narrowed_rule is missed: `l3Decide` returns `ga` because the base claim names a node the head lacks. That is an unsound "implied".
  - resource_renamed_trait_kept reads as a final L1 loosening.
  - renamed_component comes out equivalent only by the same vacuity.
- **No L6.** Every reverse L2 binding differs because the prototype merges L6 into the same subject. No class changes.
- **L3.** Verdicts were heir (36), ga (8) and searchCex (5). There were no `budget` or `exhausted` verdicts.

## Compared with A.8.6's predictions (fixtures)
18 match, 2 match partly and 3 differ.

Partial matches:
- memory_and_trait_removed: L4 only; A.8.6 predicts L4 and L1.
- rule_and_trait_removed_together: the grant part lands in a second group.

Differences:
- effects_unknown: incomparable under std Owns. A.8.6 says tightening; I judge the decider right.
- memory_guard_removed: equivalent after migration. A.8.6 says L4 latent; I judge the decider right.
- read_only_function_added: the decider is wrong; A.8.6's "tightening" is right.

Measured counts: 15 loosened, 2 undecided and 6 not loosened, against A.8.6's predicted 14, 2 and 7.

## Determinism and cost
- Three cases rerun from the CLI and from `--input` gave byte-identical core output and bindings.
- Prototype CLI per run: median 728 ms, maximum 1,096 ms. shapek: median 27 ms, maximum 197 ms.
- Repo `bun run lint` and `bun run typecheck`: clean.

## Threats
- The manual reading is mine, and it counts summaries as protection. That choice alone decides the one wrong call, so the literal-v6 scores are given too.
- The reverse direction runs over union code; fwd and fwdu agreed on all 33 cases.
- The kernel runs behind the prototype's pre-pass (elaboration and cells).
- The fixtures are small and synthetic, and the L3 search budget was never stressed.
- Calibration cases 7 and 8 expect guard findings that are not loosenings.

## Commands
`bash experiments/shape-1/trials/H4/runall.sh`. It runs: E2 baselines; `build.ts` (cases); `run.ts` (prototype, shapek, 0.x and the diff, about 150 s); `run-kernel.ts` (KDump and the binding workaround, about 100 s); then `analyze.py`, `compare_kernel.py`, `summary_bound.py` and the `was/` probe.

Outputs are in `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H4/`.
