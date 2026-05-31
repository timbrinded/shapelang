# Behavioural testing conventions (epic #53)

These conventions govern the behavioural suite under `src/behavioural/`. They
exist because a test suite is only an oracle if it can fail for the right
reason. A green suite of tautologies manufactures confidence the product has
not earned — and, worse, crystallises whatever the implementation happens to do
today as if it were the design.

## Every behavioural test states a named invariant that is

1. **Truthful** — it states something actually guaranteed, checkable by reading
   the fixture.
2. **Falsifiable** — it can fail. Each area ships a **negative control**: a
   planted mutant (a broken fixture, a local stub, or a deliberately wrong
   expectation) that the test catches. A test that cannot be made to fail is
   rejected.
3. **Non-circular** — no asserting a string the author just wrote; no detector
   fed input rigged to its own pattern; no re-hashing one in-memory value and
   calling it determinism.
4. **Vision-anchored** — cite the authoritative clause (a `docs-site` path or a
   `shape/*.shape` declaration) via the test name. Use `lockedIntended(title,
   anchor)`. If no clause exists, write it first (coordinate with #34).
5. **Labelled** — every pinned behaviour is `lockedIntended` (a vision-derived
   law), `characterization` (documents current behaviour not yet ratified as
   ideal; give a reason + follow-up), or `shouldBe` (asserts the ideal and may
   fail against the current implementation). The label is part of the test name
   so any crystallisation is visible and reversible, never disguised.

## Rejected in review (boondoggles)

- Magic values without derivation of why the value is correct.
- `.toContain("word")` as the **sole** assertion for a semantic outcome —
  assert the structured diagnostic `kind` plus key fields (`requireDiagnostic`).
- Opaque whole-blob golden snapshots no reviewer can adjudicate.
- Detector tests whose fixtures are hand-crafted to match the detector pattern.
- "Did not throw" / exit-code-only happy-path tests as behavioural coverage.
- Determinism claims proven by comparing a value to itself in one process.
- Pinning current behaviour as law without a vision anchor.

## Asserting diagnostics

Use `requireDiagnostic(result, kind)` to get the diagnostic narrowed to its
variant, then assert its real fields. For the key diagnostics (final forbid,
missing grant, hypercycle, guarded change, missing context), additionally assert
the rendered **causal path** in order with `expectOrderedFragments(render(result),
[...])` — the vision requires diagnostics to teach the chain (effect →
authority/trait → constraint → rejection), not merely fail the build. The causal
chain is a *secondary* assertion layered on the structured one, never the sole
check.

See `src/behavioural/harness.ts` for the helpers.
