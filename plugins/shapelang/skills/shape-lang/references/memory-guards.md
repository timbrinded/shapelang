# Memory Guards

Use this when working with function shape traits, descriptions, rationales, memories, or reevaluations.

Memory Guards add typed design memory. They are restrictive: they add obligations and can block refactors. They are not waivers and must not make a final-forbidden effect pass.

## Contents

- [Obligation Table](#obligation-table)
- [Rationale](#rationale)
- [Required Description](#required-description)
- [Memory](#memory)
- [Reevaluation](#reevaluation)
- [Property-Level and Transform Guards](#property-level-and-transform-guards)
- [Freshness](#freshness)
- [Sensitive Memory, Roles, and Approver Policy](#sensitive-memory-roles-and-approver-policy)
- [User-Defined Obligations](#user-defined-obligations)
- [Nested Guard Blocks](#nested-guard-blocks)
- [Target Integrity](#target-integrity)
- [Final Forbids](#final-forbids)

## Obligation Table

Shape traits can be borne by functions (`fn X : Trait`), components (`component X : Trait`), and resources (`resource X : Trait`). The target in the required context type matches the bearer: `<fn Component.fn>`, `<component X>`, or `<resource X>`.

| Shape trait | Targets | Required context |
| --- | --- | --- |
| `PreserveInline` | fn | `InlineRationale<target>` from a `rationale` |
| `RequiresDescription` | fn | non-empty `description` plus `DescriptionRationale<target>` |
| `ProtectedCheckOrder` | fn | `CheckOrderRationale<target>` from a `rationale` or `memory` |
| `RefactorSensitive` | fn, component, resource | `RefactorConstraint<target>` from a `memory` |
| `NonIdiomatic` | fn, component, resource | `DesignRationale<target>` from a `rationale` or `memory` |
| `TestOnly` | fn, component | `TestOnlyPurpose<target>` from a `rationale` |

A project can also declare its own obligations with `require_context` (see [User-Defined Obligations](#user-defined-obligations)); a user trait declared with a built-in name shadows the built-in obligation.

## Rationale

Good: explain an intentional function shape with a typed target.

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  who { owner GatewayTeam }
}
```

Counterexample: adding the trait without the required context.

```shape
fn derivePolicyDecision : PreserveInline
  effects complete {
    Read<PolicySnapshot>
  }
```

Smallest fix: add a matching `InlineRationale<fn Gateway.derivePolicyDecision>`.

## Required Description

Good: keep compact local purpose next to the function.

```shape
fn derivePolicyDecision : RequiresDescription
  description required "Builds the visible authorization decision from policy state."
  effects complete {
    Read<PolicySnapshot>
  }
```

Counterexample: empty required description.

```shape
fn derivePolicyDecision : RequiresDescription
  description required ""
  effects complete {
    Read<PolicySnapshot>
  }
```

Smallest fix: add a non-empty description and a matching `DescriptionRationale`.

## Memory

Good: preserve a refactor constraint, including explicit uncertainty.

```shape
memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  who { owner GatewayTeam }
  guards { on_change require ReEvaluation<Self> }
}
```

Use `status Unexplained` when the team knows a refactor constraint exists but cannot fully explain why yet.

Counterexample: vague memory that behaves like a waiver.

```shape
memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Explained
  summary "Known issue approved by team."
}
```

Smallest fix: state the specific refactor constraint or remove the memory.

## Reevaluation

Good: record review evidence for a guarded change.

```shape
reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
```

Counterexample: incomplete reevaluation.

```shape
reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Looks fine."
}
```

Smallest fix: include `evidence`, `reviewer`, and `decided_on`, and make sure `satisfies` points to an existing memory or rationale.

## Property-Level and Transform Guards

A `guards on_change require ...` clause fires when its target changes without a satisfying reevaluation. Pair it with `protects` to scope what counts as a change:

- `protects shape <Trait>` makes the guard fire only when that exact shape trait is removed from the target (a precise diagnostic naming the trait), instead of on any change.
- `protects description` (function targets) makes the guard fire when a required description is dropped.
- With no detectable `protects` clause — or a free-form `protects shape <label>` that is not a real trait — the guard falls back to coarse matching and fires on any modify/remove of the target.

```shape
memory DerivePolicyShape : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "The inline decision shape is load-bearing for auditability."
  who { owner GatewayTeam }
  protects { shape RefactorSensitive }
  guards { on_change require ReEvaluation<Self> }
}
```

A `guards forbid transform <Label>` clause fires when a change declares that transform intent on the target via `modify fn ... transform <Label>`. Use it to require review before a specific named refactor (for example a public-symbol rename).

```shape
memory RenameGuard : DesignRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Explained
  confidence High
  summary "Public symbol name is referenced by external dashboards."
  who { owner GatewayTeam }
  guards { forbid transform RenameSymbol }
}
```

A change like `modify fn Gateway.derivePolicyDecision transform RenameSymbol effects complete { ... }` then requires a reevaluation satisfying the memory. Smallest fix: add the reevaluation, or do not declare the forbidden transform.

## Freshness

A `rationale` or `memory` can carry a `review_by "YYYY-MM-DD"` date. Freshness is opt-in and deterministic: the checker never reads the system clock, so it only enforces dates when the caller passes one.

- `shp check --strict-freshness` and `shp obligations --strict-freshness` inject today's date (computed at the CLI boundary) and report design memory whose `review_by` is strictly before it as `stale design memory`.
- Only well-formed ISO `YYYY-MM-DD` dates are enforced; a non-ISO or calendar-invalid `review_by` is left untouched rather than guessed at.

```shape
memory BridgeDelayConstraint : RefactorConstraint<fn BridgePoller.pollAttestation> {
  applies_to fn BridgePoller.pollAttestation
  status Unexplained
  confidence High
  summary "Lowering this delay previously caused settlement failures."
  who { owner BridgeTeam }
  when { review_by "2026-01-01" }
}
```

Smallest fix for a stale entry: review the design memory and update `review_by`, or replace it with a `reevaluation`.

## Sensitive Memory, Roles, and Approver Policy

Mark a memory `sensitive` when its review carries elevated risk. Combined with a project `policy` that requires an approver, a `sensitive` memory's reevaluation must name an `approver`, not just a `reviewer`.

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
  summary "Security-sensitive decision path."
  who { owner GatewayTeam }
  guards { on_change require ReEvaluation<Self> }
}

reevaluation DecisionReviewed {
  satisfies memory DecisionConstraint
  outcome Confirmed
  summary "Reviewed and confirmed; behaviour preserved."
  evidence test("gateway/decision.test.ts")
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
}
```

Rules:

- Without an approver `policy`, `approver` stays optional and the default reviewer-only path applies.
- If any `role` is declared, every `reviewer` and `approver` value must be a declared role; an unknown role is rejected.
- A missing approver on a sensitive memory under an approver policy reports `missing approver required by policy`.

## User-Defined Obligations

A `trait` can define its own context obligation with `require_context ContextType<T>`, where `T` is the trait's type parameter. Its bound sets the target kind: `Fn` (or unbound) maps to a function, `Component` to a component, `Resource` to a resource. An optional `satisfied_by rationale`, `satisfied_by memory`, or `satisfied_by rationale or memory` clause restricts which context kind satisfies it; the default accepts either.

```shape
trait PreserveLocal<T: Fn> {
  require_context LocalRationale<T> satisfied_by rationale or memory
}
```

A `<T>` that names no declared type parameter, or an unrecognised bound, is reported as `invalid require_context` rather than silently defaulting. A trait declared with the same name as a built-in shape trait replaces (shadows) the built-in obligation through name resolution — so a local `trait RefactorSensitive { require_context ... }` governs instead of the built-in `RefactorConstraint`.

## Nested Guard Blocks

`protects`, `guards`, `who` (owner), and `when` (review_by) members are authored as grouped blocks. This is the only guard-member syntax — `shp fmt` always emits these blocks. `protects` entries are comma-separated; `who` and `when` each hold a single value.

```shape
memory DecisionConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "The inline decision shape is load-bearing."
  protects { shape RefactorSensitive }
  guards { on_change require ReEvaluation<Self> }
  who { owner GatewayTeam }
  when { review_by "2027-01-01" }
}
```

## Target Integrity

Counterexample: type target and `applies_to` disagree.

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.otherDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  who { owner GatewayTeam }
}
```

Smallest fix: make the context type target and `applies_to` target identical.

## Final Forbids

Counterexample: memory cannot rescue a final-forbidden effect.

```shape
fn purgeOldEvents : RefactorSensitive
  effects complete {
    HardDelete<AuditEvent>
  }

memory PurgeDeleteConstraint : RefactorConstraint<fn AuditStore.purgeOldEvents> {
  applies_to fn AuditStore.purgeOldEvents
  status Explained
  summary "This behavior is documented."
}
```

Smallest fix: fix the effect or policy. Do not use rationale, memory, or reevaluation as a waiver.
