---
title: CLI Reference
description: Commands exposed by the current `shp` CLI.
sidebar:
  order: 2
---

The released `shp` binary exposes these commands.

## Usage

```text
shp check [--changed-files changed.txt] [files...]
shp coverage --changed-files changed.txt [files...]
shp fmt [--check] [files...]
shp explain SYMBOL [files...]
shp graph SYMBOL [--relation requires] [files...]
shp memory [files...]
shp obligations [files...]
shp author --changed-files changed.txt --component ComponentName [--change ChangeName] [--module module.name]
shp analyze [--shape-files file1.shape,file2.shape] [source-files...]
```

When no files are provided, commands scan:

```text
shape/**/*.shape
```

## Commands

| Command | Purpose |
| --- | --- |
| `check` | Parse modules, apply change blocks, lower facts, and run semantic checks. With `--changed-files`, it also runs coverage and bindings. |
| `coverage` | Require Shape updates or current attestations when governed source paths change. |
| `fmt` | Format Shape files, or check formatting with `--check`. |
| `explain` | Print derived facts and constraints for a symbol. |
| `graph` | Print dependency paths for a symbol and relation. |
| `memory` | List rationale and memory entries grouped by protected target. |
| `obligations` | List open design-memory obligations from checker diagnostics. |
| `author` | Generate a Shape change scaffold from changed files. |
| `analyze` | Emit source hints or compare source hints with declared effects. |

## Common commands

```bash
shp check
shp check --changed-files changed.txt
shp coverage --changed-files changed.txt
shp fmt --check
shp explain AuditEvent
shp graph Gateway --relation requires
shp memory
shp obligations
shp author --changed-files changed.txt --component AuditStore
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape src/audit/purge.ts
```

## Memory and obligations

`shp memory` is useful before reviewing a refactor because it shows design context attached to targets:

```text
Memory Guards

fn Gateway.derivePolicyDecision
  memory DecisionRefactorConstraint
  type: RefactorConstraint
  status: Unexplained
  confidence: High
  owner: GatewayTeam
```

`shp obligations` filters checker diagnostics down to open rationale, memory, description, reevaluation, and guarded-change work:

```text
Open Shape Obligations

guarded changes:
  fn Gateway.derivePolicyDecision changed; requires reevaluation satisfying memory DecisionRefactorConstraint
```

## Exit codes

`0` means the command passed. `1` means semantic checks, formatting checks, coverage, or analyzer comparison failed. `2` means the CLI arguments were invalid.
