// Checker data model: the effective-model and fact/diagnostic shapes the rest
// of the checker reads and writes. This module is deliberately behavior-free —
// it defines data shapes only. Lowering, rules, diagnostics, and query output
// all import their types from here so there is a single source of truth for the
// model and no behavioral module owns the shared vocabulary.
import type {
  AddFunctionChange,
  FunctionSummary,
  ModifyFunctionChange,
  ShapeModule,
  TargetKind
} from "../language/generated/ast.ts";
import type { ContextKind } from "../prelude.ts";
import type { ParseDiagnostic } from "../parser.ts";
import type { ChangeTrigger } from "../memory-guards.ts";

export type SemanticDiagnostic =
  | {
      kind: "final_forbidden_effect";
      component: string;
      functionName: string;
      effect: string;
      target: string;
      trait: string;
      evidence?: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "missing_grant";
      component: string;
      functionName: string;
      effect: string;
      target: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "unknown_effects";
      component: string;
      functionName: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "unknown_name";
      nameKind: "resource" | "component" | "trait" | "relation_endpoint";
      name: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "ambiguous_name";
      nameKind: DeclarationKind | "relation_endpoint";
      name: string;
      matches: string[];
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "invalid_rule";
      rule: string;
      reason: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "duplicate_declaration";
      declarationKind:
        | "resource"
        | "component"
        | "trait"
        | "relation"
        | "candidate_effect"
        | "binding"
        | "rationale"
        | "memory"
        | "reevaluation";
      name: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "duplicate_fingerprint";
      resource: string;
      provider: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "missing_shape_update";
      changedFile: string;
      implementation: string;
      glob: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "missing_bound_docs_change";
      binding: string;
      changedFile: string;
      requiredPaths: string[];
      attestationKinds: string[];
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "forbidden_hypercycle";
      rule: string;
      vertices: string[];
      hyperedges: { name: string; kind: string }[];
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "forbidden_provides";
      rule: string;
      provider: string;
      target: string;
      hyperedge: string;
      allowedComponent?: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "fingerprint_mismatch";
      relation: string;
      endpoint: string;
      provider: string;
      expected: string;
      actual?: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "candidate_pin_fingerprint_mismatch";
      candidateEffect: string;
      anchor: string;
      provider: string;
      expected: string;
      actual?: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "invalid_candidate_effect";
      name: string;
      reason: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "unsafe_effects";
      component: string;
      functionName: string;
      missing: string[];
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "missing_required_context";
      targetKind: TargetKind;
      target: string;
      requiredContext: string;
      requiredBy: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "invalid_context_target";
      contextKind: ContextKind;
      name: string;
      targetKind: TargetKind;
      target: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "context_target_mismatch";
      contextKind: ContextKind;
      name: string;
      declaredTarget: ShapeTarget;
      appliesToTarget: ShapeTarget;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "missing_required_description";
      targetKind: TargetKind;
      target: string;
      requiredBy: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "guarded_shape_changed";
      guardKind: ContextKind;
      guard: string;
      targetKind: TargetKind;
      target: string;
      changedProperty?: string;
      changeKind?: "property" | "transform";
      missingReevaluation: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "invalid_reevaluation";
      name: string;
      reason: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "stale_memory";
      guardKind: ContextKind;
      guard: string;
      targetKind: TargetKind;
      target: string;
      reviewBy: string;
      asOf: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "invalid_relation";
      name: string;
      reason: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "invalid_require_context";
      trait: string;
      contextType: string;
      typeParam: string;
      reason: string;
      filePath?: string;
      causedBy: string[];
    };

export type ShapeDiagnostic = ParseDiagnostic | SemanticDiagnostic;

export type CheckResult = {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  diagnostics: ShapeDiagnostic[];
  facts?: Fact[];
};

export type CheckOptions = {
  changedFiles?: string[];
  enforceBindings?: boolean;
  includeFacts?: boolean;
  /**
   * When set to an ISO `YYYY-MM-DD` date, design memory whose `review_by` is
   * strictly before this date is reported as stale. Absent disables freshness
   * checking. The checker never reads the system clock; callers inject the date
   * so checking stays deterministic.
   */
  freshnessDate?: string;
};

