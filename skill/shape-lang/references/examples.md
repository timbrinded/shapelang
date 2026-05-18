# Examples

Use these as compact patterns. Prefer current fixtures if there is any conflict.

## Resource, Component, Effects

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }
}
```

## Change File With Unknown Effects

```shape
module changes.PR_001

import audit

change ReviewAuditChange {
  add fn AuditStore.reviewPurgeShape1
    source ts("src/audit/purge.ts")
    effects unknown
}
```

## Preserve Inline With Rationale

```shape
component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : PreserveInline
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

## Refactor-Sensitive Function With Memory And Guard

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

## Reevaluation For Guarded Change

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

## Required Description

```shape
fn derivePolicyDecision : RequiresDescription
  description required "Policy decision branches remain local for auditability."
  effects complete {
    Read<PolicySnapshot>
  }
```
