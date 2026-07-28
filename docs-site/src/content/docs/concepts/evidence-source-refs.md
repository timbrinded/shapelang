---
title: Evidence and Source Refs
description: Link Shape effect claims to stable source references for review.
sidebar:
  order: 3
---

Evidence makes Shape claims reviewable. An effect summary should point at the stable source symbol that supports the claim, or at the containing file when no stable symbol exists. The checker does not prove that the implementation is correct; evidence gives reviewers a concrete place to compare source with the declared model.

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

The fragment above is intentionally incomplete (`shape no-verify`). In a full module, `source` sits on the function summary and `evidence` sits on individual effects.

The parser accepts the structure; reviewers interpret the path convention. Prefer `#symbol` anchors because they survive unrelated line movement. Use a file-only reference when the evidence has no stable named symbol. Avoid line and line-range suffixes in authored Shape.

Common language tags in fixtures and the repo model include `ts(...)`, `rust(...)`, and `test(...)`. The tag is part of the ref; keep it consistent with the evidence kind.

## Why evidence matters

Coverage and change review use source and evidence paths to decide whether a governed source change already has a current Shape update. A matching `source` or `evidence` path counts for coverage only when the declaring `.shape` file is also in the current changed-file list. See [Implementations and Coverage](./implementations-coverage.md).

Diagnostics can surface attached evidence on forbidden-effect failures so the causal trail ends at the claimed source span.

## Analyzer relationship

The optional source analyzer can flag obvious destructive operations such as `DELETE`, `TRUNCATE`, or `DROP`, then compare hints with declared effects. Those warnings are advisory. They do not authorize or reject the model.

The declared `.shape` model remains the source of truth. See [Analyzer Hints](./analyzer-hints.md).

## Practice

Do:

- Prefer `#symbol` anchors for named functions, methods, and types.
- Put function-level `source` on the summary and per-effect `evidence` when effects map to different spans.
- Use file-only refs only when no stable symbol exists.
- Keep evidence narrow: one claim, one supporting location.

Do not:

- Encode line numbers or ranges as the primary review handle.
- Point evidence at unrelated files to satisfy coverage without a real model update.
- Treat analyzer warnings as proof that effects are complete.
- Omit evidence on production effect claims that reviewers cannot locate.

## Related pages

- [Diagnostics and Provenance](./diagnostics-provenance.md)
- [Implementations and Coverage](./implementations-coverage.md)
- [Analyzer Hints](./analyzer-hints.md)
