---
title: Append-Only Pass
description: A minimal model that emits only allowed append-only effects.
sidebar:
  order: 1
---

## Intent

Show the smallest passing model for a resource, component grant, function, and complete effect summary. The function emits only an effect the component grants, and that effect is allowed by the resource trait.

## Model

Matches `fixtures/pass/append_only_append/audit.shape`:

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

`AppendOnly` comes from the standard prelude. It allows `Append` and forbids final destructive effects such as `HardDelete`.

## Expected result

```bash
shp check fixtures/pass/append_only_append/audit.shape
```

```text
Shape check passed.
```

## Why it passes

- `AuditStore` grants `Append<AuditEvent>`.
- `appendEvent` declares a complete summary that emits only that granted effect.
- No final forbid applies to `Append`.

## Related concepts

- [Resources, traits, and effects](../concepts/resources-traits-effects.md)
- [Append-only hard-delete failure](./append-only-hard-delete-failure.md)
- [Append-only walkthrough](../learn/append-only-walkthrough.md)
