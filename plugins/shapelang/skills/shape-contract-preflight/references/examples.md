# Preflight Examples

Use these current-CLI cases to calibrate concise planning briefs.

## Guarded Refactor With Unknown Effects

Task:

```text
Refactor Gateway.derivePolicyDecision without changing behavior.
```

Record the function as known, likely implementation details as assumptions, and effects as unknown until source inspection. Run focused `explain`, `graph show`, `memory`, and `obligations`.

Simulate:

```shape
module preflight

change RefactorPolicyDecision {
  modify fn Gateway.derivePolicyDecision
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

## Destructive Effect Against Final Policy

Task:

```text
Add purgeExpired to delete old audit events.
```

Simulate the source-supported `HardDelete<AuditEvent>` effect. Return `blocked_by_contract` when the current model derives a final forbid.

Do not propose removing the final forbid as a simulation fix.

## Forbidden Route

Task:

```text
Let Gateway obtain secrets through PolicyService.
```

Inspect focused incidence for `Gateway`, `PolicyService`, and `SecretStore`. Model the intended relation only when exact endpoints and relation kind are known.

Return `architecture_decision_required` only when two source-supported architectures remain and have materially different contract consequences. Otherwise return `blocked_by_contract` for a current final forbidden path.

## Exact Coverage Forecast

Task:

```text
Move the parser entrypoint to packages/shp-checker/src/parser/index.ts.
```

When that exact path and the governing implementation are known, report the expected implementation and binding updates. When the implementation symbol or destination is inferred, stay in orientation and label coverage as a forecast.

## Thin Model

Task:

```text
Change the UI copy for the settings page.
```

Return `model_gap` only when the model is expected to cover the work but cannot locate it. For non-architecture-significant copy, state that normal repository inspection may proceed and no Shape update is implied by model silence.
