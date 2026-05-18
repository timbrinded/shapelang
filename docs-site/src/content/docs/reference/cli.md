---
title: CLI Reference
description: Commands exposed by the current `shp` CLI.
sidebar:
  order: 2
---

The CLI is implemented in `packages/shp-cli/src/index.ts`.

## Usage

```text
shp check [--changed-files changed.txt] [files...]
shp coverage --changed-files changed.txt [files...]
shp fmt [--check] [files...]
shp explain SYMBOL [files...]
shp graph SYMBOL [--relation requires] [files...]
shp author --changed-files changed.txt --component ComponentName [--change ChangeName] [--module module.name]
shp analyze [--shape-files file1.shape,file2.shape] [source-files...]
```

When no files are provided, commands scan:

```text
shape/system/**/*.shape
shape/changes/**/*.shape
```

## Commands

| Command | Purpose |
| --- | --- |
| `check` | Parse modules, apply change blocks, lower facts, and run semantic checks. |
| `coverage` | Require shape deltas or attestations when governed source paths change. |
| `fmt` | Format Shape files, or check formatting with `--check`. |
| `explain` | Print derived facts and constraints for a symbol. |
| `graph` | Print dependency paths for a symbol and relation. |
| `author` | Generate a Shape change scaffold from changed files. |
| `analyze` | Emit source hints or compare source hints with declared effects. |

## Common commands

```bash
bun shp check
bun shp check fixtures/fail/append_only_hard_delete/audit.shape
bun shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
bun shp fmt --check fixtures/pass/append_only_append/audit.shape
bun shp explain AuditEvent
bun shp graph Gateway --relation requires
bun shp author --changed-files fixtures/changed/audit_purge.txt --component AuditStore
bun shp analyze --shape-files shape/system/audit.shape fixtures/source/audit_purge.ts
```

## Exit codes

`0` means the command passed. `1` means semantic checks, formatting checks, coverage, or analyzer comparison failed. `2` means the CLI arguments were invalid.

