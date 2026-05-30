import type {
  AddDeclarationChange,
  AddFunctionChange,
  AttestationDecl,
  BindingDecl,
  CandidateEffectDecl,
  ChangeDecl,
  ComponentDecl,
  DescriptionDecl,
  EffectEntry,
  EffectPattern,
  EffectsDecl,
  EffectTerm,
  FingerprintDecl,
  FunctionSummary,
  ImplementationDecl,
  MemoryDecl,
  MemoryMember,
  ModifyDeclarationChange,
  ModifyFunctionChange,
  PolicyDecl,
  RationaleDecl,
  RationaleMember,
  ReevaluationDecl,
  RoleDecl,
  RelationDecl,
  RelationEndpoint,
  RelationRoleEntry,
  RemoveDeclarationChange,
  ResourceDecl,
  RuleDecl,
  RuleForbidEffectDecl,
  RuleForbidHypercycleDecl,
  RuleForbidProvidesDecl,
  ShapeModule,
  SourceRef,
  TargetKind,
  TargetRef,
  TraitDecl,
  TraitForbidDecl
} from "./language/generated/ast.ts";
import { isAbsolute, relative } from "node:path";
import {
  isAddDeclarationChange,
  isAddFunctionChange,
  isAppliesToDecl,
  isApproverDecl,
  isAttestationDecl,
  isBindingAllowAttestDecl,
  isBindingDecl,
  isBindingRequireChangedDecl,
  isBindingWhenChangedDecl,
  isCandidateEffectAnchorDecl,
  isCandidateEffectConfidenceDecl,
  isCandidateEffectDecl,
  isCandidateEffectFunctionDecl,
  isCandidateEffectTermDecl,
  isChangeDecl,
  isCompleteEffects,
  isComponentDecl,
  isConfidenceDecl,
  isConformsToDecl,
  isDecidedOnDecl,
  isEvidenceLineDecl,
  isExpiresDecl,
  isFingerprintDecl,
  isFunctionRequiresDecl,
  isFunctionSummary,
  isGrantsDecl,
  isGuardDecl,
  isImplementationDecl,
  isMemoryDecl,
  isModifyDeclarationChange,
  isModifyFunctionChange,
  isObservedDecl,
  isOnChangeDecl,
  isOutcomeDecl,
  isOwnerDecl,
  isOwnsDecl,
  isPathsBlock,
  isProtectsDecl,
  isPolicyDecl,
  isRationaleDecl,
  isReasonDecl,
  isReevaluationDecl,
  isRelationConnectsDecl,
  isRelationDecl,
  isRelationFingerprintExpectationDecl,
  isRelationKindDecl,
  isRelationRolesDecl,
  isRelationSummaryDecl,
  isRemoveDeclarationChange,
  isRemoveFunctionChange,
  isRequireApproverDecl,
  isRequireContextDecl,
  isResourceDecl,
  isReviewByDecl,
  isReviewerDecl,
  isRoleDecl,
  isRuleDecl,
  isRuleForbidEffectDecl,
  isRuleForbidHypercycleDecl,
  isRuleForbidProvidesDecl,
  isRuleWhenHasDecl,
  isSatisfiesDecl,
  isSensitiveDecl,
  isStatusDecl,
  isSummaryDecl,
  isTraitDecl,
  isTraitForbidDecl,
  isUnknownEffects,
  isWhyDecl
} from "./language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "./parser.ts";
import {
  PRELUDE_CONTEXT_REQUIREMENTS,
  PRELUDE_RELATION_KIND_RULES,
  PRELUDE_SHAPE_TRAIT_NAMES,
  PRELUDE_TRAIT_NAMES,
  PRELUDE_TRAITS,
  type ContextKind,
  type PreludeContextRequirement,
  type PreludeTraitDefinition
} from "./prelude.ts";
import {
  compareCodepointStrings,
  normalizeShapePath,
  normalizeShapeSourcePath,
  unquoteShapeString
} from "./shape-strings.ts";
import {
  GENERATED_AST_DIR,
  isGeneratedAstModuleName,
  normalizeGeneratedAstPath
} from "./generated-ast-policy.ts";

/**
 * Kind registry: every relation kind declares whether its members are
 * traversed as an ordered path, as directed pairs, or not at all for cycle
 * checks. This is the single source of truth for hypercycle traversal.
 */
const PRELUDE_RELATION_KINDS = new Map(
  PRELUDE_RELATION_KIND_RULES.map(({ name, ...rule }) => [name, rule])
);

const KNOWN_PRELUDE_TRAITS = new Set(PRELUDE_TRAIT_NAMES);
const KNOWN_SHAPE_TRAITS = new Set(PRELUDE_SHAPE_TRAIT_NAMES);

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

type ModuleInfo = {
  name: string;
  imports: string[];
  filePath?: string;
  generatedAst: boolean;
};

type LoweringContext = ModuleInfo;

type DeclarationKind =
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

type DeclarationIndex = Record<DeclarationKind, Map<string, Set<string>>>;

type ResolutionResult =
  | { kind: "resolved"; name: string }
  | { kind: "unknown"; name: string }
  | { kind: "ambiguous"; name: string; matches: string[] };

type Provenance = {
  filePath?: string;
  label: string;
};

type TermInfo = {
  name: string;
  target?: string;
};

type EffectEntryInfo = {
  term: TermInfo;
  evidence?: SourceRefInfo;
  provenance: Provenance;
};

type EffectSummaryInfo =
  | {
      kind: "complete";
      entries: EffectEntryInfo[];
    }
  | {
      kind: "unknown";
    };

type ShapeTarget = {
  kind: TargetKind;
  name: string;
};

type DescriptionInfo = {
  required: boolean;
  summary: string;
  provenance: Provenance;
};

type ProtectedProperty = {
  kind: string;
  value: string;
  provenance: Provenance;
};

type GuardInfo = {
  requirement: string;
  provenance: Provenance;
};

type TransformGuardInfo = {
  label: string;
  provenance: Provenance;
};

type PolicyInfo = {
  name: string;
  requiresApprover: boolean;
  provenance: Provenance;
};

/**
 * A context obligation rule. Prelude rules come from PRELUDE_CONTEXT_REQUIREMENTS
 * with no provenance; user-defined `require_context` trait members carry the
 * declaring trait's provenance so diagnostics can point at the trait.
 */
type ContextRequirementRule = PreludeContextRequirement & { provenance?: Provenance };

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
  forbiddenTransforms: TransformGuardInfo[];
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
  sensitive: boolean;
  protects: ProtectedProperty[];
  guards: GuardInfo[];
  forbiddenTransforms: TransformGuardInfo[];
  observed: SourceRefInfo[];
  evidence: SourceRefInfo[];
  provenance: Provenance;
};

