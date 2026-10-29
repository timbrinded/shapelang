# M1 and M2: status at pause

**Paused:** 2026-10-29, after differential round 2's triage, at the user's request. The workflow (run `wf_5ae15bba-27b`) stopped as the round-2 spec rulings were starting. Resuming from its journal replays every finished step and continues from those rulings.

## Done

- **Settlement.** Annex section A.16 holds 37 settlements of the M0 spec problems, which corrected 15 frozen values. 7 problems were left open, as needing new decisions. 4 full-contract vectors were added, covering blob ids, pack pins, parse failure and manifest signatures. An independent review raised 26 issues, 7 of them must-fix, and the finaliser resolved all 7.
- **M1, prototype at version 7.** It passed its independent gate on the first attempt.
  - 21 of 21 golden outputs byte-identical.
  - 56 vectors (148 cases, 451 assertions) all pass.
  - H4: 31 correct, 0 wrong, 2 abstentions (renames without `was`).
  - `bun test`, typecheck and lint clean.
  - Re-checked after formatting at this checkpoint: goldens 21/21 and vectors 451/451.
- **M2 part 1, kernel definitions at version 7.** It passed its independent gate on the first attempt.
  - `lake build` is green, with no sorry or new axioms.
  - The version 6 proofs (Final, Laws, Loosen, Perm, Raise) are moved to `kernel/Pending/` for part 2.
  - `shapek` prints the complete core output, and its 21 golden outputs are byte-identical.
- **Version 7 differential harness** (`trials/DRT7/`):
  - 5,117 cases: 4,000 generated, 853 fixtures, 116 other fixtures and 148 vector cases;
  - every decision D1, D2, D4, D5, D6, D7, D9, D11, D12, D14 and D15 appears in at least 100 corpus cases.

## Differential gate

| Round | Residual (cases that differ) | Causes | Action |
|---|---:|---|---|
| 1 | 1,321 of 5,117 | 9 spec, 9 prototype, 14 kernel | 9 spec rulings (A.16), 17 prototype fixes, 22 kernel fixes |
| 2 | 46 of 5,117 (36 fragment, 10 clean; 0 in fixtures and vectors) | 15 causes: 7 prototype (36 cases), 4 spec (6), 3 kernel (6), 1 both (1). One prototype cause, an observability check over an unreadable base, accounts for 23 cases. | Paused before the rulings and fixes |

## Remaining

1. Round 2's rulings and fixes, then a re-run, aiming for 0 residual.
2. M2 part 2: re-prove the version 6 theorems now in `kernel/Pending/` for the version 7 definitions, plus the named version 7 theorems and `dfs_complete`.
3. The independent audit of the M1 and M2 exit criteria.
