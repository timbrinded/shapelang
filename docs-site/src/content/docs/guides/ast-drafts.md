---
title: Generate Drafts from Source
description: Use shp ast to turn source syntax into a conservative generated Shape draft, commit it as checked context, and pin reviewed claims to its syntax anchors.
---

`shp ast source` parses source files with Tree-sitter and prints a Shape draft of their structure. The draft is candidate context for review, not a reviewed claim: every generated function keeps `effects unknown`, and the claims a team maintains belong in authored `.shape` files.

Source parsing supports TypeScript (`.ts`, `.mts`, `.cts`), TSX (`.tsx`), JavaScript and JSX (`.js`, `.jsx`, `.mjs`, `.cjs`, all parsed with the JavaScript grammar), Rust (`.rs`), Go (`.go`), Python (`.py`), and Swift (`.swift`). `--language` overrides the extension; the [CLI Reference](/shapelang/reference/cli/) lists its values and the other flags. Release archives bundle the parsers beside `shp`, so generation downloads nothing. The bundled native parser runs on Linux x64 and arm64 with glibc, macOS arm64, and Windows x64. On musl Linux, generation fails with `unsupported_tree_sitter_platform`.

## What a draft contains

The semantic draft maps code structure onto Shape declarations:

- **Components.** A type becomes a `component` when it owns functions (methods, `impl` blocks, or Go receiver methods) or has a field that looks like state: `repo`, `client`, `store`, `db`, `database`, `queue`, `sender`, `receiver`, `connection`, or `pool`. A file's free functions go into a `<File>Module` component.
- **Functions.** Each function becomes an `fn` under its owner, with a `source` reference and `effects unknown`. A reference names the declaration's symbol, such as `src/audit/store.rs#AuditStore.append_event`, or only the file when no stable symbol exists, so moving lines does not change the draft.
- **Resources.** A type that is not a component becomes a `resource` only when its name ends in `Event`, `Record`, `Message`, `Config`, `State`, `Entity`, `Snapshot`, `Request`, `Response`, `Table`, `Queue`, `Topic`, or `Payload`. Any other such type is left out.
- **Calls.** A call through `self.`, `this.`, or a Go receiver to a field whose declared type is another generated component becomes a `relation` of kind `calls`. Calls that cannot be resolved that way are left out.
- **Implementations.** Each component gets an `implementation <Name>Impl` listing its source file. It has no `on_change` clause, so it never governs paths for coverage.
- **AST anchors.** Each generated type, resource, and function gets an AST anchor: a resource with the `GeneratedAstAnchor` trait whose `storage ast.anchor("path#symbol")` names one piece of syntax. A `relation` of kind `generated_from` connects the declaration (for a function, its component) to the AST anchor.
- **Marker traits.** Each draft declares two empty marker traits: `GeneratedCandidate`, on every generated component and resource, and `GeneratedAstAnchor`, on every AST anchor. The checker gives neither any meaning.
- **Fingerprints.** An AST anchor carries a fingerprint, a hash of its syntax. The provider `ast.semantic_subtree_v1` hashes a canonical form of the anchored node's subtree: node kinds, field names, child order, attributes, labels, and token text such as identifiers, literals, operators, modifiers, and keywords. It excludes file paths, spans, node IDs, comments, and whitespace, so reformatting, comment edits, and line movement leave it unchanged. A function anchor covers the whole function, body included. A type anchor keeps only the signatures of the functions nested in it, so editing a method body changes the method's fingerprint but not the type's. The `generated_from` relation `expects` the AST anchor's current fingerprint. An `expects ... fingerprint` line in a relation, or a `pin` line in a candidate effect, is a pin: `shp check` compares it with the AST anchor's current fingerprint.
- **Candidate effects.** An `effect candidate` records a guess, not a claim. It is emitted when a function's name or body contains a keyword and the body mentions a generated resource. The first matching group wins: append, add, insert, create, push, write, save, or persist give `Append`; then update, set, mutate, or replace give `Update`; then delete, remove, purge, clear, or drop give `Delete`; then read, get, load, fetch, find, list, or query give `Read`. It has `confidence low` and pins the function's anchor fingerprint. `shp check` validates a candidate's fields, names, and pin, reporting `stale candidate effect pin` when the pin differs from the anchor, but never treats it as a declared effect.

## A generated draft

This Rust file is the input:

```rust
pub struct AuditEvent {
    pub id: String,
}

pub struct AuditRepo;

impl AuditRepo {
    pub fn insert(&self, _event: AuditEvent) {}
}

pub struct AuditStore {
    repo: AuditRepo,
}

impl AuditStore {
    pub fn append_event(&self, event: AuditEvent) {
        self.repo.insert(event);
    }
}
```

