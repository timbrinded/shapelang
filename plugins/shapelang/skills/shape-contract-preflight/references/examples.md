# Preflight Examples

Use these as response calibration patterns. The final brief should be short and implementation-oriented.

## Modify Existing Function

User task:

```text
Refactor Gateway.derivePolicyDecision without changing behavior.
```

Expected workflow:

- Run `shp explain Gateway.derivePolicyDecision`.
- Run `shp graph show Gateway`.
- Run `shp memory` because the task is a refactor.
- Inspect files named by `source` and `evidence`.
- If guarded, surface the reevaluation path before implementation.

Temporary block:

```shape
module preflight

change RefactorPolicyDecision {
  modify fn Gateway.derivePolicyDecision
    effects unknown
}
```

Run the default draft precheck because the proposal deliberately uses
`effects unknown`:

```bash
plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh /tmp/change.shape
```

Decision: proceed only after guard obligations are known. Draft mode relaxes
only the explicit unknown-effect diagnostic; any guard or final-forbid failure
still blocks.

## Add Storage Effect

User task:

```text
Add purgeExpired to delete old audit events.
```

Expected workflow:

- Locate `AuditEvent`, `AuditStore`, and existing storage effects.
- Check for resource traits such as `AppendOnly`.
- Run `shp explain AuditEvent` and `shp explain AuditStore`.

Temporary block:

```shape
module preflight

change AddAuditPurge {
  add fn AuditStore.purgeExpired
    effects complete {
      HardDelete<AuditEvent>
    }
}
```

Decision: revise plan if `shp check` reports a final-forbid violation.
Because the effects are fully enumerated, use
`precheck.sh --strict /tmp/change.shape`.

## Add Relation

User task:

```text
Wire the CLI analyze command through ShapeAnalyzer.
```

Expected workflow:

- Locate `ShpCli` and `ShapeAnalyzer`.
- Run `shp graph show ShpCli`.
- Use `calls` if the model declares this as a command dispatch dependency.

Temporary block:

```shape
module preflight

change AddAnalyzeCommandRelation {
  add relation ShpCliUsesAnalyzer {
    kind calls
    connects ShpCli -> ShapeAnalyzer
    summary "Analyze command dispatch uses analyzer comparison."
  }
}
```

Decision: proceed if relation semantics match the source change and no graph rule fails.
Use strict precheck because the proposal contains no unknown effects.

## Add A Route Across A Forbidden Path

User task:

```text
Let Gateway obtain secrets through PolicyService.
```

Expected workflow:

- Run `shp graph show Gateway`, `shp graph show PolicyService`, and
  `shp explain SecretStore`.
- Inspect graph rules and active vendored domain-pack policy.
- Model the intended relation instead of assuming an indirect path bypasses a
  boundary.

Temporary block:

```shape
module preflight

change AddSecretRoute {
  add relation PolicyProvidesSecret {
    kind provides
    connects PolicyService -> SecretStore
  }
}
```

Decision: if a final `forbid path Gateway -> SecretStore over calls or provides`
fails, revise the implementation plan or ask for an architecture decision.
Neither draft validation nor an import change can waive the rule.

## Remove Guarded Function

User task:

```text
Remove the old release asset checksum function.
```

Expected workflow:

- Locate the modeled function and source ref.
- Run `shp explain <Function>`.
- Run `shp memory` and `shp obligations`.
- If guarded, precheck should show the required reevaluation unless the function is not actually guarded.

Temporary block:

```shape
module preflight

change RemoveChecksumBuilder {
  remove fn ReleasePipeline.buildReleaseAssets
}
```

Decision: revise plan or add a real reevaluation path before implementation if the checker reports a guarded change.

## Change Source Covered By Implementation

User task:

```text
Move the parser entrypoint to packages/shp-checker/src/parser/index.ts.
```

Expected workflow:

- Find the implementation declaration covering the current source path, such as `ParserSource`.
- Check bindings that couple docs, generated AST, release assets, or public review surfaces.
- If the source path changes, plan the corresponding Shape implementation update or a narrow attestation only if the architecture contract truly did not change.

Temporary block:

```shape
module preflight

change MoveParserSource {
  modify implementation ParserSource {
    paths {
      "packages/shp-checker/src/parser/index.ts"
    }
    conforms_to ShapeParser
    on_change require shape_update
  }
}
```

Decision: inspect the actual model syntax and symbol name for the implementation declaration before finalizing the update. If the implementation symbol is unknown, stay in orientation mode and report the model gap.

## Thin Model

User task:

```text
Change the UI copy for the settings page.
```

Expected output:

```markdown
The current Shape model does not locate this work. I will fall back to normal repo inspection; a Shape update is only required if the code change touches governed source or changes architecture claims.
```
