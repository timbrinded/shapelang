---
title: CLI Reference
description: Every shp command with its flags, output streams, and exit codes, plus file discovery and language-server setup.
---

The released `shp` binary (version `0.9.0` / tag `v0.9.0`) exposes the commands below. Every command accepts `--help` (`-h`). `shp --version` (`-v`) prints the installed version.

## Commands

| Command | Purpose |
| --- | --- |
| [`check`](#shp-check) | Run the semantic checks; with `--changed-files`, also coverage and bindings. |
| [`coverage`](#shp-coverage) | Run the semantic checks plus changed-file coverage, without bindings. |
| [`attest prune`](#shp-attest-prune) | Delete the attestations that are unchanged from a base model. |
| [`fmt`](#shp-fmt) | Rewrite Shape files in canonical form, or check that they already are. |
| [`explain`](#shp-explain) | Print the derived facts and incident relations for one symbol. |
| [`graph`](#shp-graph) | Print the relation hypergraph, one symbol's incident relations, or aggregate counts. |
| [`inspect`](#shp-inspect) | Export the effective Shape model as deterministic, versioned JSON. |
| [`lsp`](#shp-lsp) | Serve diagnostics and editor requests over the Language Server Protocol. |
| [`memory`](#shp-memory) | List rationale and memory entries grouped by target. |
| [`obligations`](#shp-obligations) | List open design-memory obligations. |
| [`author`](#shp-author) | Emit a conservative draft, an authoring prompt, or a critic prompt with advisories. |
| [`analyze`](#shp-analyze) | Scan source for destructive-operation hints, optionally against declared effects. |
| [`ast`](#shp-ast-source-and-shp-ast-json) | Generate a conservative Shape draft from source files or from AST JSON. |
| [`update`](#shp-update) | Replace a locally installed released binary with another GitHub release. |

## File discovery

With no file arguments, the commands that read the Shape model (`check`, `coverage`, `fmt`, `explain`, `graph`, `inspect`, `memory`, and `obligations`) read every file matching `shape/**/*.shape` under the working directory. The scan is recursive, sorted, and includes vendored domain packs under `shape/vendor/` (see [Domain Packs](/shapelang/guides/domain-packs/)). Explicit file arguments replace discovery entirely: only the named files are read, so omitting a file drops its declarations and rules from the check.

`analyze --shape-files` and `author --shape-files` never discover; they read only the comma-separated list they are given. `shp lsp` discovers per workspace folder, as described in [its entry](#shp-lsp).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed. For `check` and `coverage`, no blocking diagnostic remains; unknown-effects warnings under `--allow-unknown-effects` do not block. For `fmt`, every file is formatted. For `analyze --shape-files`, no warnings. The listing commands (`explain`, `graph`, `memory`, `obligations`, `inspect`) exit `0` whenever their input parses, even when the model has errors or open obligations. Critic advisories and AST warnings also exit `0`. |
| `1` | Semantic, coverage, binding, or freshness diagnostics; a `fmt` parse failure or unformatted file; analyzer warnings; `ast source` Tree-sitter parse errors without `--allow-parse-errors`, or stale files under `--check`; `update` download, checksum, extraction, version-verification, or replacement failures; unexpected internal errors. |
| `2` | Unknown or missing flags and arguments; unreadable input files; Shape parse errors in `check`, `coverage`, `explain`, `graph`, `memory`, `obligations`, `inspect`, and `analyze --shape-files`; an invalid `--as-of` date; `inspect` without `--json`; invalid `author` inputs; conflicting `ast` flags and AST generation errors other than parse errors; for `update`, an unsupported platform, an invalid version, a requested version older than the installed one, an invalid `--path` target, or a default target that is a `bun` executable. |

Successful output goes to stdout and failing output to stderr, with these exceptions:

- When `--allow-unknown-effects` leaves only warnings, they go to stdout, followed by `Shape check passed with warnings.` When the same run also has a blocking diagnostic, the warnings go to stderr with it.
- Critic advisories and AST warnings go to stderr while the command exits `0`.
- `shp lsp` reserves stdout for protocol messages.

## shp check

```text
shp check [--allow-unknown-effects] [--changed-files changed.txt] [--base-ref REF | --base-model DIR] [--check-cited-paths] [--as-of YYYY-MM-DD | --strict-freshness] [files...]
```

Parses the Shape model and runs every semantic check. With `--changed-files`, it also runs coverage and bindings, which makes it the single gate recommended for CI.

| Flag | Meaning |
| --- | --- |
| `--allow-unknown-effects` | Allow `effects unknown` as a non-fatal warning while validating drafts. See [Draft validation](#draft-validation). |
| `--changed-files changed.txt` | Path to a newline-delimited changed-file list. Enables coverage and bindings. |
| `--base-ref REF` | Compare attestations against the Shape model at the merge base of `REF` and `HEAD`, read from git. See [Base model](#base-model). |
| `--base-model DIR` | Compare attestations against a copy of the base model in `DIR`, kept at repository paths. Cannot be combined with `--base-ref`. |
| `--check-cited-paths` | Fail when a cited `source` or `evidence` path is not a file in the git repository. See [Cited paths](#cited-paths). |
| `--as-of YYYY-MM-DD` | Freshness reference date (ISO `YYYY-MM-DD`); enforces stale design memory deterministically. See [Freshness](#freshness). |
| `--strict-freshness` | Shorthand for `--as-of` today (UTC); fails when `review_by` is before today. |
| `files...` | Shape files to read. Defaults to `shape/**/*.shape`. |

The changed-file list holds one path per line, relative to the working directory. Surrounding whitespace and blank lines are ignored, `\` becomes `/`, a leading `./` is dropped, and absolute paths are made relative to the working directory. Without the flag, or with an empty list, coverage and bindings check nothing. What counts as covered is described in [Keep the Model Current](/shapelang/guides/keep-model-current/).

A passing run prints `Shape check passed.` to stdout. A failing run prints its diagnostics to stderr and exits `1`; each diagnostic's form is catalogued in [Diagnostics](/shapelang/reference/diagnostics/). When any file fails to parse or cannot be read, the command reports only the parse errors and exits `2` without running semantic checks. A missing or unreadable changed-file list also exits `2`.

```bash
shp check
shp check --changed-files changed.txt
shp check --changed-files changed.txt --base-ref origin/main
shp check --as-of 2026-05-30 shape/gateway.shape
```

### Base model

With `--base-ref REF`, the CLI reads the base model from git at the merge base of `REF` and `HEAD`: every `.shape` file under `shape/` except generated AST, plus the files named on the command line. It reads all of `shape/` even for a narrower check, so an attestation moved out of a file the check does not name is still found. An attestation satisfies coverage or bindings only when its kind, path, and reason are new relative to the base. Each attestation carried over unchanged is reported as `warning: stale attestation`, which does not fail the check. `--base-model DIR` reads the same paths from `DIR`, a copy of the base kept at repository paths, for example `git archive <base> shape | tar -x -C DIR`. A `DIR` with no `.shape` files at those paths exits `2`.

Without either flag, an attestation counts whenever its `.shape` file is in the changed-file list, so an unrelated edit to that file revives every attestation in it. Pass a base in CI. If a base `.shape` file cannot be parsed, for example after a grammar change, the CLI prints a warning and falls back to that declaring-file rule. An unresolvable `REF` exits `2`.

### Cited paths

With `--check-cited-paths`, every `source` or `evidence` path cited by a function, rationale, memory, or reevaluation must be a file in the git repository: tracked, or untracked and not ignored. Each missing path fails the check once with `error: missing cited path`, listing every declaration that cites it. Attestation sources are exempt, so a deleted file can still be attested. The CLI lists the files with `git ls-files`; the checker itself reads no files. Use the flag when cited files can change without a Shape update, for example docs that no implementation governs with `on_change require shape_update`.

### Draft validation

Strict `shp check` rejects `effects unknown` in authored modules. `--allow-unknown-effects` downgrades only that diagnostic to `warning: unknown effects`; every other diagnostic stays blocking, including parse errors, forbidden effects, missing grants, guarded changes, coverage, bindings, and freshness. When warnings are all that remain, the command prints them to stdout, ends with `Shape check passed with warnings.`, and exits `0`:

```text
warning: unknown effects

AuditStore.appendEvent declares effects unknown.

caused by:
  - draft.shape: fn AuditStore.appendEvent

Shape check passed with warnings.
```

The flag is for local drafting. CI runs strict `shp check`. Why unknown and complete summaries differ is explained in [Effect Model](/shapelang/concepts/effect-model/); generated AST modules are exempt without the flag, as described in [Generate Drafts from Source](/shapelang/guides/ast-drafts/).

### Freshness

Freshness is off by default, so `review_by` dates are informational. `--as-of YYYY-MM-DD` turns it on and wins when `--strict-freshness` is also given; `--strict-freshness` alone uses today's UTC date. The CLI reads the clock; the checker compares only the date it is given. Prefer `--as-of` in CI so that a run is reproducible.

A `rationale` or `memory` is stale when its `when { review_by "…" }` date is strictly before the reference date. Missing, non-ISO, and impossible `review_by` values are ignored. Each stale entry fails the check with `error: stale design memory`. An `--as-of` value that is not a real calendar date exits `2`:

```text
error: --as-of expects an ISO YYYY-MM-DD date, received "2026-02-30"
```

`shp obligations` accepts the same two flags and lists stale entries instead of failing. What `review_by` means for design memory is covered in [Design Memory](/shapelang/concepts/design-memory/).

## shp coverage

```text
shp coverage --changed-files changed.txt [--base-ref REF | --base-model DIR] [files...]
```

Runs the same semantic checks as `shp check` plus changed-file coverage, but not bindings.

| Flag | Meaning |
| --- | --- |
| `--changed-files changed.txt` | Required. Path to a newline-delimited changed-file list, in the format described under [`shp check`](#shp-check). |
| `--base-ref REF` / `--base-model DIR` | Compare attestations against a base model, as described under [Base model](#base-model). |
| `files...` | Shape files to read. Defaults to `shape/**/*.shape`. |

`coverage` accepts no `--allow-unknown-effects`, `--as-of`, or `--strict-freshness` flag, so `effects unknown` in an authored module fails it. Output and exit codes match `shp check`. Prefer `shp check --changed-files`, which adds bindings, as the CI gate.

```bash
shp coverage --changed-files changed.txt
```

## shp attest prune

```text
shp attest prune (--base-ref REF | --base-model DIR) [files...]
```

Deletes each attestation whose kind, path, and reason already exist in the base model: the attestations `shp check` reports as `warning: stale attestation`, top-level or an `add` or `modify` entry of a `change` block. Each goes with the whitespace between it and the next declaration, or the whitespace before it when it is the last one in its file or block. Every other byte is kept, so pruned files stay in canonical format, and attestations written for the current change stay.

| Flag | Meaning |
| --- | --- |
| `--base-ref REF` / `--base-model DIR` | Required, one of the two. The base model, as described under [Base model](#base-model). |
| `files...` | Shape files to rewrite. Defaults to `shape/**/*.shape`. |

The command prints `Removed N stale attestation(s) from M file(s).`, or `No stale attestations.`, and exits `0`. Without a base it exits `2`. Git history keeps every removed decision.

```bash
shp attest prune --base-ref origin/main
```

## shp fmt

```text
shp fmt [--check] [files...]
```

Rewrites each file in canonical form, or with `--check` reports the files that differ.

| Flag | Meaning |
| --- | --- |
| `--check` | Check formatting without writing files. |
| `files...` | Shape files to format. Defaults to `shape/**/*.shape`. |

The formatter rebuilds each file from its syntax tree. The rebuild:

- drops every `//` and `/* */` comment, so `shp fmt --check` fails on any file that contains one;
- sorts declarations by kind and then by name, sorts imports, and sorts the members and entries of most blocks;
- merges repeated `protects`, `guards`, `who`, and `when` blocks.

Keep explanations that must survive in `summary`, `description`, or design-memory declarations. Given this input:

```shape
module audit
// Audit events are append-only.
resource AuditEvent : AppendOnly
component AuditStore { owns AuditEvent
  grants Append<AuditEvent>  /* writer */
  fn appendEvent effects complete { Append<AuditEvent> } }
```

`shp fmt` writes:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

`shp fmt` also sorts the entries of a `change` block by their text. When several entries touch one target, this can change the checked result, so give each target at most one entry.

A file that already matches is not rewritten. On success the command prints `Shape format complete.` or, with `--check`, `Shape format check passed.` to stdout. Under `--check`, each differing file is reported as `FILE: not formatted` on stderr. A file that fails to parse is reported as `FILE: MESSAGE` on stderr and left untouched while the other files are still processed. Either failure exits `1`. An unreadable file exits `2`.

```bash
shp fmt
shp fmt --check
```

## shp explain

```text
shp explain SYMBOL [files...]
```

Prints the derived facts and incident relations for one symbol.

`SYMBOL` is a resource, component, relation, rationale, or memory name, or a function written `Component.fn`. It may be module-qualified (`gateway::Gateway`). An unmatched symbol prints `No shape facts found for SYMBOL.` A name that matches more than one declaration prints `Ambiguous shape symbol SYMBOL.` and its candidates. Both cases exit `0`.

```text
$ shp explain AuditEvent
AuditEvent
  kind: resource
  traits:
    AppendOnly

  final forbidden effects:
    HardDelete<AuditEvent>
    Truncate<AuditEvent>
    DropStorage<AuditEvent>

  relations:
    coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)  // Audit writes flow Gateway -> AuditStore -> AuditEvent.
```

## shp graph

```text
shp graph all [--kind KIND] [files...]
shp graph show SYMBOL [--kind KIND] [files...]
shp graph stats [--kind KIND] [files...]
```

Prints the relation hypergraph (`all`), the relations incident to one symbol (`show`), or aggregate counts (`stats`).

| Flag | Meaning |
| --- | --- |
| `--kind KIND` | Filter by relation kind. Any value is accepted; a kind that no relation uses matches nothing. |
| `files...` | Shape files to read. Defaults to `shape/**/*.shape`. |

`graph all` groups relations by kind. It prints `No relations declared.` for an empty graph and `No relations match kind KIND.` when the filter matches nothing. A relation's `summary` follows its line as a trailing `//` comment:

```text
$ shp graph all
Hypergraph

calls:
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)

coordinated_call:
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)  // Audit writes flow Gateway -> AuditStore -> AuditEvent.
```

`graph show SYMBOL` accepts a component, a resource, or a relation name. For a vertex it prints the vertex and each incident relation, or `(no incident relations)`:

```text
$ shp graph show Gateway --kind calls
Gateway (component)
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)
```

`graph stats` counts the whole model and does not accept a symbol:

```text
$ shp graph stats
Hypergraph stats
  vertices: 4 (2 components, 2 resources)
  hyperedges: 2
    calls: 1
    coordinated_call: 1
  incidences: 5
  arity: min 2, max 3, avg 2.50
    widest: coordinated_call AuditWritePath
  isolated vertices: 1
    PolicySnapshot (resource)
```

How relation kinds become traversal steps is explained in [Relations and Graph Rules](/shapelang/concepts/relations/).

### graph stats --kind KIND

With a filter, `graph stats` adds a `filter:` line and scopes the hyperedge, incidence, and arity counts to that kind. Vertex counts still cover the whole model, and `isolated vertices` lists the vertices that no relation of the selected kind touches:

```text
$ shp graph stats --kind calls
Hypergraph stats
  vertices: 4 (2 components, 2 resources)
  filter: kind=calls
  hyperedges: 1 (of 2 total)
    calls: 1
  incidences: 2
  arity: min 2, max 2, avg 2.00
  isolated vertices: 2
    AuditEvent (resource), PolicySnapshot (resource)
```

### Legacy forms

```text
shp graph [SYMBOL] [--kind KIND] [files...]
shp graph --stats [--kind KIND] [files...]
```

These forms remain supported. `shp graph` alone behaves as `graph all`, `shp graph SYMBOL` as `graph show SYMBOL`, and `shp graph --stats` as `graph stats`. A first argument that ends in `.shape` is read as a file, not a symbol. A symbol named `all`, `show`, or `stats` needs `graph show SYMBOL`. `shp graph --stats SYMBOL` exits `2`.

## shp inspect

```text
shp inspect --json [files...]
```

Exports the effective Shape model as deterministic, versioned JSON for local tools such as architecture visualizers.

| Flag | Meaning |
| --- | --- |
| `--json` | Required. Write the versioned effective Shape model as JSON. Without it the command exits `2`. |
| `files...` | Shape files to read. Defaults to `shape/**/*.shape`. |

The command parses the model with the official parser, applies the same lowering and module resolution as the checker, and writes only JSON to stdout. The top-level schema is:

```json
{
  "schemaVersion": 1,
  "shapeVersion": "0.9.0",
  "documents": [],
  "resources": [],
  "components": [],
  "functions": [],
  "relations": [],
  "implementations": [],
  "bindings": [],
  "rules": [],
  "memories": [],
  "stats": {}
}
```

- Declaration records carry a module-qualified `id`, the local `name`, `module`, `file`, and an `origin` of `authored` or `generated_ast`.
- File paths are reported relative to the working directory, so the same checkout, inspected from the same directory, produces the same bytes on any machine.
- Function records carry `effectsComplete` and resolved effect targets. Relation records carry ordered `endpoints` plus `from` and `to` fields for compatibility.
- Order-insensitive arrays use Unicode codepoint order, and the export contains no timestamp.

`inspect` accepts any model that parses and does not run the semantic checks. Run `shp check` first when the consumer needs an accepted model. Consumers must reject a `schemaVersion` they do not support rather than guess at a changed schema.

```bash
shp inspect --json > shape-model.json
```

## shp lsp

```text
shp lsp
```

Serves Shape diagnostics and editor requests over the Language Server Protocol on stdin and stdout. It takes no flags or arguments.

Configure the editor to launch the `shp` executable with `lsp` as its only argument. The server reserves stdout for protocol messages, so do not wrap it in a command that prints banners or logs to stdout.

The server advertises:

- incremental document synchronization with open and close notifications;
- published diagnostics;
- hover;
- go to definition;
- completion, triggered by `.` and `<`, over keywords, prelude names, and every name declared in the workspace;
- whole-document formatting;
- workspace folders, without change notifications.

**Workspace discovery.** At initialization the server takes its roots from the file-backed workspace folders. When there are none, it uses `rootUri`, and failing that, its own working directory. Changes to workspace folders after initialization are not tracked. On every validation the server rescans `shape/**/*.shape` under each root. A validation runs after initialization, whenever a document opens, changes, or closes, and on each watched-file notification. When the client supports dynamic registration of watched files, the server registers a watcher for `**/shape/**/*.shape`.

**Open documents.** The text of an open document replaces its copy on disk. Open `.shape` documents outside the discovered tree join the model too. The whole set is checked as one Shape model, so imported modules resolve across files. The checks match strict `shp check` without a changed-file list: coverage, bindings, and freshness do not run, and `effects unknown` in an authored module is an error. One difference: the server does not apply the generated-AST exemption, so it reports `effects unknown` in `shape/generated/ast/` files that `shp check` accepts (see [Helper APIs](/shapelang/inside-shape/formatter-editor-authoring/#editor-helpers)). Every diagnostic is published with error severity. A semantic diagnostic carries its full `shp check` text and is placed at the first character of the file it names, or of the first document when it names none; a parse error is placed at its reported position. When any document fails to parse, only parse errors are published. A document whose problems disappear, or that closes, receives an empty diagnostic set.

**Hover and definition.** The server looks in the current document first. A declaration in another document is used only when exactly one other workspace document declares the name; with more than one match, the server returns nothing rather than pick a file.

**Formatting.** `textDocument/formatting` returns a single full-document edit containing the `shp fmt` output, so comments are dropped here too. A document that fails to parse, or is already formatted, gets no edit. The server never writes files: format-on-save works when the editor sends `textDocument/formatting` on save.

## shp memory

```text
shp memory [files...]
```

Lists every `rationale` and `memory` entry, grouped by the target it applies to.

Each entry shows its type and, when declared, `status`, `confidence`, `protects`, `owner`, and `review_by`. A model with neither kind prints `No active memory guards.`

```text
$ shp memory
Memory Guards

fn Gateway.derivePolicyDecision
  memory DecisionRefactorConstraint
  type: RefactorConstraint
  status: Unexplained
  confidence: High
  owner: GatewayTeam
  review_by: 2026-01-01
```

## shp obligations

```text
shp obligations [--as-of YYYY-MM-DD | --strict-freshness] [files...]
```

Lists the open design-memory obligations that the checker finds.

| Flag | Meaning |
| --- | --- |
| `--as-of YYYY-MM-DD` | Freshness reference date (ISO `YYYY-MM-DD`); also lists design memory whose `review_by` is before it. |
| `--strict-freshness` | Shorthand for `--as-of` today (UTC); also lists design memory whose `review_by` is before today. |
| `files...` | Shape files to read. Defaults to `shape/**/*.shape`. |

The flags behave as described under [Freshness](#freshness). Output groups the obligations under `missing context:`, `missing description:`, `guarded changes:`, `invalid reevaluations:`, and `stale design memory:`; with none, it prints `No open shape obligations.` Other diagnostics, such as forbidden effects, are not listed. The command exits `0` even when obligations are open, so gate on `shp check`.

```text
$ shp obligations --as-of 2026-05-30
Open Shape Obligations

guarded changes:
  fn gateway::Gateway.derivePolicyDecision changed; requires reevaluation satisfying memory DecisionRefactorConstraint

stale design memory:
  memory DecisionRefactorConstraint review_by 2026-01-01 is before 2026-05-30
```

## shp author

```text
shp author --changed-files changed.txt --component ComponentName [--module module.name]
shp author --changed-files changed.txt --component ComponentName --diff pr.diff --prompt --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]
shp author --changed-files changed.txt --diff pr.diff --critic-prompt proposed.shape --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]
```

Emits a conservative Shape draft for a change set, a provider-neutral authoring prompt, or a critic prompt with deterministic local advisories. No mode calls a model provider or runs the checker; only `shp check` accepts or rejects the result.

| Flag | Meaning |
| --- | --- |
| `--changed-files changed.txt` | Required. Path to a newline-delimited changed-file list. |
| `--component ComponentName` | Component to scaffold. |
| `--module module.name` | Shape module name for the generated draft. |
| `--prompt` | Emit a provider-neutral authoring prompt bundle instead of the draft. |
| `--critic-prompt proposed.shape` | Proposed Shape update to review with a provider-neutral critic prompt. |
| `--diff pr.diff` | Unified PR diff used as context by prompt and critic modes. |
| `--shape-files file1.shape,file2.shape` | Comma-separated existing Shape files required by prompt and critic modes. |
| `--snippet-files file1.ts,file2.rs` | Comma-separated relevant source files for prompt and critic modes. |
| `--project-prelude prelude.shape` | Project prelude context file for prompt and critic modes. |
| `--instructions TEXT` | Additional human direction for prompt and critic modes. |

The mode is chosen by `--prompt`, `--critic-prompt`, or neither:

| Mode | Requires | Also accepts | Rejects | stdout | stderr |
| --- | --- | --- | --- | --- | --- |
| Draft | `--component` | `--module` | `--diff`, `--shape-files`, `--snippet-files`, `--project-prelude`, `--instructions` | Draft Shape | — |
| Prompt (`--prompt`) | `--component`, a non-empty `--diff`, `--shape-files`, and at least one changed file | `--module`, `--snippet-files`, `--project-prelude`, `--instructions` | `--critic-prompt` | Prompt bundle | — |
| Critic (`--critic-prompt FILE`) | A non-empty `FILE`, a non-empty `--diff`, `--shape-files`, and at least one changed file | `--snippet-files`, `--project-prelude`, `--instructions` | `--prompt`, `--component`, `--module` | Critic prompt | Advisories |

Each violation prints a one-line `error:` naming the flag and exits `2`; for example, `error: --prompt requires --shape-files.` In critic mode, a proposed or existing Shape file that fails to parse is reported as `error: failed to parse FILE:LINE:COLUMN: MESSAGE` and exits `2`. Advisories exit `0`.

```bash
shp author --changed-files changed.txt --component AuditStore --module audit
```

The draft, prompt, and critic workflow is described in [Author Updates with an Agent](/shapelang/guides/authoring/).

## shp analyze

```text
shp analyze [--shape-files file1.shape,file2.shape] [source-files...]
```

Scans source files for destructive-operation hints and, with `--shape-files`, compares them with the declared effects.

| Flag | Meaning |
| --- | --- |
| `--shape-files file1.shape,file2.shape` | Comma-separated Shape files to compare against analyzer hints. No other Shape files are read. |
| `source-files...` | Source files to analyze. |

Without `--shape-files`, the command prints one hint per line to stdout, as `PATH:LINE EFFECT [target=TARGET] EVIDENCE`, and exits `0`:

```text
$ shp analyze src/audit/purge.ts
src/audit/purge.ts:2 HardDelete target=audit_events return db.deleteFrom("audit_events");
```

With `--shape-files`, each mismatch is a warning on stderr and any warning exits `1`. With no mismatch, the command prints `Shape analyzer found no mismatches.` to stdout and exits `0`. A listed Shape file that fails to parse exits `2`, as does an unreadable source file.

```text
$ shp analyze --shape-files shape/audit.shape src/audit/purge.ts
warning: analyzer hint missing from shape effects

src/audit/purge.ts:2 suggests HardDelete.
suspected target: audit_events
evidence: return db.deleteFrom("audit_events");
```

The supported patterns, the warning kinds, and the matcher's limits are described in [Analyzer Hints](/shapelang/guides/analyzer/).

## shp ast source and shp ast json

```text
shp ast source [--language LANG] [--module NAME] [--include-ast-layer] [--raw-out PATH] [--out-dir DIR] [--check] [--allow-parse-errors] files...
shp ast json [--module NAME] [--include-ast-layer] [--raw-out PATH] ast.json
```

`ast source` parses source files with Tree-sitter and prints a conservative semantic Shape draft. `ast json` builds the same draft from one normalized AST JSON file produced by another parser.

| Flag | Applies to | Meaning |
| --- | --- | --- |
| `--language LANG` | `source` | Override source language for every input file. Values are listed under [`ast source --language LANG`](#ast-source---language-lang). |
| `--module NAME` | both | Module name for the generated Shape draft. Defaults to `generated.ast`. With `--out-dir` it is a base, defaulting to `shape.generated.ast`, and each file's module appends its source path segments (for example `shape.generated.ast.src.audit.store`). |
| `--include-ast-layer` | both | Include raw AST resources and `ast_child` relations in stdout. |
| `--raw-out PATH` | both | Write the raw AST trace to a sidecar Shape file (module `NAME.raw`) while stdout keeps the semantic draft. |
| `--out-dir DIR` | `source` | Write one generated semantic Shape file per source under `DIR`, plus `DIR/manifest.json`. |
| `--check` | `source` | With `--out-dir`, fail when generated files are not up to date. Writes nothing. |
| `--allow-parse-errors` | `source` | Emit a draft even when Tree-sitter reports syntax errors. |

Constraints, each of which exits `2`:

- `--include-ast-layer` and `--raw-out` are mutually exclusive.
- `--out-dir` rejects `--raw-out` and `--include-ast-layer`.
- `--check` requires `--out-dir`.
- With `--out-dir`, `--module` must be `shape.generated.ast` or a child module, and every source path must be inside the workspace (the git top-level directory, otherwise the working directory). Two sources that map to the same output path are rejected.
- `ast json` takes exactly one file, which must be valid JSON.

The draft goes to stdout. With `--out-dir`, stdout carries a one-line summary instead, such as `Wrote 1 generated AST Shape file(s) to shape/generated/ast.` or, under `--check`, `Generated AST Shape files are up to date in shape/generated/ast.` Warnings go to stderr and exit `0`. A generation failure prints `error: AST generation failed` and its reasons to stderr. Tree-sitter syntax errors without `--allow-parse-errors` exit `1`; other generation errors, such as an unknown file extension, exit `2`. `--check` with stale files prints `error: generated AST Shape files are stale` and each stale path to stderr, and exits `1`.

```bash
shp ast source --out-dir shape/generated/ast src/audit/store.ts
shp ast source --out-dir shape/generated/ast --check src/audit/store.ts
```

The draft contents, the generated-AST exemption for `effects unknown`, the manifest, and the AST JSON input format are described in [Generate Drafts from Source](/shapelang/guides/ast-drafts/).

### ast source --language LANG

| Value | Aliases | Inferred from |
| --- | --- | --- |
| `typescript` | `ts` | `.ts`, `.mts`, `.cts` |
| `tsx` | — | `.tsx` |
| `javascript` | `js`, `jsx` | `.js`, `.jsx`, `.mjs`, `.cjs` |
| `rust` | `rs` | `.rs` |
| `go` | — | `.go` |
| `python` | `py` | `.py` |
| `swift` | — | `.swift` |

Values are case-insensitive. An unsupported value exits `2` before any parser loads. Without `--language`, the extension selects the parser; a file with any other extension is rejected with `pass --language LANG`. Released binaries bundle these parsers.

## shp update

```text
shp update [--version VERSION] [--dry-run] [--path PATH]
```

Replaces a locally installed released `shp` binary, and the parser assets beside it, with a GitHub release.

| Flag | Meaning |
| --- | --- |
| `--version VERSION` | Release to install, written `vX.Y.Z` or `X.Y.Z`. Defaults to the latest release. |
| `--dry-run` | Show the selected release, asset, and binary path without downloading. |
| `--path PATH` | Executable path to replace. Defaults to the running `shp` binary. |

The command runs these steps in order and stops at the first that ends it:

1. **Target.** The target is `--path`, or else the running executable. Without `--path`, a running executable named `bun` or `bun.exe`, as when `shp` runs from source, is refused (exit `2`).
2. **Platform.** Release assets exist for Linux x64, Linux ARM64, macOS ARM64, and Windows x64. Any other platform exits `2`.
3. **Installed version.** Without `--path`, this is the running binary's version. A `--path` that does not exist is treated as a fresh install. An existing `--path` must run `--version` and `--help` successfully, identify as `shp`, and report an `X.Y.Z` version; otherwise the command exits `2`.
4. **Requested version.** An invalid `--version` exits `2`. When it equals the installed version, the command prints `shp X.Y.Z is already installed` and exits `0`. When it is older, the command exits `2`.
5. **Release lookup.** The command reads the requested or latest release of `timbrinded/shapelang` from the GitHub API. Without `--version`, a latest release equal to the installed version prints `shp X.Y.Z is already up to date`, and an older one prints `shp X.Y.Z is newer than latest release vA.B.C`; both exit `0`. A failed request, or a release without the platform archive or `checksums.txt`, exits `1`.
6. **Dry run.** `--dry-run` prints four lines and exits `0` without downloading anything: `would update shp INSTALLED -> TARGET`, then `release: TAG`, `asset: ARCHIVE` (for example `shp-linux-x64.tar.gz`), and `binary: PATH`.
7. **Download and verify.** The command downloads `checksums.txt` and the archive, verifies the archive's SHA-256, and extracts it with `tar`, which must be on `PATH`. The archive must contain the `tree-sitter-language-pack` directory, and the extracted binary's `--version` must report the target version. Any failure here exits `1`.
8. **Replace.** On Linux and macOS, the new binary and `tree-sitter-language-pack` directory are staged beside the target and renamed into place; if the binary cannot be moved, the previous parser directory is restored. The command prints `updated shp A -> B at PATH`. On Windows, the command stages both beside the target and starts a background PowerShell script that waits for `shp` to exit and then moves them into place. It prints `staged shp B; it will replace PATH after this process exits`.

```bash
shp update --dry-run
shp update --version v0.9.0
```

`shp update` is for local installs. CI installs a pinned release through the setup action or installer script, as described in [Run Shape in CI](/shapelang/guides/ci/).
