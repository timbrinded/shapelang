---
title: Rule Evaluation
description: The ordered SEMANTIC_CHECKS registry and binding enforcement, how checks interact, how graph witnesses are chosen, how to add a rule, and why rules are direct TypeScript checks.
---

Rule evaluation runs after lowering. `runSemanticChecks` in `packages/shp-checker/src/checker/rules.ts` calls each entry of `SEMANTIC_CHECKS` in order, and `checkLoweredShapeModel` then runs `checkBindings` unless `enforceBindings` is `false`. Every check is a TypeScript function that reads the typed indexes of the lowered `Model` and returns `SemanticDiagnostic[]`. No check stops a later one, and no rule module reads `model.facts`. [Checker Pipeline](/shapelang/inside-shape/checker-pipeline/) covers the phases around this one and how the combined result is sorted. Checker module paths below are relative to `packages/shp-checker/src/checker/`; other paths are relative to the repository root.

## Inputs

Each check receives the `Model` and the `NormalizedCheckOptions`:

- The typed indexes described in [Fact Lowering](/shapelang/inside-shape/fact-lowering/#the-model): `resources`, `traits`, `components`, `hypergraph`, `candidateEffects`, `implementations`, `bindings`, `rules`, `rationales`, `memories`, `reevaluations`, `roles`, `policies`, `attestations`, `shapeUpdatePaths`, and `changeEvents`.
- The options. Only four checks read them: `checkFreshness` reads `freshnessDate`; `checkCoverage` and `checkBindings` read `changedFiles`, `repoRoot`, and the attestation keys of `baseModules`; and `checkStaleAttestations` reads those keys. `allowUnknownEffects` and `includeFacts` apply after the rules, in `checkLoweredShapeModel`.

Shared queries that more than one layer needs, such as `deriveFinalForbidsForResource`, `requirementsForTarget`, and `reevaluationValidationReasons`, live in `derivations.ts`.

## Registry

| Order | Function | Module | Diagnostic kinds | Reads options |
| --- | --- | --- | --- | --- |
| 1 | `checkResolvedNames` | `rules/names.ts` | `unknown_name`, `invalid_relation`, `invalid_rule` | no |
| 2 | `checkRules` | `rules/declarations.ts` | `invalid_rule` | no |
| 3 | `checkFingerprintExpectations` | `rules/relations.ts` | `invalid_relation`, `fingerprint_mismatch` | no |
| 4 | `checkCandidateEffectFingerprints` | `rules/functions.ts` | `candidate_pin_fingerprint_mismatch` | no |
| 5 | `checkContextTargets` | `rules/context.ts` | `invalid_context_target`, `context_target_mismatch` | no |
| 6 | `checkRequiredContext` | `rules/context.ts` | `missing_required_context` | no |
| 7 | `checkRequiredDescriptions` | `rules/context.ts` | `missing_required_description` | no |
| 8 | `checkReevaluations` | `rules/context.ts` | `invalid_reevaluation` | no |
| 9 | `checkGuardedChanges` | `rules/guards.ts` | `guarded_shape_changed` | no |
| 10 | `checkFreshness` | `rules/guards.ts` | `stale_memory` | `freshnessDate`; runs only when it is set |
| 11 | `checkFunctions` | `rules/functions.ts` | `unsafe_effects`, `unknown_effects`, `final_forbidden_effect`, `missing_grant` | no |
| 12 | `checkProvidesRules` | `rules/relations.ts` | `forbidden_provides` | no |
| 13 | `checkForbiddenPaths` | `rules/relations.ts` | `invalid_rule`, `forbidden_path` | no |
| 14 | `checkHypercycles` | `rules/relations.ts` | `forbidden_hypercycle` | no |
| 15 | `checkCoverage` | `rules/coverage.ts` | `missing_shape_update` | `changedFiles`, `repoRoot`, `baseModules` |
| 16 | `checkStaleAttestations` | `rules/coverage.ts` | `stale_attestation` (a warning) | `baseModules`; runs only when it is set |
| after the registry | `checkBindings` | `rules/coverage.ts` | `missing_bound_docs_change` | `changedFiles`, `repoRoot`, `baseModules`; skipped when `enforceBindings` is `false` |

Lowering, not the registry, reports `duplicate_declaration`, `duplicate_fingerprint`, `ambiguous_name`, `invalid_candidate_effect`, `invalid_require_context`, and `invalid_implementation`, as well as some `invalid_relation` and `unknown_name` diagnostics.

Diagnostic order does not depend on the `SEMANTIC_CHECKS` order: `checkLoweredShapeModel` sorts every result by kind, then by rendered text. The printed form of each kind, and how to fix it, is in [Diagnostics](/shapelang/reference/diagnostics/).

## Interactions

These behaviours span more than one check, or a check and the result assembly. The user-facing rules are taught in [Effect Model](/shapelang/concepts/effect-model/), [Design Memory](/shapelang/concepts/design-memory/), and [Keep the Model Current](/shapelang/guides/keep-model-current/).

- **Final-forbid precedence.** For each entry of a complete effect summary, `checkFunctions` first looks at the target. When the target is a declared resource, it checks final forbids with `findFinalForbidden`. A match emits `final_forbidden_effect` and skips the grant check for that entry, so no `missing_grant` is reported for it. When the target is not a declared resource, the final-forbid check is skipped, the grant check still runs, and `checkResolvedNames` also reports `unknown_name`. An entry with no `<Resource>` target skips both checks. Rationale, memory, reevaluations, and attestations never suppress either diagnostic, and a grant never suppresses `final_forbidden_effect`.
- **Memory is not a waiver.** Memory can satisfy required design context and create review obligations, but it does not suppress final forbids, missing grants, or other hard model failures. `checkFunctions`, the relation checks, and coverage never read `rationales`, `memories`, or `reevaluations`, and attestations are read only by `checkCoverage`, `checkBindings`, and `checkStaleAttestations`.
- **Unknown-effects severity.** `checkFunctions` reports each function with `effects unknown` as `unknown_effects` with severity `error`, and skips that function's final-forbid and grant checks. It skips functions from generated-AST modules (`shouldIgnoreUnknownEffectsDiagnostic`, which reads `FunctionInfo.generatedAstCandidate`). Under `allowUnknownEffects`, `checkLoweredShapeModel` downgrades every `unknown_effects` diagnostic to `warning`; no other kind changes, and a result that holds only these warnings passes.
- **The current-file filter.** With an empty changed-file list, `checkCoverage` and `checkBindings` report nothing. Otherwise `changedFileContext` normalizes the list against `repoRoot`, and a Shape-update ref counts only when `provenanceFileChanged` finds its declaring `.shape` file in that list. An attestation follows the same rule unless `baseModules` is set; then `isCurrentAttestation` counts it only when its `attestationKey` (kind, path, and reason) is absent from the lowered base model. The incremental checker keys cached results on those base keys, so a different base re-runs the checks. The attestation, governed-path, and binding rules applied after this filter are in [Keep the Model Current](/shapelang/guides/keep-model-current/).
- **Guards read change events.** `checkGuardedChanges` passes the contexts from `buildGuardContexts` and `model.changeEvents` to `evaluateGuards` in `packages/shp-checker/src/memory-guards.ts`. Change events come only from `change` declarations, so editing a guarded declaration in place never raises `guarded_shape_changed`. A valid reevaluation (`hasValidReevaluationForGuard`) satisfies every guard of the context it names.
- **Rule-derived final forbids.** `deriveFinalForbidsForResource` adds forbids from `rule` declarations that contain a `forbid final` member:
  - The subject name from `when T has TraitName` is the rule's generic binder. `checkRules` reports `invalid_rule` when a rule with a `forbid final` member has no `when` subject or more than one distinct subject.
  - Every `when` clause for the subject must match: the resource must carry each listed trait.
  - Each condition trait must be a marker trait with no type parameters, or have exactly one parameter explicitly bound to `Resource`, such as `AppendOnly<T: Resource>`. `resourceRuleConditionCompatibility` rejects unbound, non-`Resource`, and multiple parameters as `invalid_rule`, because the rule syntax cannot bind them to the subject.
  - An invalid or unresolved condition contributes no forbids.
  - A generic target such as `HardDelete<T>` binds to the matching resource. A concrete target such as `HardDelete<audit::AuditEvent>` stays that exact resource after module and import resolution.
  - Plain `forbid` members in a rule derive nothing.
  - A `final_forbidden_effect` from a rule names the first `when` trait as its trait.

## Graph witnesses

`forbid path` and `forbid hypercycle` share one step-graph builder, `buildRelationTraversalGraph` in `rules/relations.ts`, and report one shortest, canonical witness each.

**Step graph.** Each hyperedge contributes directed steps according to the traversal its kind declares in `PRELUDE_RELATION_KINDS` (`packages/shp-checker/src/prelude.ts`). `directed_pairs` kinds (`calls`, `callbacks`, `provides`) give one step, `members[0] → members[1]`. The `ordered_path` kind (`coordinated_call`) gives one step per consecutive pair of members. Other kinds give no steps. Only hyperedges whose kind is in the rule's kind list contribute; a `forbid hypercycle` with no `over` clause uses every kind. Each vertex's outgoing steps are sorted by target, then relation kind, then relation name, and the vertex list is sorted; every comparison is by codepoint.

**Paths.** `checkForbiddenPaths` reports `invalid_rule` for a `forbid path` whose endpoints are equal or whose kinds include one without traversal. It skips a rule whose endpoints are unresolved or ambiguous, which `checkResolvedNames` reports. `findShortestPath` builds the step graph from `validPathHyperedges` only: it leaves out hyperedges with an unresolved or ambiguous endpoint, and `provides` hyperedges whose provider is not a component or whose target is not a resource. A breadth-first search from the source, with a visited set, returns the first path that reaches the target. That path has the fewest hops, with ties broken by the sorted step order, and the visited set makes the search terminate on cyclic graphs. Each `forbid path` member with a witness produces one `forbidden_path` diagnostic that lists every step.

**Hypercycles.** `findHypercycle` builds the step graph from all hyperedges, without endpoint filtering. It finds strongly connected components with Tarjan's algorithm, visiting vertices in sorted order, and keeps the components that contain a cycle: more than one vertex, or a step from a vertex to itself. Within each such component, a breadth-first search from every vertex finds the shortest cycle back to that vertex. Candidates are compared by length, then by their vertex sequence, then by each step's relation kind and name, all by codepoint, and the smallest across all components wins. The walk therefore starts at the codepoint-smallest vertex that lies on a shortest cycle. The witness lists the vertices as a closed walk and the relations in walk order, each relation once. `checkHypercycles` reports at most one diagnostic per `forbid hypercycle` member, and drops a repeat of the same set of relations within one rule.

Examples of both witnesses, and how a reviewer reads them, are in [Relations and Graph Rules](/shapelang/concepts/relations/).

## Adding a rule

A rule belongs in Shape when it rejects an incoherent or incomplete claim and can explain itself through lowered model data and provenance. It must not adjudicate taste. Before writing one, identify which index it reads, which declaration creates that data, which diagnostic a reviewer should see, and whether a reviewer can fix the problem without knowing checker internals.

1. If the rule needs data the model lacks, add the field to `Model` in `model.ts` and fill it in the matching lowerer under `lowering/`. Add a `Fact` variant as well only if `includeFacts` consumers should see the data.
2. Add the diagnostic variant to `SemanticDiagnostic` in `model.ts`, with `filePath` and a `causedBy` list built with `describeProvenance`. Add its case to `formatDiagnostic` in `diagnostics.ts`; `bun run typecheck` fails until the switch covers the new kind.
3. Write the check in the matching module under `rules/`, as a function that takes the `Model` (plus any option values it needs) and returns `SemanticDiagnostic[]`. Read typed indexes and `derivations.ts` helpers, never `model.facts`.
4. Add an entry to `SEMANTIC_CHECKS` in `rules.ts` that passes it the model and those option values.
5. Add a passing model under `fixtures/pass/<name>/` and a failing one under `fixtures/fail/<name>/`, and cases in `packages/shp-checker/src/checker.test.ts` that load them. `checker.test.ts` loads each fixture by path, so a fixture that no test names is never checked. The formatter round-trip test and `bun run format:check` do scan every fixture, so run `bun run format:shape` on new fixtures.
6. Document the printed form, cause, and fix in `docs-site/src/content/docs/reference/diagnostics.md`. The `RuleEngineDocs` binding in `shape/delivery.shape` requires a docs change when `rules.ts`, `rules/**`, `diagnostics.ts`, or `shape/checker.shape` changes.
7. Model the new function on `ShapeRuleEngine` in `shape/checker.shape`, with its `source` and complete effects. `packages/shp-checker/src/checker/**/*.ts` is governed by the `CheckerSource` implementation, so coverage fails unless a current Shape update or attestation names the changed rule module.
8. Run the contributor checks listed in [`CONTRIBUTING.md`](https://github.com/timbrinded/shapelang/blob/master/CONTRIBUTING.md).

## Why rules are direct TypeScript checks

Rules are TypeScript functions over the typed indexes (decided 2026-07-26, [issue #39](https://github.com/timbrinded/shapelang/issues/39)). The credible alternative was a Datalog-style engine over `model.facts`. The unexported spike in `packages/shp-checker/src/experiments/datalog-rule-engine-spike.ts` reproduces the production `missing_grant` diagnostic and its provenance with one anti-join rule:

```text
missing_grant(Component, Function, Effect, Target) :-
  effect(Component, Function, Effect, Target),
  component(Component),
  not grants(Component, Effect, Target).
```

It consumes the real `Fact[]` stream, carries structured provenance through positive matches, and selects output deterministically. Its tests compare the result field for field with the direct checker for passing, failing, targetless-effect, exact-join, provenance, and input-fact-order cases. A separate test confirms that the spike does not apply final-forbid precedence: for a `HardDelete` on an `AppendOnly` resource it reports a `missing_grant` that production suppresses.

The prototype shows that provenance can survive a relational join, but it does not show a clear maintenance, correctness, or performance benefit over the current rule modules. Direct checks keep one authoritative semantic implementation instead of two semantic representations of the same model. Each rule uses the model index that naturally represents its domain, TypeScript exhaustiveness and the existing domain types keep invalid states visible, and diagnostic precedence and witness selection remain explicit. A full migration would also need a richer fact contract and engine extensions: the fact stream is not a complete rule database, and some rule semantics depend on more than tuple membership:

- A `rule` fact records the rule name, not its conditions or forbidden actions.
- A `context_required` fact omits `satisfiedBy` and `requiresDescription`.
- Rationale and memory facts omit effective `applies_to`, freshness dates, and policy metadata.
- Change events used by guarded-change evaluation are not facts.
- Diagnostic precedence, such as final forbids suppressing a missing-grant diagnostic for the same effect, lives in direct control flow.
- Path and hypercycle checks depend on canonical graph traversal and witness selection, not only tuple membership.
- A `trait_final_forbid` fact is emitted for plain `forbid` members too and carries no `final` flag, and per-resource and rule-derived forbids are not facts.
- Declaration-level `modify` and `remove` change entries leave the replaced declaration's facts in the stream.

An in-house engine would also make Shape own rule safety, stratification, indexing, proof selection, and debugging. An external engine would still need adapters for provenance, diagnostic ordering, graph witnesses, Bun packaging, and the browser boundary, and no current maintenance or performance result justifies another production dependency. The accepted cost is that new rules may repeat simple lookup and anti-join code.

Reopen the decision only when at least one primary trigger holds and every parity requirement is met.

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

Until then, new rules extend the direct modules under `rules/`, and facts remain inspection output. CI compiles the spike and runs its differential tests through `bun run typecheck` and `bun test`. Code review confirms that `packages/shp-checker/src/index.ts` does not export the spike and that `SEMANTIC_CHECKS` does not call it.

`experiments/semantic-kernel/` is a separate, isolated Rust and browser-WASM prototype that evaluates one rule over projected facts. The Shape rule `ExperimentalSemanticKernelIsolation` in `shape/runtime.shape` forbids a modeled `calls` path from `ShapeChecker`, `ShapeEditorServices`, or `ShpCli` to `ExperimentalSemanticKernel`. Its protocol, measurements, and adoption criteria are in the README of [`experiments/semantic-kernel/`](https://github.com/timbrinded/shapelang/tree/master/experiments/semantic-kernel).
