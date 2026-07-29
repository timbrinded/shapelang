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

## Forbidden Route

Task:

```text
Let RequestHandler read RestrictedRecord through DecisionEngine.
```

Assume the baseline declares `RequestHandler`, `DecisionEngine`, and `RestrictedRecord`, but no route between them. The requested outcome requires both legs:

```shape
module preflight

change RestrictedRecordRoute {
  add relation RequestHandlerCallsDecision {
    kind calls
    connects RequestHandler -> DecisionEngine
  }
  add relation DecisionProvidesRestrictedRecord {
    kind provides
    connects DecisionEngine -> RestrictedRecord
  }
}
```

Simulate both relations when their endpoints and kinds are known. Do not simulate only `RequestHandler -> DecisionEngine`; that facade omits the necessary `DecisionEngine -> RestrictedRecord` leg and can hide the forbidden end-to-end path.

Return `architecture_decision_required` only when two source-supported architectures remain and have materially different contract consequences. Otherwise return `blocked_by_contract` for a current final forbidden path.

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
