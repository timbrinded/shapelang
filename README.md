# Shape

Shape is a typed architecture conformance language for making architectural claims explicit and checkable.

Application code can be messy, implicit, and spread across many files. Shape gives the system a small human-readable model in `.shape` files:

- resources, traits, and invariants
- components, ownership, capabilities, and structural relations
- function effect summaries with source evidence
- model updates for architecture changes
- coverage rules for governed source paths
- bindings that require paired review-surface changes, such as docs updates
- typed design memory for refactor-sensitive functions
- constrained project rules such as hypercycle bans over the structural hypergraph

The checker does not prove the application implementation is correct. It checks that the declared architecture model is coherent. That is the product boundary: humans and LLMs write reviewable claims, then a deterministic checker accepts or rejects those claims.

![Shape workflow infographic](docs/shape-workflow.png)

## Quick Start

Install the released `shp` typechecker binary. Pin the version in scripts and CI so checks are reproducible.

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.8.0/install.sh | sh
```

On Windows:

```powershell
irm https://github.com/timbrinded/shapelang/releases/download/v0.8.0/install.ps1 | iex
```

Run the checker from a repo that contains Shape files:

```bash
shp check
shp check --allow-unknown-effects draft.shape
shp fmt --check
shp coverage --changed-files changed.txt
shp memory
shp obligations
shp inspect --json > shape-model.json
shp lsp
```

`--allow-unknown-effects` is a local authoring aid: it reports `effects unknown` as a warning while every other diagnostic remains blocking. Resolve those warnings and run strict `shp check` before review or CI.

For local developer installs, update the released binary explicitly:

```bash
shp update
shp update --dry-run
```

`shp update --path PATH` can replace a custom install path, but an existing target
must already identify itself as the Shape CLI and report a valid version.

`shp check` scans these paths when no files are provided:

```text
shape/**/*.shape
```

In GitHub Actions, install the same pinned release with the setup action:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: timbrinded/shapelang@v0.8.0
  - run: shp check
```

Manual archive downloads are available on the GitHub release if you do not want to run the installer script.

### Use with Claude Code

Shape's authoring, review, and visualization skills ship as a Claude Code plugin. Add the marketplace and install the plugin:

```text
/plugin marketplace add timbrinded/shapelang
/plugin install shapelang@shapelang-local
/reload-plugins
```

This adds the `shapelang:shape-lang`, `shapelang:shape-contract-preflight`, `shapelang:shape-contract-guard`, `shapelang:shape-index`, `shapelang:shape-review`, and `shapelang:unix-system-visualiser` skills. The skills drive the `shp` CLI, so install the binary above and keep it on your `PATH`.

## What It Catches

The first core use case is append-only resource protection.

If a resource is declared `AppendOnly`, then a function that emits `HardDelete<Resource>` is rejected even if the component grants that effect. Final forbids win over grants.

Shape also covers:

- unknown effects in protected components
- missing grants for declared function effects
- governed source files changed without a Shape update or current attestation
- Shape-affecting files changed without a bound docs update or `docs_not_needed` attestation
- refactor-sensitive functions changed without a recorded reevaluation
- required design context or descriptions missing from non-obvious function shapes
- semantic hypercycles in the structural hypergraph with witness paths
- project-specific rules like "only Gateway may provide JsonRpcEndpoint", expressed over `provides` relation hyperedges
- optional analyzer hints for obvious `DELETE`, `TRUNCATE`, and `DROP` operations

See [Refactor Constraints](docs-site/src/content/docs/concepts/refactor-constraints.md) for the design-memory workflow around rationale, memory, and reevaluation.

## Example Shape File

Shape files use the `.shape` extension. This example declares an append-only audit resource and two allowed functions:

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>

  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }

  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts#listEvents")
    }
}
```

A source-backed model update can add a new function directly to the global Shape model:

```shape
module audit

