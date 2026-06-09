# Change Blocks

Use this reference only in `precheck` mode. A temporary change block is plan feedback, not the final Shape update.

## Rules

- Prefer underclaiming to overclaiming.
- Use `effects unknown` when source has not been inspected or effects are not yet known.
- Use `effects complete` only when every material planned effect is explicit.
- Do not synthesize destructive effects unless the user task or source evidence supports them.
- Do not remove a final forbid to make the plan pass.
- Do not add attestation text unless the reason is specific to the task and changed path.
- If the model is too thin to express the plan, report the model gap instead of inventing structure.

## Declaration Choices

- Existing function behavior changes: `modify fn Component.functionName`.
- New modeled function: `add fn Component.functionName`.
- Removed modeled function: `remove fn Component.functionName`.
- Existing component/resource/relation/implementation/binding changes: `modify` followed by the full updated declaration, for example `modify implementation ParserSource { ... }`.
- New component/resource/relation/implementation/binding: `add` followed by the full declaration, for example `add relation ShpCliUsesAnalyzer { ... }`.
- Removed component/resource/relation/implementation/binding: `remove <kind> <Name>`.

When unsure, draft the narrowest function-level change first. For declaration updates, inspect the existing declaration and include the full intended replacement body.

## Minimal Temporary File

```shape
module preflight

change ProposedChange {
  modify fn Gateway.derivePolicyDecision
    effects unknown
}
```

## Known Effects

```shape
module preflight

change AppendAuditEvent {
  modify fn AuditStore.appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

## Guarded Function

If `shp memory` or `shp explain` shows `guards { on_change require ReEvaluation<Self> }`, the precheck should expose the missing reevaluation:

```shape
module preflight

change RefactorPolicyDecision {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Do not add a reevaluation just to silence the precheck. Add it only when the planned implementation has a real reviewer, outcome, summary, date, and evidence.

## Storage Effect

Only draft destructive effects when task intent or source evidence supports them:

```shape
module preflight

change PurgeAuditEvents {
  add fn AuditStore.purgeExpired
    effects complete {
      HardDelete<AuditEvent>
    }
}
```

If the target resource has `AppendOnly`, `shp check` should surface the final-forbid violation.

## Relation Addition

```shape
module preflight

change AddCliAnalyzeDependency {
  add relation ShpCliUsesAnalyzer {
    kind calls
    connects ShpCli -> ShapeAnalyzer
    summary "Analyze command dispatch uses analyzer comparison."
  }
}
```

Use prelude relation kinds (`calls`, `callbacks`, `provides`, `coordinated_call`) unless the loaded model declares and uses a custom kind.

## Temporary Helper Commands

When Bash is available:

```bash
skills/shape-contract-preflight/scripts/precheck.sh --init
skills/shape-contract-preflight/scripts/precheck.sh /tmp/shape-preflight.xxxxxx.shape
```

If the repository wraps the CLI or the released `shp` on `PATH` is older than the model grammar:

```bash
SHAPE_CMD="bun shp" skills/shape-contract-preflight/scripts/precheck.sh /tmp/shape-preflight.xxxxxx.shape
```

Manual equivalent:

```bash
tmp="$(mktemp "${TMPDIR:-/tmp}/shape-preflight.XXXXXX")"
shape_tmp="${tmp}.shape"
mv "$tmp" "$shape_tmp"
$EDITOR "$shape_tmp"
shp check $(find shape -type f -name '*.shape') "$shape_tmp"
rm -f "$shape_tmp"
```

Adapt the command to the repository's documented Shape CLI wrapper when it does not call the released binary as `shp`.
