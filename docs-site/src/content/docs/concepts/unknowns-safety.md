---
title: Unknowns and Safety
description: Keep uncertainty explicit so reviewers and CI can handle it intentionally.
sidebar:
  order: 9
---

Shape should never hide uncertainty. If a function's effects are not known yet, say so.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  fn importLegacyEvents
    source ts("src/audit/import.ts#importLegacyEvents")
    effects unknown
}
```

`effects unknown` is a valid syntax choice, but it is not a safe final state for protected architecture. It tells reviewers exactly where analysis is incomplete.

## Complete effects

Use `effects complete` only when the summary is intended to be exhaustive:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Read<AuditEvent>
  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts:18-25")
    }
}
```

Complete summaries make deterministic checking possible.

