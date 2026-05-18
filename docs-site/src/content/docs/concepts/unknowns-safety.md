---
title: Unknowns and Safety
description: Keep uncertainty explicit so reviewers and CI can handle it intentionally.
sidebar:
  order: 10
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

## Unexplained refactor constraints

`effects unknown` is for incomplete effect analysis. It is different from a known refactor constraint that the team cannot fully explain yet.

For refactor-sensitive functions, use a typed `memory` with `status Unexplained`:

```shape
module bridge

resource Attestation

component BridgePoller {
  owns Attestation
  grants Read<Attestation>
  fn pollAttestation : RefactorSensitive
    effects complete {
      Read<Attestation>
    }
}

memory BridgePollingDelayConstraint : RefactorConstraint<fn BridgePoller.pollAttestation> {
  applies_to fn BridgePoller.pollAttestation
  status Unexplained
  confidence High
  summary "Previous attempts to lower this delay caused intermittent settlement failures."
  owner BridgeTeam
}
```

That keeps uncertainty reviewable without hiding the known constraint.
