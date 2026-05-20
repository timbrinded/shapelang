# Make Shape Protocol

Use this when authoring or reviewing global `.shape` model updates. For command details, read `cli-workflows.md`.

## Workflow

1. Read the current model first: `shape/**/*.shape` and nearby fixtures.
2. Identify the claim type: resource invariant, component ownership, grant, structural relation, function effect, implementation coverage, rule, attestation, rationale, memory, or reevaluation.
3. Update the owning global model file directly; do not create a separate staging area for model drafts.
4. Include `source` for changed functions and `evidence` for material effects when the source or diff gives line context.
5. Validate with `shp fmt --check`, `shp check`, and `shp coverage --changed-files changed.txt` when changed files are available.

## Authoring Patterns

Good: a reviewable global model update with explicit uncertainty.

```shape
module audit

component AuditStore {
  fn reviewPurgeShape1
    source ts("src/audit/purge.ts")
    effects unknown
}
```

Counterexample: hiding uncertainty with an empty complete block.

```shape
component AuditStore {
  fn reviewPurgeShape1
    source ts("src/audit/purge.ts")
    effects complete {
    }
}
```

Smallest fix: use `effects unknown`, or add every material effect with evidence.

Good: a destructive effect is explicit and source-backed.

```shape
component AuditStore {
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

Counterexample: broadening grants to silence a missing-grant diagnostic without architectural permission.

```shape
component AuditStore {
  owns AuditEvent
  grants HardDelete<AuditEvent>
}
```

Smallest fix: only add the grant if the component is genuinely allowed to perform that effect. A final forbid still fails even with the grant.

## Coverage and Attestation

Good: a governed file with no architecture-relevant change uses a narrow attestation.

```shape
attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Reporting-only copy change; no resource effect changed."
}
```

Counterexample: using an attestation to avoid modeling a real effect.

```shape
attest no_shape_change {
  source ts("src/audit/purge.ts")
  reason "Approved by reviewer."
}
```

Smallest fix: update the global Shape model for the effect, or make the attestation specific enough to explain why no Shape claim changed.

## Review Checklist

- Does every governed changed file have a global model update or narrow attestation?
- Are effects honest, including uncertainty?
- Are grants present only where the component is actually allowed to emit the effect?
- Do final forbidden effects still fail?
- Are structural-dependency changes represented as a top-level `relation` with the right `kind` (`calls`, `callbacks`, `provides`, `coordinated_call`)?
- Are Memory Guard obligations satisfied when shape traits or guarded changes appear?
- Does `shp check` still run after any filtered command such as `shp obligations` or `shp analyze`?