`shp ast source src/audit/store.rs` prints the draft to stdout under the default module name `generated.ast`; `--module` sets another. The excerpt below keeps the declarations for `AuditStore.append_event`. It omits the `AuditRepo` declarations and the type anchors for `AuditEvent` and `AuditStore`, which follow the same pattern.

```shape
module generated.ast

trait GeneratedAstAnchor {
}

trait GeneratedCandidate {
}

resource AuditEvent : GeneratedCandidate {
  storage rust.type("src/audit/store.rs#AuditEvent")
}

resource AuditStoreAppendEventAstAnchor : GeneratedAstAnchor {
  storage ast.anchor("src/audit/store.rs#AuditStore.append_event")
  fingerprint ast.semantic_subtree_v1("sha256:6486b2f6963404bca81c18eb18ae3f90508215c7a40b81d7734247b2e34c0a5b")
}

component AuditStore : GeneratedCandidate {
  fn append_event
    source rust("src/audit/store.rs#AuditStore.append_event")
    effects unknown
}

relation AuditStoreAppendEventGeneratedFromAuditStoreAppendEventAstAnchor {
  kind generated_from
  connects AuditStore -> AuditStoreAppendEventAstAnchor
  roles { AuditStore as generated, AuditStoreAppendEventAstAnchor as syntax }
  expects AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:6486b2f6963404bca81c18eb18ae3f90508215c7a40b81d7734247b2e34c0a5b")
  summary "fn AuditStore.append_event generated from rust function_item at src/audit/store.rs#AuditStore.append_event."
}

relation AuditStoreCallsAuditRepo {
  kind calls
  connects AuditStore -> AuditRepo
  roles { AuditRepo as destination, AuditStore as origin }
  summary "AuditStore.append_event calls AuditRepo; generated from src/audit/store.rs#AuditStore.append_event."
}

effect candidate AppendEventAppendAuditEventCandidateEffect {
  fn AuditStore.append_event
  effect Append<AuditEvent>
  source rust("src/audit/store.rs#AuditStore.append_event")
  confidence low
  pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:6486b2f6963404bca81c18eb18ae3f90508215c7a40b81d7734247b2e34c0a5b")
}

implementation AuditStoreImpl {
  paths {
    "src/audit/store.rs"
  }
  conforms_to AuditStore
}
```

`AuditStore` is a component because it has a method and a `repo` field. `AuditEvent` has no functions and a data-like name, so it becomes a resource. The `calls` relation comes from `self.repo.insert(event)`, and the candidate effect from the word `insert` next to a mention of `AuditEvent`.

## Commit generated context

`--out-dir` writes one generated file per source file, plus a manifest:

```text
$ shp ast source --out-dir shape/generated/ast src/audit/store.rs
Wrote 1 generated AST Shape file(s) to shape/generated/ast.
```

The draft lands in `shape/generated/ast/src/audit/store.shape` under the module `shape.generated.ast.src.audit.store`, with the same anchors and fingerprints as the stdout draft. `shape/generated/ast/manifest.json` records which files the generator owns:

```json
{
  "version": 1,
  "generatedAt": "deterministic",
  "entries": [
    {
      "module": "shape.generated.ast.src.audit.store",
      "path": "shape/generated/ast/src/audit/store.shape",
      "sources": [
        "src/audit/store.rs"
      ]
    }
  ]
}
```

These rules shape the output tree:

- Each source path is made relative to the workspace root (the git top-level, otherwise the working directory) before the module name, output path, and source references are derived. An absolute path, or a run from a nested directory, produces the same module names and source references. A source outside the workspace is rejected.
- The module name is the module base (default `shape.generated.ast`; `--module` may name a child of it) followed by the source path without its extension, one segment per directory, with characters other than letters, digits, and `_` replaced by `_`. When two sources map to the same module name, the later source, in path order, gets a deterministic `_g` suffix of eight hex digits. Two sources that map to the same output file, such as `foo.ts` and `foo.tsx`, are rejected before anything is written.
- Regeneration rewrites every file the manifest owns and removes owned files that are no longer produced. Other files in the tree, such as authored `.shape` files, are left alone. Hand edits to generated files do not survive regeneration.

