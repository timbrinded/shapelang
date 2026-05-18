---
title: Append-Only Pass
description: A minimal model that emits only allowed append-only effects.
sidebar:
  order: 1
---

This fixture passes because `AuditStore.appendEvent` emits the effect that the component grants.

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

Run:

```bash
shp check fixtures/pass/append_only_append/audit.shape
```

Expected result:

```text
Shape check passed.
```

Use this as the smallest positive example for a resource, component, grant, function, and complete effect summary.
