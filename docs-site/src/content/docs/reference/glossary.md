---
title: Glossary
description: Short definitions for the core terms used in Shape.
sidebar:
  order: 4
---

| Term | Meaning |
| --- | --- |
| Architecture claim | A reviewable statement in `.shape` about resources, components, effects, dependencies, or changes. |
| Attestation | A documented reviewer decision that a governed source change does not require a shape delta. |
| Change file | A module that applies PR-level additions, modifications, or removals to the baseline model. |
| Component | A named architectural boundary containing ownership, grants, dependencies, and function summaries. |
| Complete effects | An effect summary that claims to be exhaustive for a function. |
| Diagnostic | A checker message explaining why a model failed. |
| Effect | A declared operation such as `Append<AuditEvent>` or `HardDelete<AuditEvent>`. |
| Evidence | A source reference that supports an effect claim. |
| Final forbid | A trait or rule constraint that cannot be overridden by a component grant. |
| Governed path | A source path covered by an implementation block. |
| Implementation | A mapping from source paths to a component shape. |
| Resource | A protected architectural target such as a table, stream, endpoint, bucket, or domain object. |
| Shape delta | A change-file entry that updates the declared architecture model. |
| Source ref | A language-tagged path such as `ts("src/audit/store.ts:8-14")`. |
| Trait | A reusable set of allowed, required, or forbidden effect patterns. |
| Unknown effects | An explicit marker that a function's effects are not known yet. |

