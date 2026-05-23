---
title: AST Generation
description: How `shp ast` turns source syntax into conservative Shape drafts.
sidebar:
  order: 11
---

`shp ast` helps bootstrap a Shape model from code. It is intentionally conservative: Tree-sitter can show syntax, but it cannot prove the architecture contract that the team intends to maintain.

The primary path is `shp ast source`: parse source files, project syntax evidence into a Code Semantic Graph, and print a review-sized Shape draft. `shp ast json` is only an input adapter for tools that already parsed the code; Shape does not generate AST JSON from `.shape` files.

## Default semantic draft

The semantic draft maps stable code concepts into Shape:

- files, modules, classes, structs, and stateful types become `component` candidates
- methods and functions become `fn` entries under the nearest owner when the owner is clear
- durable data concepts become `resource` only when the name or input evidence supports it
- high-confidence resolved calls become `relation kind calls`
- compact `GeneratedAstAnchor` resources and `generated_from` relations point semantic claims back to syntax evidence
- AST anchors carry `ast.semantic_subtree_v1` fingerprints so reviewed claims can pin exact syntax evidence without putting hashes in resource names
- generated `effect candidate` declarations record machine-readable effect hints without claiming reviewed completeness
- unresolved references stay out of prelude `calls`
- every generated function uses `effects unknown`

That last point is deliberate. A generated draft should be reviewable, not falsely complete. When generated drafts live under `shape/generated/ast` with `shape.generated.ast...` module names, `shp check` treats their unknown effects as candidate evidence. Authored `.shape` files still fail on `effects unknown`.

```shape
module shape.generated.ast.audit

trait GeneratedCandidate {
}

trait GeneratedAstAnchor {
}

resource AuditEvent : GeneratedCandidate {
  storage rust.type("src/audit/store.rs:1-3")
}

component AuditStore : GeneratedCandidate {
  fn append_event
    source rust("src/audit/store.rs:20-22")
    effects unknown
}

effect candidate AppendEventAppendAuditEventCandidate {
  fn AuditStore.append_event
  effect Append<AuditEvent>
  source rust("src/audit/store.rs:20-22")
  confidence low
  pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}

implementation AuditStoreImpl {
  paths {
    "src/audit/store.rs"
  }
  conforms_to AuditStore
}

resource AuditStoreAstAnchor : GeneratedAstAnchor {
  storage ast.anchor("src/audit/store.rs:9-11")
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}

relation AuditStoreGeneratedFromAuditStoreAstAnchor {
  kind generated_from
  connects AuditStore -> AuditStoreAstAnchor
  roles { AuditStore as generated, AuditStoreAstAnchor as syntax }
  expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  summary "component AuditStore generated from rust struct_item at src/audit/store.rs:9-11."
}
```

This parses as Shape. If the same draft is written under `shape/generated/ast`, it can also participate in `shp check` as candidate context while reviewed effects live in authored overlays.

Generated fingerprint pins are draft-local examples and update whenever the draft is regenerated. To detect stale reviewed evidence, put the reviewed claim in an authored `.shape` file and keep its `expects ... fingerprint ...` value there. On a later regeneration, `shp check` compares the authored expectation with the current generated anchor resource.

`ast.semantic_subtree_v1` hashes a canonical node-specific subtree, not the entire AST JSON or whole file. It excludes file paths, spans, generated node IDs, comments, and whitespace. It includes the node kind, field structure, child order, and actual semantic tokens such as identifiers, literals, operators, modifiers, and keywords.

## Authored relations to AST anchors

Generated files are context. Reviewed claims belong in authored modules. An authored module can point at generated AST evidence by importing the generated module and connecting a reviewed component or resource to the generated anchor.

For example, a generated file under `shape/generated/ast/src/audit/store.shape` might contain:

```shape
module shape.generated.ast.src.audit.store

trait GeneratedAstAnchor {
}

resource AuditStoreAppendEventAstAnchor : GeneratedAstAnchor {
  storage ast.anchor("src/audit/store.rs:20-22")
  fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}
```

Then an authored overlay can pin a reviewed architectural claim to that exact AST anchor:

```shape
module audit.reviewed

import shape.generated.ast.src.audit.store

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn append_event
    source rust("src/audit/store.rs:20-22")
    effects complete {
      Append<AuditEvent>
        evidence rust("src/audit/store.rs:20-22")
    }
}

relation AuditStoreAppendEventReviewedFromAst {
  kind generated_from
  connects AuditStore -> shape.generated.ast.src.audit.store::AuditStoreAppendEventAstAnchor
  roles { AuditStore as reviewed, shape.generated.ast.src.audit.store::AuditStoreAppendEventAstAnchor as syntax }
  expects shape.generated.ast.src.audit.store::AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
  summary "Reviewed AuditStore.append_event effects are backed by the generated AST anchor for src/audit/store.rs:20-22."
}
```

That relation gives agents a precise bridge: `AuditStore.append_event` is the reviewed Shape claim, and `AuditStoreAppendEventAstAnchor` is the generated syntax evidence to inspect in code. If the function body or signature changes and the generated anchor fingerprint changes, `shp check` reports the authored relation as stale. If the function is renamed or removed and the generated anchor disappears, the authored relation fails as an unresolved endpoint.

## Raw AST trace

The raw AST layer is opt-in because large files can produce thousands of syntax nodes. Use it when debugging a generator adapter or preserving exact parser provenance.

```bash
shp ast source --language rust --include-ast-layer src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
```

When enabled, AST files and nodes become generated resources, parent-child edges become `relation kind ast_child`, and node metadata is stored in `storage ast.node(...)`.

Choose either `--include-ast-layer` for one combined stdout draft or `--raw-out PATH` for a sidecar raw trace. The two raw trace modes are mutually exclusive.

## Checked generated files

For durable agent context, generate one source-area-shaped file tree under `shape/generated/ast`:

```bash
shp ast source --language rust --out-dir shape/generated/ast src/audit/store.rs
shp ast source --language rust --out-dir shape/generated/ast --check src/audit/store.rs
```

The manifest records generated modules and source inputs. The checker trusts generated `effects unknown` only for files whose module and path appear in that manifest. The `--check` form regenerates in memory and fails when the checked-in generated files differ, which lets CI catch stale anchors, stale fingerprints, and missing generated context.

This repository commits its own generated AST context under `shape/generated/ast`. Use:

```bash
bun run ast:generate
bun run ast:check
```

Those scripts use tracked first-party source files only. They exclude dependency, build, and generated parser output such as `node_modules`, `dist`, `docs-site/dist`, `shape/generated`, and `packages/shp-checker/src/language/generated`.
CI, `bun run shape:ci`, and release validation run `bun run ast:check`, so source changes that stale the committed AST context fail until the generated files are refreshed. Generation rejects source sets that would collide after module/path normalization.

## JSON input adapter

Use `shp ast json` when another tool already parsed the code. The JSON input must declare files, a root node, and a flat node list. Nested structure belongs in child nodes, not nested attributes, so every raw node can be accounted for deterministically. Semantic anchors require token/source text in the relevant node subtree so the same `ast.semantic_subtree_v1` provider can be computed; JSON that only supplies structural IDs for anchored nodes is rejected.

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
