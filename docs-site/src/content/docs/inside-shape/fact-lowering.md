---
title: Fact Lowering
description: How lowerShapeModules turns parsed modules into one Model, what its typed indexes and Fact records hold, the lowering order, and what each kind of declaration lowers to.
---

`lowerShapeModules` in `packages/shp-checker/src/checker/lowerer.ts` turns every parsed `ShapeModule` into one `Model` before any rule runs. Lowering resolves names, applies `change` declarations, and records each claim twice: as typed index entries, which rules read, and as `Fact` records with provenance, which callers can request. Paths on this page are relative to `packages/shp-checker/src/`.

Lowering is global. Any change to any document rebuilds the whole `Model` and fact list, and `IncrementalShapeChecker` reuses a lowered model only while the documents are unchanged. The reuse rules are in [Checker Pipeline](/shapelang/inside-shape/checker-pipeline/#incremental-checking).

## The Model

`Model` in `checker/model.ts` holds the typed indexes, the fact list, and the lowering diagnostics:

| Field | Holds | Read outside lowering by |
| --- | --- | --- |
| `modules` | each module's name, imports, file path, and generated-AST flag | nothing (lowering uses it to re-scope `change` entries) |
| `declarations` | declaration names per kind and module | nothing (name resolution in `checker/symbols.ts` uses it during lowering) |
| `resources` | `ResourceInfo`: traits and fingerprints | `rules/functions.ts`, `rules/names.ts`, `rules/relations.ts`, `derivations.ts`, `query.ts`, `inspection.ts` |
| `traits` | `TraitInfo`: type parameters, forbid patterns, context requirements; seeded with the prelude traits | `rules/names.ts`, `rules/guards.ts`, `derivations.ts` |
| `components` | `ComponentInfo`: classifiers, `owns`, `grants`, and `FunctionInfo` per `fn` | `rules/functions.ts`, `rules/names.ts`, `rules/context.ts`, `rules/relations.ts`, `derivations.ts`, `query.ts`, `inspection.ts` |
| `hypergraph.edges` | one `HyperedgeInfo` per kept `relation` | `rules/names.ts`, `rules/relations.ts`, `derivations.ts`, `query.ts`, `inspection.ts` |
| `hypergraph.incidence` | vertex name to the names of its hyperedges | `query.ts` only: `graphShapeModules` (`shp graph show`) and the relations section of `explainShapeModules` (`shp explain`) |
| `candidateEffects` | `effect candidate` declarations | `rules/names.ts`, `rules/functions.ts` |
| `implementations` | path globs, `conforms_to`, and the `on_change` requirement | `rules/coverage.ts`, `rules/names.ts`, `derivations.ts`, `inspection.ts` |
| `bindings` | `when_changed`, `require_changed`, and `allow attest` entries | `checkBindings`, `inspection.ts` |
| `rules` | `RuleInfo` for each `rule` | `rules/declarations.ts`, `rules/names.ts`, `rules/relations.ts`, `derivations.ts`, `inspection.ts` |
| `rationales`, `memories` | context info with flattened guard blocks | `rules/context.ts` (which also feeds `rules/guards.ts`), `derivations.ts`, `query.ts`; `memories` also `inspection.ts` |
| `reevaluations` | `ReevaluationInfo` | `rules/context.ts`, `derivations.ts` |
| `roles`, `policies` | declared review roles and approver policies | `derivations.ts` (reevaluation validation) |
| `attestations` | kind, normalized path, reason, provenance | `rules/coverage.ts` |
| `shapeUpdatePaths` | normalized source path to the provenance of every ref that names it | `rules/coverage.ts` |
| `changeEvents` | guard events produced by `change` declarations | `rules/guards.ts` |
| `facts` | `Fact[]` | `checkLoweredShapeModel`, only when `includeFacts` is set |
| `diagnostics` | lowering diagnostics | `checkLoweredShapeModel`, which reports them with the rule output |

`facts` is a list of kind-first records. The `Fact` union in `checker/model.ts` is the authoritative list of kinds and fields. Every fact carries `provenance: { filePath?, label }`, and `describeProvenance` in `checker/provenance.ts` renders that provenance for `caused by:` lines, dropping module qualifiers.

**No rule module reads `model.facts`.** Production rules and the `explain`, `graph`, `memory`, `obligations`, and `inspect` helpers read only the typed indexes. The fact list leaves the checker only when a caller sets `includeFacts`; `checkLoweredShapeModel` then returns it sorted by its JSON text. Its consumers are the checker tests, the Datalog spike, and the semantic-kernel harness. Rule Evaluation lists why the facts are [not a complete rule database](/shapelang/inside-shape/rule-evaluation/#why-rules-are-direct-typescript-checks).

## Lowering order

1. `preludeTraitSeed()` in `checker/prelude-seed.ts` fills `model.traits` with the prelude traits: `AppendOnly` with its three final forbids, and the context-obligation traits from `PRELUDE_CONTEXT_REQUIREMENTS` in `prelude.ts`. Then, for every module, `lowerShapeModules` builds the module's lowering context with `moduleContext` and records it in `model.modules`, and `indexModuleDeclarations` records the names of its resources, components, traits, relations, candidate effects, implementations, bindings, rationales, memories, reevaluations, and rules in `model.declarations` (roles, policies, attestations, and `change` declarations are not indexed). Every module is indexed before any declaration is lowered. Name resolution (`resolveDeclReference` in `checker/symbols.ts`) consults this index, so a reference resolves the same way whichever file declares its target.
2. For each module in input order, each non-`change` declaration is lowered in source order by its domain lowerer: `lowerResource`, `lowerTrait`, `lowerComponent` (which calls `lowerFunction` and `emitFunctionFacts` for each `fn`), `lowerRelation`, `lowerCandidateEffect`, `lowerImplementation`, `lowerBinding`, `lowerAttestation`, `lowerRule`, `lowerRationale`, `lowerMemory`, `lowerReevaluation`, `lowerRole`, and `lowerPolicy`. For resources, traits, components, relations, candidate effects, bindings, rationales, memories, and reevaluations, the first declaration of a name wins, and a later duplicate is dropped with a `duplicate_declaration` diagnostic.
3. Each `change` declaration, in the same module and source order, is applied by `lowerChange`. See [Changes](#changes).
4. `rebuildShapeUpdatePaths` (private to `lowerer.ts`) drops every `shape_update_for` fact, then rebuilds `model.shapeUpdatePaths` from the final function registry with `collectShapeUpdatePathsFromFunction`, re-emitting one `shape_update_for` fact per ref.
5. `emitDerivedFacts` in `lowering/facts.ts` emits `trait_final_forbid` and `context_required` facts from the final traits and trait bearers. These are the only derived facts.

## Worked example

This model passes `shp check`:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
}
```

Checked with `includeFacts: true`, it returns these 12 facts, in the returned order. Each provenance `filePath` is `audit.shape`, except the prelude rows, whose `filePath` is `standard prelude`:

| `kind` | Other fields | `provenance.label` |
| --- | --- | --- |
| `component` | `name: audit::AuditStore` | `component audit::AuditStore` |
| `effect` | `component: audit::AuditStore`, `functionName: appendEvent`, `effect: Append`, `target: audit::AuditEvent` | `effect audit::AuditStore.appendEvent emits Append<AuditEvent>` |
| `function` | `component: audit::AuditStore`, `name: appendEvent` | `fn audit::AuditStore.appendEvent` |
| `grants` | `component: audit::AuditStore`, `effect: Append`, `target: audit::AuditEvent` | `component audit::AuditStore grants Append<AuditEvent>` |
| `owns` | `component: audit::AuditStore`, `resource: audit::AuditEvent` | `component audit::AuditStore owns audit::AuditEvent` |
| `resource` | `name: audit::AuditEvent` | `resource audit::AuditEvent` |
| `resource_trait` | `resource: audit::AuditEvent`, `trait: AppendOnly` | `resource audit::AuditEvent : AppendOnly` |
| `shape_update_for` | `path: src/audit/store.ts` (from the `evidence`) | `effect audit::AuditStore.appendEvent emits Append<AuditEvent>` |
| `shape_update_for` | `path: src/audit/store.ts` (from the `source`) | `fn audit::AuditStore.appendEvent` |
| `trait_final_forbid` | `trait: AppendOnly`, `effect: DropStorage`, `target: T` | `trait AppendOnly forbids final DropStorage<T>` |
| `trait_final_forbid` | `trait: AppendOnly`, `effect: HardDelete`, `target: T` | `trait AppendOnly forbids final HardDelete<T>` |
| `trait_final_forbid` | `trait: AppendOnly`, `effect: Truncate`, `target: T` | `trait AppendOnly forbids final Truncate<T>` |

Declared names are module-qualified (`audit::AuditStore`); function names inside `function` and `effect` facts are local, and the prelude trait keeps its bare name. `shape_update_for` paths drop the `#appendEvent` anchor. The `effect` fact records only the effect and its target: the evidence ref stays on the function's effect entry (`EffectEntryInfo.evidence`) in the `components` index, where `checkFunctions` reads it for the `evidence:` line of a `forbidden effect` diagnostic.

No fact says that `AuditEvent` forbids `HardDelete<audit::AuditEvent>`. That per-resource forbid is computed on demand from the indexes, as `shp explain` shows:

```text
$ shp explain AuditEvent audit.shape
AuditEvent
  kind: resource
  traits:
    AppendOnly

  final forbidden effects:
    HardDelete<AuditEvent>
    Truncate<AuditEvent>
    DropStorage<AuditEvent>
```

## Traits

`lowerTrait` stores a `TraitInfo` in `model.traits` under the module-qualified name. It records the type parameters, every `forbid` member as a forbid pattern with a `final` flag, and every `require_context` member as a context requirement. A `require_context` member whose `<target>` is not a declared type parameter, or whose bound is not `Fn`, `Component`, or `Resource`, is dropped with an `invalid_require_context` diagnostic. `allow` and `require` members are parsed but not lowered.

`lowerResource` stores each resource's resolved trait names in `ResourceInfo.traits` and emits one `resource_trait` fact per trait.

The two halves meet at rule time. `checkFunctions` calls `findFinalForbidden`, which calls `deriveFinalForbidsForResource` in `checker/derivations.ts`. That function instantiates each final pattern of each of the resource's traits for that resource (a generic or omitted target becomes the resource; a concrete target stays as written), then adds final forbids derived from `rule` declarations. `shp explain` calls the same function. Lowering therefore stores no per-resource forbid, and neither per-resource nor rule-derived forbids ever become facts.

`emitDerivedFacts` emits one `trait_final_forbid` fact per `forbid` member of every trait, with the pattern's generic target (for example `T`). It emits these facts for plain `forbid` members too, and the fact has no `final` field; only its provenance label shows `final`.

Obligations live on the trait itself: prelude obligations are seeded onto prelude traits, and a user trait's `require_context` members are stored on that trait. A bearer's obligations come from the traits it bears, through `requirementsForTarget`. A same-module trait with a prelude name shadows the prelude trait during name resolution, so a bearer in that module gets only the local trait's obligations. Nothing merges.

## Relations

`lowerRelation` in `lowering/relations.ts` first validates the relation's structure, reporting each problem as an `invalid_relation` diagnostic. A missing `kind` or `connects`, fewer than two endpoints, a duplicate endpoint, or an arity or connection form that a prelude kind does not allow drops the relation. A repeated `kind`, `connects`, `roles`, or `summary` member, or a `roles` or `expects` entry that names no endpoint, is reported without dropping it. A kept relation becomes a `HyperedgeInfo` in `model.hypergraph.edges` and emits:

- one `hyperedge` fact, with `relationKind` and `ordered` (true for `A -> B` connects, false for `{ A, B }`);
- one `hyperedge_member` fact per endpoint, with its `index` and, when `roles` names it, its `role`;
- one `hyperedge_fingerprint_expectation` fact per `expects` entry.

A binary dependency is a two-member hyperedge; there is no separate binary-edge layer.

Lowering also builds `model.hypergraph.incidence`, a vertex-to-hyperedge index keyed by endpoint name, which `shp graph show` and `shp explain` use. Rules do not read it. `forbid provides T except C` scans every `provides` hyperedge, and `forbid path` and `forbid hypercycle` build a directed step graph from the hyperedges, filtered by kind; see [Rule Evaluation](/shapelang/inside-shape/rule-evaluation/#graph-witnesses). Whether each endpoint names a declared component or resource is checked at rule time by `checkResolvedNames`.

## Context

`lowerRationale` and `lowerMemory` in `lowering/context.ts` store a `RationaleInfo` or `MemoryInfo`. `lowerContextMember` flattens the grouped blocks into shared fields:

- each `protects` entry becomes a `ProtectedProperty`; `pushProtects` resolves a `shape` value as a trait name, so it matches the `shape_trait_removed` events a `change` produces;
- each `guards` entry becomes a `GuardInfo` (`on_change require`) or a `TransformGuardInfo` (`forbid transform`), through `pushGuard`;
- `who` sets `owner` and `when` sets `reviewBy`; a later block of the same kind that sets a value overwrites the earlier value;
- `applies_to`, `summary`, and `evidence` are stored as given.

Each rationale or memory emits one `rationale` or `memory` fact. The fact records the context type's own target (`RefactorConstraint<fn Gateway.derivePolicyDecision>`), not `applies_to`. Each `protects` entry emits a `protected_shape` fact, and each guard that requires reevaluation emits a `guard_requires_reevaluation` fact. `forbid transform` guards, `applies_to`, owners, `review_by` dates, `status`, `confidence`, and `sensitive` produce no facts.

`lowerReevaluation` stores a `ReevaluationInfo` and emits a `reevaluation` fact only when the declaration has `satisfies`. Whether a reevaluation is valid is decided at rule time by `reevaluationValidationReasons` in `checker/derivations.ts`. `lowerRole` keys roles by their local name, and `lowerPolicy` merges same-named policies, so `require approver` in any of them applies. Neither emits facts.

Required context is also decided at rule time. `emitDerivedFacts` emits one `context_required` fact per obligation a bearer carries, without the trait's `satisfied_by` kinds or its description requirement. `hasRequiredContext` accepts a matching `rationale` or `memory`, subject to the trait's `satisfied_by`. A `reevaluation` satisfies guards, never a required-context obligation.

## Changes

`lowerChange` in `lowering/changes.ts` applies one `change` declaration after every ordinary declaration in every module has been lowered. `planChange` copies the model with `stageModelForChange` in `checker/change-planning.ts`, applies each entry to the copy in source order, and takes before and after snapshots of every guarded target. `commitPlannedChange` then appends the resulting change events and publishes the staged copy, so the effective model stays untouched until every entry of that change has been staged.

| Entry | Effect on the model | Change events |
| --- | --- | --- |
| `add fn C.f …` | lowers the new function into component `C` | none |
| `modify fn C.f …` | replaces the function with the restated summary | yes |
| `remove fn C.f` | removes the function | yes |
| `add <declaration>` | lowers a resource, trait, component, relation, implementation, binding, attestation, or rule | none |
| `modify <declaration>` | removes the declaration, then lowers the new one (a modified attestation is only added) | for components, resources, and relations |
| `remove <kind> <Name>` | deletes the declaration from its index (`removeRelation` also updates `incidence`) | for components, resources, and relations |

The events land in `model.changeEvents` as `ChangeTrigger` records (`shape-domain.ts`). For each transition, `changeEventsForTransition` emits them in a fixed order: `target_changed`, then `shape_trait_removed` for each trait the target lost, then `description_removed`, then `transform_applied` for each `transform` label. Change events are not facts. `checkGuardedChanges` is their only reader, so guards fire only for targets that a `change` declaration modifies or removes.

The fact list follows function entries but not declaration entries. `add fn`, `modify fn`, and `remove fn` call `removeFunctionFacts` and, except for `remove fn`, re-emit the function's facts with `emitFunctionFacts`. Declaration-level `modify` and `remove` entries update the typed indexes but leave the replaced declaration's facts in `model.facts`. After `remove component Archive`, for example, the `component audit::Archive` fact remains; after `modify component AuditStore { … }`, the original component's facts remain beside the new ones. Rules are unaffected, because they read the indexes. Coverage is unaffected too, because step 4 of the lowering order rebuilds shape-update paths from the final function registry.

## Coverage

- `lowerImplementation` stores the path globs, the `conforms_to` component, and the `on_change` requirement, and emits `implementation`, `implementation_path`, and `conforms_to` facts. No fact records the `on_change` requirement.
- `lowerBinding` stores the binding and emits `binding`, `binding_when_changed`, `binding_require_changed`, and `binding_allow_attest` facts.
- `lowerAttestation` stores the attestation kind, its path normalized by `normalizeShapeSourcePath` (which drops a `#anchor` and a `:line` or `:line-line` suffix), its reason, and its provenance, and emits an `attestation` fact.
- `rebuildShapeUpdatePaths` fills `model.shapeUpdatePaths` from every function's `source` and every `evidence` on a complete effect entry, normalized the same way. It skips functions from generated-AST modules (`shouldIgnoreFunctionForCoverage`). Each ref also emits a `shape_update_for` fact.

Lowering never sees the changed-file list. At rule time, `checkCoverage` reads `model.shapeUpdatePaths` and `model.attestations`, and `checkBindings` reads `model.bindings` and `model.attestations`. Neither reads facts. Both count a ref only when its declaring `.shape` file is in the changed-file list, and an attestation only when its kind, path, and reason are absent from the base model, falling back to the declaring-file rule when there is no base; see [Rule Evaluation](/shapelang/inside-shape/rule-evaluation/#interactions). The user-facing coverage rules are in [Keep the Model Current](/shapelang/guides/keep-model-current/).

## Lowering invariant

Every fact must be explainable from loaded declarations, their authored or generated-AST origin, or the standard prelude. Lowering takes no check options. `repoRoot` reaches the lowered model only through the module origins that `checkShapeFiles` and `IncrementalShapeChecker` classify before lowering. Every other option affects only rule evaluation.
