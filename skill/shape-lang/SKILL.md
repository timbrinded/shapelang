---
name: shape-lang
description: Use when working in the shapelang monorepo or with .shape files to author, review, teach, or implement Shape language features, including Shape change files, Memory Guards, typed architecture claims, checker/formatter/parser behavior, fixtures, CLI workflows, and agent-safe Shape authoring protocol.
---

# Shape Lang

## Core Rule

Shape is a deterministic architecture conformance language. Treat `.shape` files as typed, reviewable claims about architecture, not prose explanations and not proof of application implementation correctness.

Before authoring, reviewing, teaching, or implementing Shape behavior:

- Inspect `README.md` for product boundary and commands.
- Inspect existing `.shape` files and nearby fixtures before inventing syntax.
- Run the checker/formatter/tests after implementation work.
- Keep final forbids final; never use rationale or memory to waive them.

## Router

Load only the reference needed for the task:

- Authoring or reviewing `.shape` changes: read `references/make-shape-protocol.md`.
- Memory Guards, rationales, memories, descriptions, or reevaluations: read `references/memory-guards.md`.
- Parser/checker/formatter/CLI/editor implementation: read `references/implementation-guide.md`.
- Teaching Shape concepts to an agent or human: read `references/teaching-guide.md`.
- Need canonical snippets: read `references/examples.md`.
- Reviewing for mistakes or cleaning up generated Shape: read `references/antipatterns.md`.

## Working Defaults

- Prefer `effects complete` only when every material effect is represented.
- Use `effects unknown` when uncertainty remains.
- Include `source` for functions and `evidence` for material effects when available.
- For governed source changes, add a Shape change file or `attest no_shape_change`.
- For guarded targets, add a valid `reevaluation` or preserve the protected shape.
- Use compact summaries; link longer detail through `evidence issue(...)`, `evidence test(...)`, or similar source refs.

## Validation

After modifying Shape language behavior or `.shape` fixtures, run:

```bash
bun test
bun run typecheck
bun shp fmt --check $(find shape fixtures -name '*.shape' | sort)
```
