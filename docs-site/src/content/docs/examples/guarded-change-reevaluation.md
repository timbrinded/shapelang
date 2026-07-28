---
title: Guarded Change Reevaluation
description: A guarded function modification that fails until the change records a reevaluation.
sidebar:
  order: 7
---

## Intent

Show that a memory with `guards { on_change require ReEvaluation<Self> }` blocks `modify`/`remove` of the guarded target until a matching `reevaluation` is present.

## Model (fails without reevaluation)

Matches `fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape`:

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
  summary "Previous refactors broke error normalisation."
  who { owner GatewayTeam }
  guards { on_change require ReEvaluation<Self> }
}

change RefactorDecision {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

## Expected result (failure)

```bash
shp check fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape
```

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DecisionRefactorConstraint.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DecisionRefactorConstraint
  or preserve the protected shape.

caused by:
  - fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape: change RefactorDecision modify fn Gateway.derivePolicyDecision
  - fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape: memory DecisionRefactorConstraint guards on_change require ReEvaluation<Self>
```

Exit code `1`.

## Model (passes with reevaluation)

Matches `fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape`. Adding a valid reevaluation makes the guarded change explicit:

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
  summary "Previous refactors broke error normalisation."
  who { owner GatewayTeam }
  guards { on_change require ReEvaluation<Self> }
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

```bash
shp check fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape
```

```text
Shape check passed.
```

## Why

Guards force review of protected targets. The reevaluation records outcome, summary, reviewer, date, and evidence against the memory that owns the guard. Design memory still does not waive final forbids on effects.

## Related concepts

- [Refactor constraints](../concepts/refactor-constraints.md)
- [Refactor-sensitive function](./refactor-sensitive-function.md)
- [Diagnostics: guarded shape changed](../reference/diagnostics.md)
