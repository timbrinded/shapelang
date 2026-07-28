---
name: shape-review
description: Use when reviewing a code change for real bugs with an authored whole-codebase Shape model. Combine a complete local diff review with evidence-backed cross-object investigation, verify claims in source, and emit only concrete actionable findings.
---

# Shape Review

Review the change as code first, then use authored Shape contract to find bugs
that a diff-only review can miss. Shape is evidence and navigation, not proof
that implementation is correct. Generated facts and analyzer hints are
candidates until confirmed against source.

Follow the `shape-lang` skill and its CLI reference. Use real graph forms:
`shp graph stats`, `shp graph all`, and
`shp graph show SYMBOL [--kind KIND]`.

## Evidence standard

Every finding must identify:

- the changed line where the defect should be fixed;
- the concrete input, state, caller, or execution path that triggers it;
- the observable incorrect outcome; and
- for a Shape-derived finding, the authored model fact and command that led to
  it, plus source confirmation that the implementation violates that fact.

Model silence is not evidence. A generated relation, analyzer hint, or guessed
invariant is not enough. Do not report architecture preferences, stale model
claims, style, or hypothetical risks without a reachable failure.

## Procedure

### 1. Review the diff locally

Read every changed hunk and its immediate implementation context. Record all
plausible correctness, security, data, lifecycle, concurrency, and API-contract
defects. Check exact operands, branches, error paths, boundaries, defaults,
awaits, cleanup, transactions, and trust-boundary validation.

Do not suppress local bugs because Shape has no relevant claim.

### 2. Load focused Shape context

Run:

1. `shp graph stats` for orientation.
2. `shp explain SYMBOL` for each architecture-significant changed symbol.
3. `shp graph show SYMBOL --kind calls` to inspect callers and callees.
4. `shp obligations` and `shp memory` when guarded targets, permissions,
   ownership, atomicity, or final forbids are involved.
5. `shp check` for current model diagnostics.
6. `shp analyze ...` only as a source-investigation lead; verify its hints.

Use `shp graph all` only when the focused graph cannot resolve the relationship.

### 3. Investigate cross-object failures

Look for:

- callers outside the diff broken by a changed return, error, or effect contract;
- a changed path bypassing an authored permission, audit, ordering, ownership,
  or transactional invariant;
- dependency or domain-pack rules violated by a new import, path, relation, or
  vendor interaction;
- shared-resource races or missing coordination across components; and
- implementation/model drift that makes an existing contract materially false.

For each candidate, open the actual caller and implementation. Confirm a
reachable failing path. If the authored model is stale, report or update that
drift separately; do not accuse the code of violating a false claim.

### 4. Disprove candidates

Drop a candidate when evidence shows it is handled, unreachable, based on a
misread, a duplicate, or not a behavioral defect. Uncertainty alone is not
proof, but it is also not sufficient for a finding: investigate until the
failure is concrete or omit it.

Never use a blanket category rule such as "only security findings" or "skip pure
functions." Severe defects must not be removed for being inconvenient or
outside the authored model.

### 5. Emit concise review comments

One issue per comment. State the broken behavior and trigger directly. For a
cross-object issue, cite the authored symbol and discovery command naturally in
the body, without dumping internal reasoning.

Return:

```json
{"comments":[{"path":"relative/file.ext","line":42,"body":"Concrete defect, trigger, and outcome."}]}
```

If no concrete actionable bug survives verification, return exactly:

```json
{"comments":[]}
```
