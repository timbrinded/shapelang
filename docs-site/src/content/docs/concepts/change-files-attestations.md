---
title: Change Files and Attestations
description: Model PR deltas and documented exceptions without hiding uncertainty.
sidebar:
  order: 4
---

Change files let a PR express architecture deltas without rewriting the baseline model.

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

The checker applies changes before rule evaluation. That means a failing PR delta fails in CI even if the base model still passes.

## Unknowns

Unknown effects should be explicit:

```shape
module changes.PR_002

import audit

change ReviewAuditChange {
  add fn AuditStore.reviewMe
    source ts("src/audit/review.ts#reviewMe")
    effects unknown
}
```

Explicit unknowns are better than silently omitting an effect. Protected components should treat unknowns as review blockers.

## Attestations

Attestations document a reviewer decision around a changed source path:

```shape
module changes.PR_003

attest shape_delta {
  source ts("src/audit/reporting.ts")
  reason "Reporting-only change; no resource effect changed."
}
```

Use attestations sparingly. They should explain why a governed source change does not need a shape delta.

