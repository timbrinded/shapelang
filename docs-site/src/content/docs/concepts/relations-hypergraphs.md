---
title: Relations and Hypergraphs
description: Structural dependencies in Shape are hyperedges. The architecture model is a directed hypergraph.
sidebar:
  order: 6
---

Every structural link between components and resources in Shape is a hyperedge in a directed hypergraph. There is no separate "binary dependency" model; a pairwise dependency is simply a hyperedge with two endpoints.

## The single structural primitive: `relation`

Structural claims are written at the top level of a module:

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

| Field      | Role |
|------------|------|
| `name`     | Stable hyperedge identifier shown in diagnostics and `shp graph` output. |
| `kind`     | Relation kind. Each kind has declared traversal semantics for hypercycle detection. |
| `connects` | Two or more endpoints. Directional kinds use `A -> B -> C`; unordered custom kinds can use `{ A, B, C }`. |
| `roles`    | Optional `{ Gateway as caller, AuditStore as callee }` tags. |
| `summary`  | Optional review text. |

Endpoints resolve to components or resources declared elsewhere in the module set. Unresolved endpoints are rejected as `unknown relation_endpoint`, and relation endpoints are ambiguous if the same name is declared as both a component and a resource.

## Prelude relation kinds

| Kind               | Arity      | Cycle traversal     | Use for                                                      |
|--------------------|------------|---------------------|--------------------------------------------------------------|
| `calls`            | binary     | directed `A -> B`   | Component calls component                                    |
| `callbacks`        | binary     | directed `A -> B`   | Callback edges, often in conjunction with `calls`            |
| `provides`         | binary     | directed `component -> resource` | Capability or interface advertisement             |
| `coordinated_call` | ordered    | path along members  | Multi-vertex coordination (e.g. saga, audit pipeline)        |

Each prelude kind also constrains arity and syntax: `calls`, `callbacks`, and `provides` require exactly two endpoints written with `A -> B`; `coordinated_call` requires ordered `A -> B -> ...` connects and at least two endpoints. User-defined kinds may use ordered or unordered connects, but they do not participate in hypercycle traversal unless the checker knows their traversal semantics.

## Binary dependencies are 2-vertex hyperedges

Shape does not have a separate binary-dependency primitive. `connects Gateway -> AuditStore` is a hyperedge with `|e| = 2`. The same `relation` syntax describes both pairwise and multi-party structural links, and the same algorithms traverse them.

## Hyperedge incidence

Every component or resource appearing in a relation's `connects` list participates in that hyperedge. The model exposes a vertex-to-hyperedge incidence index, and `shp graph` prints it directly:

```text
$ shp graph Gateway
Gateway (component)
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)
  coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)
```

Resources are valid endpoints. `shp graph AuditEvent` prints the relations incident to that resource.

## See also

- [Rules and Hypercycles](./rules-hypercycles.md) — `forbid hypercycle` and `forbid provides` rules over the hypergraph.
- [CLI Reference](../reference/cli.md) — `shp graph SYMBOL [--kind KIND]`.
