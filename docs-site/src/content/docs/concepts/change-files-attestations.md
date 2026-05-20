---
title: Change Files and Attestations
description: Use change files and current attestations without hiding uncertainty.
sidebar:
  order: 4
---

The architecture contract lives in `shape/**/*.shape`. Change files express architecture deltas as checked model files.

![PR change review workflow showing shape system files, shape changes, changed files, coverage, shp check, and CI result.](../../../assets/infographics/pr-change-review.png)

```shape
module changes.PR_001

import audit

change AddAuditRetentionPurge {
  add fn AuditStore.purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

The checker applies change files before rule evaluation. That means a proposed delta can be checked as part of the same model.

## Guarded changes

Some function shapes carry refactor constraints. If a function is protected by a `memory` or `rationale` with `guards on_change require ReEvaluation<Self>`, a `modify fn` or `remove fn` change must include a matching `reevaluation`.

```shape
module changes.PR_004

import gateway

reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}

change RefactorDecision {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

A source-path attestation does not satisfy this obligation. Coverage answers whether the PR documented a governed source change; reevaluation answers whether a guarded function shape was reviewed.

## Unknowns

Unknown effects should be explicit:

```shape
module changes.PR_002

import audit

change ReviewAuditChange {
  add fn AuditStore.reviewMe
    source ts("src/audit/review.ts#reviewMe")
    effects unknown
}
```

Explicit unknowns are better than silently omitting an effect. Protected components should treat unknowns as review blockers.

## Attestations

Attestations document a reviewer decision around a changed source path:

```shape
module changes.PR_003

attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Reporting-only change; no resource effect changed."
}
```

Use attestations sparingly. They should explain why a governed source change does not need a Shape update.

Bindings can also allow attestations. The Shape repo uses `docs_not_needed` when a Shape-affecting source or model file changes but the documented behavior did not:

```shape
module changes.PR_004

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal extraction only; no syntax, diagnostic, or workflow behavior changed."
}
```

The attestation must point at the triggering path, give a concrete reason, and live in a `.shape` file changed by the same run. A previously committed attestation does not waive future source changes.
