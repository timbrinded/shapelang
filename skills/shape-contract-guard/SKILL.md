---
name: shape-contract-guard
description: Use when Codex needs to review `.shape` diffs before a PR or during implementation to find advisory architecture-contract risk that `shp check` may permit after the live model was loosened, including removed final forbids, weakened traits, widened grants/effects, removed coverage or bindings, relation weakening, traceability loss, epistemic regression, or weak attestations.
---

# Shape Contract Guard

## Boundary

Review authored Shape contract diffs and report advisory risk. `shp check` is still the deterministic hard gate.

In v1:

- Do not read application source code.
- Do read changed file paths, authored `.shape` diffs, base contents for changed/deleted authored `.shape` files, `shp check`, `shp memory`, and focused graph/explain/obligations output.
- Do not score `shape/generated/ast/**` diffs as contract changes. Mention generated AST only when an authored fingerprint expectation, checker diagnostic, analyzer hint, or user request points at it.
- Do not switch the whole worktree to the base ref. If base content is needed, use path-limited reads such as `git show <base>:<path>`.
- Keep checker diagnostics separate from Guard findings. Guard findings are advisory and must not use blocking language.

## Workflow

1. Resolve the comparison.
   - Use the user-provided base/head when present.
   - Otherwise prefer the merge base between `HEAD` and the current upstream branch.
   - If there is no upstream, try the repo's normal main branch.
   - Treat uncommitted staged or unstaged authored `.shape` edits as part of the head review.

2. Collect changed paths.
   - Build a newline-delimited changed-file list from base to head.
   - Include staged and unstaged working-tree paths when the user is reviewing local work.
   - Keep this list even though application source files are not read; it is needed for coverage, bindings, and attestation credibility.

3. Collect authored contract diff.
   - Use a diff equivalent to:

     ```bash
     git diff <base>...HEAD -- '*.shape' ':(exclude)shape/generated/ast/**'
     ```

   - Also inspect staged/unstaged authored `.shape` diffs when the worktree is dirty.
   - For deleted authored `.shape` files, read the base file with `git show <base>:<path>`.

4. Run deterministic Shape checks.
   - Write changed paths to a temporary file.
   - Run `shp check --changed-files <temp-list>` when the list is available.
   - Fall back to `shp check` only when changed paths cannot be determined.
   - If diagnostics exist, present them first and say they should be resolved before advisory findings.

5. Load declared model context.
   - Run `shp memory` by default.
   - Run `shp graph stats` before relation-heavy review.
   - Run `shp graph all --kind calls` and `shp graph all --kind provides` when relation context affects the finding.
   - Run `shp graph show SYMBOL` and `shp explain SYMBOL` for touched symbols.
   - Run `shp obligations` when diagnostics, guarded targets, memory, rationale, or reevaluation changes are involved.

6. Classify and score the diff.
   - Read `references/signals.md` before scoring nontrivial diffs.
   - Prefer exact symbol names and diff evidence over broad claims.
   - Escalate co-occurring constraint removal plus newly allowed capability/effect on the same resource, component, function, or relation neighborhood.
   - Lower severity when the diff includes specific rationale, memory, reevaluation, evidence, or attestation tied to the changed symbol.

7. Emit Markdown.
   - Use the output template below.
   - Keep no-finding output to one short paragraph.
   - Group findings by severity when findings exist.

## Output Template

```markdown
## Checker Diagnostics

<Exact deterministic diagnostics or "No deterministic Shape diagnostics from <command>.">

## Guard Findings

### <severity>

- Severity: high
- Signal: constraint-removal-plus-destructive-effect
- Outcome: suspicious loosening
- Symbol: AuditEvent / AuditStore.deleteEvent
- Evidence: `AppendOnly` was removed from `AuditEvent`; `HardDelete<AuditEvent>` was added.
- Model context: <relevant traits, grants, relations, guards, ownership, implementation, binding, memory, or obligations>
- Recommended action: restore the constraint, add a specific reevaluation/evidence, or keep the loosening only with explicit reviewer acceptance.
```

Use one paragraph when there are no findings:

```markdown
No deterministic Shape diagnostics and no advisory Guard findings from the authored contract diff reviewed.
```

## References

- `references/signals.md`: v1 signal taxonomy, severity rules, and declared-model-context wording rules.
- `references/examples.md`: compact example diffs and expected findings.
