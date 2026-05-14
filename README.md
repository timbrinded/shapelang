# Shape

Shape is a typed architecture conformance language. This repository contains a Bun + Langium implementation of the implementation plan in `impl-lan.md`: parser, semantic checker, change files, coverage policy, formatter, dependency rules, constrained project rules, authoring helpers, editor primitives, and optional source-analysis hints.

## Setup

```bash
bun install
bun run langium:generate
```

## Commands

```bash
bun shp check
bun shp check --changed-files fixtures/changed/audit_purge.txt
bun shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shp
bun shp fmt --check fixtures/pass/append_only_append/audit.shp
bun shp explain AuditEvent
bun shp graph Gateway --relation requires
bun shp author --changed-files fixtures/changed/audit_purge.txt --component AuditStore
bun shp analyze --shape-files shape/system/audit.shp fixtures/source/audit_purge.ts
bun shp check fixtures/fail/append_only_hard_delete/audit.shp
bun test
bun run typecheck
```

`shp check` scans `shape/system/**/*.shp` and `shape/changes/**/*.shp` when no files are provided.

CI is wired in `.github/workflows/shape.yml` for formatting, tests, typechecking, and `shp check`.
