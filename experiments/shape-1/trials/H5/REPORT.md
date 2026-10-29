# H5: escape hatches cannot grow silently (Verus corpus replay)

## Hypothesis and falsification criterion (SEED.md)

**H5. Escape hatches cannot grow silently.**

It is falsified if hatch growth in the Verus corpus replay is missed at a higher rate than the 15% a per-file count diff missed (E9: 85% recall).

Operational definitions:

| Term | Meaning |
|---|---|
| Trust event | E9's function-level ground truth from `experiments/verus-probes/results/per-commit/*.json.gz`: per file, a change in some marker kind's count (add or remove), or an edit to the body or contract of a trusted function (`external_body`, `external`, `external_fn_specification`, `uninterp`, or `axiom` mode). |
| Hatch growth | A commit where some file's count of some marker kind rises (E9 `add`). |
| Net growth | The commit's total marker count rises (E9's B2 gate). |
| Surfaced | `derive` raised at least one obligation caused by the commit: it is either introduced (model §7.3), or not introduced but absent from `derive(base→base)`. The second case is a surface judgment staled by a marker removal. Preexisting obligations do not count. |
| Missed | Not surfaced. |

The commit set is E9's filter: the commit touches Verus files, adds fewer than 10 files, and every file parses. That gives 2,202 commits; 2,201 remain after the adoption commit, which is excluded because the shape is declared at its post-state.

## Method

### Step 1: function-level walk, validated against E9

`walk_fn.py` re-walks every repository's first-parent history.
- It uses E9's vprobe binary (scratch `vprobe/target/release/vprobe`, same source as `experiments/verus-probes/vprobe`), the same `git diff -M` pairs and the same rules as `scripts/walk.py`.
- It keeps, per blob, every function's key, flags, assume and admit counts, and contract and body hashes, plus file-level marker counts.

`check_walk.py` compares the recomputed per-commit rows (`added_files`, `verus_files`, `parse_fail` and every trust event) with the recorded per-commit data. Result: 2,858/2,858 rows identical across all 8 repositories, from 16,612 distinct `.rs` blobs.

### Step 2: the shape a model author writes at the first commit

The first commit holding a marker is c0. There, each repository gets:

```shape
shape Repo { owner Maintainers }
actor Maintainers { kind team member reviewer }
actor reviewer { kind person identity github("reviewer") identity ed25519("…") }
actor dev { kind person identity github("dev") }          // the author of every replayed commit
boundary TrustedSurface : ReviewedSurface { owner Maintainers tier critical bind paths { … } allows hatch <std kinds present inside at c0> }
rule NoHatches { forbid hatch admit, assume, assume_specification, axiom, external, external_body, ts_ignore, uninterp, unsafe outside boundaries }   // tier critical
```

The policy is std DefaultPolicy, in which critical blocks unestablished. The rule lists the nine std kinds instead of `*`, because `*` is defective (see "Side finding"). The literal template is run as variant F-conv.A.star.

Boundary variants:

| Variant | Boundary paths |
|---|---|
| **F-conv** (primary) | The files marked at c0, plus `**/*_t.rs` if c0's tree has any `_t.rs` file. Frozen. |
| **F-dir** | `<dir>/**/*.rs` for each directory holding a marked file at c0 (plus `**/*_t.rs`). Frozen. |
| **M** | F-conv plus every file marked at the commit's base (the surface kept current). `allows` adds the kinds present at the base. |

c0 is the root, or the first or third step, depending on the repository. At c0 the inventories are small: Anvil 3 files with 15 markers, NRKernel 1 file with 2 markers.

### Step 3: manifests

The trust provider is exercised through the manifest, which is the only source of hatch facts (RJ14).

**Pipeline A (vprobe semantics).**
- One identity per vprobe function, `verus:<path>#<key>`. Unit and own digests are a hash of the contract hash, body hash, flags, marker counts and mode; the contract digest is the contract hash.
- One file identity per file. Its own digest covers the function keys and the markers outside functions.
- vprobe marker kinds map to std kinds: `external_fn_specification` → `assume_specification`, `external_type_specification` → `external`, `axiom_fn` → `axiom`.
- A file is hatch-complete iff vprobe parsed it with no macro errors.
- These are the semantics the trust provider audits. Its TypeScript port `vprobeTcb` (providers/trust/rust.ts) equals vprobe on 16,611 of 16,612 blobs.

