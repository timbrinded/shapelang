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

### Governed source changed without a real delta

Detect: a changed file matches an implementation path, but only vague attestation or no delta exists.

Why wrong: coverage must show how the architecture model changed or why it did not.

Smallest fix: add a change file with `source`/`evidence`, or a narrow `attest no_shape_change`.

### Memory Guard missing context

Detect: `PreserveInline`, `RequiresDescription`, `RefactorSensitive`, `NonIdiomatic`, `ProtectedCheckOrder`, or `TestOnly` appears without the required rationale/memory/description.

Why wrong: function shape traits derive typed review obligations.

Smallest fix: add the required context for the exact `fn Component.name` target.

### Context target mismatch

Detect: `InlineRationale<fn A.x>` with `applies_to fn A.y`.

Why wrong: the checker treats context targets structurally.

Smallest fix: make the generic target and `applies_to` identical.

### Guarded change without reevaluation

Detect: `modify fn` or `remove fn` touches a target protected by `guards on_change require ReEvaluation<Self>`.

Why wrong: guarded targets require explicit review evidence before change.

Smallest fix: add a valid `reevaluation` satisfying the memory/rationale, or preserve the protected shape.

### Memory used as a waiver

Detect: a memory/rationale is added next to a final-forbidden effect.

Why wrong: final forbids win over grants and design memory.

Smallest fix: fix the effect or architecture policy. Do not suppress the diagnostic.

### Analyzer output copied blindly

Detect: source hints are added without reading the source or evidence span.

Why wrong: `shp analyze` is advisory.

Smallest fix: inspect source, then add reviewed effects with evidence.

### Parser success treated as semantic success

Detect: an agent stops after syntax parses.

Why wrong: Shape has semantic checks after parsing.

Smallest fix: run `shp fmt --check` and `shp check`; use `coverage` when changed files are available.
