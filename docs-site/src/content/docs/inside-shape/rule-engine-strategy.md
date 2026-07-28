---
title: Rule Engine Strategy
description: Why Shape keeps direct semantic checks until a relational engine shows a measurable advantage.
sidebar:
  order: 8
---

## Status

This page records a **design decision and strategy**, not a second production rule engine. Production Shape continues to evaluate rules with direct TypeScript checks over the lowered `Model`. The Datalog-like spike is an unexported experiment. Do not treat this page as documentation of shipped relational evaluation.

## Decision

Keep direct semantic evaluation as Shape's production rule strategy. Retain the Datalog-like spike as executable evidence that relational joins and provenance can work over lowered facts, but do not export it, register it in the semantic pipeline, or migrate existing checks.

Status: accepted on 2026-07-26, with explicit revisit criteria.

This decision answers one question: should Shape replace its current typed, in-memory checks with a Datalog-like evaluator now?

The answer for production is no, unless the revisit criteria below are met.

## Decision Drivers

- Preserve deterministic, reviewer-readable diagnostics and their causal provenance.
- Keep the checker understandable for a small maintainer team.
- Avoid maintaining two semantic representations of the same model.
- Require measured maintenance or performance pressure before adding an engine.
- Keep graph witnesses, rule precedence, changed-file inputs, and Memory Guard policy explicit.
- Preserve offline Bun builds without adding a runtime dependency unless it earns its cost.
- Preserve the product boundary: rules check the declared model; they do not prove application source correctness.

## Current Evidence

`packages/shp-checker/src/checker/rules.ts` registers 15 ordered semantic checks across seven domain modules. Those checks read typed indexes such as `components`, `resources`, `traits`, `rules`, `memories`, and `hypergraph`. None of the production rule modules currently reads `model.facts`.

The fact stream is useful for inspection, but it is not yet a complete rule database:

- A `rule` fact records the rule name, not its conditions or forbidden actions.
- A `context_required` fact omits `satisfiedBy` and `requiresDescription`.
- Rationale and memory facts omit effective `applies_to`, freshness dates, and policy metadata.
- Change events used by guarded-change evaluation are not facts.
- Diagnostic precedence, such as final forbids suppressing a missing-grant diagnostic for the same effect, lives in direct control flow.
- Path and hypercycle checks depend on canonical graph traversal and witness selection, not only tuple membership.

A full migration would therefore require a richer fact contract, rule scheduling and stratification, deterministic proof selection, graph extensions, and diagnostic adapters before it could preserve current behavior.

## Considered Options

### Keep direct typed checks

- Good, because each rule uses the model index that naturally represents its domain.
- Good, because TypeScript exhaustiveness and existing domain types keep invalid states visible.
- Good, because diagnostic precedence and witness selection remain explicit.
- Bad, because repeated joins or absence checks could become boilerplate if the rule set grows substantially.
- Bad, because there is no generic incremental evaluation mechanism.

### Build an in-house Datalog-like engine

- Good, because joins, anti-joins, and shared derived relations could become declarative.
- Good, because a relation index could support incremental recomputation later.
- Bad, because Shape would own rule safety, stratification, indexing, proof selection, and debugging infrastructure.
- Bad, because the current fact stream is not semantically complete enough to replace the typed model indexes.
- Bad, because graph algorithms and deterministic shortest witnesses still need specialized operators.

### Adopt an external Datalog implementation

- Good, because parsing and fixpoint evaluation would not need to be built from scratch.
- Bad, because provenance, diagnostic ordering, graph witnesses, Bun packaging, and the browser/runtime boundary would still require adapters.
- Bad, because no current maintenance or performance result justifies another production dependency.
- Neutral, because a library should be evaluated only after the required semantics and benchmark corpus are concrete.

## Executable Spike

The unexported spike at `packages/shp-checker/src/experiments/datalog-rule-engine-spike.ts` evaluates one fact-complete rule:

```text
missing_grant(Component, Function, Effect, Target) :-
  effect(Component, Function, Effect, Target),
  component(Component),
  not grants(Component, Effect, Target).
```

It consumes the real public `Fact[]` stream, performs equality joins and a safe anti-join, carries structured provenance through positive matches, and selects output deterministically. Its tests compare the resulting production-shaped diagnostic field-for-field with the current direct checker for passing, failing, exact-join, provenance, and declaration-order cases.

The spike is intentionally limited:

- It has no recursion, fixpoint iteration, aggregation, or stratification planner.
- It assumes the reviewed rule binds every negative variable.
- It does not aggregate alternative proofs.
- It does not model cross-rule precedence.
- It does not implement path or hypercycle witnesses.
- It is not optimized or benchmark evidence.

Those limits keep the experiment proportional to the question. They also show why successful evaluation of one anti-join is not evidence for migrating the checker.

## Decision Outcome

Direct evaluation remains canonical. The prototype shows that provenance can survive a relational join, but it does not show a clear maintenance, correctness, or performance benefit over the current rule modules.

No production behavior changes:

- `@shape/shp-checker` does not export the prototype.
- `SEMANTIC_CHECKS` does not call it.
- Existing diagnostics and rule order remain unchanged.

### Consequences

- Good, because maintainers keep one authoritative semantic implementation.
- Good, because this decision is reversible when stronger evidence appears.
- Bad, because future rules may continue to repeat simple lookup or anti-join patterns.
- Neutral, because the spike remains as a small executable comparison rather than a supported API.

## Revisit Criteria

Reconsider a Datalog-like engine only when at least one primary trigger and all parity requirements are met.

Primary triggers:

- Several new rules duplicate the same multi-relation join or recursive derivation logic, and a shared relational form materially reduces the implementation.
- Representative profiling identifies semantic rule evaluation, rather than parsing or lowering, as a meaningful bottleneck.
- An incremental-checking design needs dependency-tracked derived facts that direct indexes cannot provide cleanly.

Parity requirements:

- The fact contract represents every input used by the candidate rules without consulting side indexes.
- Differential tests cover the complete fixture corpus and compare diagnostic kind, fields, ordering, and causal witnesses.
- Final-forbid precedence, required-context satisfaction modes, changed-file rules, and guarded changes retain their current semantics.
- Path and hypercycle rules either preserve canonical shortest witnesses through a documented extension or remain specialized direct checks.
- Any external dependency passes offline release, binary packaging, browser, and supported-platform checks.
- Benchmarks use representative large models and show a benefit large enough to justify the added concepts.

If those conditions are not met, extend the direct domain modules and keep facts as inspection and explanation output.

## Confirmation

CI confirms the spike compiles and its differential tests pass. Code review confirms that the package facade and production semantic registry do not reference the experiment. The existing full checker, typecheck, Shape, docs, and release gates remain the acceptance boundary.

## More Information

- [Issue #39](https://github.com/timbrinded/shapelang/issues/39)
- [Fact Lowering](./fact-lowering/)
- [Rule Evaluation](./rule-evaluation/)
- [Checker Pipeline](./checker-pipeline/)
- [Experimental Semantic Kernel](./experimental-semantic-kernel/) for a separate, also non-production experiment
