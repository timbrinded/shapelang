---
title: Append-Only Walkthrough
description: Follow an append-only resource from trait declaration to a forbidden-effect diagnostic.
sidebar:
  order: 4
---

This walkthrough is the core Shape failure path: declare an append-only resource, model safe functions, then add a hard-delete function and read the diagnostic. Use it when you need a concrete pass/fail pair for resource traits and final forbids.

![Append-only rejection diagram showing AuditEvent, AppendOnly, forbid final, a HardDelete claim, the witness path, and the rejected diagnostic.](../../../assets/infographics/append-only-rejection.png)

## When this applies

- You protect a resource that must not be hard-deleted, truncated, or dropped
- You want CI to reject models that claim those effects even when a component grants them
- You need a diagnostic that names the function, the resource trait, and the final forbid

Shape still does not prove that production code cannot delete the resource. It checks whether the declared model claims a forbidden effect.

## Declare the invariant

Prelude `AppendOnly` finally forbids `HardDelete`, `Truncate`, and `DropStorage` on the resource. You can also declare an equivalent trait in the module (as the failure fixture does) so the constraint is visible in the same file:

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly
```

`final` means a component grant cannot override the forbid. Memory, rationale, and reevaluation also cannot waive it.

## Model the safe functions

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

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
  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts#listEvents")
    }
}
```

This model passes: the component grants the emitted effects, and the trait does not forbid them. The smaller pass fixture is `fixtures/pass/append_only_append/audit.shape` (prelude trait, no local trait body).

## Add the unsafe function

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  grants Read<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

Run:

```bash
shp check fixtures/fail/append_only_hard_delete/audit.shape
```

The checker reports a forbidden effect and a causal trail:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")
```

The grant for `HardDelete<AuditEvent>` is present and still insufficient. Final forbids win over grants.

The same final forbid still applies when design memory is attached to the function. See fixture `fixtures/fail/memory_guard_does_not_override_final_forbid/`.

## Best practices

**Do**

- Put destructive effects in the model when source actually performs them, then fix architecture or remove the claim
- Keep final forbids for invariants that must not be waived by component-local grants
- Attach evidence on material effects so diagnostics and review point at the same source

**Do not**

- Add a grant to “allow” a final-forbidden effect; the checker still rejects the emission
- Use memory or reevaluation to silence a final forbid
- Mark effects complete while omitting a known destructive path

## Related pages

- [First Shape File](./first-shape-file)
- [Append-Only Pass](../examples/append-only-pass) and [Append-Only Hard-Delete Failure](../examples/append-only-hard-delete-failure)
- [Resources, Traits, and Effects](../concepts/resources-traits-effects)
- [Diagnostics and Provenance](../concepts/diagnostics-provenance)
