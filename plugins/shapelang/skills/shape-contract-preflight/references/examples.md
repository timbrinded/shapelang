# Preflight Examples

Use these current-CLI cases to calibrate concise planning briefs.

## Guarded Refactor With Unknown Effects

Task:

```text
Refactor RequestHandler.buildDecision without changing behavior.
```

Record the function as known, likely implementation details as assumptions, and effects as unknown until source inspection. Run focused `explain`, `graph show`, `memory`, and `obligations`.

Simulate:

```shape
module preflight

change RefactorDecision {
  modify fn RequestHandler.buildDecision
    effects unknown
}
```

Return `blocked_by_contract` if the valid baseline plus proposal reports an unsatisfied guard. Draft unknown-effect allowance does not weaken that obligation.

## Invalid Baseline

When strict baseline checking already fails, return:

```text
decision: baseline_invalid
```

Include the baseline diagnostics and do not attribute them to the proposed change.

## Destructive Effect Against Final Rule

Task:

```text
Add purgeExpired to delete old audit events.
```

Simulate the source-supported `HardDelete<AuditEvent>` effect. Return `blocked_by_contract` when the current model derives a final forbid.

Do not propose removing the final forbid as a simulation fix.

## Complete Multi-Leg Outcome

Task:

```text
Preflight a workflow whose requested outcome crosses several declared endpoints.
```

List every architecture-significant leg needed to produce the outcome before creating a proposal. Include a missing leg only when its endpoints and relation kind are known. If any required leg would need to be invented, return `model_gap`. Do not treat a checker-valid partial route as evidence that the complete outcome may proceed.

Return `architecture_decision_required` only when two source-supported architectures remain and have materially different contract consequences. Return `blocked_by_contract` when the complete supported outcome conflicts with a current final rule.

## Exact Coverage Forecast

Task:

```text
Move the parser entrypoint to packages/shp-checker/src/parser/index.ts.
```

When that exact path and the governing implementation are known, report the expected implementation and binding updates. When the implementation symbol or destination is inferred, stay in orientation and label coverage as a forecast.

When authoring or recommending the final declaration, preserve a stable symbol anchor:

```shape
source ts("packages/shp-checker/src/parser/index.ts#parseShapeModule")
```

Use the same stable anchor as effect evidence when it supports the effect. Use a file-only reference only when the target has no stable symbol.

## Thin Model

Task:

```text
Change the UI copy for the settings page.
```

Return `model_gap` only when the model is expected to cover the work but cannot locate it. For non-architecture-significant copy, state that normal repository inspection may proceed and no Shape update is implied by model silence.
