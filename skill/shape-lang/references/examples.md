# Examples

Use these as compact patterns. Prefer current project fixtures if there is any conflict.

## Contents

- [Good Examples](#good-examples)
- [Counterexamples](#counterexamples)

## Good Examples

Resource, component, grant, and effect:

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

Global model update with explicit unknowns:

```shape
module audit

component AuditStore {
  fn reviewPurgeShape1
    source ts("src/audit/purge.ts")
    effects unknown
}
```

Coverage attestation for a governed non-architecture change:

```shape
attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Reporting-only copy change; no resource effect changed."
}
```

Structural relations and a hypercycle rule:

```shape
component Api {
}
component Worker {
}

relation ApiCallsWorker {
  kind calls
  connects Api -> Worker
}

relation WorkerCallsApi {
  kind callbacks
  connects Worker -> Api
}

rule no_runtime_control_cycle {
  forbid hypercycle over calls or callbacks
}
```

Preserve inline with rationale:

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

Refactor-sensitive memory with guard:

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

Reevaluation for a guarded change:

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

Component-level shape-trait obligation (also works for `resource`):

```shape
component Gateway : RefactorSensitive {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
}

memory GatewayBoundary : RefactorConstraint<component Gateway> {
  applies_to component Gateway
  status Unexplained
  confidence High
  summary "The Gateway boundary isolates policy evaluation."
  owner GatewayTeam
}
```

Project-defined obligation with `require_context`:

```shape
trait PreserveLocal<T: Fn> {
  require_context LocalRationale<T> satisfied_by rationale or memory
}
```

Transform guard requiring review before a named refactor:

```shape
memory RenameGuard : DesignRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Explained
  confidence High
  summary "Public symbol name is referenced by external dashboards."
  owner GatewayTeam
  guards forbid transform RenameSymbol
}
```

Sensitive memory under an approver policy, with a reevaluation that names an approver:

```shape
role Security
role GatewayTeam

policy ReviewPolicy {
  require approver
}

memory DecisionConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  sensitive
  summary "Security-sensitive decision path."
  owner GatewayTeam
  guards on_change require ReEvaluation<Self>
}

reevaluation DecisionReviewed {
  satisfies memory DecisionConstraint
  outcome Confirmed
  summary "Reviewed and confirmed; behaviour preserved."
  evidence test("gateway/decision.test.ts")
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
}
```

Design memory with a freshness deadline (enforced only under `--strict-freshness`):

```shape
memory BridgeDelayConstraint : RefactorConstraint<fn BridgePoller.pollAttestation> {
  applies_to fn BridgePoller.pollAttestation
  status Unexplained
  confidence High
  summary "Lowering this delay previously caused settlement failures."
  owner BridgeTeam
  review_by "2026-01-01"
}
```

Analyzer-backed effect after review:

```shape
HardDelete<AuditEvent>
  evidence ts("src/audit/purge.ts:12-16")
```

## Counterexamples

Unknown work falsely marked complete:

```shape
fn reviewPurgeShape1
  source ts("src/audit/purge.ts")
  effects complete {
  }
```

Broad grant added just to pass a diagnostic:

```shape
component AuditStore {
  owns AuditEvent
  grants HardDelete<AuditEvent>
}
```

Memory used as a waiver:

```shape
memory PurgeDeleteConstraint : RefactorConstraint<fn AuditStore.purgeOldEvents> {
  applies_to fn AuditStore.purgeOldEvents
  status Explained
  summary "Approved exception."
}
```

Guarded model update without reevaluation:

```shape
component Gateway {
  fn derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Attestation hiding a real model update:

```shape
attest no_shape_change {
  source ts("src/audit/purge.ts")
  reason "No shape update needed."
}
```

Sensitive memory reevaluated without an approver under an approver policy:

```shape
reevaluation DecisionReviewed {
  satisfies memory DecisionConstraint
  outcome Confirmed
  summary "Reviewed."
  evidence test("gateway/decision.test.ts")
  reviewer GatewayTeam
  decided_on "2026-06-02"
}
```

Analyzer treated as authoritative:

```text
Analyzer hinted HardDelete, so no source review is needed.
```
