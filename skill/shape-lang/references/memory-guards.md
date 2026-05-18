# Memory Guards

Use this when working with function shape traits, descriptions, rationales, memories, or reevaluations.

Memory Guards add typed design memory. They are restrictive: they add obligations and can block refactors. They are not waivers and must not make a final-forbidden effect pass.

## Contents

- [Obligation Table](#obligation-table)
- [Rationale](#rationale)
- [Required Description](#required-description)
- [Memory](#memory)
- [Reevaluation](#reevaluation)
- [Target Integrity](#target-integrity)
- [Final Forbids](#final-forbids)

## Obligation Table

| Function shape trait | Required context |
| --- | --- |
| `PreserveInline` | `InlineRationale<fn Component.fn>` from a `rationale` |
| `RequiresDescription` | non-empty `description` plus `DescriptionRationale<fn Component.fn>` |
| `ProtectedCheckOrder` | `CheckOrderRationale<fn Component.fn>` from a `rationale` or `memory` |
| `RefactorSensitive` | `RefactorConstraint<fn Component.fn>` from a `memory` |
| `NonIdiomatic` | `DesignRationale<fn Component.fn>` from a `rationale` or `memory` |
| `TestOnly` | `TestOnlyPurpose<fn Component.fn>` from a `rationale` |

## Rationale

Good: explain an intentional function shape with a typed target.

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

Counterexample: adding the trait without the required context.

```shape
fn derivePolicyDecision : PreserveInline
  effects complete {
    Read<PolicySnapshot>
  }
```

Smallest fix: add a matching `InlineRationale<fn Gateway.derivePolicyDecision>`.

## Required Description

Good: keep compact local purpose next to the function.

```shape
fn derivePolicyDecision : RequiresDescription
  description required "Builds the visible authorization decision from policy state."
  effects complete {
    Read<PolicySnapshot>
  }
```

Counterexample: empty required description.

```shape
fn derivePolicyDecision : RequiresDescription
  description required ""
  effects complete {
    Read<PolicySnapshot>
  }
```

Smallest fix: add a non-empty description and a matching `DescriptionRationale`.

## Memory

Good: preserve a refactor constraint, including explicit uncertainty.

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

Counterexample: vague memory that behaves like a waiver.

```shape
memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Explained
  summary "Known issue approved by team."
}
```

Smallest fix: state the specific refactor constraint or remove the memory.

## Reevaluation

Good: record review evidence for a guarded change.

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

Counterexample: incomplete reevaluation.

```shape
reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Looks fine."
}
```

Smallest fix: include `evidence`, `reviewer`, and `decided_on`, and make sure `satisfies` points to an existing memory or rationale.

## Target Integrity

Counterexample: type target and `applies_to` disagree.

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.otherDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

Smallest fix: make the context type target and `applies_to` target identical.

## Final Forbids

Counterexample: memory cannot rescue a final-forbidden effect.

```shape
fn purgeOldEvents : RefactorSensitive
  effects complete {
    HardDelete<AuditEvent>
  }

memory PurgeDeleteConstraint : RefactorConstraint<fn AuditStore.purgeOldEvents> {
  applies_to fn AuditStore.purgeOldEvents
  status Explained
  summary "This behavior is documented."
}
```

Smallest fix: fix the effect or policy. Do not use rationale, memory, or reevaluation as a waiver.
