# Shape Language Implementation Plan

**Working name:** Shape
**File extension:** `.shp`
**Status:** draft implementation plan
**Core idea:** human-readable, LLM-authored architecture shape files checked by a deterministic type/conformance checker.

## 1. Product definition

Shape is a typed architecture conformance language.

It is not a programming language in the normal sense. It does not execute. It does not compile application code. It does not need to infer TypeScript, Rust, SQL, or Solidity directly.

Instead, `.shp` files describe the declared semantic shape of a system:

```text
resources
components
functions
effects
capabilities
ownership
dependencies
constraints
change summaries
```

The checker verifies that the declared shape is coherent.

The LLM helps author `.shp` files from PRs, code diffs, design docs, schemas, and human instructions. The human reviews those `.shp` files. The deterministic checker decides whether the resulting architecture model is valid.

The product is therefore:

```text
LLM-authored semantic model
  +
human-readable shape files
  +
deterministic conformance checker
  +
CI enforcement
```

The key distinction:

```text
The LLM writes claims.
The human reviews claims.
The checker rejects incoherent claims.
```

## 2. Primary goal

The first useful version should catch this kind of issue:

```text
A resource is declared append-only.
A PR introduces a function whose shape summary says it hard-deletes that resource.
The checker rejects the PR.
```

Example:

```text
resource AuditEvent : AppendOnly {
  storage postgres.table("audit_events")
}
```

Then a new PR adds:

```text
fn purgeOldEvents
  source ts("src/audit/purge.ts#purgeOldEvents")
  effects complete {
    HardDelete<AuditEvent>
      evidence ts("src/audit/purge.ts:12-16")
  }
```

The checker emits:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits:
  HardDelete<AuditEvent>

But:
  AuditEvent : AppendOnly
  AppendOnly forbids final HardDelete<AuditEvent>

Therefore:
  purgeOldEvents cannot inhabit component AuditStore.
```

That is the first killer demo.

## 3. Non-goals

Shape should not initially try to:

```text
compile TypeScript into .shp
prove the application implementation is correct
replace tests
replace code review
become a full proof assistant
become a general ontology for all software architecture
execute business logic
generate application code
```

The first version checks the `.shp` model, not arbitrary implementation code.

Optional source-code analysers can come later as audit aids, but they are not the core product.

## 4. Design principles

### 4.1 `.shp` is the source of architectural truth

Application code may be messy. `.shp` files should be precise.

A `.shp` file says:

```text
this function emits these effects
this component owns these resources
this resource has these invariants
this dependency is allowed or forbidden
this source path is governed by this component shape
```

The checker judges those claims.

### 4.2 The language must be boring

The syntax should be explicit, stable, and easy for both humans and LLMs to write.

Bad:

```text
purge ~ audit !delete
```

Good:

```text
fn purgeOldEvents
  source ts("src/audit/purge.ts#purgeOldEvents")
  effects complete {
    HardDelete<AuditEvent>
  }
```

This language should optimise for:

```text
reviewability
diff clarity
canonical formatting
diagnostic quality
low ambiguity
```

### 4.3 The checker is deterministic

The LLM is never the authority.

The checker should not ask the LLM whether something is safe. It should parse `.shp`, lower it into facts, run rules, and emit reproducible diagnostics.

### 4.4 Claims need evidence

Effect summaries should usually include source references:

```text
HardDelete<AuditEvent>
  evidence ts("src/audit/purge.ts:12-16")
```

The checker does not need to understand the TypeScript. The evidence exists so humans can inspect the claim.

### 4.5 Unknowns must be explicit

The system should never silently omit uncertainty.

Use:

```text
effects unknown
```

or:

```text
effects complete {
  ...
}
```

In protected components, `unknown` should fail by default.

### 4.6 Diagnostics are the product

The checker must explain failures as causal paths, not just as abstract errors.

Good diagnostic shape:

```text
function emits effect
→ effect targets resource
→ resource has trait
→ trait derives forbidden effect
→ component cannot contain function
```

The internal provenance graph matters more than fancy syntax.

## 5. Core workflow

### 5.1 Normal PR flow

```text
1. Developer changes application code, schema, infra, or docs.

2. LLM reads:
   - code diff
   - existing .shp files
   - relevant design docs
   - project prelude
   - changed file paths

3. LLM proposes a .shp change file.