type ContextObjectInfo = {
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

type ReevaluationInfo = {
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

type ChangeEvent =
  | {
      // A target was modified or removed wholesale. Drives coarse guards that
      // protect a target without a detectable property, or no property at all.
      kind: "target_changed";
      target: ShapeTarget;
      provenance: Provenance;
    }
  | {
      // A specific shape trait was dropped from a target. Drives property-level
      // guards that protect that exact trait.
      kind: "shape_trait_removed";
      target: ShapeTarget;
      trait: string;
      provenance: Provenance;
    }
  | {
      // A target's required/non-empty description was dropped. Drives guards
      // that protect the description.
      kind: "description_removed";
      target: ShapeTarget;
      provenance: Provenance;
    }
  | {
      // A change declared a named transform intent on a target. Drives
      // `guards forbid transform <label>` guards.
      kind: "transform_applied";
      target: ShapeTarget;
      label: string;
      provenance: Provenance;
    };

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
  generatedAstCandidate: boolean;
  provenance: Provenance;
};

type ResourceInfo = {
  name: string;
  traits: Map<string, Provenance>;
  fingerprints: Map<string, FingerprintInfo>;
  generatedAstCandidate: boolean;
  provenance: Provenance;
};

type FingerprintInfo = {
  provider: string;
  value: string;
  provenance: Provenance;
};

type TraitInfo = {
  name: string;
  typeParams: string[];
  finalForbids: FinalForbidPattern[];
  provenance: Provenance;
};

type FinalForbidPattern = {
  effect: string;
  target?: string;
  targetBinding: "omitted" | "generic" | "concrete" | "ambiguous";
  final: boolean;
  provenance: Provenance;
};

type ComponentInfo = {
  name: string;
  classifiers: Map<string, Provenance>;
  grants: Map<string, Provenance>;
  owns: Map<string, Provenance>;
  functions: Map<string, FunctionInfo>;
  generatedAstCandidate: boolean;
  provenance: Provenance;
};

type ImplementationInfo = {
  name: string;
  paths: { glob: string; provenance: Provenance }[];
  conformsTo?: string;
  onChangeRequirement?: string;
  provenance: Provenance;
};

type BindingInfo = {
  name: string;
  whenChanged: { glob: string; provenance: Provenance }[];
  requireChanged: { glob: string; provenance: Provenance }[];
  allowAttestations: { kind: string; provenance: Provenance }[];
  provenance: Provenance;
};

type RuleInfo = {
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

type SourceRefInfo = {
  language: string;
  path: string;
};

type HyperedgeMember = {
  endpoint: string;
  index: number;
  role?: string;
};

type HyperedgeInfo = {
  name: string;
  kind: string;
  ordered: boolean;
  members: HyperedgeMember[];
  fingerprintExpectations: FingerprintExpectationInfo[];
  summary?: string;
  provenance: Provenance;
};

type FingerprintExpectationInfo = {
  endpoint: string;
  provider: string;
  value: string;
  provenance: Provenance;
};

type Hypergraph = {
  edges: Map<string, HyperedgeInfo>;
  /** vertex name -> hyperedge names incident to that vertex */
  incidence: Map<string, string[]>;
};

type Model = {
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
  userContextRequirements: ContextRequirementRule[];
  attestations: { kind: string; path: string; reason: string; provenance: Provenance }[];
  shapeUpdatePaths: Map<string, Provenance[]>;
  changeEvents: ChangeEvent[];
  facts: Fact[];
  diagnostics: SemanticDiagnostic[];
};

type CandidateEffectInfo = {
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

type FunctionAst = FunctionSummary | AddFunctionChange | ModifyFunctionChange;

type ChangedFileContext = {
  files: string[];
  set: Set<string>;
};

type AttestationInfo = Model["attestations"][number];

export function checkShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  options: CheckOptions = {}
): CheckResult {
  const model = lowerShapeModules(modules);
  const diagnostics = [
    ...model.diagnostics,
    ...checkResolvedNames(model),
    ...checkRules(model),
    ...checkFingerprintExpectations(model),
    ...checkCandidateEffectFingerprints(model),
    ...checkContextTargets(model),
    ...checkRequiredContext(model),
    ...checkRequiredDescriptions(model),
    ...checkReevaluations(model),
    ...checkGuardedChanges(model),
    ...(options.freshnessDate ? checkFreshness(model, options.freshnessDate) : []),
    ...checkFunctions(model),
    ...checkProvidesRules(model),
    ...checkHypercycles(model),
    ...checkCoverage(model, options.changedFiles ?? []),
    ...(options.enforceBindings === false ? [] : checkBindings(model, options.changedFiles ?? []))
  ];

  return {
    ok: diagnostics.length === 0,
    exitCode: diagnostics.length === 0 ? 0 : 1,
    diagnostics,
    facts: options.includeFacts ? model.facts : undefined
  };
}

export async function checkShapeFiles(
  paths: string[],
  options: CheckOptions = {}
): Promise<CheckResult> {
  const parsedModules: CheckModuleInput[] = [];
  const parseDiagnostics: ParseDiagnostic[] = [];

  for (const filePath of paths) {
    try {
      const source = await Bun.file(filePath).text();
      const parsed = parseShapeModule(source, filePath);
      if (parsed.ok) {
        parsedModules.push({
          module: parsed.module,
          filePath,
          origin: moduleOriginForShapeFile(parsed.module, filePath)
        });
      } else {
        parseDiagnostics.push(...parsed.diagnostics);
      }
    } catch (error) {
      parseDiagnostics.push({
        kind: "parse",
        filePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (parseDiagnostics.length > 0) {
    return {
      ok: false,
      exitCode: 2,
      diagnostics: parseDiagnostics
    };
  }

  return checkShapeModules(parsedModules, options);
}

export function listMemoryGuardsShapeModules(modules: ShapeModule[] | CheckModuleInput[]): string {
  const model = lowerShapeModules(modules);
  const entries = [
    ...[...model.rationales.values()].map((rationale) => ({
      target: rationale.appliesTo ?? rationale.target,
      lines: formatRationaleMemoryListEntry(rationale)
    })),
    ...[...model.memories.values()].map((memory) => ({
      target: memory.appliesTo ?? memory.target,
      lines: formatMemoryListEntry(memory)
    }))
  ].sort((left, right) =>
    `${formatTarget(left.target)}:${left.lines[0]}`.localeCompare(
      `${formatTarget(right.target)}:${right.lines[0]}`
    )
  );

  if (entries.length === 0) {
    return "Memory Guards\n\nNo active memory guards.\n";
  }

  const lines = ["Memory Guards", ""];
  for (const entry of entries) {
    lines.push(formatTarget(entry.target), ...entry.lines.map((line) => `  ${line}`), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function listShapeObligations(
  modules: ShapeModule[] | CheckModuleInput[],
  options: { freshnessDate?: string } = {}
): string {
  const result = checkShapeModules(modules, { freshnessDate: options.freshnessDate });
  const relevant = result.diagnostics.filter(isObligationDiagnostic);

  if (relevant.length === 0) {
    return "Open Shape Obligations\n\nNo open shape obligations.\n";
  }

  const lines = ["Open Shape Obligations", ""];
  const missingContext = relevant.filter(
    (diagnostic) => diagnostic.kind === "missing_required_context"
  );
  const missingDescription = relevant.filter(
    (diagnostic) => diagnostic.kind === "missing_required_description"
  );
  const guardedChanges = relevant.filter(
    (diagnostic) => diagnostic.kind === "guarded_shape_changed"
  );
  const invalidReevaluations = relevant.filter(
    (diagnostic) => diagnostic.kind === "invalid_reevaluation"
  );
  const staleMemories = relevant.filter((diagnostic) => diagnostic.kind === "stale_memory");

  if (missingContext.length > 0) {
    lines.push("missing context:");
    lines.push(
      ...missingContext.map(
        (diagnostic) =>
          `  ${diagnostic.targetKind} ${diagnostic.target} requires ${diagnostic.requiredContext}`
      )
    );
    lines.push("");
  }
  if (missingDescription.length > 0) {
    lines.push("missing description:");
    lines.push(
      ...missingDescription.map(
        (diagnostic) => `  ${diagnostic.targetKind} ${diagnostic.target} requires description`
      )
    );
    lines.push("");
  }
  if (guardedChanges.length > 0) {
    lines.push("guarded changes:");
    lines.push(
      ...guardedChanges.map(
        (diagnostic) =>
          `  ${diagnostic.targetKind} ${diagnostic.target} changed; requires ${diagnostic.missingReevaluation}`
      )
    );
    lines.push("");
  }
  if (invalidReevaluations.length > 0) {
    lines.push("invalid reevaluations:");
    lines.push(
      ...invalidReevaluations.map(
        (diagnostic) => `  reevaluation ${diagnostic.name}: ${diagnostic.reason}`
      )
    );
    lines.push("");
  }
  if (staleMemories.length > 0) {
    lines.push("stale design memory:");
    lines.push(
      ...staleMemories.map(
        (diagnostic) =>
          `  ${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)} review_by ${diagnostic.reviewBy} is before ${diagnostic.asOf}`
      )
    );
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function explainShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string
): string {
  const model = lowerShapeModules(modules);
  const symbolAmbiguity = formatAmbiguousQuerySymbol(symbol, [
    { kind: "resource", map: model.resources },
    { kind: "component", map: model.components },
    { kind: "relation", map: model.hypergraph.edges },
    { kind: "rationale", map: model.rationales },
    { kind: "memory", map: model.memories }
  ]);
  if (symbolAmbiguity) {
    return symbolAmbiguity;
  }

  const resourceKey = resolveQuerySymbol(symbol, model.resources);
  const resource = resourceKey ? model.resources.get(resourceKey) : undefined;
  if (resource) {
    const finalForbids = deriveFinalForbidsForResource(resource, model);
    const lines = [
      symbol,
      "  kind: resource",
      "  traits:",
      ...[...resource.traits.keys()].sort().map((trait) => `    ${trait}`)
    ];
    if (finalForbids.length > 0) {
      lines.push("", "  final forbidden effects:");
      lines.push(
        ...finalForbids.map((forbid) => `    ${formatTerm(forbid.effect, forbid.target)}`)
      );
    }
    if (resource.fingerprints.size > 0) {
      lines.push("", "  fingerprints:");
      lines.push(
        ...[...resource.fingerprints.values()]
          .sort((left, right) => left.provider.localeCompare(right.provider))
          .map((fingerprint) => `    ${formatFingerprintInfo(fingerprint)}`)
      );
    }
    appendShapeTraitContext(
      { kind: "resource", name: resource.name },
      resource.traits,
      model,
      lines
    );
    appendIncidence(resource.name, model, lines);
    return `${lines.join("\n")}\n`;
  }

  const [componentName, functionName] = splitFunctionTarget(symbol);
  if (componentName && functionName) {
    const componentKey = resolveQuerySymbol(componentName, model.components);
    const fn = componentKey
      ? model.components.get(componentKey)?.functions.get(functionName)
      : undefined;
    if (fn && componentKey) {
      const lines = [`${componentKey}.${functionName}`, "  kind: function"];
      if (fn.source) {
        lines.push(`  source: ${formatSourceRefInfo(fn.source)}`);
      }
      if (fn.shapeTraits.size > 0) {
        lines.push("", "  shape traits:");
        lines.push(...[...fn.shapeTraits.keys()].sort().map((trait) => `    ${trait}`));
      }
      if (fn.description) {
        lines.push("", "  description:");
        if (fn.description.required) {
          lines.push("    required");
        }
        lines.push(`    ${JSON.stringify(fn.description.summary)}`);
      }
      const requirements = requirementsForTarget(model, "fn", fn.shapeTraits);
      if (requirements.length > 0) {
        const target = functionTarget(componentKey, functionName);
        lines.push("", "  required context:");
        lines.push(
          ...requirements.map(
            (requirement) => `    ${formatContextRequirement(requirement.contextType, target)}`
          )
        );
      }
      const satisfiedBy = matchingContextsForTarget(
        functionTarget(componentKey, functionName),
        model
      );
      if (satisfiedBy.length > 0) {
        lines.push("", "  satisfied by:");
        lines.push(...satisfiedBy.map((context) => `    ${context.kind} ${context.name}`));
      }
      const guards = guardsForTarget(functionTarget(componentKey, functionName), model);
      if (guards.length > 0) {
        lines.push("", "  memory guards:");
        lines.push(...guards.map((guard) => `    ${guard.kind} ${guard.info.name}`));
      }
      lines.push("  effects:");
      if (fn.effects.kind === "unknown") {
        lines.push("    unknown");
      } else {
        lines.push(
          ...fn.effects.entries.map(
            (entry) => `    ${formatTerm(entry.term.name, entry.term.target ?? "")}`
          )
        );
      }
      return `${lines.join("\n")}\n`;
    }
    const ambiguity = formatAmbiguousQuerySymbol(componentName, [
      { kind: "component", map: model.components }
    ]);
    if (ambiguity) {
      return ambiguity;
    }
  }

  const rationaleKey = resolveQuerySymbol(symbol, model.rationales);
  const rationale = rationaleKey ? model.rationales.get(rationaleKey) : undefined;
  if (rationale) {
    return `${formatRationaleExplanation(rationale)}\n`;
  }

  const memoryKey = resolveQuerySymbol(symbol, model.memories);
  const memory = memoryKey ? model.memories.get(memoryKey) : undefined;
  if (memory) {
    return `${formatMemoryExplanation(memory)}\n`;
  }

  const componentKey = resolveQuerySymbol(symbol, model.components);
  const component = componentKey ? model.components.get(componentKey) : undefined;
  if (component) {
    const lines = [symbol, "  kind: component"];
    if (component.classifiers.size > 0) {
      lines.push("  classifiers:");
      lines.push(
        ...[...component.classifiers.keys()].sort().map((classifier) => `    ${classifier}`)
      );
    }
    lines.push(
      "  grants:",
      ...[...component.grants.keys()].sort().map((grant) => `    ${grant}`),
      "",
      "  functions:",
      ...[...component.functions.keys()].sort().map((name) => `    ${name}`)
    );
    appendShapeTraitContext(
      { kind: "component", name: component.name },
      component.classifiers,
      model,
      lines
    );
    appendIncidence(component.name, model, lines);
    return `${lines.join("\n")}\n`;
  }

  const relationKey = resolveQuerySymbol(symbol, model.hypergraph.edges);
  const relation = relationKey ? model.hypergraph.edges.get(relationKey) : undefined;
  if (relation) {
    return `${formatRelationExplanation(relation, model)}\n`;
  }

  return `No shape facts found for ${symbol}.\n`;
}

/**
 * Appends the shape-trait obligation sections (required context, satisfying
 * context, and active guards) for a component or resource target to an explain
 * listing. Guarded-change enforcement now fires for component/resource targets
 * via `modify`/`remove` change events, so listed guards are real.
 */
function appendShapeTraitContext(
  target: ShapeTarget,
  traits: ReadonlyMap<string, Provenance>,
  model: Model,
  lines: string[]
): void {
  const requirements = requirementsForTarget(model, target.kind, traits);
  if (requirements.length > 0) {
    lines.push("", "  required context:");
    lines.push(
      ...requirements.map(
        (requirement) => `    ${formatContextRequirement(requirement.contextType, target)}`
      )
    );
  }
  const satisfiedBy = matchingContextsForTarget(target, model);
  if (satisfiedBy.length > 0) {
    lines.push("", "  satisfied by:");
    lines.push(...satisfiedBy.map((context) => `    ${context.kind} ${context.name}`));
  }
  const guards = guardsForTarget(target, model);
  if (guards.length > 0) {
    lines.push("", "  memory guards:");
    lines.push(...guards.map((guard) => `    ${guard.kind} ${guard.info.name}`));
  }
}

function compareHyperedges(left: HyperedgeInfo, right: HyperedgeInfo): number {
  return `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`);
}

function resolveQuerySymbol<T extends { name: string }>(
  symbol: string,
  map: ReadonlyMap<string, T>
): string | undefined {
  const matches = querySymbolMatches(symbol, map);
  return matches.length === 1 ? matches[0] : undefined;
}

function querySymbolMatches<T extends { name: string }>(
  symbol: string,
  map: ReadonlyMap<string, T>
): string[] {
  if (map.has(symbol)) {
    return [symbol];
  }
  return [...map.keys()].filter((key) => localNameOf(key) === symbol).sort(compareCodepointStrings);
}

function formatAmbiguousQuerySymbol(
  symbol: string,
  groups: { kind: string; map: ReadonlyMap<string, { name: string }> }[]
): string | undefined {
  const candidates = groups.flatMap((group) =>
    querySymbolMatches(symbol, group.map).map((name) => ({ kind: group.kind, name }))
  );
  if (candidates.length < 2) {
    return undefined;
  }
  const lines = [
    `Ambiguous shape symbol ${symbol}.`,
    "Candidates:",
    ...candidates.map((candidate) => `  ${candidate.kind} ${candidate.name}`),
    "Use a module-qualified reference."
  ];
  return `${lines.join("\n")}\n`;
}

function allHyperedgesByKind(model: Model, kindFilter?: string): HyperedgeInfo[] {
  const edges: HyperedgeInfo[] = [];
  for (const edge of model.hypergraph.edges.values()) {
    if (!kindFilter || edge.kind === kindFilter) {
      edges.push(edge);
    }
  }
  return edges;
}

export function graphShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string,
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);
  const symbolAmbiguity = formatAmbiguousQuerySymbol(symbol, [
    { kind: "relation", map: model.hypergraph.edges },
    { kind: "component", map: model.components },
    { kind: "resource", map: model.resources }
  ]);
  if (symbolAmbiguity) {
    return symbolAmbiguity;
  }

  const relationKey = resolveQuerySymbol(symbol, model.hypergraph.edges);
  const relation = relationKey ? model.hypergraph.edges.get(relationKey) : undefined;
  if (relation) {
    if (kindFilter && relation.kind !== kindFilter) {
      return `No relations match kind ${kindFilter} for ${symbol}.\n`;
    }
    return `${formatHyperedgeLine(relation, 0, model)}\n`;
  }
  const vertexKey =
    resolveQuerySymbol(symbol, model.components) ??
    resolveQuerySymbol(symbol, model.resources) ??
    symbol;
  const incidentNames = model.hypergraph.incidence.get(vertexKey) ?? [];
  const incident = incidentNames
    .map((name) => model.hypergraph.edges.get(name))
    .filter((edge): edge is HyperedgeInfo => edge !== undefined)
    .filter((edge) => !kindFilter || edge.kind === kindFilter)
    .sort(compareHyperedges);

  const lines = [formatVertexHeader(vertexKey, model)];
  if (incident.length === 0) {
    lines.push("  (no incident relations)");
    return `${lines.join("\n")}\n`;
  }

  for (const edge of incident) {
    lines.push(`  ${formatHyperedgeLine(edge, 1, model)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Dump every hyperedge in the loaded modules, grouped by kind and sorted by name.
 * Used by `shp graph` with no symbol argument.
 */
export function graphAllShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);
  const edges = allHyperedgesByKind(model, kindFilter).sort(compareHyperedges);

  if (edges.length === 0) {
    return kindFilter ? `No relations match kind ${kindFilter}.\n` : "No relations declared.\n";
  }

  const lines = ["Hypergraph"];
  let currentKind = "";
  for (const edge of edges) {
    if (edge.kind !== currentKind) {
      currentKind = edge.kind;
      lines.push("", `${currentKind}:`);
    }
    lines.push(`  ${formatHyperedgeLine(edge, 0, model)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `kindFilter`, if provided, scopes hyperedge, incidence, arity, and
 * isolated-vertex participation to a single relation kind; vertex totals
 * always reflect the full model.
 */
export function statsShapeHypergraph(
  modules: ShapeModule[] | CheckModuleInput[],
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);

  const filteredEdges = allHyperedgesByKind(model, kindFilter);
  const totalEdgeCount = model.hypergraph.edges.size;

  const componentCount = model.components.size;
  const resourceCount = model.resources.size;
  const vertexCount = componentCount + resourceCount;

  let totalIncidences = 0;
  let minArity = Number.POSITIVE_INFINITY;
  let maxArity = 0;
  let widestEdge: HyperedgeInfo | undefined;
  const participatingVertices = new Set<string>();
  for (const edge of filteredEdges) {
    totalIncidences += edge.members.length;
    if (edge.members.length < minArity) {
      minArity = edge.members.length;
    }
    if (edge.members.length > maxArity) {
      maxArity = edge.members.length;
      widestEdge = edge;
    }
    for (const member of edge.members) {
      participatingVertices.add(member.endpoint);
    }
  }

  const isolatedVertices = [...model.components.keys(), ...model.resources.keys()]
    .filter((vertex) => !participatingVertices.has(vertex))
    .sort();

  const lines = ["Hypergraph stats"];
  lines.push(
    `  vertices: ${vertexCount} (${componentCount} component${pluralSuffix(componentCount)}, ${resourceCount} resource${pluralSuffix(resourceCount)})`
  );
  if (kindFilter) {
    lines.push(`  filter: kind=${kindFilter}`);
  }
  lines.push(
    `  hyperedges: ${filteredEdges.length}${kindFilter ? ` (of ${totalEdgeCount} total)` : ""}`
  );
  if (kindFilter) {
    if (filteredEdges.length > 0) {
      lines.push(`    ${kindFilter}: ${filteredEdges.length}`);
    }
  } else {
    const kindCounts = new Map<string, number>();
    for (const edge of filteredEdges) {
      kindCounts.set(edge.kind, (kindCounts.get(edge.kind) ?? 0) + 1);
    }
    for (const [kind, count] of [...kindCounts.entries()].sort(([leftKind], [rightKind]) =>
      leftKind.localeCompare(rightKind)
    )) {
      lines.push(`    ${kind}: ${count}`);
    }
  }
  lines.push(`  incidences: ${totalIncidences}`);
  if (filteredEdges.length > 0) {
    const averageArity = totalIncidences / filteredEdges.length;
    lines.push(`  arity: min ${minArity}, max ${maxArity}, avg ${averageArity.toFixed(2)}`);
    if (maxArity > 2 && widestEdge) {
      lines.push(`    widest: ${widestEdge.kind} ${displaySymbol(widestEdge.name)}`);
    }
  }
  lines.push(`  isolated vertices: ${isolatedVertices.length}`);
  if (isolatedVertices.length > 0 && isolatedVertices.length <= 8) {
    lines.push(
      `    ${isolatedVertices.map((vertex) => formatVertexHeader(vertex, model)).join(", ")}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

export function formatDiagnostics(result: CheckResult): string {
  if (result.diagnostics.length === 0) {
    return "Shape check passed.\n";
  }

  return `${result.diagnostics.map(formatDiagnostic).join("\n\n")}\n`;
}

function lowerShapeModules(modules: ShapeModule[] | CheckModuleInput[]): Model {
  const inputs = normalizeModuleInputs(modules);
  const model: Model = {
    modules: new Map(),
    declarations: emptyDeclarationIndex(),
    resources: new Map(),
    traits: new Map(PRELUDE_TRAITS.map((trait) => [trait.name, preludeTraitInfo(trait)])),
    components: new Map(),
    hypergraph: {
      edges: new Map(),
      incidence: new Map()
    },
    candidateEffects: new Map(),
    implementations: [],
    bindings: new Map(),
    rules: [],
    rationales: new Map(),
    memories: new Map(),
    reevaluations: new Map(),
    roles: new Map(),
    policies: new Map(),
    userContextRequirements: [],
    attestations: [],
    shapeUpdatePaths: new Map(),
    changeEvents: [],
    facts: [],
    diagnostics: []
  };

  const contexts = new Map<CheckModuleInput, LoweringContext>();
  for (const input of inputs) {
    const context = moduleContext(input);
    contexts.set(input, context);
    model.modules.set(context.name, context);
    indexModuleDeclarations(input.module, context, model);
  }

  for (const input of inputs) {
    const context = contexts.get(input) ?? moduleContext(input);
    for (const declaration of input.module.declarations) {
      if (isResourceDecl(declaration)) {
        lowerResource(declaration, context, model);
      } else if (isTraitDecl(declaration)) {
        lowerTrait(declaration, context, model);
      } else if (isComponentDecl(declaration)) {
        lowerComponent(declaration, context, model);
      } else if (isRelationDecl(declaration)) {
        lowerRelation(declaration, context, model);
      } else if (isCandidateEffectDecl(declaration)) {
        lowerCandidateEffect(declaration, context, model);
      } else if (isImplementationDecl(declaration)) {
        lowerImplementation(declaration, context, model);
      } else if (isBindingDecl(declaration)) {
        lowerBinding(declaration, context, model);
      } else if (isAttestationDecl(declaration)) {
        lowerAttestation(declaration, context, model);
      } else if (isRuleDecl(declaration)) {
        lowerRule(declaration, context, model);
      } else if (isRationaleDecl(declaration)) {
        lowerRationale(declaration, context, model);
      } else if (isMemoryDecl(declaration)) {
        lowerMemory(declaration, context, model);
      } else if (isReevaluationDecl(declaration)) {
        lowerReevaluation(declaration, context, model);
      } else if (isRoleDecl(declaration)) {
        lowerRole(declaration, context, model);
      } else if (isPolicyDecl(declaration)) {
        lowerPolicy(declaration, context, model);
      }
    }
  }

  for (const input of inputs) {
    const context = contexts.get(input) ?? moduleContext(input);
    for (const declaration of input.module.declarations) {
      if (isChangeDecl(declaration)) {
        lowerChange(declaration, context, model);
      }
    }
  }

  rebuildShapeUpdatePaths(model);
  emitDerivedFacts(model);
  return model;
}

function rebuildShapeUpdatePaths(model: Model): void {
  model.shapeUpdatePaths = new Map();
  model.facts = model.facts.filter((fact) => fact.kind !== "shape_update_for");

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      collectShapeUpdatePathsFromFunction(fn, model);
    }
  }
}

function normalizeModuleInputs(modules: ShapeModule[] | CheckModuleInput[]): CheckModuleInput[] {
  return modules.map((input) => {
    if ("module" in input) {
      return input;
    }
    return { module: input };
  });
}

function emptyDeclarationIndex(): DeclarationIndex {
  return {
    resource: new Map(),
    component: new Map(),
    trait: new Map(),
    relation: new Map(),
    candidate_effect: new Map(),
    implementation: new Map(),
    binding: new Map(),
    rationale: new Map(),
    memory: new Map(),
    reevaluation: new Map(),
    rule: new Map()
  };
}

function moduleContext(input: CheckModuleInput): LoweringContext {
  const name = input.module.name ?? "";
  return {
    name,
    imports: input.module.imports.map((item) => item.path),
    filePath: input.filePath,
    generatedAst: input.origin === "generated_ast"
  };
}

function moduleOriginForShapeFile(module: ShapeModule, filePath: string): CheckModuleOrigin {
  const moduleName = module.name ?? "";
  const path = normalizeGeneratedAstPath(filePath);
  return isGeneratedAstModuleName(moduleName) && path.startsWith(`${GENERATED_AST_DIR}/`)
    ? "generated_ast"
    : "authored";
}

function indexModuleDeclarations(
  module: ShapeModule,
  context: LoweringContext,
  model: Model
): void {
  for (const declaration of module.declarations) {
    const kind = declarationIndexKind(declaration);
    if (!kind) {
      continue;
    }
    const names = model.declarations[kind].get(context.name) ?? new Set<string>();
    names.add(declarationNameForIndex(declaration));
    model.declarations[kind].set(context.name, names);
  }
}

function declarationNameForIndex(declaration: ShapeModule["declarations"][number]): string {
  if (isAttestationDecl(declaration)) {
    return declaration.kind;
  }
  if (isChangeDecl(declaration)) {
    return declaration.name;
  }
  return "name" in declaration ? declaration.name : "";
}

function declarationIndexKind(
  declaration: ShapeModule["declarations"][number]
): DeclarationKind | undefined {
  if (isResourceDecl(declaration)) {
    return "resource";
  }
  if (isComponentDecl(declaration)) {
    return "component";
  }
  if (isTraitDecl(declaration)) {
    return "trait";
  }
  if (isRelationDecl(declaration)) {
    return "relation";
  }
  if (isCandidateEffectDecl(declaration)) {
    return "candidate_effect";
  }
  if (isImplementationDecl(declaration)) {
    return "implementation";
  }
  if (isBindingDecl(declaration)) {
    return "binding";
  }
  if (isRationaleDecl(declaration)) {
    return "rationale";
  }
  if (isMemoryDecl(declaration)) {
    return "memory";
  }
  if (isReevaluationDecl(declaration)) {
    return "reevaluation";
  }
  if (isRuleDecl(declaration)) {
    return "rule";
  }
  return undefined;
}

function declKey(moduleName: string, localName: string): string {
  return moduleName ? `${moduleName}::${localName}` : localName;
}

function splitQualifiedName(name: string): { moduleName?: string; localName: string } {
  const separator = name.lastIndexOf("::");
  if (separator < 0) {
    return { localName: name };
  }
  return {
    moduleName: name.slice(0, separator),
    localName: name.slice(separator + 2)
  };
}

function localNameOf(name: string): string {
  return splitQualifiedName(name).localName;
}

function displaySymbol(name: string): string {
  return localNameOf(name);
}

function declaredLocally(
  model: Model,
  kind: DeclarationKind,
  moduleName: string,
  localName: string
): boolean {
  return model.declarations[kind].get(moduleName)?.has(localName) === true;
}

function resolveDeclName(
  name: string,
  kind: DeclarationKind,
  context: LoweringContext,
  model: Model
): string {
  const result = resolveDeclReference(name, kind, context, model);
  if (result.kind === "ambiguous") {
    model.diagnostics.push({
      kind: "ambiguous_name",
      nameKind: kind,
      name,
      matches: result.matches,
      filePath: context.filePath,
      causedBy: [describeProvenance(provenance(context.filePath, `${kind} reference ${name}`))]
    });
  }
  return result.name;
}

function resolveDeclReference(
  name: string,
  kind: DeclarationKind,
  context: LoweringContext,
  model: Model
): ResolutionResult {
  const qualified = splitQualifiedName(name);
  if (qualified.moduleName !== undefined) {
    return { kind: "resolved", name: declKey(qualified.moduleName, qualified.localName) };
  }
  if (
    kind === "trait" &&
    KNOWN_PRELUDE_TRAITS.has(name) &&
    !declaredLocally(model, kind, context.name, name)
  ) {
    return { kind: "resolved", name };
  }
  if (declaredLocally(model, kind, context.name, name)) {
    return { kind: "resolved", name: declKey(context.name, name) };
  }
  const importedMatches = context.imports
    .filter((moduleName) => declaredLocally(model, kind, moduleName, name))
    .map((moduleName) => declKey(moduleName, name))
    .sort();
  if (importedMatches.length > 1) {
    return { kind: "ambiguous", name: declKey(context.name, name), matches: importedMatches };
  }
  return importedMatches[0]
    ? { kind: "resolved", name: importedMatches[0] }
    : { kind: "unknown", name: declKey(context.name, name) };
}

function resolveVertexName(name: string, context: LoweringContext, model: Model): string {
  const result = resolveVertexReference(name, context, model);
  if (result.kind === "ambiguous") {
    model.diagnostics.push({
      kind: "ambiguous_name",
      nameKind: "relation_endpoint",
      name,
      matches: result.matches,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(provenance(context.filePath, `relation endpoint reference ${name}`))
      ]
    });
  }
  return result.name;
}

function resolveVertexReference(
  name: string,
  context: LoweringContext,
  model: Model
): ResolutionResult {
  const qualified = splitQualifiedName(name);
  if (qualified.moduleName !== undefined) {
    return { kind: "resolved", name: declKey(qualified.moduleName, qualified.localName) };
  }
  if (
    declaredLocally(model, "component", context.name, name) ||
    declaredLocally(model, "resource", context.name, name)
  ) {
    return { kind: "resolved", name: declKey(context.name, name) };
  }
  const importedMatches = [
    ...new Set(
      context.imports
        .filter(
          (moduleName) =>
            declaredLocally(model, "component", moduleName, name) ||
            declaredLocally(model, "resource", moduleName, name)
        )
        .map((moduleName) => declKey(moduleName, name))
    )
  ].sort();
  if (importedMatches.length > 1) {
    return { kind: "ambiguous", name: declKey(context.name, name), matches: importedMatches };
  }
  return importedMatches[0]
    ? { kind: "resolved", name: importedMatches[0] }
    : { kind: "unknown", name: declKey(context.name, name) };
}

function resolveTargetName(
  target: ShapeTarget,
  context: LoweringContext,
  model: Model
): ShapeTarget {
  if (target.kind === "fn") {
    return { kind: target.kind, name: resolveFunctionTargetName(target.name, context, model) };
  }
  const kind =
    target.kind === "relation"
      ? "relation"
      : target.kind === "implementation"
        ? "implementation"
        : target.kind === "rule"
          ? "rule"
          : target.kind;
  return {
    kind: target.kind,
    name: resolveDeclName(target.name, kind, context, model)
  };
}

function resolveFunctionTargetName(value: string, context: LoweringContext, model: Model): string {
  const [componentName, functionName] = splitFunctionTarget(value);
  if (!componentName || !functionName) {
    return value;
  }
  return functionKey(resolveDeclName(componentName, "component", context, model), functionName);
}

function resolveContextObjectName(
  kind: ContextKind,
  name: string,
  context: LoweringContext,
  model: Model
): string {
  return resolveDeclName(name, kind, context, model);
}

function lowerResource(resource: ResourceDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, resource.name);
  const prov = provenance(context.filePath, `resource ${name}`);
  if (model.resources.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "resource",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.resources.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const traits = new Map<string, Provenance>();
  for (const trait of resource.traits) {
    const traitName = resolveDeclName(trait.name, "trait", context, model);
    const traitProv = provenance(context.filePath, `resource ${name} : ${traitName}`);
    traits.set(traitName, traitProv);
    model.facts.push({
      kind: "resource_trait",
      resource: name,
      trait: traitName,
      provenance: traitProv
    });
  }

  const fingerprints = new Map<string, FingerprintInfo>();
  for (const member of resource.body?.members ?? []) {
    if (!isFingerprintDecl(member)) {
      continue;
    }
    const fingerprint = lowerFingerprint(member, context.filePath, `resource ${name}`);
    const existing = fingerprints.get(fingerprint.provider);
    if (existing) {
      model.diagnostics.push({
        kind: "duplicate_fingerprint",
        resource: name,
        provider: fingerprint.provider,
        filePath: context.filePath,
        causedBy: [
          describeProvenance(existing.provenance),
          describeProvenance(fingerprint.provenance)
        ]
      });
      continue;
    }
    fingerprints.set(fingerprint.provider, fingerprint);
    model.facts.push({
      kind: "resource_fingerprint",
      resource: name,
      provider: fingerprint.provider,
      value: fingerprint.value,
      provenance: fingerprint.provenance
    });
  }

  model.resources.set(name, {
    name,
    traits,
    fingerprints,
    generatedAstCandidate: context.generatedAst,
    provenance: prov
  });
  model.facts.push({ kind: "resource", name, provenance: prov });
}

function lowerTrait(trait: TraitDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, trait.name);
  const prov = provenance(context.filePath, `trait ${name}`);
  if (model.traits.has(name) && !isPreludeTrait(model.traits.get(name))) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "trait",
      name,
      filePath: context.filePath,
      causedBy: [describeProvenance(model.traits.get(name)?.provenance), describeProvenance(prov)]
    });
    return;
  }

  const typeParams = trait.typeParams?.params.map((param) => param.name) ?? [];
  const finalForbids: FinalForbidPattern[] = [];
  for (const member of trait.members) {
    if (isTraitForbidDecl(member)) {
      finalForbids.push(
        lowerForbidPattern(member, context, model, `trait ${name}`, new Set(typeParams))
      );
    } else if (isRequireContextDecl(member)) {
      model.userContextRequirements.push({
        trait: name,
        targetKind: requireContextTargetKind(trait, member.target),
        contextType: member.contextType,
        satisfiedBy: lowerSatisfiedByKinds(member.satisfiedBy),
        provenance: provenance(
          context.filePath,
          `trait ${name} require_context ${member.contextType}<${member.target}>`
        )
      });
    }
  }

  model.traits.set(name, {
    name,
    typeParams,
    finalForbids,
    provenance: prov
  });
}

/**
 * Resolves the target kind of a `require_context` obligation from the bound of
 * the trait type parameter it names (`<T: Fn>` -> fn). Unbound or unrecognised
 * type parameters default to fn, the most common shape-trait target.
 */
function requireContextTargetKind(trait: TraitDecl, typeParamName: string): TargetKind {
  const bound = trait.typeParams?.params.find((param) => param.name === typeParamName)?.bound;
  switch (bound?.toLowerCase()) {
    case "component":
      return "component";
    case "resource":
      return "resource";
    default:
      return "fn";
  }
}

function lowerSatisfiedByKinds(kinds: string[]): ContextKind[] {
  const allowed = kinds.filter(
    (kind): kind is ContextKind => kind === "rationale" || kind === "memory"
  );
  return allowed.length > 0 ? [...new Set(allowed)] : ["rationale", "memory"];
}

function lowerComponent(component: ComponentDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, component.name);
  const prov = provenance(context.filePath, `component ${name}`);
  if (model.components.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "component",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.components.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: ComponentInfo = {
    name,
    classifiers: new Map(),
    grants: new Map(),
    owns: new Map(),
    functions: new Map(),
    generatedAstCandidate: context.generatedAst,
    provenance: prov
  };

  for (const classifier of component.classifiers) {
    const traitName = resolveDeclName(classifier.name, "trait", context, model);
    const classifierProv = provenance(context.filePath, `component ${name} : ${traitName}`);
    info.classifiers.set(traitName, classifierProv);
    model.facts.push({
      kind: "shape_trait",
      targetKind: "component",
      target: name,
      trait: traitName,
      provenance: classifierProv
    });
  }

  for (const member of component.members) {
    if (isOwnsDecl(member)) {
      const resourceName = resolveDeclName(member.resource.name, "resource", context, model);
      const memberProv = provenance(context.filePath, `component ${name} owns ${resourceName}`);
      info.owns.set(resourceName, memberProv);
      model.facts.push({
        kind: "owns",
        component: name,
        resource: resourceName,
        provenance: memberProv
      });
    } else if (isGrantsDecl(member)) {
      const grant = lowerTerm(member.term, context, model);
      const memberProv = provenance(
        context.filePath,
        `component ${name} grants ${formatTerm(grant.name, grant.target ?? "")}`
      );
      info.grants.set(termKey(grant), memberProv);
      model.facts.push({
        kind: "grants",
        component: name,
        effect: grant.name,
        target: grant.target ?? "",
        provenance: memberProv
      });
    } else if (isFunctionSummary(member)) {
      const fn = lowerFunction(member, name, context, model);
      info.functions.set(fn.name, fn);
      emitFunctionFacts(fn, model);
    }
  }

  model.components.set(name, info);
  model.facts.push({ kind: "component", name, provenance: prov });
}

function lowerRelation(relation: RelationDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, relation.name);
  const prov = provenance(context.filePath, `relation ${name}`);
  if (model.hypergraph.edges.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "relation",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.hypergraph.edges.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  let kindValue: string | undefined;
  let kindSeen = false;
  let connectsDecl: ReturnType<typeof collectConnects> | undefined;
  let summary: string | undefined;
  let summarySeen = false;
  let rolesSeen = false;
  const roleDecls: RelationRoleEntry[] = [];
  const fingerprintExpectations: FingerprintExpectationInfo[] = [];

  for (const member of relation.members) {
    if (isRelationKindDecl(member)) {
      if (kindSeen) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate kind",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      kindSeen = true;
      kindValue = member.value;
    } else if (isRelationConnectsDecl(member)) {
      if (connectsDecl) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate connects",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      connectsDecl = collectConnects(member, context, model);
    } else if (isRelationRolesDecl(member)) {
      if (rolesSeen) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate roles",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      rolesSeen = true;
      for (const role of member.roles) {
        roleDecls.push(role);
      }
    } else if (isRelationFingerprintExpectationDecl(member)) {
      const endpoint = resolveVertexName(member.endpoint.name, context, model);
      fingerprintExpectations.push({
        endpoint,
        provider: member.provider,
        value: unquoteShapeString(member.value),
        provenance: provenance(
          context.filePath,
          `relation ${name} expects ${endpoint} fingerprint ${member.provider}`
        )
      });
    } else if (isRelationSummaryDecl(member)) {
      if (summarySeen) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate summary",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      summarySeen = true;
      summary = unquoteShapeString(member.value);
    }
  }

  if (!kindValue) {
    model.diagnostics.push({
      kind: "invalid_relation",
      name,
      reason: "missing kind",
      filePath: context.filePath,
      causedBy: [describeProvenance(prov)]
    });
    return;
  }

  if (!connectsDecl) {
    model.diagnostics.push({
      kind: "invalid_relation",
      name,
      reason: "missing connects",
      filePath: context.filePath,
      causedBy: [describeProvenance(prov)]
    });
    return;
  }

  if (connectsDecl.endpoints.length < 2) {
    model.diagnostics.push({
      kind: "invalid_relation",
      name,
      reason: "connects requires at least two endpoints",
      filePath: context.filePath,
      causedBy: [describeProvenance(prov)]
    });
    return;
  }

  const seen = new Set<string>();
  for (const endpoint of connectsDecl.endpoints) {
    if (seen.has(endpoint)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `duplicate endpoint ${displaySymbol(endpoint)}`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
    seen.add(endpoint);
  }

  const rule = PRELUDE_RELATION_KINDS.get(kindValue);
  if (rule) {
    if (rule.arity === "binary" && connectsDecl.endpoints.length !== 2) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `kind ${kindValue} requires exactly two endpoints`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
    if (rule.arity === "ordered" && !connectsDecl.ordered) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `kind ${kindValue} requires ordered connects (A -> B -> ...)`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
    if (rule.cycleTraversal === "directed_pairs" && !connectsDecl.ordered) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `kind ${kindValue} requires ordered connects (A -> B)`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
  }

  const endpointSet = new Set(connectsDecl.endpoints);
  const roleByEndpoint = new Map<string, string>();
  for (const role of roleDecls) {
    const roleName = resolveVertexName(role.name, context, model);
    if (!endpointSet.has(roleName)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `role ${displaySymbol(roleName)} is not a connects endpoint`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      continue;
    }
    if (roleByEndpoint.has(roleName)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `duplicate role for ${displaySymbol(roleName)}`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      continue;
    }
    roleByEndpoint.set(roleName, role.role);
  }

  for (const expectation of fingerprintExpectations) {
    if (!endpointSet.has(expectation.endpoint)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `fingerprint expectation ${displaySymbol(expectation.endpoint)} is not a connects endpoint`,
        filePath: context.filePath,
        causedBy: [describeProvenance(expectation.provenance)]
      });
    }
  }

  const members: HyperedgeMember[] = connectsDecl.endpoints.map((endpoint, index) => ({
    endpoint,
    index,
    role: roleByEndpoint.get(endpoint)
  }));

  const info: HyperedgeInfo = {
    name,
    kind: kindValue,
    ordered: connectsDecl.ordered,
    members,
    fingerprintExpectations,
    summary,
    provenance: prov
  };

  model.hypergraph.edges.set(name, info);
  for (const member of members) {
    const incident = model.hypergraph.incidence.get(member.endpoint) ?? [];
    incident.push(name);
    model.hypergraph.incidence.set(member.endpoint, incident);
  }

  model.facts.push({
    kind: "hyperedge",
    name,
    relationKind: kindValue,
    ordered: connectsDecl.ordered,
    provenance: prov
  });
  for (const member of members) {
    model.facts.push({
      kind: "hyperedge_member",
      hyperedge: name,
      endpoint: member.endpoint,
      index: member.index,
      role: member.role,
      provenance: provenance(context.filePath, `relation ${name} connects ${member.endpoint}`)
    });
  }
  for (const expectation of fingerprintExpectations) {
    model.facts.push({
      kind: "hyperedge_fingerprint_expectation",
      hyperedge: name,
      endpoint: expectation.endpoint,
      provider: expectation.provider,
      value: expectation.value,
      provenance: expectation.provenance
    });
  }
}

function removeRelation(name: string, model: Model): void {
  const info = model.hypergraph.edges.get(name);
  if (!info) {
    return;
  }
  model.hypergraph.edges.delete(name);
  for (const member of info.members) {
    const incident = model.hypergraph.incidence.get(member.endpoint);
    if (!incident) {
      continue;
    }
    const filtered = incident.filter((edge) => edge !== name);
    if (filtered.length === 0) {
      model.hypergraph.incidence.delete(member.endpoint);
    } else {
      model.hypergraph.incidence.set(member.endpoint, filtered);
    }
  }
}

function collectConnects(
  member: { endpoints: RelationEndpoint[]; ordered: boolean },
  context: LoweringContext,
  model: Model
): {
  endpoints: string[];
  ordered: boolean;
} {
  return {
    endpoints: member.endpoints.map((endpoint) => resolveVertexName(endpoint.name, context, model)),
    ordered: member.ordered
  };
}

function lowerCandidateEffect(
  candidateEffect: CandidateEffectDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, candidateEffect.name);
  const prov = provenance(context.filePath, `effect candidate ${name}`);
  if (model.candidateEffects.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "candidate_effect",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.candidateEffects.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: CandidateEffectInfo = {
    name,
    provenance: prov
  };
  const seen = {
    fn: 0,
    effect: 0,
    source: 0,
    confidence: 0,
    pin: 0
  };

  for (const member of candidateEffect.members) {
    if (isCandidateEffectFunctionDecl(member)) {
      seen.fn += 1;
      if (seen.fn > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate fn", context.filePath, prov);
        continue;
      }
      info.functionTarget = resolveFunctionTargetName(member.function, context, model);
    } else if (isCandidateEffectTermDecl(member)) {
      seen.effect += 1;
      if (seen.effect > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate effect", context.filePath, prov);
        continue;
      }
      info.term = lowerTerm(member.term, context, model);
    } else if (isCandidateEffectConfidenceDecl(member)) {
      seen.confidence += 1;
      if (seen.confidence > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate confidence", context.filePath, prov);
        continue;
      }
      info.confidence = member.value;
    } else if (isCandidateEffectAnchorDecl(member)) {
      seen.pin += 1;
      if (seen.pin > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate pin", context.filePath, prov);
        continue;
      }
      info.anchor = resolveDeclName(member.target.name, "resource", context, model);
      info.fingerprintProvider = member.provider;
      info.fingerprintValue = unquoteShapeString(member.value);
    } else {
      seen.source += 1;
      if (seen.source > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate source", context.filePath, prov);
        continue;
      }
      info.source = lowerSourceRef(member);
    }
  }

  for (const [field, count] of Object.entries(seen)) {
    if (count === 0) {
      pushInvalidCandidateEffect(model, name, `missing ${field}`, context.filePath, prov);
    }
  }

  model.candidateEffects.set(name, info);
  model.facts.push({
    kind: "candidate_effect",
    name,
    functionTarget: info.functionTarget ?? "",
    effect: info.term?.name ?? "",
    target: info.term?.target ?? "",
    source: info.source,
    confidence: info.confidence,
    anchor: info.anchor,
    fingerprintProvider: info.fingerprintProvider,
    fingerprintValue: info.fingerprintValue,
    provenance: prov
  });
}

function pushInvalidCandidateEffect(
  model: Model,
  name: string,
  reason: string,
  filePath: string | undefined,
  provenanceInfo: Provenance
): void {
  model.diagnostics.push({
    kind: "invalid_candidate_effect",
    name,
    reason,
    filePath,
    causedBy: [describeProvenance(provenanceInfo)]
  });
}

function lowerImplementation(
  implementation: ImplementationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, implementation.name);
  const prov = provenance(context.filePath, `implementation ${name}`);
  const info: ImplementationInfo = {
    name,
    paths: [],
    provenance: prov
  };

  for (const member of implementation.members) {
    if (isPathsBlock(member)) {
      for (const path of member.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `implementation ${name} path ${glob}`);
        info.paths.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "implementation_path",
          implementation: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isConformsToDecl(member)) {
      info.conformsTo = resolveDeclName(member.component.name, "component", context, model);
      model.facts.push({
        kind: "conforms_to",
        implementation: name,
        component: info.conformsTo,
        provenance: provenance(
          context.filePath,
          `implementation ${name} conforms_to ${info.conformsTo}`
        )
      });
    } else if (isOnChangeDecl(member)) {
      info.onChangeRequirement = member.requirement;
    }
  }

  model.implementations.push(info);
  model.facts.push({ kind: "implementation", name, provenance: prov });
}

function lowerBinding(binding: BindingDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, binding.name);
  const prov = provenance(context.filePath, `binding ${name}`);
  if (model.bindings.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "binding",
      name,
      filePath: context.filePath,
      causedBy: [describeProvenance(model.bindings.get(name)?.provenance), describeProvenance(prov)]
    });
    return;
  }

  const info: BindingInfo = {
    name,
    whenChanged: [],
    requireChanged: [],
    allowAttestations: [],
    provenance: prov
  };

  for (const member of binding.members) {
    if (isBindingWhenChangedDecl(member)) {
      for (const path of member.body.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `binding ${name} when_changed ${glob}`);
        info.whenChanged.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "binding_when_changed",
          binding: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isBindingRequireChangedDecl(member)) {
      for (const path of member.body.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `binding ${name} require_changed ${glob}`);
        info.requireChanged.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "binding_require_changed",
          binding: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isBindingAllowAttestDecl(member)) {
      const attestProv = provenance(
        context.filePath,
        `binding ${name} allow attest ${member.kind}`
      );
      info.allowAttestations.push({ kind: member.kind, provenance: attestProv });
      model.facts.push({
        kind: "binding_allow_attest",
        binding: name,
        kindName: member.kind,
        provenance: attestProv
      });
    }
  }

  model.bindings.set(name, info);
  model.facts.push({ kind: "binding", name, provenance: prov });
}

function lowerAttestation(
  attestation: AttestationDecl,
  context: LoweringContext,
  model: Model
): void {
  const source = lowerSourceRef(attestation.source);
  const path = normalizeShapeSourcePath(source.path);
  const reason = unquoteShapeString(attestation.reason.value);
  const prov = provenance(context.filePath, `attest ${attestation.kind} for ${path}`);
  model.attestations.push({ kind: attestation.kind, path, reason, provenance: prov });
  model.facts.push({
    kind: "attestation",
    kindName: attestation.kind,
    path,
    reason,
    provenance: prov
  });
}

function lowerRule(rule: RuleDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, rule.name);
  const finalForbidSubjects = new Set(
    rule.members.filter(isRuleWhenHasDecl).map((member) => member.subject)
  );
  const hasFinalForbid = rule.members.some(
    (member) => isRuleForbidEffectDecl(member) && member.final
  );
  const finalForbidSubject =
    hasFinalForbid && finalForbidSubjects.size === 1 ? [...finalForbidSubjects][0] : undefined;
  const info: RuleInfo = {
    name,
    whenHas: [],
    finalForbidSubject,
    forbidEffects: [],
    forbidProvides: [],
    forbidHypercycles: [],
    provenance: provenance(context.filePath, `rule ${name}`)
  };

  for (const member of rule.members) {
    if (isRuleWhenHasDecl(member)) {
      info.whenHas.push({
        subject: member.subject,
        trait: resolveDeclName(member.trait, "trait", context, model)
      });
    } else if (isRuleForbidEffectDecl(member)) {
      info.forbidEffects.push(lowerRuleForbid(member, context, model, name, finalForbidSubjects));
    } else if (isRuleForbidProvidesDecl(member)) {
      info.forbidProvides.push(lowerRuleForbidProvides(member, context, model, name));
    } else if (isRuleForbidHypercycleDecl(member)) {
      info.forbidHypercycles.push(lowerRuleForbidHypercycle(member, context.filePath, name));
    }
  }

  model.rules.push(info);
  model.facts.push({ kind: "rule", name, provenance: info.provenance });
}

function lowerRationale(rationale: RationaleDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, rationale.name);
  const prov = provenance(context.filePath, `rationale ${name}`);
  if (model.rationales.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "rationale",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.rationales.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: RationaleInfo = {
    name,
    contextType: rationale.contextType.name,
    target: lowerTargetRef(rationale.contextType.target, context, model),
    protects: [],
    guards: [],
    forbiddenTransforms: [],
    evidence: [],
    provenance: prov
  };

  for (const member of rationale.members) {
    if (lowerContextMember(member, info, "rationale", context, model)) {
      continue;
    }

    if (isWhyDecl(member)) {
      info.why = member.reason;
    }
  }

  model.rationales.set(name, info);
  model.facts.push({
    kind: "rationale",
    name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts("rationale", info, model);
}

function lowerMemory(memory: MemoryDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, memory.name);
  const prov = provenance(context.filePath, `memory ${name}`);
  if (model.memories.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "memory",
      name,
      filePath: context.filePath,
      causedBy: [describeProvenance(model.memories.get(name)?.provenance), describeProvenance(prov)]
    });
    return;
  }

  const info: MemoryInfo = {
    name,
    contextType: memory.contextType.name,
    target: lowerTargetRef(memory.contextType.target, context, model),
    sensitive: false,
    protects: [],
    guards: [],
    forbiddenTransforms: [],
    observed: [],
    evidence: [],
    provenance: prov
  };

  for (const member of memory.members) {
    if (lowerContextMember(member, info, "memory", context, model)) {
      continue;
    }

    if (isStatusDecl(member)) {
      info.status = member.value;
    } else if (isConfidenceDecl(member)) {
      info.confidence = member.value;
    } else if (isObservedDecl(member)) {
      info.observed.push(lowerSourceRef(member));
    } else if (isSensitiveDecl(member)) {
      info.sensitive = true;
    }
  }

  model.memories.set(name, info);
  model.facts.push({
    kind: "memory",
    name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts("memory", info, model);
}

function lowerContextMember(
  member: RationaleMember | MemoryMember,
  info: ContextObjectInfo,
  kind: ContextKind,
  context: LoweringContext,
  model: Model
): boolean {
  if (isAppliesToDecl(member)) {
    info.appliesTo = lowerTargetRef(member.target, context, model);
    return true;
  }
  if (isSummaryDecl(member)) {
    info.summary = unquoteShapeString(member.value);
    return true;
  }
  if (isOwnerDecl(member)) {
    info.owner = member.value;
    return true;
  }
  if (isReviewByDecl(member)) {
    info.reviewBy = unquoteShapeString(member.value);
    return true;
  }
  if (isProtectsDecl(member)) {
    const value = member.value ?? "";
    info.protects.push({
      kind: member.kind,
      value,
      provenance: provenance(
        context.filePath,
        `${kind} ${info.name} protects ${member.kind}${value ? ` ${value}` : ""}`
      )
    });
    return true;
  }
  if (isGuardDecl(member)) {
    if (member.forbiddenTransform) {
      info.forbiddenTransforms.push({
        label: member.forbiddenTransform,
        provenance: provenance(
          context.filePath,
          `${kind} ${info.name} guards forbid transform ${member.forbiddenTransform}`
        )
      });
    } else if (member.requirement) {
      info.guards.push({
        requirement: member.requirement,
        provenance: provenance(
          context.filePath,
          `${kind} ${info.name} guards on_change require ${member.requirement}`
        )
      });
    }
    return true;
  }
  if (isEvidenceLineDecl(member)) {
    info.evidence.push(lowerSourceRef(member));
    return true;
  }
  return false;
}

function lowerReevaluation(
  reevaluation: ReevaluationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, reevaluation.name);
  const prov = provenance(context.filePath, `reevaluation ${name}`);
  if (model.reevaluations.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "reevaluation",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.reevaluations.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: ReevaluationInfo = {
    name,
    evidence: [],
    provenance: prov
  };

  for (const member of reevaluation.members) {
    if (isSatisfiesDecl(member)) {
      info.satisfiesKind = member.kind;
      info.satisfiesName = resolveContextObjectName(member.kind, member.name, context, model);
    } else if (isOutcomeDecl(member)) {
      info.outcome = member.value;
    } else if (isSummaryDecl(member)) {
      info.summary = unquoteShapeString(member.value);
    } else if (isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    } else if (isReviewerDecl(member)) {
      info.reviewer = member.value;
    } else if (isApproverDecl(member)) {
      info.approver = member.value;
    } else if (isDecidedOnDecl(member)) {
      info.decidedOn = unquoteShapeString(member.value);
    }
  }

  model.reevaluations.set(name, info);
  if (info.satisfiesKind && info.satisfiesName) {
    model.facts.push({
      kind: "reevaluation",
      name,
      satisfiesKind: info.satisfiesKind,
      satisfies: info.satisfiesName,
      provenance: prov
    });
  }
}

/**
 * A `role` declares a valid reviewer/approver identity. Roles are matched by
 * their local name, so a role declared in any module authorises that name.
 * Declaring at least one role turns on structural reviewer/approver validation.
 */
function lowerRole(role: RoleDecl, context: LoweringContext, model: Model): void {
  if (!model.roles.has(role.name)) {
    model.roles.set(role.name, provenance(context.filePath, `role ${role.name}`));
  }
}

function lowerPolicy(policy: PolicyDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, policy.name);
  if (model.policies.has(name)) {
    return;
  }
  model.policies.set(name, {
    name,
    requiresApprover: policy.members.some(isRequireApproverDecl),
    provenance: provenance(context.filePath, `policy ${name}`)
  });
}

function emitGuardFacts(kind: ContextKind, info: RationaleInfo | MemoryInfo, model: Model): void {
  for (const item of info.protects) {
    model.facts.push({
      kind: "protected_shape",
      guardKind: kind,
      guard: info.name,
      targetKind: info.target.kind,
      target: info.target.name,
      propertyKind: item.kind,
      propertyValue: item.value,
      provenance: item.provenance
    });
  }

  for (const guard of info.guards) {
    if (requiresReevaluation(guard)) {
      model.facts.push({
        kind: "guard_requires_reevaluation",
        guardKind: kind,
        guard: info.name,
        targetKind: info.target.kind,
        target: info.target.name,
        provenance: guard.provenance
      });
    }
  }
}

function lowerChange(change: ChangeDecl, context: LoweringContext, model: Model): void {
  for (const entry of change.entries) {
    if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
      const [componentName, functionName] = resolveFunctionTargetParts(
        entry.target,
        context,
        model
      );
      if (!componentName || !functionName) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: entry.target,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(
              provenance(context.filePath, `change ${change.name} ${entry.$type} ${entry.target}`)
            )
          ]
        });
        continue;
      }
      const component = model.components.get(componentName);
      if (!component) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: componentName,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(
              provenance(
                context.filePath,
                `change ${change.name} ${entry.$type} ${componentName}.${functionName}`
              )
            )
          ]
        });
        continue;
      }

      const previous = component.functions.get(functionName);
      const fn = lowerFunction(entry, componentName, context, model, `change ${change.name}`);
      if (isModifyFunctionChange(entry)) {
        const target = functionTarget(componentName, functionName);
        const changeProvenance = provenance(
          context.filePath,
          `change ${change.name} modify fn ${componentName}.${functionName}`
        );
        emitTargetChange(
          target,
          removedTraitsBetween(previous?.shapeTraits, fn.shapeTraits),
          descriptionDropped(previous, fn),
          changeProvenance,
          model
        );
        for (const label of entry.transforms?.labels ?? []) {
          model.changeEvents.push({
            kind: "transform_applied",
            target,
            label,
            provenance: changeProvenance
          });
        }
      }
      removeFunctionFacts(model, componentName, functionName);
      component.functions.set(fn.name, fn);
      emitFunctionFacts(fn, model);
    } else if (isRemoveFunctionChange(entry)) {
      const [componentName, functionName] = resolveFunctionTargetParts(
        entry.target,
        context,
        model
      );
      if (!componentName || !functionName) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: entry.target,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(
              provenance(context.filePath, `change ${change.name} remove fn ${entry.target}`)
            )
          ]
        });
        continue;
      }
      const removed = model.components.get(componentName)?.functions.get(functionName);
      emitTargetChange(
        functionTarget(componentName, functionName),
        removed ? [...removed.shapeTraits.keys()] : [],
        removed ? hasNonEmptyDescription(removed) : false,
        provenance(
          context.filePath,
          `change ${change.name} remove fn ${componentName}.${functionName}`
        ),
        model
      );
      removeFunctionFacts(model, componentName, functionName);
      model.components.get(componentName)?.functions.delete(functionName);
    } else if (isAddDeclarationChange(entry)) {
      lowerDeclaration(entry.declaration, context, model);
    } else if (isModifyDeclarationChange(entry)) {
      const kind = declarationKind(entry.declaration);
      if (kind !== "attestation") {
        const localName = declarationName(entry.declaration);
        const targetContext = contextForDeclarationChange(kind, localName, context, model);
        const resolvedName = resolveDeclName(localName, kind, targetContext, model);
        const before = declarationShapeTraits(kind, resolvedName, model);
        removeDeclaration(kind, localName, targetContext, model);
        lowerDeclaration(entry.declaration, targetContext, model);
        const after = declarationShapeTraits(kind, resolvedName, model);
        emitDeclarationChange(
          kind,
          resolvedName,
          removedTraitsBetween(before, after),
          provenance(context.filePath, `change ${change.name} modify ${kind} ${resolvedName}`),
          model
        );
        continue;
      }
      lowerDeclaration(entry.declaration, context, model);
    } else if (isRemoveDeclarationChange(entry)) {
      const resolvedName = resolveDeclName(entry.name, entry.kind, context, model);
      const before = declarationShapeTraits(entry.kind, resolvedName, model);
      emitDeclarationChange(
        entry.kind,
        resolvedName,
        before ? [...before.keys()] : [],
        provenance(context.filePath, `change ${change.name} remove ${entry.kind} ${resolvedName}`),
        model
      );
      removeDeclaration(entry.kind, entry.name, context, model);
    }
  }
}

function resolveFunctionTargetParts(
  target: string,
  context: LoweringContext,
  model: Model
): [string | undefined, string | undefined] {
  return splitFunctionTarget(resolveFunctionTargetName(target, context, model));
}

/**
 * Records a change to a target: a coarse `target_changed` event plus a
 * property-level `shape_trait_removed`/`description_removed` event for each
 * dropped property, so guarded-change checking can match either granularity.
 */
function emitTargetChange(
  target: ShapeTarget,
  removedTraits: string[],
  descriptionRemoved: boolean,
  prov: Provenance,
  model: Model
): void {
  model.changeEvents.push({ kind: "target_changed", target, provenance: prov });
  for (const trait of removedTraits) {
    model.changeEvents.push({ kind: "shape_trait_removed", target, trait, provenance: prov });
  }
  if (descriptionRemoved) {
    model.changeEvents.push({ kind: "description_removed", target, provenance: prov });
  }
}

function emitDeclarationChange(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string,
  removedTraits: string[],
  prov: Provenance,
  model: Model
): void {
  // Only target kinds that a guard can protect emit change events. Relations
  // carry no shape traits, so they record a coarse target change only.
  if (kind !== "component" && kind !== "resource" && kind !== "relation") {
    return;
  }
  emitTargetChange({ kind, name: resolvedName }, removedTraits, false, prov, model);
}

function declarationShapeTraits(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string,
  model: Model
): ReadonlyMap<string, Provenance> | undefined {
  if (kind === "component") {
    return model.components.get(resolvedName)?.classifiers;
  }
  if (kind === "resource") {
    return model.resources.get(resolvedName)?.traits;
  }
  return undefined;
}

function removedTraitsBetween(
  before: ReadonlyMap<string, Provenance> | undefined,
  after: ReadonlyMap<string, Provenance> | undefined
): string[] {
  if (!before) {
    return [];
  }
  return [...before.keys()].filter((trait) => after?.has(trait) !== true);
}

function descriptionDropped(previous: FunctionInfo | undefined, next: FunctionInfo): boolean {
  return (
    previous !== undefined && hasNonEmptyDescription(previous) && !hasNonEmptyDescription(next)
  );
}

function contextForDeclarationChange(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  context: LoweringContext,
  model: Model
): LoweringContext {
  const resolvedName = resolveDeclName(name, kind, context, model);
  const qualified = splitQualifiedName(resolvedName);
  if (!qualified.moduleName) {
    return context;
  }
  return {
    ...context,
    name: qualified.moduleName,
    imports: model.modules.get(qualified.moduleName)?.imports ?? []
  };
}

function lowerDeclaration(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"],
  context: LoweringContext,
  model: Model
): void {
  if (isResourceDecl(declaration)) {
    lowerResource(declaration, context, model);
  } else if (isTraitDecl(declaration)) {
    lowerTrait(declaration, context, model);
  } else if (isComponentDecl(declaration)) {
    lowerComponent(declaration, context, model);
  } else if (isRelationDecl(declaration)) {
    lowerRelation(declaration, context, model);
  } else if (isImplementationDecl(declaration)) {
    lowerImplementation(declaration, context, model);
  } else if (isBindingDecl(declaration)) {
    lowerBinding(declaration, context, model);
  } else if (isAttestationDecl(declaration)) {
    lowerAttestation(declaration, context, model);
  } else if (isRuleDecl(declaration)) {
    lowerRule(declaration, context, model);
  }
}

function removeDeclaration(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  context: LoweringContext,
  model: Model
): void {
  const resolvedName = resolveDeclName(name, kind, context, model);
  if (kind === "resource") {
    model.resources.delete(resolvedName);
  } else if (kind === "trait") {
    model.traits.delete(resolvedName);
  } else if (kind === "component") {
    model.components.delete(resolvedName);
  } else if (kind === "relation") {
    removeRelation(resolvedName, model);
  } else if (kind === "implementation") {
    model.implementations = model.implementations.filter(
      (implementation) => implementation.name !== resolvedName
    );
  } else if (kind === "binding") {
    model.bindings.delete(resolvedName);
  } else if (kind === "rule") {
    model.rules = model.rules.filter((rule) => rule.name !== resolvedName);
  }
}

function declarationKind(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"]
): RemoveDeclarationChange["kind"] | "attestation" {
  if (isResourceDecl(declaration)) {
    return "resource";
  }
  if (isTraitDecl(declaration)) {
    return "trait";
  }
  if (isComponentDecl(declaration)) {
    return "component";
  }
  if (isRelationDecl(declaration)) {
    return "relation";
  }
  if (isImplementationDecl(declaration)) {
    return "implementation";
  }
  if (isBindingDecl(declaration)) {
    return "binding";
  }
  if (isAttestationDecl(declaration)) {
    return "attestation";
  }
  return "rule";
}

function declarationName(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"]
): string {
  if (isAttestationDecl(declaration)) {
    return declaration.kind;
  }
  return declaration.name;
}

function lowerFunction(
  fn: FunctionAst,
  componentName: string,
  loweringContext: LoweringContext,
  model: Model,
  labelContext?: string
): FunctionInfo {
  const functionName = functionNameForAst(fn);
  const source = fn.source ? lowerSourceRef(fn.source) : undefined;
  const info: FunctionInfo = {
    component: componentName,
    name: functionName,
    source,
    unsafe: fn.unsafe,
    effects: lowerEffects(
      fn.effects,
      loweringContext.filePath,
      componentName,
      functionName,
      loweringContext,
      model
    ),
    requires: [],
    shapeTraits: lowerShapeTraits(fn, componentName, loweringContext, model, labelContext),
    description: fn.description
      ? lowerDescription(
          fn.description,
          componentName,
          functionName,
          loweringContext.filePath,
          labelContext
        )
      : undefined,
    generatedAstCandidate: loweringContext.generatedAst,
    provenance: provenance(
      loweringContext.filePath,
      `${labelContext ? `${labelContext} ` : ""}fn ${componentName}.${functionName}`
    )
  };

  for (const member of fn.members) {
    if (isFunctionRequiresDecl(member)) {
      info.requires.push(lowerTerm(member.term, loweringContext, model));
    } else if (isReasonDecl(member)) {
      info.reason = unquoteShapeString(member.value);
    } else if (isExpiresDecl(member)) {
      info.expires = unquoteShapeString(member.value);
    }
  }

  return info;
}

function functionNameForAst(fn: FunctionAst): string {
  if (isFunctionSummary(fn)) {
    return fn.name;
  }
  const [, functionName] = splitFunctionTarget(fn.target);
  return functionName ?? fn.target;
}

function lowerShapeTraits(
  fn: FunctionAst,
  componentName: string,
  context: LoweringContext,
  model: Model,
  labelContext?: string
): Map<string, Provenance> {
  const traits = new Map<string, Provenance>();
  const functionName = functionNameForAst(fn);
  for (const trait of fn.shapeTraits?.traits ?? []) {
    const traitName = resolveDeclName(trait.name, "trait", context, model);
    traits.set(
      traitName,
      provenance(
        context.filePath,
        `${labelContext ? `${labelContext} ` : ""}fn ${componentName}.${functionName} : ${traitName}`
      )
    );
  }
  return traits;
}

function lowerDescription(
  description: DescriptionDecl,
  componentName: string,
  functionName: string,
  filePath: string | undefined,
  context?: string
): DescriptionInfo {
  return {
    required: description.required,
    summary: unquoteShapeString(description.summary),
    provenance: provenance(
      filePath,
      `${context ? `${context} ` : ""}fn ${componentName}.${functionName} description`
    )
  };
}

function lowerEffects(
  effects: EffectsDecl,
  filePath: string | undefined,
  componentName: string,
  functionName: string,
  context: LoweringContext,
  model: Model
): EffectSummaryInfo {
  if (isUnknownEffects(effects)) {
    return { kind: "unknown" };
  }

  if (!isCompleteEffects(effects)) {
    return { kind: "unknown" };
  }

  return {
    kind: "complete",
    entries: effects.effects.map((entry) =>
      lowerEffectEntry(entry, filePath, componentName, functionName, context, model)
    )
  };
}

function lowerEffectEntry(
  entry: EffectEntry,
  filePath: string | undefined,
  componentName: string,
  functionName: string,
  context: LoweringContext,
  model: Model
): EffectEntryInfo {
  const term = lowerTerm(entry.term, context, model);
  return {
    term,
    evidence: entry.evidence ? lowerSourceRef(entry.evidence) : undefined,
    provenance: provenance(
      filePath,
      `effect ${componentName}.${functionName} emits ${formatTerm(term.name, term.target ?? "")}`
    )
  };
}

function lowerForbidPattern(
  member: TraitForbidDecl,
  context: LoweringContext,
  model: Model,
  owner: string,
  genericTargets: Set<string>
): FinalForbidPattern {
  const pattern = lowerPattern(member.pattern, context, model, genericTargets);
  return {
    effect: pattern.name,
    target: pattern.target,
    targetBinding: pattern.targetBinding,
    final: member.final,
    provenance: provenance(
      context.filePath,
      `${owner} forbids ${member.final ? "final " : ""}${formatTerm(pattern.name, pattern.target ?? "")}`
    )
  };
}

function lowerRuleForbid(
  member: RuleForbidEffectDecl,
  context: LoweringContext,
  model: Model,
  ruleName: string,
  genericTargets: Set<string>
): FinalForbidPattern {
  const pattern = lowerPattern(member.pattern, context, model, genericTargets);
  return {
    effect: pattern.name,
    target: pattern.target,
    targetBinding: pattern.targetBinding,
    final: member.final,
    provenance: provenance(
      context.filePath,
      `rule ${ruleName} forbids ${member.final ? "final " : ""}${formatTerm(pattern.name, pattern.target ?? "")}`
    )
  };
}

function lowerRuleForbidProvides(
  member: RuleForbidProvidesDecl,
  context: LoweringContext,
  model: Model,
  ruleName: string
): RuleInfo["forbidProvides"][number] {
  const target = resolveDeclName(member.target.name, "resource", context, model);
  const except = member.except
    ? resolveDeclName(member.except, "component", context, model)
    : undefined;
  return {
    target,
    except,
    provenance: provenance(context.filePath, `rule ${ruleName} forbids provides ${target}`)
  };
}

function lowerRuleForbidHypercycle(
  member: RuleForbidHypercycleDecl,
  filePath: string | undefined,
  ruleName: string
): RuleInfo["forbidHypercycles"][number] {
  return {
    kinds: [...member.kinds],
    provenance: provenance(
      filePath,
      `rule ${ruleName} forbids hypercycle${member.kinds.length > 0 ? ` over ${member.kinds.join(" or ")}` : ""}`
    )
  };
}

function lowerTerm(term: EffectTerm, context: LoweringContext, model: Model): TermInfo {
  return {
    name: term.name,
    target: term.target ? resolveDeclName(term.target.name, "resource", context, model) : undefined
  };
}

function lowerPattern(
  pattern: EffectPattern,
  context: LoweringContext,
  model: Model,
  genericTargets: Set<string>
): TermInfo & { targetBinding: FinalForbidPattern["targetBinding"] } {
  if (!pattern.target) {
    return {
      name: pattern.name,
      targetBinding: "omitted"
    };
  }
  const targetName = pattern.target.name;
  if (genericTargets.has(targetName)) {
    return {
      name: pattern.name,
      target: targetName,
      targetBinding: "generic"
    };
  }
  const result = resolveDeclReference(targetName, "resource", context, model);
  if (result.kind === "ambiguous") {
    model.diagnostics.push({
      kind: "ambiguous_name",
      nameKind: "resource",
      name: targetName,
      matches: result.matches,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(provenance(context.filePath, `resource reference ${targetName}`))
      ]
    });
  }
  return {
    name: pattern.name,
    target: result.name,
    targetBinding: result.kind === "ambiguous" ? "ambiguous" : "concrete"
  };
}

function lowerSourceRef(source: { ref: SourceRef }): SourceRefInfo {
  return {
    language: source.ref.language,
    path: unquoteShapeString(source.ref.path)
  };
}

function lowerFingerprint(
  fingerprint: FingerprintDecl,
  filePath: string | undefined,
  owner: string
): FingerprintInfo {
  return {
    provider: fingerprint.provider,
    value: unquoteShapeString(fingerprint.value),
    provenance: provenance(filePath, `${owner} fingerprint ${fingerprint.provider}`)
  };
}

function lowerTargetRef(target: TargetRef, context: LoweringContext, model: Model): ShapeTarget {
  return resolveTargetName(
    {
      kind: target.kind,
      name: target.name
    },
    context,
    model
  );
}

function functionTarget(component: string, name: string): ShapeTarget {
  return {
    kind: "fn",
    name: functionKey(component, name)
  };
}

function emitFunctionFacts(fn: FunctionInfo, model: Model): void {
  model.facts.push({
    kind: "function",
    component: fn.component,
    name: fn.name,
    provenance: fn.provenance
  });
  for (const [trait, traitProvenance] of fn.shapeTraits) {
    model.facts.push({
      kind: "shape_trait",
      targetKind: "fn",
      target: functionKey(fn.component, fn.name),
      trait,
      provenance: traitProvenance
    });
  }
  if (fn.description) {
    model.facts.push({
      kind: "description",
      targetKind: "fn",
      target: functionKey(fn.component, fn.name),
      required: fn.description.required,
      summary: fn.description.summary,
      provenance: fn.description.provenance
    });
  }
  if (fn.effects.kind === "unknown") {
    model.facts.push({
      kind: "effect_unknown",
      component: fn.component,
      functionName: fn.name,
      provenance: fn.provenance
    });
    return;
  }

  for (const entry of fn.effects.entries) {
    model.facts.push({
      kind: "effect",
      component: fn.component,
      functionName: fn.name,
      effect: entry.term.name,
      target: entry.term.target ?? "",
      provenance: entry.provenance
    });
  }
}

function removeFunctionFacts(model: Model, component: string, functionName: string): void {
  const target = functionKey(component, functionName);
  model.facts = model.facts.filter((fact) => {
    if (fact.kind === "function") {
      return fact.component !== component || fact.name !== functionName;
    }
    if (fact.kind === "effect" || fact.kind === "effect_unknown") {
      return fact.component !== component || fact.functionName !== functionName;
    }
    if (
      fact.kind === "shape_trait" ||
      fact.kind === "description" ||
      fact.kind === "context_required"
    ) {
      return fact.targetKind !== "fn" || fact.target !== target;
    }
    return true;
  });
}

function emitDerivedFacts(model: Model): void {
  for (const trait of model.traits.values()) {
    for (const forbid of trait.finalForbids) {
      model.facts.push({
        kind: "trait_final_forbid",
        trait: trait.name,
        effect: forbid.effect,
        target: forbid.target ?? "",
        provenance: forbid.provenance
      });
    }
  }

  for (const bearer of shapeTraitBearers(model)) {
    for (const requirement of requirementsForTarget(model, bearer.kind, bearer.traits)) {
      model.facts.push({
        kind: "context_required",
        targetKind: bearer.kind,
        target: bearer.target.name,
        contextType: requirement.contextType,
        requiredBy: requirement.trait,
        provenance: bearer.traits.get(requirement.trait) ?? bearer.fallback
      });
    }
  }
}

function collectShapeUpdatePathsFromFunction(fn: FunctionInfo, model: Model): void {
  if (shouldIgnoreFunctionForCoverage(fn)) {
    return;
  }

  if (fn.source) {
    addShapeUpdatePath(model, fn.source.path, fn.provenance);
    model.facts.push({
      kind: "shape_update_for",
      path: normalizeShapeSourcePath(fn.source.path),
      provenance: fn.provenance
    });
  }

  if (fn.effects.kind === "complete") {
    for (const entry of fn.effects.entries) {
      if (entry.evidence) {
        const path = normalizeShapeSourcePath(entry.evidence.path);
        addShapeUpdatePath(model, path, entry.provenance);
        model.facts.push({ kind: "shape_update_for", path, provenance: entry.provenance });
      }
    }
  }
}

function shouldIgnoreFunctionForCoverage(fn: FunctionInfo): boolean {
  return fn.generatedAstCandidate;
}

function shouldIgnoreUnknownEffectsDiagnostic(fn: FunctionInfo): boolean {
  return fn.generatedAstCandidate;
}

function addShapeUpdatePath(model: Model, path: string, provenance: Provenance): void {
  const normalized = normalizeShapeSourcePath(path);
  const existing = model.shapeUpdatePaths.get(normalized);
  if (existing) {
    existing.push(provenance);
  } else {
    model.shapeUpdatePaths.set(normalized, [provenance]);
  }
}

function checkResolvedNames(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const knownTraits = new Set([...KNOWN_PRELUDE_TRAITS, ...model.traits.keys()]);

  for (const resource of model.resources.values()) {
    for (const [trait, traitProv] of resource.traits) {
      if (!knownTraits.has(trait)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "trait",
          name: trait,
          filePath: traitProv.filePath,
          causedBy: [describeProvenance(traitProv)]
        });
      }
    }
  }

  for (const component of model.components.values()) {
    for (const [trait, traitProv] of component.classifiers) {
      if (!knownTraits.has(trait)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "trait",
          name: trait,
          filePath: traitProv.filePath,
          causedBy: [describeProvenance(traitProv)]
        });
      }
    }

    for (const [resource, ownProv] of component.owns) {
      if (!model.resources.has(resource)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: resource,
          filePath: ownProv.filePath,
          causedBy: [describeProvenance(ownProv)]
        });
      }
    }

    for (const fn of component.functions.values()) {
      for (const [trait, traitProv] of fn.shapeTraits) {
        if (!knownTraits.has(trait)) {
          diagnostics.push({
            kind: "unknown_name",
            nameKind: "trait",
            name: trait,
            filePath: traitProv.filePath,
            causedBy: [describeProvenance(traitProv)]
          });
        }
      }

      if (fn.effects.kind !== "complete") {
        continue;
      }
      for (const entry of fn.effects.entries) {
        const target = entry.term.target;
        if (target && !model.resources.has(target)) {
          diagnostics.push({
            kind: "unknown_name",
            nameKind: "resource",
            name: target,
            filePath: entry.provenance.filePath,
            causedBy: [describeProvenance(entry.provenance)]
          });
        }
      }
    }
  }

  for (const implementation of model.implementations) {
    if (implementation.conformsTo && !model.components.has(implementation.conformsTo)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "component",
        name: implementation.conformsTo,
        filePath: implementation.provenance.filePath,
        causedBy: [describeProvenance(implementation.provenance)]
      });
    }
  }

  for (const hyperedge of model.hypergraph.edges.values()) {
    for (const member of hyperedge.members) {
      if (!isResolvedVertex(member.endpoint, model)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "relation_endpoint",
          name: member.endpoint,
          filePath: hyperedge.provenance.filePath,
          causedBy: [describeProvenance(hyperedge.provenance)]
        });
      } else if (isAmbiguousVertex(member.endpoint, model)) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `endpoint ${displaySymbol(member.endpoint)} resolves to both a component and a resource`,
          filePath: hyperedge.provenance.filePath,
          causedBy: [describeProvenance(hyperedge.provenance)]
        });
      }
    }

    if (hyperedge.kind === "provides") {
      diagnostics.push(...checkProvidesEndpointKinds(hyperedge, model));
    }
  }

  for (const candidateEffect of model.candidateEffects.values()) {
    if (!candidateEffect.functionTarget) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "component",
        name: `${candidateEffect.name} function`,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    } else if (!targetExists({ kind: "fn", name: candidateEffect.functionTarget }, model)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "component",
        name: candidateEffect.functionTarget,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    }
    const target = candidateEffect.term?.target;
    if (target && !model.resources.has(target)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "resource",
        name: target,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    }
    if (candidateEffect.anchor && !model.resources.has(candidateEffect.anchor)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "resource",
        name: candidateEffect.anchor,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    }
  }

  for (const trait of model.traits.values()) {
    for (const forbid of trait.finalForbids) {
      if (
        forbid.target &&
        forbid.targetBinding === "concrete" &&
        !model.resources.has(forbid.target)
      ) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: forbid.target,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
    }
  }

  for (const rule of model.rules) {
    for (const forbid of rule.forbidEffects) {
      if (
        forbid.target &&
        forbid.targetBinding === "concrete" &&
        !model.resources.has(forbid.target)
      ) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: forbid.target,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
    }
    for (const forbid of rule.forbidProvides) {
      if (!model.resources.has(forbid.target)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: forbid.target,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
      if (forbid.except && !model.components.has(forbid.except)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: forbid.except,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
    }
  }

  return diagnostics;
}

function checkRules(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    const hasFinalForbid = rule.forbidEffects.some((forbid) => forbid.final);
    if (!hasFinalForbid) {
      continue;
    }

    const subjects = [...new Set(rule.whenHas.map((when) => when.subject))];
    if (subjects.length === 0) {
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: "final effect forbids require exactly one when subject",
        filePath: rule.provenance.filePath,
        causedBy: [describeProvenance(rule.provenance)]
      });
    } else if (subjects.length > 1) {
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: `final effect forbids may bind only one subject, but found ${subjects.join(", ")}`,
        filePath: rule.provenance.filePath,
        causedBy: [describeProvenance(rule.provenance)]
      });
    }
  }

  return diagnostics;
}

function isResolvedVertex(name: string, model: Model): boolean {
  return model.components.has(name) || model.resources.has(name);
}

function isAmbiguousVertex(name: string, model: Model): boolean {
  return model.components.has(name) && model.resources.has(name);
}

function checkProvidesEndpointKinds(hyperedge: HyperedgeInfo, model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const provider = providesProvider(hyperedge);
  const target = providesTarget(hyperedge);

  if (provider && isResolvedVertex(provider, model) && !model.components.has(provider)) {
    diagnostics.push({
      kind: "invalid_relation",
      name: hyperedge.name,
      reason: `provides provider ${displaySymbol(provider)} must be a component`,
      filePath: hyperedge.provenance.filePath,
      causedBy: [describeProvenance(hyperedge.provenance)]
    });
  }

  if (target && isResolvedVertex(target, model) && !model.resources.has(target)) {
    diagnostics.push({
      kind: "invalid_relation",
      name: hyperedge.name,
      reason: `provides target ${displaySymbol(target)} must be a resource`,
      filePath: hyperedge.provenance.filePath,
      causedBy: [describeProvenance(hyperedge.provenance)]
    });
  }

  return diagnostics;
}

function checkFingerprintExpectations(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const hyperedge of model.hypergraph.edges.values()) {
    const endpointSet = new Set(hyperedge.members.map((member) => member.endpoint));
    for (const expectation of hyperedge.fingerprintExpectations) {
      if (!endpointSet.has(expectation.endpoint)) {
        continue;
      }
      if (!isResolvedVertex(expectation.endpoint, model)) {
        continue;
      }
      if (isAmbiguousVertex(expectation.endpoint, model)) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `fingerprint expectation endpoint ${displaySymbol(expectation.endpoint)} resolves to both a component and a resource`,
          filePath: expectation.provenance.filePath,
          causedBy: [describeProvenance(expectation.provenance)]
        });
        continue;
      }

      const resource = model.resources.get(expectation.endpoint);
      if (!resource) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `fingerprint expectation endpoint ${displaySymbol(expectation.endpoint)} must be a resource`,
          filePath: expectation.provenance.filePath,
          causedBy: [describeProvenance(expectation.provenance)]
        });
        continue;
      }

      const actual = resource.fingerprints.get(expectation.provider);
      if (!actual || actual.value !== expectation.value) {
        diagnostics.push({
          kind: "fingerprint_mismatch",
          relation: hyperedge.name,
          endpoint: expectation.endpoint,
          provider: expectation.provider,
          expected: expectation.value,
          actual: actual?.value,
          filePath: expectation.provenance.filePath,
          causedBy: [
            describeProvenance(expectation.provenance),
            describeProvenance(resource.provenance),
            ...(actual ? [describeProvenance(actual.provenance)] : [])
          ]
        });
      }
    }
  }

  return diagnostics;
}

function checkCandidateEffectFingerprints(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const candidateEffect of model.candidateEffects.values()) {
    if (
      !candidateEffect.anchor ||
      !candidateEffect.fingerprintProvider ||
      !candidateEffect.fingerprintValue
    ) {
      continue;
    }

    const anchor = model.resources.get(candidateEffect.anchor);
    if (!anchor) {
      continue;
    }

    const actual = anchor.fingerprints.get(candidateEffect.fingerprintProvider);
    if (!actual || actual.value !== candidateEffect.fingerprintValue) {
      diagnostics.push({
        kind: "candidate_pin_fingerprint_mismatch",
        candidateEffect: candidateEffect.name,
        anchor: candidateEffect.anchor,
        provider: candidateEffect.fingerprintProvider,
        expected: candidateEffect.fingerprintValue,
        actual: actual?.value,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [
          describeProvenance(candidateEffect.provenance),
          describeProvenance(anchor.provenance),
          ...(actual ? [describeProvenance(actual.provenance)] : [])
        ]
      });
    }
  }

  return diagnostics;
}

function checkContextTargets(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rationale of model.rationales.values()) {
    diagnostics.push(...checkContextTarget("rationale", rationale, model));
  }

  for (const memory of model.memories.values()) {
    diagnostics.push(...checkContextTarget("memory", memory, model));
  }

  return diagnostics;
}

function checkContextTarget(
  kind: ContextKind,
  context: RationaleInfo | MemoryInfo,
  model: Model
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  if (!targetExists(context.target, model)) {
    diagnostics.push({
      kind: "invalid_context_target",
      contextKind: kind,
      name: context.name,
      targetKind: context.target.kind,
      target: context.target.name,
      filePath: context.provenance.filePath,
      causedBy: [describeProvenance(context.provenance)]
    });
  }

  if (context.appliesTo) {
    if (!targetsEqual(context.target, context.appliesTo)) {
      diagnostics.push({
        kind: "context_target_mismatch",
        contextKind: kind,
        name: context.name,
        declaredTarget: context.target,
        appliesToTarget: context.appliesTo,
        filePath: context.provenance.filePath,
        causedBy: [describeProvenance(context.provenance)]
      });
    }

    if (!targetExists(context.appliesTo, model)) {
      diagnostics.push({
        kind: "invalid_context_target",
        contextKind: kind,
        name: context.name,
        targetKind: context.appliesTo.kind,
        target: context.appliesTo.name,
        filePath: context.provenance.filePath,
        causedBy: [describeProvenance(context.provenance)]
      });
    }
  }

  return diagnostics;
}

function checkRequiredContext(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const target of shapeTraitBearers(model)) {
    for (const requirement of requirementsForTarget(model, target.kind, target.traits)) {
      if (hasRequiredContext(requirement, target.target, model)) {
        continue;
      }

      const traitProvenance = target.traits.get(requirement.trait) ?? target.fallback;
      const requirementProvenance =
        requirement.provenance ??
        provenance("standard prelude", `${requirement.trait} requires ${requirement.contextType}`);
      diagnostics.push({
        kind: "missing_required_context",
        targetKind: target.kind,
        target: target.target.name,
        requiredContext: formatContextRequirement(requirement.contextType, target.target),
        requiredBy: requirement.trait,
        filePath: traitProvenance.filePath,
        causedBy: [describeProvenance(traitProvenance), describeProvenance(requirementProvenance)]
      });
    }
  }

  return diagnostics;
}

type ShapeTraitBearer = {
  kind: TargetKind;
  target: ShapeTarget;
  traits: Map<string, Provenance>;
  fallback: Provenance;
};

/**
 * Every model declaration that can carry shape traits, paired with its trait
 * map. Functions store traits in `shapeTraits`, components in `classifiers`,
 * and resources in `traits`; required-context checking treats them uniformly.
 */
function shapeTraitBearers(model: Model): ShapeTraitBearer[] {
  const bearers: ShapeTraitBearer[] = [];
  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      bearers.push({
        kind: "fn",
        target: functionTarget(fn.component, fn.name),
        traits: fn.shapeTraits,
        fallback: fn.provenance
      });
    }
    bearers.push({
      kind: "component",
      target: { kind: "component", name: component.name },
      traits: component.classifiers,
      fallback: component.provenance
    });
  }
  for (const resource of model.resources.values()) {
    bearers.push({
      kind: "resource",
      target: { kind: "resource", name: resource.name },
      traits: resource.traits,
      fallback: resource.provenance
    });
  }
  return bearers;
}

function checkRequiredDescriptions(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      for (const requirement of requirementsForTarget(model, "fn", fn.shapeTraits).filter(
        (item) => item.requiresDescription
      )) {
        if (hasNonEmptyDescription(fn)) {
          continue;
        }

        const traitProvenance = fn.shapeTraits.get(requirement.trait) ?? fn.provenance;
        diagnostics.push({
          kind: "missing_required_description",
          targetKind: "fn",
          target: functionKey(fn.component, fn.name),
          requiredBy: requirement.trait,
          filePath: traitProvenance.filePath,
          causedBy: [
            describeProvenance(traitProvenance),
            describeProvenance(
              provenance("standard prelude", `${requirement.trait} requires description`)
            )
          ]
        });
      }

      if (fn.description?.required && fn.description.summary.trim().length === 0) {
        diagnostics.push({
          kind: "missing_required_description",
          targetKind: "fn",
          target: functionKey(fn.component, fn.name),
          requiredBy: "description required",
          filePath: fn.description.provenance.filePath,
          causedBy: [describeProvenance(fn.description.provenance)]
        });
      }
    }
  }

  return diagnostics;
}

function checkReevaluations(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const reevaluation of model.reevaluations.values()) {
    for (const reason of reevaluationValidationReasons(reevaluation, model)) {
      diagnostics.push({
        kind: "invalid_reevaluation",
        name: reevaluation.name,
        reason,
        filePath: reevaluation.provenance.filePath,
        causedBy: [describeProvenance(reevaluation.provenance)]
      });
    }
  }

  return diagnostics;
}

function checkGuardedChanges(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const guards = [
    ...guardedContexts("rationale", model.rationales.values()),
    ...guardedContexts("memory", model.memories.values())
  ];

  for (const guard of guards) {
    if (hasValidReevaluationForGuard(model, guard.kind, guard.info.name)) {
      continue;
    }

    const detectable = detectableProtectedProperties(guard.info);
    // Property-level only when every protected property is detectable; if a
    // guard protects something we cannot diff (a free-form label, or nothing),
    // fall back to coarse "any change to the target" matching.
    const triggers =
      detectable.length === guard.info.protects.length && detectable.length > 0
        ? detectable
            .map((property) => ({
              property,
              event: findPropertyEvent(model, guard.target, property)
            }))
            .filter(
              (match): match is { property: ProtectedProperty; event: ChangeEvent } =>
                match.event !== undefined
            )
        : findCoarseChange(model, guard.target);

    for (const trigger of triggers) {
      diagnostics.push(
        guardedShapeChanged(
          guard.kind,
          guard.info.name,
          guard.target,
          trigger.property
            ? { kind: "property", label: describeProtectedProperty(trigger.property) }
            : undefined,
          trigger.event.provenance,
          guard.guard.provenance
        )
      );
    }
  }

  diagnostics.push(...checkTransformGuards(model));
  return dedupeCoarseGuardedChanges(diagnostics);
}

/**
 * When a guard reports both a coarse "target changed" diagnostic and a more
 * specific property/transform one for the same guard and target (e.g. a context
 * with both `on_change require` and `forbid transform`), keep only the specific
 * ones so a single violation is reported once.
 */
function dedupeCoarseGuardedChanges(diagnostics: SemanticDiagnostic[]): SemanticDiagnostic[] {
  const specificKeys = new Set<string>();
  const key = (d: Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }>) =>
    `${d.guardKind}:${d.guard}:${d.targetKind}:${d.target}`;
  for (const diagnostic of diagnostics) {
    if (diagnostic.kind === "guarded_shape_changed" && diagnostic.changeKind) {
      specificKeys.add(key(diagnostic));
    }
  }
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.kind !== "guarded_shape_changed" ||
      diagnostic.changeKind !== undefined ||
      !specificKeys.has(key(diagnostic))
  );
}

/**
 * `guards forbid transform <label>` fires when a change declares that transform
 * intent on the guarded target and no reevaluation satisfies the guard.
 */
function checkTransformGuards(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const contexts: { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] = [
    ...[...model.rationales.values()].map((info) => ({ kind: "rationale" as const, info })),
    ...[...model.memories.values()].map((info) => ({ kind: "memory" as const, info }))
  ];

  for (const { kind, info } of contexts) {
    if (
      info.forbiddenTransforms.length === 0 ||
      hasValidReevaluationForGuard(model, kind, info.name)
    ) {
      continue;
    }
    const target = info.appliesTo ?? info.target;
    for (const guard of info.forbiddenTransforms) {
      const event = model.changeEvents.find(
        (candidate) =>
          candidate.kind === "transform_applied" &&
          candidate.label === guard.label &&
          targetsEqual(candidate.target, target)
      );
      if (event) {
        diagnostics.push(
          guardedShapeChanged(
            kind,
            info.name,
            target,
            { kind: "transform", label: guard.label },
            event.provenance,
            guard.provenance
          )
        );
      }
    }
  }

  return diagnostics;
}

function guardedShapeChanged(
  guardKind: ContextKind,
  guardName: string,
  target: ShapeTarget,
  change: { kind: "property" | "transform"; label: string } | undefined,
  eventProvenance: Provenance,
  guardProvenance: Provenance
): Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }> {
  return {
    kind: "guarded_shape_changed",
    guardKind,
    guard: guardName,
    targetKind: target.kind,
    target: target.name,
    changedProperty: change?.label,
    changeKind: change?.kind,
    missingReevaluation: `reevaluation satisfying ${guardKind} ${displaySymbol(guardName)}`,
    filePath: eventProvenance.filePath,
    causedBy: [describeProvenance(eventProvenance), describeProvenance(guardProvenance)]
  };
}

/**
 * The subset of a guard's `protects` clauses whose change we can actually
 * detect: a description, or a shape trait by name. Free-form labels (e.g.
 * `protects shape CheckOrder`) are not detectable and keep coarse matching.
 */
function detectableProtectedProperties(info: RationaleInfo | MemoryInfo): ProtectedProperty[] {
  // A description is a function-only property, so a `protects description` clause
  // is only detectable on a function target; on a component/resource it has no
  // corresponding change event and must fall back to coarse matching.
  const targetKind = (info.appliesTo ?? info.target).kind;
  return info.protects.filter(
    (property) =>
      (property.kind === "description" && targetKind === "fn") ||
      (property.kind === "shape" && KNOWN_SHAPE_TRAITS.has(property.value))
  );
}

function findPropertyEvent(
  model: Model,
  target: ShapeTarget,
  property: ProtectedProperty
): ChangeEvent | undefined {
  return model.changeEvents.find((event) => {
    if (!targetsEqual(event.target, target)) {
      return false;
    }
    if (property.kind === "description") {
      return event.kind === "description_removed";
    }
    return event.kind === "shape_trait_removed" && event.trait === property.value;
  });
}

function findCoarseChange(
  model: Model,
  target: ShapeTarget
): { property: undefined; event: ChangeEvent }[] {
  const event = model.changeEvents.find(
    (candidate) => candidate.kind === "target_changed" && targetsEqual(candidate.target, target)
  );
  return event ? [{ property: undefined, event }] : [];
}

function describeProtectedProperty(property: ProtectedProperty): string {
  return property.kind === "description" ? "description" : `shape trait ${property.value}`;
}

/**
 * Reports design memory whose `review_by` date is strictly before `asOf`.
 * Only ISO `YYYY-MM-DD` `review_by` values are enforced; non-ISO and missing
 * values are left untouched so freshness never breaks a model on a typo's say-so.
 */
function checkFreshness(model: Model, asOf: string): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const contexts: { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] = [
    ...[...model.rationales.values()].map((info) => ({ kind: "rationale" as const, info })),
    ...[...model.memories.values()].map((info) => ({ kind: "memory" as const, info }))
  ];

  for (const { kind, info } of contexts) {
    if (!info.reviewBy || !isIsoDate(info.reviewBy) || info.reviewBy >= asOf) {
      continue;
    }

    const target = info.appliesTo ?? info.target;
    diagnostics.push({
      kind: "stale_memory",
      guardKind: kind,
      guard: info.name,
      targetKind: target.kind,
      target: target.name,
      reviewBy: info.reviewBy,
      asOf,
      filePath: info.provenance.filePath,
      causedBy: [describeProvenance(info.provenance)]
    });
  }

  return diagnostics;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function checkFunctions(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      if (fn.unsafe) {
        const missing = missingUnsafeRequirements(fn);
        if (missing.length > 0) {
          diagnostics.push({
            kind: "unsafe_effects",
            component: component.name,
            functionName: fn.name,
            missing,
            filePath: fn.provenance.filePath,
            causedBy: [describeProvenance(fn.provenance)]
          });
        }
      }

      if (fn.effects.kind === "unknown") {
        if (shouldIgnoreUnknownEffectsDiagnostic(fn)) {
          continue;
        }
        diagnostics.push({
          kind: "unknown_effects",
          component: component.name,
          functionName: fn.name,
          filePath: fn.provenance.filePath,
          causedBy: [describeProvenance(fn.provenance)]
        });
        continue;
      }

      for (const entry of fn.effects.entries) {
        const target = entry.term.target;
        if (!target) {
          continue;
        }

        const resource = model.resources.get(target);
        if (resource) {
          const finalForbidden = findFinalForbidden(entry.term.name, resource, model);
          if (finalForbidden) {
            diagnostics.push({
              kind: "final_forbidden_effect",
              component: component.name,
              functionName: fn.name,
              effect: entry.term.name,
              target,
              trait: finalForbidden.trait,
              evidence: entry.evidence ? formatSourceRefInfo(entry.evidence) : undefined,
              filePath: entry.provenance.filePath,
              causedBy: [
                describeProvenance(entry.provenance),
                describeProvenance(resource.traits.get(finalForbidden.trait)),
                describeProvenance(finalForbidden.provenance)
              ]
            });
            continue;
          }
        }

        if (!component.grants.has(termKey(entry.term))) {
          diagnostics.push({
            kind: "missing_grant",
            component: component.name,
            functionName: fn.name,
            effect: entry.term.name,
            target,
            filePath: entry.provenance.filePath,
            causedBy: [
              describeProvenance(entry.provenance),
              describeProvenance(component.provenance)
            ]
          });
        }
      }
    }
  }

  return diagnostics;
}

function checkProvidesRules(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    for (const forbid of rule.forbidProvides) {
      for (const hyperedge of model.hypergraph.edges.values()) {
        if (hyperedge.kind !== "provides") {
          continue;
        }
        const provider = providesProvider(hyperedge);
        const target = providesTarget(hyperedge);
        if (!provider || !target) {
          continue;
        }
        if (target !== forbid.target) {
          continue;
        }
        if (provider === forbid.except) {
          continue;
        }
        diagnostics.push({
          kind: "forbidden_provides",
          rule: rule.name,
          provider,
          target,
          hyperedge: hyperedge.name,
          allowedComponent: forbid.except,
          filePath: hyperedge.provenance.filePath,
          causedBy: [
            describeProvenance(hyperedge.provenance),
            describeProvenance(forbid.provenance)
          ]
        });
      }
    }
  }

  return diagnostics;
}

/**
 * `provides` hyperedges connect `provider -> target` (binary, directed).
 */
function providesProvider(hyperedge: HyperedgeInfo): string | undefined {
  return hyperedge.members[0]?.endpoint;
}

function providesTarget(hyperedge: HyperedgeInfo): string | undefined {
  return hyperedge.members[1]?.endpoint;
}

function checkHypercycles(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const seenCycles = new Set<string>();

  for (const rule of model.rules) {
    for (const forbid of rule.forbidHypercycles) {
      const cycle = findHypercycle(model, forbid.kinds);
      if (!cycle) {
        continue;
      }

      const signature = cycle.hyperedges
        .map((edge) => edge.name)
        .sort()
        .join(",");
      const dedupeKey = `${rule.name}:${signature}`;
      if (seenCycles.has(dedupeKey)) {
        continue;
      }
      seenCycles.add(dedupeKey);

      diagnostics.push({
        kind: "forbidden_hypercycle",
        rule: rule.name,
        vertices: cycle.vertices,
        hyperedges: cycle.hyperedges.map((edge) => ({ name: edge.name, kind: edge.kind })),
        filePath: forbid.provenance.filePath,
        causedBy: [
          describeProvenance(forbid.provenance),
          ...cycle.provenance.map(describeProvenance)
        ]
      });
    }
  }

  return diagnostics;
}

type HypercycleWitness = {
  vertices: string[];
  hyperedges: HyperedgeInfo[];
  provenance: Provenance[];
};

type HyperedgeStep = {
  hyperedge: HyperedgeInfo;
  from: string;
  to: string;
};

/**
 * Find a cycle in the directed hypergraph.
 *
 * Each relation kind contributes directed steps to the traversal according
 * to its `cycleTraversal` rule in the prelude kind registry:
 *
 * - `directed_pairs`: a 2-vertex hyperedge contributes one step `members[0] -> members[1]`.
 * - `ordered_path`: an N-vertex hyperedge contributes consecutive steps
 *   `members[i] -> members[i+1]` along the declared order.
 * - `none`: the hyperedge does not participate in cycle detection.
 *
 * `kindsFilter`, if non-empty, restricts the search to the subgraph induced
 * by hyperedges whose `kind` matches one of the listed kinds. Steps from
 * other kinds are excluded from adjacency entirely, so cycles that require
 * traversing a non-allowed kind to close are not reported.
 */
function findHypercycle(model: Model, kindsFilter: string[]): HypercycleWitness | undefined {
  const allSteps = buildHyperedgeSteps(model);
  const allowedKinds = kindsFilter.length === 0 ? undefined : new Set(kindsFilter);
  const steps = allowedKinds
    ? allSteps.filter((step) => allowedKinds.has(step.hyperedge.kind))
    : allSteps;
  if (steps.length === 0) {
    return undefined;
  }

  const adjacency = new Map<string, HyperedgeStep[]>();
  const vertices = new Set<string>();
  for (const step of steps) {
    vertices.add(step.from);
    vertices.add(step.to);
    const existing = adjacency.get(step.from) ?? [];
    existing.push(step);
    adjacency.set(step.from, existing);
  }

  for (const start of [...vertices].sort()) {
    const visited = new Set<string>();
    const witness = dfsHypercycle(start, start, adjacency, [], visited);
    if (witness) {
      return witness;
    }
  }

  return undefined;
}

function dfsHypercycle(
  start: string,
  current: string,
  adjacency: Map<string, HyperedgeStep[]>,
  path: HyperedgeStep[],
  visited: Set<string>
): HypercycleWitness | undefined {
  if (visited.has(current)) {
    return undefined;
  }
  visited.add(current);

  const nextSteps = adjacency.get(current) ?? [];
  for (const step of nextSteps) {
    path.push(step);
    if (step.to === start) {
      return witnessFromPath(start, path);
    }

    const witness = dfsHypercycle(start, step.to, adjacency, path, visited);
    if (witness) {
      return witness;
    }
    path.pop();
  }

  visited.delete(current);
  return undefined;
}

function witnessFromPath(start: string, path: HyperedgeStep[]): HypercycleWitness {
  const vertices = [start, ...path.map((step) => step.to)];
  const seenEdges = new Set<string>();
  const hyperedges: HyperedgeInfo[] = [];
  for (const step of path) {
    if (!seenEdges.has(step.hyperedge.name)) {
      seenEdges.add(step.hyperedge.name);
      hyperedges.push(step.hyperedge);
    }
  }
  return {
    vertices,
    hyperedges,
    provenance: hyperedges.map((edge) => edge.provenance)
  };
}

function buildHyperedgeSteps(model: Model): HyperedgeStep[] {
  const steps: HyperedgeStep[] = [];
  for (const edge of model.hypergraph.edges.values()) {
    const rule = PRELUDE_RELATION_KINDS.get(edge.kind);
    const traversal = rule?.cycleTraversal ?? "none";
    if (traversal === "none") {
      continue;
    }

    if (traversal === "directed_pairs") {
      if (edge.members.length < 2) {
        continue;
      }
      steps.push({
        hyperedge: edge,
        from: edge.members[0]!.endpoint,
        to: edge.members[1]!.endpoint
      });
    } else if (traversal === "ordered_path") {
      for (let index = 0; index < edge.members.length - 1; index += 1) {
        steps.push({
          hyperedge: edge,
          from: edge.members[index]!.endpoint,
          to: edge.members[index + 1]!.endpoint
        });
      }
    }
  }
  return steps;
}

function checkCoverage(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles);
  const noShapeChangeAttestations = new Set(["no_shape_change"]);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const implementation of model.implementations) {
    if (implementation.onChangeRequirement !== "shape_update") {
      continue;
    }

    for (const changedFile of changed.files) {
      if (changedFile.endsWith(".shape")) {
        continue;
      }

      const governingPath = implementation.paths.find((entry) =>
        globMatches(entry.glob, changedFile)
      );
      if (!governingPath) {
        continue;
      }

      if (currentShapeUpdateExists(model, changedFile, changed.set)) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, noShapeChangeAttestations)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_shape_update",
        changedFile,
        implementation: implementation.name,
        glob: governingPath.glob,
        filePath: implementation.provenance.filePath,
        causedBy: [
          describeProvenance(implementation.provenance),
          describeProvenance(governingPath.provenance)
        ]
      });
    }
  }

  return diagnostics;
}

function changedFileContext(changedFiles: string[]): ChangedFileContext {
  const files = changedFiles
    .map((file) => normalizeRepoPath(file))
    .filter((file) => file.length > 0);
  return {
    files,
    set: new Set(files)
  };
}

function currentShapeUpdateExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>
): boolean {
  return (
    model.shapeUpdatePaths
      .get(changedFile)
      ?.some((provenance) => provenanceFileChanged(provenance, changedSet)) ?? false
  );
}

function currentAttestationExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>
): boolean {
  return model.attestations.some((attestation) =>
    isCurrentAttestation(attestation, changedFile, changedSet, allowedKinds)
  );
}

function isCurrentAttestation(
  attestation: AttestationInfo,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>
): boolean {
  return (
    allowedKinds.has(attestation.kind) &&
    attestation.path === changedFile &&
    attestation.reason.trim().length > 0 &&
    provenanceFileChanged(attestation.provenance, changedSet)
  );
}

function provenanceFileChanged(provenance: Provenance, changedSet: Set<string>): boolean {
  return (
    provenance.filePath !== undefined && changedSet.has(normalizeRepoPath(provenance.filePath))
  );
}

function checkBindings(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const binding of model.bindings.values()) {
    const requiredChanged = changed.files.some((file) =>
      binding.requireChanged.some((entry) => globMatches(entry.glob, file))
    );
    if (requiredChanged) {
      continue;
    }

    const allowedKinds = new Set(binding.allowAttestations.map((item) => item.kind));
    for (const changedFile of changed.files) {
      const trigger = binding.whenChanged.find((entry) => globMatches(entry.glob, changedFile));
      if (!trigger) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, allowedKinds)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_bound_docs_change",
        binding: binding.name,
        changedFile,
        requiredPaths: binding.requireChanged.map((entry) => entry.glob).sort(),
        attestationKinds: [...allowedKinds].sort(),
        filePath: binding.provenance.filePath,
        causedBy: [describeProvenance(binding.provenance), describeProvenance(trigger.provenance)]
      });
    }
  }

  return diagnostics;
}

function requirementsForTarget(
  model: Model,
  targetKind: TargetKind,
  traits: ReadonlyMap<string, Provenance>
): ContextRequirementRule[] {
  const matched: ContextRequirementRule[] = [];
  const seen = new Set<string>();
  for (const rule of [...PRELUDE_CONTEXT_REQUIREMENTS, ...model.userContextRequirements]) {
    if (rule.targetKind !== targetKind || !traits.has(rule.trait)) {
      continue;
    }
    const key = `${rule.trait}:${rule.targetKind}:${rule.contextType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    matched.push(rule);
  }
  return matched;
}

function hasRequiredContext(
  requirement: PreludeContextRequirement,
  target: ShapeTarget,
  model: Model
): boolean {
  if (requirement.satisfiedBy.includes("rationale")) {
    const rationale = [...model.rationales.values()].find((item) =>
      contextSatisfiesRequirement(item, requirement.contextType, target)
    );
    if (rationale) {
      return true;
    }
  }

  if (requirement.satisfiedBy.includes("memory")) {
    return [...model.memories.values()].some((item) =>
      contextSatisfiesRequirement(item, requirement.contextType, target)
    );
  }

  return false;
}

function contextSatisfiesRequirement(
  context: RationaleInfo | MemoryInfo,
  contextType: string,
  target: ShapeTarget
): boolean {
  const effectiveTarget = context.appliesTo ?? context.target;
  return (
    context.contextType === contextType &&
    targetsEqual(effectiveTarget, target) &&
    targetsEqual(context.target, effectiveTarget)
  );
}

function hasNonEmptyDescription(fn: FunctionInfo): boolean {
  return fn.description !== undefined && fn.description.summary.trim().length > 0;
}

function targetExists(target: ShapeTarget, model: Model): boolean {
  if (target.kind === "fn") {
    const [component, functionName] = splitFunctionTarget(target.name);
    if (!component || !functionName) {
      return false;
    }

    return model.components.get(component)?.functions.has(functionName) === true;
  }

  if (target.kind === "component") {
    return model.components.has(target.name);
  }
  if (target.kind === "resource") {
    return model.resources.has(target.name);
  }
  if (target.kind === "implementation") {
    return model.implementations.some((implementation) => implementation.name === target.name);
  }
  if (target.kind === "rule") {
    return model.rules.some((rule) => rule.name === target.name);
  }
  if (target.kind === "relation") {
    return model.hypergraph.edges.has(target.name);
  }
  return false;
}

function splitFunctionTarget(target: string): [string | undefined, string | undefined] {
  const separator = target.lastIndexOf(".");
  if (separator <= 0 || separator === target.length - 1) {
    return [undefined, undefined];
  }
  return [target.slice(0, separator), target.slice(separator + 1)];
}

function targetsEqual(left: ShapeTarget, right: ShapeTarget): boolean {
  return left.kind === right.kind && left.name === right.name;
}

function formatTarget(target: ShapeTarget): string {
  return `${target.kind} ${displaySymbol(target.name)}`;
}

function formatContextRequirement(contextType: string, target: ShapeTarget): string {
  return `${contextType}<${formatTarget(target)}>`;
}

function reevaluationValidationReasons(reevaluation: ReevaluationInfo, model: Model): string[] {
  const reasons: string[] = [];
  if (!reevaluation.satisfiesKind || !reevaluation.satisfiesName) {
    reasons.push("missing satisfies");
  } else if (!contextObjectExists(reevaluation.satisfiesKind, reevaluation.satisfiesName, model)) {
    reasons.push(`unknown satisfied ${reevaluation.satisfiesKind}`);
  }

  if (!reevaluation.outcome) {
    reasons.push("missing outcome");
  }
  if (!reevaluation.summary || reevaluation.summary.trim().length === 0) {
    reasons.push("missing summary");
  }
  if (reevaluation.evidence.length === 0) {
    reasons.push("missing evidence");
  }
  if (!reevaluation.reviewer) {
    reasons.push("missing reviewer");
  }
  if (!reevaluation.decidedOn) {
    reasons.push("missing decided_on");
  }
  if (approverRequiredBy(reevaluation, model) && !reevaluation.approver) {
    reasons.push("missing approver required by policy");
  }
  if (model.roles.size > 0) {
    if (reevaluation.reviewer && !model.roles.has(reevaluation.reviewer)) {
      reasons.push(`unknown reviewer role ${reevaluation.reviewer}`);
    }
    if (reevaluation.approver && !model.roles.has(reevaluation.approver)) {
      reasons.push(`unknown approver role ${reevaluation.approver}`);
    }
  }

  return reasons;
}

/**
 * True when a project policy requires an approver and the reevaluation
 * satisfies a memory marked `sensitive`. Without such a policy, approver stays
 * optional, preserving the default reviewer-only path.
 */
function approverRequiredBy(reevaluation: ReevaluationInfo, model: Model): boolean {
  if (![...model.policies.values()].some((policy) => policy.requiresApprover)) {
    return false;
  }
  if (reevaluation.satisfiesKind !== "memory" || !reevaluation.satisfiesName) {
    return false;
  }
  return model.memories.get(reevaluation.satisfiesName)?.sensitive === true;
}

function contextObjectExists(kind: ContextKind, name: string, model: Model): boolean {
  return kind === "memory" ? model.memories.has(name) : model.rationales.has(name);
}

function guardedContexts(
  kind: ContextKind,
  contexts: Iterable<RationaleInfo | MemoryInfo>
): {
  kind: ContextKind;
  info: RationaleInfo | MemoryInfo;
  target: ShapeTarget;
  guard: GuardInfo;
}[] {
  const guarded: {
    kind: ContextKind;
    info: RationaleInfo | MemoryInfo;
    target: ShapeTarget;
    guard: GuardInfo;
  }[] = [];
  for (const info of contexts) {
    for (const guard of info.guards) {
      if (requiresReevaluation(guard)) {
        guarded.push({
          kind,
          info,
          target: info.appliesTo ?? info.target,
          guard
        });
      }
    }
  }
  return guarded;
}

function requiresReevaluation(guard: GuardInfo): boolean {
  const normalized = guard.requirement.replace(/\s+/g, "").toLowerCase();
  return normalized === "reevaluation" || normalized === "reevaluation<self>";
}

function hasValidReevaluationForGuard(model: Model, kind: ContextKind, name: string): boolean {
  return [...model.reevaluations.values()].some(
    (reevaluation) =>
      reevaluation.satisfiesKind === kind &&
      reevaluation.satisfiesName === name &&
      reevaluationValidationReasons(reevaluation, model).length === 0
  );
}

function matchingContextsForTarget(
  target: ShapeTarget,
  model: Model
): { kind: ContextKind; name: string }[] {
  const contexts: { kind: ContextKind; name: string }[] = [];
  for (const rationale of model.rationales.values()) {
    if (targetsEqual(rationale.appliesTo ?? rationale.target, target)) {
      contexts.push({ kind: "rationale", name: rationale.name });
    }
  }
  for (const memory of model.memories.values()) {
    if (targetsEqual(memory.appliesTo ?? memory.target, target)) {
      contexts.push({ kind: "memory", name: memory.name });
    }
  }
  return contexts.sort((left, right) =>
    `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`)
  );
}

function guardsForTarget(
  target: ShapeTarget,
  model: Model
): { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] {
  const guards: { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] = [];
  for (const rationale of model.rationales.values()) {
    if (
      targetsEqual(rationale.appliesTo ?? rationale.target, target) &&
      rationale.guards.some(requiresReevaluation)
    ) {
      guards.push({ kind: "rationale", info: rationale });
    }
  }
  for (const memory of model.memories.values()) {
    if (
      targetsEqual(memory.appliesTo ?? memory.target, target) &&
      memory.guards.some(requiresReevaluation)
    ) {
      guards.push({ kind: "memory", info: memory });
    }
  }
  return guards.sort((left, right) =>
    `${left.kind}:${left.info.name}`.localeCompare(`${right.kind}:${right.info.name}`)
  );
}

function formatRelationExplanation(relation: HyperedgeInfo, model: Model): string {
  const lines = [
    displaySymbol(relation.name),
    "  kind: relation",
    `  relation kind: ${relation.kind}`,
    `  ordered: ${relation.ordered ? "true" : "false"}`,
    "  connects:"
  ];
  for (const member of relation.members) {
    const role = member.role ? ` as ${member.role}` : "";
    lines.push(`    ${member.index}: ${displaySymbol(member.endpoint)}${role}`);
  }
  if (relation.summary) {
    lines.push("", `  summary: ${JSON.stringify(relation.summary)}`);
  }
  if (relation.fingerprintExpectations.length > 0) {
    lines.push("", "  fingerprint expectations:");
    lines.push(
      ...relation.fingerprintExpectations
        .sort((left, right) =>
          `${left.endpoint}:${left.provider}`.localeCompare(`${right.endpoint}:${right.provider}`)
        )
        .map(
          (expectation) =>
            `    ${displaySymbol(expectation.endpoint)} ${expectation.provider}(${JSON.stringify(expectation.value)})`
        )
    );
  }
  appendShapeTraitContext({ kind: "relation", name: relation.name }, EMPTY_TRAIT_MAP, model, lines);
  return lines.join("\n");
}

const EMPTY_TRAIT_MAP: ReadonlyMap<string, Provenance> = new Map();

function appendIncidence(vertex: string, model: Model, lines: string[]): void {
  const incident = (model.hypergraph.incidence.get(vertex) ?? [])
    .map((name) => model.hypergraph.edges.get(name))
    .filter((edge): edge is HyperedgeInfo => edge !== undefined)
    .sort(compareHyperedges);
  if (incident.length === 0) {
    return;
  }
  lines.push("", "  relations:");
  for (const edge of incident) {
    lines.push(`    ${formatHyperedgeLine(edge, 2, model)}`);
  }
}

function formatRationaleExplanation(rationale: RationaleInfo): string {
  const lines = [
    rationale.name,
    "  kind: rationale",
    `  type: ${rationale.contextType}`,
    `  target: ${formatTarget(rationale.target)}`
  ];
  appendContextExplanationFields(lines, rationale);
  return lines.join("\n");
}

function formatMemoryExplanation(memory: MemoryInfo): string {
  const lines = [
    memory.name,
    "  kind: memory",
    `  type: ${memory.contextType}`,
    `  target: ${formatTarget(memory.target)}`
  ];
  if (memory.status) {
    lines.push(`  status: ${memory.status}`);
  }
  if (memory.confidence) {
    lines.push(`  confidence: ${memory.confidence}`);
  }
  appendContextExplanationFields(lines, memory);
  return lines.join("\n");
}

function appendContextExplanationFields(lines: string[], context: ContextObjectInfo): void {
  if (context.owner) {
    lines.push(`  owner: ${context.owner}`);
  }
  if (context.reviewBy) {
    lines.push(`  review_by: ${context.reviewBy}`);
  }
  if (context.protects.length > 0) {
    lines.push("  protects:");
    lines.push(...context.protects.map((item) => `    ${protectedPropertyText(item)}`));
  }
  if (context.guards.length > 0) {
    lines.push("  guards:");
    lines.push(...context.guards.map((guard) => `    on_change require ${guard.requirement}`));
  }
}

/** Renders a protected property for listings, omitting an empty value. */
function protectedPropertyText(property: ProtectedProperty): string {
  return property.value ? `${property.kind} ${property.value}` : property.kind;
}

function formatRationaleMemoryListEntry(rationale: RationaleInfo): string[] {
  const lines = [`rationale ${displaySymbol(rationale.name)}`, `type: ${rationale.contextType}`];
  appendContextListFields(lines, rationale);
  return lines;
}

function formatMemoryListEntry(memory: MemoryInfo): string[] {
  const lines = [`memory ${displaySymbol(memory.name)}`, `type: ${memory.contextType}`];
  if (memory.status) {
    lines.push(`status: ${memory.status}`);
  }
  if (memory.confidence) {
    lines.push(`confidence: ${memory.confidence}`);
  }
  appendContextListFields(lines, memory);
  return lines;
}

function appendContextListFields(lines: string[], context: ContextObjectInfo): void {
  if (context.protects.length > 0) {
    lines.push(`protects: ${context.protects.map(protectedPropertyText).join(", ")}`);
  }
  if (context.owner) {
    lines.push(`owner: ${context.owner}`);
  }
  if (context.reviewBy) {
    lines.push(`review_by: ${context.reviewBy}`);
  }
}

function isObligationDiagnostic(diagnostic: ShapeDiagnostic): diagnostic is Extract<
  SemanticDiagnostic,
  {
    kind:
      | "missing_required_context"
      | "missing_required_description"
      | "guarded_shape_changed"
      | "invalid_reevaluation"
      | "stale_memory";
  }
> {
  return (
    diagnostic.kind === "missing_required_context" ||
    diagnostic.kind === "missing_required_description" ||
    diagnostic.kind === "guarded_shape_changed" ||
    diagnostic.kind === "invalid_reevaluation" ||
    diagnostic.kind === "stale_memory"
  );
}

function deriveFinalForbidsForResource(
  resource: ResourceInfo,
  model: Model
): { effect: string; target: string; trait: string; provenance: Provenance }[] {
  const forbids: { effect: string; target: string; trait: string; provenance: Provenance }[] = [];

  for (const traitName of resource.traits.keys()) {
    const trait = model.traits.get(traitName);
    if (!trait) {
      continue;
    }

    for (const forbid of trait.finalForbids) {
      if (!forbid.final) {
        continue;
      }
      forbids.push({
        effect: forbid.effect,
        target: substituteTarget(forbid.target, resource.name, trait.typeParams),
        trait: traitName,
        provenance: forbid.provenance
      });
    }
  }

  for (const rule of model.rules) {
    const subject = rule.finalForbidSubject;
    if (!subject) {
      continue;
    }
    const whens = rule.whenHas.filter((when) => when.subject === subject);
    if (whens.length === 0 || !whens.every((when) => resource.traits.has(when.trait))) {
      continue;
    }
    const diagnosticTrait = whens[0]?.trait;
    if (!diagnosticTrait) {
      continue;
    }

    for (const forbid of rule.forbidEffects) {
      if (!forbid.final) {
        continue;
      }
      forbids.push({
        effect: forbid.effect,
        target: substituteTarget(forbid.target, resource.name, [subject]),
        trait: diagnosticTrait,
        provenance: forbid.provenance
      });
    }
  }

  return dedupeForbids(forbids);
}

function findFinalForbidden(
  effectName: string,
  resource: ResourceInfo,
  model: Model
): { trait: string; provenance: Provenance } | undefined {
  return deriveFinalForbidsForResource(resource, model).find(
    (forbid) => forbid.effect === effectName && forbid.target === resource.name
  );
}

function substituteTarget(
  target: string | undefined,
  resourceName: string,
  typeParams: string[]
): string {
  if (!target) {
    return resourceName;
  }
  return typeParams.includes(target) ? resourceName : target;
}

function dedupeForbids(
  forbids: { effect: string; target: string; trait: string; provenance: Provenance }[]
): { effect: string; target: string; trait: string; provenance: Provenance }[] {
  const seen = new Set<string>();
  return forbids.filter((forbid) => {
    const key = `${forbid.effect}<${forbid.target}>:${forbid.trait}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatHyperedgeLine(edge: HyperedgeInfo, _indent: number, model: Model): string {
  const separator = edge.ordered ? " -> " : ", ";
  const labelled = edge.members.map((member) => formatHyperedgeMember(member, model));
  const set = edge.ordered ? labelled.join(separator) : `{ ${labelled.join(separator)} }`;
  const summary = edge.summary ? `  // ${edge.summary}` : "";
  return `${edge.kind} ${displaySymbol(edge.name)}: ${set}${summary}`;
}

function formatHyperedgeMember(member: HyperedgeMember, model: Model): string {
  const role = member.role ? ` as ${member.role}` : "";
  const kind = vertexKindLabel(member.endpoint, model);
  return `${displaySymbol(member.endpoint)}${kind}${role}`;
}

function vertexKindLabel(name: string, model: Model): string {
  if (model.components.has(name)) {
    return " (component)";
  }
  if (model.resources.has(name)) {
    return " (resource)";
  }
  return "";
}

function formatVertexHeader(name: string, model: Model): string {
  const kind = vertexKindLabel(name, model).trim();
  return kind ? `${displaySymbol(name)} ${kind}` : displaySymbol(name);
}

function missingUnsafeRequirements(fn: FunctionInfo): string[] {
  const missing: string[] = [];
  if (!fn.reason) {
    missing.push("reason");
  }
  if (!fn.expires) {
    missing.push("expires");
  }
  if (fn.requires.length === 0) {
    missing.push("required capability");
  }
  return missing;
}

function formatDiagnostic(diagnostic: ShapeDiagnostic): string {
  switch (diagnostic.kind) {
    case "parse":
      return formatParseDiagnostic(diagnostic);
    case "final_forbidden_effect":
      return formatFinalForbiddenDiagnostic(diagnostic);
    case "missing_grant":
      return formatMissingGrantDiagnostic(diagnostic);
    case "unknown_effects":
      return formatUnknownEffectsDiagnostic(diagnostic);
    case "unknown_name":
      return formatUnknownNameDiagnostic(diagnostic);
    case "ambiguous_name":
      return formatAmbiguousNameDiagnostic(diagnostic);
    case "invalid_rule":
      return formatInvalidRuleDiagnostic(diagnostic);
    case "duplicate_declaration":
      return formatDuplicateDeclarationDiagnostic(diagnostic);
    case "duplicate_fingerprint":
      return formatDuplicateFingerprintDiagnostic(diagnostic);
    case "missing_shape_update":
      return formatMissingShapeUpdateDiagnostic(diagnostic);
    case "missing_bound_docs_change":
      return formatMissingBoundDocsChangeDiagnostic(diagnostic);
    case "forbidden_hypercycle":
      return formatForbiddenHypercycleDiagnostic(diagnostic);
    case "forbidden_provides":
      return formatForbiddenProvidesDiagnostic(diagnostic);
    case "fingerprint_mismatch":
      return formatFingerprintMismatchDiagnostic(diagnostic);
    case "candidate_pin_fingerprint_mismatch":
      return formatCandidatePinFingerprintMismatchDiagnostic(diagnostic);
    case "invalid_candidate_effect":
      return formatInvalidCandidateEffectDiagnostic(diagnostic);
    case "unsafe_effects":
      return formatUnsafeEffectsDiagnostic(diagnostic);
    case "missing_required_context":
      return formatMissingRequiredContextDiagnostic(diagnostic);
    case "invalid_context_target":
      return formatInvalidContextTargetDiagnostic(diagnostic);
    case "context_target_mismatch":
      return formatContextTargetMismatchDiagnostic(diagnostic);
    case "missing_required_description":
      return formatMissingRequiredDescriptionDiagnostic(diagnostic);
    case "guarded_shape_changed":
      return formatGuardedShapeChangedDiagnostic(diagnostic);
    case "invalid_reevaluation":
      return formatInvalidReevaluationDiagnostic(diagnostic);
    case "stale_memory":
      return formatStaleMemoryDiagnostic(diagnostic);
    case "invalid_relation":
      return formatInvalidRelationDiagnostic(diagnostic);
  }
}

function formatParseDiagnostic(diagnostic: ParseDiagnostic): string {
  const location = formatLocation(diagnostic.filePath, diagnostic.line, diagnostic.column);
  return `error: parse error\n\n${location} ${diagnostic.message}`;
}

function formatFinalForbiddenDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "final_forbidden_effect" }>
): string {
  const evidence = diagnostic.evidence ? `\nevidence: ${diagnostic.evidence}` : "";
  return [
    "error: forbidden effect",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${displaySymbol(diagnostic.target)} has trait ${displaySymbol(diagnostic.trait)}.`,
    `${displaySymbol(diagnostic.trait)} forbids final ${formatTerm(diagnostic.effect, diagnostic.target)}.${evidence}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingGrantDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_grant" }>
): string {
  return [
    "error: missing grant",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${displaySymbol(diagnostic.component)} does not grant ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnknownEffectsDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_effects" }>
): string {
  return [
    "error: unknown effects",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} declares effects unknown.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnknownNameDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_name" }>
): string {
  return [
    `error: unknown ${diagnostic.nameKind}`,
    "",
    `${diagnostic.nameKind} ${displaySymbol(diagnostic.name)} is referenced but not declared.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatAmbiguousNameDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "ambiguous_name" }>
): string {
  return [
    `error: ambiguous ${diagnostic.nameKind}`,
    "",
    `${diagnostic.nameKind} ${diagnostic.name} matches more than one imported declaration.`,
    "Use a module-qualified reference.",
    `matches: ${diagnostic.matches.join(", ")}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidRuleDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_rule" }>
): string {
  return [
    "error: invalid rule",
    "",
    `rule ${displaySymbol(diagnostic.rule)} is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatDuplicateDeclarationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "duplicate_declaration" }>
): string {
  return [
    `error: duplicate ${diagnostic.declarationKind}`,
    "",
    `${diagnostic.declarationKind} ${displaySymbol(diagnostic.name)} is declared more than once.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatDuplicateFingerprintDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "duplicate_fingerprint" }>
): string {
  return [
    "error: duplicate fingerprint",
    "",
    `resource ${displaySymbol(diagnostic.resource)} declares fingerprint provider ${diagnostic.provider} more than once.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingShapeUpdateDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_shape_update" }>
): string {
  return [
    "error: governed source changed without current Shape update",
    "",
    `Changed file: ${diagnostic.changedFile}`,
    `Governed by: ${diagnostic.implementation}`,
    `Matched path: ${diagnostic.glob}`,
    "Required: update a current .shape file with matching source/evidence, or add a no_shape_change attestation.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingBoundDocsChangeDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_bound_docs_change" }>
): string {
  const attest =
    diagnostic.attestationKinds.length > 0
      ? `, or add ${diagnostic.attestationKinds.map((kind) => `attest ${kind}`).join(" or ")}`
      : "";
  return [
    "error: bound docs change missing",
    "",
    `binding ${diagnostic.binding} was triggered by ${diagnostic.changedFile}.`,
    `Required: change one of ${diagnostic.requiredPaths.join(", ")}${attest}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatForbiddenHypercycleDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_hypercycle" }>
): string {
  return [
    "error: forbidden hypercycle",
    "",
    `rule ${displaySymbol(diagnostic.rule)} rejects this hypercycle:`,
    ...diagnostic.hyperedges.map((edge) => `  ${edge.kind} ${displaySymbol(edge.name)}`),
    `witness: ${diagnostic.vertices.map(displaySymbol).join(" -> ")}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatForbiddenProvidesDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_provides" }>
): string {
  const allowed = diagnostic.allowedComponent
    ? ` except ${displaySymbol(diagnostic.allowedComponent)}`
    : "";
  return [
    "error: forbidden provides",
    "",
    `${displaySymbol(diagnostic.provider)} provides ${displaySymbol(diagnostic.target)} via relation ${displaySymbol(diagnostic.hyperedge)}.`,
    `rule ${displaySymbol(diagnostic.rule)} forbids provides ${displaySymbol(diagnostic.target)}${allowed}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatFingerprintMismatchDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "fingerprint_mismatch" }>
): string {
  const actual = diagnostic.actual ?? "missing";
  return [
    "error: stale fingerprint expectation",
    "",
    `relation ${displaySymbol(diagnostic.relation)} expects ${displaySymbol(diagnostic.endpoint)} fingerprint ${diagnostic.provider}.`,
    `expected: ${diagnostic.expected}`,
    `actual: ${actual}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatCandidatePinFingerprintMismatchDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "candidate_pin_fingerprint_mismatch" }>
): string {
  const actual = diagnostic.actual ?? "missing";
  return [
    "error: stale candidate effect pin",
    "",
    `candidate effect ${displaySymbol(diagnostic.candidateEffect)} pins ${displaySymbol(diagnostic.anchor)} fingerprint ${diagnostic.provider}.`,
    `expected: ${diagnostic.expected}`,
    `actual: ${actual}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidCandidateEffectDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_candidate_effect" }>
): string {
  return [
    "error: invalid candidate effect",
    "",
    `candidate effect ${diagnostic.name}: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnsafeEffectsDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unsafe_effects" }>
): string {
  return [
    "error: unsafe effects missing policy metadata",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} declares unsafe effects.`,
    `Missing: ${diagnostic.missing.join(", ")}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingRequiredContextDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_required_context" }>
): string {
  return [
    "error: missing required context",
    "",
    `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} has shape ${displaySymbol(diagnostic.requiredBy)}.`,
    `${displaySymbol(diagnostic.requiredBy)} requires ${diagnostic.requiredContext}.`,
    "",
    "No matching rationale or memory found.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidContextTargetDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_context_target" }>
): string {
  return [
    "error: invalid context target",
    "",
    `${diagnostic.contextKind} ${displaySymbol(diagnostic.name)} applies to ${diagnostic.targetKind} ${displaySymbol(diagnostic.target)},`,
    "but that target is not declared.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatContextTargetMismatchDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "context_target_mismatch" }>
): string {
  return [
    "error: context target mismatch",
    "",
    `${diagnostic.contextKind} ${diagnostic.name} declares ${formatTarget(diagnostic.declaredTarget)},`,
    `but applies_to references ${formatTarget(diagnostic.appliesToTarget)}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingRequiredDescriptionDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_required_description" }>
): string {
  return [
    "error: missing required description",
    "",
    `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} has shape ${displaySymbol(diagnostic.requiredBy)}.`,
    `${displaySymbol(diagnostic.requiredBy)} requires a description.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function guardedShapeChangeSummary(
  diagnostic: Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }>
): string {
  if (diagnostic.changeKind === "transform" && diagnostic.changedProperty) {
    return `This change applies the ${diagnostic.changedProperty} transform to the guarded target.`;
  }
  if (diagnostic.changeKind === "property" && diagnostic.changedProperty) {
    return `This change removes ${diagnostic.changedProperty} from the guarded target.`;
  }
  return "This change modifies the guarded target.";
}

function formatGuardedShapeChangedDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }>
): string {
  return [
    "error: guarded shape changed",
    "",
    `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} is protected by ${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)}.`,
    guardedShapeChangeSummary(diagnostic),
    "",
    "Required:",
    `  add ${diagnostic.missingReevaluation}`,
    "  or preserve the protected shape.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidReevaluationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_reevaluation" }>
): string {
  return [
    "error: invalid reevaluation",
    "",
    `reevaluation ${diagnostic.name} is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatStaleMemoryDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "stale_memory" }>
): string {
  return [
    "error: stale design memory",
    "",
    `${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)} protects ${diagnostic.targetKind} ${displaySymbol(diagnostic.target)}.`,
    `Its review_by date ${diagnostic.reviewBy} is before ${diagnostic.asOf}.`,
    "",
    "Required:",
    "  review the design memory and update review_by, or replace it with a reevaluation.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidRelationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_relation" }>
): string {
  return [
    "error: invalid relation",
    "",
    `relation ${diagnostic.name} is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatCausedBy(causedBy: string[]): string {
  const lines = causedBy.filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }
  return ["", "caused by:", ...lines.map((line) => `  - ${line}`)].join("\n");
}

function formatLocation(filePath: string, line?: number, column?: number): string {
  if (line === undefined) {
    return `${filePath}:`;
  }
  if (column === undefined) {
    return `${filePath}:${line}:`;
  }
  return `${filePath}:${line}:${column}:`;
}

function formatSourceRefInfo(ref: SourceRefInfo): string {
  return `${ref.language}("${ref.path}")`;
}

function formatFingerprintInfo(fingerprint: FingerprintInfo): string {
  return `${fingerprint.provider}(${JSON.stringify(fingerprint.value)})`;
}

function formatTerm(effect: string, target: string): string {
  return target ? `${effect}<${displaySymbol(target)}>` : effect;
}

function termKey(term: TermInfo): string {
  return `${term.name}<${term.target ?? ""}>`;
}

function functionKey(component: string, name: string): string {
  return `${component}.${name}`;
}

function normalizeRepoPath(path: string): string {
  const normalized = normalizeShapePath(path);
  if (!isAbsolute(normalized)) {
    return normalized;
  }

  return normalizeShapePath(relative(process.cwd(), normalized));
}

function globMatches(glob: string, path: string): boolean {
  const normalizedGlob = normalizeShapePath(glob);
  const normalizedPath = normalizeShapePath(path);
  const regex = new RegExp(`^${globToRegex(normalizedGlob)}$`);
  return regex.test(normalizedPath);
}

function globToRegex(glob: string): string {
  let regex = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      regex += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += ".";
    } else if (char) {
      regex += escapeRegex(char);
    }
  }
  return regex;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function provenance(filePath: string | undefined, label: string): Provenance {
  return { filePath, label };
}

function describeProvenance(prov: Provenance | undefined): string {
  if (!prov) {
    return "";
  }
  const label = prov.label.replace(/\b[A-Za-z_][\w.]*::/g, "");
  return prov.filePath ? `${prov.filePath}: ${label}` : label;
}

function isPreludeTrait(trait: TraitInfo | undefined): boolean {
  return (
    trait !== undefined &&
    (trait.provenance.filePath === undefined || trait.provenance.filePath === "standard prelude")
  );
}

function preludeTraitInfo(trait: PreludeTraitDefinition): TraitInfo {
  return {
    name: trait.name,
    typeParams: [...trait.typeParams],
    finalForbids: trait.finalForbids.map((forbid) => {
      const target = forbid.target ? `<${forbid.target}>` : "";
      return {
        effect: forbid.effect,
        target: forbid.target,
        targetBinding:
          forbid.target === undefined
            ? "omitted"
            : trait.typeParams.includes(forbid.target)
              ? "generic"
              : "concrete",
        final: true,
        provenance: provenance(
          "standard prelude",
          `trait ${trait.name} forbids final ${forbid.effect}${target}`
        )
      };
    }),
    provenance: provenance("standard prelude", `trait ${trait.name}`)
  };
}
