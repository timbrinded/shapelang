# Shape Memory Guards — Implementation Spec

**Repository:** `timbrinded/shapelang`  
**Feature name:** Memory Guards  
**Target file extension:** `.shape`  
**Status:** implementation spec  
**Date:** 2026-05-18  
**Primary package targets:** `packages/shp-checker`, `packages/shp-cli`

---

## 1. Summary

Memory Guards add a typed design-memory layer to Shape.

Shape already lets a repository declare architectural facts such as resources, traits, components, functions, effects, dependencies, implementation coverage, change files, and rules. Memory Guards extend this by allowing shape declarations to require explicit, typechecked design memory.

The feature exists for cases where a shape is intentionally non-obvious, hard-fought, or refactor-sensitive.

Examples:

```text
this function is intentionally inline
this check order is important
this dependency is build-time only
this component exists only for e2e testing
this field or description must stay local because reviewers need it
this behaviour is known to matter even if the team cannot fully explain why yet
```

Memory Guards are not general prose. They are not waivers. They should not make forbidden effects pass.

They are typed objects that let the checker say:

```text
This shape requires a rationale.
This hard-fought memory protects this shape.
This change touches a guarded shape.
This change must include a matching re-evaluation.
```

The feature moves Shape from:

```text
typed architecture conformance checker
```

to:

```text
typed architecture conformance checker with enforceable design memory
```

---

## 2. Current repository baseline

The current repository already implements the core Shape product boundary:

```text
humans/LLMs write reviewable .shape claims
the deterministic checker validates model coherence
the checker does not prove arbitrary application implementation correctness
```

Current language support includes:

```text
module
import
resource
trait
component
implementation
change
attest
rule
fn
source
evidence
effects complete
effects unknown
owns
grants
requires
provides
forbid final
forbid cycle
```

Current checker support includes:

```text
append-only final forbids
missing component grants
unknown effects
unknown names
duplicate declarations
shape coverage for changed governed paths
semantic dependency-cycle diagnostics
forbidden provides rules
unsafe-effect metadata checks
```

Current CLI support includes:

```bash
bun shp check
bun shp coverage
bun shp fmt
bun shp explain
bun shp graph
bun shp author
bun shp analyze
```

Memory Guards should therefore be implemented as an incremental extension to the existing grammar, AST lowering, fact model, diagnostics, formatter, tests, CLI, and authoring helpers.

---

## 3. Product boundary

Memory Guards are for typed design memory, not for unrestricted explanation.

They should be used when a shape property is:

```text
intentional
non-obvious
likely to be "cleaned up" incorrectly
expensive to rediscover
important for agents to preserve
important enough to fail CI if missing or violated
```

The checker must not typecheck English prose. It should typecheck the structure around prose.

It should check:

```text
a required rationale exists
a required memory exists
the rationale/memory applies to the correct target
the context object has required fields
the protected shape has not been changed without re-evaluation
a description exists when required
a memory/rationale has not gone stale if strict freshness checking is enabled
```

The prose fields are payload. The typed skeleton is the checked object.

---

## 4. Core design rule

Memory Guards are primarily restrictive.

They may add obligations and block refactors. They must not silently permit otherwise forbidden system shapes.

This means:

```text
rationale   satisfies explanation obligations
memory      records hard-fought knowledge and guards changes
reevaluation permits a guarded change after explicit review
description carries compact local explanation
```

They must not weaken:

```text
forbid final HardDelete<AuditEvent>
```

If a shape emits a final-forbidden effect, Memory Guards do not rescue it.

---

## 5. New concepts

### 5.1 Shape trait

A shape trait is a trait-like annotation on a target that changes how the checker treats that target.

Example:

```shape
fn derivePolicyDecision : PreserveInline
  effects complete {
    Read<PolicySnapshot>
  }
```

`PreserveInline` does not describe an effect. It describes intended shape.

Shape traits can derive context obligations.

Example:

```text
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>
```

### 5.2 Rationale

A `rationale` is typed design explanation for an intentional shape.

Example:

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "The policy decision branches are kept together so reviewers can inspect the full authorisation path locally."
  owner GatewayTeam
}
```

A rationale can satisfy a `require_context` obligation.

### 5.3 Memory

A `memory` records hard-fought knowledge. It may explicitly admit uncertainty.

Example:

```shape
memory DoNotReorderPolicyChecks : HardFoughtKnowledge<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  protects shape CheckOrder
  guards on_change require ReEvaluation<Self>
  observed issue("SEC-231")
  summary "Earlier reordering caused incorrect not-found style errors and leaked operational detail."
  owner GatewayTeam
  review_by "2026-08-18"
}
```

A memory should be able to say:

```text
we know this matters
we may not know exactly why yet
do not change it casually
```

### 5.4 Re-evaluation

A `reevaluation` is a typed review object that satisfies a memory or rationale guard when a protected shape changes.

Example:

```shape
reevaluation PolicyCheckOrderRevisitedForPR812 {
  satisfies memory DoNotReorderPolicyChecks
  outcome Replaced
  summary "New error-normalisation layer preserves not-found style responses independently of check ordering."
  evidence test("gateway/policy-error-normalisation.test.ts")
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
}
```

### 5.5 Description

A `description` is a compact inline explanation attached to a target.

Example:

```shape
fn derivePolicyDecision : PreserveInline {
  description required {
    summary "Builds the final RPC authorisation decision from identity, method, contract, selector, and argument constraints."
  }

  effects complete {
    Read<PolicySnapshot>
    Emit<DecisionLog>
  }
}
```

For MVP grammar simplicity, this may be represented without braces:

```shape
fn derivePolicyDecision : PreserveInline
  description required "Builds the final RPC authorisation decision from identity, method, contract, selector, and argument constraints."
  effects complete {
    Read<PolicySnapshot>
    Emit<DecisionLog>
  }
