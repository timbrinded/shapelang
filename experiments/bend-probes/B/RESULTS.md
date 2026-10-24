# B1: can an agent close the loop with Bend proofs?

**Hypothesis.** Fresh agents solve Bend's own proof evals at the easy and firm
tiers and fail at the hell tier.

**Verdict: disproved.** All five tiers were solved, hell included, and every
solution also passes `--verdict`, the recheck by Bend's kernel that is proven
in Lean.

## Method

- **Tasks.** One eval per tier from `bendlang/bend` at `295e996` (`evals/`),
  cut at the `# solution` marker so that every law in the remainder is open.
- **Agents.** Each eval went to a fresh Claude Code subagent. It saw only its
  workspace and a copy of the compiler (`bend2/` plus the guide), with no access
  to `evals/`, `tests/` or the demos.
- **Rules.** The agent could append lemmas and proofs but could not change any
  existing statement.
- **Gate.** `./gate.sh`, which wraps `bend TASK.bend --check-only` and logs
  every run.
- **Verification** (`verify_b1.sh`):
  - the original file is a byte-identical prefix of the solution;
  - there are no `@unsafe`, `def f?`, foreign imports or added imports;
  - the solution passes `--verdict` with Lean 4.34.0 (`b1_verdict.txt`).
- **Contamination.** Bend 2 was released on 2026-09-17, after the model's
  training cutoff, so the evals cannot have been memorised.

## Results

| Tier | Eval | Open laws | Gate runs | Lines added | Bend's reference solution | Wall time | Gate | `--verdict` |
|---|---|---:|---:|---:|---:|---:|---|---|
| easy | inventory_pruning | 1 | 2 | 57 | 47 | 68 s | pass | pass |
| firm | conservation_timeline | 4 | 1 | 79 | 74 | 95 s | pass | pass |
| cake | queue_prefix | 5 | 3 | 35 | 25 | 50 s | pass | pass |
| hard | audit_undo | 2 | 10 | 275 | 178 | 363 s | pass | pass |
| hell | avl_leaderboard | 7 | 3 (+7 on a scratch copy) | 630 | 386 | 433 s | pass | pass |

### What the run shows

- **Failures and fixes.** Gate failures were all local: one affine-use error,
  one parse error at a typed header, and the hard tier's need to use a
  well-formedness proof twice. The agents fixed each from the checker's message.
- **Proof size.** Agent proofs ran 0.8x to 1.6x the length of Bend's own
  reference solutions. The hell-tier proof needed about 30 helper lemmas.
- **Implementation synthesis.** In cake and firm, some "laws" ask for a function
  that satisfies them (`trim`, `timeline`). The agent wrote the implementation
  and its proof together.

## Threats to validity

- Five tasks with one seed each. A tier label is the eval author's difficulty
  ranking, not a measured one.
- The evals are self-contained proof puzzles with stated laws. They test
  whether an agent can produce proofs, not whether laws match intent.
- The agents were Claude Code subagents of the same model family as the
  coordinator, not the Claude API with a fixed harness.
