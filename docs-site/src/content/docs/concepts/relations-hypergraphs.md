---
title: Relations and Hypergraphs
description: Structural dependencies are directed hyperedges declared with relation.
sidebar:
  order: 6
---

Every structural link between components and resources in Shape is a hyperedge in a directed hypergraph. There is no separate binary-dependency model; a pairwise dependency is a hyperedge with two endpoints. Relations are architecture claims the checker and graph tools can evaluate; they are not runtime wiring.

## The structural primitive: `relation`

Structural claims are written at the top level of a module, never inside a `component` block:

```shape
module audit

resource AuditEvent

component Gateway {
}

component AuditStore {
}

relation AuditWritePath {
  kind coordinated_call
  connects Gateway -> AuditStore -> AuditEvent
  summary "Gateway writes audit events only through AuditStore."
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}
```

| Field | Role |
| --- | --- |
| name | Stable hyperedge identifier shown in diagnostics and `shp graph` output. |
| `kind` | Relation kind. Prelude kinds declare arity and traversal semantics for path and hypercycle rules. |
| `connects` | Two or more endpoints. Directional kinds use `A -> B -> C`; unordered custom kinds can use `{ A, B, C }`. |
| `roles` | Optional `{ Gateway as caller, AuditStore as callee }` tags. |
| `expects` | Optional endpoint fingerprint pin for reviewed AST evidence. |
| `summary` | Optional review text. |

Endpoints resolve to components or resources declared in the module set. Unresolved endpoints fail as `unknown relation_endpoint`. A name that is both a component and a resource is an ambiguous endpoint.

## Prelude relation kinds

| Kind | Arity | Cycle / path traversal | Use for |
| --- | --- | --- | --- |
| `calls` | binary | directed `A -> B` | Component calls component |
| `callbacks` | binary | directed `A -> B` | Callback edges, often with `calls` |
| `provides` | binary | directed `component -> resource` | Capability or interface advertisement |
| `coordinated_call` | ordered | path along members | Multi-vertex coordination (saga, audit pipeline) |

Arity and syntax constraints:

- `calls`, `callbacks`, and `provides` require exactly two endpoints written `A -> B`.
- `provides` must connect a component provider to a resource target.
- `coordinated_call` requires ordered `A -> B -> ...` connects with at least two endpoints.

User-defined kinds (for example `generated_from` in AST drafts) may use ordered or unordered connects. They appear in graph output but do not participate in hypercycle or path traversal unless the checker knows directed traversal semantics for that kind.

## Binary dependencies are 2-vertex hyperedges

`connects Gateway -> AuditStore` is a hyperedge with two endpoints. The same `relation` syntax describes pairwise and multi-party structural links, and the same algorithms traverse them.

## Hyperedge incidence

Every component or resource in a relation's `connects` list participates in that hyperedge. Inspect incidence with the graph command:

```bash
shp graph show Gateway
shp graph show Gateway --kind calls
shp graph stats
```

Example incidence output:

```text
Gateway (component)
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)
```

Resources are valid endpoints. `shp graph show AuditEvent` prints relations incident to that resource.

Preferred forms are `graph show`, `graph all`, and `graph stats`. Legacy `shp graph SYMBOL` remains supported except when the symbol is named `all`, `show`, or `stats`.

## Fingerprint expectations

A relation can pin reviewed syntax evidence to a resource fingerprint (commonly a generated AST anchor):

```shape
module audit.reviewed

resource AuditStoreAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}

component AuditStore {
}

relation AuditStoreReviewedFromAst {
  kind generated_from
  connects AuditStore -> AuditStoreAstAnchor
  expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  summary "Reviewed AuditStore claims are backed by the generated AST anchor."
}
```

If the fingerprint diverges or the anchor disappears, `shp check` reports a stale or unresolved pin. See [AST Generation](./ast-generation.md).

## Practice

Do:

- Represent structural dependencies only as top-level `relation` declarations.
- Prefer prelude kinds (`calls`, `callbacks`, `provides`, `coordinated_call`) when path or hypercycle rules should see the edge.
- Name relations stably so diagnostics and graph output stay reviewable.
- Run `shp graph stats` before large relation edits, then `shp graph show SYMBOL --kind KIND` for focused inspection.

Do not:

- Put calls or provides inside a `component` body.
- Use a custom kind in `forbid path` / `forbid hypercycle` filters unless that kind has directed traversal semantics.
- Encode effect policy as relations; use traits, grants, and effect summaries for effects.
- Rely on undeclared “implicit” dependencies; the hypergraph only contains declared relations.

## Related pages

- [Rules and Hypercycles](./rules-hypercycles.md)
- [Components, Ownership, and Grants](./components-ownership-grants.md)
- [CLI Reference](../reference/cli.md)
