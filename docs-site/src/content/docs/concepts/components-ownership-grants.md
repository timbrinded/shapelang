---
title: Components, Ownership, and Grants
description: How Shape groups functions, resources, permissions, and dependencies.
sidebar:
  order: 2
---

Components are the main boundary for architectural claims.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

## Ownership

`owns AuditEvent` says this component owns the resource in the architecture model. Ownership is a review claim, not a runtime allocation.

## Grants

`grants Append<AuditEvent>` says functions in this component may emit that effect. If a function emits an effect without a matching grant, the checker rejects the model.

Grants do not override final forbids. This model still fails:

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
    effects complete {
      HardDelete<AuditEvent>
    }
}
```

`AuditEvent : AppendOnly` derives a final forbid for `HardDelete<AuditEvent>`, so the grant is not enough.

## Provides and requires

Components can also describe semantic dependencies:

```shape
module gateway

component Gateway {
  provides JsonRpcEndpoint
  requires AuditStore via calls
}
```

Those relationships power graph inspection and dependency-cycle rules.