```

The brace version is nicer. The string version is easier to implement.

---

## 6. Recommended MVP syntax

The MVP should bias towards the existing simple grammar style.

### 6.1 Function shape traits

Current syntax:

```shape
fn appendEvent
  source ts("src/audit/store.ts#appendEvent")
  effects complete {
    Append<AuditEvent>
  }
```

New syntax:

```shape
fn derivePolicyDecision : PreserveInline, RequiresDescription
  source ts("src/gateway/authorize.ts#derivePolicyDecision")
  description required "Policy decision branches remain local for auditability."
  effects complete {
    Read<PolicySnapshot>
    Emit<DecisionLog>
  }
```

### 6.2 Change-file function shape traits

Current syntax:

```shape
change AddAuditRetentionPurge {
  add fn AuditStore.purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
    }
}
```

New syntax:

```shape
change RefactorGatewayDecision {
  modify fn Gateway.derivePolicyDecision : PreserveInline
    source ts("src/gateway/authorize.ts#derivePolicyDecision")
    description required "Policy decision branches remain local for auditability."
    effects complete {
      Read<PolicySnapshot>
      Emit<DecisionLog>
    }
}
```

### 6.3 Rationale

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "The policy decision branches are kept together so reviewers can inspect the full authorisation path locally."
  owner GatewayTeam
}
```

### 6.4 Memory

```shape
memory DoNotReorderPolicyChecks : HardFoughtKnowledge<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  protects shape CheckOrder
  guards on_change require ReEvaluation<Self>
  observed issue("SEC-231")
  summary "Earlier reordering caused incorrect not-found style errors and leaked operational detail."
  owner GatewayTeam
  review_by "2026-08-18"
}
```

### 6.5 Re-evaluation

```shape
reevaluation PolicyCheckOrderRevisitedForPR812 {
  satisfies memory DoNotReorderPolicyChecks
  outcome Replaced
  summary "New error-normalisation layer preserves not-found style responses independently of check ordering."
  evidence test("gateway/policy-error-normalisation.test.ts")
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
}
```

---

## 7. Future richer syntax

After MVP, these blocks can become more structured:

```shape
rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision

  why CognitiveLocality {
    summary "The policy decision branches are kept together so reviewers can inspect the full authorisation path locally."
  }

  protects {
    shape PreserveInline
    description required
  }

  guards {
    forbid transform ExtractHelper
    forbid transform RemoveDescription
  }

  who {
    owner GatewayTeam
  }

  when {
    review_by "2026-08-18"
  }
}
```

Do not implement this nested form first unless it is cheap. It is more pleasant but less urgent than the semantics.

---

## 8. Prelude additions

Add hardcoded standard shape traits first.

Later they can move into a `.shape` prelude file.

Initial standard shape traits:

```text
PreserveInline
RequiresDescription
ProtectedCheckOrder
SharpEdge
NonIdiomatic
TestOnly
```

Initial standard context types:

```text
InlineRationale
DescriptionRationale
CheckOrderRationale
HardFoughtKnowledge
DesignRationale
TestOnlyPurpose
NonProductionScope
```

Initial standard reason codes:

```text
CognitiveLocality
Auditability
HardFoughtKnowledge
E2ETesting
LegacyCompatibility
ExternalProtocolConstraint
MigrationWindow
OperationalBreakGlass
VendorLimitation
TemporaryWorkaround
```

Initial standard memory statuses:

```text
Explained
PartiallyExplained
Unexplained
Deprecated
Superseded
```

Initial standard confidence values:

```text
Low
Medium
High
```

Initial standard re-evaluation outcomes:

```text
Confirmed
Replaced
Removed
Superseded
Rejected
```

---

## 9. Type semantics

### 9.1 Required-context rule

Shape traits can derive required context.

Example:

```shape
fn derivePolicyDecision : PreserveInline
```

derives:

```text
context_required(
  targetKind = fn,
  target = Gateway.derivePolicyDecision,
  contextType = InlineRationale
)
```

The checker must find:

```shape
rationale SomeName : InlineRationale<fn Gateway.derivePolicyDecision> { ... }
```

or emit:

```text
error: missing required context

Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.
No matching rationale found.
```

### 9.2 Memory satisfaction rule

A memory can satisfy a required `HardFoughtKnowledge` context.

Example:

```shape
fn pollAttestation : SharpEdge
```

requires:

```text
HardFoughtKnowledge<fn BridgePoller.pollAttestation>
```

A matching memory satisfies it:

```shape
memory BridgeRetryDelaySharpEdge : HardFoughtKnowledge<fn BridgePoller.pollAttestation> {
  applies_to fn BridgePoller.pollAttestation
  status Unexplained
  confidence High
  summary "Previous attempts to lower this delay caused intermittent settlement failures."
  owner BridgeTeam
}
```

### 9.3 Description rule

If a target has `RequiresDescription`, it must have a non-empty `description`.

Example failure:

```shape
fn derivePolicyDecision : RequiresDescription
  effects complete {
    Read<PolicySnapshot>
  }
```

Diagnostic:

```text
error: missing required description

Gateway.derivePolicyDecision has shape RequiresDescription.
RequiresDescription requires a description.
```

