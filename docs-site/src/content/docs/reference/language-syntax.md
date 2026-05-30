---
title: Language Syntax
description: A compact reference for the current Shape grammar.
sidebar:
  order: 1
---

This page mirrors the current Langium grammar at `packages/shp-checker/src/language/shape.langium`.

## Module

```shape
module audit

import shared.resources

resource AuditEvent : AppendOnly
```

`module` is optional, but named modules make imports and diagnostics clearer. Declarations are scoped by module, so two modules may both declare `Store` without colliding. References resolve local declarations first and then explicit imports. Use `other.module::Name` when an authored claim should point at a specific module unambiguously.

## Top-level declarations

Shape modules can contain:

```shape no-verify
resource AuditEvent : AppendOnly
trait AppendOnly<T: Resource> { ... }
component AuditStore { ... }
relation AuditWritePath { ... }
effect candidate AppendEventCandidate { ... }
implementation AuditStoreImpl { ... }
binding CheckerDocs { ... }
attest no_shape_change { ... }
rule NoCallsCycle { ... }
rationale InlineDecision : InlineRationale<fn Gateway.derivePolicyDecision> { ... }
memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> { ... }
reevaluation DecisionShapeRechecked { ... }
```

## Resources

```shape
module audit

resource AuditEvent : AppendOnly {
  storage postgres.table("audit_events")
}
```

Storage and fingerprint declarations use provider names and string values. Fingerprints are checkable resource metadata:

```shape
module generated.audit

resource PurgeOldEventsAstAnchor {
  storage ast.anchor("src/audit/store.rs:42-58")
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

## Traits

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final HardDelete<T>
  require Append<T>
}
```

Trait members are `allow`, `forbid`, and `require` effect patterns.

## Components

Components carry ownership, grants, and function summaries only. Structural dependencies between components and resources are declared as top-level `relation` blocks; they are not part of a component body.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }
}
```

Function summaries support shape traits, `source`, optional `description`, optional `unsafe`, `effects complete`, `effects unknown`, function-level `requires` (capability term, used with `unsafe`), `reason`, and `expires`.

Generated AST drafts may include candidate effect evidence. These declarations are not reviewed effect claims; they are machine-readable hints that agents can compare with authored `effects complete` summaries:

```shape
module shape.generated.ast.audit

resource AuditEvent

resource AuditStoreAppendEventAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}

component AuditStore {
  fn appendEvent
    source ts("src/audit/store.ts:8-14")
    effects unknown
}

effect candidate AppendEventCandidate {
  fn AuditStore.appendEvent
  effect Append<AuditEvent>
  source ts("src/audit/store.ts:8-14")
  confidence low
  pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

## Relations

Relations are the only structural primitive. A relation is a hyperedge connecting two or more components or resources. Binary relations are simply 2-vertex hyperedges.

```shape
module audit

resource AuditEvent

resource PurgeOldEventsAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}

component Gateway {
}

component AuditStore {
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}

relation AuditWritePath {
  kind coordinated_call
  connects Gateway -> AuditStore -> AuditEvent
  summary "Audit writes flow Gateway -> AuditStore -> AuditEvent."
}

relation ReviewedFromAst {
  kind generated_from
  connects AuditStore -> PurgeOldEventsAstAnchor
  expects PurgeOldEventsAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

Relation members:

- `kind` — a relation kind name (e.g. `calls`, `callbacks`, `provides`, `coordinated_call`).
- `connects` — either `A -> B -> ...` (ordered) or `{ A, B, ... }` (unordered). At least two endpoints are required.
- `roles` — optional `{ Gateway as caller, AuditStore as callee }` tagging.
- `expects` — optional endpoint fingerprint pin, written as `expects Endpoint fingerprint provider("value")`.
- `summary` — optional review text.

Directional prelude kinds must use ordered `A -> B` syntax. Binary directional kinds (`calls`, `callbacks`, `provides`) must have exactly two endpoints, and `provides` must connect a component provider to a resource target. `coordinated_call` must use ordered `A -> B -> ...` syntax.

Fingerprint expectations must name one of the relation endpoints. The endpoint must be a resource with a matching fingerprint provider and value, otherwise `shp check` reports stale syntax evidence.

See [Relations and Hypergraphs](../concepts/relations-hypergraphs.md) for the kind registry and traversal semantics.

## Bindings

Bindings couple one set of changed paths to another. They are useful when a code or model change affects a public review surface such as docs.

```shape
module repo

binding CheckerDocs {
  when_changed paths {
    "packages/shp-checker/src/checker.ts"
    "shape/checker.shape"
  }
  require_changed paths {
    "docs-site/src/content/docs/inside-shape/rule-evaluation.md"
    "docs-site/src/content/docs/reference/diagnostics.md"
  }
  allow attest docs_not_needed
}
```

When `shp check --changed-files` runs, a matching `when_changed` path requires at least one `require_changed` path in the same changed-file list. A narrow attestation can satisfy the binding only when the attestation's `.shape` file is also in that changed-file list:

```shape
module repo

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal extraction only; no documented behavior changed."
}
```

Bindings enforce review coupling. They do not prove that the paired docs are complete.

## Global model edits

```shape
module audit

