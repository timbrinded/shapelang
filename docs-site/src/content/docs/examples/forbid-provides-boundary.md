---
title: Forbid Provides Boundary
description: A provider-boundary failure that rejects a second component providing the same resource.
sidebar:
  order: 8
---

This example exercises first-class structural relations. Two components both declare a `kind provides` hyperedge into the same resource, and a `forbid provides ... except` rule rejects every provider except the allowed one.

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

Run:

```bash
shp check fixtures/fail/forbid_provides_boundary/gateway.shape
```

Expected diagnostic:

```text
error: forbidden provides

PublicApi provides JsonRpcEndpoint via relation PublicApiProvidesRpc.
rule gateway_only_rpc_ingress forbids provides JsonRpcEndpoint except Gateway.

caused by:
  - fixtures/fail/forbid_provides_boundary/gateway.shape: relation PublicApiProvidesRpc
  - fixtures/fail/forbid_provides_boundary/gateway.shape: rule gateway_only_rpc_ingress forbids provides JsonRpcEndpoint
```

`GatewayProvidesRpc` passes because the rule allows `Gateway` as the provider. `PublicApiProvidesRpc` is the offending hyperedge: it provides the same resource from a different component.

## Inspect the hypergraph

`shp graph` projects the hypergraph into reviewable text. Filter by relation kind to look at just the provider boundary:

```bash
shp graph --kind provides fixtures/fail/forbid_provides_boundary/gateway.shape
```

```text
Hypergraph

provides:
  provides GatewayProvidesRpc: Gateway (component) -> JsonRpcEndpoint (resource)
  provides PublicApiProvidesRpc: PublicApi (component) -> JsonRpcEndpoint (resource)
```

The two `provides` hyperedges both terminate at `JsonRpcEndpoint`, which is exactly why `forbid provides JsonRpcEndpoint except Gateway` rejects the model. Removing or redirecting `PublicApiProvidesRpc` (or widening the rule's `except` list) is what makes the model pass.
