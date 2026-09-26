// Shared checker records and empty-model construction. Model derives from its
// constructor so collection types and initialization have one source of truth.
// This module does not lower declarations or evaluate rules.
import type {
  AddFunctionChange,
  FunctionSummary,
  ModifyFunctionChange,
  ShapeModule,
  TargetKind
} from "../language/generated/ast.ts";
import type { ContextKind, TraitTypeParameter } from "../prelude.ts";
import type { ParseDiagnostic } from "../parser.ts";
import type { ChangeTrigger, Provenance, ShapeTarget } from "../shape-domain.ts";
import type { ModuleReferenceResolution } from "../module-resolution.ts";
import type { IsoDateString } from "./iso-date.ts";

export type { ChangeTrigger, Provenance, ShapeTarget } from "../shape-domain.ts";

type ProvenancedRecord = {
  provenance: Provenance;
};

type NamedDeclaration = ProvenancedRecord & {
  name: string;
};

type FunctionLocation = {
  component: string;
  functionName: string;
};

type FunctionEffect = FunctionLocation & {
  effect: string;
  target: string;
};

type ShapeLocation = {
  targetKind: TargetKind;
  target: string;
};

type GuardedShapeLocation = ShapeLocation & {
  guardKind: ContextKind;
  guard: string;
};

type DiagnosticContext = {
  filePath?: string;
  causedBy: string[];
};

type DiscriminatedUnion<Payloads> = {
  [Kind in keyof Payloads]: { kind: Kind } & Payloads[Kind];
}[keyof Payloads];

type InvalidDeclarationDiagnostic = {
  name: string;
  reason: string;
};

export type SemanticDiagnostic = DiagnosticContext &
  DiscriminatedUnion<{
    final_forbidden_effect: FunctionEffect & {
      trait: string;
      evidence?: string;
    };
    missing_grant: FunctionEffect;
    unknown_effects: FunctionLocation & {
      severity: "error" | "warning";
    };
    unknown_name: {
      nameKind: "resource" | "component" | "trait" | "relation_endpoint";
      name: string;
    };
    ambiguous_name: {
      nameKind: DeclarationKind | "relation_endpoint";
      name: string;
      matches: string[];
    };
    invalid_rule: {
      rule: string;
      reason: string;
    };
    duplicate_declaration: {
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
    };
    duplicate_fingerprint: {
      resource: string;
      provider: string;
    };
    missing_shape_update: {
      changedFile: string;
      implementation: string;
      glob: string;
    };
    missing_bound_docs_change: {
      binding: string;
      changedFile: string;
      requiredPaths: string[];
      attestationKinds: string[];
    };
    forbidden_hypercycle: {
      rule: string;
      vertices: string[];
      hyperedges: { name: string; kind: string }[];
    };
    forbidden_path: {
      rule: string;
      source: string;
      target: string;
      kinds: string[];
      steps: { from: string; to: string; relation: string; kind: string }[];
    };
    forbidden_provides: {
      rule: string;
      provider: string;
      target: string;
      hyperedge: string;
      allowedComponent?: string;
    };
    fingerprint_mismatch: {
      relation: string;
      endpoint: string;
      provider: string;
      expected: string;
      actual?: string;
    };
    candidate_pin_fingerprint_mismatch: {
      candidateEffect: string;
      anchor: string;
      provider: string;
      expected: string;
      actual?: string;
    };
    invalid_candidate_effect: InvalidDeclarationDiagnostic;
    unsafe_effects: FunctionLocation & {
      missing: string[];
    };
    missing_required_context: ShapeLocation & {
      requiredContext: string;
      requiredBy: string;
    };
    invalid_context_target: ShapeLocation & {
      contextKind: ContextKind;
      name: string;
    };
    context_target_mismatch: {
      contextKind: ContextKind;
      name: string;
      declaredTarget: ShapeTarget;
      appliesToTarget: ShapeTarget;
    };
    missing_required_description: ShapeLocation & {
      requiredBy: string;
    };
    guarded_shape_changed: GuardedShapeLocation & {
      changedProperty?: string;
      changeKind?: "property" | "transform";
      missingReevaluation: string;
    };
    invalid_reevaluation: InvalidDeclarationDiagnostic;
    stale_memory: GuardedShapeLocation & {
      reviewBy: string;
      asOf: string;
    };
    invalid_relation: InvalidDeclarationDiagnostic;
    invalid_require_context: {
      trait: string;
      contextType: string;
      typeParam: string;
      reason: string;
    };
    invalid_implementation: InvalidDeclarationDiagnostic;
    stale_attestation: {
      attestationKind: string;
      path: string;
    };
    missing_cited_path: {
      path: string;
    };
  }>;

