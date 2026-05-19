---
title: Rules and Hypercycles
description: Project-specific rules over the structural hypergraph.
sidebar:
  order: 7
---

Rules capture project-specific architectural constraints that operate over the structural hypergraph.

![Dependency witness path diagram showing two components with requires and callbacks edges, a cycle rule, a witness path, and a rejected result.](../../../assets/infographics/dependency-witness-path.png)

```shape
module gateway

resource JsonRpcEndpoint

component Gateway {
}

relation GatewayProvidesRpc {
  kind provides
  connects Gateway -> JsonRpcEndpoint
}

rule GatewayBoundary {
  forbid provides JsonRpcEndpoint except Gateway
}
```

Rules are intentionally narrow. They should encode architecture decisions that are stable enough for CI.

## `forbid provides`

`forbid provides T except C` scans the hypergraph for relations whose `kind` is `provides` and whose target endpoint is `T`. If any relation provides `T` from a component other than `C`, the rule rejects the model with a witness that cites the offending relation and component.

## Hypercycle rules

Hypercycles are cycles in the directed hypergraph. The checker traverses each relation kind according to its traversal semantics from the prelude kind registry: directed binary kinds contribute one step per relation, ordered kinds contribute consecutive steps along their declared member order.

```shape
module gateway

component Gateway {
}
component AuditStore {
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}

relation AuditCallsGateway {
  kind callbacks
  connects AuditStore -> Gateway
}

rule no_runtime_cycle {
  forbid hypercycle over calls or callbacks
}
```

`forbid hypercycle` without `over` looks for cycles across every relation kind that participates in cycle detection.

The diagnostic cites the relations forming the cycle and prints a vertex witness path:

```text
error: forbidden hypercycle

rule no_runtime_cycle rejects this hypercycle:
  calls GatewayCallsAudit
  callbacks AuditCallsGateway
witness: AuditStore -> Gateway -> AuditStore
```

## Inspect the hypergraph

```bash
shp graph Gateway
shp graph Gateway --kind calls
```

`shp graph` prints the hyperedges incident to the symbol, grouped by relation. `--kind` filters by relation kind so reviewers can focus on a single concern.
