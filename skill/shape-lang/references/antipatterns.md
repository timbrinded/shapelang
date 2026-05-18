# Antipatterns

Use this when reviewing Shape authored by an agent.

## Language Antipatterns

- Using long prose instead of typed declarations.
- Adding broad grants just to make missing-grant diagnostics pass.
- Marking `effects complete` while uncertain.
- Omitting source/evidence when the changed file or diff provides it.
- Modeling implementation trivia that does not affect architecture.
- Rewriting base model files when a reviewable change file would do.

## Memory Guard Antipatterns

- Adding memory to justify a final-forbidden effect.
- Adding `PreserveInline` without an `InlineRationale`.
- Adding `RequiresDescription` without a non-empty description and `DescriptionRationale`.
- Adding `SharpEdge` without `HardFoughtKnowledge`.
- Letting `applies_to` disagree with the context type target.
- Modifying or removing a guarded function without a valid reevaluation.
- Using `summary` as a vague waiver, for example "known issue" or "approved by team".

## Implementation Antipatterns

- Editing generated Langium files by hand instead of changing grammar and regenerating.
- Adding checker behavior without formatter support for the new syntax.
- Adding diagnostics without provenance.
- Testing only the pass case.
- Depending on parser success as proof of semantic correctness.
- Making Memory Guards suppress existing diagnostics.

## Review Response Pattern

When you find an antipattern, explain the typed invariant that is missing and suggest the smallest Shape change that satisfies it. If the issue is a forbidden final effect, say that memory/rationale cannot fix it.
