---
title: Global Model Updates
description: Update Shape's checked architecture model directly.
sidebar:
  order: 5
---

Architecture claims belong in `shape/**/*.shape`. The checker loads those files as one global model.

If an architecture change is not ready to be checked, keep it outside `shape/`. Files under `shape/` are part of the model like any other source file.

![PR change review workflow showing shape model files, changed files, coverage, shp check, and CI result.](../../../assets/infographics/pr-change-review.png)

When source changes alter architecture, edit the owning global model file:

```shape
module audit

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

The checker evaluates the model as committed. Coverage then confirms that changed governed source paths have a current `.shape` source or evidence reference, or a current attestation.

## Update Checklist

1. Find the component, resource, implementation, relation, rule, or memory that describes the changed behavior.
2. Edit the global `.shape` file directly.
3. Add source and evidence refs for material effects.
4. Use `effects unknown` only while uncertainty remains.
5. Add a `reevaluation` when changing a guarded function shape.
6. Run `shp fmt --check` and `shp check --changed-files changed.txt`.

## Attestation Path

If a governed source change does not alter the architecture model, add a narrow attestation in a changed global `.shape` file:

```shape
module audit

attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Formatting-only change; no resource access or effect changed."
}
```

Attestations are current-change evidence. A previously committed attestation does not waive a future source change unless the declaring `.shape` file is changed again.
