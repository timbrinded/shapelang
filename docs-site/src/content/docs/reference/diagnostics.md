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
bun shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
```

