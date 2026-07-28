---
title: Implementations and Coverage
description: Map source paths to component shapes and enforce current-change coverage.
sidebar:
  order: 5
---

Implementation blocks map source paths to component shapes. Coverage compares a changed-file list against those paths and requires a current Shape update or a current attestation when governed source changes. The checker still evaluates model coherence separately; coverage answers whether this change set documented architecture impact.

![Implementation coverage diagram showing source paths mapped through implementation blocks to components, with changed files passing through a coverage gate via Shape update or attestation.](../../../assets/infographics/implementation-coverage-map.png)

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
}

implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
  }
  conforms_to AuditStore
  on_change require shape_update
}
```

| Field | Role |
| --- | --- |
| `paths` | Globs of governed source paths. |
| `conforms_to` | Component shape the paths are claimed to implement. |
| `on_change require shape_update` | Coverage obligation when a matching path changes. |

## How coverage counts a Shape update

Build a newline-delimited changed-file list for the current change set (CI and local scripts usually write `changed.txt`):

```text
src/audit/purge.ts
```

Run coverage against your model files:

```bash
shp coverage --changed-files changed.txt shape/audit.shape
```

With no shape file arguments, coverage also scans `shape/**/*.shape` by default.

A matching `source` or `evidence` reference counts as a Shape update for a changed governed path only when the declaring `.shape` file is also in the current changed-file list. Alternatively, a current `attest no_shape_change` whose `source` matches the changed path can satisfy coverage when that attestation's declaring `.shape` file is in the same list. Example attestation (in a `.shape` file that is itself listed in `changed.txt`):

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
}

implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
  }
  conforms_to AuditStore
  on_change require shape_update
}

attest no_shape_change {
  source ts("src/audit/purge.ts")
  reason "Formatting-only change; no resource access or effect changed."
}
```

## Missing model update failure

If a governed source path changes and the changed-file list does not include a current Shape update or current attestation, coverage fails with `governed source changed without current Shape update`.

In the Shape language repository, the same case is packaged as:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_update/audit.shape
```

`shp check --changed-files changed.txt` runs semantic checks and, with the same list, coverage and bindings together.

## Coverage versus bindings

| Check | Question |
| --- | --- |
| Conformance (`shp check`) | Is the declared model coherent? |
| Coverage (`shp coverage` or `shp check --changed-files`) | Did this change set update the model when governed source changed? |
| Bindings (`shp check --changed-files`) | Did a paired review surface (for example docs) change when a bound path changed? |

`shp coverage` alone does not enforce bindings. A coherent model can still fail coverage on a PR that changes governed source without a current global model update.

## Practice

Do:

- Govern production architecture paths with `implementation` blocks and `on_change require shape_update`.
- When changing governed source, update the owning `.shape` file with matching `source` / `evidence`, or add a narrow current `attest no_shape_change`.
- Generate the changed-file list the same way CI does (for example `bun run changed-files` in this repo) before local coverage runs.
- Keep globs tight enough that unrelated trees are not forced into architecture review.

Do not:

- Rely on a previously committed attestation to cover a new change.
- Point `source` / `evidence` at a governed path from an unchanged `.shape` file and expect coverage to pass.
- Use coverage as a substitute for semantic checks or for reevaluation of guarded shapes.
- Leave production paths ungoverned if CI is expected to catch missing model updates.

## Related pages

- [Model Updates and Attestations](./model-updates-attestations.md)
- [Evidence and Source Refs](./evidence-source-refs.md)
- [CLI Reference](../reference/cli.md)
