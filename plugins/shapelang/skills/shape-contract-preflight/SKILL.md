---
name: shape-contract-preflight
description: Use when planning a code or model change against an existing Shape model before editing, including locating relevant Shape symbols, reading `shp explain`/`shp graph`/`shp memory` context, surfacing constraints, guards, effects, ownership, coverage, bindings, and optionally drafting a temporary `change` block for `shp check` precheck diagnostics.
---

# Shape Contract Preflight

## Boundary

Use Shape to orient implementation work before code changes begin. This skill is for coding agents, not human onboarding.

Preflight does not prove implementation correctness. It summarizes the reviewed Shape model, points to source/evidence refs to inspect, and uses temporary change blocks only when the planned architecture change is concrete enough.

## Modes

- `orientation`: identify relevant symbols, constraints, source refs, model gaps, and likely obligations. Do not draft a `change` block.
- `precheck`: draft a temporary `change` block and run `shp check` against the current model plus that temporary file.

Stay in `orientation` when the user intent is vague or when expressing the plan would require inventing resources, effects, or relations.

## Workflow

1. Identify candidate symbols.
   - Use user-provided component, resource, function, relation, implementation, binding, memory, or rationale names first.
   - Search authored `.shape` files for task vocabulary.
   - Prefer symbols with `source`, `evidence`, implementation paths, binding paths, or generated anchors.
   - If the model is too thin to locate the work, say so and fall back to normal repo inspection.

2. Query model context.
   - Run `shp explain <Symbol>` for candidate symbols.
   - Run `shp graph show <Symbol>` for relation context.
   - Run `shp graph stats` when the work is relation-heavy.
   - Run `shp memory` and `shp obligations` when guarded targets, memory, rationale, or reevaluations are relevant.

3. Inspect source selectively.
   - Read files named by Shape `source`, `evidence`, implementation declarations, bindings, or generated anchors.
   - Use generated AST anchors and `generated_from` relations only as syntax-navigation hints.
   - Do not replace source inspection with Shape output.
   - Do not broaden into repo-wide source exploration until ordinary implementation work begins after Preflight.

4. Decide whether precheck is possible.
   - Use `orientation` when the task is exploratory.
   - Use `precheck` when the intended architecture change can be expressed as `add`, `modify`, or `remove` declarations.
   - Do not remove a final forbid or synthesize destructive effects to make a plan pass.

5. Draft the temporary change block in precheck mode.
   - Read `references/change-blocks.md` before drafting.
   - Use `effects unknown` until source evidence makes material effects explicit.
   - Use `effects complete` only when the intended material effects are known.
   - Do not add attestation text unless the reason is specific to the task and changed path.

6. Run the precheck.
   - Materialize the change block in a temporary `.shape` file.
   - Run `shp check --allow-unknown-effects` against the current model plus the temporary file
     when the plan intentionally contains unknown effects.
   - Use strict `shp check` for a fully known plan and always for the final implemented model.
   - Use `scripts/precheck.sh --init` to create a temporary file template, or `scripts/precheck.sh <change-file>` to run the check when the local environment supports Bash.
   - Set `SHAPE_CMD` when the repository wraps the CLI, for example `SHAPE_CMD="bun shp" scripts/precheck.sh <change-file>`.
   - Revise the temporary change block only until diagnostics represent either a valid plan or a real user decision point.
   - Never interpret the draft flag as weakening final forbids, guards, coverage, bindings, parse
     errors, or known-effect grant checks.

7. Return the planning brief.
   - State relevant Shape symbols and constraints.
   - State source/evidence files to inspect first.
   - State required Shape update, reevaluation, or attestation path.
   - State whether to proceed, revise the model plan, or ask the user for missing intent.

## Output Shape

```markdown
## Preflight Mode

orientation | precheck

## Relevant Shape Context

- Symbols: ...
- Constraints: ...
- Relations: ...
- Guards/memory: ...
- Coverage/bindings: ...

## Source To Inspect First

- ...

## Temporary Plan Check

<Only in precheck mode: proposed change block, command run, diagnostics, and required revisions.>

## Decision

Proceed | revise model plan | ask user for missing intent
```

For thin coverage, say directly:

```markdown
The current Shape model does not locate this work. I will fall back to normal repo inspection; a Shape update is only required if the code change touches governed source or changes architecture claims.
```

## References

- `references/change-blocks.md`: conservative rules and helper commands for temporary precheck files.
- `references/examples.md`: common task prompts and expected Preflight behavior.
