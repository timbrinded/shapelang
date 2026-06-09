---
name: shape-index
description: Use when building a whole-codebase Shape model — author higher-level architecture, boundary, and INVARIANT shapes on top of the generated AST layer, grounded in the AST anchors, so that Shape-aware tooling (review, navigation) has an accurate map of the architecture and the rules the code must uphold. Extends the shape-lang skill from incremental changed-file authoring to whole-project authoring.
---

# Shape Index — whole-codebase architecture & invariant authoring

The `shape-lang` skill covers *incremental*, changed-file authoring, not building a
reviewable model of an entire project. This skill is a faithful extension: follow every
rule in the `shape-lang` skill and its `cli-workflows` reference; this file adds the
whole-codebase authoring workflow. Assume `shp` is on `PATH`.

The output (the `shape/` model) is what downstream Shape-aware tooling reads — make it an
accurate, navigable map of the architecture and the invariants the code must uphold.

## Two layers

- **Layer 1 — generated AST (already done).** `shape/generated/ast/` already
  contains deterministic, source-backed AST Shape context for the whole codebase:
  per-function anchors, candidate effects, and `source` refs. This is the
  concrete, low-level layer. Do NOT edit it.
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

## Grounding (important)

Every authored claim must be **traceable to concrete code**. Reference the
generated AST anchors/resources and `source` refs so an invariant points at the
exact function/file it governs — e.g. relate an authored component or invariant
to the generated AST resource for `parseRefreshTokenResponse`, or attach
`source ts("packages/.../file.ts#fn")`. Prefer prelude relation kinds
(`calls`, `provides`, `coordinated_call`, `callbacks`).

## Breadth: cover the WHOLE architecture, not a few subsystems

Shape-aware tooling can only use the model on code that has authored invariants. Code in
a subsystem with NO Layer-2 coverage gets no grounding — a reviewer falls back to a
diff-only read there. So the value of this model is set by how much of the
architecture-significant surface it covers. **Author broadly.**

- Begin by ENUMERATING every architecture-significant subsystem in the repo (the
  top-level domains/services/packages, the cross-cutting concerns — auth/permissions,
  data access & transactions, background/async work, caching, eventing/outbox,
  external integrations, request lifecycle). Produce this list FIRST, from the
  directory layout + `shape/generated/ast/manifest.json` + `shp graph --stats`.
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
   and `shp graph --stats` to build the full list of architecture-significant
   subsystems (see Breadth). Sample key modules within each; do not read every file.
2. Author Layer 2 shapes per the categories above for EACH subsystem on the list,
   grounding each claim in Layer 1.
3. Model honest uncertainty (`effects unknown`) rather than inventing claims.
   Keep final forbids final.
4. Validate: `shp fmt --check` then `shp check`. Investigate with `shp explain`,
   `shp graph`, `shp analyze` as needed.

## Done when

`shape/` contains an accurate Layer-2 architecture+invariant model that covers the
major subsystems **broadly** (not just a few), every claim grounded in the generated
AST, authored purely from the architecture (no change-targeting), and `shp fmt
--check` + `shp check` pass.