export type Fact =
  | { kind: "resource"; name: string; provenance: Provenance }
  | { kind: "resource_trait"; resource: string; trait: string; provenance: Provenance }
  | {
      kind: "resource_fingerprint";
      resource: string;
      provider: string;
      value: string;
      provenance: Provenance;
    }
  | {
      kind: "trait_final_forbid";
      trait: string;
      effect: string;
      target: string;
      provenance: Provenance;
    }
  | { kind: "component"; name: string; provenance: Provenance }
  | { kind: "owns"; component: string; resource: string; provenance: Provenance }
  | { kind: "grants"; component: string; effect: string; target: string; provenance: Provenance }
  | {
      kind: "hyperedge";
      name: string;
      relationKind: string;
      ordered: boolean;
      provenance: Provenance;
    }
  | {
      kind: "hyperedge_member";
      hyperedge: string;
      endpoint: string;
      index: number;
      role?: string;
      provenance: Provenance;
    }
  | {
      kind: "hyperedge_fingerprint_expectation";
      hyperedge: string;
      endpoint: string;
      provider: string;
      value: string;
      provenance: Provenance;
    }
  | { kind: "function"; component: string; name: string; provenance: Provenance }
  | {
      kind: "effect";
      component: string;
      functionName: string;
      effect: string;
      target: string;
      provenance: Provenance;
    }
  | { kind: "effect_unknown"; component: string; functionName: string; provenance: Provenance }
  | {
      kind: "candidate_effect";
      name: string;
      functionTarget: string;
      effect: string;
      target: string;
      source?: SourceRefInfo;
      confidence?: string;
      anchor?: string;
      fingerprintProvider?: string;
      fingerprintValue?: string;
      provenance: Provenance;
    }
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
      satisfiesKind: ContextKind;
      satisfies: string;
      provenance: Provenance;
    }
  | {
      kind: "protected_shape";
      guardKind: ContextKind;
      guard: string;
      targetKind: TargetKind;
      target: string;
      propertyKind: string;
      propertyValue: string;
      provenance: Provenance;
    }
  | {
      kind: "guard_requires_reevaluation";
      guardKind: ContextKind;
      guard: string;
      targetKind: TargetKind;
      target: string;
      provenance: Provenance;
    }
  | { kind: "implementation"; name: string; provenance: Provenance }
  | { kind: "implementation_path"; implementation: string; glob: string; provenance: Provenance }
  | { kind: "conforms_to"; implementation: string; component: string; provenance: Provenance }
  | { kind: "binding"; name: string; provenance: Provenance }
  | { kind: "binding_when_changed"; binding: string; glob: string; provenance: Provenance }
  | { kind: "binding_require_changed"; binding: string; glob: string; provenance: Provenance }
  | { kind: "binding_allow_attest"; binding: string; kindName: string; provenance: Provenance }
  | { kind: "shape_update_for"; path: string; provenance: Provenance }
  | { kind: "attestation"; kindName: string; path: string; reason: string; provenance: Provenance }
  | { kind: "rule"; name: string; provenance: Provenance };

export type CheckModuleOrigin = "authored" | "generated_ast";

export type CheckModuleInput = {
  module: ShapeModule;
  filePath?: string;
  origin?: CheckModuleOrigin;
};

export type ModuleInfo = {
  name: string;
  imports: string[];
  filePath?: string;
  generatedAst: boolean;
};

export type LoweringContext = ModuleInfo;

export type DeclarationKind =
  | "resource"
  | "component"
  | "trait"
  | "relation"
  | "candidate_effect"
  | "implementation"
  | "binding"
  | "rationale"
  | "memory"
  | "reevaluation"
  | "rule";

export type DeclarationIndex = Record<DeclarationKind, Map<string, Set<string>>>;

