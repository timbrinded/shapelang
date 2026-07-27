---
title: Global Model Updates
description: Keep the global shape/**/*.shape model aligned with architecture changes.
sidebar:
  order: 5
---

Architecture claims belong in `shape/**/*.shape`. The checker loads those files as one global model. This page covers how to update that model when source behavior changes, when to use `effects unknown`, and when a narrow attestation is enough.

If an architecture change is not ready to be checked, keep it outside `shape/`. Any file under `shape/` is part of the checked model.

![CI review workflow showing global Shape model files, changed files, coverage, shp check, and CI result.](../../../assets/infographics/global-model-review.png)

## When this applies

- Governed source paths change behavior that the Shape model describes
- You add or remove functions, effects, relations, rules, or design memory
- A change does not alter architecture and needs a current `attest no_shape_change`

Coverage answers whether a governed path was documented in the current change set. Semantic check answers whether the committed model is coherent. Both matter.

## Edit the owning global file

When source changes alter architecture, edit the owning global `.shape` file directly. Keep the module complete and checkable. Example: a purge path that claims hard-delete (this fails under prelude `AppendOnly`; that failure is intentional when teaching final forbids):

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  grants Read<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

The checker evaluates the model as committed. Coverage then requires that changed governed source paths have a current `.shape` source or evidence reference, or a current attestation, in a `.shape` file that is also part of the change set. See [Implementations and Coverage](../concepts/implementations-coverage) and [Model Updates and Attestations](../concepts/model-updates-attestations).

## Update checklist

1. Find the component, resource, implementation, relation, rule, or memory that describes the changed behavior.
2. Edit the global `.shape` file under `shape/` so claims match the intended architecture contract.
3. Add source and evidence refs for material effects.
4. Use `effects unknown` only while uncertainty remains; do not leave empty complete summaries.
5. Add a `reevaluation` when changing a guarded function shape that requires one.
6. Format and check:

```bash
git diff --name-only origin/main...HEAD > changed.txt
shp fmt --check
shp check --changed-files changed.txt
```

`shp check --changed-files` runs semantic checks plus coverage and bindings. You can also run `shp coverage --changed-files changed.txt` separately.

## Draft unknowns

Authoring helpers and incomplete analysis often produce `effects unknown`. That is the correct conservative claim until effects are known. Strict `shp check` rejects unknowns so they cannot ship as if they were resolved.

Validate a draft without weakening other rules:

```bash
shp check --allow-unknown-effects draft.shape
```

Unknown effects become warnings. Final forbids, missing grants for known effects, guarded-change obligations, coverage, bindings, and malformed structure remain blocking. Resolve every unknown and run strict `shp check` before committing the model or using it in CI.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  fn importLegacyEvents
    source ts("src/audit/import.ts#importLegacyEvents")
    effects unknown
}
```

## Attestation path

If a governed source change does not alter the architecture model, add a narrow attestation in a `.shape` file that is part of the same change set:

```shape
module audit

attest no_shape_change {
  source ts("src/audit/reporting.ts")
  reason "Formatting-only change; no resource access or effect changed."
}
```

Attestations are current-change evidence. A previously committed attestation does not waive a future source change unless the declaring `.shape` file is changed again with a current attestation for that change.

Bindings can use similar attestations (for example `docs_not_needed` when docs coupling is declared). Point the attestation at the triggering path, give a concrete reason, and keep it in a changed `.shape` file.

## Guarded function shapes

Refactor-sensitive or otherwise guarded functions can require `memory` and, when the shape changes, a matching `reevaluation`. A source-path attestation does not satisfy that obligation. Coverage documents that a governed path was acknowledged; reevaluation documents that a guarded shape change was reviewed. See [Refactor Constraints](../concepts/refactor-constraints).

## Best practices

**Do**

- Prefer one coherent global model under `shape/` over ad-hoc sidecar models for the same contract
- Keep attestations narrow, path-specific, and current
- Use `effects unknown` during draft; require complete summaries for protected paths before merge
- Run `shp obligations` and `shp memory` when editing guarded targets

**Do not**

- Commit incomplete modules that reference undeclared resources or effects
- Rely on an old attestation for a new change set
- Use `--allow-unknown-effects` in CI as a permanent gate
- Expect memory or reevaluation to override a `forbid final`

## Related pages

- [CI Workflow](./ci-workflow)
- [Missing Shape Update](../examples/missing-shape-update)
- [Global Model Update](../examples/global-model-update)
- [Unknowns and Safety](../concepts/unknowns-safety)
