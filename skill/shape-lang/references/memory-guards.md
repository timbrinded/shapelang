# Memory Guards

Use this when working with shape traits, descriptions, rationales, memories, or reevaluations.

## Purpose

Memory Guards add typed design memory. They are restrictive: they add obligations and can block refactors. They are not waivers and must not make a final-forbidden effect pass.

## Shape Traits

Function shape traits derive obligations:

- `PreserveInline` requires `InlineRationale<fn Component.fn>`.
- `RequiresDescription` requires a non-empty `description` and `DescriptionRationale<fn Component.fn>`.
- `ProtectedCheckOrder` requires `CheckOrderRationale<fn Component.fn>` satisfied by rationale or memory.
- `RefactorSensitive` requires `RefactorConstraint<fn Component.fn>` satisfied by memory.
- `NonIdiomatic` requires `DesignRationale<fn Component.fn>` satisfied by rationale or memory.
- `TestOnly` requires `TestOnlyPurpose<fn Component.fn>`.

## Rationale

Use `rationale` for intentional, explainable shape choices:

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

## Memory

Use `memory` for refactor constraints, including uncertainty:

```shape
memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  owner GatewayTeam
  guards on_change require ReEvaluation<Self>
}
```

Use `status Unexplained` when the team knows a refactor constraint exists but cannot fully explain why yet.

## Reevaluation

A guarded `modify fn` or `remove fn` requires a matching reevaluation:

```shape
reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
```

A valid reevaluation must satisfy an existing memory/rationale and include outcome, summary, evidence, reviewer, and decided_on.

## Diagnostics To Expect

- Missing trait context: add matching rationale or memory.
- Missing required description: add `description required "..."`.
- Invalid context target: fix `InlineRationale<fn ...>` or `applies_to`.
- Guarded shape changed: add valid reevaluation or preserve the target.
- Forbidden effect: fix the effect/model; do not add memory as a waiver.
