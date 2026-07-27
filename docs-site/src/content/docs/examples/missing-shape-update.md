---
title: Missing Shape Update
description: A coverage failure for a governed source path changed without a Shape update.
sidebar:
  order: 3
---

## Intent

Show that coverage checks fail when a governed source path changes without a matching Shape update or current `attest no_shape_change`. The model can be semantically coherent and still fail the change-set gate.

## Model

Matches `fixtures/fail/missing_shape_update/audit.shape`:

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

Changed-file list (`fixtures/changed/audit_purge.txt`):

```text
src/audit/purge.ts
```

The list names a path under the implementation glob and does not include a `.shape` update or attestation for that change.

## Expected result

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_update/audit.shape
```

```text
error: governed source changed without current Shape update

Changed file: src/audit/purge.ts
Governed by: audit::AuditStoreImpl
Matched path: src/audit/**/*.ts
Required: update a current .shape file with matching source/evidence, or add a no_shape_change attestation.

caused by:
  - fixtures/fail/missing_shape_update/audit.shape: implementation AuditStoreImpl
  - fixtures/fail/missing_shape_update/audit.shape: implementation AuditStoreImpl path src/audit/**/*.ts
```

Exit code `1`.

`shp check --changed-files ...` also runs this coverage check (plus bindings). Coverage-only mode does not enforce bindings.

## Why it fails

`on_change require shape_update` means a matching change set must update Shape (with source or evidence that covers the changed path) or include a current `attest no_shape_change` whose source points at the governed change. Neither is present, so the checker rejects the change set.

## Related concepts

- [Implementations and coverage](../concepts/implementations-coverage.md)
- [Model updates and attestations](../concepts/model-updates-attestations.md)
- [CLI: coverage and check](../reference/cli.md)
