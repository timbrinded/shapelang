# Behavioural testing conventions

These conventions, the standard set by epic #53, govern three sets of tests:

- the behavioural suite under `packages/shp-checker/src/behavioural/`;
- `packages/shp-cli/src/cli-contract.test.ts`;
- `docs-site/scripts/verify-shape-blocks.test.ts`.

A test suite is only an oracle if it can fail for the right reason. A green suite
of tautologies manufactures confidence the product has not earned, and it
crystallises whatever the implementation happens to do today as if it were the
design.

The helpers live in `packages/shp-checker/src/behavioural/harness.ts`. Only test
files import it, and the package does not export it, so the two test files
outside `packages/shp-checker` write their labels by hand.

## Conventions

Every behavioural test states a named invariant that meets all five conventions
below. Cite a convention by its name, for example "TESTING.md, Vision-anchored".

### Truthful

The test states something actually guaranteed, checkable by reading the fixture.

### Falsifiable

The test can fail. Each area ships a **negative control**: a contrasting input
(a broken fixture, a mutated model, or a value that must diverge) that goes
through the real API and makes it produce a different result. A control that
only exercises a local stub, closure, or regex proves the matcher, not the
product, and does not count. A test that cannot be made to fail is rejected.

### Non-circular

The test does not assert a string its author just wrote, feed a detector input
rigged to the detector's own pattern, or re-hash one in-memory value and call it
determinism.

### Labelled

Every pinned behaviour carries one of three labels, written into the test name by
its helper, so that any crystallisation is visible and reversible, never
disguised:

| Label | Helper | Required argument | Meaning |
| --- | --- | --- | --- |
| `[locked-intended]` | `lockedIntended(title, anchor)` | `anchor` | A vision-derived law that must hold for any correct implementation. |
| `[characterization]` | `characterization(title, { reason, followUp })` | `reason` | Current behaviour that has not been ratified as ideal. `reason` says why the behaviour is pinned. Give a `followUp` naming the tracked follow-up work; the helper does not enforce it. |
| `[should-be]` | `shouldBe(title, anchor)` | `anchor` | The ideal the vision describes, which the current implementation may not meet yet: a deliberate, tracked gap. |

A `shouldBe` test that fails against the current implementation is registered
with `test.todo`, so CI stays green while the gap stays visible. A `shouldBe`
test that passes uses a normal `test`.

The helpers produce these test names:

- `[locked-intended] TITLE — anchor: ANCHOR`
- `[characterization] TITLE — current behaviour: REASON; follow-up: FOLLOW_UP`
  (the `; follow-up:` part only when `followUp` is given)
- `[should-be] TITLE — anchor: ANCHOR`

### Vision-anchored

Every behavioural test cites, in its name, the authoritative clause it tests: a
`docs-site` path or a `shape/*.shape` declaration, optionally with a line.
`lockedIntended` and `shouldBe` require the anchor and write it into the test
name. The `characterization` helper takes no anchor, so write the anchor into the
title yourself. If no clause exists, write the clause first.

## Rejected in review

- Magic values without a derivation of why the value is correct.
- `.toContain("word")` as the **sole** assertion for a semantic outcome. Assert
  the structured diagnostic `kind` plus its key fields (`requireDiagnostic`).
- Opaque whole-blob golden snapshots that no reviewer can adjudicate.
- Detector tests whose fixtures are hand-crafted to match the detector pattern.
- "Did not throw" or exit-code-only happy-path tests counted as behavioural
  coverage.
- Determinism claims proven by comparing a value to itself in one process.
- Re-running a contract another test already owns with the same input; extend
  the owner instead.
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

`requireNoDiagnostic(result, kind)` asserts that a kind is absent, and
`diagnosticKinds(result)` returns the sorted multiset of kinds for comparison.
