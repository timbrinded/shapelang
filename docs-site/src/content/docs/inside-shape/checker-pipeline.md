---
title: Checker Pipeline
description: How Shape modules become diagnostics.
sidebar:
  order: 1
---

The checker pipeline is intentionally deterministic.

```text
parse .shape files
apply change blocks
lower declarations into facts
run semantic rules
emit diagnostics with provenance
```

![Checker pipeline diagram showing parse, apply changes, lower facts, run rules, and emit diagnostics with facts, rules, and provenance.](../../../assets/infographics/checker-pipeline.png)

## Parse

Langium parses each `.shape` file into a `ShapeModule`. Parser errors stop before semantic checking.

## Apply changes

Change modules are applied on top of the baseline model. Function additions, modifications, removals, and declaration changes update the model before facts are lowered.

## Lower facts

The checker lowers declarations into facts such as:

- resources and traits
- component ownership and grants
- function effects and evidence
- function shape traits, descriptions, rationale, memory, and reevaluations
- implementation path governance
- dependency edges
- rule constraints

## Run rules

Semantic rules evaluate those facts. The checker looks for forbidden effects, missing grants, coverage failures, missing design context, guarded changes without reevaluation, dependency cycles, and project-specific rule violations.

## Emit diagnostics

Diagnostics should preserve the causal trail that led to rejection. A good diagnostic is useful to a human reviewer without requiring them to inspect checker internals.
