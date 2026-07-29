---
name: shape-contract-guard
description: >-
  This skill should be used to compare a base and candidate authored Shape
  contract for semantic loosening that may remain checker-valid. Review
  `.shape` and vendored-pack changes only. Do not use it for application-code
  bugs, source-to-model drift, or whole-repository modeling.
---

# Shape Contract Guard

## Boundary

Review authored Shape contract diffs and return advisory semantic risk. Keep deterministic checker diagnostics separate. Do not read application source.

Read changed paths only for coverage, binding, and attestation context. Exclude `shape/generated/ast/**` from contract scoring. Treat source-controlled vendored `.shape` packs as active policy under default discovery.

## Shape Evidence Contract

- Treat authored Shape as typed architecture claims, not proof of source correctness.
- Treat generated AST and analyzer output as investigation leads only.
- Keep final forbids final.
- Preserve explicit uncertainty.
- Use exact before/after declarations and current checker output.

Resolve the repository's Shape command once, verify it with `--version`, and reuse it consistently.

## Change Ledger

Normalize each semantic root change before classification:

```text
Change:
  symbol:
  before fact:
  after fact:
  replacement:
  semantic impact:
  supporting decision evidence:
  status: open | verified | disproved | blocked
```

Before retaining a change, check for:

- relocation of the same declaration;
- rename with equivalent semantics;
- an equal or stronger replacement constraint;
- formatter-only or ordering-only churn;
- several textual edits representing one semantic root cause.

## Workflow

1. Resolve the user-provided comparison, otherwise the merge base with upstream or the normal default branch. Include staged and unstaged authored edits for local review.
2. Build an exact newline-delimited changed-file list without switching the worktree.
3. Inspect the authored `.shape` diff, base content for deletions, and candidate declarations outside generated AST.
4. Run `<SHAPE_CMD> check --changed-files <list>` when the changed list exists; otherwise run static `check`.
5. Present deterministic diagnostics separately.
6. Inspect the exact changed declaration, then focused `explain` and `graph show` output for touched symbols.
7. Run `memory` and `obligations` only for guarded context. Run global graph output only when focused incidence cannot resolve a global path or rule.
8. Read `references/signals.md`, complete the change ledger, and return one structured result.

Do not use rationale as a semantic-impact discount. Specific support changes the disposition, not the magnitude of removing a boundary.

## Classification

- `impact`: `high | medium | low`
- `support`: `none | generic | specific`
- `disposition`: `suspicious | supported | tightening | informational`

Use `supported`, never `necessary`, for an intentional loosening. Guard normally cannot establish necessity without implementation evidence.

The host decides enforcement. The skill must not claim that advisory interpretation is a checker diagnostic.

## Canonical Result

Return this JSON shape for automation. Interactive Markdown may render these exact fields without changing their meaning.

```json
{
  "status": "pass | advisory | error",
  "summary": "Concise result.",
  "findings": [
    {
      "impact": "high | medium | low",
      "support": "none | generic | specific",
      "disposition": "suspicious | supported | tightening | informational",
      "signal": "constraint-removal",
      "symbol": "AuditEvent",
      "before": "resource AuditEvent : AppendOnly",
      "after": "resource AuditEvent",
      "replacement": "",
      "evidence": "Exact authored diff evidence.",
      "model_context": "Relevant declared context.",
      "recommended_action": "Restore or replace the constraint, or supply specific review evidence."
    }
  ]
}
```

Use `pass` only with an empty findings array. Do not emit tightening as a risk finding unless the user requests an inventory of all material changes.

## References

- `references/signals.md`: impact, support, disposition, and signal taxonomy.
- `references/examples.md`: normalized before/after calibration cases.
