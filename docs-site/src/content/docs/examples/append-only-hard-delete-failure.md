---
title: Append-Only Hard-Delete Failure
description: A model that fails because a function emits a final forbidden effect.
sidebar:
  order: 2
---

## Intent

Show that `forbid final` on a resource trait wins over component grants. The model can grant `HardDelete` and still fail when a function emits it against an append-only resource.

## Model

The fail fixture at `fixtures/fail/append_only_hard_delete/audit.shape` is a fuller store (append, list, and purge). The minimal claim that fails is:

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

A project can also rely on the prelude `AppendOnly` trait (`resource AuditEvent : AppendOnly` without redefining the trait). The checker outcome is the same: final forbids still apply.

## Expected result

Save the model (for example `shape/audit.shape`) and run:

```bash
shp check shape/audit.shape
```

In this repository the fuller fail fixture is:

```bash
shp check fixtures/fail/append_only_hard_delete/audit.shape
```

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")

caused by:
  - fixtures/fail/append_only_hard_delete/audit.shape: effect AuditStore.purgeOldEvents emits HardDelete<AuditEvent>
  - fixtures/fail/append_only_hard_delete/audit.shape: resource AuditEvent : AppendOnly
  - fixtures/fail/append_only_hard_delete/audit.shape: trait AppendOnly forbids final HardDelete<T>
```

Exit code `1`.

## Why it fails

`grants HardDelete<AuditEvent>` does not override `forbid final HardDelete<T>`. Final forbids are absolute: rationale, memory, reevaluation, and grants cannot waive them.

## Related concepts

- [Resources, traits, and effects](../concepts/resources-traits-effects.md)
- [Unknowns and safety](../concepts/unknowns-safety.md)
- [Diagnostics catalog](../reference/diagnostics.md)
- [Append-only pass](./append-only-pass.md)
