---
title: Analyzer Warning
description: Compare obvious source hints with declared Shape effects.
sidebar:
  order: 5
---

The analyzer can find obvious destructive operations in source text.

```bash
bun shp analyze --shape-files shape/system/audit.shape fixtures/source/audit_purge.ts
```

If the source contains a delete-like operation that is missing from the shape summary, the analyzer warns:

```text
missing from shape effects
HardDelete
```

## How to respond

Do not treat analyzer output as proof. Treat it as a prompt to inspect the source and update the shape model.

A suspicious purge might become:

```shape
module changes.PR_001

import audit

change AddAuditRetentionPurge {
  add fn AuditStore.purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

The checker then decides whether that declared effect is allowed.

