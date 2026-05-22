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
- unresolved references stay out of prelude `calls`
- every generated function uses `effects unknown`

That last point is deliberate. A generated draft should be reviewable, not falsely complete.

```shape
module generated.audit

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

implementation AuditStoreImpl {
  paths {
    "src/audit/store.rs"
  }
  conforms_to AuditStore
}

resource AuditStoreAstAnchor : GeneratedAstAnchor {
  storage ast.anchor("{\"target\":\"AuditStore\",\"targetKind\":\"component\",\"nodeId\":\"...\",\"path\":\"src/audit/store.rs\",\"language\":\"rust\",\"kind\":\"struct_item\",\"source\":\"src/audit/store.rs:9-11\"}")
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

This parses as Shape, but `effects unknown` remains a checker-visible review blocker until a human or agent records reviewed effects.

Generated fingerprint pins are draft-local examples and update whenever the draft is regenerated. To detect stale reviewed evidence, put the reviewed claim in an authored `.shape` file and keep its `expects ... fingerprint ...` value there. On a later regeneration, `shp check` compares the authored expectation with the current generated anchor resource.

`ast.semantic_subtree_v1` hashes a canonical node-specific subtree, not the entire AST JSON or whole file. It excludes file paths, spans, generated node IDs, comments, and whitespace. It includes the node kind, field structure, child order, and actual semantic tokens such as identifiers, literals, operators, modifiers, and keywords.

## Raw AST trace

The raw AST layer is opt-in because large files can produce thousands of syntax nodes. Use it when debugging a generator adapter or preserving exact parser provenance.

```bash
shp ast source --language rust --include-ast-layer src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
```

When enabled, AST files and nodes become generated resources, parent-child edges become `relation kind ast_child`, and node metadata is stored in `storage ast.node(...)`.

Choose either `--include-ast-layer` for one combined stdout draft or `--raw-out PATH` for a sidecar raw trace. The two raw trace modes are mutually exclusive.

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