export type ShapeDiagnostic = ParseDiagnostic | SemanticDiagnostic;

export type CheckResult = {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  diagnostics: ShapeDiagnostic[];
  facts?: Fact[];
};

export type CheckOptions = {
  /**
   * Treat `effects unknown` as a non-fatal warning for draft validation.
   * Every other parse and semantic diagnostic remains blocking.
   */
  allowUnknownEffects?: boolean;
  /**
   * The model at the change's comparison base, such as the merge base of a pull
   * request. When set, an attestation satisfies coverage or bindings only if no
   * attestation with the same kind, path, and reason exists in the base, and
   * attestations identical to the base are reported as stale warnings. When
   * absent, an attestation counts when its declaring `.shape` file is in the
   * changed-file input.
   */
  baseModules?: ShapeModule[] | CheckModuleInput[];
  changedFiles?: string[];
  enforceBindings?: boolean;
  includeFacts?: boolean;
  /**
   * Every file in the repository, relative to `repoRoot`. When set, each source
   * and evidence path the model cites (attestation sources excepted) must be in
   * this list, so a renamed or deleted file cannot leave a dangling citation.
   */
  repositoryFiles?: string[];
  /**
   * Repository root used to normalize absolute changed-file and provenance
   * paths before coverage and binding matching. Defaults to the current working
   * directory.
   */
  repoRoot?: string;
  /**
   * When set to an ISO `YYYY-MM-DD` date, design memory whose `review_by` is
   * strictly before this date is reported as stale. Absent disables freshness
   * checking. The checker never reads the system clock; callers inject the date
   * so checking stays deterministic.
   */
  freshnessDate?: IsoDateString;
};

export type NormalizedCheckOptions = CheckOptions & {
  repoRoot: string;
  /** Present only when `baseModules` is set. */
  base?: BaseModel;
};

/** What checks need from the base model, derived once from `baseModules`. */
export type BaseModel = {
  /** Identity keys of every attestation in the base. */
  attestationKeys: ReadonlySet<string>;
  /** Each base `.shape` file's source with its attestations removed. */
  attestationFreeTexts: ReadonlyMap<string, string>;
};

type ContextFactPayload = ShapeLocation & {
  name: string;
  contextType: string;
};

export type Fact = ProvenancedRecord &
  DiscriminatedUnion<{
    resource: { name: string };
    resource_trait: { resource: string; trait: string };
    resource_fingerprint: {
      resource: string;
      provider: string;
      value: string;
    };
    trait_final_forbid: {
      trait: string;
      effect: string;
      target: string;
    };
    component: { name: string };
    owns: { component: string; resource: string };
    grants: { component: string; effect: string; target: string };
    hyperedge: {
      name: string;
      relationKind: string;
      ordered: boolean;
    };
    hyperedge_member: {
      hyperedge: string;
      endpoint: string;
      index: number;
      role?: string;
    };
    hyperedge_fingerprint_expectation: {
      hyperedge: string;
      endpoint: string;
      provider: string;
      value: string;
    };
    function: { component: string; name: string };
    effect: FunctionEffect;
    effect_unknown: FunctionLocation;
    candidate_effect: {
      name: string;
      functionTarget: string;
      effect: string;
      target: string;
      source?: SourceRefInfo;
      confidence?: string;
      anchor?: string;
      fingerprintProvider?: string;
      fingerprintValue?: string;
    };
    shape_trait: ShapeLocation & {
      trait: string;
    };
    description: ShapeLocation & {
      required: boolean;
      summary: string;
    };
    context_required: ShapeLocation & {
      contextType: string;
      requiredBy: string;
    };
    rationale: ContextFactPayload;
    memory: ContextFactPayload;
    reevaluation: {
      name: string;
      satisfiesKind: ContextKind;
      satisfies: string;
    };
    protected_shape: GuardedShapeLocation & {
      propertyKind: string;
      propertyValue: string;
    };
    guard_requires_reevaluation: GuardedShapeLocation;
    implementation: { name: string };
    implementation_path: { implementation: string; glob: string };
    conforms_to: { implementation: string; component: string };
    binding: { name: string };
    binding_when_changed: { binding: string; glob: string };
    binding_require_changed: { binding: string; glob: string };
    binding_allow_attest: { binding: string; kindName: string };
    shape_update_for: { path: string };
    attestation: { kindName: string; path: string; reason: string };
    rule: { name: string };
  }>;

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

