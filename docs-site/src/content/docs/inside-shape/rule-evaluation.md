---
title: Rule Evaluation
description: How deterministic checks reject incoherent Shape models.
sidebar:
  order: 4
---

Rule evaluation decides whether the effective model is coherent.

## Core checks

The checker currently covers:

- final forbidden effects from traits
- missing grants for function effects
- governed source coverage
- dependency-cycle bans with witness paths
- project-specific provider and effect rules
- analyzer hint comparison

## Final forbids

Final forbids are intentionally stronger than grants:

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

This model fails because `AppendOnly` derives a final forbid for the emitted effect.

## Witness paths

For graph rules, diagnostics should include the dependency path that caused the failure. Reviewers need the route through the graph, not only the existence of a cycle.

