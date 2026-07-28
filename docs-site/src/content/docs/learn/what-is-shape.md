---
title: What Shape Is
description: Product boundary, mental model, good-for and not-good-for uses, and the core Shape workflow.
sidebar:
  order: 1
---

Shape is a typed architecture conformance language. It records the semantic shape of a system in `.shape` files that reviewers can read and a deterministic checker can evaluate.

Shape is not a general-purpose programming language. `.shape` files do not execute application logic, compile application source, or replace tests. They state explicit architecture claims, for example:

- this resource is append-only
- this component owns that resource and may emit these effects
- this function emits these effects, with optional source evidence
- this implementation path is governed by a component shape
- this refactor-sensitive function has recorded design context
- this change set updates the Shape model, or attests that no model change is required

## Product boundary

```text
authored .shape claims
+ human review of those claims
+ deterministic checker
+ CI enforcement
```

`.shape` files are the source of architectural truth for Shape. Application code can be messy, implicit, or spread across many files; Shape provides a compact, reviewable model surface.

The checker judges the claims in `.shape` files. It does not prove that implementation code matches the model at runtime. Optional source analyzers can point out suspicious omissions; analyzer hints do not replace the declared model.

**Final forbids are final.** Rationale, memory, reevaluation, and component grants cannot waive a `forbid final`. Prefer `effects unknown` when effects are not yet known over an empty `effects complete` summary that pretends completeness.

![Shape boundary diagram: agent drafts claims, human reviews claims, checker rejects incoherence; tests and code review remain; Shape is not a proof system.](../../../assets/infographics/shape-boundary.png)

## Good for

- Declaring resource invariants (for example append-only storage) that must hold across PRs
- Making ownership, grants, and function effect summaries reviewable in the same place
- Enforcing that governed source changes come with a Shape update or a narrow current attestation
- Binding Shape-affecting changes to docs or other review surfaces
- Capturing design memory and reevaluation obligations for fragile function shapes
- Checking structural relation rules (hypercycles, provides boundaries) over a declared hypergraph
- Emitting deterministic diagnostics with provenance for CI and review

## Not good for

- Proving correctness of arbitrary application behavior
- Replacing tests or code review
- Fully inferring architecture from source without human-reviewed claims
- Softening final forbids through grants, memory, or reevaluation
- Hiding incomplete analysis behind empty complete effect lists

## Core workflow

1. An architecture model lives under `shape/**/*.shape` (default discovery for `shp` commands with no file arguments).
2. PRs update that model when source behavior changes the architecture contract.
3. Reviewers inspect source and evidence refs attached to material effects.
4. Reviewers inspect rationale, memory, or reevaluation attached to refactor-sensitive targets.
5. CI runs `shp check`, often `shp coverage --changed-files`, format checks, and the repo’s usual tests and type checks.
6. Diagnostics explain which claim failed and which declaration or evidence caused it.

![Shape review loop: write rules, review, check, CI gate, diagnose, with failures returning to review.](../../../assets/infographics/shape-model-loop.png)

## Mental model

| Layer | Role |
| --- | --- |
| Resource + trait | What is protected and which effects are allowed, required, or finally forbidden |
| Component | Ownership, grants, and function effect summaries for a boundary |
| Relation | Structural links between components or resources (not nested inside components) |
| Implementation + coverage | Which source paths are governed and must update Shape when they change |
| Memory / reevaluation | Design context and review obligations for non-obvious or guarded shapes |
| Checker | Deterministic accept/reject of model coherence and review obligations |

## Practice

**Do**

- Keep claims narrow and evidence-backed when effects matter for review
- Use `effects unknown` while analysis is incomplete; resolve unknowns before treating the model as review-ready
- Update the global model under `shape/` when architecture behavior changes
- Run `shp check` (and coverage with changed files when relevant) before merge

**Do not**

- Assume a grant overrides a `forbid final`
- Commit empty `effects complete` blocks for functions whose effects are still unknown
- Treat analyzer output as approval of the model
- Expect Shape to validate runtime behavior that is outside the declared claims

## Related pages

- [Quickstart](./quickstart) — install and run `shp`
- [First Shape File](./first-shape-file) — minimal resource and component model
- [Unknowns and Safety](../concepts/unknowns-safety) — when to use `effects unknown`
- [Resources, Traits, and Effects](../concepts/resources-traits-effects) — core vocabulary
- [CLI Reference](../reference/cli) — commands and flags