export type ResolutionResult = ModuleReferenceResolution;

export type TermInfo = {
  name: string;
  target?: string;
};

export type EffectEntryInfo = ProvenancedRecord & {
  term: TermInfo;
  evidence?: SourceRefInfo;
};

export type EffectSummaryInfo =
  | {
      kind: "complete";
      entries: EffectEntryInfo[];
    }
  | {
      kind: "unknown";
    };

export type DescriptionInfo = ProvenancedRecord & {
  required: boolean;
  summary: string;
};

export type ProtectedProperty = ProvenancedRecord & {
  kind: string;
  value: string;
  // For `protects shape <trait>`, the trait name resolved into the same key
  // space as classifier and `shape_trait_removed` events (module-qualified
  // where applicable), so property-level guard matching can compare like for
  // like. Undefined for non-shape properties; free-form `shape` labels resolve
  // to a name that matches no declared trait and so stay coarse.
  resolvedValue?: string;
};

export type GuardInfo = ProvenancedRecord & {
  requirement: string;
};

export type TransformGuardInfo = ProvenancedRecord & {
  label: string;
};

/**
 * A context obligation a trait imposes on its bearer. Built-in obligations are
 * seeded onto prelude traits with a "standard prelude" provenance; user traits
 * populate these from their `require_context` members. Storing them on the
 * trait (rather than a global sidecar) means obligations follow the trait
 * through declare/modify/remove, and a same-named user trait shadows a built-in
 * simply by replacing the trait entry — no merge or scrub special-case.
 */
export type TraitContextRequirement = ProvenancedRecord & {
  targetKind: TargetKind;
  contextType: string;
  satisfiedBy: ContextKind[];
  requiresDescription: boolean;
};

/** A trait context requirement resolved against a bearer, tagged with the
 *  owning trait name for diagnostics. */
export type ContextRequirement = TraitContextRequirement & { trait: string };

export type ContextObjectInfo = NamedDeclaration & {
  contextType: string;
  target: ShapeTarget;
  appliesTo?: ShapeTarget;
  status?: string;
  confidence?: string;
  sensitive: boolean;
  observed: SourceRefInfo[];
  summary?: string;
  owner?: string;
  reviewBy?: string;
  protects: ProtectedProperty[];
  guards: GuardInfo[];
  forbiddenTransforms: TransformGuardInfo[];
  evidence: SourceRefInfo[];
};

export type ReevaluationInfo = NamedDeclaration & {
  satisfiesKind?: ContextKind;
  satisfiesName?: string;
  outcome?: string;
  summary?: string;
  evidence: SourceRefInfo[];
  reviewer?: string;
  approver?: string;
  decidedOn?: string;
};

// Observed changes use the ChangeTrigger shape from shape-domain.ts that
// memory-guards matches against; the checker emits them while lowering `change`
// declarations.
export type ChangeEvent = ChangeTrigger;

