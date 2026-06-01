# Teaching Guide

Use this when explaining Shape to another agent or human. Teach by running or showing CLI-backed outcomes, not by describing syntax in isolation.

## Concept Ladder

1. Shape files are typed architecture claims.
2. The checker validates model coherence, not full source correctness.
3. Resources carry traits and invariants.
4. Components own resources and grant effects. Structural links between components and resources live in top-level `relation` declarations.
5. Functions summarize effects with source/evidence.
6. Global model updates keep Shape claims aligned with source changes.
7. Coverage rules require current model updates or attestations for governed source changes.
8. Rules express project constraints such as final forbids and hypercycle bans over the directed hypergraph of relations.
9. Memory Guards add typed design memory for non-obvious or refactor-sensitive shapes — on functions, components, and resources.
10. Guards can be precise (`protects shape`/`description`, `guards forbid transform`) and can carry review policy: `sensitive` memories under an approver `policy` need an `approver`, declared `role`s validate identities, and `review_by` enables opt-in freshness via `--strict-freshness`.
11. Projects can define their own obligations with `require_context`; a same-named trait shadows the built-in.

## CLI-Backed Teaching Path

Start with a passing model:

```bash
shp check fixtures/pass/append_only_append/audit.shape
```

Introduce a final-forbid failure:

```bash
shp check fixtures/fail/append_only_hard_delete/audit.shape
```

Inspect the resource or function:

```bash
shp explain AuditEvent fixtures/fail/append_only_hard_delete/audit.shape
```

Show changed-source coverage:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_update/audit.shape
```

Show source hints as advisory:

```bash
shp analyze --shape-files shape/system/audit.shape fixtures/source/audit_purge.ts
```

Show Memory Guard review:

```bash
shp memory fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape
shp obligations fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape
```

Show opt-in freshness (stale design memory surfaces only with the flag):

```bash
shp obligations --strict-freshness fixtures/pass/memory_guard_review_freshness/bridge.shape
```

End with validation:

```bash
shp fmt --check
shp check
```

## Teaching Prompts

- Ask: what architectural claim does this line make?
- Ask: is this known complete, explicitly unknown, or unsupported?
- Ask: which command would reveal this failure?
- Ask: does this diagnostic require changing policy, adding context, or preserving the shape?

## Counter-Teaching

Do not teach: Shape proves source correctness.

Teach instead: Shape validates reviewed architecture claims.

Do not teach: analyzer hints are facts.

Teach instead: analyzer hints help find omissions that humans must review.

Do not teach: Memory Guards are exceptions.

Teach instead: Memory Guards add obligations and cannot waive final forbids.

Do not teach: `effects complete` is aspirational.

Teach instead: `effects complete` claims every material effect is represented.

## Useful Analogies

- A `.shape` file is a reviewable contract for architecture.
- A model update is a direct edit to the global architecture contract.
- A rationale explains an intentional shape.
- A memory preserves a refactor constraint.
- A reevaluation is a typed review record for changing guarded shape.
- A `sensitive` memory plus an approver `policy` is a two-person review rule.
- `review_by` is a self-imposed review deadline the team opts into checking.