4. Human reviews:
   - code diff
   - shape diff
   - evidence spans
   - unknown/unsafe declarations

5. CI runs:
   - shp fmt --check
   - shp check
   - shp coverage

6. CI passes only if:
   - shape model is coherent
   - governed files have shape deltas or attestations
   - forbidden effects are absent
   - unknown effects are not present in protected areas
   - unsafe effects satisfy project policy
```

### 5.2 Conceptual pipeline

```text
.shp files
  ↓
parser
  ↓
AST
  ↓
name resolver
  ↓
core declarations
  ↓
semantic facts
  ↓
rule engine
  ↓
violations
  ↓
diagnostics with provenance
```

## 6. Language surface

### 6.1 Core keywords

Initial reserved words:

```text
module
import

resource
component
interface
trait
effect
capability
fn

source
evidence
storage
implementation
paths

owns
requires
provides
grants
emits
effects
complete
unknown

allow
forbid
require
invariant
rule
final
unsafe

change
add
modify
remove
attest
reason
expires
```

Prelude terms such as `Read`, `Append`, `HardDelete`, and `AppendOnly` should not be syntax keywords. They should be standard declarations.

### 6.2 Prelude declarations

Initial standard effects:

```text
Read<T>
Append<T>
Update<T>
Redact<T.field>
LogicalDelete<T>
HardDelete<T>
Truncate<T>
DropStorage<T>
Export<T>
Import<T>
```

Initial standard traits:

```text
AppendOnly
Persistent
Ephemeral
PII
Secret
Public
External
Internal
```

Initial standard capabilities:

```text
Delete<T>
Redact<T.field>
Export<T>
BreakGlass<T>
Admin<T>
```

Initial standard component classifications:

```text
DataPlane
ControlPlane
PublicIngress
InternalService
StorageAdapter
PolicyAuthority
```

## 7. Example `.shp` file

```text
module audit

resource AuditEvent : AppendOnly {
  storage postgres.table("audit_events")
}

trait AppendOnly<T: Resource> {
  allow Read<T>
  allow Append<T>

  forbid final HardDelete<T>
  forbid final Truncate<T>
  forbid final DropStorage<T>
}

component AuditStore : StorageAdapter {
  owns AuditEvent

  grants Read<AuditEvent>
  grants Append<AuditEvent>

  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }

  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts:18-25")
    }
}

implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
    "db/audit/**/*.sql"
  }

  conforms_to AuditStore

  on_change require shape_delta
}
```

## 8. Example change file

```text
module changes.PR_412

import audit

change AddAuditRetentionPurge {
  add fn AuditStore.purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts:12-16")
    }
}
```

This should fail because `AuditEvent : AppendOnly`.

## 9. Core semantic model

The parser should lower `.shp` declarations into a small internal model.

### 9.1 Resource declaration

```ts
type ResourceDecl = {
  kind: "ResourceDecl"
  name: string
  traits: TypeRef[]
  storage?: StorageBinding[]
  span: SourceSpan
}
```

Example facts:

```text
resource(AuditEvent)
trait(AuditEvent, AppendOnly)
storage(AuditEvent, postgres.table, "audit_events")
```

### 9.2 Component declaration

```ts
type ComponentDecl = {
  kind: "ComponentDecl"
  name: string
  classifiers: TypeRef[]
  owns: TypeRef[]
  requires: TypeRef[]
  provides: TypeRef[]
  grants: EffectOrCapabilityTerm[]
  functions: FunctionSummary[]
  span: SourceSpan
}
```

Example facts:

```text
component(AuditStore)
classifier(AuditStore, StorageAdapter)
owns(AuditStore, AuditEvent)
grants(AuditStore, Read, AuditEvent)
grants(AuditStore, Append, AuditEvent)
```

### 9.3 Function summary

```ts
type FunctionSummary = {
  kind: "FunctionSummary"
  component: string
  name: string
  source?: SourceRef
  effects:
    | { kind: "complete"; terms: EffectTerm[] }
    | { kind: "unknown" }
  span: SourceSpan
}
```

Example facts:

```text
function(AuditStore.purgeOldEvents)
contains(AuditStore, AuditStore.purgeOldEvents)
source(AuditStore.purgeOldEvents, ts, "src/audit/purge.ts#purgeOldEvents")
effect(AuditStore.purgeOldEvents, HardDelete, AuditEvent)
evidence(AuditStore.purgeOldEvents, HardDelete, AuditEvent, "src/audit/purge.ts:12-16")
```

### 9.4 Trait declaration

```ts
type TraitDecl = {
  kind: "TraitDecl"
  name: string
  params: TypeParam[]
  allows: EffectPattern[]
  forbids: ForbiddenEffectPattern[]
  requires: CapabilityPattern[]
  span: SourceSpan
}
```

Example:

```text
trait AppendOnly<T: Resource> {
  allow Read<T>
  allow Append<T>

