---
name: shape-lang
description: Use when authoring, reviewing, teaching, formatting, debugging, or validating .shape architecture claims and shp workflows, including effects and draft validation, Memory Guards, coverage and bindings, stable source/evidence refs, relations and graph rules, domain packs, analyzer hints, AST drafts, provider-neutral author/critic flows, and LSP/editor integration.
---

# Shape Lang

## Core Rule

Shape is a deterministic architecture conformance language. Treat `.shape` files as typed, reviewable claims about architecture, not prose explanations and not proof of application implementation correctness.

Assume the released `shp` binary is installed on `PATH`. Before authoring, reviewing, teaching, or debugging Shape usage:

- Inspect the repository's existing `.shape` files before inventing syntax.
- Inspect project docs for local Shape conventions and changed-source workflows.
- Run `shp check` and `shp fmt --check` after Shape changes.
- Keep final forbids final; never use rationale or memory to waive them.

## Router

Load only the reference needed for the task:

- Teaching Shape concepts to an agent or human: read `references/teaching-guide.md`.
- Authoring or reviewing global `.shape` model changes: read `references/make-shape-protocol.md`.
- Choosing or interpreting CLI commands: read `references/cli-workflows.md`.
- Memory Guards, rationales, memories, descriptions, reevaluations, property-level/transform guards, freshness, sensitive/role/policy, or user-defined `require_context`: read `references/memory-guards.md`.
- Need canonical snippets: read `references/examples.md`.
- Reviewing for mistakes or cleaning up generated Shape: read `references/antipatterns.md`.

## Working Defaults

- Prefer `effects complete` only when every material effect is represented.
- Use `effects unknown` when uncertainty remains.
- Include `source` for functions and `evidence` for material effects when available.
- Prefer stable `file#symbol` refs for named declarations and file-only refs otherwise. Do not
  author numeric positions.
- For governed source changes, update the global Shape model directly or add a narrow `attest no_shape_change`.
- For guarded targets, add a valid `reevaluation` or preserve the protected shape; for `sensitive` memories under an approver `policy`, the reevaluation must name an `approver` (a declared `role` when any role exists).
- Shape traits and their obligations apply to functions, components, and resources; match the required-context target to where the trait is borne.
- Treat `review_by` freshness as opt-in: it is enforced only under `--strict-freshness`, and the checker reads no clock of its own.
- Represent structural dependencies as top-level `relation` declarations, not component members.
- Use prelude relation kinds (`calls`, `callbacks`, `provides`, `coordinated_call`) unless the project documents a custom kind.
- Treat vendored modules below `shape/vendor/` as active policy under default discovery. Imports
  enable unqualified references; they do not activate or deactivate pack rules.
- Use generated AST as navigation evidence. Promote a claim into authored Shape only after source
  review.
- Treat analyzer targets as advisory but material: compare suspected targets with declared resource
  names and storage aliases, preserve source-symbol attribution, and investigate target mismatch or
  attribution-ambiguity warnings rather than collapsing them into a generic missing-effect claim.
- Avoid ambiguous relation endpoints; component and resource names should not collide when relations reference them.
- Use compact summaries; link longer detail through `evidence issue(...)`, `evidence test(...)`, or similar source refs.

## CLI Defaults

- Run `shp fmt --check` before `shp check` when validating edited Shape files.
- Run `shp coverage --changed-files changed.txt` only when the workflow provides a changed-files list.
- Use `shp obligations` and `shp memory` before fixing Memory Guard failures.
- Use `shp check --strict-freshness` / `shp obligations --strict-freshness` to surface design memory past its `review_by`; today's date is computed only at the CLI boundary.
- Use `shp explain`, explicit `shp graph all|show|stats`, and `shp analyze` for investigation before changing model semantics.
- Use `shp ast source` for generated source-backed AST context and `shp ast json` only when another tool already produced normalized AST JSON.
- When a repo commits generated AST context under `shape/generated/ast`, run its `ast:generate`/`ast:check` scripts or equivalent `shp ast source --out-dir ... --check` workflow after source changes.
- Use `shp graph stats` before editing relation-heavy models.
- Use `shp graph show SYMBOL --kind KIND` to inspect focused incidence for a relation kind.
- Use `shp author` to scaffold, then review and replace `effects unknown` when evidence is available.
- Use `shp check --allow-unknown-effects` only for drafts. Always finish with strict `shp check`.
- Use `shp author --prompt` and `--critic-prompt` as provider-neutral context builders; neither
  invokes a model or replaces the checker.
- Use `shp lsp` for stdio editor integration.
- Run `shp --help` if a repository uses a newer CLI than this skill describes.

## Validation

After modifying `.shape` files, run:

```bash
shp fmt --check
shp check
```

When validating changed-source coverage, also run `shp coverage --changed-files changed.txt` with the repository's changed-files list.

When validating generated AST context, prefer the repository script if present:

```bash
bun run ast:generate
bun run ast:check
```

Generated AST drafts intentionally leave generated functions at `effects unknown`, add `GeneratedAstAnchor` resources with `ast.semantic_subtree_v1` fingerprints when token evidence is available, and may include candidate effects that need human review before being promoted into authored Shape. If an anchor has no token evidence, Shape emits it without a fingerprint/`expects` pin and reports a warning instead of failing the batch.
