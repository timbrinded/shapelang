---
title: CLI Reference
description: Commands exposed by the current `shp` CLI.
sidebar:
  order: 2
---

The released `shp` binary (version `0.4.1` / tag `v0.4.1`) exposes these commands.

## Usage

```text
shp check [--allow-unknown-effects] [--changed-files changed.txt] [--as-of YYYY-MM-DD] [--strict-freshness] [files...]
shp coverage --changed-files changed.txt [files...]
shp fmt [--check] [files...]
shp explain SYMBOL [files...]
shp graph all [--kind KIND] [files...]
shp graph show SYMBOL [--kind KIND] [files...]
shp graph stats [--kind KIND] [files...]
shp lsp
shp memory [files...]
shp obligations [--as-of YYYY-MM-DD] [--strict-freshness] [files...]
shp author --changed-files changed.txt --component ComponentName [--module module.name]
shp author --changed-files changed.txt --component ComponentName --diff pr.diff --prompt --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]
shp author --changed-files changed.txt --diff pr.diff --critic-prompt proposed.shape --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]
shp analyze [--shape-files file1.shape,file2.shape] [source-files...]
shp ast source [--language LANG] [--module NAME] [--include-ast-layer] [--raw-out PATH] [--out-dir DIR] [--check] [--allow-parse-errors] files...
shp ast json [--module NAME] [--include-ast-layer] [--raw-out PATH] ast.json
shp update [--version VERSION] [--dry-run] [--path PATH]
shp --help
shp --version
```

When no files are provided, Shape file commands scan:

```text
shape/**/*.shape
```

This recursive file set includes source-controlled domain packs vendored below
`shape/vendor/`. Vendoring installs those modules into the checked model; explicit
imports make project references to their declarations reviewable but do not
activate or deactivate pack-level rules. See [Domain Packs](../concepts/domain-packs).

## Commands

| Command | Purpose |
| --- | --- |
| `check` | Parse modules, lower facts, and run semantic checks. With `--allow-unknown-effects`, draft unknowns become non-fatal warnings while all other diagnostics remain blocking. With `--changed-files`, also runs coverage and bindings. With `--as-of YYYY-MM-DD` or `--strict-freshness`, stale design memory becomes a check failure. |
| `coverage` | Require Shape updates or current attestations when governed source paths change. Bindings are not enforced in coverage-only mode. |
| `fmt` | Format Shape files, or check formatting with `--check`. |
| `explain` | Print derived facts and incident relations for a symbol. |
| `graph all` | Print the entire hypergraph. Filter by `--kind KIND`. |
| `graph show` | Print the hyperedges incident to a symbol. Filter by `--kind KIND`. |
| `graph stats` | Print aggregate hypergraph counts. Filter by `--kind KIND`. |
| `lsp` | Serve Shape diagnostics and editor requests over the Language Server Protocol on stdio. |
| `memory` | List rationale and memory entries grouped by protected target. |
| `obligations` | List open design-memory obligations from checker diagnostics. With `--as-of` or `--strict-freshness`, also list design memory whose `review_by` date is past the reference date. |
| `author` | Generate a conservative global-model draft, emit a provider-neutral PR-diff authoring prompt, or review a proposed update with a provider-neutral critic prompt and deterministic local advisories. |
| `analyze` | Emit source hints or compare source hints with declared effects. |
| `ast source` | Parse source with Tree-sitter and emit a conservative semantic Shape draft. |
| `ast json` | Read external AST JSON and emit the same draft format. |
| `update` | Update a local released binary from GitHub Releases. |

## Check flags

| Flag | Meaning |
| --- | --- |
| `--allow-unknown-effects` | Report `effects unknown` as a non-fatal draft warning; every other diagnostic stays blocking. |
| `--changed-files PATH` | Path to a newline-delimited changed-file list; also runs coverage and bindings. |
| `--as-of YYYY-MM-DD` | Freshness reference date (ISO calendar day). Design memory with `review_by` strictly before this date fails the check. |
| `--strict-freshness` | Shorthand for `--as-of` today (UTC). The CLI supplies today's date; the checker itself only compares the provided date and does not read the clock. |

`--as-of` and `--strict-freshness` are alternatives for the same freshness gate. When both are present, `--as-of` wins.

## Common commands

```bash
shp check
shp check --allow-unknown-effects draft.shape
shp check --changed-files changed.txt
shp check --as-of 2026-05-30
shp check --strict-freshness
shp coverage --changed-files changed.txt
shp fmt --check
shp explain AuditEvent
shp graph all
shp graph all --kind provides
shp graph show Gateway
shp graph show Gateway --kind calls
shp graph stats
shp graph stats --kind calls
shp lsp
shp memory
shp obligations
shp obligations --as-of 2026-05-30
shp obligations --strict-freshness
shp author --changed-files changed.txt --component AuditStore
shp author --changed-files changed.txt --component AuditStore --diff pr.diff --prompt --shape-files shape/audit.shape --snippet-files src/audit/purge.ts
shp author --changed-files changed.txt --diff pr.diff --critic-prompt proposed.shape --shape-files shape/audit.shape --snippet-files src/audit/purge.ts
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape src/audit/purge.ts
shp ast source --language rust --module generated.audit src/audit/store.rs
shp ast source --language rust --out-dir shape/generated/ast src/audit/store.rs
shp ast source --language rust --out-dir shape/generated/ast --check src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
shp update --dry-run
shp update --version v0.4.1
```

