---
name: shape-index
description: >-
  This skill should be used only when explicitly asked to create or refresh a
  whole-repository authored Shape model from a fixed repository baseline.
  Inventory subsystems, use generated AST only for navigation, verify claims
  in source, and validate authored batches. Do not use it for incremental
  edits, pending-change review, or preflight planning.
---

# Shape Index

## Boundary

Build or refresh a repository-wide authored model independently of any pending change. Require an explicit invocation because the workflow is broad and write-heavy.

## Shape Evidence Contract

- Treat authored Shape as typed architecture claims, not proof of source correctness.
- Treat generated AST and analyzer output as navigation evidence only.
- Source-confirm every implementation claim.
- Keep final forbids final.
- Preserve uncertainty with `effects unknown`.
- Finish completed batches with strict validation.

Resolve the repository's canonical Shape command once, verify it with `--version`, and reuse it consistently.

## Establish The Baseline

Require one of:

- a user-provided baseline commit; or
- the current clean default-branch commit.

Do not index from a worktree containing uncommitted application changes or a pending review diff. Use a separate clean worktree when invoked from active change work. Record the baseline SHA in the final result.

## Detect Navigation Context

1. Detect a generated AST manifest under the repository's documented Shape root.
2. Run the repository's AST freshness check when it exists.
3. Generate AST only when supported and authorized by the task.
4. Continue with source survey when generated navigation is unavailable, and record that limitation.

Never edit generated Shape directly.

## Classify Claims

| Class | Meaning |
| --- | --- |
| Enforceable architecture contract | Shape-checked grants, effects, ownership, relations, implementations, bindings, and rules. |
| Typed review obligation | Memory, rationale, description, required context, or reevaluation guard; review context, not implementation proof. |
| Navigation evidence | Stable source refs, generated anchors, and analyzer hints. |
| Unsupported behavioral claim | Arbitrary runtime, value-level, or business assertions that current Shape cannot enforce. Do not present these as invariants. |

## Two-Pass Workflow

### Pass 1: Inventory

For every architecture-significant subsystem, record:

```text
Subsystem:
  baseline paths:
  evidence inspected:
  existing authored symbols:
  candidate enforceable claims:
  review-context claims:
  unresolved gaps:
  status: modeled | deferred | not architecture-significant
```

Inspect repository layout, existing authored Shape, generated navigation when available, and focused source entrypoints. Do not author during this pass.

Breadth means every important subsystem receives an explicit coverage decision. It does not mean every subsystem must receive a new rule.

### Pass 2: Evidence-Backed Authoring

For each subsystem or coherent cluster:

1. Author components and implementation coverage supported by source.
2. Author effects, relations, ownership, rules, bindings, and review context only when evidence supports them.
3. Record `no evidence-backed invariant identified` when that is the honest result.
4. Use `effects unknown` instead of inventing completeness.
5. Format the edited files.
6. Run draft checking only while explicit unknown effects remain.
7. Resolve or explicitly defer unknowns, then run strict checking for a completed batch.
8. Inspect the authored diff and update the coverage ledger before continuing.

Keep one integrator responsible for global names, domain packs, cross-subsystem rules, and final authored files.

## Completion

Return one state:

- `complete`: intended authored claims are source-reviewed and strict checks pass.
- `incomplete_with_explicit_gaps`: useful batches exist, but listed unknowns or model gaps remain; include strict diagnostics and the remaining ledger.
- `blocked`: baseline, toolchain, or source evidence prevents reliable authoring.

Never describe a model with unresolved strict diagnostics as complete.

Report the baseline SHA, AST availability/freshness, modeled subsystems, deferred gaps, unsupported behavioral claims rejected, and exact validation results.
