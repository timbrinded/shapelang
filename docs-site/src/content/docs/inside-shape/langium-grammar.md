---
title: Langium Grammar
description: The current grammar shape and where to change it.
sidebar:
  order: 2
---

The grammar lives at `packages/shp-checker/src/language/shape.langium`.

The entry rule is `ShapeModule`:

```text
module declaration
imports
top-level declarations
```

Top-level declarations currently include resources, traits, components, implementations, change blocks, attestations, rules, rationale, memory, and reevaluation records.

## Syntax bias

Shape should stay boring:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

The syntax optimizes for reviewability, diff clarity, canonical formatting, diagnostic quality, and low ambiguity.

## Generated artifacts

After grammar edits, run:

```bash
bun run langium:generate
```

Generated files live under `packages/shp-checker/src/language/generated/`.
