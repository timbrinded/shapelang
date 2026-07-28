---
title: Forbid Provides Boundary
description: A provider-boundary failure that rejects a second component providing the same resource.
sidebar:
  order: 8
---

## Intent

Show a first-class structural relation check: two components declare `kind provides` hyperedges into the same resource, and a `forbid provides ... except` rule rejects every provider except the allowed one.

## Model

Matches `fixtures/fail/forbid_provides_boundary/gateway.shape`:

```shape
module rules

resource JsonRpcEndpoint

component Gateway {
}

component PublicApi {
}

relation GatewayProvidesRpc {
  kind provides
  connects Gateway -> JsonRpcEndpoint
}

relation PublicApiProvidesRpc {
  kind provides
  connects PublicApi -> JsonRpcEndpoint
}

rule gateway_only_rpc_ingress {
  forbid provides JsonRpcEndpoint except Gateway
}
```

## Expected result

Save the model (for example `shape/gateway.shape`) and run `shp check shape/gateway.shape`. In this repository the same model is:

```bash
shp check fixtures/fail/forbid_provides_boundary/gateway.shape
```

```text
error: forbidden provides

PublicApi provides JsonRpcEndpoint via relation PublicApiProvidesRpc.
rule gateway_only_rpc_ingress forbids provides JsonRpcEndpoint except Gateway.

caused by:
  - fixtures/fail/forbid_provides_boundary/gateway.shape: relation PublicApiProvidesRpc
  - fixtures/fail/forbid_provides_boundary/gateway.shape: rule gateway_only_rpc_ingress forbids provides JsonRpcEndpoint
```

Exit code `1`.

`GatewayProvidesRpc` is allowed. `PublicApiProvidesRpc` is the offending hyperedge.

## Inspect the hypergraph

```bash
shp graph all --kind provides fixtures/fail/forbid_provides_boundary/gateway.shape
```

```text
Hypergraph

provides:
  provides GatewayProvidesRpc: Gateway (component) -> JsonRpcEndpoint (resource)
  provides PublicApiProvidesRpc: PublicApi (component) -> JsonRpcEndpoint (resource)
```

Both `provides` hyperedges terminate at `JsonRpcEndpoint`. Removing or redirecting `PublicApiProvidesRpc`, or widening the rule's `except` list, is what makes the model pass.

## Why it fails

`provides` relations are structural claims, not component-body dependencies. The rule filters the hypergraph for providers of `JsonRpcEndpoint` and rejects any component outside the exception list.

## Related concepts

- [Relations and hypergraphs](../concepts/relations-hypergraphs.md)
- [Rules and hypercycles](../concepts/rules-hypercycles.md)
- [CLI: graph](../reference/cli.md)
