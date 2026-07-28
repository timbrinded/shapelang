---
title: Components, Ownership, and Grants
description: How components own resources, grant effects, and contain function summaries.
sidebar:
  order: 2
---

Components are the main boundary for authority and behavior claims: what a component owns, which effects its functions may emit, and which function summaries it provides. The checker evaluates those claims in the declared `.shape` model. It does not allocate runtime ownership or execute application code.

Components do **not** carry structural dependencies. Calls, provides, callbacks, and multi-party coordination live in top-level `relation` declarations. See [Relations and Hypergraphs](./relations-hypergraphs.md).

![Component boundary diagram showing ownership, grants, and functions inside the component, with structural links shown as an external relation hyperedge, plus the note that ownership is not runtime allocation.](../../../assets/infographics/component-boundary-grants.png)

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
}
```

## Ownership

`owns AuditEvent` states that this component owns the resource in the architecture model. Ownership is a review claim used for structure and explanation, not a runtime allocation.

## Grants

`grants Append<AuditEvent>` states that functions in this component may emit that effect. If a function emits an effect without a matching grant, the checker reports `missing grant`.

Grants do not override final forbids. This model still fails with `forbidden effect`:

```shape
module audit

trait AppendOnly<T: Resource> {
  forbid final HardDelete<T>
}

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

`AuditEvent : AppendOnly` derives a final forbid for `HardDelete<AuditEvent>`. The grant is not enough; design memory and reevaluation cannot waive the forbid either.

## Function summaries

Each `fn` member declares the function's optional shape traits, `source`, optional description, and either `effects complete` or `effects unknown`. Function-level `requires` is a capability term used with `unsafe` effects; it is unrelated to structural dependencies between components.

Shape traits on functions (for example `RefactorSensitive` or `PreserveInline`) create review obligations. See [Refactor Constraints](./refactor-constraints.md).

## Structural dependencies

Structural links between components and resources live only in top-level `relation` declarations, never inside a `component` block:

```shape
module audit

resource AuditEvent

component Gateway {
}

component AuditStore {
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}
```

## Practice

Do:

- Put ownership, grants, and function effect summaries on the component that actually holds that authority in the architecture.
- Grant only effects the component is allowed to emit under resource traits.
- Keep call, callback, provide, and coordination edges in `relation` declarations.
- Map source paths to components with `implementation` blocks when coverage should govern them. See [Implementations and Coverage](./implementations-coverage.md).

Do not:

- Nest structural dependencies inside the component body.
- Use a grant to paper over a final forbid.
- Mark production boundaries as complete with `effects unknown` left unresolved in CI.
- Treat `owns` as a memory-management or deployment claim.

## Related pages

- [Resources, Traits, and Effects](./resources-traits-effects.md)
- [Relations and Hypergraphs](./relations-hypergraphs.md)
- [Implementations and Coverage](./implementations-coverage.md)
