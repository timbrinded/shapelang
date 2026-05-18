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

`module` is optional, but named modules make imports and change files clearer.

## Top-level declarations

Shape modules can contain:

```shape no-verify
resource AuditEvent : AppendOnly
trait AppendOnly<T: Resource> { ... }
component AuditStore { ... }
implementation AuditStoreImpl { ... }
change AddAuditRetentionPurge { ... }
attest shape_delta { ... }
rule NoRequiresCycle { ... }
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

Function summaries support `source`, optional `unsafe`, `effects complete`, `effects unknown`, `requires`, `reason`, and `expires`.

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

Change blocks can add, modify, and remove functions or top-level declarations.

## Rules

```shape
module rules

rule NoRequiresCycle {
  forbid cycle over requires where includes calls or callbacks
}
```

Rules currently support `when subject has TraitName`, forbidden effects, forbidden providers, and dependency-cycle checks.