  forbid final HardDelete<T>
  forbid final Truncate<T>
  forbid final DropStorage<T>
}
```

Derived facts:

```text
allow(AuditEvent, Read, AuditEvent)
allow(AuditEvent, Append, AuditEvent)
forbid_final(AuditEvent, HardDelete, AuditEvent)
forbid_final(AuditEvent, Truncate, AuditEvent)
forbid_final(AuditEvent, DropStorage, AuditEvent)
```

## 10. Fact engine

The checker should not repeatedly walk ASTs to answer semantic questions. It should lower declarations into facts.

Representative fact types:

```text
resource(name)
trait(resource, trait)
component(name)
classifier(component, classifier)
owns(component, resource)
requires(component, interface_or_component)
provides(component, interface)
grants(component, effect_or_capability, target)
function(name)
contains(component, function)
source(function, language, path)
effect(function, effect, target)
effect_unknown(function)
allow(target, effect, target)
forbid(target, effect, target)
forbid_final(target, effect, target)
implementation(name)
implementation_path(implementation, glob)
conforms_to(implementation, component)
changed_file(path)
shape_delta_for(path)
attestation(path, no_shape_change)
```

Rules derive violations:

```text
violation(Function, forbidden_effect, Effect, Resource) :-
  effect(Function, Effect, Resource),
  forbid(Resource, Effect, Resource).

violation(Function, final_forbidden_effect, Effect, Resource) :-
  effect(Function, Effect, Resource),
  forbid_final(Resource, Effect, Resource).

violation(Function, unknown_effects_not_allowed) :-
  effect_unknown(Function),
  contains(Component, Function),
  protected(Component).

violation(Path, missing_shape_delta) :-
  changed_file(Path),
  governed(Path),
  not shape_delta_for(Path),
  not attestation(Path, no_shape_change).
```

The first implementation can use a simple in-memory fact index and direct rule evaluation. A Datalog-like engine can come later.

## 11. Rule semantics

### 11.1 Default deny

A function inside a component should be valid only if its effects are permitted by the component shape and not forbidden by resource constraints.

Basic rule:

```text
actualEffects(fn) must be compatible with component grants
actualEffects(fn) must not intersect final forbidden effects
unknown effects are invalid in protected components
```

### 11.2 Constraint precedence

Recommended precedence:

```text
final forbid > unsafe exception policy > forbid > require capability > allow
```

Meaning:

```text
forbid final HardDelete<AuditEvent>
```

cannot be overridden by:

```text
grants Delete<AuditEvent>
```

A final invariant is absolute unless the project explicitly permits a special unsafe override policy.

### 11.3 Capability versus effect

Effect:

```text
HardDelete<AuditEvent>
```

means “this function performs a destructive operation.”

Capability:

```text
Delete<AuditEvent>
```

means “this component has authority to delete this resource.”

They are not the same.

A rule may say:

```text
when fn emits HardDelete<T>
require fn has Delete<T>
```

But another rule may still say:

```text
forbid final HardDelete<T>
```

The final forbid wins.

## 12. Shape coverage

Since the checker does not compile TypeScript into `.shp`, the system needs coverage rules.

Example:

```text
implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
    "db/audit/**/*.sql"
  }

  conforms_to AuditStore

  on_change require shape_delta
}
```

If a PR changes:

```text
src/audit/purge.ts
```

but there is no `.shp` change or attestation, CI fails:

```text
error: governed source changed without shape delta

Changed file:
  src/audit/purge.ts

Governed by:
  AuditStoreImpl

Required:
  add a .shp change
  or add an explicit no_shape_change attestation
