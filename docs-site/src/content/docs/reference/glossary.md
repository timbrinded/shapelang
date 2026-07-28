---
title: Glossary
description: Short definitions for the core terms used in Shape.
sidebar:
  order: 4
---

| Term | Meaning |
| --- | --- |
| Architecture claim | A reviewable statement in `.shape` about resources, components, effects, relations, or review context. |
| Attestation | A documented reviewer decision that a governed source or bound review-surface change does not require a Shape or docs update. Common kinds include `no_shape_change` and `docs_not_needed`. |
| Binding | A declaration that couples changed paths, such as requiring docs changes when Shape-affecting code changes. Enforced by `shp check --changed-files`. |
| Candidate effect | An `effect candidate` declaration that records machine-readable effect evidence (often from AST generation). Not a reviewed `effects complete` summary. |
| Component | A named architectural boundary that owns resources, grants effects, and contains function summaries. Does not carry structural dependencies. |
| Complete effects | An effect summary that claims to be exhaustive for a function (`effects complete { ... }`). |
| Coverage | The change-set check that governed source paths require a Shape update or current attestation (`shp coverage` / `shp check --changed-files`). |
| Diagnostic | A checker message explaining why a model failed. Kind and rendered text order are deterministic. |
| Domain pack | A vendored Shape module under `shape/vendor/` that contributes declarations to the checked model. |
| Effect | A declared operation such as `Append<AuditEvent>` or `HardDelete<AuditEvent>`. |
| Evidence | A source reference that supports an effect claim. |
| Final forbid | A trait or rule constraint that cannot be overridden by a component grant, rationale, memory, or reevaluation. |
| Governed path | A source path covered by an implementation block with change requirements. |
| Hyperedge | A named structural link between two or more components or resources, declared as a `relation`. |
| Hypercycle | A cycle in the directed hypergraph, found by traversing relations according to their `kind`. |
| Implementation | A mapping from source paths to a component shape (`conforms_to`, optional `on_change`). |
| Incidence | The vertex-to-hyperedge index that drives `shp graph` and hypercycle checks. |
| Memory | A typed design-memory declaration, usually for a refactor constraint. |
| Rationale | A typed explanation for an intentional function, component, or resource shape. |
| Reevaluation | A typed review record that can satisfy a guarded change. |
| Refactor constraint | Design context (`RefactorConstraint`) that makes a target refactor-sensitive. |
| Relation | A top-level declaration describing a hyperedge with a `kind`, `connects`, optional `roles`, optional fingerprint `expects`, and optional `summary`. |
| Relation kind | A label such as `calls`, `callbacks`, `provides`, or `coordinated_call`. Each kind declares arity and cycle traversal semantics. |
| Resource | A protected architectural target such as a table, stream, endpoint, bucket, or domain object. |
| Required description | A non-empty function description required by a function shape trait or explicit `description required`. |
| Shape update | A changed global `.shape` declaration that keeps the architecture model aligned with source changes. |
| Shape trait | A function-, component-, or resource-level trait such as `PreserveInline` or `RefactorSensitive` that derives review obligations. |
| Source ref | A language-tagged path with an optional stable symbol, such as `ts("src/audit/store.ts#appendEvent")`. |
| Trait | A reusable set of allowed, required, or forbidden effect patterns, and optional `require_context` obligations. |
| Unknown effects | An explicit marker (`effects unknown`) that a function's effects are not known yet. |
