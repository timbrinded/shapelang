---
title: Diagnostics
description: Every diagnostic that shp prints, with its kind code, the command that emits it, real output, cause, and fix.
---

This page lists every diagnostic the checker emits: one parse diagnostic and 26 semantic ones. Each entry is headed by the exact first line that `shp` prints, so pasting that line into page search finds its entry. Where the title varies, the heading uses a placeholder such as `<kind>`, and the entry lists every printed value.

In the index, `check` stands for every command that runs the semantic checks: `shp check`, `shp coverage`, and the language server (`shp lsp`). `shp obligations` also lists five of them without failing: `missing required context`, `missing required description`, `guarded shape changed`, `invalid reevaluation`, and `stale design memory`.

| Printed title | Kind | Emitted by | Group |
| --- | --- | --- | --- |
| [`error: parse error`](#error-parse-error) | `parse` | `shp check`, `coverage`, `explain`, `graph`, `memory`, `obligations`, `inspect`, and `analyze --shape-files` | [Parse and names](#parse-and-names) |
| [`error: unknown <kind>`](#error-unknown-kind) | `unknown_name` | `check` | [Parse and names](#parse-and-names) |
| [`error: ambiguous <kind>`](#error-ambiguous-kind) | `ambiguous_name` | `check` | [Parse and names](#parse-and-names) |
| [`error: duplicate <kind>`](#error-duplicate-kind) | `duplicate_declaration` | `check` | [Parse and names](#parse-and-names) |
| [`error: invalid implementation`](#error-invalid-implementation) | `invalid_implementation` | `check` | [Parse and names](#parse-and-names) |
| [`error: forbidden effect`](#error-forbidden-effect) | `final_forbidden_effect` | `check` | [Effects and grants](#effects-and-grants) |
| [`error: missing grant`](#error-missing-grant) | `missing_grant` | `check` | [Effects and grants](#effects-and-grants) |
| [`error: unknown effects`](#error-unknown-effects) | `unknown_effects` | `check`; a warning under `--allow-unknown-effects` | [Effects and grants](#effects-and-grants) |
| [`error: unsafe effects missing policy metadata`](#error-unsafe-effects-missing-policy-metadata) | `unsafe_effects` | `check` | [Effects and grants](#effects-and-grants) |
| [`error: invalid relation`](#error-invalid-relation) | `invalid_relation` | `check` | [Relations and rules](#relations-and-rules) |
| [`error: invalid rule`](#error-invalid-rule) | `invalid_rule` | `check` | [Relations and rules](#relations-and-rules) |
| [`error: forbidden path`](#error-forbidden-path) | `forbidden_path` | `check` | [Relations and rules](#relations-and-rules) |
| [`error: forbidden hypercycle`](#error-forbidden-hypercycle) | `forbidden_hypercycle` | `check` | [Relations and rules](#relations-and-rules) |
| [`error: forbidden provides`](#error-forbidden-provides) | `forbidden_provides` | `check` | [Relations and rules](#relations-and-rules) |
| [`error: duplicate fingerprint`](#error-duplicate-fingerprint) | `duplicate_fingerprint` | `check` | [Fingerprints and AST candidates](#fingerprints-and-ast-candidates) |
| [`error: stale fingerprint expectation`](#error-stale-fingerprint-expectation) | `fingerprint_mismatch` | `check` | [Fingerprints and AST candidates](#fingerprints-and-ast-candidates) |
| [`error: stale candidate effect pin`](#error-stale-candidate-effect-pin) | `candidate_pin_fingerprint_mismatch` | `check` | [Fingerprints and AST candidates](#fingerprints-and-ast-candidates) |
| [`error: invalid candidate effect`](#error-invalid-candidate-effect) | `invalid_candidate_effect` | `check` | [Fingerprints and AST candidates](#fingerprints-and-ast-candidates) |
| [`error: governed source changed without current Shape update`](#error-governed-source-changed-without-current-shape-update) | `missing_shape_update` | `shp check --changed-files`, `shp coverage` | [Change sets](#change-sets) |
| [`error: bound docs change missing`](#error-bound-docs-change-missing) | `missing_bound_docs_change` | `shp check --changed-files` | [Change sets](#change-sets) |
| [`error: missing required context`](#error-missing-required-context) | `missing_required_context` | `check` | [Design memory](#design-memory) |
| [`error: missing required description`](#error-missing-required-description) | `missing_required_description` | `check` | [Design memory](#design-memory) |
| [`error: invalid context target`](#error-invalid-context-target) | `invalid_context_target` | `check` | [Design memory](#design-memory) |
| [`error: context target mismatch`](#error-context-target-mismatch) | `context_target_mismatch` | `check` | [Design memory](#design-memory) |
| [`error: invalid require_context`](#error-invalid-require_context) | `invalid_require_context` | `check` | [Design memory](#design-memory) |
| [`error: guarded shape changed`](#error-guarded-shape-changed) | `guarded_shape_changed` | `check` | [Design memory](#design-memory) |
| [`error: invalid reevaluation`](#error-invalid-reevaluation) | `invalid_reevaluation` | `check` | [Design memory](#design-memory) |
| [`error: stale design memory`](#error-stale-design-memory) | `stale_memory` | `shp check --as-of` or `--strict-freshness` | [Design memory](#design-memory) |

## Reading a diagnostic

Diagnostics judge the declared Shape model. They describe claims in `.shape` files, not the application source that `source` and `evidence` name, which the checker never opens.

Every semantic diagnostic has the same layout. This model grants `HardDelete<AuditEvent>` and still fails, because a final forbid on the resource's trait wins over any grant:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>

  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }

  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

`shp check audit.shape` prints this to stderr and exits `1`:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")

caused by:
  - audit.shape: effect AuditStore.purgeOldEvents emits HardDelete<AuditEvent>
  - audit.shape: resource AuditEvent : AppendOnly
  - standard prelude: trait AppendOnly forbids final HardDelete<T>
```

1. **Title.** The first line is the severity, `error:` or `warning:`, followed by a title that names the kind of claim that failed.
2. **Body.** The lines after the blank line state the chain of claims in the model's own terms: the function emits the effect, the resource has the trait, and the trait forbids that effect finally. Some bodies end with a `Required:` line or block that names what would satisfy the check.
3. **`evidence:`** Only `forbidden effect` prints this line, and only when the failing effect entry declares an `evidence` reference. The reference is copied verbatim.
4. **`caused by:`** The declarations that produced the diagnostic, one per line, as `FILE: DECLARATION`. `FILE` is the path as it was passed to `shp` or discovered, or `standard prelude` for a built-in declaration such as the prelude `AppendOnly`. Declaration labels omit module qualifiers. Every semantic diagnostic ends with this block; parse errors do not have one.

The graph rules use the same layout with a different body: the rule, one line per relation in the witness, and a `witness:` line with the vertex path. Each rule clause reports one shortest witness, so fixing it can reveal the next; see [Relations and Graph Rules](/shapelang/concepts/relations/).

**Names.** Most bodies print local names. A few print a raw, module-qualified name, and the outputs on this page show exactly where: the relation in `invalid relation`, the reevaluation in `invalid reevaluation`, the candidate in `invalid candidate effect`, the context in `context target mismatch`, the binding in `bound docs change missing`, the implementation in `governed source changed without current Shape update`, and the `matches:` list in `ambiguous <kind>`. `forbidden path` qualifies only the names that collide across modules.

**Order.** Semantic diagnostics are sorted by kind code, then by rendered text in codepoint order, and separated by a blank line, so the order of declarations and files never decides the order of the output.

**Parse errors.** When any file fails to parse or cannot be read, `shp check` reports only the parse errors and exits `2` without running a semantic check. Parse errors are not sorted; they appear in input-file order.

**Streams.** Failing output goes to stderr with exit `1`. When the only diagnostics are `warning: unknown effects` under `--allow-unknown-effects`, they go to stdout, followed by `Shape check passed with warnings.`, with exit `0`. The full exit-code contract is in [CLI Reference](/shapelang/reference/cli/#exit-codes).

`shp analyze` warnings and `shp author` critic advisories are not checker diagnostics. They are advisory hints from separate tools and are not listed here; see [Analyzer Hints](/shapelang/guides/analyzer/) and [Author Updates with an Agent](/shapelang/guides/authoring/).

## Parse and names

### `error: parse error`

Kind `parse` · emitted by `shp check`, `coverage`, `explain`, `graph`, `memory`, `obligations`, `inspect`, and `analyze --shape-files` · exit `2`

```text
error: parse error

audit.shape:10:5: Expecting token of type '}' but found `effects`.
```

**Cause.** The parser rejected the file, here because a function declares a second `effects` block. The location is `FILE:LINE:COLUMN:`, or `FILE:` alone when no position is known. A file that cannot be read produces the same title with the read error, for example `missing.shape: ENOENT: no such file or directory, open 'missing.shape'`. One diagnostic is printed per problem, and no semantic check runs.

Three other tools report the same parser problem in their own form:

- `shp fmt` prints ``audit.shape: Expecting token of type '}' but found `effects`.`` and exits `1`.
- `shp author --critic-prompt` prints ``error: failed to parse audit.shape:10:5: Expecting token of type '}' but found `effects`.`` and exits `2`.
- The language server publishes only the message, at the reported position.

**Fix.** Correct the syntax at the reported position. Every declaration form and the reserved keywords are listed in [Language Syntax](/shapelang/reference/language-syntax/).

### `error: unknown <kind>`

Kind `unknown_name` · emitted by `check`

```text
error: unknown relation_endpoint

relation_endpoint GhostService is referenced but not declared.

caused by:
  - gateway.shape: relation GatewayCallsGhost
```

**Cause.** A reference names nothing of the expected kind in the loaded Shape model. The printed title depends on where the reference appears:

| Printed title | Reference |
| --- | --- |
| `error: unknown resource` | `owns`; the target of an effect in `effects complete`; a concrete target in a trait or rule `forbid`; a `forbid provides` target; an `effect candidate` effect target or `pin` resource |
| `error: unknown component` | `conforms_to`; `forbid provides … except`; the `fn` of an `effect candidate`; the component of an `add fn` or `modify fn` entry in a `change` block |
| `error: unknown trait` | a trait on a resource, component, or function; the trait in a rule's `when … has` |
| `error: unknown relation_endpoint` | a relation endpoint that is neither a component nor a resource; a `forbid path` endpoint |

An `effect candidate` whose `fn` names an undeclared function is reported as `unknown component` with the function as the name, for example `component AuditStore.missing is referenced but not declared.` A candidate with no `fn` member is reported as `component NAME function is referenced but not declared.`, next to `invalid candidate effect`. Not every reference is name-checked: `grants` targets, function `requires` terms, and the component of a `remove fn` entry can name undeclared declarations without a diagnostic.

**Fix.** Declare the missing name, correct the spelling, add the `import` for its module, or qualify the reference as `module::Name`.

### `error: ambiguous <kind>`

Kind `ambiguous_name` · emitted by `check`

This output comes from three files: `audit.shape` and `billing.shape` each declare `component Store`, and `app.shape` imports both modules and writes `conforms_to Store`.

```text
error: ambiguous component

component Store matches more than one imported declaration.
Use a module-qualified reference.
matches: audit::Store, billing::Store

caused by:
  - app.shape: component reference Store

error: unknown component

component Store is referenced but not declared.

caused by:
  - app.shape: implementation StoreImpl
```

**Cause.** An unqualified name is not declared in the referencing module and matches declarations in more than one imported module. A declaration in the referencing module always wins over imports, so it never causes this diagnostic. `<kind>` is the kind the reference expects: `resource`, `component`, `trait`, or `relation_endpoint` for most references, and `relation`, `implementation`, `binding`, `rule`, `rationale`, or `memory` for a context target, a `satisfies`, or a `change` entry that names one. The ambiguous reference resolves to nothing, so an `unknown <kind>` for the same name usually follows, as above.

**Fix.** Qualify the reference, as in `conforms_to audit::Store`, or remove one of the imports.

### `error: duplicate <kind>`

Kind `duplicate_declaration` · emitted by `check`

```text
error: duplicate component

component AuditStore is declared more than once.

caused by:
  - audit.shape: component AuditStore
  - audit.shape: component AuditStore
```

**Cause.** One module declares the same name twice for one kind. `<kind>` is `resource`, `trait`, `component`, `relation`, `candidate_effect`, `binding`, `rationale`, `memory`, or `reevaluation`. The first declaration, in file order and then declaration order, is kept and the later one is ignored, so diagnostics that only the later one would cause do not appear. Equal names in different modules are not duplicates, and a trait with a prelude trait's name shadows the prelude trait instead. Duplicate `implementation`, `rule`, and `attest` declarations are not reported, and a second `fn` with the same name in one component silently replaces the first.

**Fix.** Remove or rename one declaration.

### `error: invalid implementation`

Kind `invalid_implementation` · emitted by `check`

```text
error: invalid implementation

implementation AuditStoreImpl is invalid: on_change require shape_delta is not a supported requirement; expected shape_update.

caused by:
  - audit.shape: implementation AuditStoreImpl on_change require shape_delta
```

**Cause.** An `implementation` declares an `on_change require` value other than `shape_update`, the only supported requirement. Coverage acts only on `shape_update`, so an unknown value, such as a typo or the pre-rename spelling `shape_delta`, would otherwise leave the implementation's paths silently ungoverned.

**Fix.** Replace the value with `shape_update`, or remove the `on_change` member if the paths should be mapped to a component without a coverage obligation.

## Effects and grants

How effects, traits, and grants interact is explained in [Effect Model](/shapelang/concepts/effect-model/).

### `error: forbidden effect`

Kind `final_forbidden_effect` · emitted by `check`

The annotated output under [Reading a diagnostic](#reading-a-diagnostic) is this diagnostic.

**Cause.** A function's effect entry targets a resource, and a trait of that resource, or a `rule` that matches it, declares `forbid final` for that effect. This check runs before the grant check, so a matching `grants` does not help, and no `missing grant` is reported for the entry. For a rule-derived forbid, the trait line names the rule's first `when` trait. An effect without a `<Resource>` target is never checked.

**Fix.** Remove the effect, move the behaviour to a resource without the trait, or change the resource's traits or the forbidding trait or rule. Nothing waives a final forbid: grants, rationale, memory, reevaluations, attestations, and imports cannot.

### `error: missing grant`

Kind `missing_grant` · emitted by `check`

```text
error: missing grant

AuditStore.appendEvent emits Append<AuditEvent>.
AuditStore does not grant Append<AuditEvent>.

caused by:
  - audit.shape: effect AuditStore.appendEvent emits Append<AuditEvent>
  - audit.shape: component AuditStore
```

**Cause.** A function's effect entry has a `<Resource>` target, no final forbid matches it, and the function's component has no `grants` with the same effect name and target. `owns` does not imply any grant.

**Fix.** Add `grants Append<AuditEvent>` to the component only if the component may perform that effect; otherwise remove the effect or move the function.

### `error: unknown effects`

Kind `unknown_effects` · emitted by `check`; printed as `warning: unknown effects` under `shp check --allow-unknown-effects`

```text
error: unknown effects

AuditStore.appendEvent declares effects unknown.

caused by:
  - audit.shape: fn AuditStore.appendEvent
```

**Cause.** A function in an authored module declares `effects unknown`. Strict checking always rejects it; no declaration in the model allows it. Functions in generated AST modules are exempt entirely: the module name must be `shape.generated.ast` or start with `shape.generated.ast.`, and the file must be under `shape/generated/ast/`.

**Fix.** Replace the placeholder with a reviewed `effects complete { … }` summary. While drafting, [`--allow-unknown-effects`](/shapelang/reference/cli/#draft-validation) turns the error into a warning. The exemption is described in [Generate Drafts from Source](/shapelang/guides/ast-drafts/).

### `error: unsafe effects missing policy metadata`

Kind `unsafe_effects` · emitted by `check`

```text
error: unsafe effects missing policy metadata

AuditStore.importLegacyEvents declares unsafe effects.
Missing: expires, required capability.

caused by:
  - audit.shape: fn AuditStore.importLegacyEvents
```

**Cause.** A function marked `unsafe` lacks at least one of `reason "…"`, `expires "…"`, and a `requires Capability` term. `Missing:` lists the absent items in the order `reason`, `expires`, `required capability`. The values are not interpreted.

**Fix.** Add the missing members after the function's effects block, as shown under [`fn` in Language Syntax](/shapelang/reference/language-syntax/#fn).

## Relations and rules

Relation kinds, traversal, and witness selection are explained in [Relations and Graph Rules](/shapelang/concepts/relations/).

### `error: invalid relation`

Kind `invalid_relation` · emitted by `check`

```text
error: invalid relation

relation gateway::GatewayCallsAudit is invalid: kind calls requires exactly two endpoints.

caused by:
  - gateway.shape: relation GatewayCallsAudit
```

**Cause.** A `relation` declaration is malformed. These reasons drop the relation from the hypergraph:

- `missing kind`
- `missing connects`
- `duplicate endpoint X`
- `kind K requires exactly two endpoints`, for `calls`, `callbacks`, and `provides`
- `kind K requires ordered connects (A -> B)`, for `calls`, `callbacks`, and `provides` written with `{ … }`
- `kind K requires ordered connects (A -> B -> ...)`, for `coordinated_call` written with `{ … }`

These reasons keep the relation, ignoring the offending member where there is one:

- `duplicate kind`, `duplicate connects`, `duplicate roles`, `duplicate summary`
- `role X is not a connects endpoint`, `duplicate role for X`
- `endpoint X resolves to both a component and a resource`
- `provides provider X must be a component`, `provides target X must be a resource`
- `fingerprint expectation X is not a connects endpoint`
- `fingerprint expectation endpoint X must be a resource`
- `fingerprint expectation endpoint X resolves to both a component and a resource`

**Fix.** Correct the named member. Custom kinds accept any arity and either `connects` form.

### `error: invalid rule`

Kind `invalid_rule` · emitted by `check`

```text
error: invalid rule

rule no_multi_subject_delete is invalid: final effect forbids may bind only one subject, but found T, U.

caused by:
  - rules.shape: rule no_multi_subject_delete
```

**Cause.** A `rule` cannot perform the check it declares. The reasons are:

- `final effect forbids require exactly one when subject`: the rule has a `forbid final` but no `when`.
- `final effect forbids may bind only one subject, but found T, U`: its `when` clauses name different subjects. Repeated clauses with one subject are a conjunction and are valid.
- `rule condition trait X declares N type parameters; expected no type parameters or exactly one Resource-bound parameter`
- `rule condition trait X type parameter T is unbound; expected Resource`
- `rule condition trait X type parameter T has incompatible bound B; expected Resource`
- `forbidden path endpoints must be distinct; use forbid hypercycle for cycles`
- `relation kind K has no directed traversal semantics`, or `relation kinds K, L have no directed traversal semantics`: a `forbid path` lists a kind other than `calls`, `callbacks`, `provides`, or `coordinated_call`.
- `path endpoint X resolves to both a component and a resource`

Only the offending part of an invalid rule is inert: an invalid final-forbid rule derives no forbid, and an invalid `forbid path` clause is not evaluated.

**Fix.** Bind one subject, give a condition trait no type parameter or one `Resource`-bound parameter, use `forbid hypercycle` for cycles, and list only traversable kinds in `forbid path`.

### `error: forbidden path`

Kind `forbidden_path` · emitted by `check`

```text
error: forbidden path

rule no_gateway_to_secrets rejects this dependency path:
  calls GatewayCallsPolicy: Gateway -> PolicyService
  provides PolicyProvidesSecret: PolicyService -> SecretStore
witness: Gateway -> PolicyService -> SecretStore

caused by:
  - gateway.shape: rule no_gateway_to_secrets forbids path Gateway -> SecretStore over calls or provides
  - gateway.shape: relation GatewayCallsPolicy
  - gateway.shape: relation PolicyProvidesSecret
```

**Cause.** A `forbid path SOURCE -> TARGET over KIND …` clause found a directed path from `SOURCE` to `TARGET` whose every step uses a listed kind. Each step line reads `KIND RELATION: FROM -> TO`. The clause reports its one fewest-step witness. Relations with an unresolved or ambiguous endpoint, and `provides` relations with invalid endpoint kinds, contribute no steps.

**Fix.** Remove or redirect a relation on the witness, narrow the rule's kind list, or revise the rule.

### `error: forbidden hypercycle`

Kind `forbidden_hypercycle` · emitted by `check`

```text
error: forbidden hypercycle

rule no_runtime_cycle rejects this hypercycle:
  callbacks AuditCallsGateway
  calls GatewayCallsAudit
witness: AuditStore -> Gateway -> AuditStore

caused by:
  - gateway.shape: rule no_runtime_cycle forbids hypercycle over calls or callbacks
  - gateway.shape: relation AuditCallsGateway
  - gateway.shape: relation GatewayCallsAudit
```

**Cause.** A `forbid hypercycle` clause found a directed cycle among relations of the listed kinds, or of every kind when `over` is omitted. The relation lines follow the witness walk, which starts at the codepoint-smallest vertex, and the `witness:` line ends where it began. Each clause reports its one shortest cycle. Custom kinds contribute no steps, so `over` with only custom kinds is accepted but never matches.

**Fix.** Remove or redirect one relation in the cycle, or narrow the rule's kind list.

### `error: forbidden provides`

Kind `forbidden_provides` · emitted by `check`

```text
error: forbidden provides

Sidecar provides JsonRpcEndpoint via relation SidecarProvidesRpc.
rule GatewayBoundary forbids provides JsonRpcEndpoint except Gateway.

caused by:
  - gateway.shape: relation SidecarProvidesRpc
  - gateway.shape: rule GatewayBoundary forbids provides JsonRpcEndpoint
```

**Cause.** A `forbid provides RESOURCE except COMPONENT` clause found a `provides` relation that supplies `RESOURCE` from a provider other than `COMPONENT`. `except` is optional; without it, every provider is rejected and the second line reads, for example, `rule NoSecretProviders forbids provides SecretStore.` One diagnostic is emitted per offending relation.

**Fix.** Move the `provides` relation onto the allowed component, or change the rule.

## Fingerprints and AST candidates

Fingerprints and candidate effects come from generated AST drafts; see [Generate Drafts from Source](/shapelang/guides/ast-drafts/).

### `error: duplicate fingerprint`

Kind `duplicate_fingerprint` · emitted by `check`

```text
error: duplicate fingerprint

resource AuditStoreAstAnchor declares fingerprint provider ast.semantic_subtree_v1 more than once.

caused by:
  - audit.shape: resource AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1
  - audit.shape: resource AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1
```

**Cause.** One resource declares two `fingerprint` members with the same provider. The first is used and the later one is ignored.

**Fix.** Keep one fingerprint per provider.

### `error: stale fingerprint expectation`

Kind `fingerprint_mismatch` · emitted by `check`

```text
error: stale fingerprint expectation

relation ReviewedFromAst expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1.
expected: sha256:aaaa
actual: sha256:bbbb

caused by:
  - audit.shape: relation ReviewedFromAst expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1
  - audit.shape: resource AuditStoreAstAnchor
  - audit.shape: resource AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1
```

**Cause.** A relation's `expects ENDPOINT fingerprint PROVIDER("VALUE")` names a resource endpoint whose fingerprint for that provider differs, or is absent, which prints `actual: missing`. An `expects` endpoint that is not one of the relation's `connects` endpoints, or is not a resource, is reported as `invalid relation` instead.

**Fix.** Regenerate the AST drafts, review the changed code the anchor points at, then update the pinned value or revise the claim that depends on it.

### `error: stale candidate effect pin`

Kind `candidate_pin_fingerprint_mismatch` · emitted by `check`

```text
error: stale candidate effect pin

candidate effect AppendEventCandidate pins AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1.
expected: sha256:aaaa
actual: sha256:bbbb

caused by:
  - audit.shape: effect candidate AppendEventCandidate
  - audit.shape: resource AuditStoreAppendEventAstAnchor
  - audit.shape: resource AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1
```

**Cause.** An `effect candidate`'s `pin RESOURCE fingerprint PROVIDER("VALUE")` no longer matches that resource's fingerprint, or the resource has none (`actual: missing`). A pin resource that is not declared is reported as `unknown resource` instead.

**Fix.** Regenerate the AST drafts so the candidate and its anchor agree.

### `error: invalid candidate effect`

Kind `invalid_candidate_effect` · emitted by `check`

```text
error: invalid candidate effect

candidate effect audit::AppendEventCandidate: missing pin.

caused by:
  - audit.shape: effect candidate AppendEventCandidate
```

**Cause.** Each `effect candidate` needs exactly one each of `fn`, `effect`, `source`, `confidence`, and `pin`. The reason is `missing FIELD` or `duplicate FIELD`, with one diagnostic per problem.

**Fix.** Supply each member once, or regenerate the draft.

## Change sets

These diagnostics need a changed-file list. What counts as a current update, attestation, or bound change is defined in [Keep the Model Current](/shapelang/guides/keep-model-current/).

### `error: governed source changed without current Shape update`

Kind `missing_shape_update` · emitted by `shp check --changed-files` and `shp coverage`

```text
error: governed source changed without current Shape update

Changed file: src/audit/purge.ts
Governed by: audit::AuditStoreImpl
Matched path: src/audit/**/*.ts
Required: update a current .shape file with matching source/evidence, or add a no_shape_change attestation.

caused by:
  - shape/audit.shape: implementation AuditStoreImpl
  - shape/audit.shape: implementation AuditStoreImpl path src/audit/**/*.ts
```

**Cause.** A changed path that does not end in `.shape` matches a `paths` glob of an `implementation` with `on_change require shape_update`, and nothing current covers it. `Matched path:` is the first matching glob. The path counts as covered only when a `.shape` file that is itself in the changed-file list contains either:

- a function `source`, or an effect `evidence`, naming exactly that path, ignoring any `#anchor` and `:line` or `:line-line` suffix, in a module that is not generated AST; or
- `attest no_shape_change` whose `source` names exactly that path and whose `reason` is not empty.

**Fix.** Update the claim for that path in a `.shape` file included in the change, or, when the architecture did not change, add a narrow `attest no_shape_change` for it.

### `error: bound docs change missing`

Kind `missing_bound_docs_change` · emitted by `shp check --changed-files` only

```text
error: bound docs change missing

binding repo::CheckerDocs was triggered by packages/shp-checker/src/checker/rules.ts.
Required: change one of docs-site/src/content/docs/reference/diagnostics.md, or add attest docs_not_needed.

caused by:
  - shape/repo.shape: binding CheckerDocs
  - shape/repo.shape: binding CheckerDocs when_changed packages/shp-checker/src/checker/**/*.ts
```

**Cause.** A changed path matches a `when_changed` glob of a `binding`, no changed path matches any of its `require_changed` globs, and the triggering path has no current attestation of a kind the binding lists in `allow attest`. One diagnostic is emitted per triggering path. Without `allow attest`, the `Required:` line ends after the path list; with several kinds, they are joined with `or`.

**Fix.** Change one of the required paths in the same change set, or add an attestation of an allowed kind whose `source` is the triggering path, with a non-empty `reason`, in a `.shape` file that is also in the change.

## Design memory

Shape traits, rationale, memory, guards, and reevaluations are explained in [Design Memory](/shapelang/concepts/design-memory/).

### `error: missing required context`

Kind `missing_required_context` · emitted by `check`

```text
error: missing required context

fn Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.

No matching rationale or memory found.

caused by:
  - gateway.shape: fn Gateway.derivePolicyDecision : PreserveInline
  - standard prelude: PreserveInline requires InlineRationale
```

**Cause.** A function, component, or resource carries a shape trait whose context obligation is unmet. The obligation is met only by a context of the named type, of a kind the trait accepts, whose type target equals the target and whose `applies_to`, when present, equals it too. Each prelude trait fixes the accepted kinds; for example, `PreserveInline` accepts only a `rationale` and `RefactorSensitive` only a `memory`. A trait that declares its own `require_context` produces the same diagnostic, and its `caused by:` names that trait instead of the standard prelude.

**Fix.** Add a `rationale` or `memory` of the named context type, of an accepted kind, for the same target.

### `error: missing required description`

Kind `missing_required_description` · emitted by `check`

```text
error: missing required description

fn Gateway.derivePolicyDecision has shape RequiresDescription.
RequiresDescription requires a description.

caused by:
  - gateway.shape: fn Gateway.derivePolicyDecision : RequiresDescription
  - standard prelude: RequiresDescription requires description
```

**Cause.** A function has the `RequiresDescription` trait but no non-empty `description`, or declares `description required ""` with an empty string. The second form prints `fn Gateway.summarise has shape description required.` `RequiresDescription` also requires a `DescriptionRationale`, which is reported separately as `missing required context`.

**Fix.** Give the function a non-empty `description "…"`.

### `error: invalid context target`

Kind `invalid_context_target` · emitted by `check`

```text
error: invalid context target

memory DecisionRefactorConstraint applies to fn Gateway.missingFn,
but that target is not declared.

caused by:
  - gateway.shape: memory DecisionRefactorConstraint
```

**Cause.** The target in a `rationale` or `memory` type, or its `applies_to` target, does not exist. A target is `fn`, `component`, `resource`, `implementation`, `rule`, or `relation`. A `change` block that removes the target also produces this diagnostic for every context still attached to it.

**Fix.** Correct the target, declare it, or remove the context.

### `error: context target mismatch`

Kind `context_target_mismatch` · emitted by `check`

```text
error: context target mismatch

rationale gateway::DerivePolicyDecisionInline declares fn Gateway.derivePolicyDecision,
but applies_to references fn Gateway.otherDecision.

caused by:
  - gateway.shape: rationale DerivePolicyDecisionInline
```

**Cause.** The target in the context type and the `applies_to` target differ. Such a context satisfies no obligation, so a `missing required context` for the intended target can accompany this diagnostic.

**Fix.** Make both targets identical, or drop `applies_to`.

### `error: invalid require_context`

Kind `invalid_require_context` · emitted by `check`

```text
error: invalid require_context

trait ComponentBoundary require_context BoundaryReason<X> is invalid: type parameter X is not declared by the trait.

caused by:
  - gateway.shape: trait ComponentBoundary require_context BoundaryReason<X>
```

**Cause.** A trait's `require_context TYPE<T>` names a type parameter the trait does not declare, or one whose bound is not `Fn`, `Function`, `Component`, or `Resource`. The second reason reads `type parameter T has unsupported bound B (expected Fn, Component, or Resource)`. The obligation is dropped rather than silently attached to the wrong target.

**Fix.** Name a declared type parameter and bound it with `Fn`, `Component`, or `Resource`, or leave it unbound to target functions.

### `error: guarded shape changed`

Kind `guarded_shape_changed` · emitted by `check`

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DecisionRefactorConstraint.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DecisionRefactorConstraint
  or preserve the protected shape.

caused by:
  - gateway.shape: change RefactorDecision modify fn Gateway.derivePolicyDecision
  - gateway.shape: memory DecisionRefactorConstraint guards on_change require ReEvaluation<Self>
```

**Cause.** A `modify` or `remove` entry in a `change` block targets a function, component, resource, or relation that a `rationale` or `memory` guards, and no valid `reevaluation` satisfies that context. Editing a declaration in place produces no change event and never triggers this diagnostic. The second line says which guard fired:

- `This change modifies the guarded target.` for `on_change require ReEvaluation<Self>` when the context has no `protects` entries or any entry is not detectable;
- `This change removes shape trait X from the guarded target.` or `This change removes description from the guarded target.` when every `protects` entry is detectable and the change removes one;
- `This change applies the L transform to the guarded target.` for `forbid transform L` when a `modify fn` declares `transform L`.

**Fix.** Add a valid `reevaluation` that satisfies the named context, or keep the protected shape. An attestation never satisfies a guard.

### `error: invalid reevaluation`

Kind `invalid_reevaluation` · emitted by `check`

```text
error: invalid reevaluation

reevaluation gateway::DecisionShapeRechecked is invalid: missing evidence.

caused by:
  - gateway.shape: reevaluation DecisionShapeRechecked
```

**Cause.** A `reevaluation` is incomplete. Each reason is its own diagnostic:

- `missing satisfies`, or `unknown satisfied memory` / `unknown satisfied rationale` when the named context does not exist;
- `missing outcome`, `missing summary` (absent or blank), `missing evidence`, `missing reviewer`, `missing decided_on`;
- `missing approver required by policy`, when a `policy { require approver }` exists and the satisfied memory is `sensitive`;
- `unknown reviewer role X`, `unknown approver role X`, once any `role` is declared.

An invalid reevaluation satisfies no guard.

**Fix.** Supply the missing members, declare the role, or correct the `satisfies` name.

### `error: stale design memory`

Kind `stale_memory` · emitted by `shp check --as-of` or `--strict-freshness`; listed by `shp obligations` with the same flags

```text
error: stale design memory

memory DecisionRefactorConstraint protects fn Gateway.derivePolicyDecision.
Its review_by date 2026-01-01 is before 2026-05-30.

Required:
  review the design memory and update review_by, or replace it with a reevaluation.

caused by:
  - gateway.shape: memory DecisionRefactorConstraint
```

**Cause.** Freshness checking is on and a `rationale` or `memory` has a valid ISO `review_by` date strictly before the reference date. Without the freshness flags this diagnostic never appears; the flags are described in [CLI Reference](/shapelang/reference/cli/#freshness).

**Fix.** Review the entry and move its `review_by` forward, or remove the date. A `reevaluation` that satisfies the entry does not clear this diagnostic.
