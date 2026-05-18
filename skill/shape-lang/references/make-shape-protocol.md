# Make Shape Protocol

Use this when authoring or reviewing `.shape` files and change files.

## Workflow

1. Read the current model first: `shape/system/**/*.shape`, relevant `shape/changes/**/*.shape`, and nearby fixtures.
2. Identify the architectural claim being made: resource invariant, component ownership, grant, dependency, function effect, implementation coverage, rule, or memory guard.
3. Prefer a small `.shape` delta over rewriting the base model.
4. Include `source` for changed functions and `evidence` for material effects when the source/diff gives line context.
5. Run `shp fmt --check` and `shp check`; when the workflow provides a changed-files list, also run `shp coverage --changed-files changed.txt`.

## Authoring Rules

- Use `effects complete` only when every material effect is represented.
- Use `effects unknown` when uncertainty remains.
- Represent destructive operations honestly: `HardDelete`, `Truncate`, and `DropStorage`.
- Add grants only when the component is genuinely allowed to perform the effect.
- Final forbids win over grants and memories.
- Use `attest no_shape_change` only for changed governed files that do not alter Shape-relevant architecture.
- Keep summaries short and typed structure strong.

## Change Files

Use PR-level change files for reviewable deltas:

```shape
module changes.PR_001

import audit

change ReviewAuditChange {
  add fn AuditStore.reviewPurgeShape1
    source ts("src/audit/purge.ts")
    effects unknown
}
```

When source changes are governed by an `implementation` with `on_change require shape_delta`, the change file must cover the changed source path or an attestation must explain why no Shape claim changed.

## Review Checklist

- Does every governed changed file have a matching shape delta or attestation?
- Are effects honest, including uncertainty?
- Are grants present for emitted effects?
- Do final forbidden effects still fail?
- Are dependency changes represented with `requires`/`provides`?
- Are Memory Guard obligations satisfied when shape traits or guarded changes appear?
