---
title: Effect Model
description: How resources, traits, components, and function summaries fit together, and the order in which shp check judges each declared effect.
---

The effect model is the part of the Shape model that `shp check` judges function by function. Resources name the data the architecture protects, and traits attach final forbids to them. Components own resources, grant effects, and contain function summaries. Each summary declares the effects its function emits and can cite the code behind each claim.

![AppendOnly, applied to AuditEvent, forbids final HardDelete, Truncate, and DropStorage; AuditStore owns AuditEvent (name-checked only), grants Append on AuditEvent, and contains appendEvent, which declares an Append effect targeting AuditEvent and cites ts("src/audit/store.ts#appendEvent") as source and evidence; GatewayCallsAudit is a top-level calls relation from Gateway to AuditStore.](../../../assets/diagrams/model-map.svg)

The examples on this page build on this model, which passes `shp check`:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts#listEvents")
    }
}
```

## Resources

A resource is an architectural target that the model protects: a table, stream, bucket, ledger, queue, secret, endpoint, or domain object. It need not be a single runtime type. Traits follow the name after `:`, separated by commas, and an optional body holds metadata:

```shape
module audit

resource AuditEvent : AppendOnly {
  storage postgres.table("audit_events")
}
```

- `storage provider("value")` records where the resource lives. `shp check` ignores it; `shp analyze --shape-files` uses the value as an alias when it matches source operations to resources. See [Analyzer Hints](/shapelang/guides/analyzer/).
- `fingerprint provider("value")` records a content hash, usually of a generated AST anchor, that relation `expects` pins and `effect candidate` pins compare against. A resource declares each provider at most once. See [Generate Drafts from Source](/shapelang/guides/ast-drafts/).

## Traits and final forbids

A `trait` declares members that apply to whatever carries it. Only two kinds of member affect `shp check`:

| Member | Effect on `shp check` |
| --- | --- |
| `forbid final Effect<T>` | Enforced. A declared effect that matches the pattern on a resource carrying the trait fails with `forbidden effect`, whether or not the component grants it. |
| `require_context Context<T>` | Enforced. Creates a design-context obligation; see [Design Memory](/shapelang/concepts/design-memory/). |
| `allow Effect<T>` | Parsed and formatted, not enforced. |
| `require Effect<T>` | Parsed and formatted, not enforced. Nothing checks that any function emits the effect. |
| `forbid Effect<T>` | Parsed and formatted, not enforced. Only `forbid final` blocks an effect. |

### Declaring a trait

```shape
module audit

trait Immutable<T: Resource> {
  forbid final Update<T>
}

resource AuditEvent : AppendOnly, Immutable
```

A trait application names the trait without type arguments. `resource AuditEvent : AppendOnly, Immutable` binds each trait's type parameter, whatever its name, to `AuditEvent`. A pattern written without a target, such as `forbid final Update`, also binds to the resource that carries the trait, so it forbids `Update<AuditEvent>`. `shp explain AuditEvent` lists the final forbids that result, the first three from the prelude `AppendOnly`:

```text
AuditEvent
  kind: resource
  traits:
    AppendOnly
    audit::Immutable

  final forbidden effects:
    HardDelete<AuditEvent>
    Truncate<AuditEvent>
    DropStorage<AuditEvent>
    Update<AuditEvent>
```

### Prelude traits

The standard prelude supplies these traits without a declaration:

- `AppendOnly<T: Resource>` has three final forbids: `HardDelete<T>`, `Truncate<T>`, and `DropStorage<T>`.
- `Persistent`, `Ephemeral`, `PII`, `Secret`, `Public`, `External`, and `Internal` are markers. They forbid nothing, but a rule can test for them with `when T has Trait`.
- Shape traits such as `PreserveInline`, `RequiresDescription`, and `RefactorSensitive` derive no effect policy. They require design context instead; see [Design Memory](/shapelang/concepts/design-memory/).

A trait declared in a module under a prelude name replaces the prelude trait for that module, with no diagnostic. Other modules still resolve the bare name to the prelude trait, with one exception: a prelude-named trait declared in a file with no `module` line replaces the prelude trait for every module in the Shape model. Either way, a replacement `trait AppendOnly` whose only member is `forbid final HardDelete<T>` leaves `Truncate` and `DropStorage` unforbidden. A prelude name should not be redeclared.

### Rule-derived final forbids

A `rule` can derive a final forbid from a condition instead of a trait member. This model marks `AuditEvent` with an empty trait, and the rule forbids hard deletes on every resource that carries it:

```shape
module audit

