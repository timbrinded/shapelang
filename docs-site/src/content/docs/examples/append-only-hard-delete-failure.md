---
title: Append-Only Hard-Delete Failure
description: A model that fails because a function emits a final forbidden effect.
sidebar:
  order: 2
---

This fixture is the core demo. `AuditEvent` is append-only, but `AuditStore.purgeOldEvents` emits `HardDelete<AuditEvent>`.

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
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

Run:

```bash
shp check fixtures/fail/append_only_hard_delete/audit.shape
```

Expected diagnostic shape:

```text
error: forbidden effect
AuditStore.purgeOldEvents
HardDelete<AuditEvent>
AuditEvent has trait AppendOnly
AppendOnly forbids final HardDelete<AuditEvent>
evidence: ts("src/audit/purge.ts#purgeOldEvents")
```

The important behavior is that final forbids win over grants.