Default discovery loads the generated files with the rest of the Shape model. Strict `shp check` accepts their `effects unknown` through a narrow exemption: the unknown-effects diagnostic is suppressed only for a function whose module is `shape.generated.ast` or starts with `shape.generated.ast.`, and whose file lies under `shape/generated/ast/` relative to the repository root (by default, the working directory). Both conditions are required, and the manifest plays no part. The same draft saved anywhere else fails with `error: unknown effects`, as does `effects unknown` in any authored module; see [Effect Model](/shapelang/concepts/effect-model/). The language server does not apply this exemption, so an editor running `shp lsp` shows `error: unknown effects` in generated files that `shp check` accepts. Generated functions also never count as a Shape update for coverage; see [Keep the Model Current](/shapelang/guides/keep-model-current/).

In CI, run the same command with `--check` and the same source list. It regenerates in memory, compares the result with the files the manifest owns, writes nothing, and exits `1` when any owned file is stale, missing, or no longer produced:

```text
$ shp ast source --out-dir shape/generated/ast --check src/audit/store.rs
error: generated AST Shape files are stale

  shape/generated/ast/src/audit/store.shape
```

When everything matches, it prints `Generated AST Shape files are up to date in shape/generated/ast.` and exits `0`.

## Promote and pin reviewed claims

A reviewed claim goes in an authored module. The overlay below imports the generated module, declares the reviewed effect, and pins the syntax it reviewed:

```shape
module audit

import shape.generated.ast.src.audit.store

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn append_event
    source rust("src/audit/store.rs#AuditStore.append_event")
    effects complete {
      Append<AuditEvent>
        evidence rust("src/audit/store.rs#AuditStore.append_event")
    }
}

relation AuditStoreAppendEventReviewedFromAst {
  kind generated_from
  connects AuditStore -> shape.generated.ast.src.audit.store::AuditStoreAppendEventAstAnchor
  roles { AuditStore as reviewed, shape.generated.ast.src.audit.store::AuditStoreAppendEventAstAnchor as syntax }
  expects shape.generated.ast.src.audit.store::AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:6486b2f6963404bca81c18eb18ae3f90508215c7a40b81d7734247b2e34c0a5b")
  summary "Reviewed AuditStore.append_event effects are backed by the generated anchor for src/audit/store.rs#AuditStore.append_event."
}
```

`AuditStore` and `AuditEvent` here are the authored declarations in module `audit`; a local declaration wins over an imported one of the same name. The generated anchor is named with its module qualifier. With the generated file in place, `shp check` passes.

The pin must live in the authored file. Regeneration rewrites every generated file, including the generated `generated_from` relation's `expects`, so a generated pin always matches and cannot detect change. The authored `expects` stays fixed while the anchor it names is regenerated. When the body of `append_event` changes and the context is regenerated, `shp check` fails with exit `1`:

```text
error: stale fingerprint expectation

relation AuditStoreAppendEventReviewedFromAst expects AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1.
expected: sha256:6486b2f6963404bca81c18eb18ae3f90508215c7a40b81d7734247b2e34c0a5b
actual: sha256:baad3fbfa3bd4250ab56bdbf06870eec7ddaf8b6ff15c9fb7a05a2c6d99c535a

caused by:
  - shape/audit.shape: relation AuditStoreAppendEventReviewedFromAst expects AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1
  - shape/generated/ast/src/audit/store.shape: resource AuditStoreAppendEventAstAnchor
  - shape/generated/ast/src/audit/store.shape: resource AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1
```

When the function is renamed or removed, regeneration drops its anchor, and the authored relation names an endpoint that no longer exists:

```text
error: unknown relation_endpoint

relation_endpoint AuditStoreAppendEventAstAnchor is referenced but not declared.

caused by:
  - shape/audit.shape: relation AuditStoreAppendEventReviewedFromAst
```

Either failure means the reviewed syntax changed: review the function again, update the claim, and replace the pinned fingerprint with the `actual:` value from the diagnostic, or the endpoint with the new AST anchor. A change to comments or whitespace alone keeps the pin valid.

## Missing token evidence

A fingerprint needs token text in the anchored subtree. When a declaration has none, generation keeps the draft and exits `0`, but prints a warning on stderr. The anchor is emitted without a fingerprint, its `generated_from` relation has no `expects`, and any candidate effect that would pin it is skipped, so no claim can be pinned to that anchor. This mostly happens with `shp ast json` input that omits `text`. For example, JSON input whose `AuditEvent` struct node has no `text` produces:

```text
warning missing_fingerprint_tokens: src/audit/store.rs:src_audit_store_rs_store_struct_item_18ea0fee4873829e: cannot compute ast.semantic_subtree_v1 for AuditEvent; skipping fingerprint because AST JSON/source node lacks token text or semantic child tokens
```

## Adapters and the raw layer