**Pipeline B (the core manifest's scanner).** `fingerprintRust` (proto/src/fingerprint/rust.ts) runs on the real blob text.

**Which files are listed.** Only files that changed in the commit, or hold a marker at base or head. Every other file is unchanged, unmarked and constrained by nothing that can fire. Rerunning F-conv/A with every `.rs` file listed (`--full`) gives identical verdict and obligations (key, kind, introduced, severity, reason, group) on 2,201/2,201 commits.

### Step 4: records and derive

- One signed claim judgment of `TrustedSurface/ReviewedSurface/law` by `reviewer`, citing Req (the marked identities in the boundary: functions at `unit`, files at `own`) at the base digests.
- This judgment goes into both `records` and `baseRecords`.
- The author is `github("dev")`.
- `derive` runs per commit with head = commit and base = first parent.
- For commits with a non-introduced, non-contradiction obligation, `derive(base→base)` also runs.

### Exact commands

The commands use these paths:
- W = `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H5`
- S = `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad`

Run them from `/home/user/shapelang`.

```
python3 -I experiments/shape-1/trials/H5/walk_fn.py $S/repos/<repo> $S/vprobe/target/release/vprobe $W/walk     # 8 repos, ~2 min total
python3 -I experiments/shape-1/trials/H5/check_walk.py experiments/verus-probes/results/per-commit $W/walk        # 2,858/2,858 rows agree
sh experiments/shape-1/trials/H5/runall.sh F-conv A kinds        # also: F-dir A kinds | M A kinds | F-conv A star | F-conv B kinds | M B kinds | F-conv A kinds --full
python3 -I experiments/shape-1/trials/H5/analyze.py $W/runs $W/walk F-conv.A.kinds F-dir.A.kinds M.A.kinds F-conv.A.star F-conv.B.kinds M.B.kinds --json $W/analysis.json
python3 -I experiments/shape-1/trials/H5/surface_drift.py $W/runs $W/walk F-conv.A.kinds
bun experiments/shape-1/trials/H5/audit_markers.ts > $W/audit_markers.json
bun experiments/shape-1/trials/H5/replay.ts --repo <r> --variant F-conv --pipeline A --hatch-rule kinds --only <commits> --dump-inputs $W/xcheck/inputs --out $W/xcheck/<r>.sample.jsonl
bun experiments/shape-1/trials/H5/kernel-xcheck.ts --timeout 900 experiments/shape-1/kernel/.lake/build/bin/shapek $(ls -Sr $W/xcheck/inputs/*.json)   # add --raw to keep RJ-rejected records
bun experiments/shape-1/trials/H5/ex2-hatch.ts
```

Run times:
- derive per commit: median 57 ms, p90 217 ms, max 2.1 s for F-conv/A; median 288 ms for B.
- A full configuration: about 5 minutes with 4 processes. Pipeline B takes about 20 minutes.

## Results

### Primary: frozen surface (F-conv), vprobe manifests (A)

| Repository | Commits | Events | B3 | 1.0 surfaced | 1.0 blocking | Growth commits | 1.0 | Body-only | 1.0 | Precision |
|---|---|---|---|---|---|---|---|---|---|---|
| anvil | 581 | 336 | 84.8% | 70.2% | 70.2% | 216 | 100% | 51 | 19.6% | 95.5% |
| atmosphere | 265 | 143 | 72.7% | 64.3% | 64.3% | 88 | 100% | 39 | 2.6% | 97.9% |
| verified-ironkv | 15 | 7 | 28.6% | 100% | 100% | 2 | 100% | 5 | 100% | 100% |
| verified-memory-allocator | 31 | 6 | 33.3% | 100% | 83.3% | 1 | 100% | 4 | 100% | 100% |
| verified-node-replication | 145 | 41 | 97.6% | 73.2% | 73.2% | 26 | 100% | 1 | 0% | 83.3% |
| verified-nrkernel | 747 | 427 | 93.9% | 59.7% | 59.7% | 219 | 100% | 26 | 19.2% | 90.1% |
| verified-storage | 193 | 91 | 62.6% | 82.4% | 79.1% | 25 | 100% | 34 | 97.1% | 91.5% |
| vest | 224 | 21 | 81.0% | 61.9% | 52.4% | 8 | 100% | 4 | 50.0% | 92.9% |
| **ALL** | **2,201** | **1,072 (48.7%)** | **84.7% (908)** | **66.6% (714)** | **66.0% (708)** | **585** | **100% (585)** | **164** | **36.6% (60)** | **92.8% (714/769)** |

Slices:
- **Net growth commits (496):** 100% surfaced, 100% blocking.
- **Removal-only commits (323):** 21.4%.
- **Excluding removal-only commits (785):** 1.0 84.6% (664), B3 79.1% (621).
- **Commits with a trusted body or contract edit (359):** 1.0 66.3%, B3 54.3%.

**Misses.** All 358 missed event commits are of two kinds:
- removal-only (254), or
- commits with only trusted body or contract edits (104),

and in both the events lie outside the declared surface.

Per-file events (2,422), counted as surfaced when the commit has an obligation at that file:

| Event | Inside boundary | Outside boundary |
|---|---|---|
| add | 47/47 | 1,064/1,064 |
| remove | 38/38 | 43/701 (6.1%) |
| trusted edit | 79/79 | 16/493 (3.2%) |

**False positives (55 commits, all blocking).** By first cause:

| Cause | Commits |
|---|---|
| Marked file renamed | 23 |
| Body edit of a function carrying only assume/admit | 12 |
| Marked function renamed or moved | 9 |
| File-level own digest moved | 5 |
| Marker moved between functions of one file | 3 |
| Marked identity added or removed with no count change | 2 |
| Surface file renamed | 1 |

**Typical obligations:**
- NRKernel 4a8044a2 adds one `assume` in `page-table/pt_impl/l1.rs`. Result: one sound, introduced, blocking, mechanical contradiction of `NoHatches` (`assume<std::Trust>`) at `Directory::lemma_map_frame_refines_map_frame`, plus 31 preexisting owed ones. Verdict blocked.
- NRKernel cabd08e2 adds 6 `assume` inside the surface (`page-table/spec.rs`, which allows assume). Result: one introduced, blocking `unestablished stale` on the surface law.

### Volume per commit (obligations)

| Configuration | Caused by the commit: mean / median / p90 / max | On event commits: mean / median / p90 / max | All open (incl. preexisting): mean / median / p90 / max | Judgment-budget (caused) mean | Groups (caused) mean / max | Verdicts blocked / owed / pass |
|---|---|---|---|---|---|---|
| F-conv/A | 1.88 / 0 / 4 / 291 | 3.25 / 1 / 7 / 154 | 189.7 / 57 / 722 / 1,114 | 0.06 | 1.83 / 284 | 763 / 1,378 / 60 |
| F-dir/A | 1.95 / 0 / 3 / 291 | 3.34 / 1 / 7 / 154 | 185.1 / 46 / 722 / 1,114 | 0.32 | 1.71 / 284 | 956 / 1,173 / 72 |
| M/A | 1.61 / 1 / 2 / 292 | 2.59 / 1 / 4 / 155 | 1.61 / 1 / 2 / 292 | 0.52 | 1.56 / 285 | 1,093 / 144 / 964 |
| F-conv/B | 2.54 / 1 / 4 / 401 | 4.07 / 1 / 8 / 401 | 213.6 / 72 / 738 / 1,087 | 0.43 | 2.33 / 374 | 1,214 / 960 / 27 |
| M/B | 2.32 / 1 / 3 / 388 | 3.42 / 1 / 5 / 349 | 20.4 / 5 / 30 / 388 | 0.93 | 2.03 / 375 | 1,486 / 437 / 278 |

- **Frozen surfaces carry a growing wall of preexisting owed hatch contradictions.** Every marker outside the surface is listed on every run: 190 on average, up to 1,114.
- **The maximum is a directory move.** Anvil a27a5959 ("Remove V2", 307 files, 0 E9 events) raises 291 blocking contradictions in 284 groups, because each renamed marked identity is a new hatch fact.
- **A maintained surface has no preexisting debt, but costs re-judgment.**
  - 1,147 of 2,201 commits (52%) re-open the surface judgment, a person act; 88 of those commits only edit an assume-carrying function.
  - 277 commits add hatches outside the current surface (each would need an L7-answered widening, or a code fix).

### Variants

| Configuration | Recall (all events) | Blocking | Growth | Body-only | Removal-only | Precision | False-positive commits |
|---|---|---|---|---|---|---|---|
| F-conv/A (primary) | 66.6% | 66.0% | 100% | 36.6% | 21.4% | 92.8% | 55 |
| F-dir/A | 84.2% | 76.9% | 100% | 51.8% | 72.1% | 87.2% | 132 |
| M/A | 99.9% | 87.2% | 100% | 100% | 99.7% | 87.1% | 158 |
| F-conv/A literal `*` template | 66.6% | 66.0% | 100% | 36.6% | 21.4% | 92.8% | 55 |
| F-conv/B (prototype scanner) | 73.8% | 73.6% | 98.1% | 51.2% | 41.2% | 65.0% | 425 |
| M/B | 98.4% | 88.5% | 98.1% | 99.4% | 98.5% | 66.3% | 537 |
| B3 per-file count diff (E9) | 84.7% | n/a | 100% by construction | 0% | 100% | 100% by construction | 0 |

**Counterfactual rule.** Treat an edit to an identity that already carries a contradicted hatch fact as introducing, using the replay's `codeChanged` flag on each preexisting contradiction:
- F-conv/A recall becomes 87.8% (941/1,072);
- 100% of the 785 non-removal event commits are caught;
- precision is 77.9%.

**How the frozen surface drifts (`surface_drift.py`).**
- F-conv covers 227/227 markers at c0 but 321/1,113 at HEAD: Anvil 0/478, Atmosphere 0/171, NRKernel 0/79, Storage 215/225 through `_t.rs`.
- Its Req is empty in 71.2% of commits. Then the judgment cites nothing and is rejected RJ10, and the surface law is `missing`, preexisting and owed.
- F-dir: 385/1,113 markers at HEAD; empty in 34.2% of commits.

**Pipeline B misses 11 growth commits.**
- 10 are in node-replication, where `nr/src/main.rs` uses `verus_old_todo_no_ghost_blocks! {`; 1 is in Anvil, where the file uses old-style `#[verifier(external_body)]` with no `verus!`.
- In both cases the scanner classifies the file as plain Rust and drops every Verus marker, yet the file stays hatch-complete.

**Pipeline B false positives.** 383 of its 425 false-positive commits are coverage obligations on files the scanner calls not hatch-complete (`macro_rules!` or `#[derive]`).

**Marker audit (`audit_markers.ts`, 16,612 blobs).** The scanner agrees with vprobe per kind on 15,920 blobs (95.8%), and on 4,944 of the 5,636 marked blobs (87.7%). The main differences:
- `unsafe`: 3,172 scanner-only markers in 469 files;
- `assume`: 12,219 vs 14,219 (156 files, from the language-detection defect);
- `assume_specification`: 7 vs 67.

### Kernel cross-check (Lean `shapek`)

The sample: 71 F-conv/A commits, stratified per repository over hits, misses, false positives and no-event commits. Outcomes: 42 blocked, 22 owed, 7 pass.

Each case is converted as `kernel/test/bridge.ts` does, plus one step: records the prototype rejected (RJ01–RJ14, pre-pass validation) are dropped.

- **Agreement: 71/71.** Verdict, errors, and every obligation's key, kind, severity, introduced, force and reason agree; 1,641 obligations were compared.
- **Without the drop (`--raw`):** 18 of 18 empty-surface cases under 600 KB differ, each by exactly one obligation, the `missing` surface law. The kernel finds the law satisfied by the uncited judgment, and one verdict flips from owed to pass.
- **Run time:** shapek 2,826 s against derive 4.9 s. One 2.9 MB case alone ran more than 9 minutes.

### Side finding: `forbid hatch *` (std HatchesStayAtBoundaries)

The prototype elaborates `*` literally. Besides one forbid per kind, it adds `effect.forbid(Hatch<std::Trust>, [*], boundaries allowing Hatch)`. Every declared kind implies Hatch, so this forbid covers allowed markers inside boundaries too.

- **On the spec's Example 2** (`ex2-hatch.ts`), derive reports a third obligation, a preexisting owed contradiction at `host_t.rs#Host::send` (external_body, which HostTrusted allows), that the example text does not list.
- **In the replay (F-conv.A.star):** recall is unchanged, because in-boundary changes already stale the surface law. But `pass` verdicts fall from 60 to 0, and mean open obligations rise from 190 to 204.

## Verdict

**Asserted.** Hatch growth is missed in 0 of 585 growth commits (0%) with vprobe-semantics markers. That holds under all three surface variants and under the literal template; every caught growth commit is blocking. With the prototype's own scanner it is missed in 11 of 585 (1.9%). Both are far below the 15% threshold.

Growth is caught by the hatch forbid whatever the declared surface. The surface law adds coverage of changes inside the surface.

**Qualification on the stricter reading (all E9 trust events).** A surface frozen at the first commit reaches 66.6% recall, below B3's 84.7%. Every miss is either:
- a marker removal outside the surface, which shrinks the trust base, or
- an edit to the body or contract of trusted code outside the surface (104 commits; 477 of 493 per-file events).

Directory globs reach 84.2%. A maintained surface reaches 99.9%, at the cost of re-judging the surface on 52% of commits. The proposed rule "edit of a hatch-carrying identity is new" reaches 87.8% overall, and 100% excluding removals.

Precision against E9 is 92.8% for the primary configuration. The extra flags are mostly real changes to the trust surface that E9 does not count: renamed marked files and functions, and assume-carrying function edits.

## Threats

- **Synthetic shapes.** Each repository gets one boundary, one rule and one judge, chosen by a deterministic rule. F-conv, F-dir and M bracket author choices.
- **Per-commit fresh base judgment.** Only the reason changes (stale vs missing), never which obligations are introduced. Removals are the exception, handled by the base→base check.
- **Pipeline A digests are synthetic.** vprobe's hashes ignore attributes: 247 of 5,185 marked blobs have function flags exceeding the file count, and one missed removal in M comes from this. The file own digest is a lower bound.
- **E9's ground truth shapes the scores.** Removals count as events; assume-only function edits and renames do not.
- **Granularity and filtering.** Commits are first-parent; mechanical commits are kept, as in E9.
- **Untested path.** No proof records exist, so unestablished(assumption) on proven laws is untested.
- **Kernel sample.** 71 cases, biased toward small inputs, with 13 cases over 1 MB.
- **Scanner defects in pipeline B** are reported, not fixed: it is another agent's component.

## Files

**Scripts** (`/home/user/shapelang/experiments/shape-1/trials/H5/`, 1,340 lines; lint and typecheck clean):
- `walk_fn.py`, `check_walk.py`
- `replay.ts`, `runall.sh`
- `analyze.py`, `analyze_glob.py`, `surface_drift.py`
- `audit_markers.ts`, `kernel-xcheck.ts`, `ex2-hatch.ts`

**Outputs** (scratch `shape1work/H5/`):
- `walk/` (walks and blobs)
- `runs/<config>/<repo>.jsonl` (one line per commit with every obligation)
- `analysis.txt`, `analysis.json`, `surface_drift.txt`, `audit_markers.json`
- `xcheck/report.txt`, `xcheck/report-raw.txt`, `xcheck/inputs/`