export type FunctionInfo = NamedDeclaration & {
  component: string;
  source?: SourceRefInfo;
  unsafe: boolean;
  effects: EffectSummaryInfo;
  requires: TermInfo[];
  reason?: string;
  expires?: string;
  shapeTraits: Map<string, Provenance>;
  description?: DescriptionInfo;
  generatedAstCandidate: boolean;
};

export type ResourceInfo = NamedDeclaration & {
  traits: Map<string, Provenance>;
  fingerprints: Map<string, FingerprintInfo>;
};

export type FingerprintInfo = ProvenancedRecord & {
  provider: string;
  value: string;
};

export type TraitInfo = NamedDeclaration & {
  typeParams: TraitTypeParameter[];
  finalForbids: FinalForbidPattern[];
  contextRequirements: TraitContextRequirement[];
};

export type FinalForbidPattern = ProvenancedRecord & {
  effect: string;
  target?: string;
  targetBinding: "omitted" | "generic" | "concrete" | "ambiguous";
  final: boolean;
};

export type ComponentInfo = NamedDeclaration & {
  classifiers: Map<string, Provenance>;
  grants: Map<string, Provenance>;
  owns: Map<string, Provenance>;
  functions: Map<string, FunctionInfo>;
};

export type ImplementationInfo = NamedDeclaration & {
  paths: { glob: string; provenance: Provenance }[];
  conformsTo?: string;
  onChangeRequirement?: string;
};

export type BindingInfo = NamedDeclaration & {
  whenChanged: { glob: string; provenance: Provenance }[];
  requireChanged: { glob: string; provenance: Provenance }[];
  allowAttestations: { kind: string; provenance: Provenance }[];
};

export type RuleInfo = NamedDeclaration & {
  whenHas: {
    subject: string;
    trait: string;
    traitResolution: ResolutionResult["kind"];
    provenance: Provenance;
  }[];
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
  forbidPaths: {
    source: string;
    sourceResolution: ResolutionResult["kind"];
    target: string;
    targetResolution: ResolutionResult["kind"];
    kinds: string[];
    provenance: Provenance;
  }[];
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

export type HyperedgeInfo = NamedDeclaration & {
  kind: string;
  ordered: boolean;
  members: HyperedgeMember[];
  fingerprintExpectations: FingerprintExpectationInfo[];
  summary?: string;
};

export type FingerprintExpectationInfo = ProvenancedRecord & {
  endpoint: string;
  provider: string;
  value: string;
};

export type Model = ReturnType<typeof createModel>;

export function createModel(declarations: DeclarationIndex, traits: Map<string, TraitInfo>) {
  return {
    modules: new Map<string, ModuleInfo>(),
    /**
     * Each input file's source with its attestations removed, by file path. Kept
     * per file because module names are optional and may repeat. A module built
     * in code has no source text and no entry.
     */
    attestationFreeTexts: new Map<string, string>(),
    declarations,
    resources: new Map<string, ResourceInfo>(),
    traits,
    components: new Map<string, ComponentInfo>(),
    hypergraph: { edges: new Map<string, HyperedgeInfo>() },
    candidateEffects: new Map<string, CandidateEffectInfo>(),
    implementations: [] as ImplementationInfo[],
    bindings: new Map<string, BindingInfo>(),
    rules: [] as RuleInfo[],
    rationales: new Map<string, ContextObjectInfo>(),
    memories: new Map<string, ContextObjectInfo>(),
    reevaluations: new Map<string, ReevaluationInfo>(),
    roles: new Set<string>(),
    requiresApprover: false,
    attestations: [] as AttestationInfo[],
    shapeUpdatePaths: new Map<string, Provenance[]>(),
    changeEvents: [] as ChangeEvent[],
    facts: [] as Fact[],
    diagnostics: [] as SemanticDiagnostic[]
  };
}

export type CandidateEffectInfo = Extract<Fact, { kind: "candidate_effect" }>;

export type FunctionAst = FunctionSummary | AddFunctionChange | ModifyFunctionChange;

export type ChangedFileContext = {
  files: string[];
  set: Set<string>;
};

export type AttestationInfo = {
  kind: string;
  path: string;
  reason: string;
  provenance: Provenance;
};