`shp ast json` builds the same draft from syntax another tool has already parsed. It reads exactly one JSON file; Shape never exports AST JSON. The input has this contract:

- The top level has `files` (required) and an optional `language`.
- Each file has `path`, `root` (the ID of its root node), and `nodes`, a flat list. It may set its own `language`. The language comes from the file, then the top level, then the path's extension; with none of these, generation fails.
- Each node has `id` and `kind`. It may have `text`, `attributes`, `children`, `named` (default `true`), `span`, and `textHash`. `children` lists child IDs, as strings or as `{ "id": ..., "field": ... }` objects.
- `attributes` is a flat map of strings, numbers, booleans, and `null`. Nested structure belongs in child nodes; a nested attribute is rejected.
- Declarations are recognised by Tree-sitter kind names. Types are `struct_item`, `enum_item`, `class_declaration`, `class_definition`, `interface_declaration`, `type_declaration`, and `type_spec`; implementation blocks are `impl_item` and `implementation_item`; functions are `function_item`, `function_declaration`, `function_definition`, `method_definition`, and `method_declaration`. Nodes of other kinds produce no declarations; they still count toward fingerprints and appear in the raw layer.
- A declaration's name comes from `attributes.name`, then from a `name` field child or an identifier child, then from the node's `text`.
- `text` also feeds the heuristics: a type becomes a component through a state-like field only when its `text` shows that field.
- The input is rejected for duplicate node IDs, a missing root or child, a node with two parents, a cycle, or a node unreachable from its root.

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

`shp ast json --module generated.audit ast.json` turns this into a component with its anchor. This excerpt omits the `generated_from` relation and the implementation:

```shape
module generated.audit

trait GeneratedAstAnchor {
}

trait GeneratedCandidate {
}

resource AuditStoreAstAnchor : GeneratedAstAnchor {
  storage ast.anchor("src/audit/store.rs#AuditStore")
  fingerprint ast.semantic_subtree_v1("sha256:cbb49cae1bb3702d7fc08059d759b7f133a60087b6f654cd3ea8b53b05dae9be")
}

component AuditStore : GeneratedCandidate {
}
```

The raw layer records every syntax node, which helps when debugging an adapter or preserving exact parser provenance. `--include-ast-layer` adds it to the stdout draft; `--raw-out PATH` writes it to a separate file under the module `<module>.raw` while stdout keeps the semantic draft. Each file and node becomes a generated resource with `storage ast.file(...)` or `storage ast.node(...)`, and each parent-child edge becomes a `relation` of kind `ast_child`. The 19-line Rust file above yields 100 raw resources. The two options exclude each other, and neither combines with `--out-dir`.

## Swift notes

Swift drafts come from syntax alone; no Swift compiler, Xcode, or SwiftPM configuration is loaded.

- Classes, structs, enums, actors, protocols, and extensions supply types. Functions, protocol requirements, initializers, deinitializers, subscripts, and computed properties supply functions, including a SwiftUI view's computed `body` even when the view has no other methods. Stored properties are part of the type's syntax. Local functions stay inside their enclosing function's syntax, and types declared inside functions, with anything nested in them, produce nothing.
- A Swift type becomes a component unless it is a single declaration with no functions, no state-like field, and a data-like name (the resource suffixes above), in which case it becomes a resource.
- Within a file, extensions are grouped with their type and keep separate anchors. Nested types use qualified names such as `Outer.Inner.run()`.
- References include parameter labels and types, generic parameters, and return and effect syntax, such as `AuditStore.load(id:Int) -> AuditEvent ?` or `AuditStore.save(_:AuditEvent) async throws`. A constrained extension keeps its `where` clause, and a protocol requirement ends in `[requirement]`. These are review conventions, not compiler symbol IDs. Ambiguous duplicate signatures produce a warning and file-only references.
- Every Swift function keeps `effects unknown`, and Swift drafts contain no inferred calls or candidate effects. Macros are not expanded, `#if` branches are not chosen, protocol and generic dispatch are not resolved, actor isolation is not proven, and types are not merged across files.
- Fingerprints use parser tokens, so literal URLs, raw and multiline strings, interpolation, and Unicode are part of the evidence, while comments and formatting outside literals are not. Type anchors exclude method and computed-property bodies; function anchors include them.

An authored Swift claim uses the same reference syntax:

```shape
module swift.audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn save
    source swift("Sources/AuditStore.swift#AuditStore.save(_:AuditEvent) async throws")
    effects complete {
      Append<AuditEvent>
        evidence swift("Sources/AuditStore.swift#AuditStore.save(_:AuditEvent) async throws")
    }
}
```
