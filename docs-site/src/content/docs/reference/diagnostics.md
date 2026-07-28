---
title: Diagnostics Catalog
description: Common Shape diagnostics and what they mean.
sidebar:
  order: 3
---

Shape diagnostics name the failed claim and show the causal path behind it.

Diagnostics are reported in a canonical order: by diagnostic kind, then by
rendered text. The order is deterministic over the input set and does not
depend on the order of declarations in `.shape` source files, so reordering
declarations never churns checker output in CI or review diffs.

Internal diagnostic kinds (for tooling and tests) appear in parentheses after
each heading. The user-facing title is the `error:` / `warning:` label from
`shp check`.

## Forbidden effect (`final_forbidden_effect`)

Cause: a function emits an effect forbidden by a resource trait or rule.

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")
```

Fix the model by removing the effect, changing the architecture decision, or moving the behavior to a component/resource where the effect is allowed. Rationale, memory, reevaluation, and grants do not waive final forbids.

For rule-derived final forbids, the rule must bind exactly one subject with `when T has TraitName`. Concrete forbid targets are resolved through module/import scoping before this check runs.

## Missing grant (`missing_grant`)

Cause: a function emits an effect that its component does not grant.

```text
error: missing grant

AuditStore.appendEvent emits Append<AuditEvent>.
AuditStore does not grant Append<AuditEvent>.
```

Add the correct grant only if the component is actually allowed to contain that effect.

## Unknown effects (`unknown_effects`)

Cause: a function declares `effects unknown` where the project requires explicit effect summaries.

Generated AST candidate files under `shape/generated/ast` are the exception: they may keep `effects unknown` because their `effect candidate` declarations are evidence hints, not reviewed effect summaries.

```text
error: unknown effects

AuditStore.appendEvent declares effects unknown.
```

Strict `shp check` reports this as an error. While iterating on an authored draft, `shp check --allow-unknown-effects draft.shape` reports it as a non-fatal warning (`warning: unknown effects`) and exits `0` only when no other diagnostic is present.

## Unknown name (`unknown_name`)

Cause: a reference names a resource, component, trait, or relation endpoint that is not declared in the loaded model.

```text
error: unknown relation_endpoint

relation_endpoint GhostService is referenced but not declared.
```

Other `nameKind` values render as `error: unknown resource`, `error: unknown component`, or `error: unknown trait`.

## Ambiguous name (`ambiguous_name`)

Cause: a bare name matches more than one imported declaration.

```text
error: ambiguous component

component Store matches more than one imported declaration.
Use a module-qualified reference.
matches: audit::Store, billing::Store
```

Use a module-qualified reference such as `audit::Store`.

## Invalid rule (`invalid_rule`)

Cause: a `rule` declaration is malformed for the semantic check it asks the checker to perform. For final effect forbids, rules may bind only one subject name. Repeated `when T has Trait` clauses are allowed and are treated as conjunctions; different subject names in the same final-forbid rule are rejected. Each condition must name a declared marker trait or a trait with exactly one explicitly `Resource`-bound parameter. Unbound, function-bound, component-bound, unsupported, and multi-parameter traits cannot be used as resource conditions.

```text
error: invalid rule

rule invalid_multi_subject_final_forbid is invalid: final effect forbids may bind only one subject, but found T, U.
```

Invalid rules are inert: the checker reports the rule error without deriving its final forbids.

## Duplicate declaration (`duplicate_declaration`)

Cause: the same name is declared more than once for a given declaration kind (resource, component, trait, relation, candidate effect, binding, rationale, memory, or reevaluation).

```text
error: duplicate component

component AuditStore is declared more than once.
```

## Duplicate fingerprint (`duplicate_fingerprint`)

Cause: a resource declares the same fingerprint provider more than once.

```text
error: duplicate fingerprint

resource AuditStoreAstAnchor declares fingerprint provider ast.semantic_subtree_v1 more than once.
```

## Governed source changed without Shape update (`missing_shape_update`)

Cause: a changed source path matches an implementation block with `on_change require shape_update`, but the changed-file set did not include a matching Shape update or current attestation.

```text
error: governed source changed without current Shape update