## Draft validation

`effects unknown` is conservative draft syntax, but strict `shp check` rejects it so committed models and CI cannot silently retain unresolved effects. During authoring, opt into draft validation:

```bash
shp check --allow-unknown-effects draft.shape
```

Unknown effects are rendered as warnings and the command exits `0` only when no other diagnostic is present. The flag does not soften parse errors, final forbids, missing grants for known effects, guarded-change obligations, coverage, bindings, or any other semantic failure. Resolve the warnings and run strict `shp check` before review or CI.

## Analyzer hints

`shp analyze` lexically scans for obvious destructive SQL plus common Kysely, Prisma, and Drizzle delete patterns. It recognizes multiline SQL and direct raw-execution literals while ignoring comments and inert string or template literals. When a direct static table, model, or schema identifier is available, hint output includes a suspected target; supported comma-separated destructive SQL lists emit one hint per target. Destructive SQL must begin with the destructive keyword; the analyzer does not follow SQL stored in variables or resolve arbitrary library aliases. Without `--shape-files`, it prints advisory hints and exits successfully. With `--shape-files`, it compares hints with declared effects and compares static targets with declared resource names and `storage` aliases. Quoted SQL components compare exactly, while unquoted SQL uses case folding without erasing separators. The TypeScript scanner conservatively associates recognized balanced forms of named functions, methods, and block-bodied assigned arrows with Shape `#function` source anchors. Unsupported TypeScript forms remain unanchored; this includes literal return types and assigned arrows with a newline between `=` and the parameter list. Missing effects, target mismatches, and ambiguous source attribution have distinct warnings; any warning exits with code `1`.

See [Analyzer Hints](../concepts/analyzer-hints) for the supported pattern families and matcher limitations.

## PR-diff authoring

Without `--prompt`, `shp author` keeps its existing stdout contract: a parseable conservative global-model scaffold with file-scoped source references. Diff context is accepted only in prompt mode. The helper never converts hunk coordinates into numbered Shape references; a reviewer or authoring agent may refine a file-scoped reference to a stable `#symbol` anchor when the supplied source evidence supports it.

Prompt mode packages the same draft with the evidence an external human or agent needs:

```bash
shp author \
  --changed-files changed.txt \
  --component AuditStore \
  --module audit \
  --diff pr.diff \
  --prompt \
  --shape-files shape/audit.shape \
  --snippet-files src/audit/purge.ts \
  --project-prelude shape/project-prelude.shape \
  --instructions "Keep the update narrow." \
  > author-prompt.txt
```

`--prompt` requires a non-empty unified diff and a non-empty comma-separated `--shape-files` list. `--snippet-files` and `--project-prelude` add explicit path-labeled context; Shape does not discover a project prelude or invoke a model provider. Context flags are rejected outside prompt or critic mode instead of being silently ignored.

The bundle requires evidence for resources, components, effects, and relations, keeps destructive operations explicit, and includes `effects unknown` in the initial draft when semantics remain uncertain. It is an authoring artifact, not checker approval. Review and fold the result into the owning global model, run `shp fmt --check`, then run strict `shp check --changed-files changed.txt`.

Critic mode reviews an already proposed Shape update with the same explicit diff, existing-Shape, snippet, prelude, and instruction context:

```bash
shp author \
  --changed-files changed.txt \
  --diff pr.diff \
  --critic-prompt proposed.shape \
  --shape-files shape/audit.shape \
  --snippet-files src/audit/purge.ts \
  > critic-prompt.txt
```

The provider-neutral critic prompt is written to stdout. Deterministic local advisories are written to stderr for a source-backed guarded function changed without a matching reevaluation, or for a destructive operation found on added diff lines but absent from the existing and proposed declared effects. Deleted diff lines are never analyzed. Advisories report file paths and code evidence without producing numbered Shape references. These checks are deliberately coarse and lexical: warnings exit `0`, malformed input exits `2`, and only a later `shp check` can authoritatively accept or reject the model. `--critic-prompt` and `--prompt` are mutually exclusive; draft-only `--component` and `--module` flags are rejected in critic mode. Neither mode invokes a model provider, subprocess, network service, or checker pass.

## AST generation

`shp ast` is a drafting tool. It turns syntax evidence into conservative Shape, not final architecture truth.

By default, `shp ast source` parses files with the platform Tree-sitter native binding and prints the semantic draft: stable files, modules, types, functions, high-confidence calls, compact AST anchors, anchor fingerprints where token evidence exists, candidate effect evidence, and unresolved uncertainty. Generated source references use stable `#symbol` anchors for named declarations and file-only references otherwise, so line-only movement does not churn the semantic draft. Generated functions use `effects unknown`.

