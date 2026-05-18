# Teaching Guide

Use this when explaining Shape to another agent or human.

## Concept Ladder

Teach in this order:

1. Shape files are typed architecture claims.
2. The checker validates model coherence, not full source correctness.
3. Resources carry traits and invariants.
4. Components own resources, grant effects, and declare dependencies.
5. Functions summarize effects with source/evidence.
6. Change files model PR-level deltas.
7. Coverage rules require shape deltas for governed source changes.
8. Rules express project constraints such as final forbids and dependency-cycle bans.
9. Memory Guards add typed design memory for non-obvious or hard-fought shapes.

## Teaching Style

- Start from a concrete `.shape` example.
- Ask what architectural claim each line makes.
- Contrast `effects complete` with `effects unknown`.
- Show why a final forbid beats a grant.
- For Memory Guards, distinguish rationale, memory, description, and reevaluation.
- End by running `shp check` or showing the diagnostic that proves the point.

## Useful Analogies

- A `.shape` file is a reviewable contract for architecture.
- A change block is a PR patch to the architecture model.
- A rationale explains an intentional shape.
- A memory preserves hard-fought knowledge.
- A reevaluation is a typed review record for changing guarded shape.

## Avoid Teaching These Wrong Ideas

- Do not say Shape proves source code correctness.
- Do not imply prose is typechecked.
- Do not present Memory Guards as waivers.
- Do not suggest `effects complete` when the agent is uncertain.
