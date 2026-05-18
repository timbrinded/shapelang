# Implementation Guide

Use this when changing the Shape language implementation.

## Change Pipeline

1. Update grammar in `packages/shp-checker/src/language/shape.langium`.
2. Regenerate Langium artifacts with `bun run langium:generate`.
3. Lower AST changes in the checker model.
4. Add facts and diagnostics only when they help explain deterministic checker behavior.
5. Update formatter output so new syntax has one canonical form.
6. Update CLI/editor/authoring helpers only if the behavior is user-facing there.
7. Add pass and fail fixtures, then tests.

## Checker Principles

- The checker validates model coherence, not arbitrary application correctness.
- Diagnostics should include provenance through `causedBy`.
- Final forbids must run independently of Memory Guards and must not be suppressible.
- Keep hardcoded prelude behavior small until a user-defined Shape syntax is needed.
- Treat target/context refs structurally, not with broad string matching.

## Formatter Principles

- Preserve one semantic claim per line.
- Sort stable lists where existing formatter behavior sorts.
- Keep function order: traits, source, description, unsafe/effects, then members.
- Keep memory guard declaration order: rationale, memory, reevaluation before attestations and changes.

## Test Expectations

Add parser tests for syntax, checker tests for behavior, formatter tests for canonical output, and CLI smoke tests for new commands. Use existing fixtures as the style guide.

Core commands:

```bash
bun run langium:generate
bun test
bun run typecheck
bun shp fmt --check $(find shape fixtures -name '*.shape' | sort)
```