### 9.4 Guarded-change rule

A memory or rationale can create a guard.

For MVP, the guard can be coarse:

```text
if target is protected by a memory/rationale with guards on_change require ReEvaluation<Self>
and a change block modifies or removes that target
and there is no matching reevaluation
then fail
```

Example:

```shape
memory DoNotReorderPolicyChecks : HardFoughtKnowledge<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  guards on_change require ReEvaluation<Self>
  summary "Earlier reordering leaked operational detail."
  owner GatewayTeam
}
```

Then this should fail:

```shape
change RefactorAuthorize {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Unless this exists:

```shape
reevaluation PolicyCheckOrderRevisited {
  satisfies memory DoNotReorderPolicyChecks
  outcome Replaced
  summary "New tests prove the refactor preserves error-normalisation behaviour."
  evidence test("gateway/policy-error-normalisation.test.ts")
  reviewer GatewayTeam
  decided_on "2026-06-02"
}
```

### 9.5 Final-forbid precedence

Memory Guards must not override final forbids.

This must still fail:

```shape
resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants HardDelete<AuditEvent>

  fn purgeOldEvents : SharpEdge
    effects complete {
      HardDelete<AuditEvent>
    }
}

memory PurgeIsKnown : HardFoughtKnowledge<fn AuditStore.purgeOldEvents> {
  applies_to fn AuditStore.purgeOldEvents
  status Explained
  confidence High
  summary "This is known behaviour."
  owner AuditTeam
}
```

Expected result:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
```

No memory can turn that into a pass.

---

## 10. Grammar changes

Target file:

```text
packages/shp-checker/src/language/shape.langium
```

### 10.1 Declaration union

Current:

```ebnf
Declaration:
    ResourceDecl | TraitDecl | ComponentDecl | ImplementationDecl | ChangeDecl | AttestationDecl | RuleDecl;
```

New:

```ebnf
Declaration:
    ResourceDecl
  | TraitDecl
  | ComponentDecl
  | ImplementationDecl
  | ChangeDecl
  | AttestationDecl
  | RuleDecl
  | RationaleDecl
  | MemoryDecl
  | ReevaluationDecl;
```

### 10.2 Function summary

Current:

```ebnf
FunctionSummary:
    'fn' name=ID
        source=SourceDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;
```

New:

```ebnf
FunctionSummary:
    'fn' name=ID
        shapeTraits=ShapeTraitList?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;
```

### 10.3 Shape trait list

```ebnf
ShapeTraitList:
    ':' traits+=TypeRef (',' traits+=TypeRef)*;
```

### 10.4 Description

MVP string form:

```ebnf
DescriptionDecl:
    'description' required?='required'? summary=STRING;
```

Future block form:

```ebnf
DescriptionDecl:
    'description' required?='required'? '{'
        summary=SummaryDecl
    '}';
```

Use the string form first.

### 10.5 Add/modify function changes

Current:

```ebnf
AddFunctionChange:
    'add' 'fn' component=ID '.' name=ID
        source=SourceDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;
```

New:

```ebnf
AddFunctionChange:
    'add' 'fn' component=ID '.' name=ID
        shapeTraits=ShapeTraitList?
        source=SourceDecl?
        description=DescriptionDecl?
        unsafe?='unsafe'?
        effects=EffectsDecl
        members+=FunctionMember*;
```

Same for `ModifyFunctionChange`.

### 10.6 Target references

```ebnf
TargetRef:
    kind=TargetKind name=QualifiedTargetName;

TargetKind returns string:
    'fn' | 'component' | 'resource' | 'implementation' | 'rule';

QualifiedTargetName returns string:
    ID ('.' ID)*;
```

### 10.7 Context type references

```ebnf
ContextTypeRef:
    name=ID '<' target=TargetRef '>';
```

### 10.8 Rationale

```ebnf
RationaleDecl:
    'rationale' name=ID ':' contextType=ContextTypeRef
    '{'
        members+=RationaleMember*
    '}';

RationaleMember:
    AppliesToDecl
  | WhyDecl
  | SummaryDecl
  | OwnerDecl
  | ReviewByDecl
  | ProtectsDecl
  | GuardDecl
  | EvidenceLineDecl;
```

### 10.9 Memory

```ebnf
MemoryDecl:
    'memory' name=ID ':' contextType=ContextTypeRef
    '{'
        members+=MemoryMember*
    '}';

MemoryMember:
    AppliesToDecl
  | StatusDecl
  | ConfidenceDecl
  | ProtectsDecl
  | GuardDecl
  | ObservedDecl
  | SummaryDecl
  | OwnerDecl
  | ReviewByDecl
  | EvidenceLineDecl;
```

### 10.10 Re-evaluation

```ebnf
ReevaluationDecl:
    'reevaluation' name=ID
    '{'
        members+=ReevaluationMember*
    '}';

ReevaluationMember:
    SatisfiesDecl
  | OutcomeDecl
  | SummaryDecl
  | EvidenceLineDecl
  | ReviewerDecl
  | ApproverDecl
  | DecidedOnDecl;
```

### 10.11 Shared members

