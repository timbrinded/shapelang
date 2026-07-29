# Contract Simulation Change Blocks

Use this reference only in `contract-simulation` mode. A temporary `change` block checks a proposed model state against the current baseline; it is not a source transition or final Shape update.

## Rules

- Validate the current baseline separately and strictly.
- Prefer underclaiming to overclaiming.
- Use `effects unknown` when implementation effects are not source-confirmed.
- Use `effects complete` only when every material planned effect is known.
- Do not synthesize resources, relations, grants, destructive effects, attestations, or reevaluations to make a proposal pass.
- Do not remove a final forbid.
- Report a thin model as `model_gap`.

## Declaration Choices

- Existing function behavior: `modify fn Component.functionName`.
- New modeled function: `add fn Component.functionName`.
- Removed modeled function: `remove fn Component.functionName`.
- Existing component, resource, relation, implementation, or binding: `modify` with the complete intended replacement declaration.
- New declaration: `add` with the complete declaration.
- Removed declaration: `remove <kind> <Name>`.

When unsure, remain in orientation rather than inventing a replacement body.

## Minimal Unknown-Effect Proposal

```shape
module preflight

change ProposedChange {
  modify fn Gateway.derivePolicyDecision
    effects unknown
}
```

## Known Effect Proposal

```shape
module preflight

change AppendAuditEvent {
  modify fn AuditStore.appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

## Guarded Target

Allow the simulation to surface the existing reevaluation obligation:

```shape
module preflight

change RefactorPolicyDecision {
  modify fn Gateway.derivePolicyDecision
    effects unknown
}
```

Do not add a reevaluation merely to clear the simulation. A real reevaluation needs the substantive current fields required by the loaded model.

## Destructive Effect

Draft a destructive effect only when task intent or source evidence establishes it:

```shape
module preflight

change PurgeAuditEvents {
  add fn AuditStore.purgeExpired
    effects complete {
      HardDelete<AuditEvent>
    }
}
```

If `AuditEvent` is append-only, the current checker should reject the proposal.

## Helper

Create a template:

```bash
plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --init
```

Run baseline and draft proposal checks with JSON output:

```bash
SHAPE_CMD="bun shp" plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --json proposal.shape
```

Use `--strict` only when no explicit unknown effects remain:

```bash
SHAPE_CMD="bun shp" plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --strict --json proposal.shape
```

The helper returns `baseline_invalid` without running or interpreting the proposal when the current model fails strict checking.
When `SHAPE_CMD` is unset, it uses a working repository-local `bun shp` command before falling back to an installed `shp`.
