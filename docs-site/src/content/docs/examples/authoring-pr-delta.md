---
title: Authoring an Optional Delta
description: Generate a reviewable change-file scaffold from changed source paths.
sidebar:
  order: 4
---

The authoring command turns changed files into a Shape change scaffold.

```bash
shp author --changed-files fixtures/changed/audit_purge.txt --component AuditStore --change ReviewAuditChange --module changes.PR_001
```

The generated output includes the target module and change name:

```shape
module changes.PR_001

change ReviewAuditChange {
  add fn AuditStore.audit_purge
    source ts("src/audit/purge.ts")
    effects unknown
}
```

Treat generated output as a starting point. Reviewers or LLM authoring helpers should replace `effects unknown` with source-backed effects before putting the file under `shape/`.

## Completed delta

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
}
```

If `AuditEvent` is append-only, this completed delta fails for the right reason.
