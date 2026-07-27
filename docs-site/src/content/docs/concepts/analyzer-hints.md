---
title: Analyzer Hints
description: What optional source analysis can surface, and why the declared model remains authoritative.
sidebar:
  order: 9
---

The source analyzer is advisory. It scans implementation files for a small set of obvious destructive operations and, when given Shape files, compares those hints with declared effects. Analyzer warnings prompt better evidence and effect summaries. They do not authorize, reject, or complete an architecture model. The deterministic checker evaluates the declared `.shape` modules.

![Analyzer hints diagram showing a source scan for DELETE, TRUNCATE, and DROP, comparison with the .shape model, a warning, and the source-of-truth boundary.](../../../assets/infographics/analyzer-advisory-scan.png)

```bash
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape fixtures/source/audit_purge.ts
```

Without `--shape-files`, the command emits source hints only. With `--shape-files`, it compares hints to declared effects.

## Warning kinds

When Shape files are supplied:

| Situation | Warning |
| --- | --- |
| Source appears to hard-delete (or similar) but the model does not declare the effect | missing-declared-effect style warning |
| Source and Shape both declare the effect but static targets differ | target-mismatch warning with suspected and declared targets |
| An unanchored target-bearing hint could belong to an anchored Shape function in the same file | attribution warning instead of comparing against a path-only declaration or combining targets |

Programmatic consumers see the same distinctions. Comparison preserves quoted SQL identifier semantics after clone or serialize/parse via `targetIdentity`.

## What the analyzer catches

The analyzer recognizes a deliberately small set of obvious patterns:

| Pattern family | Destructive hints |
| --- | --- |
| SQL | `DELETE FROM`, `TRUNCATE`, and `DROP TABLE` |
| Kysely | `deleteFrom(...)`, `dropTable(...)`, and destructive raw SQL |
| Prisma | `prisma.<model>.delete(...)`, `deleteMany(...)`, and destructive raw SQL |
| Drizzle | `db.delete(...)` or transaction `delete(...)`, plus destructive raw SQL |

The SQL scanner accepts whitespace, newlines, and comments between operation keywords, so multiline `DELETE … FROM` remains visible. It ignores SQL comments and quoted text that merely mentions a destructive statement. For direct table identifiers it records the static target, preserving schema qualification and SQL identifier quote semantics. Supported comma-separated destructive target lists produce one deterministic hint per static target.

The TypeScript matchers cover common `prisma` / `db` / `tx` / `trx` receiver names. Kysely-style calls infer literal table arguments, Prisma calls infer the direct model property, and Drizzle-style deletes infer a direct identifier. Library calls are matched in unquoted source regions, while SQL inside a string or template is scanned only when that literal is passed directly to a supported raw-execution sink. A conservative lexical scope pass attributes hints inside recognized balanced forms of named function declarations, methods, and block-bodied assigned arrows to the matching `#function` source anchor. It handles common generic parameter lists and object return types. Unsupported TypeScript forms remain unanchored rather than guessed; current examples include literal return types and assigned arrows with a newline between `=` and the parameter list, as well as dynamic callbacks, concise arrows, and malformed scopes.

With `--shape-files`, a static target matches either the declared Shape resource name or one of that resource's `storage` values. ORM identifiers use case-insensitive camel-case/underscore normalization, while hyphens and schema qualifiers remain significant. Unquoted SQL identifiers use case folding without erasing separators; every quoted SQL identifier component requires exact equality. If the analyzer can see the destructive effect but cannot obtain a direct static target, it keeps the ordinary effect hint and does not guess or emit a target mismatch.

## Explicit non-goals

The analyzer expects the destructive keyword to begin the SQL statement. It does not parse CTE-prefixed statements, evaluate control flow, follow SQL stored in variables, resolve project-specific receiver aliases or dynamic call targets, singularize or pluralize names, or mask JavaScript regular-expression literals. Those cases still require review of the implementation and its declared Shape effects.

## Source of truth

The checker evaluates Shape modules. The analyzer can draw attention to missing claims, but it does not accept or reject an architecture model by itself.

Use analyzer warnings as prompts to:

1. declare the missing effect with evidence, or
2. correct a wrong target, or
3. confirm the source pattern is a false positive and leave the model unchanged for documented reasons.

## Practice

Do:

- Run `shp analyze --shape-files ...` on destructive-path changes as a review aid.
- Update the declared model when a hint correctly identifies a missing or mistargeted effect.
- Prefer stable `#function` source anchors so attribution can match Shape function summaries.
- Keep using `shp check` as the CI authority for the model.

Do not:

- Treat a clean analyze run as proof that effects are complete.
- Silence a checker `forbidden effect` because analyze did not warn.
- Expect control-flow-aware or whole-program resolution from the analyzer.
- Combine analyzer output with empty complete summaries to hide uncertainty; use `effects unknown` until the summary is reviewed.

## Related pages

- [Evidence and Source Refs](./evidence-source-refs.md)
- [Unknowns and Safety](./unknowns-safety.md)
- [CLI Reference](../reference/cli.md)
