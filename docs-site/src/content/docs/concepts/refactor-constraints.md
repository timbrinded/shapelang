---
title: Refactor Constraints
description: Require typed design context before accepting refactor-sensitive function shapes.
sidebar:
  order: 6
---

Refactor constraints let Shape record why a function shape should not be changed casually. They are useful when the risky part of the architecture is not only an effect like `HardDelete<AuditEvent>`, but the local structure of a function: inline checks, error ordering, compatibility code, or a test-only helper that looks production-shaped.

The checker treats this as design memory with types. A function shape trait creates an obligation, a `rationale` or `memory` satisfies that obligation, and a guarded change requires a `reevaluation`.

Refactor constraints are not waivers. They cannot make a final-forbidden effect pass.

![Design memory diagram showing function shape traits, memory, rationale, review obligations, guards on change, modify fn, ReEvaluation, and the final-forbids rule.](../../../assets/infographics/design-memory-reevaluation.png)

## Function Shape Traits

Function shape traits attach review obligations to a function summary:

| Trait | Required context |
| --- | --- |
| `PreserveInline` | `InlineRationale<fn Component.fn>` from a `rationale` |
| `RequiresDescription` | non-empty `description` plus `DescriptionRationale<fn Component.fn>` |
| `ProtectedCheckOrder` | `CheckOrderRationale<fn Component.fn>` from a `rationale` or `memory` |
| `RefactorSensitive` | `RefactorConstraint<fn Component.fn>` from a `memory` |
| `NonIdiomatic` | `DesignRationale<fn Component.fn>` from a `rationale` or `memory` |
| `TestOnly` | `TestOnlyPurpose<fn Component.fn>` from a `rationale` |

For example, this model says reviewers must see why `derivePolicyDecision` stays inline:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : PreserveInline
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline so reviewers can inspect the authorization path locally."
  owner GatewayTeam
}
```

## Component and Resource Shape Traits

Shape traits are not limited to functions. Components and resources can also carry refactor-sensitive design context, declared in their existing trait list:

| Target | Trait | Required context |
| --- | --- | --- |
| `component` | `RefactorSensitive` | `RefactorConstraint<component C>` from a `memory` |
| `component` | `NonIdiomatic` | `DesignRationale<component C>` from a `rationale` or `memory` |
| `component` | `TestOnly` | `TestOnlyPurpose<component C>` from a `rationale` |
| `resource` | `RefactorSensitive` | `RefactorConstraint<resource R>` from a `memory` |
| `resource` | `NonIdiomatic` | `DesignRationale<resource R>` from a `rationale` or `memory` |

Semantic resource traits such as `AppendOnly` keep their existing meaning; only the shape traits above derive a context obligation, so the two coexist in one trait list:

```shape
module audit

resource AuditEvent : AppendOnly, RefactorSensitive

component AuditStore : RefactorSensitive {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}

memory AuditEventLayout : RefactorConstraint<resource AuditEvent> {
  applies_to resource AuditEvent
  status Explained
  confidence High
  summary "External auditors depend on the AuditEvent field layout."
  owner AuditTeam
}

memory AuditStoreBoundary : RefactorConstraint<component AuditStore> {
  applies_to component AuditStore
  status Unexplained
  confidence High
  summary "The AuditStore boundary keeps append-only storage isolated from query paths."
  owner AuditTeam
}
```

`shp explain` for a component or resource lists its classifiers or traits, the required context derived from them, and any satisfying rationale or memory.

## Required Descriptions

Use `RequiresDescription` when the shape needs a compact explanation at the function declaration itself. This keeps the primary review context next to the source and effect summary:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : RequiresDescription
    description required "Builds the visible authorization decision from policy state."
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale PolicyDecisionDescription : DescriptionRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why Auditability
  summary "Reviewers need the local policy decision purpose."
  owner GatewayTeam
}
```

## Memory

Use `memory` when the team knows a refactor constraint exists, especially when the exact explanation is historical or still incomplete. `status Unexplained` is explicit uncertainty, not a loophole.

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

## Guards and Reevaluation

A `memory` or `rationale` can protect a target with `guards on_change require ReEvaluation<Self>`. After that, a `modify fn` or `remove fn` for the protected function requires a matching `reevaluation`.

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
  owner GatewayTeam
  guards on_change require ReEvaluation<Self>
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

Without the `reevaluation`, the checker reports `guarded shape changed` and tells the author which memory or rationale must be satisfied.

## Property-Level Guards

A guard can protect a specific property rather than the whole target. When every `protects` clause names a detectable property — a shape trait by name, or the `description` — the guard fires only when that exact property is removed by a change:

```shape
rationale DerivePolicyInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Branches stay inline for auditability."
  owner GatewayTeam
  protects shape PreserveInline
  protects description
  guards on_change require ReEvaluation<Self>
}
```

With this guard, a change that only adjusts effects passes, but a change that drops the `PreserveInline` trait or removes the `description` reports `guarded shape changed` and names the removed property. A guard that protects a free-form label (for example `protects shape CheckOrder`, where `CheckOrder` is not a declared shape trait) keeps the coarse behaviour: any `modify` or `remove` of the target requires a reevaluation. The same enforcement applies to guarded component and resource targets through `modify`/`remove` declaration changes.

## Review Freshness

Design memory ages. A `memory` or `rationale` can carry a `review_by` date so reviewers know when the constraint should be revisited:

```shape
memory BridgePollingDelayConstraint : RefactorConstraint<fn BridgePoller.pollAttestation> {
  applies_to fn BridgePoller.pollAttestation
  status Unexplained
  confidence High
  summary "Earlier attempts to lower this delay caused intermittent settlement failures."
  owner BridgeTeam
  review_by "2026-08-18"
}
```

By default `review_by` is informational. Enable enforcement with `--strict-freshness`:

- `shp obligations --strict-freshness` lists entries whose `review_by` is past, under `stale design memory:`.
- `shp check --strict-freshness` turns a past `review_by` into a failing `stale design memory` diagnostic, so CI can require periodic review.

Only ISO `YYYY-MM-DD` dates are enforced; the date on which a review is due still counts as fresh. Missing or non-ISO `review_by` values are never reported as stale. Freshness compares against a caller-provided date rather than the system clock, keeping checks deterministic.

## What To Check In Review

- Use a function shape trait only when it changes review obligations.
- Keep summaries short and specific to the target function.
- Prefer `rationale` for intentional choices and `memory` for refactor constraints.
- Use `status Unexplained` when the constraint is known but not fully explained.
- Add `reevaluation` only after reviewing a guarded change.
- Fix final-forbidden effects directly; design memory cannot waive them.