export type ResolutionResult =
  | { kind: "resolved"; name: string }
  | { kind: "unknown"; name: string }
  | { kind: "ambiguous"; name: string; matches: string[] };

export type Provenance = {
  filePath?: string;
  label: string;
};

export type TermInfo = {
  name: string;
  target?: string;
};

export type EffectEntryInfo = {
  term: TermInfo;
  evidence?: SourceRefInfo;
  provenance: Provenance;
};

export type EffectSummaryInfo =
  | {
      kind: "complete";
      entries: EffectEntryInfo[];
    }
  | {
      kind: "unknown";
    };

export type ShapeTarget = {
  kind: TargetKind;
  name: string;
};

export type DescriptionInfo = {
  required: boolean;
  summary: string;
  provenance: Provenance;
};

export type ProtectedProperty = {
  kind: string;
  value: string;
  // For `protects shape <trait>`, the trait name resolved into the same key
  // space as classifier and `shape_trait_removed` events (module-qualified
  // where applicable), so property-level guard matching can compare like for
  // like. Undefined for non-shape properties; free-form `shape` labels resolve
  // to a name that matches no declared trait and so stay coarse.
  resolvedValue?: string;
  provenance: Provenance;
};

export type GuardInfo = {
  requirement: string;
  provenance: Provenance;
};

export type TransformGuardInfo = {
  label: string;
  provenance: Provenance;
};

export type PolicyInfo = {
  name: string;
  requiresApprover: boolean;
  provenance: Provenance;
};

/**
 * A context obligation a trait imposes on its bearer. Built-in obligations are
 * seeded onto prelude traits with a "standard prelude" provenance; user traits
 * populate these from their `require_context` members. Storing them on the
 * trait (rather than a global sidecar) means obligations follow the trait
 * through declare/modify/remove, and a same-named user trait shadows a built-in
 * simply by replacing the trait entry — no merge or scrub special-case.
 */
export type TraitContextRequirement = {
  targetKind: TargetKind;
  contextType: string;
  satisfiedBy: ContextKind[];
  requiresDescription: boolean;
  provenance: Provenance;
};

/** A trait context requirement resolved against a bearer, tagged with the
 *  owning trait name for diagnostics. */
export type ContextRequirement = TraitContextRequirement & { trait: string };

export type RationaleInfo = {
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
  forbiddenTransforms: TransformGuardInfo[];
  evidence: SourceRefInfo[];
  provenance: Provenance;
};

export type MemoryInfo = {
  name: string;
  contextType: string;
  target: ShapeTarget;
  appliesTo?: ShapeTarget;
  status?: string;
  confidence?: string;
  summary?: string;
  owner?: string;
  reviewBy?: string;
  sensitive: boolean;
  protects: ProtectedProperty[];
  guards: GuardInfo[];
  forbiddenTransforms: TransformGuardInfo[];
  observed: SourceRefInfo[];
  evidence: SourceRefInfo[];
  provenance: Provenance;
};

export type ContextObjectInfo = {
  name: string;
  contextType: string;
  target: ShapeTarget;
  appliesTo?: ShapeTarget;
  summary?: string;
  owner?: string;
  reviewBy?: string;
  protects: ProtectedProperty[];
  guards: GuardInfo[];
  forbiddenTransforms: TransformGuardInfo[];
  evidence: SourceRefInfo[];
  provenance: Provenance;
};

export type ReevaluationInfo = {
  name: string;
  satisfiesKind?: ContextKind;
  satisfiesName?: string;
  outcome?: string;
  summary?: string;
  evidence: SourceRefInfo[];
  reviewer?: string;
  approver?: string;
  decidedOn?: string;
  provenance: Provenance;
};

// Observed changes are modelled by memory-guards as ChangeTrigger; the checker
// emits them while lowering `change` declarations.
export type ChangeEvent = ChangeTrigger;

export type FunctionInfo = {
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
  generatedAstCandidate: boolean;
  provenance: Provenance;
};

