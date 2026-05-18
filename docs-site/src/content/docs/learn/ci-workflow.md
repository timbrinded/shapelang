---
title: CI Workflow
description: Run Shape checks, coverage checks, formatting, tests, and docs verification in CI.
sidebar:
  order: 6
---

Shape is meant to run in review. The existing workflow already checks formatting, tests, typechecking, and conformance.

The docs site adds one more rule: every complete `shape` code fence in the docs must parse with the repo's Shape parser.

## Recommended CI checks

```bash
bun install --frozen-lockfile
bun run langium:generate
bun test
bun run typecheck
bun shp check
bun run docs:check
```

## Coverage gate

Coverage checks compare changed source paths with implementation blocks:

```bash
bun shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
```

If a governed source path changes without a shape delta or attestation, the checker rejects the change.

## Docs gate

`bun run docs:check` runs:

- Astro/Starlight validation
- Shape code-block verification
- Static docs build

Incomplete docs snippets must opt out explicitly:

````markdown
```shape no-verify
fn fragmentOnly
  effects unknown
```
````

Complete examples should remain parseable so readers can trust them.