trait Protected<T: Resource> {
}

resource AuditEvent : Protected

component AuditStore {
  owns AuditEvent
  grants Read<AuditEvent>
  fn listEvents
    effects complete {
      Read<AuditEvent>
    }
}

rule protected_events_are_not_deleted {
  forbid final HardDelete<T>
  when T has Protected
}
```

- `when T has Protected` binds the rule-local subject `T` to each resource that carries `Protected`, and `T` in `HardDelete<T>` refers to that subject.
- A rule with `forbid final` binds exactly one subject. With no `when` clause it is reported as `invalid rule` with the reason `final effect forbids require exactly one when subject`; with two subjects, the reason is `final effect forbids may bind only one subject, but found T, U`.
- Several `when` clauses on the same subject must all hold.
- The condition trait declares no type parameters, or exactly one `Resource`-bound parameter. Any other shape makes the rule an `invalid rule`.
- A plain `forbid` in a rule, like one in a trait, is not enforced.

A function in this model that emits `HardDelete<AuditEvent>` fails with `forbidden effect`. The message names the condition trait (`AuditEvent has trait Protected. Protected forbids final HardDelete<AuditEvent>.`), and the last `caused by:` line names the rule: `rule protected_events_are_not_deleted forbids final HardDelete<T>`.

### Nothing waives a final forbid

A final forbid, whether it comes from a trait or a rule, stays in force whatever else the model declares. A matching `grants` line, a `rationale` or `memory`, a `reevaluation`, an attestation, and an import all leave it in force. Permitting the effect takes a change to a claim: removing the trait from the resource, removing the forbid from the trait or rule, or shadowing the trait with a same-named declaration (see [Prelude traits](#prelude-traits) and [Domain Packs](/shapelang/guides/domain-packs/)). An effect entry rewritten so that it no longer matches, by renaming the effect or dropping its `<Resource>` target, also passes; see [Check order](#check-order). Each of these changes appears in the `.shape` diff.

## Components, ownership, and grants

A component is the authority boundary. It owns resources, grants effects, and contains function summaries, and its body holds only `owns`, `grants`, and `fn` members, in any order. Traits after the component name are shape traits (see [Design Memory](/shapelang/concepts/design-memory/)). A structural link such as a call between components is a top-level `relation`, never a component member; see [Relations and Graph Rules](/shapelang/concepts/relations/).

- `owns AuditEvent` claims ownership, and the checker only checks that `AuditEvent` is a declared resource (`unknown resource` otherwise). Ownership does not gate grants or effects, several components may own the same resource, and `owns` adds no edge to the relation graph. It says nothing about runtime allocation.
- `grants Append<AuditEvent>` permits every function in the component to emit that effect. A grant matches on the exact effect name and the resolved resource, and it covers only its own component.

## Function summaries

A `fn` member summarizes one function. Its members appear in this fixed order, and any other order is a parse error:

| Position | Member | Notes |
| --- | --- | --- |
| 1 | `: Trait, ...` | Optional shape traits; see [Design Memory](/shapelang/concepts/design-memory/). |
| 2 | `source tag("path#symbol")` | Optional, at most one; see [Source and evidence](#source-and-evidence). |
| 3 | `description "..."` or `description required "..."` | Optional. With `required`, an empty description gives `missing required description`. |
| 4 | `unsafe` | Optional; see [Unsafe functions](#unsafe-functions). |
| 5 | `effects unknown` or `effects complete { ... }` | Required. |
| 6 | `requires Capability`, `reason "..."`, `expires "..."` | Optional, in any order. |

### Unknown and complete effects

| Summary | Claim | Result |
| --- | --- | --- |
| `effects unknown` | The function's effects are not yet known. | In an authored module, `error: unknown effects` (exit 1). |
| `effects complete { }` | The function emits no effects. | Passes, because there is nothing to check. |
| `effects complete { Append<AuditEvent> ... }` | The function emits exactly these effects. | Each entry goes through the [check order](#check-order). |

An empty `effects complete { }` is a claim, not a placeholder: it asserts that the function has no effects. While the effects are not known, `effects unknown` is the accurate summary, and `shp check` keeps the gap visible by rejecting it. Two exceptions apply:

- `shp check --allow-unknown-effects` downgrades only unknown effects to warnings. It is for local drafting, never for CI; see [CLI Reference](/shapelang/reference/cli/).
- A module named `shape.generated.ast` or `shape.generated.ast.*` whose file is under `shape/generated/ast/` may keep `effects unknown` with no diagnostic. Both conditions are required; see [Generate Drafts from Source](/shapelang/guides/ast-drafts/).

A constraint that the team knows about but cannot fully explain yet belongs in design memory, not in `effects unknown`; see [Design Memory](/shapelang/concepts/design-memory/).

### Unsafe functions

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Update<AuditEvent>
  fn backfillEvents
    source ts("src/audit/backfill.ts#backfillEvents")
    unsafe effects complete {
      Update<AuditEvent>
    }
    expires "2026-12-31"
    reason "One-off backfill for the audit schema migration."
    requires MigrationWindow
}
```

