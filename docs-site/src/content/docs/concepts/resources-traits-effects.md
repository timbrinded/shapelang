---
title: Resources, Traits, and Effects
description: Core Shape vocabulary for resources, effect policy traits, and function effect summaries.
sidebar:
  order: 1
---

Resources, traits, and effects are the basic vocabulary for architecture claims in Shape. Humans and agents declare what is protected, which operations are allowed or forbidden, and which effects a function claims to emit. The deterministic checker accepts or rejects those claims against the declared model. It does not prove that application code is correct.

![Core Shape vocabulary map linking resources, traits, effects, components, ownership, grants, and evidence.](../../../assets/infographics/core-vocabulary-map.png)

## Resources

A resource is an architectural target the model cares about: a table, stream, bucket, ledger, queue, secret, endpoint, or domain object. It does not have to be a runtime type.

```shape
module audit

resource AuditEvent : AppendOnly
```

`AppendOnly` is a prelude trait. Projects may also declare custom resource traits. Resources may carry optional storage metadata and fingerprints; those matter for review and for AST-anchor pinning (see [AST Generation](./ast-generation.md)).

## Traits

Resource traits derive allowed, required, and forbidden effect patterns:

```shape
module audit

trait DurableLog<T: Resource> {
  allow Append<T>
  allow Read<T>
  require Append<T>
  forbid final HardDelete<T>
}

resource AuditEvent : DurableLog
```

| Member | Checker meaning |
| --- | --- |
| `allow` | Documents an effect that fits the trait. |
| `require` | Records an effect pattern that must appear for the resource. |
| `forbid final` | Rejects matching emitted effects even when a component grants them. |

`forbid final` is non-overridable. Rationale, design memory, reevaluation, and grants cannot waive it.

Traits can be generic. Trait applications are named on the resource; the checker derives concrete constraints for that resource:

```shape
module shared

trait Protected<T: Resource> {
  forbid final HardDelete<T>
}

resource AuditEvent : Protected
```

Function shape traits such as `PreserveInline`, `RequiresDescription`, and `RefactorSensitive` do not derive resource-effect policy. They create review obligations (rationale, memory, description, or reevaluation). See [Refactor Constraints](./refactor-constraints.md).

## Effects

Effects describe what a function claims to do to a resource. They appear in function summaries under a component:

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

The checker cares about the declared effect, its target resource, component grants, trait forbids, and evidence or source provenance attached to the claim. Structural links between components and resources are not effects; they are top-level `relation` declarations. See [Relations and Hypergraphs](./relations-hypergraphs.md).

Use `effects complete` only when the summary is intended to be exhaustive. Prefer `effects unknown` when analysis is incomplete rather than an empty complete block that pretends certainty. See [Unknowns and Safety](./unknowns-safety.md).

## Practice

Do:

- Model durable architectural targets as resources, even when they are not a single runtime type.
- Put policy that must never be waived in `forbid final` on a resource trait.
- Attach `source` and per-effect `evidence` so reviewers can open the supporting code.
- Keep effect names from the prelude (`Read`, `Append`, `HardDelete`, …) or project-defined patterns that the model actually checks.

Do not:

- Treat an empty `effects complete { }` as “no effects yet.” That claims completeness.
- Expect a grant to override a final forbid.
- Encode structural call or provide edges as effects; use `relation`.
- Rely on the analyzer to invent missing effects. Analyzer hints are advisory only.

## Related pages

- [Components, Ownership, and Grants](./components-ownership-grants.md)
- [Evidence and Source Refs](./evidence-source-refs.md)
- [Unknowns and Safety](./unknowns-safety.md)
