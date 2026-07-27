---
title: Shape
description: Shape is a typed architecture conformance language for making architectural claims explicit, reviewable, and checkable.
template: splash
hero:
  tagline: Typed architecture claims in .shape files, reviewed by humans and checked deterministically.
  image:
    file: ../../assets/shape-hero-aperture.webp
    alt: Abstract glass conformance aperture with coherent blue paths and a rejected red diagnostic trace.
  actions:
    - text: Quickstart
      link: /shapelang/learn/quickstart/
      variant: primary
    - text: What Shape is
      link: /shapelang/learn/what-is-shape/
      variant: secondary
---

Shape is a typed architecture conformance language. Humans and agents write reviewable claims in `.shape` files about resources, components, effects, relations, coverage, bindings, and design memory. The deterministic `shp` checker accepts or rejects those claims.

The checker does not prove that application code is correct. It checks whether the declared architecture model is coherent and whether review obligations for that model are satisfied.

![Shape review loop showing code diff, agent draft, .shape claims, human review, source evidence, unknowns, shp check, CI gate, and diagnostics.](../../assets/infographics/shape-model-loop.png)

## Good for

- Making append-only and other resource invariants explicit, including `forbid final` effects that grants cannot override
- Recording component ownership, grants, and function effect summaries with source evidence
- Requiring a Shape update or a narrow current attestation when governed source paths change
- Coupling Shape-affecting changes to docs or other review surfaces via bindings
- Recording design memory and reevaluations for refactor-sensitive functions
- Declaring structural relations and checking project rules over that hypergraph
- Running deterministic checks in CI with diagnostics that name the claim and the declaration that caused the failure

## Not good for

- Proving that arbitrary application logic is correct
- Replacing unit, integration, or property tests
- Replacing human code review of implementation quality
- Inferring a full architecture model from source without a declared `.shape` model
- Waiving a `forbid final` with rationale, memory, reevaluation, or grants
- Treating empty `effects complete` summaries as safe when effects are unknown; prefer `effects unknown` until the summary is honest

Optional analyzers may surface advisory hints. They do not replace the declared model.

## Core example

An append-only resource allows reads and appends and forbids final destructive effects. Prelude `AppendOnly` supplies the final forbids; you can also declare the trait in project files.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
  fn listEvents
    effects complete {
      Read<AuditEvent>
    }
}
```

If a change adds a function whose summary emits `HardDelete<AuditEvent>`, the checker rejects the model even when the component grants that effect. Final forbids win over grants.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  grants Read<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

Run:

```bash
shp check fixtures/fail/append_only_hard_delete/audit.shape
```

Shape can also require typed design context before accepting non-obvious function shapes. A refactor-sensitive function can require matching `memory`, and guarded changes to that function can require a recorded `reevaluation`.

## What to read first

- [What Shape Is](./learn/what-is-shape) — product boundary, workflow, and limits
- [Quickstart](./learn/quickstart) — install `shp` and run checks
- [First Shape File](./learn/first-shape-file) — smallest useful model
- [Append-Only Walkthrough](./learn/append-only-walkthrough) — from trait to diagnostic
- [Global Model Updates](./learn/global-model-updates) — keep `shape/` current
- [CI Workflow](./learn/ci-workflow) — pin `shp` and gate PRs
- [Resources, Traits, and Effects](./concepts/resources-traits-effects) — core vocabulary
- [CLI Reference](./reference/cli) — full `shp` command list
