---
title: Diagnostics and Provenance
description: Shape diagnostics explain why a model failed, not just what failed.
sidebar:
  order: 9
---

Diagnostics are a primary product surface for Shape.

A useful diagnostic should show the causal path:

```text
function emits effect
effect targets resource
resource has trait
trait derives forbidden effect
component cannot contain function
```

## Example

The hard-delete fixture fails because the function emits an effect that the resource trait forbids:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits:
  HardDelete<AuditEvent>

But:
  AuditEvent has trait AppendOnly
  AppendOnly forbids final HardDelete<AuditEvent>
```

## Provenance

Shape keeps the declarations that caused a violation close to the diagnostic. Evidence refs make the final step reviewable:

```shape no-verify
HardDelete<AuditEvent>
  evidence ts("src/audit/purge.ts:12-16")
```

The diagnostic should lead the reviewer from the failed function to the source span behind the claim.
