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

## Transform Guards

A guard can name a specific refactor intent to forbid, instead of reacting to any change. A `modify fn` change declares its intent with `transform`, and a guard forbids named transforms with `guards forbid transform`:

```shape
rationale DerivePolicyInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Branches stay inline for auditability."
  owner GatewayTeam
  guards forbid transform ExtractHelper
}

change ExtractPolicyHelper {
  modify fn Gateway.derivePolicyDecision
    transform ExtractHelper
    effects complete {
      Read<PolicySnapshot>
    }
}
```

The checker reports `guarded shape changed` and names the transform. A change that declares a different transform, or none, does not trigger the forbid-transform guard by itself. Common labels are `ExtractHelper`, `RemoveDescription`, and `SplitDecisionTree`, but any identifier works; matching is structural between the declared intent and the guard. A `reevaluation` that satisfies the guarding memory or rationale clears the obligation.

## Guarding Dependencies

Guards are not limited to functions, components, and resources. A `memory` or `rationale` can protect a `relation` target, so a load-bearing dependency edge cannot be rewired or removed without review:

```shape
memory PollerSettlementCoupling : RefactorConstraint<relation PollerCallsSettlement> {
  applies_to relation PollerCallsSettlement
  status Unexplained
  confidence High
  summary "The poller-settlement call edge is timing-sensitive."
  owner BridgeTeam
  guards on_change require ReEvaluation<Self>
}
```

A `modify relation` or `remove relation` change to the guarded edge then reports `guarded shape changed` until a matching `reevaluation` is added. `shp explain` for the relation lists its guards and satisfying context, so the protected dependency is reviewable.

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

## Roles and Approver Policy

By default a `reevaluation` needs a `reviewer` and a `decided_on`; the `approver` is optional. Two opt-in declarations tighten this for sensitive design memory.

Declare valid review identities with `role`, and a project policy with `policy`. Mark the memory that needs sign-off with `sensitive`:

```shape
role Security
role GatewayTeam

policy ReviewPolicy {
  require approver
}

memory DecisionConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  sensitive
  summary "The decision path is security-sensitive."
  owner GatewayTeam
}
```

With an approver policy present, a `reevaluation` that satisfies a `sensitive` memory must name an `approver`, not just a `reviewer`. Without a policy, or for memories that are not `sensitive`, the approver stays optional. When at least one `role` is declared, every `reviewer` and `approver` must name a declared role; an unknown role is reported as an invalid reevaluation. Declaring no roles leaves review identities unchecked, preserving the default path.

## What To Check In Review

- Use a function shape trait only when it changes review obligations.
- Keep summaries short and specific to the target function.
- Prefer `rationale` for intentional choices and `memory` for refactor constraints.
- Use `status Unexplained` when the constraint is known but not fully explained.
- Add `reevaluation` only after reviewing a guarded change.
- Fix final-forbidden effects directly; design memory cannot waive them.
