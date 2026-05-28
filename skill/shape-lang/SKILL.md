---
name: shape-lang
description: Use when working with .shape files in repositories that use the Shape language to author, review, teach, format, debug, or validate Shape architecture claims, including global model updates, Memory Guards, typed component/resource/effect models, top-level relation declarations, hypergraphs, hypercycles, relation kinds such as calls/callbacks/provides/coordinated_call, forbid hypercycle rules, coverage attestations, and agent-safe workflows using all shp CLI commands including shp graph.
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
- Memory Guards, rationales, memories, descriptions, or reevaluations: read `references/memory-guards.md`.
- Need canonical snippets: read `references/examples.md`.
- Reviewing for mistakes or cleaning up generated Shape: read `references/antipatterns.md`.

## Working Defaults

- Prefer `effects complete` only when every material effect is represented.
- Use `effects unknown` when uncertainty remains.
- Include `source` for functions and `evidence` for material effects when available.
- For governed source changes, update the global Shape model directly or add a narrow `attest no_shape_change`.
- For guarded targets, add a valid `reevaluation` or preserve the protected shape.
- Represent structural dependencies as top-level `relation` declarations, not component members.
- Use prelude relation kinds (`calls`, `callbacks`, `provides`, `coordinated_call`) unless the project documents a custom kind.
- Avoid ambiguous relation endpoints; component and resource names should not collide when relations reference them.
- Use compact summaries; link longer detail through `evidence issue(...)`, `evidence test(...)`, or similar source refs.

## CLI Defaults

- Run `shp fmt --check` before `shp check` when validating edited Shape files.
- Run `shp coverage --changed-files changed.txt` only when the workflow provides a changed-files list.
- Use `shp obligations` and `shp memory` before fixing Memory Guard failures.
- Use `shp explain`, `shp graph`, and `shp analyze` for investigation before changing model semantics.
- Use `shp ast source` for generated source-backed AST context and `shp ast json` only when another tool already produced normalized AST JSON.
- When a repo commits generated AST context under `shape/generated/ast`, run its `ast:generate`/`ast:check` scripts or equivalent `shp ast source --out-dir ... --check` workflow after source changes.
- Use `shp graph --stats` before editing relation-heavy models.
- Use `shp graph SYMBOL --kind KIND` to inspect focused incidence for a relation kind.
- Use `shp author` to scaffold, then review and replace `effects unknown` when evidence is available.
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

Generated AST drafts intentionally leave generated functions at `effects unknown`, add `GeneratedAstAnchor` resources with `ast.semantic_subtree_v1` fingerprints, and may include candidate effects that need human review before being promoted into authored Shape.