Changed file: src/audit/purge.ts
Governed by: audit::AuditStoreImpl
Matched path: src/audit/**/*.ts
Required: update a current .shape file with matching source/evidence, or add a no_shape_change attestation.
```

Reproduce with:

```bash
shp coverage --changed-files fixtures/changed/audit_purge.txt fixtures/fail/missing_shape_update/audit.shape
```

`shp check --changed-files` also runs this check.

## Bound docs change missing (`missing_bound_docs_change`)

Cause: a `binding` declaration says that one changed path requires another changed path, but the required path was not present in the changed-file list.

```shape
module repo

binding CheckerDocs {
  when_changed paths {
    "packages/shp-checker/src/checker.ts"
  }
  require_changed paths {
    "docs-site/src/content/docs/reference/diagnostics.md"
  }
  allow attest docs_not_needed
}
```

If `packages/shp-checker/src/checker.ts` changes, the docs path must also change or the change set must include a narrow current attestation in a `.shape` file changed by that same set:

```shape
module repo

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker.ts")
  reason "Internal refactor only; no diagnostics or documented behavior changed."
}
```

Rendered diagnostic shape:

```text
error: bound docs change missing

binding CheckerDocs was triggered by packages/shp-checker/src/checker.ts.
Required: change one of docs-site/src/content/docs/reference/diagnostics.md, or add attest docs_not_needed.
```

Bindings are review gates. They ensure docs are considered when Shape-affecting code or model files change. They are enforced by `shp check --changed-files`, not by coverage-only mode.

## Forbidden path (`forbidden_path`)

Cause: a `forbid path SOURCE -> TARGET over KIND ...` rule found a directed path whose every hop uses an allowed relation kind. Relations with unresolved or ambiguous endpoints, or invalid `provides` endpoint roles, do not contribute to this witness.

The diagnostic reports the canonical fewest-hop witness. Each line identifies the relation kind, relation declaration, and directed endpoints for one hop. If two witness vertices or relations share a local name across modules, only those colliding names are module-qualified.

```text
error: forbidden path

rule no_gateway_to_secrets rejects this dependency path:
  calls GatewayCallsPolicy: Gateway -> PolicyService
  provides PolicyProvidesSecret: PolicyService -> SecretStore
witness: Gateway -> PolicyService -> SecretStore
```

Remove or redirect a relation, narrow the rule's explicit kind set, or revise the architecture decision. Reverse-only and disconnected graphs do not match. Use `forbid hypercycle` rather than identical path endpoints.

## Forbidden hypercycle (`forbidden_hypercycle`)

Cause: a `forbid hypercycle` rule found a directed cycle in the structural hypergraph. The diagnostic cites the relations forming the cycle and a vertex witness path. Each relation kind contributes steps to the cycle graph according to its declared traversal semantics (binary kinds contribute one step `A -> B`; ordered kinds contribute consecutive steps along their members).

The checker filters that graph by the rule's relation kinds, partitions it into strongly connected components, and selects the cycle with the fewest traversal steps. Equal-length cycles are resolved in canonical name order, so declaration order does not change the witness.

```shape
module gateway

component Gateway {
}
component AuditStore {
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
}

relation AuditCallsGateway {
  kind callbacks
  connects AuditStore -> Gateway
}

rule no_runtime_cycle {
  forbid hypercycle over calls or callbacks
}
```

```text
error: forbidden hypercycle

rule no_runtime_cycle rejects this hypercycle:
  calls GatewayCallsAudit
  callbacks AuditCallsGateway
witness: AuditStore -> Gateway -> AuditStore
```

Break the cycle by removing or redirecting one of the relations, or scope the rule to a different set of kinds with `forbid hypercycle over KIND`.

## Forbidden provides (`forbidden_provides`)

Cause: a `forbid provides T except C` rule found a `provides` hyperedge that supplies `T` from a component other than the allowed one.

```text
error: forbidden provides

