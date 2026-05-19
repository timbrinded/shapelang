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

## Forbidden hypercycle

Cause: a `forbid hypercycle` rule found a directed cycle in the structural hypergraph. The diagnostic cites the relations forming the cycle and a vertex witness path. Each relation kind contributes steps to the cycle graph according to its declared traversal semantics (binary kinds contribute one step `A -> B`; ordered kinds contribute consecutive steps along their members).

```shape
module gateway

component Gateway {
}
component AuditStore {
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}

relation AuditCallsGateway {
  kind callbacks
  connects AuditStore -> Gateway
}

rule no_runtime_cycle {
  forbid hypercycle over calls or callbacks
}
```

```text
error: forbidden hypercycle

rule no_runtime_cycle rejects this hypercycle:
  calls GatewayCallsAudit
  callbacks AuditCallsGateway
witness: AuditStore -> Gateway -> AuditStore
```

Break the cycle by removing or redirecting one of the relations, or scope the rule to a different set of kinds with `forbid hypercycle over KIND`.

## Forbidden provides

Cause: a `forbid provides T except C` rule found a `provides` hyperedge that supplies `T` from a component other than the allowed one.

```shape
module gateway

resource JsonRpcEndpoint

component Gateway {
}
component Sidecar {
}

relation SidecarProvidesRpc {
  kind provides
  connects Sidecar -> JsonRpcEndpoint
}

rule GatewayBoundary {
  forbid provides JsonRpcEndpoint except Gateway
}
```

```text
error: forbidden provides

Sidecar provides JsonRpcEndpoint via relation SidecarProvidesRpc.
rule GatewayBoundary forbids provides JsonRpcEndpoint except Gateway.
```

Move the `provides` relation onto the allowed component, or change the rule.

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

## Governed source changed without shape delta

Cause: a changed source path matches an implementation block with `on_change require shape_delta`, but the PR did not include a matching shape delta or attestation.

Run coverage with the changed-file list to reproduce it:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
```

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

## Invalid relation

Cause: a `relation` declaration is malformed. Reasons reported by the checker include `missing kind`, `missing connects`, `connects requires at least two endpoints`, `duplicate kind`/`connects`/`roles`/`summary`, `duplicate endpoint X`, `kind K requires exactly two endpoints` (for binary prelude kinds), `kind K requires ordered connects (A -> B)` (for directional binary kinds), `kind K requires ordered connects (A -> B -> ...)` (for `coordinated_call`), ambiguous endpoints that resolve to both a component and a resource, invalid `provides` endpoint kinds, `role NAME is not a connects endpoint`, and `duplicate role for NAME`.

```text
error: invalid relation

relation GatewayCallsAudit is invalid: kind calls requires exactly two endpoints.
```

Fix the offending relation block. Each prelude kind constrains arity and connects shape: `calls`, `callbacks`, and `provides` are binary and directional; `provides` must be `component -> resource`; `coordinated_call` is an ordered path of two or more endpoints; user-defined kinds accept any arity but are excluded from hypercycle detection.

## Unknown relation endpoint

Cause: a `relation`'s `connects` lists a name that does not resolve to a declared component or resource in the loaded model.

```text
error: unknown relation_endpoint

relation_endpoint GhostService is referenced but not declared.
```

Declare the missing component or resource, or fix the endpoint name. Relation endpoints must resolve unambiguously before the hypergraph is checked.

## Design memory does not waive final forbids

If a function emits an effect rejected by a final forbid, adding `rationale`, `memory`, or `reevaluation` does not make the model pass. Fix the effect claim or the architecture policy directly.
