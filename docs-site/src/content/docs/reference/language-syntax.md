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

`module` is optional, but named modules make imports and optional change files clearer.

## Top-level declarations

Shape modules can contain:

```shape no-verify
resource AuditEvent : AppendOnly
trait AppendOnly<T: Resource> { ... }
component AuditStore { ... }
implementation AuditStoreImpl { ... }
binding CheckerDocs { ... }
change AddAuditRetentionPurge { ... }
attest no_shape_change { ... }
rule NoRequiresCycle { ... }
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

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  requires Gateway via calls
  provides AuditLog
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }
}
```

Function summaries support shape traits, `source`, optional `description`, optional `unsafe`, `effects complete`, `effects unknown`, `requires`, `reason`, and `expires`.

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : RequiresDescription, PreserveInline
    source ts("src/gateway/authorize.ts#derivePolicyDecision")
    description required "Builds the visible authorization decision from policy state."
    effects complete {
      Read<PolicySnapshot>
    }
}
```

## Change entries

```shape
module changes.PR_001

import audit

change ReviewAuditChange {
  add fn AuditStore.purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
  remove fn AuditStore.oldPurge
}
```

Change blocks can add, modify, and remove functions or top-level declarations in the loaded model.

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

When coverage is run with a changed-file list, a matching `when_changed` path requires at least one `require_changed` path in the same change. A narrow attestation can satisfy the binding only when the attestation's `.shape` file is also part of the same changed-file list:

```shape
module repo

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal extraction only; no documented behavior changed."
}
```

Bindings enforce review coupling. They do not prove that the docs are complete.

## Rules

```shape
module rules

rule NoRequiresCycle {
  forbid cycle over requires where includes calls or callbacks
}
```

Rules currently support `when subject has TraitName`, forbidden effects, forbidden providers, and dependency-cycle checks.

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
