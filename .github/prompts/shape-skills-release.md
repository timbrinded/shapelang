# Shape Skills Release Evaluation

Evaluate every shipped Shape skill against the repository's current CLI, authored model,
documentation, fixtures, and implementation behavior. This is a blocking release-candidate
evaluation, not an advisory review.

Read:

- `AGENTS.md`
- every `plugins/shapelang/skills/*/SKILL.md`
- every referenced file those skill entrypoints route to
- every `plugins/shapelang/skills/*/agents/openai.yaml`
- `bun shp --help` and relevant command help
- the current CLI and language documentation for behavior named by the skills

Evaluate these scenarios:

1. `shape-lang`: draft an unknown effect, then explain the required strict final gate; use
   explicit graph subcommands; explain domain-pack discovery, forbidden paths, author/critic
   modes, LSP, target-aware analyzer warnings, and stable source references.
2. `shape-contract-preflight`: plan a guarded function change with incomplete effect knowledge.
   Draft validation may allow the unknown warning, but the guard obligation and final strict
   check must remain blocking.
3. `shape-contract-guard`: review removal of a `forbid path` and a weakened vendored domain-pack
   rule. Both must be treated as policy loosening; generated-only churn must not be scored as an
   authored contract change.
4. `shape-index`: build a broad model using generated AST only for navigation. Authored
   `source`, `evidence`, effects, relations, implementations, bindings, and rules remain the
   contract.
5. `shape-review`: retain an evidence-backed cross-object defect, but suppress a speculative
   concern without a realistic failing path or supported authored invariant.
6. Cross-skill: source/evidence guidance prefers `file#symbol`, then file-only, and never
   recommends line numbers or ranges.

Fail the evaluation when a skill:

- teaches a command or flag contradicted by the current CLI;
- weakens strict checking, final forbids, Memory Guard obligations, coverage, or bindings;
- treats generated AST or analyzer output as architecture truth;
- misses one of the scenario behaviors above;
- emits speculative review comments without evidence;
- has stale agent metadata that changes its intended behavior;
- routes to a missing or contradictory reference.

Return one result for each of the five skills. Each result must list exactly
these scenario IDs after actually evaluating them:

- `shape-lang`: `draft-strict`, `explicit-graph`, `domain-packs`,
  `forbidden-paths`, `author-critic`, `lsp`, `target-aware-analyzer`,
  `stable-refs`
- `shape-contract-preflight`: `guarded-unknown-plan`, `stable-refs`
- `shape-contract-guard`: `forbidden-path-removal`,
  `domain-pack-weakening`, `generated-only-exclusion`
- `shape-index`: `generated-navigation-only`, `authored-contract-surfaces`,
  `stable-refs`
- `shape-review`: `evidence-backed-cross-object`,
  `speculation-suppression`, `stable-refs`

Use non-empty summaries and findings for every release-blocking gap. `status`
may be `pass` only when all five skill results pass, every required scenario ID
is present exactly once, and `findings` is empty.
