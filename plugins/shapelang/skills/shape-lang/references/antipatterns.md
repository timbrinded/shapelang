# Antipatterns

Use this when reviewing Shape authored by an agent. Report the concrete invariant that is missing and the smallest Shape change that fixes it.

## Review Findings

### Long prose instead of typed claims

Detect: summaries or reasons carry architecture facts that should be declarations.

Why wrong: prose is not typechecked.

Smallest fix: move the claim into `resource`, `component`, `grants`, `effects`, `relation`, `rationale`, `memory`, or `reevaluation`.

### Broad grant added to silence a diagnostic

Detect: a new `grants HardDelete<T>` appears without an architectural decision.

Why wrong: grants are capabilities, not checker appeasement.

Smallest fix: remove the grant unless the component is genuinely allowed to emit the effect.

### Uncertainty hidden as complete effects

Detect: `effects complete` appears with missing evidence, empty body, or known unresolved analysis.

Why wrong: complete means exhaustive.

Smallest fix: use `effects unknown`, or add every material effect with evidence.

### Governed source changed without a real model update

Detect: a changed file matches an implementation path, but only vague attestation or no model update exists.

Why wrong: coverage must show how the architecture model changed or why it did not.

Smallest fix: update the owning global model with `source`/`evidence`, or add a narrow `attest no_shape_change`.

### Memory Guard missing context

Detect: `PreserveInline`, `RequiresDescription`, `RefactorSensitive`, `NonIdiomatic`, `ProtectedCheckOrder`, or `TestOnly` appears without the required rationale/memory/description.

Why wrong: shape traits derive typed review obligations.

Smallest fix: add the required context for the exact target — `fn Component.name`, `component Name`, or `resource Name` — matching where the trait is borne.

### Context target mismatch

Detect: `InlineRationale<fn A.x>` with `applies_to fn A.y`.

Why wrong: the checker treats context targets structurally.

Smallest fix: make the generic target and `applies_to` identical.

### Guarded change without reevaluation

Detect: `modify fn` or `remove fn` touches a target protected by `guards on_change require ReEvaluation<Self>`.

Why wrong: guarded targets require explicit review evidence before change.

Smallest fix: add a valid `reevaluation` satisfying the memory/rationale, or preserve the protected shape.

### Forbidden transform applied without reevaluation

Detect: a `change` declares `modify fn X.y transform <Label>` while a memory/rationale on that target has `guards forbid transform <Label>`, and no reevaluation satisfies it.

Why wrong: a named transform was explicitly gated for review.

Smallest fix: add a `reevaluation` satisfying the guard, or do not declare that transform.

### Sensitive memory reevaluated without an approver

Detect: a `policy` with `require approver` exists, a memory is `sensitive`, and its reevaluation names only a `reviewer` (`missing approver required by policy`).

Why wrong: sensitive design memory under an approver policy needs a second, approving identity.

Smallest fix: add an `approver` to the reevaluation; if roles are declared, use a declared `role`.

### Unknown reviewer or approver role

Detect: at least one `role` is declared and a reevaluation's `reviewer`/`approver` is not one of them.

Why wrong: declaring roles turns on identity validation; an undeclared name is likely a typo.

Smallest fix: declare the `role`, or correct the reviewer/approver to an existing one.

### Stale design memory

Detect: under `--strict-freshness`, a `rationale`/`memory` `review_by` date is before today (`stale design memory`).

Why wrong: the design claim is past its own review deadline.

Smallest fix: re-review and update `review_by`, or replace the entry with a `reevaluation`. Do not bump the date without a real review.

### Invalid or redundant user obligation

Detect: a `require_context C<T>` whose `<T>` names no declared type parameter or uses an unrecognised bound (`invalid require_context`); or a user trait re-declaring a built-in name expecting to add to, rather than replace, the built-in obligation.

Why wrong: the bound selects the target kind, and a same-named trait shadows (replaces) the built-in.

Smallest fix: bind `T` to `Fn`/`Component`/`Resource`; if shadowing a built-in, re-state every obligation the trait should still carry.

### Memory used as a waiver

Detect: a memory/rationale is added next to a final-forbidden effect.

Why wrong: final forbids win over grants and design memory.

Smallest fix: fix the effect or architecture policy. Do not suppress the diagnostic.

### Analyzer output copied blindly

Detect: source hints are added without reading the source or evidence span.

Why wrong: `shp analyze` is advisory.

Smallest fix: inspect source, then add reviewed effects with evidence.

### Generated AST treated as architecture truth

Detect: generated anchors, candidate effects, or `generated_from` relations are
copied into authored invariants without inspecting implementation source.

Why wrong: generated Shape records syntax evidence and deliberately preserves
unknowns; it does not decide architecture.

Smallest fix: use the anchor to locate source, review the behavior, then promote
only the supported claim into authored Shape.

### Numbered source or evidence reference

Detect: `source` or `evidence` includes a line number or range.

Why wrong: line movement churns fingerprints and review evidence without a
semantic change.

Smallest fix: use `file#symbol`, or file-only when no durable symbol exists.

### Import treated as domain-pack activation

Detect: an agent assumes a pack-level rule is inactive because no project module
imports the pack.

Why wrong: default discovery loads every `.shape` file below the Shape root;
imports affect name resolution, not activation.

Smallest fix: evaluate the full discovered model and reserve pack-level rules
for install-time policy.

### Draft flag used as acceptance

Detect: work is handed off after only
`shp check --allow-unknown-effects`.

Why wrong: the flag is an authoring aid that makes explicit unknown-effect
diagnostics non-fatal; accepted models still require strict validation.

Smallest fix: resolve or deliberately model the uncertainty according to project
policy, then run strict `shp check`.

### Parser success treated as semantic success

Detect: an agent stops after syntax parses.

Why wrong: Shape has semantic checks after parsing.

Smallest fix: run `shp fmt --check` and `shp check`; use `coverage` when changed files are available.
