# H1: judgment budget, replayed over Shape's history

## Verdict

**Disproved.** On Shape's own history, 1.0 does not halve judgment obligations per change compared with today's 0.x path-level coverage.

Over the 82 commits that touch governed source, 1.0 raises **851** introduced judgment-class obligations. Today's 0.x coverage demands **690**. The pooled ratio is **1.23** (95% bootstrap CI 0.86–1.70), so the falsification criterion is met.

Three variants come close without passing:

| Variant | Ratio | 95% CI |
|---|---|---|
| Blocking obligations only | 0.54 | 0.38–0.75 |
| Without producer-changed obligations | 0.52 | 0.40–0.67 |
| PR level, without producer-changed | 0.47 | 0.35–0.64 |

Only one count is halved: obligations counted in **groups** (the spec's budget unit), at **0.31** (CI 0.24–0.41). That is a different claim from SEED's criterion.

Most of the excess comes from one source. 58% of the 1.0 judgment obligations are producer-changed. All 13 producer-changed obligations in the hand-check sample were false.

## Hypothesis and falsification criterion (SEED.md)

> H1: The per-change judgment budget falls sharply when only obligations whose dischargers include judgment go to a person or Claude. Falsified if judgment obligations per change are not at least halved, against today's path-level coverage, on Shape's own history.

I fixed these definitions before the replay ran:

- **Change.** A non-merge commit on master, compared with its first parent. The clone is shallow: `git rev-list --no-merges master` gives 118 commits, 3 of which have no parent in the clone, leaving 115 replayable. The earliest is from 2026-07-26.
- **Population.** Commits with 0.x demand ≥ 1 ("touch source governed by shape/"): **82** of them, which meets the "at least 60" requirement. I also report the last 60 governed commits, all 115 commits, and a PR-level run over the 49 first-parent master commits.
- **a (0.x).** What today's `shp coverage` demands before any discharge:
  - changed non-`.shape` files matched by an `on_change require shape_update` implementation glob of the commit's own shape (each needs a Shape update or a new `no_shape_change` attestation);
  - plus `guarded_source_changed` guards (on_change ReEvaluation guards on a function whose source file changed).
  The count is in distinct files and distinct guard@file pairs.
- **b (1.0).** Introduced obligations whose budget is `judgment`, meaning the first discharger is not checker-verifiable (§7.1). They come from the dogfood model, the prototype's `derive`, and providers rerun at head (tsClockScan and tsCalls on both trees, bunTest on head). Because mechanical providers are rerun, anything a rerun would discharge is already gone. Preexisting obligations are owed and never count as per-change work.
- **Primary statistic.** Pooled Σb/Σa over the governed commits. H1 survives only if it is ≤ 0.5.

## Method

What I built (no existing component was broken; dogfood had listed H1 as not done):

- **`zerox.ts` (side a).** Imports today's `packages/shp-checker` (`checkCoverage`, `checkGuardedSources`, `checkBindings`, `normalizeCheckOptions`) and runs them over each commit's own `shape/**/*.shape`. Changed files come from `git diff --name-only parent C`, as `scripts/write-changed-files.sh` does.
  - Demand is measured by dropping `.shape` files from the change, so no Shape update counts, and by adding every head attestation and reevaluation to the base summary, so none counts as new. Guards that the change itself adds are still skipped, as `shp` does.
  - Residual is exactly what `shp coverage --base-model <parent>` reports.
  - It also records bindings (a `shp check` concept, not coverage), the governing components, and a variant (`--model b52cb5b`) that reads today's tip 0.x model for every commit.
- **`replay.ts` (side b).** Mirrors `dogfood/tools/runs.ts replay`:
  1. `materialize` the parent and the commit (git archive plus today's dogfood files).
  2. Build the prototype manifest for both trees.
  3. `composeModel`: the commit's 0.x shape, through the prototype's migrate, then the `shape1.yaml` overlay.
  4. Run the observers on both trees and bunTest on the head, then call `derive`.
  It writes the full output to scratch and one compact row per commit.
- **`analyze.py`.** Joins the two sides and computes per-commit values, pooled ratios with a 10,000-resample bootstrap over commits, a mapping from 0.x files to 1.0 obligations, and a seeded sample of 20.
- **Hand-check helpers.** `sample_nonpc.py` (a second stratum), `sample0x.py`, and `show.py`, which prints an obligation with its commit.

Exact commands (W = `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H1`, run from `/home/user/shapelang`):

```
git rev-list --no-merges --reverse master > $W/all-nonmerge.txt        # 118
git rev-list --first-parent --reverse master > $W/first-parent.txt     # 50
bun experiments/shape-1/trials/H1/zerox.ts --commits $W/all-nonmerge.txt --work $W --out $W/zerox-all.json   # ~1 min, byte-identical on rerun
bun experiments/shape-1/trials/H1/zerox.ts --commits $W/all-nonmerge.txt --work $W --out $W/zerox-all-tipmodel.json --model b52cb5b
bun experiments/shape-1/trials/H1/zerox.ts --commits $W/first-parent.txt --work $W --out $W/zerox-pr.json
# replay lists = the commits zerox could replay (data/replayable.txt: 115, data/pr-replayable.txt: 49)
bun experiments/shape-1/trials/H1/replay.ts --commits $W/replayable.txt --work $W/run --rows $W/run/rows.jsonl       # 22.4 s/commit, derive 3.8 s, 43 min
bun experiments/shape-1/trials/H1/replay.ts --commits $W/pr-replayable.txt --work $W/runpr --rows $W/runpr/rows.jsonl # 18 min
python3 -I experiments/shape-1/trials/H1/analyze.py $W/zerox-all.json $W/run/rows.jsonl $W/an --tip $W/zerox-all-tipmodel.json
python3 -I experiments/shape-1/trials/H1/analyze.py $W/zerox-pr.json $W/runpr/rows.jsonl $W/an-pr --label pr
python3 -I experiments/shape-1/trials/H1/sample_nonpc.py $W/an $W/run/rows.jsonl
python3 -I experiments/shape-1/trials/H1/sample0x.py $W/zerox-all.json $W/sample0x.json
python3 -I experiments/shape-1/trials/H1/show.py $W/run/out <commit> <ob:prefix>
```

- **Determinism.** zerox reruns byte-identical. Replaying 53fe3ce in two separate runs gives identical sets of introduced and preexisting obligation keys.
- **Checks.** The H1 TypeScript passes `oxlint --deny-warnings` and gives 0 tsgo errors.
- **Failures.** 0 of the 164 replays failed.

## Results

### Pooled ratios (Σb / Σa)

The population is the 82 governed commits:
- Σa = 690, made of 608 files and 82 guards.
- Σa_bind = 779 (a plus 89 triggered DocumentedBy-style bindings).
- Σa_tip = 505 (a under today's tip 0.x model).
- Σa_comp = 242 (governing components plus guards).

| 1.0 numerator | Σ | / a | 95% CI | / a_bind | / a_tip | / a_comp |
|---|---|---|---|---|---|---|
| **b_J: judgment-class, introduced (primary)** | **851** | **1.233** | 0.859–1.696 | 1.092 | 1.685 | 3.517 |
| b_J, blocking only | 375 | 0.543 | 0.379–0.748 | 0.481 | 0.743 | 1.550 |
| b_J, distinct groups | 215 | 0.312 | 0.244–0.414 | 0.276 | 0.426 | 0.888 |
| b_J without producer-changed | 357 | 0.517 | 0.399–0.670 | 0.458 | 0.707 | 1.475 |
| any discharger by judges (literal "include") | 1497 | 2.170 | 1.472–3.035 | 1.922 | 2.964 | 6.186 |

The last row reads "include judgment" literally. Every introduced obligation, mechanical contradictions included, has an exception or answer discharger, so this reading is degenerate.

### Other populations

| Population | n | b_J/a | 95% CI | groups/a | b_J without producer-changed / a | blocking/a |
|---|---|---|---|---|---|---|
| Governed (primary) | 82 | 1.233 | 0.86–1.70 | 0.312 | 0.517 | 0.543 |
| Last 60 governed | 60 | 1.301 | 0.81–1.93 | 0.329 | 0.528 | 0.617 |
| All replayed commits | 115 | 1.458 | 1.02–2.04 | 0.345 | 0.546 | 0.622 |
| PR level (governed merges) | 44 | 1.490 | 1.04–2.14 | 0.268 | 0.471 | 0.620 |
| Governed, head elaborates with 0 errors | 22 | 2.918 | 1.07–5.29 | 0.726 | 0.945 | 1.342 |
| Governed commits with no producer change | 71 | 0.555 | 0.42–0.73 | 0.332 | 0.555 | 0.312 |

### Per commit (governed)

| Measure | Value |
|---|---|
| Mean a / mean b_J / mean groups | 8.41 / 10.38 / 2.62 |
| Median a / median b_J / median groups | 3.5 / 2 / 2 |
| Median per-commit b_J/a | 0.808 |
| Median per-commit groups/a | 0.374 |
| Commits with b_J ≤ a/2 | 34 of 82 |
| Commits with groups ≤ a/2 | 54 of 82 |
| Commits with b_J > a | 23 |
| Commits with b_J = 0 | 8 |

Among the 33 non-governed commits, 11 still get 1.0 judgment obligations (155 in all, 135 of them producer-changed). Examples are pure Shape edits such as c9af552, which raises an L2 loosening, and toolchain pins such as bb785d4 (46).

### What the 1.0 judgment obligations are (governed, 851)

| Kind | Count | Blocking | Notes |
|---|---|---|---|
| unestablished/producer-changed | 494 | 173 | From 11 commits that touch bunTest's declared implementation (package.json, bun.lock, tsconfig.json), 37–48 each. 304 sit on laws with no test (bunTest's inconclusive placeholders); 190 on tested laws. |
| coverage (one per component) | 143 | 95 | Blocking ones are critical; 48 are owed at normal. |
| unestablished/missing on informal laws | 132 | 28 | 100 DocumentedBy laws, 32 RefactorSensitive. "Missing" stands in for "stale" because no judgments exist yet. |
| loosening | 82 | 79 | L1 50, L2 27, L6 4, L2+L6 1; 40 exploited. 24 of the L1 obligations come from deleting or renaming one resource (82d7f4f). |

Mechanical obligations are not counted, but there are 646 introduced ones: 635 blocking sound contradictions, mostly effects.upper, where 0.x direct summaries meet 1.0's transitive `complete`.

### What the 0.x demand is (governed, 690)

- **Files (608):** md 286, ts 185 (6 of them tests), mjs 52, yml 30, yaml 16, json 14, sh 12, rs 3, html 3, css 3, toml 2, langium 1, lock 1.
- **Guards:** 82.
- **Residual:** 179 of the 690 demands (26%) were left undischarged by their own commit, as today's `shp coverage` judges them.

### 0.x files that 1.0 asks nothing about

Of the 608 0.x demand files, 354 (58%) are named by at least one introduced 1.0 obligation, and all 354 by a judgment-class one. The other 254 get no 1.0 obligation:

| Type of silent file | Count |
|---|---|
| md | 211 |
| yaml | 11 |
| yml | 11 |
| json | 10 |
| css | 3 |
| ts (all in 36881e7, a comment-only commit) | 6 |
| mjs (one comment-only, one deleted file) | 2 |

So 1.0 drops 0.x's governance of data files (docs prose, skill text) and ignores inert comments. These are real precision gains that a hand check confirms. The new obligation sources more than cancel them.

### Per-commit table (governed; files, guards and a are 0.x; the rest are 1.0)

pc = producer-changed, blk = blocking judgment, grp = groups, cov = coverage, law = informal-law unestablished.

| # | commit | date | files | guards | a | b_J | pc | blk | grp | b_J/a | non-pc kinds |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 021fb3a | 07-26 | 3 | 0 | 3 | 3 | 0 | 0 | 2 | 1.00 | cov1 law2 |
| 2 | 1c4875a | 07-26 | 2 | 0 | 2 | 1 | 0 | 0 | 1 | 0.50 | law1 |
| 3 | 23fd95e | 07-26 | 9 | 2 | 11 | 7 | 0 | 5 | 4 | 0.64 | cov4 L2 1 law2 |
| 4 | 2f2752d | 07-26 | 3 | 0 | 3 | 6 | 0 | 6 | 3 | 2.00 | cov2 L1 2 L2 1 law1 |
| 5 | 3e84e60 | 07-26 | 22 | 5 | 27 | 16 | 0 | 7 | 9 | 0.59 | cov9 law7 |
| 6 | 3f7bfaf | 07-26 | 16 | 0 | 16 | 45 | 40 | 14 | 4 | 2.81 | cov3 L1 1 law1 |
| 7 | 7f6f445 | 07-26 | 5 | 2 | 7 | 10 | 0 | 4 | 4 | 1.43 | cov2 L1 2 L2 2 law4 |
| 8 | abb98b8 | 07-26 | 3 | 0 | 3 | 3 | 0 | 0 | 2 | 1.00 | cov1 law2 |
| 9 | cc02c32 | 07-26 | 7 | 5 | 12 | 17 | 0 | 10 | 4 | 1.42 | cov4 L1 3 L2 2 L6 2 law6 |
| 10 | d3cbff3 | 07-26 | 3 | 1 | 4 | 2 | 0 | 1 | 1 | 0.50 | cov1 law1 |
| 11 | f41ed20 | 07-26 | 8 | 0 | 8 | 44 | 37 | 11 | 5 | 5.50 | cov3 L1 1 L2 1 law2 |
| 12 | ff41ccd | 07-26 | 2 | 1 | 3 | 4 | 0 | 2 | 3 | 1.33 | cov2 law2 |
| 13 | 0870fe1 | 07-27 | 2 | 0 | 2 | 1 | 0 | 0 | 1 | 0.50 | law1 |
| 14 | 08e17a1 | 07-27 | 6 | 1 | 7 | 9 | 0 | 7 | 3 | 1.29 | cov3 L1 1 L6 1 law4 |
| 15 | 1b82323 | 07-27 | 41 | 0 | 41 | 6 | 0 | 0 | 6 | 0.15 | law6 |
| 16 | 53fe3ce | 07-27 | 22 | 2 | 24 | 10 | 0 | 0 | 7 | 0.42 | cov2 law8 |
| 17 | 9985f99 | 07-27 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 1.00 | cov1 |
| 18 | c04a5e7 | 07-27 | 9 | 3 | 12 | 12 | 0 | 6 | 7 | 1.00 | cov6 L1 1 L2 1 law4 |
| 19 | 4e7297c | 07-28 | 36 | 1 | 37 | 49 | 43 | 19 | 3 | 1.32 | cov1 L1 1 L2+L6 1 L6 1 law2 |
| 20 | 7e547b5 | 07-28 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0.00 | |
| 21 | 9604409 | 07-28 | 11 | 0 | 11 | 44 | 43 | 14 | 2 | 4.00 | law1 |
| 22 | 02e3485 | 07-29 | 27 | 0 | 27 | 4 | 0 | 4 | 2 | 0.15 | cov1 L1 1 L2 2 |
| 23 | 2b08aaa | 07-29 | 15 | 0 | 15 | 0 | 0 | 0 | 0 | 0.00 | |
| 24 | c710095 | 07-29 | 12 | 0 | 12 | 1 | 0 | 1 | 1 | 0.08 | cov1 |
| 25 | eba841d | 07-29 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0.00 | |
| 26 | 02d35cf | 07-30 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0.00 | |
| 27 | 1600ad0 | 07-30 | 2 | 0 | 2 | 1 | 0 | 1 | 1 | 0.50 | cov1 |
| 28 | 9a5dfac | 07-30 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0.00 | |
| 29 | 9ed14d4 | 07-30 | 2 | 0 | 2 | 1 | 0 | 1 | 1 | 0.50 | cov1 |
| 30 | 1f55dce | 08-19 | 18 | 0 | 18 | 8 | 0 | 6 | 3 | 0.44 | cov3 L1 2 L2 1 law2 |
| 31 | c1238f5 | 08-19 | 13 | 0 | 13 | 1 | 0 | 1 | 1 | 0.08 | cov1 |
| 32 | 0307e90 | 08-20 | 2 | 0 | 2 | 1 | 0 | 1 | 1 | 0.50 | cov1 |
| 33 | 4ba123f | 08-20 | 11 | 0 | 11 | 2 | 0 | 1 | 2 | 0.18 | cov1 law1 |
| 34 | 660e7c4 | 08-20 | 3 | 0 | 3 | 1 | 0 | 1 | 1 | 0.33 | cov1 |
| 35 | 773f307 | 08-20 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0.00 | |
| 36 | 8302f76 | 08-20 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 1.00 | cov1 |
| 37 | ce66406 | 08-20 | 18 | 0 | 18 | 1 | 0 | 1 | 1 | 0.06 | cov1 |
| 38 | 30a7e93 | 09-07 | 10 | 1 | 11 | 4 | 0 | 4 | 3 | 0.36 | cov2 L2 1 law1 |
| 39 | 3ce8cb8 | 09-07 | 13 | 2 | 15 | 6 | 0 | 1 | 4 | 0.40 | cov3 law3 |
| 40 | 5b8fe8a | 09-07 | 2 | 0 | 2 | 2 | 0 | 0 | 2 | 1.00 | cov1 law1 |
| 41 | 651de1a | 09-07 | 9 | 1 | 10 | 3 | 0 | 3 | 2 | 0.30 | cov2 law1 |
| 42 | 66c6840 | 09-07 | 9 | 0 | 9 | 47 | 46 | 17 | 2 | 5.22 | law1 |
| 43 | b3168e3 | 09-07 | 7 | 2 | 9 | 2 | 0 | 2 | 1 | 0.22 | cov1 law1 |
| 44 | 25174a4 | 09-24 | 8 | 1 | 9 | 6 | 0 | 3 | 6 | 0.67 | cov4 law2 |
| 45 | 646019d | 09-24 | 2 | 1 | 3 | 2 | 0 | 1 | 2 | 0.67 | cov2 |
| 46 | c19034b | 09-24 | 1 | 1 | 2 | 2 | 0 | 0 | 1 | 1.00 | cov1 law1 |
| 47 | 00d0f86 | 09-25 | 4 | 0 | 4 | 3 | 0 | 1 | 2 | 0.75 | cov2 law1 |
| 48 | 18aee38 | 09-25 | 9 | 5 | 14 | 7 | 0 | 4 | 2 | 0.50 | cov4 law3 |
| 49 | 1bf0a3e | 09-25 | 9 | 2 | 11 | 60 | 47 | 25 | 7 | 5.45 | cov5 L1 3 L2 2 law3 |
| 50 | 1f54263 | 09-25 | 2 | 1 | 3 | 2 | 0 | 1 | 2 | 0.67 | cov1 law1 |
| 51 | 36881e7 | 09-25 | 18 | 10 | 28 | 12 | 0 | 7 | 8 | 0.43 | cov8 law4 |
| 52 | 5c08fa2 | 09-25 | 1 | 0 | 1 | 3 | 0 | 1 | 2 | 3.00 | cov1 law2 |
| 53 | 5d6a164 | 09-25 | 3 | 0 | 3 | 1 | 0 | 0 | 1 | 0.33 | law1 |
| 54 | 6c163b7 | 09-25 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0.00 | |
| 55 | 986c54a | 09-25 | 16 | 7 | 23 | 18 | 0 | 13 | 3 | 0.78 | cov7 L1 2 L2 2 law7 |
| 56 | bd903c2 | 09-25 | 18 | 6 | 24 | 72 | 47 | 42 | 6 | 3.00 | cov7 L1 5 L2 7 law6 |
| 57 | ccee02e | 09-25 | 2 | 0 | 2 | 4 | 0 | 1 | 2 | 2.00 | cov2 law2 |
| 58 | fa20dee | 09-25 | 53 | 0 | 53 | 57 | 47 | 18 | 10 | 1.08 | cov1 law9 |
| 59 | 0b16d16 | 09-28 | 8 | 5 | 13 | 11 | 0 | 6 | 5 | 0.85 | cov5 L1 1 law5 |
| 60 | 13fb5da | 09-28 | 2 | 0 | 2 | 2 | 0 | 2 | 1 | 1.00 | cov1 L2 1 |
| 61 | 1c05390 | 09-28 | 1 | 0 | 1 | 2 | 0 | 0 | 1 | 2.00 | cov1 law1 |
| 62 | 1d7c0e8 | 09-28 | 5 | 1 | 6 | 1 | 0 | 1 | 1 | 0.17 | cov1 |
| 63 | 393d96c | 09-28 | 1 | 1 | 2 | 2 | 0 | 2 | 1 | 1.00 | cov1 law1 |
| 64 | 5de9daa | 09-28 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 1.00 | cov1 |
| 65 | 603bab3 | 09-28 | 1 | 0 | 1 | 2 | 0 | 0 | 1 | 2.00 | cov1 law1 |
| 66 | 6374f95 | 09-28 | 6 | 6 | 12 | 6 | 0 | 3 | 3 | 0.50 | cov3 law3 |
| 67 | 642e824 | 09-28 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 1.00 | cov1 |
| 68 | 82d7f4f | 09-28 | 9 | 0 | 9 | 27 | 0 | 24 | 25 | 3.00 | cov1 L1 24 L2 2 |
| 69 | 8aacfaf | 09-28 | 3 | 3 | 6 | 5 | 0 | 2 | 2 | 0.83 | cov2 law3 |
| 70 | 8cf73fb | 09-28 | 1 | 1 | 2 | 2 | 0 | 1 | 2 | 1.00 | cov1 law1 |
| 71 | a506173 | 09-28 | 2 | 0 | 2 | 2 | 0 | 0 | 1 | 1.00 | cov1 law1 |
| 72 | a748a30 | 09-28 | 1 | 1 | 2 | 2 | 0 | 2 | 1 | 1.00 | cov1 law1 |
| 73 | b908c4f | 09-28 | 8 | 0 | 8 | 50 | 48 | 19 | 2 | 6.25 | cov1 L2 1 |
| 74 | c2f41ba | 09-28 | 1 | 0 | 1 | 2 | 0 | 0 | 1 | 2.00 | cov1 law1 |
| 75 | cc84d4c | 09-28 | 1 | 0 | 1 | 2 | 0 | 0 | 1 | 2.00 | cov1 law1 |
| 76 | 297551b | 09-29 | 3 | 0 | 3 | 1 | 0 | 1 | 1 | 0.33 | cov1 |
| 77 | 36cb421 | 09-29 | 1 | 0 | 1 | 49 | 48 | 18 | 2 | 49.00 | cov1 |
| 78 | 5d033ae | 09-29 | 5 | 1 | 6 | 53 | 48 | 20 | 4 | 8.83 | cov3 law2 |
| 79 | 6a783ae | 09-29 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0.00 | |
| 80 | c6f8304 | 09-29 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 1.00 | cov1 |
| 81 | eccfa21 | 09-29 | 5 | 0 | 5 | 1 | 0 | 0 | 1 | 0.20 | law1 |
| 82 | ef5d3c9 | 09-29 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 1.00 | cov1 |

## Hand check: false-obligation rate

I applied one criterion to both systems. An obligation is **false** when the diff alone settles its question as no-impact, with no domain judgment needed. It is **true** when answering needs a reviewer to look at behaviour that the claim describes. Every 1.0 obligation is correct under the semantics the prototype implements. "False" means the semantics, or the dogfood model, asked a question that carries no information. There was one rater (this agent). Per-item reasons are in `handcheck-1x.json` and `handcheck-0x.json`.

### 1.0, the required sample of 20 (seed 20261026, from all 851)

**16 false, 4 true: 80% false** (Wilson 95% CI 58–92%).

The 16 false ones:
- 13 producer-changed (100% of the sampled producer-changed obligations):
  - package.json gained unrelated scripts (4e7297c, 1bf0a3e ×2, bd903c2);
  - bun.lock changed only through LSP deps (f41ed20 ×2), docs-site deps (fa20dee ×2, 9604409) or the workspace's own version number (66c6840 ×2);
  - a tree-sitter bump that reached 2 laws with no test at all (5d033ae ×2).
- 1 coverage obligation on a new 4-line pure string helper (cc02c32 ShapePreludeRegistry). Its unmet channels come from another component's effects.lower call cone.
- 1 CliDocumented obligation on a release whose only CLI-docs change was version strings (66c6840).
- 1 L2 "undecided" on the summary of a unit whose code the same commit deleted (82d7f4f).

The 4 true ones:
- coverage on the release shell script's new failure handling (a748a30);
- two L2 summary widenings that came with the code (bd903c2, 23fd95e);
- CliDocumented after the author-flag rework (c04a5e7).

### 1.0, supplementary stratum (seed 20261027, 20 from the 357 obligations that are not producer-changed)

**5 false: 25%** (Wilson 11–47%).
- 2 coverage obligations on type-only or pure-formatter edits (3e84e60 model.ts, bd903c2 diagnostics.ts).
- 3 DocumentedBy obligations on docs edits that cannot affect accuracy: one link sentence, and example source references in two pages (0870fe1, 53fe3ce ×2).

### Stratified estimate

0.58 × (13 of 13) + 0.42 × 0.25 ≈ **69%** of 1.0 judgment-class obligations are false.

### 0.x, 20 demands (seed 20261026, from 690)

**10 false: 50%** (Wilson 30–70%).
- Docs prose ×4.
- Skill reference, prompt or version text ×3.
- Plugin version bump.
- CLI help string.
- Comment-only edit.
- A file-level guard firing on a new helper beside an unchanged guarded function.

1.0's unit-digest RefactorSensitive and its comment-insensitive digests would not raise the last two.

### Indicative comparison of true questions only (speculative; intervals overlap widely)

- 1.0: about 357 × 0.75 ≈ 268, plus about 0 from producer-changed.
- 0.x: about 690 × 0.5 ≈ 345.
- Ratio: about 0.78.

Even counting only real questions, the obligation count is not halved.

## Why the 1.0 count is not halved, in order of size

1. **Producer-changed multiplies per law (494 obligations, 58%).**
   - bunTest's implementation is declared as whole files (package.json, bun.lock, tsconfig.json), following syntax §1's fastCheck example.
   - Any script or lockfile edit raises one obligation per tested or decided law: 37–48 per commit.
   - 304 of the 494 sit on inconclusive placeholders for laws that have no test, where nothing is lost.
   - Keying producer-changed by provider alone would collapse the 494 into 11.
2. **Coverage per component replaces coverage per file, but fires on every governed code change (143).**
   - The only call observer is presence-only, so structure claims are never covered.
   - effects.lower call-cone footprints add fs.path channels to pure code.
3. **Informal-law re-judgment (132)** replaces 0.x guards (82) and bindings (89). The DocumentedBy laws' Req includes whole docs pages, so a docs edit to example syntax fires them.
4. **Loosenings from Shape edits (82),** which 0.x coverage never counted. 24 of them come from one resource rename without `was` (82d7f4f), each in its own group.

1.0's gains are real but smaller:
- data files under no claim raise nothing (254 of 608 0.x files);
- comment-only edits raise nothing (36881e7: 28 demands become 0);
- the median commit gets fewer judgment items (2 against 3.5).

## Threats to validity

- **Anachronistic model.** Each historical tree gets today's overlay. 60 of the 82 governed heads carry 1 to 25 elaboration errors (E-unknown 220, E-conduct 180, E-overlap 40, E-provider-missing 34, E-unbound 19, E-structure 17, E-ambiguous 8). Errors remove claims and so reduce 1.0 obligations: the 22 commits with 0 errors give 2.92 (0.95 without producer-changed, 0.73 in groups). The bias favours 1.0, so it strengthens the verdict.
- **The dogfood model decides the counts.**
  - Whole-file implementation paths.
  - 10 DocumentedBy laws and 27 RefactorSensitive laws.
  - 75 of 82 resource codes are observed by no provider.
  - Migrated 0.x summaries read as transitive.
  A different 1.0 model of Shape would give other numbers. The spec's own example would reproduce the producer-changed explosion.
- **No judgment records.** Informal laws are "missing" rather than "stale"; the count is the same either way.
- **Unit and severity.**
  - 0.x counts per file and every demand blocks CI. 1.0 counts per obligation and 476 of 851 are owed.
  - The blocking-only variant gives 0.54; the per-group variant gives 0.31; per-component denominators give 3.5 (obligations) and 0.89 (groups).
- **History.**
  - The clone is shallow: 115 of 118 non-merge commits, from 2026-07-26 on.
  - Side-branch commits are judged per commit; the PR-level run is reported alongside.
  - Today's 0.x semantics are applied to historical models. The guarded-source check postdates many of these commits, and 179 of 690 demands went undischarged at commit level.
- **Prototype.** The cell, L3 and grouping approximations listed in its interface apply. Its derive took a mean of 3.8 s per commit.
- **Hand checks.** One rater; n = 20 per sample.
- **Environment.** Another agent's H2 run shared the CPU; this affects timings only.

## Files

- **Scripts** (in `experiments/shape-1/trials/H1/`):
  - `zerox.ts`: 0.x demand.
  - `replay.ts`: 1.0 replay driver.
  - `analyze.py`: ratios, bootstrap, mapping, sample.
  - `sample_nonpc.py`, `sample0x.py`: hand-check samples.
  - `show.py`: obligation viewer.
- **Hand-check verdicts:** `handcheck-1x.json`, `handcheck-0x.json`.
- **Data** (`data/`):
  - `per-commit.json`, `summary.json`;
  - `per-commit-pr.json`, `summary-pr.json`;
  - `sample20.json`, `sample20-nonpc.json`, `sample0x.json`;
  - `zerox-commits.json`, `zerox-commits-tipmodel.json`, `zerox-pr.json`;
  - `commits.txt`, `first-parent.txt`, `replayable.txt`, `pr-replayable.txt`.
- **Bulky outputs (scratch):** `.../shape1work/H1/run/rows.jsonl` (9 MB) and `run/out/*.out.json.gz` (21 MB, full derive output per commit); `runpr/` (PR level); `an/`, `an-pr/`.

Nothing was committed. I wrote only under `experiments/shape-1/trials/H1/` and the scratch directory, and the repository's AST generator was not run.
