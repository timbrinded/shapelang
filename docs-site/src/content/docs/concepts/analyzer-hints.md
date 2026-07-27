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

If a source file appears to hard-delete data but the shape model does not declare `HardDelete`, the analyzer reports a missing-effect warning. When both source and Shape declare the effect but their static targets differ, it reports a separate target-mismatch warning with the suspected and declared targets. If an unanchored target-bearing hint could belong to an anchored Shape function in the same file, it reports an attribution warning instead of comparing against a path-only declaration or combining targets.

## What the analyzer catches

The analyzer recognizes a deliberately small set of obvious patterns:

| Pattern family | Destructive hints |
| --- | --- |
| SQL | `DELETE FROM`, `TRUNCATE`, and `DROP TABLE` |
| Kysely | `deleteFrom(...)`, `dropTable(...)`, and destructive raw SQL |
| Prisma | `prisma.<model>.delete(...)`, `deleteMany(...)`, and destructive raw SQL |
| Drizzle | `db.delete(...)` or transaction `delete(...)`, plus destructive raw SQL |

The SQL scanner accepts whitespace, newlines, and comments between operation keywords, so statements such as a multiline `DELETE … FROM` are still visible. It ignores SQL comments and quoted text that merely mentions a destructive statement. For direct table identifiers it also records the static target, preserving schema qualification and SQL identifier quote semantics. Supported comma-separated destructive target lists produce one deterministic hint per static target.

The TypeScript matchers cover common `prisma`/`db`/`tx`/`trx` receiver names. Kysely-style calls infer literal table arguments, Prisma calls infer the direct model property, and Drizzle-style deletes infer a direct identifier. Library calls are matched in unquoted source regions, while SQL inside a string or template is scanned only when that literal is passed directly to a supported raw-execution sink. A conservative lexical scope pass attributes hints inside recognized balanced forms of named function declarations, methods, and block-bodied assigned arrows to the matching `#function` source anchor. It handles common generic parameter lists and object return types. Unsupported TypeScript forms remain unanchored rather than being guessed; current examples include literal return types and assigned arrows with a newline between `=` and the parameter list, as well as dynamic callbacks, concise arrows, and malformed scopes.

With `--shape-files`, a static target matches either the declared Shape resource name or one of that resource's `storage` values. ORM identifiers use case-insensitive camel-case/underscore normalization, while hyphens and schema qualifiers remain significant. Unquoted SQL identifiers use case folding without erasing separators; every quoted SQL identifier component requires exact equality. If the analyzer can see the destructive effect but cannot obtain a direct static target, it keeps the ordinary effect hint and does not guess or emit a target mismatch.

Programmatic hints carry this distinction in `targetIdentity`: SQL targets retain ordered `{ value, quoted }` segments, while ORM targets retain their identifier value. The comparison API therefore preserves quoted-identifier semantics after a hint is cloned or serialized and parsed again.

The analyzer expects the destructive keyword to begin the SQL statement. It does not parse CTE-prefixed statements, evaluate control flow, follow SQL stored in variables, resolve project-specific receiver aliases or dynamic call targets, singularize or pluralize names, or mask JavaScript regular-expression literals. Those cases still require review of the implementation and its declared Shape effects.

These hints are useful review aids. They are not a substitute for the `.shape` file.

## Source of truth

The checker evaluates Shape modules. The analyzer can draw attention to missing claims, but it does not authorize or reject an architecture model by itself.

Use analyzer warnings as prompts for better evidence and better effect summaries.