```ebnf
AppliesToDecl:
    'applies_to' target=TargetRef;

WhyDecl:
    'why' reason=ID;

SummaryDecl:
    'summary' value=STRING;

OwnerDecl:
    'owner' value=ID;

ReviewByDecl:
    'review_by' value=STRING;

StatusDecl:
    'status' value=ID;

ConfidenceDecl:
    'confidence' value=ID;

ProtectsDecl:
    'protects' kind=ID value=ID;

GuardDecl:
    'guards' 'on_change' 'require' requirement=ContextTypeName;

ContextTypeName returns string:
    ID ('<' ID '>')?;

ObservedDecl:
    'observed' ref=SourceRef;

EvidenceLineDecl:
    'evidence' ref=SourceRef;

SatisfiesDecl:
    'satisfies' kind=ContextObjectKind name=ID;

ContextObjectKind returns string:
    'memory' | 'rationale';

OutcomeDecl:
    'outcome' value=ID;

ReviewerDecl:
    'reviewer' value=ID;

ApproverDecl:
    'approver' value=ID;

DecidedOnDecl:
    'decided_on' value=STRING;
```

This grammar keeps fields one-line and simple. That suits the current parser/formatter style.

---

## 11. AST/model changes

Target file:

```text
packages/shp-checker/src/checker.ts
```

Add internal types:

```ts
type TargetKind =
  | "fn"
  | "component"
  | "resource"
  | "implementation"
  | "rule";

type ShapeTarget = {
  kind: TargetKind;
  name: string;
};

type DescriptionInfo = {
  required: boolean;
  summary: string;
  provenance: Provenance;
};

type RationaleInfo = {
  name: string;
  contextType: string;
  target: ShapeTarget;
  appliesTo?: ShapeTarget;
  why?: string;
  summary?: string;
  owner?: string;
  reviewBy?: string;
  protects: ProtectedProperty[];
  guards: GuardInfo[];
  evidence: SourceRefInfo[];
  provenance: Provenance;
};

type MemoryInfo = {
  name: string;
  contextType: string;
  target: ShapeTarget;
  appliesTo?: ShapeTarget;
  status?: string;
  confidence?: string;
  summary?: string;
  owner?: string;
  reviewBy?: string;
  protects: ProtectedProperty[];
  guards: GuardInfo[];
  observed: SourceRefInfo[];
  evidence: SourceRefInfo[];
  provenance: Provenance;
};

type ReevaluationInfo = {
  name: string;
  satisfiesKind?: "memory" | "rationale";
  satisfiesName?: string;
  outcome?: string;
  summary?: string;
  evidence: SourceRefInfo[];
  reviewer?: string;
  approver?: string;
  decidedOn?: string;
  provenance: Provenance;
};

type ProtectedProperty = {
  kind: string;  // e.g. "shape", "description", "value"
  value: string; // e.g. "PreserveInline", "required", "CheckOrder"
  provenance: Provenance;
};

type GuardInfo = {
  requirement: string; // e.g. "ReEvaluation<Self>"
  provenance: Provenance;
};
```

Extend `FunctionInfo`:

```ts
type FunctionInfo = {
  component: string;
  name: string;
  source?: SourceRefInfo;
  unsafe: boolean;
  effects: EffectSummaryInfo;
  requires: TermInfo[];
  reason?: string;
  expires?: string;
  shapeTraits: Map<string, Provenance>;
  description?: DescriptionInfo;
  provenance: Provenance;
};
```

Extend `Model`:

```ts
type Model = {
  // existing fields
  rationales: Map<string, RationaleInfo>;
  memories: Map<string, MemoryInfo>;
  reevaluations: Map<string, ReevaluationInfo>;
  changeEvents: ChangeEvent[];
};
```

Add change events:

```ts
type ChangeEvent =
  | {
      kind: "function_modified";
      target: ShapeTarget;
      provenance: Provenance;
    }
  | {
      kind: "function_removed";
      target: ShapeTarget;
      provenance: Provenance;
    }
  | {
      kind: "shape_trait_removed";
      target: ShapeTarget;
      trait: string;
      provenance: Provenance;
    }
  | {
      kind: "description_removed";
      target: ShapeTarget;
      provenance: Provenance;
    };
```

MVP can start with only:

```ts
{ kind: "function_modified" }
{ kind: "function_removed" }
```

Then refine to property-level deltas later.

---

## 12. Fact model changes

Extend the existing `Fact` union.

Add:

```text
| {
    kind: "shape_trait";
    targetKind: TargetKind;
    target: string;
    trait: string;
    provenance: Provenance;
  }
| {
    kind: "description";
    targetKind: TargetKind;
    target: string;
    required: boolean;
    summary: string;
    provenance: Provenance;
  }
| {
    kind: "context_required";
    targetKind: TargetKind;
    target: string;
    contextType: string;
    requiredBy: string;
    provenance: Provenance;
  }
| {
    kind: "rationale";
    name: string;
    contextType: string;
    targetKind: TargetKind;
    target: string;
    provenance: Provenance;
  }
| {
    kind: "memory";
    name: string;
    contextType: string;
    targetKind: TargetKind;
    target: string;
    provenance: Provenance;
  }
| {
    kind: "reevaluation";
    name: string;
    satisfiesKind: "memory" | "rationale";
    satisfies: string;
    provenance: Provenance;
  }
| {
    kind: "protected_shape";
    guardKind: "memory" | "rationale";
    guard: string;
    targetKind: TargetKind;
    target: string;
    propertyKind: string;
    propertyValue: string;
    provenance: Provenance;
  }
| {
    kind: "guard_requires_reevaluation";
    guardKind: "memory" | "rationale";
    guard: string;
    targetKind: TargetKind;
    target: string;
    provenance: Provenance;
  }
```

---

## 13. New diagnostics

Extend `SemanticDiagnostic`.

### 13.1 Missing required context

