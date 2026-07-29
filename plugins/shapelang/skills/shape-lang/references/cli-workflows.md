# CLI Workflows

Use this when choosing, sequencing, or interpreting `shp` commands. The released binary is `shp`; inside this repository, `bun shp ...` is equivalent for local development.

## Contents

- [Command Matrix](#command-matrix)
- [Validation Recipes](#validation-recipes)
- [Output Patterns](#output-patterns)
- [Counterexamples](#counterexamples)

## Command Matrix

| Command | Use it for | Do not use it for |
| --- | --- | --- |
| `shp check [--allow-unknown-effects] [--changed-files changed.txt] [--as-of YYYY-MM-DD \| --strict-freshness] [files...]` | Full model validation and diagnostics. Draft mode makes only explicit unknown effects non-fatal; freshness flags make stale design memory fail. | Formatting or source analysis. |
| `shp coverage --changed-files changed.txt [files...]` | Enforcing global model updates or attestations for governed changed files. | Normal validation without a changed-files list. |
| `shp fmt [--check] [files...]` | Canonical formatting or review-safe format checks. | Semantic validation. |
| `shp explain SYMBOL [files...]` | Inspecting derived facts for a resource, function, rationale, or memory. | Proving source code correctness. |
| `shp graph all [--kind KIND] [files...]` / `shp graph show SYMBOL [--kind KIND] [files...]` / `shp graph stats [--kind KIND] [files...]` | Inspecting the whole hypergraph, focused symbol incidence, or aggregate counts. | Effect or Memory Guard checks. |
| `shp memory [files...]` | Listing active rationale/memory entries by protected target. | Determining whether a guarded change is valid by itself. |
| `shp obligations [--strict-freshness] [files...]` | Listing open rationale, memory, description, reevaluation, and guarded-change work; with `--strict-freshness`, also stale design memory. | Replacing `shp check`; it filters only selected diagnostics. |
| `shp author --changed-files changed.txt --component Name` | Scaffolding a conservative global model draft. | Producing final reviewed effect summaries without human review. |
| `shp author ... --prompt` / `shp author ... --critic-prompt proposed.shape` | Building provider-neutral author and critic prompts from checked local context. | Invoking a model or replacing deterministic checks. |
| `shp analyze [--shape-files files] source-files...` | Advisory source hints, symbol attribution, and comparison of suspected targets against declared resource names/storage aliases and effects. | Making the analyzer the source of truth. |
| `shp ast source [--out-dir DIR] [--check] source-files...` | Generating or freshness-checking source-backed AST Shape context with anchors, fingerprints, candidate effects, and source refs. | Replacing reviewed architecture claims; generated functions stay `effects unknown`. |
| `shp ast json [--include-ast-layer] ast.json` | Adapting normalized AST JSON from another parser into Shape drafts. | Asking Shape to parse source files or invent missing AST token data. |
| `shp lsp` | Starting the editor language server over standard input/output. | Running an interactive terminal UI. |
| `shp --help` | Confirming the available CLI on the current machine. | Assuming old skill docs are newer than the binary. |

## Validation Recipes

Baseline validation after editing `.shape` files:

```bash
shp fmt --check
shp check
```

Draft-only validation while explicit `effects unknown` claims remain:

```bash
shp check --allow-unknown-effects
```

This changes only the unknown-effect diagnostic to a warning. It never makes
other parse, semantic, guard, binding, or coverage failures non-blocking. Finish
accepted work with strict `shp check`.

Changed-source coverage validation when changed files are available:

```bash
shp coverage --changed-files changed.txt
```

Combined semantic and coverage validation:

```bash
shp check --changed-files changed.txt
```

Guarded refactor review:

```bash
shp obligations
shp memory
shp check
```

Reproducible freshness sweep:

```bash
shp obligations --as-of 2026-07-29
shp check --as-of 2026-07-29
```

Use `--strict-freshness` only when current UTC time is intentionally part of
an interactive workflow.

Investigate why a resource or function fails:

```bash
shp explain AuditEvent
shp explain Gateway.derivePolicyDecision
```

Investigate the relations incident to a symbol, or the whole hypergraph:

```bash
shp graph all
shp graph stats
shp graph all --kind calls
shp graph show Gateway
shp graph show Gateway --kind calls
```

Start with `shp graph show SYMBOL` for a focused question. Use `shp graph stats`
when model size, relation-heavy work, or a global rule makes aggregate context
material.

Compare source hints with declared effects:

```bash
shp analyze --shape-files shape/system/audit.shape src/audit/purge.ts
```

Read analyzer warning kinds precisely:

- a missing-effect warning says the attributed function lacks the hinted effect;
- a target mismatch says the effect kind exists but its declared resource or
  storage alias does not match the suspected source target; and
- attribution ambiguity says the source hint cannot be assigned to one declared
  function safely.

Do not erase target or attribution evidence by rewriting all three as "missing
effect." Inspect the source symbol and the resource's declared storage aliases
before updating authored Shape.

Refresh committed generated AST context when the repository has an AST workflow:

```bash
bun run ast:generate
bun run ast:check
```

Check generated AST context without writing files:

```bash
shp ast source --out-dir shape/generated/ast --check src/audit/store.rs
```

Scaffold a global model draft, then review and fold it into the owning model file:

```bash
shp author --changed-files changed.txt --component AuditStore --module audit
```

The scaffold is intentionally conservative. Replace `effects unknown` only when evidence supports a complete summary.

Build provider-neutral author and critic context without sending it to a model:

```bash
shp author --changed-files changed.txt --component AuditStore \
  --diff change.diff --prompt --shape-files shape/audit.shape
shp author --changed-files changed.txt --diff change.diff \
  --critic-prompt proposed.shape --shape-files shape/audit.shape
```

The author proposes; the critic challenges. Both outputs are context bundles,
not checker verdicts. Apply human judgment, then run strict deterministic checks.

Start an editor integration:

```bash
shp lsp
```

Configure the editor to speak Language Server Protocol over stdio. Keep CLI
validation in CI; editor diagnostics are an authoring aid.

## Output Patterns

Good `memory` output to inspect before a refactor:

```text
Memory Guards

fn Gateway.derivePolicyDecision
  memory DecisionRefactorConstraint
  type: RefactorConstraint
  status: Unexplained
  confidence: High
  owner: GatewayTeam
```

Good `obligations` output to drive fixes:

```text
Open Shape Obligations

guarded changes:
  fn Gateway.derivePolicyDecision changed; requires reevaluation satisfying memory DecisionRefactorConstraint
```

`obligations --strict-freshness` also surfaces stale design memory:

```text
stale design memory:
  memory BridgeDelayConstraint review_by 2026-01-01 is before 2026-06-01
```

Good analyzer warning to review, not blindly copy:

```text
warning: analyzer hint missing from shape effects

fixtures/source/audit_purge.ts:2 suggests HardDelete.
evidence: return db.deleteFrom("audit_events");
```

## Counterexamples

Do not run coverage without changed files:

```bash
shp coverage
```

Do not treat analyzer output as a patch:

```text
Analyzer says HardDelete, therefore the model is correct.
```

Instead, inspect the source and add a reviewed `effects complete` entry with evidence.

Do not use `fmt` without intent during review:

```bash
shp fmt
```

Use `shp fmt --check` unless the task is explicitly to rewrite formatting.

Do not stop at `shp obligations`:

```bash
shp obligations
```

`obligations` filters selected diagnostics. Always finish semantic validation with `shp check`.

Do not assume an imported pack is thereby active. Packs under default Shape
discovery are active; imports control name resolution. Validate the full
discovered model so path rules, vendor contracts, and final forbids remain in
force.
