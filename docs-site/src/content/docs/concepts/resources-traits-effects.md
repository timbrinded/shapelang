---
title: Resources, Traits, and Effects
description: The core vocabulary for declaring protected architecture claims.
sidebar:
  order: 1
---

Resources, traits, and effects are the smallest useful unit of Shape.

## Resources

A resource is a thing the architecture cares about: a table, stream, bucket, ledger, queue, secret, endpoint, or domain object.

```shape
module audit

resource AuditEvent : AppendOnly
```

The checker does not require the resource to be a runtime type. It is an architectural target for effects and constraints.

## Traits

Traits derive allowed, required, and forbidden effect patterns:

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final HardDelete<T>
}

resource AuditEvent : AppendOnly
```

`allow` documents an effect that fits the trait. `require` records an effect pattern that must be present. `forbid final` rejects matching effects even if a component grants them.

## Effects

Effects describe what a function does to a resource:

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

Shape cares about the declared effect, its target, and the provenance behind it.

## Type parameters

Traits can be generic:

```shape
module shared

trait Protected<T: Resource> {
  forbid final HardDelete<T>
}

resource AuditEvent : Protected
```

Today trait applications are named at the resource level. The checker derives concrete constraints for the resource that carries the trait.