```text
| {
    kind: "missing_required_context";
    targetKind: TargetKind;
    target: string;
    requiredContext: string;
    requiredBy: string;
    filePath?: string;
    causedBy: string[];
  }
```

Diagnostic text:

```text
error: missing required context

fn Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.

No matching rationale or memory found.

caused by:
  - gateway.shape: fn Gateway.derivePolicyDecision : PreserveInline
  - standard prelude: PreserveInline requires InlineRationale
```

### 13.2 Invalid context target

```text
| {
    kind: "invalid_context_target";
    contextKind: "rationale" | "memory";
    name: string;
    targetKind: TargetKind;
    target: string;
    filePath?: string;
    causedBy: string[];
  }
```

Diagnostic text:

```text
error: invalid context target

rationale DerivePolicyDecisionInline applies to fn Gateway.missingFunction,
but that target is not declared.
```

### 13.3 Context target mismatch

```text
| {
    kind: "context_target_mismatch";
    contextKind: "rationale" | "memory";
    name: string;
    declaredTarget: string;
    appliesToTarget: string;
    filePath?: string;
    causedBy: string[];
  }
```

Example:

```shape
rationale X : InlineRationale<fn Gateway.a> {
  applies_to fn Gateway.b
}
```

This should fail.

### 13.4 Missing required description

```text
| {
    kind: "missing_required_description";
    targetKind: TargetKind;
    target: string;
    requiredBy: string;
    filePath?: string;
    causedBy: string[];
  }
```

### 13.5 Guarded shape changed

```text
| {
    kind: "guarded_shape_changed";
    guardKind: "memory" | "rationale";
    guard: string;
    targetKind: TargetKind;
    target: string;
    missingReevaluation: string;
    filePath?: string;
    causedBy: string[];
  }
```

Diagnostic text:

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DoNotReorderPolicyChecks.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DoNotReorderPolicyChecks
  or preserve the protected shape.
```

### 13.6 Invalid re-evaluation

```text
| {
    kind: "invalid_reevaluation";
    name: string;
    reason: string;
    filePath?: string;
    causedBy: string[];
  }
```

Example reasons:

```text
unknown satisfied memory
missing outcome
missing evidence
missing reviewer or approver
missing decided_on
```

---

## 14. Checker functions to add

Add these functions to `checker.ts`.

```text
function lowerRationale(...)
function lowerMemory(...)
function lowerReevaluation(...)
function lowerDescription(...)
function lowerShapeTraits(...)
```

Add these check stages after `checkResolvedNames` and before `checkFunctions`, or after `checkFunctions` if easier.

```ts
function checkRequiredContext(model: Model): SemanticDiagnostic[]
function checkContextTargets(model: Model): SemanticDiagnostic[]
function checkRequiredDescriptions(model: Model): SemanticDiagnostic[]
function checkGuardedChanges(model: Model): SemanticDiagnostic[]
function checkReevaluations(model: Model): SemanticDiagnostic[]
```

Update `checkShapeModules`:

```ts
const diagnostics = [
  ...model.diagnostics,
  ...checkResolvedNames(model),
  ...checkContextTargets(model),
  ...checkRequiredContext(model),
  ...checkRequiredDescriptions(model),
  ...checkReevaluations(model),
  ...checkGuardedChanges(model),
  ...checkFunctions(model),
  ...checkProvidesRules(model),
  ...checkDependencyCycles(model),
  ...checkCoverage(model, options.changedFiles ?? [])
];
```

Ordering note:

```text
checkFunctions still owns final forbids and missing grants.
Memory Guards should not suppress those errors.
```

---

## 15. Prelude obligation mapping

Start hardcoded.

```ts
type ContextRequirementRule = {
  trait: string;
  targetKind: TargetKind;
  contextType: string;
  satisfiedBy: ("rationale" | "memory")[];
  requiresDescription?: boolean;
};

const PRELUDE_CONTEXT_REQUIREMENTS: ContextRequirementRule[] = [
  {
    trait: "PreserveInline",
    targetKind: "fn",
    contextType: "InlineRationale",
    satisfiedBy: ["rationale"]
  },
  {
    trait: "RequiresDescription",
    targetKind: "fn",
    contextType: "DescriptionRationale",
    satisfiedBy: ["rationale"],
    requiresDescription: true
  },
  {
    trait: "ProtectedCheckOrder",
    targetKind: "fn",
    contextType: "CheckOrderRationale",
    satisfiedBy: ["rationale", "memory"]
  },
  {
    trait: "SharpEdge",
    targetKind: "fn",
    contextType: "HardFoughtKnowledge",
    satisfiedBy: ["memory"]
  },
  {
    trait: "NonIdiomatic",
    targetKind: "fn",
    contextType: "DesignRationale",
    satisfiedBy: ["rationale", "memory"]
  }
];
```

Later this can be expressed in Shape syntax:

```shape
trait PreserveInline<T: Fn> {
  require_context InlineRationale<T>
}
```

Do not implement that user-defined `require_context` syntax until the MVP works.

---

## 16. Guard semantics MVP

MVP guard semantics should be deliberately coarse.

A memory/rationale with:

```shape
guards on_change require ReEvaluation<Self>
```

means:

```text
any modify/remove change touching the same target requires a matching reevaluation
```

Do not initially try to detect exact transform kinds like `ExtractHelper` or `RemoveDescription`.

Initial rule:

```text
if changeEvents contains target T
and active guard applies to target T
and no reevaluation satisfies that guard
then fail
```

Later refinement:

```text
detect shape_trait_removed
detect description_removed
detect protected property changed
detect relation kind changed
detect dependency removed/added
detect transform labels from change files
```

---

## 17. Re-evaluation validity

A `reevaluation` is valid if:

```text
satisfies points to an existing memory/rationale
outcome is present
summary is present
evidence is present
decided_on is present
reviewer or approver is present
```

Recommended initial strictness:

```text
reviewer required
approver optional
```

For safety/security-critical memories, later add policy requiring approver.

MVP should not need role validation. It only checks structure.

---

## 18. Formatter changes

Target file:

```text
packages/shp-checker/src/formatter.ts
```

Add formatting support for:

```text
function shape traits
description
rationale
memory
reevaluation
```

Canonical ordering:

```text
trait declarations
resource declarations
component declarations
implementation declarations
rule declarations
rationale declarations
memory declarations
reevaluation declarations
attestations
change declarations
```

Within a function:

```text
fn NAME : sorted traits
  source ...
  description ...
  unsafe/effects ...
  requires ...
  reason ...
  expires ...