Sidecar provides JsonRpcEndpoint via relation SidecarProvidesRpc.
rule GatewayBoundary forbids provides JsonRpcEndpoint except Gateway.
```

Move the `provides` relation onto the allowed component, or change the rule.

## Stale fingerprint expectation (`fingerprint_mismatch`)

Cause: a relation pins a resource fingerprint, but the current resource fingerprint is missing or different. This usually means a reviewed Shape claim still points at an older generated AST anchor version.

```shape
module generated.audit

resource AuditStoreAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}

component AuditStore {
}

relation ReviewedFromAst {
  kind generated_from
  connects AuditStore -> AuditStoreAstAnchor
  expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

```text
error: stale fingerprint expectation

relation ReviewedFromAst expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1.
expected: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
actual: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

Regenerate the AST anchor layer, inspect the changed code evidence, then either update the pinned fingerprint after review or revise the claim.

## Stale candidate effect pin (`candidate_pin_fingerprint_mismatch`)

Cause: an `effect candidate` pins an anchor fingerprint that no longer matches the resource.

```text
error: stale candidate effect pin

candidate effect AppendEventCandidate pins AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1.
expected: sha256:aaaaaaaa...
actual: sha256:bbbbbbbb...
```

## Invalid candidate effect (`invalid_candidate_effect`)

Cause: an `effect candidate` declaration is incomplete or inconsistent (for example, missing function, effect, or pin fields the lowerer requires).

```text
error: invalid candidate effect

candidate effect AppendEventCandidate: <reason>.
```

## Unsafe effects missing policy metadata (`unsafe_effects`)

Cause: a function declares `unsafe` effects without the required policy metadata members (for example missing `requires`, `reason`, or `expires` as enforced by the checker).

```text
error: unsafe effects missing policy metadata

AuditStore.importLegacyEvents declares unsafe effects.
Missing: reason, expires.
```

## Missing required context (`missing_required_context`)

Cause: a function, component, or resource has a shape trait such as `PreserveInline`, `RefactorSensitive`, or `NonIdiomatic`, but no matching `rationale` or `memory` exists for that target.

```text
error: missing required context

fn Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.

No matching rationale or memory found.
```

Component and resource targets report the same diagnostic with their own target kind, for example `component Gateway has shape RefactorSensitive` requiring `RefactorConstraint<component Gateway>`. The same diagnostic covers obligations from user-defined `trait` `require_context` members, attributed to the declaring trait rather than the standard prelude.

Add a typed `rationale` or `memory` that applies to the same target. Do not add generic prose.

## Missing required description (`missing_required_description`)

Cause: a function has `RequiresDescription`, or declares `description required`, but does not include a non-empty description.

```text
error: missing required description

fn Gateway.derivePolicyDecision has shape RequiresDescription.
RequiresDescription requires a description.
```

Add a compact `description required "..."` and the matching `DescriptionRationale`.

## Invalid context target (`invalid_context_target`)

Cause: a `rationale` or `memory` points at a function, component, resource, implementation, or rule that does not exist in the loaded model.

```text
error: invalid context target

memory DecisionRefactorConstraint applies to fn Gateway.missingFn,
but that target is not declared.
```

Fix the target name, or add the missing target declaration before relying on the context.

## Context target mismatch (`context_target_mismatch`)

Cause: the context type target and `applies_to` target disagree.

```text
error: context target mismatch

rationale DerivePolicyDecisionInline declares fn Gateway.derivePolicyDecision,
but applies_to references fn Gateway.otherDecision.
```

Make the type target and `applies_to` target identical.

## Guarded shape changed (`guarded_shape_changed`)

Cause: a `modify`/`remove` change touched a function, component, resource, or relation protected by `guards on_change require ReEvaluation<Self>`, but no valid reevaluation satisfies that memory or rationale.

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DecisionRefactorConstraint.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DecisionRefactorConstraint
  or preserve the protected shape.
```

When the guard protects only detectable properties (a named shape trait, or the `description`), the diagnostic fires solely on removal of that property and names it, for example `This change removes shape trait PreserveInline from the guarded target.` A `guards forbid transform` guard fires when a `modify fn` declares the matching `transform` intent, reporting `This change applies the ExtractHelper transform to the guarded target.` Guards that protect a free-form label keep coarse matching and fire on any change to the target.

Add a `reevaluation` with review evidence, or avoid changing the protected shape.

## Invalid reevaluation (`invalid_reevaluation`)

Cause: a `reevaluation` is incomplete or satisfies a memory/rationale that does not exist.

```text
error: invalid reevaluation

reevaluation DecisionShapeRechecked is invalid: <reason>.
```

A valid reevaluation needs a known `satisfies` target plus `outcome`, `summary`, `evidence`, `reviewer`, and `decided_on`. When an approver `policy` is declared and the reevaluation satisfies a `sensitive` memory, an `approver` is also required (`missing approver required by policy`). When any `role` is declared, the `reviewer` and `approver` must name a declared role, otherwise the reason is `unknown reviewer role X` / `unknown approver role X`.

## Stale design memory (`stale_memory`)

Cause: a `memory` or `rationale` has a `review_by` date strictly before the freshness date, and freshness checking is enabled. This diagnostic is only emitted under `shp check --as-of YYYY-MM-DD` or `shp check --strict-freshness` (a failure), or listed by `shp obligations` with the same flags. By default `review_by` is informational and never produces this diagnostic.

```text
error: stale design memory

memory DecisionRefactorConstraint protects fn Gateway.derivePolicyDecision.
Its review_by date 2026-01-01 is before 2026-05-30.

Required:
  review the design memory and update review_by, or replace it with a reevaluation.
```

Only ISO `YYYY-MM-DD` `review_by` values are enforced; missing or non-ISO values are ignored. The checker compares against a caller-provided date. `--strict-freshness` is CLI shorthand that supplies today's UTC date; prefer explicit `--as-of` for deterministic CI.

## Invalid relation (`invalid_relation`)

Cause: a `relation` declaration is malformed. Reasons reported by the checker include `missing kind`, `missing connects`, `connects requires at least two endpoints`, `duplicate kind`/`connects`/`roles`/`summary`, `duplicate endpoint X`, `kind K requires exactly two endpoints` (for binary prelude kinds), `kind K requires ordered connects (A -> B)` (for directional binary kinds), `kind K requires ordered connects (A -> B -> ...)` (for `coordinated_call`), ambiguous endpoints that resolve to both a component and a resource, invalid `provides` endpoint kinds, `role NAME is not a connects endpoint`, and `duplicate role for NAME`.

```text
error: invalid relation

relation GatewayCallsAudit is invalid: kind calls requires exactly two endpoints.
```

Fix the offending relation block. Each prelude kind constrains arity and connects shape: `calls`, `callbacks`, and `provides` are binary and directional; `provides` must be `component -> resource`; `coordinated_call` is an ordered path of two or more endpoints; user-defined kinds accept any arity but are excluded from hypercycle detection.

## Invalid require_context (`invalid_require_context`)

Cause: a trait's `require_context ContextType<T>` member names a type parameter `T` that the trait does not declare, or whose bound is not `Fn`, `Component`, or `Resource`. The obligation is rejected so a typo cannot silently fail to attach.

```text
error: invalid require_context

trait ComponentBoundary require_context BoundaryReason<X> is invalid: type parameter X is not declared by the trait.
```

Reference the trait's declared type parameter and give it a supported bound (`Fn`, `Component`, or `Resource`), or leave it unbound to target functions.

## Parse error (`parse`)

Cause: the Langium parser rejected the source. The message includes file, line, and column when available.

```text
error: parse error

path/to/file.shape:3:5 Expecting token of type...
```

## Design memory does not waive final forbids

If a function emits an effect rejected by a final forbid, adding `rationale`, `memory`, or `reevaluation` does not make the model pass. Fix the effect claim or the architecture policy directly. This is product behavior across diagnostics, not a separate diagnostic kind.
