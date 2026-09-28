# Guard Signals

Use this reference to classify normalized authored-contract changes. Keep checker diagnostics separate from advisory findings.

## Independent Dimensions

### Impact

- `high`: removes a final or material constraint, enables a destructive capability, introduces false completeness, deletes material contract, or opens a previously forbidden structural path.
- `medium`: adds broad authority, weakens review enforcement, reduces effect certainty, or removes material traceability.
- `low`: metadata-only or neutral information change.

### Support

- `none`: no decision evidence addresses the changed symbol and risk.
- `generic`: rationale, evidence, reevaluation, or attestation exists but does not address the exact change.
- `specific`: reviewable decision evidence names the affected symbol/path, semantic risk, and reason.

### Disposition

- `suspicious`: weaker contract or review surface with absent or generic support.
- `supported`: weaker contract with specific reviewable decision support or an explicit replacement constraint.
- `tightening`: equal or stronger contract with no loosening.
- `informational`: noteworthy neutral change.

Specific support changes disposition, not impact. A supported removal of a major boundary remains high-impact.

## Normalize Before Classifying

Create one before/after record per semantic root change. Search the candidate model before reporting removal:

- Was the declaration relocated?
- Was it renamed without semantic change?
- Was it replaced by an equal or stronger rule, trait, relation, implementation, or binding?
- Is the diff formatter-only or ordering-only?
- Do multiple textual changes express one underlying change?

Use an empty `replacement` only after these checks.

## High-Impact Signals

Report verified removal or weakening of:

- a resource protection trait;
- `forbid final`;
- `forbid hypercycle`;
- `forbid path` traversal kinds or endpoints;
- `forbid provides ... except ...`, including widened exceptions;
- ownership or a prelude structural relation;
- guarded change requirements;
- implementation coverage or binding enforcement;
- a vendored pack rule or trait;
- an authored file containing material constraints;
- `effects unknown` into an unsupported empty `effects complete`.

Escalate co-occurring constraint removal and newly allowed capability/effect on the same symbol or declared relation neighborhood as one high-impact root finding.

## Capability And Effect Widening

Classify destructive/data-moving grants and effects as high when newly enabled by the same loosening. Classify broad unused grants as medium unless current declared context shows a higher-impact boundary.

Examples include `HardDelete<T>`, `Truncate<T>`, `DropStorage<T>`, and project-defined equivalents.

## Structural Changes

Review:

- removed `calls`, `callbacks`, `provides`, or `coordinated_call`;
- a prelude kind replaced by a custom or weaker kind;
- removed coordinated endpoints;
- removed traversal kinds from a forbidden path;
- endpoints changed so a formerly forbidden declared route becomes reachable.

Use focused `graph show <Symbol>` first. Use global graph output only when the exact path or global rule cannot be resolved from focused incidence.

## Domain Packs And Resolution

Treat vendored modules under default discovery as active policy without requiring an import.

Report actual semantic impact when a diff:

- weakens a pack-owned rule, trait, or final forbid;
- replaces a pinned pack without reviewable provenance;
- changes module/import resolution to another declaration;
- shadows an imported name.

Do not claim that deleting an import disables a still-discovered pack-level rule.

## Review Enforcement And Traceability

Classify weakened implementations, bindings, or attestation coupling as review-enforcement impact.

Classify removed source/evidence/rationale/memory/reevaluation as traceability loss when no direct constraint also changed. Escalate traceability loss when it accompanies a high-impact loosening.

An attestation has generic support when its reason is empty-looking, generic, contradicted by the authored diff, or unrelated to the triggering changed path. Do not read application source to judge it.

## Recommended Actions

Choose only actions supported by the current model:

- restore or replace the constraint;
- provide specific rationale, decision, or evidence for intentional change;
- satisfy a reevaluation only when `memory`, `obligations`, or checker diagnostics require it;
- obtain explicit human review for a supported high-impact change.

Never present reevaluation as a generic waiver and never call a loosening necessary without source or decision evidence outside Guard's normal boundary.
