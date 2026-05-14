# Shape

Shape is a typed architecture conformance language for making architectural claims explicit and checkable.

Application code can be messy, implicit, and spread across many files. Shape gives the system a small human-readable model in `.shape` files:

- resources, traits, and invariants
- components, ownership, capabilities, and dependencies
- function effect summaries with source evidence
- change files for PR-level deltas
- coverage rules for governed source paths
- constrained project rules such as dependency-cycle bans

The checker does not prove the application implementation is correct. It checks that the declared architecture model is coherent. That is the product boundary: humans and LLMs write reviewable claims, then a deterministic checker accepts or rejects those claims.

![Shape workflow infographic](docs/shape-workflow.png)

## What It Catches

The first core use case is append-only resource protection.

If a resource is declared `AppendOnly`, then a function that emits `HardDelete<Resource>` is rejected even if the component grants that effect. Final forbids win over grants.

Shape also covers:

- unknown effects in protected components
- missing grants for declared function effects
- governed source files changed without a shape delta or attestation
- semantic dependency cycles with witness paths
- project-specific rules like "only Gateway may provide JsonRpcEndpoint"
- optional analyzer hints for obvious `DELETE`, `TRUNCATE`, and `DROP` operations

## Setup

```bash
bun install
bun run langium:generate
```

## Example Shape File

Shape files use the `.shape` extension. This example declares an append-only audit resource and two allowed functions:

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>

  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }

  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts:18-25")
    }
}
```

A PR-level change file can add a new function without rewriting the base model:

```shape
module changes.PR_001

import audit

change AddAuditRetentionPurge {
  add fn AuditStore.purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

That change fails because `AuditEvent : AppendOnly` derives a final forbid for `HardDelete<AuditEvent>`.

## How It Works

The checker pipeline is:

1. Parse `.shape` files with Langium.
2. Apply change blocks on top of the base model.
3. Lower declarations into facts such as resources, traits, effects, grants, dependencies, and governed paths.
4. Evaluate deterministic rules.
5. Emit diagnostics with provenance, including the declarations that caused a violation.

The LLM-facing authoring helpers intentionally produce Shape deltas, not prose. The optional analyzer is advisory only: it can flag suspicious omissions, but `.shape` remains the source of truth.

## Commands

```bash
bun shp check
bun shp check --changed-files fixtures/changed/audit_purge.txt
bun shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_delta/audit.shape
bun shp fmt --check fixtures/pass/append_only_append/audit.shape
bun shp explain AuditEvent
bun shp graph Gateway --relation requires
bun shp author --changed-files fixtures/changed/audit_purge.txt --component AuditStore
bun shp analyze --shape-files shape/system/audit.shape fixtures/source/audit_purge.ts
bun shp check fixtures/fail/append_only_hard_delete/audit.shape
bun test
bun run typecheck
```

`shp check` scans `shape/system/**/*.shape` and `shape/changes/**/*.shape` when no files are provided.

Useful commands:

- `bun shp check`: run conformance checks.
- `bun shp coverage --changed-files changed.txt`: enforce shape deltas or attestations for governed paths.
- `bun shp fmt --check`: verify canonical formatting.
- `bun shp explain AuditEvent`: show derived facts and constraints for a symbol.
- `bun shp graph Gateway --relation requires`: print dependency paths.
- `bun shp author --changed-files changed.txt --component AuditStore`: scaffold a reviewable change file with explicit unknowns.
- `bun shp analyze --shape-files shape/system/audit.shape src/file.ts`: compare obvious source hints against declared effects.

## Project Layout

```text
shape/system/
  audit.shape

fixtures/
  pass/
  fail/

packages/
  shp-checker/
  shp-cli/
```

The implementation currently lives in two packages:

- `@shape/shp-checker`: parser, formatter, fact lowering, rule checks, authoring helpers, editor primitives, and analyzer hints.
- `@shape/shp-cli`: command-line wrapper around the checker package.

## CI

CI is wired in `.github/workflows/shape.yml` for formatting, tests, typechecking, and `shp check`.
