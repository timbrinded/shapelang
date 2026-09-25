---
title: Relations and Graph Rules
description: Declare structural links as top-level relations, and reject provider, path, and cycle shapes with forbid provides, forbid path, and forbid hypercycle rules.
---

A `relation` declares one structural link between components and resources: a call, a callback, a provided resource, a multi-party coordination, or a link of a custom kind. Relations are top-level declarations, never members of a component. They are also the only structural links in the Shape model: `owns`, `grants`, and effect entries add no edges, and the checker infers none from source. Each relation is a hyperedge over two or more endpoints, and graph rules query the resulting hypergraph.

## Relations

This model passes `shp check`:

```shape
module gateway

resource AuditEvent

component AuditStore {
}

component Gateway {
}

relation AuditCallsGateway {
  kind callbacks
  connects AuditStore -> Gateway
}

relation AuditEventLineage {
  kind generated_from
  connects AuditEvent -> AuditStore
}

relation AuditWritePath {
  kind coordinated_call
  connects Gateway -> AuditStore -> AuditEvent
  roles { AuditStore as writer, Gateway as caller }
  summary "Gateway writes audit events only through AuditStore."
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}
```

| Member | Presence | Meaning |
| --- | --- | --- |
| name | Required, unique (`duplicate relation` otherwise) | Identifies the relation in diagnostics and `shp graph` output. A stable name keeps both reviewable. |
| `kind` | Required, once | A prelude kind (`calls`, `callbacks`, `provides`, `coordinated_call`) or any other identifier. See [Kinds and traversal](#kinds-and-traversal). |
| `connects` | Required, once | Two or more distinct endpoints, ordered as `A -> B -> C` or unordered as `{ A, B, C }`. |
| `roles` | Optional, once | Labels such as `{ Gateway as caller }`. Each must name a `connects` endpoint, at most once. `shp graph` prints them; no rule reads them. |
| `summary` | Optional, once | Review text, printed by `shp graph` after `//`. |
| `expects` | Optional, repeatable | `expects Endpoint fingerprint provider("value")` pins a resource endpoint's fingerprint. The endpoint must be a `connects` endpoint and a resource, otherwise `invalid relation`. A missing or different fingerprint gives `stale fingerprint expectation`, and a removed endpoint resource gives `unknown relation_endpoint`. See [Generate Drafts from Source](/shapelang/guides/ast-drafts/). |

### Endpoint resolution

Each endpoint names a component or a resource. A bare name resolves in its own module first, then through the module's imports, and `module::Name` names another module's declaration directly. Resolution fails in three ways:

| Condition | Diagnostic |
| --- | --- |
| No component or resource has the name. | `unknown relation_endpoint` |
| A component and a resource share the name. | `invalid relation`, with the reason `endpoint Name resolves to both a component and a resource` |
| More than one imported module declares the name. | `ambiguous relation_endpoint`; qualify the reference |

## Kinds and traversal

`forbid path` and `forbid hypercycle` walk traversal steps, and each kind contributes steps differently:

| Kind | Endpoints | Traversal steps | Typical use |
| --- | --- | --- | --- |
| `calls` | Exactly two, ordered `A -> B` | One step, A → B | A component calls another |
| `callbacks` | Exactly two, ordered `A -> B` | One step, A → B | A callback edge, often paired with `calls` |
| `provides` | Exactly two, ordered: a component, then a resource | One step, A → B | A component provides a resource or interface |
| `coordinated_call` | Two or more, ordered | One step per consecutive pair | Multi-party coordination, such as a write path or saga |
| Any other identifier | Two or more, ordered or unordered | None | Lineage or documentation links, such as `generated_from` |

Only `provides` constrains endpoint kinds; the other kinds accept components and resources in any position. The typical-use column is guidance, not a check. In the model above, `AuditWritePath` contributes the steps Gateway → AuditStore and AuditStore → AuditEvent, while `AuditEventLineage` contributes none. Custom kinds appear in `shp graph` output but never in path or cycle search.

![The calls relation GatewayCallsAudit and the callbacks relation AuditCallsGateway each contribute one traversal step, the coordinated_call AuditWritePath contributes one step per consecutive pair of endpoints, the custom generated_from relation AuditEventLineage contributes none, and for the rule no_runtime_cycle over calls or callbacks the two single-step relations form the one reported witness, AuditStore -> Gateway -> AuditStore.](../../../assets/diagrams/relation-traversal.svg)

## Validity

A relation that breaks a structural rule gives `invalid relation`, printed as `relation module::Name is invalid: reason.` The rules are:

- `kind` and `connects` are present, and no member other than `expects` repeats.
- No endpoint repeats in `connects`.
- The endpoint count and ordering suit the kind, as listed in [Kinds and traversal](#kinds-and-traversal).
- A `provides` relation connects a component to a resource. Otherwise the reason is `provides provider X must be a component` or `provides target X must be a resource`.
- Each role names a `connects` endpoint, and no endpoint has two roles.

A relation with a missing `kind` or `connects`, a repeated endpoint, or the wrong count or ordering for its kind is dropped from the hypergraph, so `shp graph` and graph rules do not see it until it is fixed.

## Graph rules

A `rule` is a named top-level declaration whose body holds `forbid` clauses. Each graph-rule diagnostic names the rule. A rule can also derive a final forbid from a trait condition; see [Effect Model](/shapelang/concepts/effect-model/#rule-derived-final-forbids).

### `forbid provides`

`forbid provides R except C` rejects every `provides` relation whose target is the resource `R` and whose provider is not the component `C`. `except` is optional and names exactly one component, so no rule form allows two providers; without `except`, every provider of `R` is rejected. `R` must be a declared resource and `C` a declared component (`unknown resource` and `unknown component` otherwise).

```shape
module gateway

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

`shp check` exits 1:

```text
error: forbidden provides

PublicApi provides JsonRpcEndpoint via relation PublicApiProvidesRpc.
rule gateway_only_rpc_ingress forbids provides JsonRpcEndpoint except Gateway.

caused by:
  - shape/gateway.shape: relation PublicApiProvidesRpc
  - shape/gateway.shape: rule gateway_only_rpc_ingress forbids provides JsonRpcEndpoint
```

`GatewayProvidesRpc` is allowed, and removing or redirecting `PublicApiProvidesRpc` makes the model pass. The rule emits one diagnostic per offending relation. Written without `except`, as `forbid provides JsonRpcEndpoint` in a rule named `no_rpc_ingress`, it reports both relations, and each diagnostic's second line reads `rule no_rpc_ingress forbids provides JsonRpcEndpoint.`

### `forbid path`

`forbid path A -> B over K1 or K2` rejects a directed path from `A` to `B` in which every step comes from a relation of a listed kind. The `over` list is required; without it the file does not parse. Direction matters, and kinds outside the list cannot complete a path.

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

`shp check` exits 1:

```text
error: forbidden path

rule no_gateway_to_secrets rejects this dependency path:
  calls GatewayCallsPolicy: Gateway -> PolicyService
  provides PolicyProvidesSecret: PolicyService -> SecretStore
witness: Gateway -> PolicyService -> SecretStore

caused by:
  - shape/gateway.shape: rule no_gateway_to_secrets forbids path Gateway -> SecretStore over calls or provides
  - shape/gateway.shape: relation GatewayCallsPolicy
  - shape/gateway.shape: relation PolicyProvidesSecret
```

A `forbid path` rule must meet these requirements, and a rule that fails one reports the listed diagnostic instead of searching:

- `A` and `B` are distinct. `forbid path Gateway -> Gateway` is an `invalid rule` with the reason `forbidden path endpoints must be distinct; use forbid hypercycle for cycles`.
- Each endpoint names a declared component or resource (`unknown relation_endpoint` otherwise).
- Every listed kind has traversal steps. A custom kind makes the rule invalid: `forbid path AuditEvent -> AuditStore over generated_from` gives `invalid rule` with the reason `relation kind generated_from has no directed traversal semantics`.

A relation with an unresolved or ambiguous endpoint, or a `provides` relation whose provider is not a component or whose target is not a resource, contributes no steps to a path.

### `forbid hypercycle`

`forbid hypercycle over K1 or K2` rejects a directed cycle built from steps of the listed kinds. Without `over`, it searches the steps of every kind that has traversal. Adding this rule to the first model on this page:

```shape
rule no_runtime_cycle {
  forbid hypercycle over calls or callbacks
}
```

makes `shp check` exit 1:

```text
error: forbidden hypercycle

rule no_runtime_cycle rejects this hypercycle:
  callbacks AuditCallsGateway
  calls GatewayCallsAudit
witness: AuditStore -> Gateway -> AuditStore

caused by:
  - shape/gateway.shape: rule no_runtime_cycle forbids hypercycle over calls or callbacks
  - shape/gateway.shape: relation AuditCallsGateway
  - shape/gateway.shape: relation GatewayCallsAudit
```

The `over` list is not validated. A custom or misspelled kind contributes no steps, so a rule whose `over` list names only such kinds never matches; it does not fall back to searching every kind. In the first model, `AuditWritePath` steps from AuditStore to AuditEvent and `AuditEventLineage` links AuditEvent back to AuditStore, yet the model still passes (`Shape check passed.`) with this rule added:

```shape
rule no_lineage_cycle {
  forbid hypercycle over coordinated_call or generated_from
}
```

### Witnesses

Each `forbid path` and each `forbid hypercycle` reports at most one witness, even when the model contains several violating paths or disjoint cycles:

- The witness is the shortest, with the fewest steps.
- Ties break on the vertex sequence in codepoint order, then on relation kind, then on relation name, so the witness does not depend on declaration order.
- A hypercycle witness starts at its codepoint-smallest vertex and lists each relation once, in walk order. A `coordinated_call` that contributes several steps appears once.
- A path witness prints one line per step, as `kind Name: From -> To`, so a relation that contributes two steps appears twice.

Fixing the reported witness can expose another, so a model can need several rounds of fixes before the rule passes. The usual fix breaks or redirects a cited relation; weakening the rule changes the claim instead. [Rule Evaluation](/shapelang/inside-shape/rule-evaluation/) describes the search algorithms.

## Inspecting the graph

`shp graph` prints the hypergraph without running checks:

- `shp graph stats [--kind KIND]` prints counts of vertices, relations per kind, incidences, arity, and isolated vertices. It sizes up a model before a large relation edit.
- `shp graph show SYMBOL [--kind KIND]` prints the relations incident to a component or resource, or a single relation by name.
- `shp graph all [--kind KIND]` prints every relation, grouped by kind.

For the first model on this page, `shp graph show Gateway` prints:

```text
Gateway (component)
  callbacks AuditCallsGateway: AuditStore (component) -> Gateway (component)
  calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)
  coordinated_call AuditWritePath: Gateway (component) as caller -> AuditStore (component) as writer -> AuditEvent (resource)  // Gateway writes audit events only through AuditStore.
```

Each line reads `kind Name: endpoints`, with the endpoint's declaration kind in parentheses, its role after `as`, and the summary after `//`. Unordered endpoints print as `{ A, B, C }`. Flags and exit codes are in the [CLI Reference](/shapelang/reference/cli/).
