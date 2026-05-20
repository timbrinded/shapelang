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

`module` is optional, but named modules make imports and diagnostics clearer.

## Top-level declarations

Shape modules can contain:

```shape no-verify
resource AuditEvent : AppendOnly
trait AppendOnly<T: Resource> { ... }
component AuditStore { ... }
relation AuditWritePath { ... }
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

Storage declarations use a provider name and a string value.

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

## Relations

Relations are the only structural primitive. A relation is a hyperedge connecting two or more components or resources. Binary relations are simply 2-vertex hyperedges.

```shape
module audit

resource AuditEvent

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
```

Relation members:

- `kind` — a relation kind name (e.g. `calls`, `callbacks`, `provides`, `coordinated_call`).
- `connects` — either `A -> B -> ...` (ordered) or `{ A, B, ... }` (unordered). At least two endpoints are required.
- `roles` — optional `{ Gateway as caller, AuditStore as callee }` tagging.
- `summary` — optional review text.

Directional prelude kinds must use ordered `A -> B` syntax. Binary directional kinds (`calls`, `callbacks`, `provides`) must have exactly two endpoints, and `provides` must connect a component provider to a resource target. `coordinated_call` must use ordered `A -> B -> ...` syntax.

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

Rules currently support `when subject has TraitName`, `forbid` effect patterns (including `forbid final`), `forbid provides TARGET except COMPONENT`, and `forbid hypercycle [over KIND or KIND ...]`.

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

`reevaluation` records review for a guarded change:

```shape
module gateway

reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
```

`reevaluation` members can include `satisfies`, `outcome`, `summary`, `evidence`, `reviewer`, `approver`, and `decided_on`.
