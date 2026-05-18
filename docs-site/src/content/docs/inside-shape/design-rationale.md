---
title: Design Rationale
description: Why Shape is designed as a small, explicit, deterministic language.
sidebar:
  order: 6
---

Shape is built around one product distinction:

```text
The LLM writes claims.
The human reviews claims.
The checker rejects incoherent claims.
```

![Shape boundary diagram showing agent drafted claims, human review, deterministic checker rejection, retained tests and code review, and the not-a-proof-system boundary.](../../../assets/infographics/shape-boundary.png)

## Non-goals

Shape should not initially try to:

- compile TypeScript into `.shape`
- prove application implementation correctness
- replace tests
- replace code review
- become a full proof assistant
- execute business logic
- generate application code

## Why boring syntax

The syntax should be explicit and stable because the files are review surfaces.

Prefer this:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

Avoid compressed notation that saves characters but hides meaning from reviewers.

## Why diagnostics matter

The checker's output is part of the product. A rejection should be explainable as a causal path from a source-backed function claim to an architecture constraint.
