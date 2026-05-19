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
| `shp check [--changed-files changed.txt] [files...]` | Full model validation and diagnostics. | Formatting or source analysis. |
| `shp coverage --changed-files changed.txt [files...]` | Enforcing shape deltas or attestations for governed changed files. | Normal validation without a changed-files list. |
| `shp fmt [--check] [files...]` | Canonical formatting or review-safe format checks. | Semantic validation. |
| `shp explain SYMBOL [files...]` | Inspecting derived facts for a resource, function, rationale, or memory. | Proving source code correctness. |
| `shp graph [SYMBOL] [--kind KIND] [--stats] [files...]` | Inspecting hyperedges. With a SYMBOL: incidence for that vertex or relation. Without a SYMBOL: the whole hypergraph, grouped by kind. With `--stats`: aggregate vertex, hyperedge, and incidence counts. | Effect or Memory Guard checks. |
| `shp memory [files...]` | Listing active rationale/memory entries by protected target. | Determining whether a guarded change is valid by itself. |
| `shp obligations [files...]` | Listing open rationale, memory, description, reevaluation, and guarded-change work. | Replacing `shp check`; it filters only selected diagnostics. |
| `shp author --changed-files changed.txt --component Name` | Scaffolding a PR change file. | Producing final reviewed effect summaries without human review. |
| `shp analyze [--shape-files files] source-files...` | Advisory source hints and comparison against declared effects. | Making the analyzer the source of truth. |
| `shp --help` | Confirming the available CLI on the current machine. | Assuming old skill docs are newer than the binary. |

## Validation Recipes

Baseline validation after editing `.shape` files:

```bash
shp fmt --check
shp check
```

PR coverage validation when changed files are available:

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

Investigate why a resource or function fails:

```bash
shp explain AuditEvent
shp explain Gateway.derivePolicyDecision
```

Investigate component dependencies, or the whole hypergraph:

```bash
shp graph
shp graph --stats
shp graph --kind calls
shp graph Gateway
shp graph Gateway --kind calls
```

Start with `shp graph --stats` for a single-shot overview (vertex and hyperedge counts, arity range, isolated vertices) before drilling into specific symbols.

Compare source hints with declared effects:

```bash
shp analyze --shape-files shape/system/audit.shape src/audit/purge.ts
```

Scaffold a PR delta, then review it:

```bash
shp author --changed-files changed.txt --component AuditStore --change ReviewAuditChange --module changes.PR_001
```

The scaffold is intentionally conservative. Replace `effects unknown` only when evidence supports a complete summary.

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