```

Attestation example:

```text
attest no_shape_change {
  source ts("src/audit/store.ts")
  reason "renamed local variable only"
}
```

The checker does not prove the attestation is true. It makes the claim explicit and reviewable.

## 13. Unsafe escape hatches

Real systems need exceptions, but they should be loud.

Example:

```text
fn emergencyEraseAuditEvents
  source ts("src/audit/emergency.ts#erase")
  unsafe effects complete {
    HardDelete<AuditEvent>
      evidence ts("src/audit/emergency.ts:20-28")
  }
  requires BreakGlass<AuditEvent>
  reason "Regulatory erasure request"
  expires "2026-06-01"
```

Project policy should decide whether this is allowed.

Initial rule:

```text
unsafe effects are invalid unless:
  - explicit reason exists
  - required capability exists
  - expiry exists
  - project policy permits unsafe in that component
```

Unsafe should be rare and searchable.

## 14. Dependency graph checking

After resource/effect checking, the second major feature is semantic dependency checking.

The language should model multiple graphs, not one generic graph.

Potential relation kinds:

```text
RuntimeCall
ControlPlaneDependency
DataDependency
AuthorityDependency
DeploymentDependency
TrustDependency
EventDependency
```

Example:

```text
component Gateway : DataPlane {
  provides JsonRpcEndpoint
  requires PolicySnapshot via RuntimeCall
}

component PolicyService : ControlPlane {
  provides PolicySnapshot
  requires ContractRegistry via ControlPlaneDependency
}

component ContractRegistry : ControlPlane {
  requires Gateway via RuntimeCall
}
```

Rule:

```text
rule no_policy_decision_cycle {
  forbid cycle over requires where includes AuthorityDependency or RuntimeCall
}
```

Diagnostic:

```text
error: forbidden dependency cycle

Gateway
  requires PolicySnapshot from PolicyService

PolicyService
  requires ContractRegistry

ContractRegistry
  requires Gateway

cycle:
  Gateway -> PolicyService -> ContractRegistry -> Gateway
```

Implementation algorithm:

```text
build typed edge graph
group by relation kind
run Tarjan SCC for cycles
run BFS/DFS for forbidden paths
attach provenance to each edge
emit witness path
```

## 15. LLM authoring workflow

The LLM should produce `.shp` deltas, not vague prose.

### 15.1 Inputs to the LLM

```text
existing .shp model
PR diff
changed file list
relevant code snippets
project prelude
authoring rules
previous shape conventions
```

### 15.2 Expected LLM output

```text
valid .shp change file
evidence refs for every material effect
complete or unknown effect status
no hidden uncertainty
no invented resources without declaration
no downgrade of destructive effects
```

### 15.3 LLM critic pass

A second pass should review the proposed `.shp` delta.

It should ask:

```text
Did the shape delta cover every governed changed file?
Are any effects suspiciously omitted?
Are destructive operations represented?
Are storage changes represented?
Are dependency changes represented?
Are unknowns honestly marked?
Are evidence spans plausible?
```

This critic pass is advisory. The deterministic checker remains the gate.

## 16. CLI

Initial commands:

```bash
shp check
shp check --changed
shp fmt
shp fmt --check
shp explain AuditEvent
shp explain AuditStore.purgeOldEvents
shp graph AuditStore
shp coverage --changed-files changed.txt
```

### 16.1 `shp check`

Runs full conformance checking.

```bash
shp check
```

Outputs:

```text
3 violations found

1. AuditStore.purgeOldEvents
   forbidden effect HardDelete<AuditEvent>
   because AuditEvent : AppendOnly

2. Gateway -> PolicyService -> ContractRegistry -> Gateway
   forbidden runtime dependency cycle

3. src/audit/purge.ts
   governed source changed without shape delta
```

### 16.2 `shp explain`

Shows derived constraints.

```bash
shp explain AuditEvent
```

Output:

```text
AuditEvent
  kind: resource
  traits:
    AppendOnly

  storage:
    postgres.table("audit_events")

  allowed effects:
    Read<AuditEvent>
    Append<AuditEvent>

  final forbidden effects:
    HardDelete<AuditEvent>
    Truncate<AuditEvent>
    DropStorage<AuditEvent>
```

### 16.3 `shp graph`

Shows relation paths.

```bash
shp graph Gateway --relation requires
```

Output:

```text
Gateway
  -> PolicyService
  -> ContractRegistry
  -> L2RpcNode
