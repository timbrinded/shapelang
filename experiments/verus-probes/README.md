# Verus probes

An isolated research harness asking what Shape could add to Verus-verified Rust,
measured against real projects rather than argued. Nothing in the checker, CLI,
docs, or release archives depends on this directory.

Each probe states a hypothesis, the measurement, and what would falsify it.
Results below are from 2026-10-23. Numbers are reproducible with the scripts and
pinned inputs listed under [Reproduce](#reproduce).

## Corpus and instrument

- **Corpus.** The eight open-source systems behind VeruSAGE-Bench (Anvil, Atmosphere,
  IronKV, memory allocator, node replication, NRKernel, verified-storage, Vest):
  4,565 first-parent commits, 2022 to 2026. Commit IDs are pinned in `setup.sh`.
- **Instrument.** `vprobe/` parses every function inside `verus!` with `verus_syn`
  (Verus's own parser) and fingerprints, ignoring formatting and commas: the
  contract (signature plus `requires`/`ensures`), the body, and the body with ghost
  code removed. It counts trust markers (`external_body`, `external`, `assume`,
  `admit`, `uninterp`, `assume_specification`, axioms) from the token stream, so
  comments never count. 99.9% of Verus files parse at HEAD; cumulative trust counts
  reconcile exactly with the HEAD inventory in all eight repositories.
- **Exclusions.** Bulk imports (10 or more files added), 176 commits that do not
  parse (mostly NRKernel's 2022 syntax), and, where stated, mechanical commits
  (Verus migrations and formatting, found by subject and toolchain-file changes).
- **Verus runs.** Verus `dccae1d` built from source with Z3 4.16.0, run in Docker
  containers with no network, host toolchains mounted read-only (`bin/sbx`).

## Results

### History probes (`scripts/walk.py`, `analyse.py`, `extra_analyses.py`)

| ID | Hypothesis | Result |
|---|---|---|
| R1 | Verified functions keep stable contracts while bodies change | Falsified here. 53% of edits to verified exec functions change the contract (non-mechanical commits). Contract-plus-trust pins would let 23-24% of commits skip review, against 89% for whole-function pins. |
| R1b | Contract churn falls as a project matures | No. Pooled, excluding Vest: 55%, 50%, 59%, 51% by life quartile. |
| R2 | Contract fingerprints survive Verus upgrades | Falsified at the surface. In three repositories, 45-100% of contract changes come from Verus migration commits. |
| R3 | The trust base changes rarely and visibly | Falsified. 3-32% of commits grow it on net; their messages name it 0-15% of the time. About half of commits touch a trust marker or a trusted function's body. |
| R4 | A passing verification means no unproven assumptions | Falsified. In 5 of 8 repositories, 83-98% of commits carried an outstanding `assume`/`admit`; the longest stretches run 171-1,017 commits; Atmosphere has 49 at HEAD. |
| R5 | `_t.rs` path conventions capture the trust base | Only with discipline: 89-96% of markers in IronKV and verified-storage, 42% in Atmosphere, 0% elsewhere. |
| R6 | Reviewing the spec costs much less than reviewing the code | Partly. With an explicit trusted boundary, the trusted spec is 0.87-1.17x the verified executable code; the saving is the proof and ghost text (2.45-3.84x). |

### Experiments

| ID | Hypothesis | Method | Result |
|---|---|---|---|
| E1 | Fingerprints of Verus's elaborated form (VIR) survive syntax migrations | IronKV HEAD vs HEAD with the mutable-reference migration reversed; then a held-out migration (`is_Some()` to `is Some`); sensitivity: 15 seeded contract mutations | Surface: 44/44 migrated functions change. Raw VIR: 44/44. Three normalisation rules (preliminary read kinds, rustc IDs, literal `true` clauses): 0/44. Held out, the same rules absorb 0/5. Sensitivity: 15/15 mutations detected. VIR fingerprints absorb syntax migrations but not API migrations; those need E3. |
| E2 | Name-based spec closures approximate the real ones | Exact closures from VIR call targets vs the name-based bracket | IronKV (175 functions): exact median 1 spec fn, 20 tokens; within the bracket for 155/175. NRKernel (54 matched): exact median 172 spec fns, 11.5k tokens, 64x the function's code; the lower bound underestimates about 20x. |
| E3 | A solver can decide whether an edited contract is looser | For contract X edited to Y: an `external_body` stub with Y, and a wrapper with X that calls it. The wrapper verifies iff Y is not looser than X. | Mutable-reference migration: 42/44 proved equivalent both ways, 0 false alarms (1 trait method skipped, 1 not generated). Held-out `is_Some` migration: 5/5 equivalent. Dropped-clause mutants: 11/14 flagged looser; the other 3 dropped clauses are implied by the rest. Sanity direction: 14/14 pass. |
| E4 | A routing claim catches bypasses Verus cannot | Five seeded bypasses of IronKV's network path; detectors: Verus, trust-marker diff, Verus call graph with an allow-list, whole-crate syntactic call scan with the same allow-list, Rust privacy, `shp ast` | Verus rejects 2/5 (calls an `external` fn; breaks a postcondition). The syntactic scan flags 5/5. The Verus call graph flags 2/4 that produced one. The trust-marker diff flags 1/5. Rust privacy: 0/5 (the trusted `send_internal_wrapper` is `pub` and its contract says the client is unchanged). `shp ast` sees no functions inside `verus!` and fails on 11/34 IronKV files. |
| E7 | Rust signatures alone bound most effects | Classify verified exec functions at HEAD by what their signature permits | Read-only by signature: 39-69% in systems code (98.5% Anvil, 80% Vest). Tracked ghost permissions: 41-55% in the allocator, node replication, NRKernel. "Read-only" means arguments are not mutated, not "no effect": functional cores return effects as data. |
| E8 | Proof receipts are reproducible | IronKV, unchanged source, 25 SMT seeds, 1/2/4 threads | Deterministic for a fixed toolchain and seed. One function fails on seeds 0 (the default) and 18; the other 312 never flip. IronKV's own CI passed on its September toolchain. NRKernel: see `results/` when its run completes. |
| E9 | Cheap gates catch the trust-base events | Ground truth from the function-level instrument | 49% of commits have a trust event. CODEOWNERS on `_t.rs`: 16.7% recall (repositories that use it). Net-count gate: 46%. Per-file count diff: 85%. The 15% missed are edits to trusted bodies or contracts with unchanged counts. |
| E10 | Some claims in Shape's own model catch no mutation | Model mutation testing of `shape/` | Pending in this run; see `results/e10/` if present. |

### Not run: E5 and E6

E5 (agent trap tasks under five gate conditions) and E6 (agent-written specs checked
against Shape-derived obligations) need Claude API credentials, which the session
that produced these results did not have. `harness/` is complete and self-tested
without the model:

```text
python3 harness/harness.py selftest
```

The self-test replays scripted edits through the sandbox and every grader. It shows
the mechanism, not a rate: a hard-deleting `purge` passes Verus; a Shape model
that declares it honestly fails with `forbidden effect`; one that drops `AppendOnly`
fails with `rule loosening`; one that declares a harmless effect passes Shape, and
only the `AppendOnly` obligation compiled into Verus (`vprobe obligations`) rejects
it. An `external_body` purge with a false contract passes Verus and the obligation,
and only the trust-base declaration check (`vprobe tcb-check`) rejects it.

To run them, set `ANTHROPIC_API_KEY` and:

```text
python3 harness/harness.py e5 --seeds 3 --parallel 3 --budget-usd 150
python3 harness/harness.py e6 --seeds 3 --parallel 3 --budget-usd 50
```

Trials stop being scheduled once the budget is spent. Every tool call an agent makes
runs in a fresh, network-less container over its own copy of the fixture.

## Threats to validity

- The corpus is academic verification work, where spec and proof grow together.
  PDD Kit's setting (approve a spec, then generate code) may churn specs less.
- First-parent granularity mixes merged pull requests and direct commits.
- Mechanical commits are classified by a subject regex plus toolchain-file changes.
- The E1 normalisation rules were fitted on the migration they were tested on; the
  held-out migration is the honest measure.
- E3 cannot separate "looser" from "the solver gave up"; it is sound, not complete.
- E4 uses five bypasses written by the experimenter, not an adversary; the syntactic
  scan can be evaded through function pointers, trait objects, or macros.
- Commit messages are a weak proxy for whether reviewers noticed a trust change.

## Reproduce

```text
VP_WORK=/tmp/verus-probes ./setup.sh   # corpus at pinned commits, Verus dccae1d, vprobe, sandbox image
VP_WORK=/tmp/verus-probes ./run_probes.sh
```

The Verus experiments are driven by `scripts/e1_vir_fp.py`, `e2_closure.py`,
`e3_refine.py` and `e4_seed.py`; `results/` holds their outputs and the per-commit
data (`results/per-commit/*.json.gz`).
