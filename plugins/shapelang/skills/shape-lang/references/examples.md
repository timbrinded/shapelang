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
        evidence ts("src/audit/store.ts#appendEvent")
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

Forbidden multi-hop path:

```shape
resource RestrictedStore

component RequestHandler {
}

component DecisionEngine {
}

relation RequestHandlerCallsDecision {
  kind calls
  connects RequestHandler -> DecisionEngine
}

relation DecisionProvidesRestrictedRecord {
  kind provides
  connects DecisionEngine -> RestrictedStore
}

rule no_request_handler_to_restricted_store {
  forbid path RequestHandler -> RestrictedStore over calls or provides
}
```

Vendored domain-pack trait:

```shape
module domain.audit.v1

trait DurableAudit<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final HardDelete<T>
}
```

A consumer imports the trait for an unqualified reference and applies it:

```shape
module checkout

import domain.audit.v1

resource CheckoutAudit : DurableAudit
```

The vendored module was already active under default discovery. The import did
not activate it.

Preserve inline with rationale:

```shape
rationale BuildDecisionInline : InlineRationale<fn RequestHandler.buildDecision> {
  applies_to fn RequestHandler.buildDecision
  why CognitiveLocality
  summary "Decision checks remain inline for auditability."
  who { owner RuntimeTeam }
}
```

Refactor-sensitive memory with guard:

```shape
memory DecisionRefactorConstraint : RefactorConstraint<fn RequestHandler.buildDecision> {
  applies_to fn RequestHandler.buildDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  who { owner RuntimeTeam }
  guards { on_change require ReEvaluation<Self> }
}
```

Reevaluation for a guarded change:

```shape
reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer RuntimeTeam
  decided_on "2026-06-02"
  evidence test("runtime/error-normalisation.test.ts")
}
```

Component-level shape-trait obligation (also works for `resource`):

```shape
component RequestHandler : RefactorSensitive {
  owns DecisionState
  grants Read<DecisionState>
}

memory RequestHandlerBoundary : RefactorConstraint<component RequestHandler> {
  applies_to component RequestHandler
  status Unexplained
  confidence High
  summary "The RequestHandler boundary isolates policy evaluation."
  who { owner RuntimeTeam }
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
memory RenameGuard : DesignRationale<fn RequestHandler.buildDecision> {
  applies_to fn RequestHandler.buildDecision
  status Explained
  confidence High
  summary "Public symbol name is referenced by external dashboards."
  who { owner RuntimeTeam }
  guards { forbid transform RenameSymbol }
}
```

Sensitive memory under an approver policy, with a reevaluation that names an approver:

```shape
role Security
role RuntimeTeam

policy ReviewPolicy {
  require approver
}

memory DecisionConstraint : RefactorConstraint<fn RequestHandler.buildDecision> {
  applies_to fn RequestHandler.buildDecision
  status Unexplained
  confidence High
  sensitive
  summary "Security-sensitive decision path."
  who { owner RuntimeTeam }
  guards { on_change require ReEvaluation<Self> }
}

reevaluation DecisionReviewed {
  satisfies memory DecisionConstraint
  outcome Confirmed
  summary "Reviewed and confirmed; behaviour preserved."
  evidence test("runtime/decision.test.ts")
  reviewer RuntimeTeam
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
  who { owner BridgeTeam }
  when { review_by "2026-01-01" }
}
```

Analyzer-backed effect after review:

```shape
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
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
component RequestHandler {
  fn buildDecision
    effects complete {
      Read<DecisionState>
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

Unstable numbered source reference:

```shape
source ts("src/audit/store.ts:42-61")
```

Smallest fix: use `src/audit/store.ts#appendEvent`, or the file alone when no
durable symbol exists.

Generated candidate promoted without review:

```text
The generated AST suggests HardDelete, so copy it into effects complete.
```

Smallest fix: inspect the source path and symbol, confirm every material effect,
then author the reviewed claim with stable evidence.

Sensitive memory reevaluated without an approver under an approver policy:

```shape
reevaluation DecisionReviewed {
  satisfies memory DecisionConstraint
  outcome Confirmed
  summary "Reviewed."
  evidence test("runtime/decision.test.ts")
  reviewer RuntimeTeam
  decided_on "2026-06-02"
}
```

Analyzer treated as authoritative:

```text
Analyzer hinted HardDelete, so no source review is needed.
```
