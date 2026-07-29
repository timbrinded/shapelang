---
name: shape-review
description: >-
  This skill should be used to review a concrete code diff for real reachable
  bugs, combining complete local review with focused authored-Shape
  investigation. Do not use it for pure model drift, authored contract-diff
  risk, style preferences, or speculative architecture concerns.
---

# Shape Review

## Boundary

Review changed code first, then use authored Shape to find concrete bugs that a diff-only review may miss. Keep pure source-to-model drift out of code-bug comments.

## Shape Evidence Contract

- Treat authored Shape as typed architecture evidence, not proof of implementation behavior.
- Treat generated relations and analyzer output as investigation leads only.
- Source-confirm every Shape-derived candidate.
- Do not infer safety or defects from model silence.
- Keep checker diagnostics separate from reachable code bugs.

Resolve the repository's Shape command once, verify it with `--version`, and reuse it consistently.

## Evidence Ledger

```text
Candidate:
  changed line:
  concrete trigger:
  observable incorrect outcome:
  authored fact and discovery command:
  source confirmation:
  plausible prevention mechanism:
  prevention evidence:
  status: open | verified | disproved | blocked
```

Every retained finding must include the changed line, reachable trigger, and observable incorrect result. For Shape-derived candidates, also include the exact authored fact, discovery command, and source confirmation.

## Workflow

1. Read every changed hunk and its immediate implementation context. Record plausible correctness, security, data, lifecycle, concurrency, and API-contract defects.
2. Do not suppress local bugs because Shape has no relevant claim.
3. Run `<SHAPE_CMD> check --changed-files <list>` when an exact changed-file list exists; otherwise run static `check`.
4. Classify checker diagnostics as `introduced`, `pre-existing`, or `unclassified` only when evidence supports that classification. Do not convert diagnostics directly into code comments.
5. Run focused `explain` for architecture-significant changed symbols.
6. Run `graph show SYMBOL` without a kind filter first. Filter only when incidence is noisy or a specific rule requires one kind.
7. Run `memory` and `obligations` only for guarded targets, permissions, ownership, atomicity, or final forbids.
8. Run `analyze` only as a source-investigation lead.
9. Expand by default only to direct authored relations, direct callers/callees, or one explicit coordinated path. Traverse wider only when an authored rule or concrete evidence requires it.
10. Challenge every candidate with one plausible existing prevention mechanism and verify that it is absent or insufficient.
11. Drop handled, unreachable, stale-model, duplicate, stylistic, or speculative candidates.

Run graph statistics only when the model is unfamiliar, the relationship spans several subsystems, graph size affects the investigation, or a global rule/hypercycle matters.

## Output

Return code bugs and model maintenance warnings separately:

```json
{
  "comments": [
    {
      "path": "relative/file.ext",
      "line": 42,
      "body": "Concrete defect, trigger, and outcome."
    }
  ],
  "shape_model_warnings": [
    {
      "shape_source": "shape/foo.shape",
      "symbol": "Foo.bar",
      "reason": "Source-confirmed explanation of why the authored claim is stale."
    }
  ]
}
```

Use one issue per comment. Cite Shape discovery naturally in cross-object findings without dumping internal reasoning.

When no result survives verification, return exactly:

```json
{"comments":[],"shape_model_warnings":[]}
```
