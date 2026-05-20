---
title: Change Files
description: Use Shape change blocks as checked model patches.
sidebar:
  order: 5
---

Architecture claims belong in `shape/**/*.shape`. The checker loads every `.shape` file under `shape/`, including nested subdirectories.

If a change file is not ready to be checked, keep it outside `shape/`. Files under `shape/` are part of the model like any other source file.

![PR change review workflow showing shape system files, shape changes, changed files, coverage, shp check, and CI result.](../../../assets/infographics/pr-change-review.png)

A change file imports the target module and applies edits for review:

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

The checker applies change blocks on top of the model before evaluating rules.

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
shp author --changed-files fixtures/changed/audit_purge.txt --component AuditStore --change ReviewAuditChange --module changes.PR_001
```

The scaffold uses `effects unknown` until a human or LLM fills in the source-backed effect summary. If the file lives under `shape/`, it will be checked by default.
