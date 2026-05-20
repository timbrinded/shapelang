---
title: Missing Shape Update
description: A coverage failure for a governed source path changed without a Shape update.
sidebar:
  order: 3
---

Coverage checks enforce the review workflow around governed source paths.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
}

implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
  }
  conforms_to AuditStore
  on_change require shape_delta
}
```

The changed-file list contains:

```text
src/audit/purge.ts
```

Run:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
```

Expected diagnostic shape:

```text
error: governed source changed without current Shape update
src/audit/purge.ts
```

The model may be coherent, but the PR still failed to update `shape` or attest the architecture claim for a governed source change.
