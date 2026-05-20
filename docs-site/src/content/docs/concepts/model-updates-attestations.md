---
title: Model Updates and Attestations
description: Keep the global Shape model current without hiding uncertainty.
sidebar:
  order: 4
---

The architecture contract lives in the global files under `shape/`. When governed source changes alter architecture, update the relevant global `.shape` file directly.

![PR change review workflow showing shape model files, changed files, coverage, shp check, and CI result.](../../../assets/infographics/pr-change-review.png)

```shape
module audit

component AuditStore {
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

The checker evaluates the model as committed.

## Guarded Changes

Some function shapes carry refactor constraints. If a protected function's shape changes, include a matching `reevaluation` in the global model.

```shape
module gateway

reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}

component Gateway {
  fn derivePolicyDecision : RefactorSensitive
    effects complete {
      Read<PolicySnapshot>
    }
}
```

A source-path attestation does not satisfy this obligation. Coverage answers whether a governed source change was documented; reevaluation answers whether a guarded function shape was reviewed.

## Unknowns

Unknown effects should be explicit while drafting:

```shape
module audit

component AuditStore {
  fn reviewMe
    source ts("src/audit/review.ts#reviewMe")
    effects unknown
}
```

Explicit unknowns are better than silently omitting an effect. Protected components should treat unknowns as review blockers.

## Attestations

Attestations document a reviewer decision around a changed source path:

```shape
module audit

attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Reporting-only change; no resource effect changed."
}
```

Use attestations sparingly. They should explain why a governed source change does not need a Shape model update.

Bindings can also allow attestations. The Shape repo uses `docs_not_needed` when a Shape-affecting source or model file changes but the documented behavior did not:

```shape
module shape.checker

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal extraction only; no syntax, diagnostic, or workflow behavior changed."
}
```

The attestation must point at the triggering path, give a concrete reason, and live in a `.shape` file changed by the same run. A previously committed attestation does not waive future source changes.
