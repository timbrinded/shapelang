---
title: Fact Lowering
description: Why Shape lowers declarations before rule evaluation.
sidebar:
  order: 3
---

The parser gives the checker syntax trees. Semantic checks are easier to reason about after those trees become facts.

Facts make rules uniform:

```text
component AuditStore owns AuditEvent
component AuditStore grants Append<AuditEvent>
function AuditStore.appendEvent emits Append<AuditEvent>
resource AuditEvent has trait AppendOnly
trait AppendOnly forbids final HardDelete<AuditEvent>
```

## Why this matters

Fact lowering gives diagnostics better provenance. The checker can point at the function effect, the target resource, the resource trait, and the trait member that caused a final forbid.

It also makes change files tractable. The checker can apply all changes first, then lower a single effective model into facts.

## Design rule

Keep fact lowering deterministic and local. If a fact cannot be explained from the declarations in the loaded modules, it should not appear in diagnostics.

