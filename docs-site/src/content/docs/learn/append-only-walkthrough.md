---
title: Append-Only Walkthrough
description: Follow the core Shape failure from trait declaration to checker diagnostic.
sidebar:
  order: 4
---

The first Shape use case is append-only resource protection.

## Declare the invariant

An append-only trait allows appends and reads, then forbids final destructive effects:

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly
```

`final` matters because a component grant cannot override it. A component may grant `HardDelete<AuditEvent>`, but the checker still rejects a function that emits it.

## Model the safe functions

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

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
  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts:18-25")
    }
}
```

This model passes because the component grants the emitted effects and the trait does not forbid them.

## Add the unsafe function

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  grants Read<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

Run:

```bash
shp check fixtures/fail/append_only_hard_delete/audit.shape
```

The checker reports a forbidden effect and includes the causal trail:

```text
AuditStore.purgeOldEvents emits HardDelete<AuditEvent>
AuditEvent has trait AppendOnly
AppendOnly forbids final HardDelete<AuditEvent>
```

That is the product: a compact declaration, a deterministic rejection, and a diagnostic that reviewers can follow.
