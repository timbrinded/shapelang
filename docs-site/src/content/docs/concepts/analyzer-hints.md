---
title: Analyzer Hints
description: Understand what source analysis can and cannot decide for Shape.
sidebar:
  order: 8
---

The source analyzer is advisory. It scans implementation files for obvious destructive operations and compares the hints with declared shape effects.

![Analyzer hints diagram showing a source scan for DELETE, TRUNCATE, and DROP, comparison with the .shape model, a warning, and the source-of-truth boundary.](../../../assets/infographics/analyzer-advisory-scan.png)

```bash
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape fixtures/source/audit_purge.ts
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
