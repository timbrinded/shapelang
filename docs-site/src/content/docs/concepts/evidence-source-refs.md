---
title: Evidence and Source Refs
description: Make Shape claims inspectable by linking them to stable source references.
sidebar:
  order: 3
---

Evidence is how Shape stays reviewable. An effect summary should point to the stable source symbol that supports the claim, or to the containing file when no stable symbol exists.

![Evidence path diagram showing a claim, effect, evidence, source reference, reviewer check, and checker provenance.](../../../assets/infographics/evidence-review-path.png)

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
}
```

## Source refs

Source refs use a language tag and a string path:

```shape no-verify
source ts("src/audit/store.ts#appendEvent")
evidence ts("src/audit/store.ts#appendEvent")
```

The parser accepts the structure; reviewers interpret the path convention. Prefer `#symbol` references because they survive unrelated line movement. Use a file-only reference when the evidence has no stable named symbol. Avoid line and line-range suffixes in authored Shape.

## Why evidence matters

The checker intentionally does not prove the implementation is correct. Evidence gives reviewers a concrete place to compare source code with the declared effect.

Good evidence is narrow, stable, and points at the behavior being claimed. File-level evidence is appropriate when no stable symbol exists, but it is less precise during review.

## Analyzer relationship

The analyzer can flag obvious destructive operations such as `DELETE`, `TRUNCATE`, or `DROP`, then compare hints with declared effects. It is advisory.

The declared `.shape` model remains the source of truth.
