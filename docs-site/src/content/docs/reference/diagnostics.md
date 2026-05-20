---
title: Diagnostics Catalog
description: Common Shape diagnostics and what they mean.
sidebar:
  order: 3
---

Shape diagnostics should name the failed claim and show the causal path behind it.

## Forbidden effect

Cause: a function emits an effect forbidden by a resource trait or rule.

```text
error: forbidden effect
AuditStore.purgeOldEvents
HardDelete<AuditEvent>
AppendOnly forbids final HardDelete<AuditEvent>
```

Fix the model by removing the effect, changing the architecture decision, or moving the behavior to a component/resource where the effect is allowed.

## Missing grant

Cause: a function emits an effect that its component does not grant.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

Add the correct grant only if the component is actually allowed to contain that effect.

## Unknown effects

Cause: a function declares `effects unknown` where the project requires explicit effect summaries.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  fn importLegacyEvents
    effects unknown
}
```

Replace unknowns with a source-backed `effects complete` block before accepting protected changes.

## Governed source changed without Shape update

Cause: a changed source path matches an implementation block with `on_change require shape_delta`, but the PR did not include a matching Shape update or current attestation.

Run coverage with the changed-file list to reproduce it:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
```

## Bound docs change missing

Cause: a `binding` declaration says that one changed path requires another changed path, but the required path was not present in the changed-file list.

```shape
module repo

binding CheckerDocs {
  when_changed paths {
    "packages/shp-checker/src/checker.ts"
  }
  require_changed paths {
    "docs-site/src/content/docs/reference/diagnostics.md"
  }
  allow attest docs_not_needed
}
```

If `packages/shp-checker/src/checker.ts` changes, the docs path must also change or the PR must include a narrow current attestation in a `.shape` file changed by the same PR:

```shape
module repo

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal refactor only; no diagnostics or documented behavior changed."
}
```

Bindings are review gates. They ensure docs are considered when Shape-affecting code or model files change.

## Invalid change target

Cause: a change block tries to modify or remove a function that is not present in the effective model.

## Duplicate function or implementation

Cause: the same function name appears twice in a component, or an implementation name is reused. Shape rejects these because otherwise one declaration can silently overwrite or shadow another.

## Unresolved dependency

Cause: a component declares `requires Target`, but `Target` is neither a component nor a target provided by another component.

## Unsupported rule shape

Cause: a rule uses a syntax shape the checker does not currently implement semantically. For example, multiple `when` clauses are rejected until conjunctive rule semantics are designed.

## Missing required context

Cause: a function has a shape trait such as `PreserveInline`, `RefactorSensitive`, or `NonIdiomatic`, but no matching `rationale` or `memory` exists for that function target.

```text
error: missing required context

fn Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.

No matching rationale or memory found.
```

Add a typed `rationale` or `memory` that applies to the same target. Do not add generic prose.

## Missing required description

Cause: a function has `RequiresDescription`, or declares `description required`, but does not include a non-empty description.

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : RequiresDescription
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Add a compact `description required "..."` and the matching `DescriptionRationale`.

## Invalid context target

Cause: a `rationale` or `memory` points at a function, component, resource, implementation, or rule that does not exist in the loaded model.

Fix the target name, or add the missing target declaration before relying on the context.

## Context target mismatch

Cause: the context type target and `applies_to` target disagree.

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
  fn otherDecision
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.otherDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

Make the type target and `applies_to` target identical.

## Guarded shape changed

Cause: a `modify fn` or `remove fn` touched a function protected by `guards on_change require ReEvaluation<Self>`, but no valid reevaluation satisfies that memory or rationale.

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DecisionRefactorConstraint.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DecisionRefactorConstraint
  or preserve the protected shape.
```

Add a `reevaluation` with review evidence, or avoid changing the protected function shape.

## Invalid reevaluation

Cause: a `reevaluation` is incomplete or satisfies a memory/rationale that does not exist.

A valid reevaluation needs a known `satisfies` target plus `outcome`, `summary`, `evidence`, `reviewer`, and `decided_on`.

## Design memory does not waive final forbids

If a function emits an effect rejected by a final forbid, adding `rationale`, `memory`, or `reevaluation` does not make the model pass. Fix the effect claim or the architecture policy directly.