```

Within rationale:

```text
applies_to
why
summary
owner
review_by
protects
guards
evidence
```

Within memory:

```text
applies_to
status
confidence
summary
owner
review_by
protects
guards
observed
evidence
```

Within reevaluation:

```text
satisfies
outcome
summary
reviewer
approver
decided_on
evidence
```

Keep one semantic claim per line.

---

## 19. CLI changes

Target file:

```text
packages/shp-cli/src/index.ts
```

Add commands:

```bash
shp memory [files...]
shp obligations [files...]
```

### 19.1 `shp memory`

Purpose: list active Memory Guards.

Example output:

```text
Memory Guards

fn Gateway.derivePolicyDecision
  rationale DerivePolicyDecisionInline
  type: InlineRationale
  protects: PreserveInline, description required
  owner: GatewayTeam

fn BridgePoller.pollAttestation
  memory BridgeRetryDelaySharpEdge
  type: HardFoughtKnowledge
  status: Unexplained
  confidence: High
  owner: BridgeTeam
  review_by: 2026-09-01
```

### 19.2 `shp obligations`

Purpose: list missing required context, missing descriptions, stale memories, and re-evaluation requirements.

Example output:

```text
Open Shape Obligations

missing context:
  fn Gateway.derivePolicyDecision requires InlineRationale

missing description:
  fn Gateway.derivePolicyDecision requires description

guarded changes:
  fn Gateway.derivePolicyDecision changed; requires reevaluation of DoNotReorderPolicyChecks
```

Implementation shortcut:

```text
shp obligations can run checker with includeFacts and print diagnostics of relevant kinds.
```

---

## 20. Authoring helper changes

Target file:

```text
packages/shp-checker/src/authoring.ts
```

Update `buildShapeAuthorPrompt` with:

```text
- If adding PreserveInline, RequiresDescription, ProtectedCheckOrder, SharpEdge, or NonIdiomatic, include matching rationale or memory.
- If modifying/removing a function protected by memory/rationale, include a reevaluation.
- Use memory with status Unexplained when the team knows something matters but cannot yet fully explain why.
- Do not use rationale or memory to waive final forbidden effects.
- Keep summaries short. Link longer evidence through source/evidence refs.
```

Update `buildShapeCriticPrompt` with:

```text
- Did the delta add shape traits without matching context?
- Did the delta touch a guarded target without reevaluation?
- Did the delta remove a required description?
- Are memory/rationale blocks compact and typed rather than generic prose?
- Did the delta try to justify a final forbidden effect instead of preserving the error?
```

Update `generateShapeDelta` optionally:

```text
type ShapeDeltaInput = {
  ...
  includeMemoryGuardScaffold?: boolean;
};
```

When true, generate:

```shape
memory ReviewChangedShape : HardFoughtKnowledge<fn Component.reviewChangeShape1> {
  applies_to fn Component.reviewChangeShape1
  status Unexplained
  confidence Medium
  summary "TODO: replace with hard-fought knowledge or remove this memory."
  owner TODO
}
```

Do not overuse this scaffold. It is mainly useful for manual authoring.

---

## 21. Editor support changes

Target file:

```text
packages/shp-checker/src/editor.ts
```

Add:

```text
hover over PreserveInline shows required InlineRationale
hover over rationale shows target and protected shapes
hover over memory shows status/confidence/owner
completion suggests known shape traits
completion suggests known rationale/memory names in reevaluation
go-to-definition from required context to matching rationale/memory
diagnostics include missing context and guarded-change errors
```

This can be shallow initially:

```text
reuse checkShapeModules for diagnostics
reuse explainShapeModules for hover
add known prelude shape trait completions
```

---

## 22. Explain output changes

Current `shp explain SYMBOL` should be extended.

For a function:

```text
Gateway.derivePolicyDecision
  kind: function

  shape traits:
    PreserveInline
    RequiresDescription

  description:
    required
    "Policy decision branches remain local for auditability."

  required context:
    InlineRationale<fn Gateway.derivePolicyDecision>
    DescriptionRationale<fn Gateway.derivePolicyDecision>

  satisfied by:
    rationale DerivePolicyDecisionInline

  memory guards:
    memory DoNotReorderPolicyChecks
      status: Unexplained
      confidence: High

  effects:
    Read<PolicySnapshot>
    Emit<DecisionLog>
```

For a rationale:

```text
DerivePolicyDecisionInline
  kind: rationale
  type: InlineRationale
  target: fn Gateway.derivePolicyDecision
  owner: GatewayTeam
  protects:
    shape PreserveInline