component AuditStore {
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

That model update fails because `AuditEvent : AppendOnly` derives a final forbid for `HardDelete<AuditEvent>`.

## How It Works

The checker pipeline is:

1. Parse `.shape` files with Langium.
2. Lower declarations into facts such as resources, traits, effects, grants, relation hyperedges, and governed paths.
3. Evaluate deterministic rules.
4. Emit diagnostics with provenance, including the declarations that caused a violation.

The optional analyzer is advisory only: it can flag suspicious omissions, but `.shape` remains the source of truth.

`shp inspect --json` uses the same recursive discovery, parser, canonical lowering,
and module-reference resolution as the other Shape commands. Its JSON includes
documents, qualified declaration IDs, functions and effects, relations,
implementations, bindings, rules, memories, and aggregate counts. The export has
an explicit authored or generated-AST origin, an explicit schema version, and no
clock-derived timestamp, so identical inputs produce identical output. It is a data export, not a conformance result; run
`shp check` before consuming it as an accepted architecture model.

## Commands

```bash
shp check
shp check --changed-files changed.txt
shp coverage --changed-files changed.txt
shp fmt --check
shp explain AuditEvent
shp graph show Gateway --kind calls
shp graph stats --kind calls
shp inspect --json > shape-model.json
shp memory
shp obligations
shp lsp
shp author --changed-files changed.txt --component AuditStore
shp author --changed-files changed.txt --component AuditStore --diff pr.diff --prompt --shape-files shape/audit.shape --snippet-files src/audit/purge.ts
shp author --changed-files changed.txt --diff pr.diff --critic-prompt proposed.shape --shape-files shape/audit.shape --snippet-files src/audit/purge.ts
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape src/audit/purge.ts
shp ast source --language rust --module generated.audit src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
shp update --dry-run
```

`shp check` scans `shape/**/*.shape` when no files are provided. Any `.shape` file under `shape/` is part of the checked model.

Useful commands:

- `shp check`: run conformance checks.
- `shp coverage --changed-files changed.txt`: enforce Shape updates or current attestations for governed paths.
- `shp check --changed-files changed.txt`: run semantic checks, coverage, and bindings together.
- `shp fmt --check`: verify canonical formatting.
- `shp explain AuditEvent`: show derived facts and incident relations for a symbol.
- `shp graph all [--kind KIND]`: print the whole hypergraph grouped by kind.
- `shp graph show SYMBOL [--kind KIND]`: print the hyperedges incident to a component or resource.
- `shp graph stats [--kind KIND]`: print aggregate vertex, hyperedge, and incidence counts.
- `shp inspect --json [files...]`: export the effective model as deterministic, versioned JSON for local tools and visualizers.
- `shp memory`: list rationale and memory entries that protect design context.
- `shp obligations`: list open design-memory obligations such as missing rationale or reevaluation.
- `shp lsp`: serve Shape diagnostics, hover, definitions, completions, and formatting over the Language Server Protocol on stdio.
- `shp author --changed-files changed.txt --component AuditStore [--module module.name]`: generate a conservative global-model draft from changed files.
- `shp author ... --diff pr.diff --prompt --shape-files shape/audit.shape [--snippet-files src/audit/purge.ts] [--project-prelude prelude.shape] [--instructions TEXT]`: emit a provider-neutral prompt bundle containing explicit review context and the conservative draft. Shape does not invoke a model provider.
- `shp author ... --diff pr.diff --critic-prompt proposed.shape --shape-files shape/audit.shape [--snippet-files src/audit/purge.ts] [--project-prelude prelude.shape] [--instructions TEXT]`: write a provider-neutral critic prompt to stdout and deterministic advisory warnings to stderr. Warnings remain exit `0`; malformed input exits `2`.
- `shp analyze --shape-files fixtures/pass/append_only_append/audit.shape src/file.ts`: compare obvious source hints against declared effects.
- `shp ast source [--language LANG] [--module NAME] src/file.rs`: parse source with Tree-sitter and print a conservative Shape draft with compact AST anchors and semantic fingerprints.
- `shp ast json [--module NAME] [--include-ast-layer] ast.json`: read normalized AST JSON from another parser, with raw AST resources opt-in.
- `shp update`: update a local released binary from GitHub Releases.

### Editor Integration

`shp lsp` runs the language server over standard input and output. Configure an
LSP-capable editor to launch `shp` with `["lsp"]` as its arguments. The server
publishes checker diagnostics, hover text, go-to-definition locations,
completions, and canonical document formatting.

The server loads `shape/**/*.shape` from each initial workspace folder and
overlays unsaved open documents before checking the model. This keeps imported
modules available to semantic diagnostics instead of checking each file in
isolation. Editors that support format-on-save should invoke
`textDocument/formatting`; the server does not rewrite files on its own.

The authoring prompt and critic modes require a non-empty unified diff and an explicit comma-separated `--shape-files` list. Relevant source snippets and a project prelude are opt-in context files; their paths stay labeled in the prompt. The generated draft remains file-scoped with `effects unknown` wherever semantics are uncertain; it never derives numbered source references or invents resources and destructive effects. Critic mode inspects added diff lines for destructive operations and source-backed guarded functions for missing reevaluation, but it reports file paths and code evidence without authoring line-number references. It does not invoke a provider, subprocess, network service, or checker pass. Its warnings are advisory; review and fold the proposed update into the owning global model, refine references to stable `#symbol` anchors when supported, then run `shp fmt --check` and strict `shp check --changed-files changed.txt` as the final gate.

## Project Layout

```text
shape/
  checker.shape
  delivery.shape
  language.shape
  tooling.shape

fixtures/
  pass/
  fail/

packages/
  shp-checker/
  shp-cli/

docs-site/
  src/content/docs/
```

The implementation currently lives in two packages:

- `@shape/shp-checker`: parser, formatter, fact lowering, rule checks, authoring helpers, editor primitives, and analyzer hints.
- `@shape/shp-cli`: command-line wrapper around the checker package.

The Starlight documentation site lives in `docs-site/` and is configured for static publishing under `/shapelang/`.

## Local Development

Use the Bun workspace only when contributing to Shape itself. Contributing also
requires Node 24+ on `PATH`: `bun run langium:generate` and `bun run docs:check`
invoke tooling through Node, and CI pins Node 24 (the repo ships an `.nvmrc`).

```bash
bun install --frozen-lockfile
bun run langium:generate
bun shp check
bun run changed-files
bun run shape:ci
bun test
bun run typecheck
bun run docs:check
```

Run the docs site locally:

```bash
bun run docs:dev
```

Build release archives locally:

```bash
bun run build:release
```

Release archives are written under `dist/release/`, which is ignored by git.
Each archive includes the `shp` executable, `LICENSE`, and bundled Tree-sitter parser assets used by `shp ast source` for TypeScript, TSX, JavaScript/JSX, Rust, Go, and Python.

## Contributing

Before opening changes, run the local development checks. Documentation changes should keep complete `shape` code fences parseable; use `shape no-verify` only for intentional fragments. CLI behavior changes should update the README, docs quickstart, and CLI reference together.

## Docs Deployment

The docs site is configured for GitHub Pages at `https://timbrinded.github.io/shapelang/`.

GitHub Pages should use the **GitHub Actions** publishing source. The deployment workflow builds `docs-site`, uploads `docs-site/dist`, and publishes the artifact with the Pages deployment actions.

## CI

CI is wired in `.github/workflows/shape.yml` for generated AST freshness, formatting, tests, typechecking, `shp check --changed-files changed.txt`, Shape coverage/bindings, and docs checks. Governed source changes require a faithful `shape` update or a narrow current attestation; bound docs surfaces must change unless a current `docs_not_needed` attestation explains why not.

## Release

Release preparation synchronizes the CLI and both plugin manifest versions,
updates pinned public docs, audits all six shipped skills, and passes the full
repository suite. Run the `Release Candidate: Skills` workflow on the exact
`master` commit first. Its static skill conformance and focused behavioral
canaries are blocking, and its final
`skills-release-approval` environment requires a manual reviewer.

Only after that exact commit has a successful, manually approved candidate run
may a maintainer create `v0.8.0`. The release workflow rejects tags that are not
current `master`, lack that approval, or disagree with package/plugin metadata.
It validates and builds the release, publishes archives and checksums, then
installs the published binary through the setup action on Linux and Windows.
The plugin tag `shapelang--v0.8.0` must point at the same commit.

See [RELEASING.md](RELEASING.md) for the complete preparation, manual gate,
tagging, and post-release verification checklist.

Other GitHub Actions workflows can install `shp` with the setup action shown in Quick Start. Use `with.version` to install a different release than the action ref:

```yaml
- uses: timbrinded/shapelang@master
  with:
    version: v0.8.0
```

## License

BSD 3-Clause
