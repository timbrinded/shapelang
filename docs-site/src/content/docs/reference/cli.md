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
shp graph [SYMBOL] [--kind KIND] [files...]
shp memory [files...]
shp obligations [files...]
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
| `explain` | Print derived facts and incident relations for a symbol. |
| `graph` | Print the hyperedges incident to a symbol, or print the entire hypergraph when no symbol is given. Filter by `--kind KIND`. |
| `memory` | List rationale and memory entries grouped by protected target. |
| `obligations` | List open design-memory obligations from checker diagnostics. |
| `author` | Generate a Shape change scaffold from changed files. |
| `analyze` | Emit source hints or compare source hints with declared effects. |

## Common commands

```bash
shp check
shp check shape/system/audit.shape
shp coverage --changed-files changed.txt
shp fmt --check
shp explain AuditEvent
shp graph
shp graph Gateway
shp graph Gateway --kind calls
shp graph --kind provides
shp memory
shp obligations
shp author --changed-files changed.txt --component AuditStore
shp analyze --shape-files shape/system/audit.shape src/audit/purge.ts
```

## Graph output

`shp graph SYMBOL` lists the hyperedges incident to a component or resource:

```text
Gateway (component)
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)
```

`shp graph` without a symbol prints every relation in the hypergraph, grouped by kind:

```text
Hypergraph

calls:
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)

coordinated_call:
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)
```

`--kind KIND` filters by relation kind in both modes. There is no separate binary view; every structural dependency is a hyperedge.

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
