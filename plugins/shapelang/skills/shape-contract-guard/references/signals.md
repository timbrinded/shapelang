# Guard Signals

Use this reference when scoring authored `.shape` contract diffs. The output is advisory unless it repeats a deterministic `shp check` diagnostic.

## Severity Model

```text
severity = contract_change_signal + justification_deficit
declared_model_context = advisory wording, not a formal multiplier
```

Contract-change signal:

- `high`: removed constraint, destructive capability added, false completeness introduced, deleted contract file with constraints.
- `medium`: broad authority added, review enforcement weakened, certainty or traceability reduced.
- `low`: metadata-only or neutral information changes.
- `zero`: pure tightening.

Justification deficit:

- `high`: loosening has no matching rationale, memory, reevaluation, evidence, or specific attestation.
- `medium`: justification exists but is generic or not tied to the changed symbol/path.
- `low`: justification names the risk and cites reviewable evidence.

## Constraint Removal

Report when the diff removes or weakens:

- Resource trait, especially `AppendOnly` or a declared local protection trait.
- `forbid final`.
- `forbid hypercycle`.
- `forbid provides ... except ...`, including widened exceptions.
- `guards { on_change require ... }`.
- `owns`.
- Prelude structural relation kind such as `calls`, `callbacks`, `provides`, or `coordinated_call`.
- `implementation` declaration or `on_change require shape_update`.
- `binding` declaration or required changed paths.
- Trait definitions that weaken `allow`, `require`, `forbid`, or `require_context`.
- Imports that change which trait definition resolves.
- Built-in or project-significant trait names through shadowing.
- Whole authored `.shape` files containing constraints, coverage, bindings, provider rules, guarded design context, memory, rationale, reevaluation, or relation declarations.

Default severity: high when a real constraint is removed. Use critical only when the same diff also introduces capability/effect that uses the loosened path.

## Capability Or Effect Widening

Report when the diff adds or widens:

- Destructive or data-moving `grants`.
- Broad unused `grants`; medium by default.
- Function effects for destructive or data-moving effects.
- Effect targets from less sensitive to more sensitive resources.
- Resource trait weakening that permits new effects.

Destructive/storage effects include final forbids from traits, explicit `HardDelete<T>`, `Truncate<T>`, `DropStorage<T>`, and project-defined equivalents.

## Co-Occurrence

Escalate first when:

- A constraint was removed, and
- A newly allowed grant/effect/relation affects the same resource, component, function, relation endpoint, or declared neighborhood.

This is the primary Guard failure mode. It can pass `shp check` because the head model is coherent after loosening.

## Review-Enforcement Weakening

Report separately from resource/effect loosening when the diff weakens:

- Implementation coverage for governed source.
- Binding coupling for docs, workflows, generated AST, release, or public review surfaces.
- Attestation allowances that make review coupling easier to bypass.

Outcome: `review-enforcement weakening`.

## Structural Relation Weakening

Report when the diff:

- Removes `calls`, `callbacks`, `provides`, or `coordinated_call`.
- Changes a relation from a prelude kind to a custom or weaker kind.
- Removes endpoints from a `coordinated_call` path.

Removed roles or summaries are low by themselves, but become stronger when paired with endpoint or kind changes.

## Traceability Loss

Report when near a loosening the diff removes:

- `source`.
- `evidence`.
- Rationale.
- Memory.
- Reevaluation.
- Relation roles or summaries.

Outcome: `traceability loss` unless the same diff also weakens constraints or review enforcement.

## Epistemic Regression

Report:

- `effects unknown` to thin `effects complete { }`: high risk because it creates false completeness.
- `effects complete` to `effects unknown`: model completeness regression that preserves uncertainty.
- Memory confidence/status regression such as `High` to `Low` or `Explained` to `Unexplained`.

## Attestation Credibility Gap

Report when `attest no_shape_change` or `attest docs_not_needed` is added or changed and:

- The reason is empty-looking, generic, or not tied to the triggering path.
- The reason contradicts the visible `.shape` diff.
- The reason contradicts the changed-file list.

Judge only changed paths, authored `.shape` diff, and attestation text in v1. Do not read application source to prove or disprove the attestation.

## Declared Model Context

Use declared model context to explain why a reviewer should care, not to compute a centrality score.

Run:

```bash
shp graph stats
shp graph all --kind calls
shp graph all --kind provides
shp graph show <Symbol>
shp explain <Symbol>
shp memory
shp obligations
```

Wording rules:

- Say "participates in declared provider boundary" when touched symbols are in `provides` relations.
- Say "participates in declared call structure" when touched symbols are in `calls`, `callbacks`, or `coordinated_call`.
- Say "guarded design context" when `shp memory`, `shp explain`, or `shp obligations` shows a memory/rationale guard.
- Say "review enforcement surface" when implementations, bindings, or attestations are touched.
- Say "syntax evidence only" for generated AST anchors and `generated_from` relations.
- Do not call relation incidence a centrality metric.
- Do not downgrade strong ownership, grants, effects, traits, rules, or final-forbid signals because graph incidence is low.
- Do not treat Shape `calls` as a TypeScript import graph or runtime trace. It is the declared architecture graph.

## Outcomes

- `suspicious loosening`: weaker constraint/review surface with weak or no justification.
- `justified loosening`: specific rationale, memory, reevaluation, evidence, or attestation explains the relaxation.
- `necessary loosening`: model context shows the old constraint was intentionally too narrow or obsolete.
- `review-enforcement weakening`: coverage, binding, or attestation coupling got weaker.
- `traceability loss`: review evidence got weaker without direct contract weakening.
- `informational`: noteworthy but not risky.
