---
title: Model Updates and Attestations
description: Keep the global Shape model current; use attestations only as current-change evidence.
sidebar:
  order: 4
---

The architecture contract lives in the global files under `shape/`. When governed source changes alter architecture, update the relevant global `.shape` file directly. Shape checks model coherence and review obligations; it does not prove that application code is correct.

![CI review workflow showing global Shape model files, changed files, coverage, shp check, and CI result.](../../../assets/infographics/global-model-review.png)

```shape
module audit

resource AuditEvent

component AuditStore {
  owns AuditEvent
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

The checker evaluates the model as committed. Coverage and bindings, when run with a changed-file list, ask whether this change set updated that model when it should have.

## Guarded changes

Some function, component, resource, or relation shapes carry refactor constraints with guards. If a protected shape changes, include a matching `reevaluation` in the global model:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : RefactorSensitive
    effects complete {
      Read<PolicySnapshot>
    }
}

memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors changed error normalisation behaviour."
  who {
    owner GatewayTeam
  }
  guards {
    on_change require ReEvaluation<Self>
  }
}

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

A source-path attestation does not satisfy this obligation. Coverage answers whether a governed source change was documented; reevaluation answers whether a guarded shape was reviewed. See [Refactor Constraints](./refactor-constraints.md).

## Unknowns

While drafting, mark incomplete effect analysis explicitly:

```shape
module audit

resource AuditEvent

component AuditStore {
  owns AuditEvent
  fn reviewMe
    source ts("src/audit/review.ts#reviewMe")
    effects unknown
}
```

Strict `shp check` reports `unknown effects` as an error. Use `shp check --allow-unknown-effects` only for draft iteration; other diagnostics stay blocking. Prefer explicit unknowns over empty complete summaries. See [Unknowns and Safety](./unknowns-safety.md).

## Attestations

Attestations document a reviewer decision around a changed source path for the current change set:

```shape
module audit

attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Reporting-only change; no resource effect changed."
}
```

`no_shape_change` can satisfy coverage for a governed path when:

1. the attestation `source` matches the changed governed path, and
2. the `.shape` file that declares the attestation is itself in the same changed-file list.

A previously committed attestation does not waive future source changes.

Bindings can allow other attestation kinds. This repository uses `docs_not_needed` when a Shape-affecting source or model file changes but documented behavior did not:

```shape
module shape.checker

binding CheckerDocs {
  when_changed paths {
    "packages/shp-checker/src/checker.ts"
  }
  require_changed paths {
    "docs-site/src/content/docs/reference/diagnostics.md"
  }
  allow attest docs_not_needed
}

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal extraction only; no syntax, diagnostic, or workflow behavior changed."
}
```

The attestation must point at the triggering path, give a concrete reason, and live in a `.shape` file changed by the same run. Bindings are enforced by `shp check --changed-files`, not by `shp coverage` alone.

## Practice

Do:

- Update the owning global `.shape` file when architecture behavior changes.
- Use `no_shape_change` only when the governed source change truly leaves the contract unchanged.
- Put the attestation in a `.shape` file included in the same changed-file list.
- Add `reevaluation` for guarded shape changes; do not substitute an attestation.

Do not:

- Leave a stale attestation in the repo and expect it to cover later changes.
- Use attestations to hide real model drift.
- Attempt to waive `forbid final` with rationale, memory, reevaluation, or grants.
- Confuse coverage (governed source) with bindings (paired review surfaces such as docs).

## Related pages

- [Implementations and Coverage](./implementations-coverage.md)
- [Refactor Constraints](./refactor-constraints.md)
- [Unknowns and Safety](./unknowns-safety.md)
