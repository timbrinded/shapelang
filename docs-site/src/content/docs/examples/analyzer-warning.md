---
title: Analyzer Warning
description: Compare obvious source hints with declared Shape effects.
sidebar:
  order: 5
---

## Intent

Show how `shp analyze` surfaces obvious destructive source patterns and compares them to declared Shape effects. Analyzer output is advisory evidence for authors; it is not a substitute for the declared model or for `shp check`.

## Model and source

Use a Shape model that only claims append, and a source file that deletes:

```bash
shp analyze --shape-files fixtures/pass/append_only_append/audit.shape fixtures/source/audit_purge.ts
```

`fixtures/source/audit_purge.ts` contains a Kysely-style delete:

```typescript
export async function purgeOldEvents(db: { deleteFrom: (table: string) => unknown }) {
  return db.deleteFrom("audit_events");
}
```

The Shape file under comparison grants and emits only `Append<AuditEvent>` on `appendEvent`.

## Expected result

```text
warning: analyzer hint missing from shape effects

fixtures/source/audit_purge.ts:2 suggests HardDelete.
suspected target: audit_events
evidence: return db.deleteFrom("audit_events");
```

Exit code `1` when comparison mode reports any warning. Without `--shape-files`, the analyzer prints advisory hints and exits successfully.

## Why

The source pattern matches a known destructive family (Kysely `deleteFrom`). The compared Shape model does not declare a corresponding `HardDelete` effect for that function, so the analyzer reports a missing-effect warning.

How to respond:

1. Inspect the source and decide whether the architecture claim should include the effect.
2. Update the global model if the behavior is real, for example:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

3. Run `shp check` on the updated model. Against `AppendOnly`, this claim still fails with `forbidden effect` because final forbids win over grants.

Do not treat analyzer output as proof of correctness or as permission to ignore final forbids.

## Related concepts

- [Analyzer hints](../concepts/analyzer-hints.md)
- [Append-only hard-delete failure](./append-only-hard-delete-failure.md)
- [CLI: analyze](../reference/cli.md)
