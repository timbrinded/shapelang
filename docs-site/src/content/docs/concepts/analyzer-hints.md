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

The analyzer recognizes a deliberately small set of obvious patterns:

| Pattern family | Destructive hints |
| --- | --- |
| SQL | `DELETE FROM`, `TRUNCATE`, and `DROP TABLE` |
| Kysely | `deleteFrom(...)`, `dropTable(...)`, and destructive raw SQL |
| Prisma | `prisma.<model>.delete(...)`, `deleteMany(...)`, and destructive raw SQL |
| Drizzle | `db.delete(...)` or transaction `delete(...)`, plus destructive raw SQL |

The SQL scanner accepts whitespace, newlines, and comments between operation keywords, so statements such as a multiline `DELETE … FROM` are still visible. It ignores SQL comments and quoted text that merely mentions a destructive statement.

The TypeScript matchers cover common `prisma`/`db`/`tx`/`trx` receiver names. Library calls are matched in unquoted source regions, while SQL inside a string or template is scanned only when that literal is passed directly to a supported raw-execution sink. Comments, standalone string or template literals, and strings passed to unrelated calls stay silent.

The analyzer expects the destructive keyword to begin the SQL statement. It does not parse CTE-prefixed statements, evaluate control flow, follow SQL stored in variables, resolve project-specific aliases or dynamic call targets, or mask JavaScript regular-expression literals. Those cases still require review of the implementation and its declared Shape effects.

These hints are useful review aids. They are not a substitute for the `.shape` file.

## Source of truth

The checker evaluates Shape modules. The analyzer can draw attention to missing claims, but it does not authorize or reject an architecture model by itself.

Use analyzer warnings as prompts for better evidence and better effect summaries.
