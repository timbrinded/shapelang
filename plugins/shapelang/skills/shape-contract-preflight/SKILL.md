---
name: shape-contract-preflight
description: >-
  This skill should be used before editing code to map a concrete planned
  change onto an existing Shape model, identify constraints, obligations,
  source anchors, coverage, and bindings, and optionally simulate a
  conservative temporary contract change. Do not use it for post-change
  review, whole-repository modeling, or source-to-model drift.
---

# Shape Contract Preflight

## Boundary

Orient implementation work against the current authored model before code changes begin. A temporary `change` block tests model coherence only; it does not prove that future source edits will implement the proposal.

## Shape Evidence Contract

- Treat authored Shape as typed architecture claims, not proof of source behavior.
- Treat generated AST and analyzer output as navigation leads only.
- Source-confirm implementation claims.
- Use stable `file#symbol` references for source and evidence when a symbol exists; use file-only references only when there is no stable symbol.
- Keep final forbids final.
- Preserve unresolved effects as `effects unknown`.
- Finish simulations with the current deterministic checker.

Resolve the repository's Shape command once, verify it with `--version`, and reuse it consistently.

## Modes

- `orientation`: identify relevant symbols, constraints, source refs, model gaps, and likely obligations. Do not create a temporary change.
- `contract-simulation`: check a temporary `change` block against a separately validated current model.

Stay in `orientation` when expressing the proposal would require inventing resources, effects, relations, or exact changed paths.

## Input Contract

Record before simulation:

```text
Known:
- exact target symbols
- intended add, modify, or remove operations
- exact source paths, when supplied
- explicitly intended effects

Assumed:
- facts inferred from task wording
- likely but unconfirmed relations or changed paths

Unknown:
- implementation effects not supported by current evidence
- architecture decisions that materially change the contract
```

Only `Known` material effects may enter `effects complete`. Keep assumptions and unknowns explicit or remain in `orientation`.

## Outcome Completeness

Trace the requested outcome end to end before simulating it. A simulation may return `proceed` only when every architecture-significant leg required to produce that outcome is represented by the baseline or the proposal.

- Model silence is not permission to omit a necessary leg.
- If an exact necessary leg is absent from the baseline, include it in the temporary proposal when its endpoints and relation kind are known.
- If a necessary leg requires invention, return `model_gap` only when no current contract already rejects the requested outcome.
- Never simulate only a safe facade when the requested outcome necessarily depends on a forbidden downstream route.

## Workflow

1. Locate candidate symbols in authored `.shape` files using task vocabulary and stable source/evidence anchors.
2. Run focused `explain` and `graph show` queries for those symbols.
3. Run `memory` and `obligations` only when guards, rationale, reevaluation, roles, approval, or freshness are relevant.
4. Inspect only source named by authored declarations, implementations, bindings, or generated navigation anchors.
5. Record candidates in an evidence ledger and close, disprove, defer, or block each one.
6. Forecast coverage and bindings only from exact planned paths. Label inferred paths as a forecast.
7. Trace the complete requested outcome and identify every necessary architecture-significant leg.
8. Select `contract-simulation` only when the complete intended contract change can be expressed conservatively.
9. Read `references/change-blocks.md`, create the temporary file outside tracked source, and run `scripts/precheck.sh`.

When a proposal or recommended final update names implementation behavior, carry the stable `source` anchor and matching effect `evidence` into the declaration. Do not shorten `file#symbol` to a file-only reference when the symbol is known.

The helper must validate the strict baseline first. If it reports `baseline_invalid`, do not attribute those diagnostics to the proposal.

Use draft simulation when explicit unknown effects remain:

```bash
SHAPE_CMD="<SHAPE_CMD>" scripts/precheck.sh --json proposal.shape
```

Use strict simulation only when the proposal contains no unknown effects:

```bash
SHAPE_CMD="<SHAPE_CMD>" scripts/precheck.sh --strict --json proposal.shape
```

Never remove a final forbid, invent a grant or effect, or add fake attestation/reevaluation content to make the simulation pass.

## Decisions

Return exactly one decision:

- `proceed`: the strict baseline is valid, the conservative proposal represents the complete requested outcome, and the applicable proposal check passes.
- `blocked_by_contract`: the proposal conflicts with a current deterministic contract.
- `architecture_decision_required`: two materially different supported architectures remain.
- `model_gap`: missing model information prevents determining whether the current contract permits or represents the planned work.
- `baseline_invalid`: the current model fails before the proposal is added.
- `tooling_unavailable`: the canonical command or required files cannot be inspected.

## Output

```markdown
## Preflight Mode

orientation | contract-simulation

## Inputs

- Known: ...
- Assumed: ...
- Unknown: ...

## Relevant Shape Context

- Symbols and constraints: ...
- Relations: ...
- Guards and obligations: ...
- Coverage and bindings: ...

## Source To Inspect First

- ...

## Simulation

<Only for contract-simulation: proposal, resolved command, baseline result, proposal result.>

## Decision

proceed | blocked_by_contract | architecture_decision_required | model_gap | baseline_invalid | tooling_unavailable
```

## References

- `references/change-blocks.md`: conservative temporary-change rules and helper behavior.
- `references/examples.md`: current-CLI task and result patterns.
