---
title: Analyzer Hints
description: Understand what source analysis can and cannot decide for Shape.
sidebar:
  order: 7
---

The source analyzer is advisory. It scans implementation files for obvious destructive operations and compares the hints with declared shape effects.

```bash
bun shp analyze --shape-files shape/system/audit.shape fixtures/source/audit_purge.ts
```

If a source file appears to hard-delete data but the shape model does not declare `HardDelete`, the analyzer reports a warning.

## What the analyzer catches

The current analyzer focuses on simple textual hints:

- `DELETE`
- `TRUNCATE`
- `DROP`

These hints are useful review aids. They are not a substitute for the `.shape` file.

## Source of truth

The checker evaluates Shape modules. The analyzer can draw attention to missing claims, but it does not authorize or reject an architecture model by itself.

Use analyzer warnings as prompts for better evidence and better effect summaries.