```

## 17. Formatter

A canonical formatter is essential.

Without it, LLM-generated shape files will drift.

Formatter rules:

```text
stable declaration ordering
stable effect ordering
one semantic claim per line
normalised indentation
normalised generic syntax
sorted imports
canonical evidence placement
```

The formatter should make diffs predictable.

## 18. Project layout

Suggested repo layout:

```text
shape/
  prelude/
    data.shp
    architecture.shp
    security.shp

  system/
    audit.shp
    gateway.shp
    policy.shp
    bridge.shp

  changes/
    PR_412.shp

src/
  ...

db/
  ...

packages/
  shp-parser/
  shp-core/
  shp-checker/
  shp-cli/
  shp-fmt/
  shp-lsp/
  shp-llm/
```

Initial implementation can live in one package, then split later.

## 19. Implementation stack

Recommended initial stack:

```text
TypeScript
Bun or pnpm
Langium or a small hand-written parser
Vitest for tests
ts-pattern or similar for AST/rule matching
commander/cac for CLI
```

Reason:

```text
fast iteration
easy LLM integration
easy GitHub Actions integration
natural fit for TS-heavy codebases
```

Future serious implementation:

```text
Rust semantic kernel
incremental fact engine
WASM build
TypeScript bindings
LSP server
```

Do not start with Rust unless the core semantics have stabilised.

## 20. Implementation phases

### Phase 1: minimal checker

Build:

```text
parser for basic .shp
AST model
resolver
hardcoded prelude
resource/effect checker
CLI: shp check
```

Support:

```text
resource
trait
component
fn
effects complete
Read<T>
Append<T>
HardDelete<T>
AppendOnly
forbid final
```

Success condition:

```text
Append<AuditEvent> passes.
HardDelete<AuditEvent> fails when AuditEvent : AppendOnly.
```

### Phase 2: fact lowering and provenance

Build:

```text
fact database
derived facts
rule evaluation
provenance tracking
diagnostic witness paths
```

Success condition:

```text
Every violation explains exactly which declarations caused it.
```

### Phase 3: change files

Build:

```text
change blocks
add/modify/remove declarations
apply change to base model
check resulting model
```

Success condition:

```text
A PR-level .shp file can be checked without rewriting base system files.
```

### Phase 4: coverage policy

Build:

```text
implementation blocks
path globs
changed-file input
shape_delta requirement
no_shape_change attestations
```

Success condition:

```text
A governed source file cannot change without a shape delta or attestation.
```

### Phase 5: formatter

Build:

```text
canonical formatting
fmt check in CI
stable output for LLM-authored files
```

Success condition:

```text
LLM-generated .shp can be normalised before review.
```

### Phase 6: dependency graph rules

Build:

```text
requires/provides graph
relation kinds
cycle detection
forbidden path rules
path diagnostics
```

Success condition:

```text
Checker rejects a semantic dependency cycle with a readable witness path.
```

### Phase 7: user-defined rules

Build constrained rule syntax:

```text
rule append_only_forbids_delete<T: Resource> {
  when T has AppendOnly
  forbid final HardDelete<T>
}
```

Also:

```text
rule gateway_only_rpc_ingress {
  forbid provides JsonRpcEndpoint except Gateway
}
```

Success condition:

```text
Projects can encode domain-specific architectural law without changing checker code.
```

### Phase 8: LLM authoring assistant

Build:

```text
prompt templates
shape delta generator
shape critic
evidence-span generator
unknown-effect discipline
```

Success condition:

```text
Given a PR diff, the assistant proposes a valid .shp change file that humans can review.
```

### Phase 9: LSP/editor support

Build:

```text
diagnostics
hover
go-to declaration
explain constraint
autocomplete names
format-on-save
```

Success condition:

```text
Shape files are pleasant to edit manually.
```

### Phase 10: optional source analysers

Build only as audit support:

```text
detect obvious SQL DELETE/TRUNCATE/DROP
detect obvious Kysely/Prisma/Drizzle destructive calls
compare analyser hints against .shp effects
warn on mismatch
```

Success condition:

```text
The analyser can flag suspicious omissions, but .shp remains the source of truth.
```

## 21. Testing plan

### 21.1 Golden fixtures

Create small example projects:

```text
fixtures/pass/append_only_append
fixtures/fail/append_only_hard_delete
fixtures/fail/missing_shape_delta
fixtures/fail/unknown_effect_protected_component
fixtures/fail/dependency_cycle
fixtures/pass/unsafe_with_policy
fixtures/fail/unsafe_without_expiry
```

Each fixture should snapshot:

```text
input .shp
derived facts
diagnostic output
exit code
```

### 21.2 Parser tests

Test:

```text
valid syntax
invalid syntax
source spans
imports
generic terms
evidence refs
change blocks
```

### 21.3 Resolver tests

Test:

```text
unknown resource
unknown component
ambiguous name
duplicate declaration
bad import
generic type mismatch
```

### 21.4 Rule tests

Test:

```text
allow
forbid
forbid final
capability required
unsafe override
unknown effects
component grants
resource constraints
```

### 21.5 Diagnostic tests

Diagnostics should be stable.

A bad diagnostic is a product bug.

## 22. CI integration

Example GitHub Actions shape:

```yaml
name: Shape Check

