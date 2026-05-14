# Shape

Shape is a typed architecture conformance language. This repository contains the Phase 1 Bun + Langium scaffold: a grammar-first `.shp` parser, a minimal semantic checker, and a small `shp check` CLI.

## Setup

```bash
bun install
bun run langium:generate
```

## Commands

```bash
bun shp check
bun shp check fixtures/fail/append_only_hard_delete/audit.shp
bun test
bun run typecheck
```

`shp check` scans `shape/system/**/*.shp` when no files are provided.
