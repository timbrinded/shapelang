---
title: First Shape File
description: Build the smallest useful Shape model around one resource and one component.
sidebar:
  order: 3
---

This page builds a minimal Shape model: one resource, one component, and function effect summaries. The goal is a module the checker can accept, not a full system model.

![First Shape file map showing a resource, component, function summary, effect, evidence, and checker claim reading.](../../../assets/infographics/first-shape-file-map.png)

## Minimal model

`AppendOnly` is a built-in prelude trait. It finally forbids `HardDelete`, `Truncate`, and `DropStorage` on the resource that carries it. You can redeclare an equivalent trait in project files; fixtures that need a local definition do so explicitly.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

Save the module under your project’s default discovery tree, for example `shape/audit.shape`. With no file arguments, `shp check` scans `shape/**/*.shape`. You can also pass the file path explicitly:

```bash
shp check shape/audit.shape
```

Expected result:

```text
Shape check passed.
```

In the Shape language repository, the same pattern is covered by the pass fixture `fixtures/pass/append_only_append/audit.shape`. Application repos should check their own `shape/` files, not that fixture path.

## Resource

`resource AuditEvent : AppendOnly` says `AuditEvent` is an architectural target governed by the `AppendOnly` trait.

The checker does not require the resource to exist as a runtime type. It uses the resource as the target of effects, ownership, and trait-derived constraints. See [Resources, Traits, and Effects](../concepts/resources-traits-effects).

## Component

`component AuditStore` groups ownership, grants, and function summaries.

- `owns AuditEvent` is a review claim about ownership in the architecture model, not a runtime allocator.
- `grants Append<AuditEvent>` says functions in this component may emit that effect. Emitting an effect without a matching grant fails the check.
- Grants do not override `forbid final` constraints from traits or rules.

Structural links between components and resources are not declared inside a component. They live in top-level `relation` declarations. See [Relations and Hypergraphs](../concepts/relations-hypergraphs) and [Components, Ownership, and Grants](../concepts/components-ownership-grants).

## Function summary

`fn appendEvent` is not an implementation. It is a summary of the source function’s architectural effects for the model.

- `effects complete { ... }` claims the listed effects are exhaustive for that function.
- Use `effects unknown` when the effects are not yet known. Strict `shp check` rejects unknowns so unresolved analysis cannot ship as a complete contract; draft with `shp check --allow-unknown-effects` while authoring.
- Prefer an honest `effects unknown` over an empty complete summary that pretends completeness.

See [Unknowns and Safety](../concepts/unknowns-safety).

## Evidence

Source and evidence refs make claims reviewable by humans. The checker does not execute the referenced TypeScript; the refs tell reviewers where to inspect the claim.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
}
```

See [Evidence and Source Refs](../concepts/evidence-source-refs).

## What fails next

If you add a function that emits `HardDelete<AuditEvent>`, the model fails even with a matching grant, because prelude `AppendOnly` derives a final forbid. Walk through that failure in [Append-Only Walkthrough](./append-only-walkthrough).

## Best practices

**Do**

- Start with one resource, one owner component, and the functions that touch that resource
- Grant only the effects the component actually needs
- Attach `source` / `evidence` when a claim will be reviewed or when coverage needs a current Shape reference
- Keep structural dependencies as top-level `relation` declarations

**Do not**

- Nest `calls` / `provides` links inside the component body
- Use empty `effects complete` blocks to silence uncertainty
- Assume grants can authorize final-forbidden effects
- Treat a passing check as proof that the implementation is correct—only that the declared model is coherent

## Related pages

- [Append-Only Walkthrough](./append-only-walkthrough)
- [Global Model Updates](./global-model-updates)
- [Implementations and Coverage](../concepts/implementations-coverage)
