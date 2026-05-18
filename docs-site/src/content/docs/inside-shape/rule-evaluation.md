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
- required rationale, memory, descriptions, and reevaluations
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

Refactor constraints run alongside these checks. They can require design context before a function shape passes, but they do not suppress final forbids or missing grants.

## Witness paths

For graph rules, diagnostics should include the dependency path that caused the failure. Reviewers need the route through the graph, not only the existence of a cycle.
