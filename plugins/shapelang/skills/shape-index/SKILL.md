---
name: shape-index
description: >-
  This skill should be used only when explicitly asked to create or refresh a
  whole-repository authored Shape model from a fixed repository baseline.
  Survey architecture-significant subsystems, treat generated AST as read-only
  navigation, verify claims in source, and author validated model batches. Do
  not use it for incremental edits, pending-change review, or preflight planning.
---

# Shape Index

## Boundary

Build or refresh a repository-wide authored model independently of any pending change. Require explicit invocation because this workflow is broad and write-heavy.

## Shape Evidence Contract

- Treat authored Shape as typed architecture claims, not proof of source correctness.
- Treat generated AST and analyzer output as navigation evidence only.
- Source-confirm implementation claims.
- Keep final forbids final.
- Use stable `file#symbol` references when a symbol exists; use file-only references only when no stable symbol exists.
- Preserve unresolved effects as `effects unknown`.
- Finish completed work with strict deterministic validation.

Resolve the repository's canonical Shape command once, verify it with `--version`, and reuse it consistently.

## Establish The Baseline

Require either a user-provided baseline commit or the current clean default-branch commit. Do not index from a worktree containing uncommitted application changes or a pending review diff. Use a separate clean worktree when invoked from active change work, and record the baseline SHA.

## Keep Generated AST Read-Only

Detect the generated AST manifest and run an existing freshness check when available. Inspect generated anchors only to locate source.

Do not run an AST generator during authored indexing. A request to create or refresh the authored whole-repository model is not authorization to regenerate Layer 1. Regenerate only when the user explicitly asks for generated-AST or Layer-1 regeneration. Never edit generated Shape directly.

## Authoring Workflow

1. Briefly survey repository layout, existing authored Shape, documentation, generated navigation, and source entrypoints. Record each architecture-significant subsystem as `modeled`, `deferred`, or `not architecture-significant`.
2. Before the first authored batch, read `references/current-cli-authoring.md`. Use it and the repository's existing authored files as the current `shp 0.7` syntax guide.
3. Start with one high-confidence subsystem or coherent cluster. Do not wait for an exhaustive repo-wide prose inventory before authoring.
4. Reconcile each relevant source workflow and any docs that define its completion, ordering, or required review against the authored model:
   - resources, traits, ownership, grants, and effects;
   - direct calls/provides relations, plus `coordinated_call` when completion or correctness depends on ordered endpoints;
   - implementation coverage with `on_change require shape_update`;
   - bindings when documentation or project policy explicitly requires review with source or model changes;
   - typed rationale or memory for important source-supported behavior that Shape cannot enforce directly.
5. Record every evidence-backed fact still absent from the model. A successful check proves model coherence, not source or documentation completeness. Then format and validate the batch, inspect the authored diff, update the subsystem status, and continue.

For each important source-supported claim, choose the strongest honest representation. A runtime fact that is not checker-enforceable may still be important typed review context. Label it as rationale or memory instead of omitting it or presenting it as an enforced invariant. If the evidence is insufficient, defer the claim explicitly.

Do not force every subsystem to have a rule. Breadth means every architecture-significant subsystem receives a coverage decision and every high-confidence boundary receives the applicable Shape declarations.

## Investigation Budget

Use the bundled reference and local authored examples before inspecting grammar or prelude implementation. Read grammar or checker internals only to resolve a concrete diagnostic that those sources cannot answer.

Do not run scratch mutation probes for every claim. Use at most one focused temporary probe when a material current-CLI semantic question remains unresolved, then remove the temporary file.

Format and validate after each coherent batch:

```bash
<SHAPE_CMD> fmt shape/index.shape
<SHAPE_CMD> check
```

Use draft checking only while an explicit `effects unknown` remains. Run `check --changed-files` as the final gate when the repository supplies an exact changed-file list.

## Completion Gate

Return one state:

- `complete`: all architecture-significant subsystems have a coverage decision; source and documentation reconciliation leaves no important unmodeled resources, effects, relations, coordination, implementations, bindings, or typed review context; generated AST is unchanged; stable evidence is present; and strict checks pass with no relevant deferred gaps.
- `incomplete_with_explicit_gaps`: useful batches are authored, but listed unknowns, missing evidence, model gaps, or strict diagnostics remain.
- `blocked`: the baseline, toolchain, or source evidence prevents reliable authoring.

Report the baseline SHA, generated-AST availability and freshness, modeled subsystems, explicit gaps, exact validation commands/results, and whether generated files remained unchanged.

## Reference

- `references/current-cli-authoring.md`: compact `shp 0.7` mapping and syntax for whole-repository authored models.