Source language inference covers TypeScript, TSX, JavaScript/JSX, Rust, Go, and Python. JSX files use the JavaScript parser; TSX files use the TSX parser bundled beside released `shp` binaries. `--language` accepts `javascript`, `typescript`, `tsx`, `rust`, `go`, and `python`; aliases `js`, `jsx`, `ts`, `rs`, and `py` normalize to their parser names. Unsupported values are rejected as usage errors before parser loading.

Use `--out-dir shape/generated/ast` to write checked generated AST context as deterministic files plus a manifest. Source identities are normalized relative to the workspace root, so absolute source paths and invocations from nested directories produce the same generated modules and source references for the same file. These generated files use `shape.generated.ast...` modules and are allowed to keep `effects unknown`, because they are candidate evidence rather than reviewed architecture truth. Use `--check` with `--out-dir` in CI to fail when the checked-in generated AST files are stale. Freshness checks and cleanup are scoped to files recorded in the generated AST manifest, so unrelated authored `.shape` files in the output tree are not treated as generated output.

In this repo, `bun run ast:generate` refreshes the committed generated AST context for tracked and untracked non-ignored first-party source, and `bun run ast:check` verifies it is fresh in local, CI, and release validation. The source set excludes dependency, build, and generated parser output. Directory output rejects module or output-path collisions before writing.

Use `--include-ast-layer` to include raw AST resources and `ast_child` relations in stdout. Use `--raw-out PATH` to keep the raw trace in a sidecar Shape file while stdout stays focused on the semantic draft. These flags are mutually exclusive.

`shp ast json` accepts normalized AST JSON with this shape when another parser already produced syntax data. It is an input adapter, not a Shape-to-AST export path. Anchored nodes should include token/source text in their subtree so `ast.semantic_subtree_v1` fingerprints can be computed. If an anchor has no token evidence, generation reports a warning, keeps the draft, omits that fingerprint expectation, and skips candidate effects that would need an uncheckable pin:

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

The older forms `shp graph`, `shp graph SYMBOL`, and `shp graph --stats` remain supported for compatibility, but the explicit subcommands are preferred. Legacy symbols named `all`, `show`, or `stats` must use `graph show SYMBOL`.

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

## Language server

`shp lsp` reserves standard input and output for Language Server Protocol
messages. Configure an editor to launch the `shp` executable with `lsp` as its
only argument. Do not wrap it with a command that writes banners or logs to
stdout.

The server advertises incremental document synchronization, diagnostics, hover,
go to definition, completion, and whole-document formatting. Format-on-save is
client driven: an editor with that setting enabled sends
`textDocument/formatting`, and Shape returns the canonical full-document edit.

At initialization, the server discovers `shape/**/*.shape` under every initial
file-backed workspace folder. Open documents override the corresponding disk
source, and open Shape documents outside that default tree are included too.
Semantic diagnostics therefore see imported workspace modules together. Closing
or fixing a document publishes an empty diagnostic set to clear stale problems.

Definitions resolve in the current document first. If the declaration is
external, the server returns it only when exactly one workspace document
matches; ambiguous names do not jump to an arbitrary file.

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

`review_by` is informational by default. Pass `--as-of YYYY-MM-DD` or `--strict-freshness` to enforce it: design memory and rationale whose `review_by` is an ISO `YYYY-MM-DD` date strictly before the reference date is reported. `shp obligations` lists those entries under `stale design memory:`, and `shp check` turns them into a failing diagnostic so CI can require periodic review.

```text
Open Shape Obligations

stale design memory:
  memory DecisionRefactorConstraint review_by 2026-01-01 is before 2026-05-30
```

Only ISO `YYYY-MM-DD` dates are enforced; missing or non-ISO `review_by` values are never reported as stale. Prefer `--as-of` for deterministic CI dates. `--strict-freshness` is shorthand for today (UTC) at the CLI boundary; the checker only compares the date it is given.

## Exit codes

`0` means the command passed or an advisory-only critic review completed, even when critic warnings were emitted. `1` means semantic checks, formatting checks, coverage, analyzer comparison, download, checksum, extraction, or binary replacement failed. `2` means the CLI arguments or critic inputs were invalid, or the update target platform/path is unsupported.

## Updating

`shp update` is for local developer installs of the released single binary. It checks the current version, resolves a GitHub release, downloads the matching published platform archive, verifies it with `checksums.txt`, and replaces the selected executable path. The published archive matrix follows the native parser target table used by release builds.

Use `shp update --dry-run` to see the selected release, asset, and binary path without downloading. Use `shp update --version v0.4.1` to target a specific newer release. Use `--path PATH` when testing from source or when replacing a custom installed binary; if that path already exists, it must identify as the Shape CLI and report a valid version.

CI should continue installing pinned releases through the setup action or installer script instead of calling `shp update`.
