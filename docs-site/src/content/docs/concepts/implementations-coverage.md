---
title: Implementations and Coverage
description: Connect source paths to component shapes and enforce PR coverage.
sidebar:
  order: 5
---

Implementation blocks map source paths to component shapes.

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
  on_change require shape_delta
}
```

The coverage command compares changed files with these governed paths.

## Missing delta failure

Run:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
```

If `src/audit/purge.ts` is governed by `AuditStoreImpl` and the PR does not include a shape delta or attestation, coverage fails.

## Why coverage is separate

Conformance checks answer: "Is this model coherent?"

Coverage checks answer: "Did this PR update the model when governed source changed?"

Both checks matter. A coherent baseline can still miss a required PR-level update.
