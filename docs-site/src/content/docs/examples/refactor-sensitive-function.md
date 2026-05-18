---
title: Refactor-Sensitive Function
description: A function that requires recorded refactor context before the model passes.
sidebar:
  order: 6
---

This example marks a polling function as `RefactorSensitive`. That trait requires a matching `RefactorConstraint` memory for the same function target.

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

Run the checker against the fixture:

```bash
shp check fixtures/pass/memory_guard_refactor_constraint_unknown/audit.shape
```

The model passes because the function has the required design memory. `status Unexplained` keeps uncertainty explicit: the team knows this shape is refactor-sensitive, even if the full explanation still lives in issue history or incident notes.

Use `shp memory` to list recorded rationale and memory entries:

```bash
shp memory fixtures/pass/memory_guard_refactor_constraint_unknown/audit.shape
```

Example output:

```text
Memory Guards

fn BridgePoller.pollAttestation
  memory BridgePollingDelayConstraint
  type: RefactorConstraint
  status: Unexplained
  confidence: High
  owner: BridgeTeam
```
