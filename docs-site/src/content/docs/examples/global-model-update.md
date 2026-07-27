---
title: Global Model Update
description: Update the checked Shape model for a source change.
sidebar:
  order: 4
---

## Intent

Show how a source change that adds a material effect is reflected in the global Shape model, and how that update can still fail policy checks for the right reason.

## Model

**Before** (passes): the store only grants append.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
}
```

**After** (fails): purge is declared with `HardDelete` grant and effect.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

## Expected result

Before:

```bash
shp check path/to/before.shape
```

```text
Shape check passed.
```

After:

```bash
shp check path/to/after.shape
```

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")
```

The closely related fail fixture is `fixtures/fail/append_only_hard_delete/audit.shape`.

## Why

Updating the global model is required when architecture claims change, but an accurate claim can still be illegal under resource policy. Final forbids reject the purge effect even when the grant and evidence are explicit.

To land a purge, the architecture decision must change (for example, stop treating the resource as append-only), or the behavior must not be claimed against that resource.

## Related concepts

- [Model updates and attestations](../concepts/model-updates-attestations.md)
- [Global model updates](../learn/global-model-updates.md)
- [Append-only hard-delete failure](./append-only-hard-delete-failure.md)
