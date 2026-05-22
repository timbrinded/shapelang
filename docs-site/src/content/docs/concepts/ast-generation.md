---
title: AST Generation
description: How `shp ast` turns source syntax into conservative Shape drafts.
sidebar:
  order: 11
---

`shp ast` helps bootstrap a Shape model from code. It is intentionally conservative: Tree-sitter can show syntax, but it cannot prove the architecture contract that the team intends to maintain.

The command builds a Code Semantic Graph from source or normalized JSON. That graph keeps raw parser facts, source spans, text hashes, containers, functions, resources, candidate references, confidence, and diagnostics. The default Shape output then keeps only review-sized architecture candidates.

## Default semantic draft

The semantic draft maps stable code concepts into Shape:

- files, modules, classes, structs, and stateful types become `component` candidates
- methods and functions become `fn` entries under the nearest owner when the owner is clear
- durable data concepts become `resource` only when the name or input evidence supports it
- high-confidence resolved calls become `relation kind calls`
- unresolved references stay out of prelude `calls`
- every generated function uses `effects unknown`

That last point is deliberate. A generated draft should be reviewable, not falsely complete.

```shape
module generated.audit

trait GeneratedCandidate {
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
```

This parses as Shape, but `effects unknown` remains a checker-visible review blocker until a human or agent records reviewed effects.

## Raw AST trace

The raw AST layer is opt-in because large files can produce thousands of syntax nodes. Use it when debugging a generator adapter or preserving exact parser provenance.

```bash
shp ast source --language rust --include-ast-layer src/audit/store.rs
shp ast json --module generated.audit --raw-out ast.raw.shape ast.json
```

When enabled, AST files and nodes become generated resources, parent-child edges become `relation kind ast_child`, and node metadata is stored in `storage ast.node(...)`.

## JSON fallback

Use `shp ast json` when another tool already parsed the code. The JSON input must declare files, a root node, and a flat node list. Nested structure belongs in child nodes, not nested attributes, so every raw node can be accounted for deterministically.

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
