---
title: PR Change Files
description: Use Shape change blocks to model PR-level deltas without rewriting the baseline model.
sidebar:
  order: 5
---

Baseline architecture belongs in `shape/system/**/*.shape`. PR-level deltas belong in `shape/changes/**/*.shape`.

A change file imports the baseline module and applies edits for review:

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

The checker applies change blocks on top of the base model before evaluating rules.

## Supported change entries

Shape currently supports function-level and declaration-level changes:

```shape no-verify
change ReviewChange {
  add fn ComponentName.functionName
    effects unknown

  modify fn ComponentName.functionName
    effects complete {
      Read<ResourceName>
    }

  remove fn ComponentName.functionName

  add resource ResourceName
  modify resource ResourceName
  remove resource ResourceName
}
```

Mark incomplete snippets with `no-verify` in docs. Real change files should be complete enough for the parser and checker.

## Generate a scaffold

Use the authoring command to produce a reviewable starting point:

```bash
bun shp author --changed-files fixtures/changed/audit_purge.txt --component AuditStore --change ReviewAuditChange --module changes.PR_001
```

The scaffold uses `effects unknown` until a human or LLM fills in the source-backed effect summary.