A function marked `unsafe` must also declare a non-empty `reason`, a non-empty `expires`, and at least one `requires` term. When any is missing, `shp check` reports `unsafe effects missing policy metadata` and lists what is missing (`Missing: reason, expires, required capability.`). `unsafe` changes nothing else: the forbid and grant checks still apply, `expires` is not read as a date, and `requires` terms are recorded but not resolved.

## Source and evidence

A function's `source` names the code that implements the function, and each effect entry's `evidence` names the code that performs that effect. Both are optional and written `tag("path#symbol")`:

- The tag is any identifier, such as `ts`, `rust`, `test`, or `md`, and is never validated.
- `shp check` never opens the path and does not validate the anchor.
- A function has at most one `source`, and each effect entry at most one `evidence`.
- The `forbidden effect` diagnostic prints the offending entry's `evidence:` line.

A `#symbol` anchor survives unrelated line movement, so it is the preferred form. A file-only reference suits code with no stable named symbol. Line numbers go stale and should be avoided.

Coverage reads these references. It drops the `#anchor` and any `:line` or `:line-line` suffix, compares the path with the changed-file list, and counts a reference only when its own `.shape` file is also in that list; see [Keep the Model Current](/shapelang/guides/keep-model-current/). Coverage verifies that the model changed alongside the code, not that the reference describes it, so evidence pointed at an unrelated file satisfies coverage while misleading reviewers.

`shp analyze` can compare obvious destructive operations in source with the declared effects. Its warnings are advisory; see [Analyzer Hints](/shapelang/guides/analyzer/).

## Check order

For each function, `shp check` applies these checks in order:

1. `effects unknown` in an authored module gives `error: unknown effects`.
2. A targeted effect that matches a final forbid on its target resource gives `error: forbidden effect`. The grant check is skipped for that entry, so no `missing grant` is reported.
3. Any other targeted effect that the component does not grant gives `error: missing grant`.

An effect without a `<Resource>` target skips both the forbid check and the grant check, so `HardDelete` written without a target passes even when every resource is `AppendOnly`. This includes a trait pattern written without a target: `forbid final Update` forbids `Update<AuditEvent>`, not a bare `Update`. A named target must be a declared resource; otherwise `unknown resource` is reported, alongside `missing grant` when the effect is not granted. Effect names are free identifiers matched literally against grants and forbids. The prelude names (`Read`, `Append`, `Update`, `Redact`, `LogicalDelete`, `HardDelete`, `Truncate`, `DropStorage`, `Export`, `Import`) are editor completions, not a closed set.

This model exercises each step:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn importLegacyEvents
    source ts("src/audit/import.ts#importLegacyEvents")
    effects unknown
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
  fn redactEvent
    source ts("src/audit/redact.ts#redactEvent")
    effects complete {
      Notify
      Redact<AuditEvent>
    }
}
```

`shp check` exits 1:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")

caused by:
  - shape/audit.shape: effect AuditStore.purgeOldEvents emits HardDelete<AuditEvent>
  - shape/audit.shape: resource AuditEvent : AppendOnly
  - standard prelude: trait AppendOnly forbids final HardDelete<T>

error: missing grant

AuditStore.redactEvent emits Redact<AuditEvent>.
AuditStore does not grant Redact<AuditEvent>.

caused by:
  - shape/audit.shape: effect AuditStore.redactEvent emits Redact<AuditEvent>
  - shape/audit.shape: component AuditStore

error: unknown effects

AuditStore.importLegacyEvents declares effects unknown.

caused by:
  - shape/audit.shape: fn AuditStore.importLegacyEvents
```

`HardDelete<AuditEvent>` is not granted, yet only `forbidden effect` appears for it. Adding `grants HardDelete<AuditEvent>` to `AuditStore` leaves this output unchanged. `Notify` has no target, so neither check applies to it. The diagnostics are sorted by kind and then by text, not by check order; see [Diagnostics](/shapelang/reference/diagnostics/).
