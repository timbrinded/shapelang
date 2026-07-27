---
title: Global Model Update
description: Update the checked Shape model for a source change.
sidebar:
  order: 4
---

A source change that adds a material effect should be reflected in the global Shape model.

Before:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
}
```

After:

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

Because `AuditEvent` is append-only, this global model update fails for the right reason: the declared `HardDelete<AuditEvent>` effect violates the final forbid.