component AuditStore {
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

The repository workflow updates the global model directly. Add, modify, or remove normal declarations in the owning module.

```shape
module audit

relation AuditCallsGateway {
  kind calls
  connects AuditStore -> Gateway
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}
```

## Rules

```shape
module rules

rule NoCallsCycle {
  forbid hypercycle over calls or callbacks
}

rule GatewayBoundary {
  forbid provides JsonRpcEndpoint except Gateway
}
```

Rules currently support `when subject has TraitName`, `forbid` effect patterns (including `forbid final`), `forbid provides TARGET except COMPONENT`, and `forbid hypercycle [over KIND or KIND ...]`. Rule headers do not take type parameters; `when T has TraitName` binds the subject name used by final effect forbids. Repeated `when` clauses for the same subject are conjunctive. Concrete forbid targets, trait references, and exception references may be module-qualified with `module.name::Declaration`.

## Rationale, memory, and reevaluation

Rationale and memory declarations attach typed design context to an existing target:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : RefactorSensitive
    effects complete {
      Read<PolicySnapshot>
    }
}

memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors changed error normalisation behaviour."
  owner GatewayTeam
  guards on_change require ReEvaluation<Self>
}
```

`rationale` members can include `applies_to`, `why`, `summary`, `owner`, `review_by`, `protects`, `guards`, and `evidence`.

`memory` members can include `applies_to`, `status`, `confidence`, `protects`, `guards`, `observed`, `summary`, `owner`, `review_by`, and `evidence`.

A `protects` clause names either a property with a value, such as `protects shape PreserveInline`, or the local description with no value, written `protects description`. Guards whose protected properties are all detectable (a named shape trait, or the description) fire only when that property is removed.

A `guards` clause takes one of two forms: `guards on_change require ReEvaluation<Self>`, or `guards forbid transform Label`. A `modify fn` change can declare its intent with `transform Label1, Label2`; a `forbid transform` guard fires only when a matching transform intent is declared.

A `memory` may carry a `sensitive` flag. A top-level `role Name` declaration registers a valid reviewer/approver identity, and a top-level `policy Name { require approver }` declaration requires an approver on reevaluations that satisfy a `sensitive` memory. `role`, `policy`, and `sensitive` are reserved keywords.

`reevaluation` records review for a guarded change:

```shape
module gateway

reevaluation DecisionShapeRechecked {
  satisfies memory gateway::DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
```

`reevaluation` members can include `satisfies`, `outcome`, `summary`, `evidence`, `reviewer`, `approver`, and `decided_on`. `satisfies` can use a module-qualified rationale or memory name.
