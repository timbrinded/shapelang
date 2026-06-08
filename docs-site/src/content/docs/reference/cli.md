---
title: CLI Reference
description: Commands exposed by the current `shp` CLI.
sidebar:
  order: 2
---

The released `shp` binary exposes these commands.

## Usage

```text
shp check [--changed-files changed.txt] [--strict-freshness] [files...]
shp coverage --changed-files changed.txt [files...]
shp fmt [--check] [files...]
shp explain SYMBOL [files...]
shp graph all [--kind KIND] [files...]
shp graph show SYMBOL [--kind KIND] [files...]
shp graph stats [--kind KIND] [files...]
shp memory [files...]
shp obligations [--strict-freshness] [files...]
shp author --changed-files changed.txt --component ComponentName [--module module.name]
shp analyze [--shape-files file1.shape,file2.shape] [source-files...]
shp ast source [--language LANG] [--module NAME] [--include-ast-layer] [--raw-out PATH] [--out-dir DIR] [--check] [--allow-parse-errors] files...
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
| `check` | Parse modules, lower facts, and run semantic checks. With `--changed-files`, it also runs coverage and bindings. With `--strict-freshness`, stale design memory becomes a check failure. |
| `coverage` | Require Shape updates or current attestations when governed source paths change. |
| `fmt` | Format Shape files, or check formatting with `--check`. |
| `explain` | Print derived facts and incident relations for a symbol. |
| `graph all` | Print the entire hypergraph. Filter by `--kind KIND`. |
| `graph show` | Print the hyperedges incident to a symbol. Filter by `--kind KIND`. |
| `graph stats` | Print aggregate hypergraph counts. Filter by `--kind KIND`. |
| `memory` | List rationale and memory entries grouped by protected target. |
| `obligations` | List open design-memory obligations from checker diagnostics. With `--strict-freshness`, also list design memory whose `review_by` date is past. |
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
shp ast source --language rust --out-dir shape/generated/ast src/audit/store.rs
shp ast source --language rust --out-dir shape/generated/ast --check src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
shp update --dry-run
```

## AST generation

`shp ast` is a drafting tool. It turns syntax evidence into conservative Shape, not final architecture truth.

By default, `shp ast source` parses files with the platform Tree-sitter native binding and prints the semantic draft: stable files, modules, types, functions, high-confidence calls, compact AST anchors, anchor fingerprints where token evidence exists, candidate effect evidence, and unresolved uncertainty. Generated functions use `effects unknown`.

Source language inference covers TypeScript, TSX, JavaScript/JSX, Rust, Go, and Python. JSX files use the JavaScript parser; TSX files use the TSX parser bundled beside released `shp` binaries. `--language` accepts `javascript`, `typescript`, `tsx`, `rust`, `go`, and `python`; aliases `js`, `jsx`, `ts`, `rs`, and `py` normalize to their parser names. Unsupported values are rejected as usage errors before parser loading.

Use `--out-dir shape/generated/ast` to write checked generated AST context as deterministic files plus a manifest. Source identities are normalized relative to the workspace root, so absolute source paths and invocations from nested directories produce the same generated modules and source references for the same file. These generated files use `shape.generated.ast...` modules and are allowed to keep `effects unknown`, because they are candidate evidence rather than reviewed architecture truth. Use `--check` with `--out-dir` in CI to fail when the checked-in generated AST files are stale. Freshness checks and cleanup are scoped to files recorded in the generated AST manifest, so unrelated authored `.shape` files in the output tree are not treated as generated output.

In this repo, `bun run ast:generate` refreshes the committed generated AST context for tracked and untracked non-ignored first-party source, and `bun run ast:check` verifies it is fresh in local, CI, and release validation. The source set excludes dependency, build, and generated parser output. Directory output rejects module or output-path collisions before writing.

Use `--include-ast-layer` to include raw AST resources and `ast_child` relations in stdout. Use `--raw-out PATH` to keep the raw trace in a sidecar Shape file while stdout stays focused on the semantic draft. These flags are mutually exclusive.

`shp ast json` accepts normalized AST JSON with this shape when another parser already produced syntax data. It is an input adapter, not a Shapes-to-AST export path. Anchored nodes should include token/source text in their subtree so `ast.semantic_subtree_v1` fingerprints can be computed. If an anchor has no token evidence, generation reports a warning, keeps the draft, omits that fingerprint expectation, and skips candidate effects that would need an uncheckable pin:

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

### Review freshness

`review_by` is informational by default. Pass `--strict-freshness` to enforce it: design memory and rationale whose `review_by` is an ISO `YYYY-MM-DD` date strictly before today is reported. `shp obligations --strict-freshness` lists those entries under `stale design memory:`, and `shp check --strict-freshness` turns them into a failing diagnostic so CI can require periodic review.

```text
Open Shape Obligations

stale design memory:
  memory DecisionRefactorConstraint review_by 2026-01-01 is before 2026-05-30
```

Only ISO `YYYY-MM-DD` dates are enforced; missing or non-ISO `review_by` values are never reported as stale. The checker reads the date from the caller, never the system clock, so freshness results stay deterministic and reproducible.

## Exit codes

`0` means the command passed. `1` means semantic checks, formatting checks, coverage, analyzer comparison, download, checksum, extraction, or binary replacement failed. `2` means the CLI arguments were invalid or the update target platform/path is unsupported.

## Updating

`shp update` is for local developer installs of the released single binary. It checks the current version, resolves a GitHub release, downloads the matching published platform archive, verifies it with `checksums.txt`, and replaces the selected executable path. The published archive matrix follows the native parser target table used by release builds.

Use `shp update --dry-run` to see the selected release, asset, and binary path without downloading. Use `shp update --version v0.4.0` to target a specific newer release. Use `--path PATH` when testing from source or when replacing a custom installed binary; if that path already exists, it must identify as the Shape CLI and report a valid version.

CI should continue installing pinned releases through the setup action or installer script instead of calling `shp update`.
