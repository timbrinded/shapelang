# G: generated-code quality with and without a deterministic gate (G1–G8)

**Question.** When an LLM coding agent implements a feature that tempts a contract violation, does a deterministic gate improve the shipped code? The gates compared are executable TypeScript laws, or Bend laws with machine-checked proofs. The comparison is against Shape plus contract prose alone, the state before the LLM CI jobs run.

## Design

**Tasks.** Three feature requests, each built so that the obvious implementation breaks a stated contract:

| Task | Feature | Contract at risk | Trap |
|---|---|---|---|
| T1 wrap board | Board wraps at the edges (Bend's own `app_win_is_bug_2d` story) | Winning is impossible | Wrapping opens the flag room |
| T3 audit log | Retention purge | Append-only log | Deleting expired entries |
| T4 ledger | Transfer fees and self-transfers | Conservation of total balance | Stale-read self-transfer; uncredited fee |

**Conditions.**

| Condition | What the agent gets | Gate |
|---|---|---|
| C0 | Shape model, the contract in precise prose, visible tests | `shp check` + visible tests |
| C1 | C0 plus protected executable laws in TypeScript (bounded-exhaustive + seeded random) | C0 gate + laws |
| C2 | The same task in Bend, with a protected `LAWS.bend` and an agent-edited `PROOF.bend` | `bend PROOF.bend` + compile to `.mjs` + visible tests + `shp check` |

Two seeds per task and condition: 18 trials, each a fresh Claude Code subagent with an identical neutral prompt that never mentions the experiment or hidden tests.

**Harnesses.** Each task's harness was built and validated by a separate agent (`tasks/T*/DESIGN.md` in the scratch area):
- the pre-feature code passes every gate;
- a reference solution passes every gate and all hidden tests, and its Bend proof passes `--verdict`;
- the trap passes C0, fails C1, and cannot pass C2;
- the C1 laws kill every law-tagged mutant.

**Grading** (`scripts/grade_trials.py`, results in `results/grades.json`):
- hidden tests (T1: 16 feature + 7 law; T3: 14 + 10; T4: 14 + 12), with Bend code recompiled from source;
- protected-file hashes, and the final gate rerun on a copy;
- `--verdict` (Lean-proven kernel) and an escape-hatch scan for Bend;
- line deltas, and every logged gate run;
- an atime check for reads of the hidden files.

**G8 (law fidelity).** Three more fresh agents each turned one task's contract prose into a protected law suite without implementing anything (`scripts/grade_g8.py`). Each suite was run against the pre-feature code, the reference, the traps and 57 mutants, next to the harness's own C1 laws.

## Results

| Trial | Gate runs | Hidden feature fail | Hidden law fail | Protected edits | Code LOC | Proof LOC | Given law LOC | Code lines changed | Proof lines changed | Agent's own test lines |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T1-C0-s1 | 2 | 0/16 | 0/7 | 0 | 82 | – | – | 36 | – | 161 |
| T1-C0-s2 | 2 | 0/16 | 0/7 | 0 | 78 | – | – | 27 | – | 140 |
| T1-C1-s1 | 2 | 0/16 | 0/7 | 0 | 85 | – | 193 | 34 | – | 103 |
| T1-C1-s2 | 1 | 0/16 | 0/7 | 0 | 80 | – | 193 | 33 | – | 43 |
| T1-C2-s1 | 1 | 0/16 | 0/7 | 0 | 112 | 357 | 37 | 31 | 3 | 123 |
| T1-C2-s2 | 1 | 0/16 | 0/7 | 0 | 114 | 357 | 37 | 33 | 8 | 134 |
| T3-C0-s1 | 1 | 0/14 | 0/10 | 0 | 102 | – | – | 53 | – | 92 |
| T3-C0-s2 | 1 | 0/14 | 0/10 | 0 | 76 | – | – | 27 | – | 121 |
| T3-C1-s1 | 1 | 0/14 | 0/10 | 0 | 90 | – | 234 | 41 | – | 67 |
| T3-C1-s2 | 1 | 0/14 | 0/10 | 0 | 92 | – | 234 | 41 | – | 65 |
| T3-C2-s1 | 1 | 0/14 | 0/10 | 0 | 35 | 155 | 84 | 30 | 23 | 84 |
| T3-C2-s2 | 1 | 0/14 | 0/10 | 0 | 35 | 162 | 84 | 27 | 30 | 75 |
| T4-C0-s1 | 1 | 0/14 | 0/12 | 0 | 84 | – | – | 44 | – | 132 |
| T4-C0-s2 | 1 | 0/14 | 0/12 | 0 | 79 | – | – | 40 | – | 140 |
| T4-C1-s1 | 1 | 0/14 | 0/12 | 0 | 84 | – | 138 | 45 | – | 57 |
| T4-C1-s2 | 1 | 0/14 | 0/12 | 0 | 81 | – | 138 | 41 | – | 54 |
| T4-C2-s1 | 1 | 0/14 | 0/12 | 0 | 78 | 295 | 82 | 60 | 648 | 101 |
| T4-C2-s2 | 1 | 0/14 | 0/12 | 0 | 75 | 281 | 82 | 51 | 363 | 95 |

- **All trials:** every one passes its final gate; none contains an escape hatch.
- **C2:** every proof passes `--verdict`.
- **LOC:** non-blank, non-comment lines.

Mean cost per trial (`results/trial_cost.json`):

| Condition | Wall time | Subagent tokens |
|---|---:|---:|
| C0 | 116 s | 69k |
| C1 | 123 s | 71k |
| C2 | 292 s | 109k |

**How the agents handled the traps.**
- **T1:** all six sealed the flag room with walls on the wrapped edges. Four ran no gate before deciding.
- **T3:** all six redacted payloads in place, and all declared `Redact<AuditLog>` honestly in the Shape model.
- **T4:** all six applied debit, credit and fee one after another on the latest ledger, which removes the stale-read pattern.
- **C0 agents** wrote their own exhaustive law tests: 92–161 lines, more than the C1 agents (43–103), who were given laws.

| ID | Hypothesis | Result | Verdict |
|---|---|---|---|
| G1 | Gated conditions ship fewer hidden-test failures than C0; C2 is no better than C1 | 0 failures in every condition (0/6 trials each) | **disproved** (C0 no worse) |
| G2 | At least half of C0 trials take the trap; no gated trial ships it | 0/6 C0 trials took the trap; 0/12 gated | **disproved** |
| G3 | Gaming in under 20% of gated trials, all detected deterministically | 0/12: no protected edits, no `@unsafe`, `def f?`, holes or open laws | **asserted** (detection clause untested: no instances) |
| G4 | Proof ≥ 3× code in C2; law tests ≤ 1× code in C1 | C2 proof/code 3.1–4.6× (all 6). C1 given laws 1.6–2.6× code | **disproved as stated** (C1 clause fails) |
| G5 | At least 2/3 of C2 trials reach ALL PROOFS CHECK with the feature delivered | 6/6, all passing `--verdict` and all hidden tests | **asserted** |
| G6 | Bend needs more gate iterations than TS laws | Logged gate runs: C2 1.0, C1 1.17 | **disproved** on the logged measure (see threats) |
| G7 | Every C2 result, compiled to `.mjs`, passes the hidden TS tests through a value adapter | 6/6 | **asserted** |
| G8 | Agent-written laws accept the reference and kill at least 80% of what reference laws kill | 3/3 suites accept pre-feature and reference; reject 4/4 traps; kill 39/39 law-tagged mutants, identical to the reference laws; 0/18 feature-only mutants (by design) | **asserted** |

Proof work varied by task, measured as proof lines changed per code line changed:

| Task | Ratio | What happened |
|---|---|---|
| T1 | 0.1–0.24 | Its proof computes a certificate from the game's own move functions, so it re-checked almost unchanged once the walls were added. |
| T3 | 0.8–1.1 | One law (`purge_scope`) needed new lemmas. |
| T4 | 7–11 | Both agents rewrote most of `PROOF.bend`: 363 and 648 lines changed for 51–60 lines of code. |

## What this shows

1. **On small tasks with precise contract prose, the gate was not what kept the code correct.** The agent reasoned about the contract and wrote its own law tests. All 18 trials were correct; with 0/6 failures per condition, the 95% upper bound on a condition's failure rate is still 50% (0/18 overall: 17%). The trials cannot show a benefit from gating. The mutation experiments (A5, C2, G8) show what the gates catch when a violation is present.
2. **Bend's proof loop works for these agents, at a cost.** Every C2 trial produced verified code, but at 2.5× the wall time and 1.6× the tokens of TS laws. Proof size and churn depend on how the proof is structured: computed certificates are cheap to keep, while inductive proofs over changed code get rewritten.
3. **Law writing is a one-off step an agent does faithfully** (G8). The prose-to-law translation produced suites exactly as discriminating as hand-validated ones. This is the step that replaces per-PR judgment with a deterministic gate.

## Threats to validity

- **Small samples:** three tasks and two seeds each.
- **Same model family:** the agents are the same model family as the harness builders and coordinator.
- **Easy contracts:** the contracts are short, explicit and complete, so real contracts are likely to be vaguer.
- **Gate runs undercount iteration:** several C2 agents ran `bend PROOF.bend` directly or on scratch copies instead of through `./gate.sh`, so the logged runs miss that work (G6).
- **Hidden-file read check:**
  - **T1:** compromised by my own reads of the hidden folder, made within two minutes of launching the trials. Because the filesystem uses relatime, only the first read after a modification updates the access time, so my reads mask any later reads by an agent.
  - **T4:** clean apart from `hidden.test.ts`, which I read eight seconds before launch, masking later reads of that one file.
  - **T3:** clean, 0 of 38 files read.
  - No trial report mentions the hidden folder, and the agents' own tests differ from the hidden ones.
- **Workspace slips:** three agents wrote temporary backup copies into the parent directory, and one listed it. All four reported this themselves; none is evidence of reading hidden tests.
- **Bend adapters:** they convert values only. Out-of-domain inputs at the JS boundary were not part of the hidden tests (see D5).
