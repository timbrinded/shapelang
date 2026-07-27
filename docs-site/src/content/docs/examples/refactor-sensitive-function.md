---
title: Refactor-Sensitive Function
description: A function that requires recorded refactor context before the model passes.
sidebar:
  order: 6
---

## Intent

Show that `RefactorSensitive` on a function requires a matching `RefactorConstraint` memory for the same function target. Without that context, the checker reports `missing required context`.

## Model

Matches `fixtures/pass/memory_guard_refactor_constraint_unknown/audit.shape`:

```shape
module bridge

resource PolicySnapshot

component BridgePoller {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn pollAttestation : RefactorSensitive
    effects complete {
      Read<PolicySnapshot>
    }
}

memory BridgePollingDelayConstraint : RefactorConstraint<fn BridgePoller.pollAttestation> {
  applies_to fn BridgePoller.pollAttestation
  status Unexplained
  confidence High
  summary "Previous attempts to lower this delay caused intermittent settlement failures."
  who { owner BridgeTeam }
}
```

`status Unexplained` keeps uncertainty explicit: the team records that the shape is refactor-sensitive even when the full explanation lives elsewhere.

## Expected result

```bash
shp check fixtures/pass/memory_guard_refactor_constraint_unknown/audit.shape
```

```text
Shape check passed.
```

List recorded memory with:

```bash
shp memory fixtures/pass/memory_guard_refactor_constraint_unknown/audit.shape
```

```text
Memory Guards

fn BridgePoller.pollAttestation
  memory BridgePollingDelayConstraint
  type: RefactorConstraint
  status: Unexplained
  confidence: High
  owner: BridgeTeam
```

## Why it passes

- Prelude trait `RefactorSensitive` requires `RefactorConstraint` satisfied by memory.
- The memory type target and `applies_to` both name `fn BridgePoller.pollAttestation`.
- No guarded change is present, so reevaluation is not required.

## Related concepts

- [Refactor constraints](../concepts/refactor-constraints.md)
- [Guarded change reevaluation](./guarded-change-reevaluation.md)
- [CLI: memory](../reference/cli.md)
