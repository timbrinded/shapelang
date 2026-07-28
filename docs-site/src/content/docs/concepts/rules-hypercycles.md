---
title: Rules, Paths, and Hypercycles
description: Project-specific provides, path, and hypercycle rules over the relation hypergraph.
sidebar:
  order: 7
---

Rules capture project-specific architectural constraints over the structural hypergraph. They are typed claims the deterministic checker accepts or rejects with stable witnesses. Rules do not execute application code or replace tests.

![Hypercycle witness path diagram showing two components with calls and callbacks relations, a forbid hypercycle rule, a witness path through the directed hypergraph, and a rejected result.](../../../assets/infographics/hypercycle-witness-path.png)

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

Keep rules narrow. Encode decisions stable enough for CI.

## `forbid provides`

`forbid provides T except C` scans the hypergraph for relations whose `kind` is `provides` and whose target endpoint is `T`. If any relation provides `T` from a component other than `C`, the rule rejects the model and cites the offending relation and component.

## Forbidden path rules

`forbid path SOURCE -> TARGET over KIND or KIND ...` rejects a directed dependency path between two declared components or resources. The `over` filter is required: every hop in a matching path must use one of the listed relation kinds.

```shape
module gateway

resource SecretStore

component Gateway {
}

component PolicyService {
}

relation GatewayCallsPolicy {
  kind calls
  connects Gateway -> PolicyService
}

relation PolicyProvidesSecret {
  kind provides
  connects PolicyService -> SecretStore
}

rule no_gateway_to_secrets {
  forbid path Gateway -> SecretStore over calls or provides
}
```

The checker uses breadth-first search with the same directed traversal semantics as hypercycle detection. Relations with unresolved or ambiguous endpoints, and `provides` relations with invalid provider or target roles, cannot contribute to a path witness. The checker reports the fewest-hop witness; equal-length paths are resolved by canonical vertex, relation-kind, and relation-name order. Direction matters, and relation kinds outside the explicit filter cannot complete the path.

Path endpoints must be distinct. Use `forbid hypercycle` for cycle constraints. Listed kinds must have directed traversal semantics in the prelude registry; custom relation kinds remain visible in graph output but cannot be used in path rules until their direction is typed.

Diagnostic shape:

```text
error: forbidden path

rule no_gateway_to_secrets rejects this dependency path:
  calls GatewayCallsPolicy: Gateway -> PolicyService
  provides PolicyProvidesSecret: PolicyService -> SecretStore
witness: Gateway -> PolicyService -> SecretStore
```

## Hypercycle rules

Hypercycles are cycles in the directed hypergraph. The checker traverses each relation kind according to its prelude traversal semantics: directed binary kinds contribute one step per relation; ordered kinds contribute consecutive steps along their declared member order.

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

`forbid hypercycle` without `over` looks for cycles across every relation kind that participates in directed traversal.

After relation-kind filtering, the checker partitions the traversal graph into strongly connected components and reports the shortest cycle witness. Equal-length witnesses are resolved in canonical name order, so the result does not depend on relation declaration order.

```text
error: forbidden hypercycle

rule no_runtime_cycle rejects this hypercycle:
  calls GatewayCallsAudit
  callbacks AuditCallsGateway
witness: AuditStore -> Gateway -> AuditStore
```

## Other rule forms

Rules also support:

- `when subject has TraitName` with `forbid` / `forbid final` effect patterns for rule-derived final forbids
- module-qualified references for subjects, endpoints, and traits

Final forbids from rules remain non-overridable by grants, rationale, memory, or reevaluation. Unsupported multi-subject condition shapes are rejected as invalid rules rather than silently ignored.

## Inspect the hypergraph

```bash
shp graph show Gateway
shp graph show Gateway --kind calls
shp graph stats
```

`shp graph show` prints hyperedges incident to the symbol. `--kind` filters by relation kind.

## Practice

Do:

- Encode stable structural policy as `forbid provides`, `forbid path`, or `forbid hypercycle` with an explicit kind filter when possible.
- Prefer prelude kinds with directed traversal for any rule that must search the graph.
- Use graph witnesses in review: break or redirect a cited relation rather than weakening the rule casually.
- Keep path endpoints distinct; use hypercycle rules for cycles.

Do not:

- Expect custom relation kinds without directed traversal to participate in path or hypercycle search.
- Use identical path endpoints to mean “no cycles.”
- Rely on declaration order for witness stability; the checker canonicalizes witnesses.
- Attempt to waive a rule-derived final forbid with design memory.

## Related pages

- [Relations and Hypergraphs](./relations-hypergraphs.md)
- [Diagnostics and Provenance](./diagnostics-provenance.md)
- [CLI Reference](../reference/cli.md)
