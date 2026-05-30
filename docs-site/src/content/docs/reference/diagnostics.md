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

For rule-derived final forbids, the rule must bind exactly one subject with `when T has TraitName`. Concrete forbid targets are resolved through module/import scoping before this check runs.

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

## Stale Fingerprint Expectation

Cause: a relation pins a resource fingerprint, but the current resource fingerprint is missing or different. This usually means a reviewed Shape claim still points at an older generated AST anchor version.

```shape
module generated.audit

resource AuditStoreAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}

component AuditStore {
}

relation ReviewedFromAst {
  kind generated_from
  connects AuditStore -> AuditStoreAstAnchor
  expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

Regenerate the AST anchor layer, inspect the changed code evidence, then either update the pinned fingerprint after review or revise the claim.

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

Generated AST candidate files under `shape/generated/ast` are the exception: they may keep `effects unknown` because their `effect candidate` declarations are evidence hints, not reviewed effect summaries.

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

Cause: a changed source path matches an implementation block with `on_change require shape_update`, but the changed-file set did not include a matching Shape update or current attestation.

Run coverage with the changed-file list to reproduce it:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_update/audit.shape
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

If `packages/shp-checker/src/checker.ts` changes, the docs path must also change or the change set must include a narrow current attestation in a `.shape` file changed by that same set:

```shape
module repo

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal refactor only; no diagnostics or documented behavior changed."
}
```

Bindings are review gates. They ensure docs are considered when Shape-affecting code or model files change.

## Duplicate function or implementation

Cause: the same function name appears twice in a component, or an implementation name is reused. Shape rejects these because otherwise one declaration can silently overwrite or shadow another.

## Unresolved dependency

Cause: a component declares `requires Target`, but `Target` is neither a component nor a target provided by another component.

## Unsupported rule shape

Cause: a rule uses a syntax shape the checker does not currently implement semantically. For example, repeated `when T has Trait` clauses can add same-subject trait requirements, but mixing different rule subjects is rejected until cross-subject conjunctive semantics are designed.

## Missing required context

Cause: a function, component, or resource has a shape trait such as `PreserveInline`, `RefactorSensitive`, or `NonIdiomatic`, but no matching `rationale` or `memory` exists for that target.

```text
error: missing required context

fn Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.

No matching rationale or memory found.
```

Component and resource targets report the same diagnostic with their own target kind, for example `component Gateway has shape RefactorSensitive` requiring `RefactorConstraint<component Gateway>`.

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

Cause: a `modify`/`remove` change touched a function, component, resource, or relation protected by `guards on_change require ReEvaluation<Self>`, but no valid reevaluation satisfies that memory or rationale.

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DecisionRefactorConstraint.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DecisionRefactorConstraint
  or preserve the protected shape.
```

When the guard protects only detectable properties (a named shape trait, or the `description`), the diagnostic fires solely on removal of that property and names it, for example `This change removes shape trait PreserveInline from the guarded target.` A `guards forbid transform` guard fires when a `modify fn` declares the matching `transform` intent, reporting `This change applies the ExtractHelper transform to the guarded target.` Guards that protect a free-form label keep coarse matching and fire on any change to the target.

Add a `reevaluation` with review evidence, or avoid changing the protected shape.

## Invalid reevaluation

Cause: a `reevaluation` is incomplete or satisfies a memory/rationale that does not exist.

A valid reevaluation needs a known `satisfies` target plus `outcome`, `summary`, `evidence`, `reviewer`, and `decided_on`.

## Stale design memory

Cause: a `memory` or `rationale` has a `review_by` date strictly before the freshness date, and freshness checking is enabled. This diagnostic is only emitted under `shp check --strict-freshness` (a failure) or surfaced by `shp obligations --strict-freshness` (a listing). By default `review_by` is informational and never produces this diagnostic.

```text
error: stale design memory

memory DecisionRefactorConstraint protects fn Gateway.derivePolicyDecision.
Its review_by date 2026-01-01 is before 2026-05-30.

Required:
  review the design memory and update review_by, or replace it with a reevaluation.
```

Only ISO `YYYY-MM-DD` `review_by` values are enforced; missing or non-ISO values are ignored. The checker compares against a caller-provided date and never reads the system clock, so freshness results are deterministic.

## Invalid relation

Cause: a `relation` declaration is malformed. Reasons reported by the checker include `missing kind`, `missing connects`, `connects requires at least two endpoints`, `duplicate kind`/`connects`/`roles`/`summary`, `duplicate endpoint X`, `kind K requires exactly two endpoints` (for binary prelude kinds), `kind K requires ordered connects (A -> B)` (for directional binary kinds), `kind K requires ordered connects (A -> B -> ...)` (for `coordinated_call`), ambiguous endpoints that resolve to both a component and a resource, invalid `provides` endpoint kinds, `role NAME is not a connects endpoint`, and `duplicate role for NAME`.

```text
error: invalid relation

relation GatewayCallsAudit is invalid: kind calls requires exactly two endpoints.
```

Fix the offending relation block. Each prelude kind constrains arity and connects shape: `calls`, `callbacks`, and `provides` are binary and directional; `provides` must be `component -> resource`; `coordinated_call` is an ordered path of two or more endpoints; user-defined kinds accept any arity but are excluded from hypercycle detection.

## Invalid rule

Cause: a `rule` declaration is malformed for the semantic check it asks the checker to perform. For final effect forbids, rules may bind only one subject name. Repeated `when T has Trait` clauses are allowed and are treated as conjunctions; different subject names in the same final-forbid rule are rejected.

```text
error: invalid rule

rule invalid_multi_subject_final_forbid is invalid: final effect forbids may bind only one subject, but found T, U.
```

Use one subject name for the resource being constrained, or split unrelated subjects into separate rules.

## Unknown relation endpoint

Cause: a `relation`'s `connects` lists a name that does not resolve to a declared component or resource in the loaded model.

```text
error: unknown relation_endpoint

relation_endpoint GhostService is referenced but not declared.
```

Declare the missing component or resource, or fix the endpoint name. Relation endpoints must resolve unambiguously before the hypergraph is checked.

## Design memory does not waive final forbids

If a function emits an effect rejected by a final forbid, adding `rationale`, `memory`, or `reevaluation` does not make the model pass. Fix the effect claim or the architecture policy directly.