```

For a memory:

```text
DoNotReorderPolicyChecks
  kind: memory
  type: HardFoughtKnowledge
  target: fn Gateway.derivePolicyDecision
  status: Unexplained
  confidence: High
  owner: GatewayTeam
  guards:
    on_change require ReEvaluation<Self>
```

---

## 23. Test plan

Target file:

```text
packages/shp-checker/src/checker.test.ts
```

Add parser tests:

```text
parses function shape traits
parses description
parses rationale
parses memory
parses reevaluation
parses change-file function shape traits
```

Add checker tests:

```text
PreserveInline without rationale fails
PreserveInline with InlineRationale passes
rationale with wrong target fails
rationale with unknown target fails
RequiresDescription without description fails
RequiresDescription with description passes
SharpEdge without memory fails
SharpEdge with HardFoughtKnowledge memory passes
memory with wrong target fails
modify guarded function without reevaluation fails
modify guarded function with reevaluation passes
remove guarded function without reevaluation fails
final forbidden effect still fails despite memory
```

Add formatter tests:

```text
formats function shape traits in sorted order
formats description
formats rationale
formats memory
formats reevaluation
preserves canonical declaration order
```

Add CLI tests if the repo has CLI fixture tests; otherwise add smoke tests through `bun shp`.

---

## 24. Fixtures

Add:

```text
fixtures/pass/memory_guard_preserve_inline/
fixtures/fail/memory_guard_missing_rationale/
fixtures/fail/memory_guard_wrong_target/
fixtures/fail/memory_guard_unknown_target/
fixtures/fail/memory_guard_modify_without_reevaluation/
fixtures/pass/memory_guard_modify_with_reevaluation/
fixtures/fail/memory_guard_required_description_missing/
fixtures/pass/memory_guard_required_description_present/
fixtures/pass/memory_guard_hard_fought_unknown/
fixtures/fail/memory_guard_does_not_override_final_forbid/
```

### 24.1 Fail: missing rationale

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : PreserveInline
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Expected:

```text
missing required context
InlineRationale<fn Gateway.derivePolicyDecision>
```

### 24.2 Pass: rationale present

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : PreserveInline
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}
```

### 24.3 Fail: guarded change without re-evaluation

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : SharpEdge
    effects complete {
      Read<PolicySnapshot>
    }
}

memory DoNotTouchDecisionShape : HardFoughtKnowledge<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  guards on_change require ReEvaluation<Self>
  summary "Previous refactors broke error normalisation."
  owner GatewayTeam
}

change RefactorDecision {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Expected:

```text
guarded shape changed
requires reevaluation satisfying memory DoNotTouchDecisionShape
```

### 24.4 Pass: guarded change with re-evaluation

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : SharpEdge
    effects complete {
      Read<PolicySnapshot>
    }
}

memory DoNotTouchDecisionShape : HardFoughtKnowledge<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  guards on_change require ReEvaluation<Self>
  summary "Previous refactors broke error normalisation."
  owner GatewayTeam
}

change RefactorDecision {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}