export type ResourceInfo = {
  name: string;
  traits: Map<string, Provenance>;
  fingerprints: Map<string, FingerprintInfo>;
  generatedAstCandidate: boolean;
  provenance: Provenance;
};

export type FingerprintInfo = {
  provider: string;
  value: string;
  provenance: Provenance;
};

export type TraitInfo = {
  name: string;
  typeParams: string[];
  finalForbids: FinalForbidPattern[];
  contextRequirements: TraitContextRequirement[];
  provenance: Provenance;
};

export type FinalForbidPattern = {
  effect: string;
  target?: string;
  targetBinding: "omitted" | "generic" | "concrete" | "ambiguous";
  final: boolean;
  provenance: Provenance;
};

export type ComponentInfo = {
  name: string;
  classifiers: Map<string, Provenance>;
  grants: Map<string, Provenance>;
  owns: Map<string, Provenance>;
  functions: Map<string, FunctionInfo>;
  generatedAstCandidate: boolean;
  provenance: Provenance;
};

export type ImplementationInfo = {
  name: string;
  paths: { glob: string; provenance: Provenance }[];
  conformsTo?: string;
  onChangeRequirement?: string;
  provenance: Provenance;
};

export type BindingInfo = {
  name: string;
  whenChanged: { glob: string; provenance: Provenance }[];
  requireChanged: { glob: string; provenance: Provenance }[];
  allowAttestations: { kind: string; provenance: Provenance }[];
  provenance: Provenance;
};

export type RuleInfo = {
  name: string;
  whenHas: { subject: string; trait: string }[];
  finalForbidSubject?: string;
  forbidEffects: FinalForbidPattern[];
  forbidProvides: {
    target: string;
    except?: string;
    provenance: Provenance;
  }[];
  forbidHypercycles: {
    kinds: string[];
    provenance: Provenance;
  }[];
  provenance: Provenance;
};

export type SourceRefInfo = {
  language: string;
  path: string;
};

export type HyperedgeMember = {
  endpoint: string;
  index: number;
  role?: string;
};

export type HyperedgeInfo = {
  name: string;
  kind: string;
  ordered: boolean;
  members: HyperedgeMember[];
  fingerprintExpectations: FingerprintExpectationInfo[];
  summary?: string;
  provenance: Provenance;
};

export type FingerprintExpectationInfo = {
  endpoint: string;
  provider: string;
  value: string;
  provenance: Provenance;
};

export type Hypergraph = {
  edges: Map<string, HyperedgeInfo>;
  /** vertex name -> hyperedge names incident to that vertex */
  incidence: Map<string, string[]>;
};

export type Model = {
  modules: Map<string, ModuleInfo>;
  declarations: DeclarationIndex;
  resources: Map<string, ResourceInfo>;
  traits: Map<string, TraitInfo>;
  components: Map<string, ComponentInfo>;
  hypergraph: Hypergraph;
  candidateEffects: Map<string, CandidateEffectInfo>;
  implementations: ImplementationInfo[];
  bindings: Map<string, BindingInfo>;
  rules: RuleInfo[];
  rationales: Map<string, RationaleInfo>;
  memories: Map<string, MemoryInfo>;
  reevaluations: Map<string, ReevaluationInfo>;
  roles: Map<string, Provenance>;
  policies: Map<string, PolicyInfo>;
  attestations: { kind: string; path: string; reason: string; provenance: Provenance }[];
  shapeUpdatePaths: Map<string, Provenance[]>;
  changeEvents: ChangeEvent[];
  facts: Fact[];
  diagnostics: SemanticDiagnostic[];
};

export type CandidateEffectInfo = {
  name: string;
  functionTarget?: string;
  term?: TermInfo;
  source?: SourceRefInfo;
  confidence?: string;
  anchor?: string;
  fingerprintProvider?: string;
  fingerprintValue?: string;
  provenance: Provenance;
};

export type FunctionAst = FunctionSummary | AddFunctionChange | ModifyFunctionChange;

export type ChangedFileContext = {
  files: string[];
  set: Set<string>;
};

export type AttestationInfo = Model["attestations"][number];
