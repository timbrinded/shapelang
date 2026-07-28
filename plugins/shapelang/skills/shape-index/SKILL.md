---
name: shape-index
description: Use when building or refreshing a whole-codebase Shape model. Treat generated AST as navigation evidence, then author reviewed architecture, boundaries, invariants, domain packs, and stable source-backed claims for downstream checking and review.
---

# Shape Index — whole-codebase architecture & invariant authoring

The `shape-lang` skill covers *incremental*, changed-file authoring, not building a
reviewable model of an entire project. This skill is a faithful extension: follow every
rule in the `shape-lang` skill and its `cli-workflows` reference; this file adds the
whole-codebase authoring workflow. Assume `shp` is on `PATH`.

The output (the authored `shape/` model) is what downstream Shape-aware tooling
trusts as contract. Make it an accurate, navigable map of the architecture and
the invariants the code must uphold.

## Two layers

- **Layer 1 — generated AST (already done).** `shape/generated/ast/` contains
  deterministic, source-backed navigation context for the whole codebase:
  per-function anchors, candidate effects, and `source` refs. It is evidence for
  investigation, not an automatically trusted architecture contract. Do NOT
  edit it.
- **Layer 2 — authored architecture (your job).** Author `.shape` files under
  `shape/` (NOT under `shape/generated/`) capturing what the AST cannot:

  1. **Components & responsibilities** — the real architectural units (services,
     routers, adapters, data access, domain) and what each is responsible for.
  2. **Code boundaries / allowed dependencies** — which components may depend on
     which; encode forbidden directions as `forbid` rules where they matter.
  3. **Owned resources & business logic** — the key domain resources and the
     rules that govern them.
  4. **Invariants that must hold** — security/permission rules, data-integrity
     and transactional constraints, and contracts between modules (e.g. "this
     helper returns the parsed credential, never the raw response"; "only the
     owner or an admin may mutate X"; "every write to Y is audited").
  5. **Implementation coverage and review bindings** — authored
     `implementation` declarations that govern significant source paths and
     authored `binding` declarations that require paired docs, generated,
     workflow, or other review-surface changes.

## Grounding (important)

Every authored claim must be **reviewed and traceable to concrete code**. Use
the generated layer to find relevant implementation, then confirm the claim in
source before promoting it. Attach stable references such as
`source ts("packages/.../file.ts#parseRefreshTokenResponse")`; prefer
`file#symbol`, then file-only when no durable symbol exists. Never author
line-number or line-range references. Prefer prelude relation kinds (`calls`,
`provides`, `coordinated_call`, `callbacks`).

## Breadth: cover the WHOLE architecture, not a few subsystems

Shape-aware tooling can only use the model on code that has authored invariants. Code in
a subsystem with NO Layer-2 coverage gets no grounding — a reviewer falls back to a
diff-only read there. So the value of this model is set by how much of the
architecture-significant surface it covers. **Author broadly.**

- Begin by ENUMERATING every architecture-significant subsystem in the repo (the
  top-level domains/services/packages, active domain packs, the cross-cutting concerns — auth/permissions,
  data access & transactions, background/async work, caching, eventing/outbox,
  external integrations, request lifecycle). Produce this list FIRST, from the
  directory layout + `shape/generated/ast/manifest.json` + `shp graph stats`.
- Then author Layer-2 components, boundaries, and INVARIANTS for **each** subsystem
  on that list — aim for comprehensive coverage of the major subsystems, not a
  handful. A large codebase warrants many authored `.shape` files across many
  subsystem areas, each grounded. Thin coverage (a few files over a huge tree) is
  the failure mode to avoid: it leaves most code ungrounded.
- "Do not read every file" is about EFFICIENCY of investigation (sample within a
  subsystem; lean on the AST layer), NOT a license to cover only a few subsystems.
  Be efficient per subsystem; be exhaustive across subsystems.
- Prioritize the invariants most likely to matter to a reviewer: security/permission
  rules, data-integrity & transactional constraints, ownership/atomicity, audited
  writes, required call ordering, and module contracts ("this helper returns the
  parsed credential, never the raw response").

## Author from architecture, not from a pending change (hard rule)

This model is authored ONCE from the codebase's **general architecture**, with no
knowledge of any particular change under review. **Never** author an invariant
because it would catch a specific pull request, diff, or changed file; never read
or target the specific change under review. Author what the architecture genuinely
asserts as an invariant for normal callers; if a real invariant happens to cover a
changed file later, that is the model working as intended — but the authoring decision
must come from the architecture, never from a known change. Model honest uncertainty
(`effects unknown`) rather than inventing a claim to widen coverage.

## Procedure

1. Survey & enumerate: use the directory layout, `shape/generated/ast/manifest.json`,
   and `shp graph stats` to build the full list of architecture-significant
   subsystems (see Breadth). Use `shp graph all` for the complete graph and
   `shp graph show SYMBOL --kind KIND` for focused investigation. Sample key
   modules within each; do not read every file.
2. Author Layer 2 shapes per the categories above for EACH subsystem on the list,
   using Layer 1 to navigate and reviewed source to ground each claim. Include
   `implementation` coverage for architecture-significant source and `binding`
   declarations where changes must remain coupled to docs, generated artifacts,
   workflows, or other review surfaces.
   Put reusable domain policy in packs discovered under the repository's Shape
   roots. A pack is active when it is in default discovery; an `import` controls
   name visibility and does not activate or waive a pack.
3. Model honest uncertainty (`effects unknown`) rather than inventing claims.
   Keep final forbids final.
4. During authoring, use `shp check --allow-unknown-effects` only while explicit
   draft `effects unknown` claims remain. Before handoff, resolve those drafts or
   document why they remain, then run strict `shp fmt --check` and `shp check`.
   The draft flag relaxes only the explicit unknown-effect check; it does not
   weaken unrelated diagnostics.
5. Investigate with `shp explain`, `shp analyze`, analyzer hints, and editor/LSP
   navigation as needed. Analyzer hints and generated facts remain candidates
   until confirmed against source.

## Done when

`shape/` contains an accurate Layer-2 architecture+invariant model that covers the
major subsystems **broadly** (not just a few), every contract claim reviewed
against source, authored purely from the architecture (no change-targeting),
and strict `shp fmt --check` + `shp check` pass.
