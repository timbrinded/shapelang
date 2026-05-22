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
shp graph all [--kind KIND] [files...]
shp graph show SYMBOL [--kind KIND] [files...]
shp graph stats [--kind KIND] [files...]
shp memory [files...]
shp obligations [files...]
shp author --changed-files changed.txt --component ComponentName [--module module.name]
shp analyze [--shape-files file1.shape,file2.shape] [source-files...]
shp ast source [--language LANG] [--module NAME] [--include-ast-layer] [--raw-out PATH] files...
shp ast json [--module NAME] [--include-ast-layer] [--raw-out PATH] ast.json
shp update [--version VERSION] [--dry-run] [--path PATH]
shp --help
shp --version
```

When no files are provided, commands scan:

```text
shape/**/*.shape
```

## Commands

| Command | Purpose |
| --- | --- |
| `check` | Parse modules, lower facts, and run semantic checks. With `--changed-files`, it also runs coverage and bindings. |
| `coverage` | Require Shape updates or current attestations when governed source paths change. |
| `fmt` | Format Shape files, or check formatting with `--check`. |
| `explain` | Print derived facts and incident relations for a symbol. |
| `graph all` | Print the entire hypergraph. Filter by `--kind KIND`. |
| `graph show` | Print the hyperedges incident to a symbol. Filter by `--kind KIND`. |
| `graph stats` | Print aggregate hypergraph counts. Filter by `--kind KIND`. |
| `memory` | List rationale and memory entries grouped by protected target. |
| `obligations` | List open design-memory obligations from checker diagnostics. |
| `author` | Generate a conservative global-model draft from changed files. |
| `analyze` | Emit source hints or compare source hints with declared effects. |
| `ast source` | Parse source with Tree-sitter and emit a conservative semantic Shape draft. |
| `ast json` | Read external AST JSON and emit the same draft format. |
| `update` | Update a local released binary from GitHub Releases. |

## Common commands

```bash
shp check
shp check --changed-files changed.txt
shp coverage --changed-files changed.txt
shp fmt --check
shp explain AuditEvent
shp graph all
shp graph all --kind provides
shp graph show Gateway
shp graph show Gateway --kind calls
shp graph stats
shp graph stats --kind calls
shp memory
shp obligations
shp author --changed-files changed.txt --component AuditStore
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape src/audit/purge.ts
shp ast source --language rust --module generated.audit src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
shp update --dry-run
```

## AST generation

`shp ast` is a drafting tool. It turns syntax evidence into conservative Shape, not final architecture truth.

By default, `shp ast source` parses files with `@kreuzberg/tree-sitter-language-pack` and prints only the semantic draft: stable files, modules, types, functions, high-confidence calls, and unresolved uncertainty. Generated functions use `effects unknown`, so the draft can parse successfully while still failing `shp check` until a reviewer replaces uncertainty with reviewed effects.

Use `--include-ast-layer` to include raw AST resources and `ast_child` relations in stdout. Use `--raw-out PATH` to keep the raw trace in a sidecar Shape file while stdout stays focused on the semantic draft.

`shp ast json` accepts normalized AST JSON with this shape:

```json
{
  "language": "rust",
  "files": [
    {
      "path": "src/audit/store.rs",
      "root": "root",
      "nodes": [
        { "id": "root", "kind": "source_file", "children": ["store"] },
        {
          "id": "store",
          "kind": "struct_item",
          "attributes": { "name": "AuditStore" },
          "text": "struct AuditStore { repo: AuditRepo }"
        }
      ]
    }
  ]
}
```

## Graph output

`shp graph show SYMBOL` lists the hyperedges incident to a component or resource:

```text
Gateway (component)
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)
```

`shp graph all` prints every relation in the hypergraph, grouped by kind:

```text
Hypergraph

calls:
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)

coordinated_call:
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)
```

`--kind KIND` filters by relation kind in graph modes. There is no separate binary view; every structural dependency is a hyperedge.

The older forms `shp graph`, `shp graph SYMBOL`, and `shp graph --stats` remain supported for compatibility, but the explicit subcommands are preferred.

### Stats

`shp graph stats` reports aggregate counts so an agent (or human) can size up a model before drilling into specific relations:

```text
Hypergraph stats
  vertices: 4 (3 components, 1 resource)
  hyperedges: 3
    calls: 2
    coordinated_call: 1
  incidences: 7
  arity: min 2, max 3, avg 2.33
    widest: coordinated_call AuditWritePath
  isolated vertices: 0
```

`graph stats` combines with `--kind KIND` to scope the hyperedge, incidence, and arity counts to a single relation kind. It is a whole-graph mode and does not accept a symbol. Vertex counts always reflect the full model; `isolated vertices` then reports vertices that do not participate in any hyperedge of the selected kind.

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

`0` means the command passed. `1` means semantic checks, formatting checks, coverage, analyzer comparison, download, checksum, extraction, or binary replacement failed. `2` means the CLI arguments were invalid or the update target platform/path is unsupported.

## Updating

`shp update` is for local developer installs of the released single binary. It checks the current version, resolves a GitHub release, downloads the matching platform archive, verifies it with `checksums.txt`, and replaces the selected executable path.

Use `shp update --dry-run` to see the selected release, asset, and binary path without downloading. Use `shp update --version v0.3.0` to target a specific newer release. Use `--path PATH` when testing from source or when replacing a custom installed binary; if that path already exists, it must identify as the Shape CLI and report a valid version.

CI should continue installing pinned releases through the setup action or installer script instead of calling `shp update`.
