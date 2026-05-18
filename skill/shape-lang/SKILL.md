---
name: shape-lang
description: Use when working with .shape files in repositories that use the Shape language to author, review, teach, format, or validate Shape architecture claims, including Shape change files, Memory Guards, typed component/resource/effect models, coverage attestations, and agent-safe Shape authoring workflows using the shp CLI.
---

# Shape Lang

## Core Rule

Shape is a deterministic architecture conformance language. Treat `.shape` files as typed, reviewable claims about architecture, not prose explanations and not proof of application implementation correctness.

Assume the released `shp` binary is installed on `PATH`. Before authoring, reviewing, or teaching Shape usage:

- Inspect the repository's existing `.shape` files before inventing syntax.
- Inspect project docs for local Shape conventions and changed-file workflows.
- Run `shp check` and `shp fmt --check` after Shape changes.
- Keep final forbids final; never use rationale or memory to waive them.

## Router

Load only the reference needed for the task:

- Authoring or reviewing `.shape` changes: read `references/make-shape-protocol.md`.
- Memory Guards, rationales, memories, descriptions, or reevaluations: read `references/memory-guards.md`.
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

## CLI Defaults

- Run `shp check` to validate the current Shape model.
- Run `shp fmt --check` to verify canonical formatting.
- Run `shp coverage --changed-files changed.txt` when the workflow provides a changed-files list.
- Run `shp --help` if a repository uses a newer CLI than this skill describes.

## Validation

After modifying `.shape` files, run:

```bash
shp fmt --check
shp check
```

When validating PR/source coverage, also run `shp coverage --changed-files changed.txt` with the repository's changed-files list.