reevaluation DecisionShapeRechecked {
  satisfies memory DoNotTouchDecisionShape
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  evidence test("gateway/error-normalisation.test.ts")
  reviewer GatewayTeam
  decided_on "2026-06-02"
}
```

---

## 25. Milestones

### Milestone 1 — Function shape traits and descriptions

Deliver:

```text
grammar support for fn NAME : TraitA, TraitB
grammar support for description required "..."
same support in add/modify function changes
formatter support
parser tests
formatter tests
```

Definition of done:

```text
shape traits parse and format
description parses and formats
generated AST compiles
existing tests still pass
```

### Milestone 2 — Fact lowering for shape traits and descriptions

Deliver:

```text
FunctionInfo.shapeTraits
FunctionInfo.description
shape_trait facts
description facts
explain output for function shape traits and description
```

Definition of done:

```text
includeFacts exposes shape_trait and description
shp explain shows shape traits and description
existing checker behaviour unchanged
```

### Milestone 3 — Prelude context obligations

Deliver:

```text
hardcoded PRELUDE_CONTEXT_REQUIREMENTS
context_required facts
missing_required_context diagnostic
missing_required_description diagnostic
checker stage for required context
```

Definition of done:

```text
PreserveInline without rationale fails
RequiresDescription without description fails
feature does not affect final-forbid behaviour
```

### Milestone 4 — Rationale declarations

Deliver:

```text
rationale grammar
RationaleInfo
lowerRationale
rationale facts
context satisfaction check
formatter support
tests
```

Definition of done:

```text
PreserveInline with matching InlineRationale passes
wrong-target rationale fails
unknown-target rationale fails
```

### Milestone 5 — Memory declarations

Deliver:

```text
memory grammar
MemoryInfo
lowerMemory
memory facts
HardFoughtKnowledge satisfaction
formatter support
tests
```

Definition of done:

```text
SharpEdge with matching memory passes
SharpEdge without memory fails
memory can use status Unexplained and confidence High
```

### Milestone 6 — Re-evaluation declarations

Deliver:

```text
reevaluation grammar
ReevaluationInfo
lowerReevaluation
reevaluation facts
basic validity checks
formatter support
tests
```

Definition of done:

```text
reevaluation must satisfy existing memory/rationale
reevaluation must include outcome, summary, evidence, reviewer, decided_on
invalid reevaluation fails
```

### Milestone 7 — Guarded change detection

Deliver:

```text
changeEvents array in Model
emit function_modified and function_removed events from lowerChange
guarded_shape_changed diagnostic
guarded changes require matching reevaluation
tests
```

Definition of done:

```text
modify guarded fn without reevaluation fails
modify guarded fn with reevaluation passes
remove guarded fn without reevaluation fails
remove unguarded fn passes
```

### Milestone 8 — CLI commands

Deliver:

```text
shp memory
shp obligations
usage text update
manual smoke tests
```

Definition of done:

```text
shp memory prints rationales/memories by target
shp obligations prints missing context, missing descriptions, guarded changes
```

### Milestone 9 — Authoring/editor updates

Deliver:

```text
authoring prompt updates
critic prompt updates
completion additions
hover additions
definition support for rationale/memory targets
editor diagnostics already use checker
```

Definition of done:

```text
LLM prompt tells agents to include rationale/memory/reevaluation
hover explains PreserveInline requirement
completion suggests PreserveInline, RequiresDescription, SharpEdge
```

### Milestone 10 — Optional richer guards

Do not build until MVP works.

Possible additions:

```text
specific transform guards: ExtractHelper, RemoveDescription, SplitDecisionTree
property-level change detection
component/resource shape traits
dependency target support
expiry/review freshness checking
typed role/approver policy
nested what/why/how/who/when blocks
```

---

## 26. Implementation notes

### 26.1 Keep Memory Guards separate from acceptances/waivers

Do not implement `acceptance` or `waiver` in this feature.

Memory Guards are about preserving shape knowledge and blocking unsafe refactors. Waivers are about accepted violations. They are different.

### 26.2 Keep prose short

The grammar should permit:

```shape
summary "..."
```

but should not encourage long paragraphs.

Longer detail should be linked through:

```shape
evidence issue("ENG-1842")
evidence adr("ADR-0042")
evidence test("gateway/policy-error-normalisation.test.ts")
```

### 26.3 Preserve deterministic checking

The checker must not call an LLM.

The LLM can author the blocks. The checker validates the blocks.

### 26.4 Do not overfit target references

Start with function targets:

```shape
fn Component.functionName
```

Then add component/resource/dependency targets later.

Function targets give the strongest immediate value and fit current function-summary shape.

### 26.5 Avoid deep generic type theory in MVP

Treat:

```shape
InlineRationale<fn Gateway.derivePolicyDecision>
```

as a structured context type:

```ts
{
  contextType: "InlineRationale",
  targetKind: "fn",
  target: "Gateway.derivePolicyDecision"
}
```

Do not attempt general generic unification yet.

---

## 27. Example final behaviour

Input:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : PreserveInline, RequiresDescription
    description required "Policy decision branches remain local for auditability."
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy decision branches remain local for auditability."
  owner GatewayTeam
}
```

Expected:

```text
Shape check passed.
```

Input:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : PreserveInline
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Expected:

```text
error: missing required context

fn Gateway.derivePolicyDecision has shape PreserveInline.
PreserveInline requires InlineRationale<fn Gateway.derivePolicyDecision>.

No matching rationale or memory found.
```

Input:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>

  fn derivePolicyDecision : SharpEdge
    effects complete {
      Read<PolicySnapshot>
    }
}

memory DoNotTouchDecisionShape : HardFoughtKnowledge<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  guards on_change require ReEvaluation<Self>
  summary "Previous refactors broke error normalisation."
  owner GatewayTeam
}

change RefactorDecision {
  modify fn Gateway.derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}
```

Expected:

```text
error: guarded shape changed

fn Gateway.derivePolicyDecision is protected by memory DoNotTouchDecisionShape.
This change modifies the guarded target.

Required:
  add reevaluation satisfying memory DoNotTouchDecisionShape
  or preserve the protected shape.
```

---

## 28. Final acceptance criteria

Memory Guards are implemented when:

```text
1. Functions can declare shape traits.
2. Functions can declare compact descriptions.
3. PreserveInline derives a required InlineRationale.
4. RequiresDescription derives a required description and DescriptionRationale.
5. SharpEdge derives a required HardFoughtKnowledge memory.
6. Rationale blocks can satisfy rationale obligations.
7. Memory blocks can satisfy hard-fought knowledge obligations.
8. Memory/rationale guards can block change-file modifications.
9. Re-evaluation blocks can satisfy guarded changes.
10. Final forbidden effects remain final and cannot be bypassed by memory/rationale.
11. Formatter supports all new syntax.
12. Tests cover pass/fail fixtures.
13. CLI exposes memory/obligations or equivalent explain output.
14. Authoring prompts tell LLMs how to use Memory Guards without turning them into excuses.
```

---

## 29. Recommended next commit sequence

1. `grammar: add function shape traits and descriptions`
2. `checker: lower shape traits and descriptions into facts`
3. `checker: add prelude context obligations`
4. `checker: report missing rationale and description obligations`
5. `grammar: add rationale declarations`
6. `checker: lower rationale and satisfy context obligations`
7. `grammar: add memory declarations`
8. `checker: lower memory and satisfy HardFoughtKnowledge`
9. `grammar: add reevaluation declarations`
10. `checker: track change events and enforce guarded changes`
11. `cli: add memory and obligations commands`
12. `authoring: update prompts for Memory Guards`
13. `editor: add completions and hover for Memory Guards`
14. `docs: document Memory Guards in README and examples`

---

## 30. One-line product description

Memory Guards let Shape typecheck not just architectural facts, but the design memory that must exist before future humans or agents are allowed to change those facts.