on:
  pull_request:

jobs:
  shape:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install
        run: bun install

      - name: Format check
        run: bun shp fmt --check

      - name: Compute changed files
        run: git diff --name-only origin/main...HEAD > changed.txt

      - name: Coverage check
        run: bun shp coverage --changed-files changed.txt

      - name: Conformance check
        run: bun shp check --changed-files changed.txt
```

## 23. Review policy

A `.shp` change should be reviewed like a semantic contract.

Reviewers should ask:

```text
Does every changed governed file have a shape delta or attestation?
Are destructive effects represented honestly?
Are unknown effects present?
Are unsafe effects justified?
Do evidence refs point to the real source of the effect?
Does this introduce a new dependency path?
Does this weaken a final invariant?
Does the shape diff make the architectural consequence obvious?
```

The shape review should be shorter and clearer than raw code review. That is the point.

## 24. Main risks

| Risk                                          |   Severity | Mitigation                                                                   |
| --------------------------------------------- | ---------: | ---------------------------------------------------------------------------- |
| LLM omits an effect                           |       High | coverage rules, evidence refs, critic pass, human review, optional analysers |
| `.shp` becomes stale                          |       High | governed paths require shape deltas or attestations                          |
| Language becomes too abstract                 |       High | start with resources/effects/components only                                 |
| Diagnostics are poor                          |       High | provenance graph from day one                                                |
| Users ignore shape files                      |     Medium | keep diffs small, canonical, and CI-enforced                                 |
| Rule system becomes too powerful too early    |     Medium | constrained rule syntax first                                                |
| Unsafe becomes a loophole                     |     Medium | require reason, capability, expiry, and policy                               |
| `.shp` extension conflicts with GIS Shapefile | Low/Medium | acceptable internally; public product may use `.shape` later                 |

## 25. MVP acceptance criteria

The MVP is done when all of this works:

```text
1. A human or LLM can write audit.shp.

2. audit.shp declares:
   - AuditEvent resource
   - AppendOnly trait
   - AuditStore component
   - append/list/purge functions

3. shp check passes for:
   - Append<AuditEvent>
   - Read<AuditEvent>

4. shp check fails for:
   - HardDelete<AuditEvent>

5. The failure explains:
   - function name
   - emitted effect
   - target resource
   - resource trait
   - forbidden final constraint
   - evidence span if present

6. A governed source path changed without shape delta fails coverage.

7. shp fmt produces stable formatting.

8. The checker can run in CI.
```

Nothing else is required for the first proof of value.

## 26. Final target state

The mature system should support:

```text
human-readable .shp models
LLM-authored shape deltas
deterministic conformance checking
resource/effect/capability constraints
component shape checking
semantic dependency graph checking
governed implementation coverage
unsafe exception policy
formatter
CLI
CI integration
LSP/editor support
optional static-analysis hints
domain libraries
```

The final product shape is:

```text
Architecture changes become explicit semantic diffs.
Semantic diffs are reviewed by humans.
The checker rejects incoherent system shape.
```

## 27. Recommended immediate next step

Build the smallest end-to-end repository:

```text
shape/system/audit.shp
shape/changes/PR_001.shp
packages/shp-cli
packages/shp-checker
```

First command:

```bash
shp check
```

First failing model:

```text
resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent

  fn purgeOldEvents
    effects complete {
      HardDelete<AuditEvent>
    }
}
```

First diagnostic:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
```

That proves the core idea. Everything else is expansion.
