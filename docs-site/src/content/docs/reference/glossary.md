---
title: Glossary
description: Short definitions for the core terms used in Shape.
sidebar:
  order: 4
---

| Term | Meaning |
| --- | --- |
| Architecture claim | A reviewable statement in `.shape` about resources, components, effects, relations, or review context. |
| Attestation | A documented reviewer decision that a governed source or bound review-surface change does not require a Shape update. |
| Binding | A rule that couples changed paths, such as requiring docs changes when Shape-affecting code changes. |
| Component | A named architectural boundary that owns resources, grants effects, and contains function summaries. Does not carry structural dependencies. |
| Complete effects | An effect summary that claims to be exhaustive for a function. |
| Diagnostic | A checker message explaining why a model failed. |
| Effect | A declared operation such as `Append<AuditEvent>` or `HardDelete<AuditEvent>`. |
| Evidence | A source reference that supports an effect claim. |
| Final forbid | A trait or rule constraint that cannot be overridden by a component grant. |
| Governed path | A source path covered by an implementation block. |
| Hyperedge | A named structural link between two or more components or resources, declared as a `relation`. |
| Hypercycle | A cycle in the directed hypergraph, found by traversing relations according to their `kind`. |
| Implementation | A mapping from source paths to a component shape. |
| Incidence | The vertex-to-hyperedge index that drives `shp graph` and hypercycle checks. |
| Memory | A typed design-memory declaration, usually for a refactor constraint. |
| Rationale | A typed explanation for an intentional function shape. |
| Reevaluation | A typed review record that can satisfy a guarded change. |
| Refactor constraint | Design context that makes a function shape refactor-sensitive. |
| Relation | A top-level declaration describing a hyperedge with a `kind`, `connects`, optional `roles`, and optional `summary`. |
| Relation kind | A label such as `calls`, `callbacks`, `provides`, or `coordinated_call`. Each kind declares arity and cycle traversal semantics. |
| Resource | A protected architectural target such as a table, stream, endpoint, bucket, or domain object. |
| Required description | A non-empty function description required by a function shape trait or explicit `description required`. |
| Shape update | A changed global `.shape` declaration that keeps the architecture model aligned with source changes. |
| Shape trait | A function-level trait such as `PreserveInline` or `RefactorSensitive` that derives review obligations. |
| Source ref | A language-tagged path such as `ts("src/audit/store.ts:8-14")`. |
| Trait | A reusable set of allowed, required, or forbidden effect patterns. |
| Unknown effects | An explicit marker that a function's effects are not known yet. |
