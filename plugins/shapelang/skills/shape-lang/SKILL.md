---
name: shape-lang
description: >-
  This skill should be used for incremental Shape language work: authoring or
  repairing `.shape` files, explaining syntax or diagnostics, formatting,
  validation, teaching, source-to-model drift review, and CLI/editor operation.
  Do not use it for whole-repository modeling (`shape-index`),
  pre-implementation planning (`shape-contract-preflight`), authored
  contract-diff risk (`shape-contract-guard`), or code-change bug review
  (`shape-review`).
---

# Shape Lang

## Shape Evidence Contract

- Treat authored Shape as typed, reviewable architecture claims, not prose and not proof of source correctness.
- Treat checker output as deterministic evidence about the loaded model.
- Treat generated AST and analyzer output as investigation leads, never final claims.
- Source-confirm claims about implementation behavior.
- Keep final forbids final.
- Preserve unresolved effects as `effects unknown`; never manufacture completeness.
- Prefer `file#symbol` references, then file-only references. Never author line numbers or ranges.

## Resolve The Command

1. Read repository instructions for the canonical Shape command.
2. Otherwise use `shp`.
3. Run `<SHAPE_CMD> --version` once.
4. Run command-specific `--help` only when the installed command rejects or contradicts documented syntax.
5. Reuse `<SHAPE_CMD>` consistently.

Use only the Shape v0.7.0 commands documented by this skill and the installed
CLI help.

## Select A Mode

| Mode | Use | Required result |
| --- | --- | --- |
| `author` | Create or edit an incremental authored claim. | Edited declarations, evidence used, unresolved uncertainty, and exact validation results. |
| `review` | Inspect authored Shape for semantic mistakes. | Exact declaration, violated invariant, evidence, and smallest valid correction. |
| `debug` | Explain and repair a diagnostic. | Diagnostic, semantic cause, minimal fix, and verification. |
| `teach` | Explain a Shape concept. | Concise explanation plus a parseable, checked example. |
| `operate` | Choose a CLI or editor workflow. | Exact command, output/exit semantics, and relevant caveat. |
| `drift-review` | Compare changed source behavior with the current authored model. | Verified faithfulness findings or a clean result; do not report code bugs. |

Load only the supporting reference needed for the selected mode:

- `author` or authored-model `review`: `references/make-shape-protocol.md`
- `debug` or `operate`: `references/cli-workflows.md`
- `teach`: `references/teaching-guide.md`
- `drift-review`: `references/drift-review.md`
- Memory Guards, rationales, reevaluations, policy, or freshness: `references/memory-guards.md`
- Canonical snippets: `references/examples.md`
- Antipattern review or generated-draft cleanup: `references/antipatterns.md`

## Work From Evidence

Maintain a compact ledger for investigative work:

```text
Candidate:
  trigger:
  affected symbol/path:
  evidence class: deterministic | authored | source-confirmed | candidate-only
  evidence:
  unresolved question:
  status: open | verified | disproved | blocked
```

Close every candidate, explicitly defer it, or state why evidence could not be obtained.

Use tools by need:

- Always: inspect the relevant authored model and run the applicable final deterministic check.
- Triggered: use `memory` and `obligations` for guarded design context; `graph show` for relevant relations; `analyze` for uncertain effects or targets.
- Escalation only: use `graph all` when focused incidence cannot resolve a global route or rule; use `graph stats` when model size or relation-heavy work matters.

## Authoring Invariants

- Use `effects complete` only when every material effect is represented.
- Include `source` for functions and `evidence` for material effects when available.
- Represent structural dependencies as top-level relations. Prefer `calls`, `callbacks`, `provides`, and `coordinated_call`.
- Treat vendored `.shape` modules under the discovered Shape root as active policy. Imports affect name visibility, not policy activation.
- Update the authored model for governed source changes, or add a narrow current attestation only when the architecture contract truly did not change.
- Satisfy real guard obligations with a valid reevaluation; never add one merely to silence a diagnostic.
- Promote generated anchors, analyzer hints, or generated relations only after source review.

## Complete The Task

For authored edits:

```bash
<SHAPE_CMD> fmt <edited-shape-files>
<SHAPE_CMD> fmt --check
```

When an exact changed-file list exists, use the combined semantic, coverage, and binding gate:

```bash
<SHAPE_CMD> check --changed-files changed.txt
```

Otherwise finish with:

```bash
<SHAPE_CMD> check
```

Use `coverage --changed-files` only to isolate coverage diagnostics; it does not enforce bindings. Use `--allow-unknown-effects` only during draft authoring and never as the final gate.

Use `--as-of YYYY-MM-DD` for reproducible freshness checks. Use `--strict-freshness` only when current UTC time is intentionally part of an interactive check.

When generated AST is committed, run the repository's generation and freshness commands. Change the generator and regenerate; never hand-edit generated Shape.
