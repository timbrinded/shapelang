import type {
  AddDeclarationChange,
  AddFunctionChange,
  AttestationDecl,
  ChangeDecl,
  ComponentDecl,
  DescriptionDecl,
  EffectEntry,
  EffectPattern,
  EffectsDecl,
  EffectTerm,
  FunctionSummary,
  ImplementationDecl,
  MemoryDecl,
  ModifyDeclarationChange,
  ModifyFunctionChange,
  RationaleDecl,
  ReevaluationDecl,
  RemoveDeclarationChange,
  ResourceDecl,
  RuleDecl,
  RuleForbidCycleDecl,
  RuleForbidEffectDecl,
  RuleForbidProvidesDecl,
  ShapeModule,
  SourceRef,
  TargetKind,
  TargetRef,
  TraitDecl,
  TraitForbidDecl
} from "./language/generated/ast.ts";
import {
  isAddDeclarationChange,
  isAddFunctionChange,
  isAppliesToDecl,
  isApproverDecl,
  isAttestationDecl,
  isChangeDecl,
  isCompleteEffects,
  isComponentDecl,
  isConfidenceDecl,
  isConformsToDecl,
  isDecidedOnDecl,
  isEvidenceLineDecl,
  isExpiresDecl,
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
  isProvidesDecl,
  isRationaleDecl,
  isReasonDecl,
  isReevaluationDecl,
  isRemoveDeclarationChange,
  isRemoveFunctionChange,
  isRequiresDecl,
  isResourceDecl,
  isReviewByDecl,
  isReviewerDecl,
  isRuleDecl,
  isRuleForbidCycleDecl,
  isRuleForbidEffectDecl,
  isRuleForbidProvidesDecl,
  isRuleWhenHasDecl,
  isSatisfiesDecl,
  isStatusDecl,
  isSummaryDecl,
  isTraitDecl,
  isTraitForbidDecl,
  isUnknownEffects,
  isWhyDecl
} from "./language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "./parser.ts";

const PRELUDE_TRAITS: TraitInfo[] = [
  {
    name: "AppendOnly",
    typeParams: ["T"],
    finalForbids: [
      {
        effect: "HardDelete",
        target: "T",
        final: true,
        provenance: provenance("standard prelude", "trait AppendOnly forbids final HardDelete<T>")
      },
      {
        effect: "Truncate",
        target: "T",
        final: true,
        provenance: provenance("standard prelude", "trait AppendOnly forbids final Truncate<T>")
      },
      {
        effect: "DropStorage",
        target: "T",
        final: true,
        provenance: provenance("standard prelude", "trait AppendOnly forbids final DropStorage<T>")
      }
    ],
    provenance: provenance("standard prelude", "trait AppendOnly")
  }
];

const KNOWN_PRELUDE_TRAITS = new Set([
  "AppendOnly",
  "Persistent",
  "Ephemeral",
  "PII",
  "Secret",
  "Public",
  "External",
  "Internal",
  "PreserveInline",
  "RequiresDescription",
  "ProtectedCheckOrder",
  "RefactorSensitive",
  "NonIdiomatic",
  "TestOnly"
]);

type ContextKind = "rationale" | "memory";

type ContextRequirementRule = {
  trait: string;
  targetKind: TargetKind;
  contextType: string;
  satisfiedBy: ContextKind[];
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
    trait: "RefactorSensitive",
    targetKind: "fn",
    contextType: "RefactorConstraint",
    satisfiedBy: ["memory"]
  },
  {
    trait: "NonIdiomatic",
    targetKind: "fn",
    contextType: "DesignRationale",
    satisfiedBy: ["rationale", "memory"]
  },
  {
    trait: "TestOnly",
    targetKind: "fn",
    contextType: "TestOnlyPurpose",
    satisfiedBy: ["rationale"]
  }
];

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
      nameKind: "resource" | "component" | "trait";
      name: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "duplicate_declaration";
      declarationKind: "resource" | "component" | "trait" | "rationale" | "memory" | "reevaluation";
      name: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "missing_shape_delta";
      changedFile: string;
      implementation: string;
      glob: string;
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "forbidden_dependency_cycle";
      rule: string;
      path: string[];
      relationKinds: string[];
      filePath?: string;
      causedBy: string[];
    }
  | {
      kind: "forbidden_provides";
      rule: string;
      component: string;
      target: string;
      allowedComponent?: string;
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
  includeFacts?: boolean;
};

export type Fact =
  | { kind: "resource"; name: string; provenance: Provenance }
  | { kind: "resource_trait"; resource: string; trait: string; provenance: Provenance }
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
  | { kind: "provides"; component: string; target: string; provenance: Provenance }
  | {
      kind: "requires";
      component: string;
      target: string;
      relation: string;
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
  | { kind: "shape_delta_for"; path: string; provenance: Provenance }
  | { kind: "attestation"; path: string; reason: string; provenance: Provenance }
  | { kind: "rule"; name: string; provenance: Provenance };

type CheckModuleInput = {
  module: ShapeModule;
  filePath?: string;
};

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
      kind: "function_modified";
      target: ShapeTarget;
      provenance: Provenance;
    }
  | {
      kind: "function_removed";
      target: ShapeTarget;
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
  provenance: Provenance;
};

type ResourceInfo = {
  name: string;
  traits: Map<string, Provenance>;
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
  final: boolean;
  provenance: Provenance;
};

type ComponentInfo = {
  name: string;
  grants: Map<string, Provenance>;
  owns: Map<string, Provenance>;
  provides: ProvidedInfo[];
  requires: RequiredInfo[];
  functions: Map<string, FunctionInfo>;
  provenance: Provenance;
};

type ProvidedInfo = {
  target: string;
  provenance: Provenance;
};

type RequiredInfo = {
  target: string;
  relation: string;
  provenance: Provenance;
};

type ImplementationInfo = {
  name: string;
  paths: { glob: string; provenance: Provenance }[];
  conformsTo?: string;
  onChangeRequirement?: string;
  provenance: Provenance;
};

type RuleInfo = {
  name: string;
  whenHas: { subject: string; trait: string }[];
  forbidEffects: FinalForbidPattern[];
  forbidProvides: {
    target: string;
    except?: string;
    provenance: Provenance;
  }[];
  forbidCycles: {
    relation: string;
    relationKinds: string[];
    provenance: Provenance;
  }[];
  provenance: Provenance;
};

type SourceRefInfo = {
  language: string;
  path: string;
};

type Model = {
  resources: Map<string, ResourceInfo>;
  traits: Map<string, TraitInfo>;
  components: Map<string, ComponentInfo>;
  implementations: ImplementationInfo[];
  rules: RuleInfo[];
  rationales: Map<string, RationaleInfo>;
  memories: Map<string, MemoryInfo>;
  reevaluations: Map<string, ReevaluationInfo>;
  attestations: { path: string; reason: string; provenance: Provenance }[];
  shapeDeltaPaths: Map<string, Provenance>;
  removedFunctions: Set<string>;
  changeEvents: ChangeEvent[];
  facts: Fact[];
  diagnostics: SemanticDiagnostic[];
};

type FunctionAst = FunctionSummary | AddFunctionChange | ModifyFunctionChange;

export function checkShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  options: CheckOptions = {}
): CheckResult {
  const model = lowerShapeModules(modules);
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
          filePath
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

export function listShapeObligations(modules: ShapeModule[] | CheckModuleInput[]): string {
  const result = checkShapeModules(modules);
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

  return `${lines.join("\n").trimEnd()}\n`;
}

export function explainShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string
): string {
  const model = lowerShapeModules(modules);
  const resource = model.resources.get(symbol);
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
    return `${lines.join("\n")}\n`;
  }

  const [componentName, functionName] = symbol.split(".");
  if (componentName && functionName) {
    const fn = model.components.get(componentName)?.functions.get(functionName);
    if (fn) {
      const lines = [`${componentName}.${functionName}`, "  kind: function"];
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
      const requirements = requirementsForFunction(fn);
      if (requirements.length > 0) {
        const target = functionTarget(componentName, functionName);
        lines.push("", "  required context:");
        lines.push(
          ...requirements.map(
            (requirement) => `    ${formatContextRequirement(requirement.contextType, target)}`
          )
        );
      }
      const satisfiedBy = matchingContextsForTarget(
        functionTarget(componentName, functionName),
        model
      );
      if (satisfiedBy.length > 0) {
        lines.push("", "  satisfied by:");
        lines.push(...satisfiedBy.map((context) => `    ${context.kind} ${context.name}`));
      }
      const guards = guardsForTarget(functionTarget(componentName, functionName), model);
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
  }

  const rationale = model.rationales.get(symbol);
  if (rationale) {
    return `${formatRationaleExplanation(rationale)}\n`;
  }

  const memory = model.memories.get(symbol);
  if (memory) {
    return `${formatMemoryExplanation(memory)}\n`;
  }

  const component = model.components.get(symbol);
  if (component) {
    const lines = [
      symbol,
      "  kind: component",
      "  grants:",
      ...[...component.grants.keys()].sort().map((grant) => `    ${grant}`),
      "",
      "  functions:",
      ...[...component.functions.keys()].sort().map((name) => `    ${name}`)
    ];
    return `${lines.join("\n")}\n`;
  }

  return `No shape facts found for ${symbol}.\n`;
}

export function graphShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string,
  relation = "requires"
): string {
  const model = lowerShapeModules(modules);
  const edges = buildDependencyEdges(model).filter(
    (edge) => relation === "requires" || edge.relation === relation
  );
  const lines = [symbol];
  const seen = new Set<string>();

  function visit(component: string, depth: number): void {
    if (seen.has(component)) {
      return;
    }
    seen.add(component);
    for (const edge of edges.filter((candidate) => candidate.from === component)) {
      lines.push(`${"  ".repeat(depth)}-> ${edge.to} via ${edge.relation}`);
      visit(edge.to, depth + 1);
    }
  }

  visit(symbol, 1);
  return `${lines.join("\n")}\n`;
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
    resources: new Map(),
    traits: new Map(PRELUDE_TRAITS.map((trait) => [trait.name, cloneTraitInfo(trait)])),
    components: new Map(),
    implementations: [],
    rules: [],
    rationales: new Map(),
    memories: new Map(),
    reevaluations: new Map(),
    attestations: [],
    shapeDeltaPaths: new Map(),
    removedFunctions: new Set(),
    changeEvents: [],
    facts: [],
    diagnostics: []
  };

  for (const input of inputs) {
    for (const declaration of input.module.declarations) {
      if (isResourceDecl(declaration)) {
        lowerResource(declaration, input.filePath, model);
      } else if (isTraitDecl(declaration)) {
        lowerTrait(declaration, input.filePath, model);
      } else if (isComponentDecl(declaration)) {
        lowerComponent(declaration, input.filePath, model);
      } else if (isImplementationDecl(declaration)) {
        lowerImplementation(declaration, input.filePath, model);
      } else if (isAttestationDecl(declaration)) {
        lowerAttestation(declaration, input.filePath, model);
      } else if (isRuleDecl(declaration)) {
        lowerRule(declaration, input.filePath, model);
      } else if (isRationaleDecl(declaration)) {
        lowerRationale(declaration, input.filePath, model);
      } else if (isMemoryDecl(declaration)) {
        lowerMemory(declaration, input.filePath, model);
      } else if (isReevaluationDecl(declaration)) {
        lowerReevaluation(declaration, input.filePath, model);
      }
    }
  }

  for (const input of inputs) {
    for (const declaration of input.module.declarations) {
      if (isChangeDecl(declaration)) {
        lowerChange(declaration, input.filePath, model);
      }
    }
  }

  emitDerivedFacts(model);
  return model;
}

function normalizeModuleInputs(modules: ShapeModule[] | CheckModuleInput[]): CheckModuleInput[] {
  return modules.map((input) => {
    if ("module" in input) {
      return input;
    }
    return { module: input };
  });
}

function lowerResource(resource: ResourceDecl, filePath: string | undefined, model: Model): void {
  const prov = provenance(filePath, `resource ${resource.name}`);
  if (model.resources.has(resource.name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "resource",
      name: resource.name,
      filePath,
      causedBy: [
        describeProvenance(model.resources.get(resource.name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const traits = new Map<string, Provenance>();
  for (const trait of resource.traits) {
    const traitProv = provenance(filePath, `resource ${resource.name} : ${trait.name}`);
    traits.set(trait.name, traitProv);
    model.facts.push({
      kind: "resource_trait",
      resource: resource.name,
      trait: trait.name,
      provenance: traitProv
    });
  }

  model.resources.set(resource.name, {
    name: resource.name,
    traits,
    provenance: prov
  });
  model.facts.push({ kind: "resource", name: resource.name, provenance: prov });
}

function lowerTrait(trait: TraitDecl, filePath: string | undefined, model: Model): void {
  const prov = provenance(filePath, `trait ${trait.name}`);
  if (model.traits.has(trait.name) && !isPreludeTrait(model.traits.get(trait.name))) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "trait",
      name: trait.name,
      filePath,
      causedBy: [
        describeProvenance(model.traits.get(trait.name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const finalForbids: FinalForbidPattern[] = [];
  for (const member of trait.members) {
    if (isTraitForbidDecl(member)) {
      finalForbids.push(lowerForbidPattern(member, filePath, `trait ${trait.name}`));
    }
  }

  model.traits.set(trait.name, {
    name: trait.name,
    typeParams: trait.typeParams?.params.map((param) => param.name) ?? [],
    finalForbids,
    provenance: prov
  });
}

function lowerComponent(
  component: ComponentDecl,
  filePath: string | undefined,
  model: Model
): void {
  const prov = provenance(filePath, `component ${component.name}`);
  if (model.components.has(component.name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "component",
      name: component.name,
      filePath,
      causedBy: [
        describeProvenance(model.components.get(component.name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: ComponentInfo = {
    name: component.name,
    grants: new Map(),
    owns: new Map(),
    provides: [],
    requires: [],
    functions: new Map(),
    provenance: prov
  };

  for (const member of component.members) {
    if (isOwnsDecl(member)) {
      const memberProv = provenance(
        filePath,
        `component ${component.name} owns ${member.resource.name}`
      );
      info.owns.set(member.resource.name, memberProv);
      model.facts.push({
        kind: "owns",
        component: component.name,
        resource: member.resource.name,
        provenance: memberProv
      });
    } else if (isGrantsDecl(member)) {
      const grant = lowerTerm(member.term);
      const memberProv = provenance(
        filePath,
        `component ${component.name} grants ${formatTerm(grant.name, grant.target ?? "")}`
      );
      info.grants.set(termKey(grant), memberProv);
      model.facts.push({
        kind: "grants",
        component: component.name,
        effect: grant.name,
        target: grant.target ?? "",
        provenance: memberProv
      });
    } else if (isProvidesDecl(member)) {
      const memberProv = provenance(
        filePath,
        `component ${component.name} provides ${member.target.name}`
      );
      info.provides.push({ target: member.target.name, provenance: memberProv });
      model.facts.push({
        kind: "provides",
        component: component.name,
        target: member.target.name,
        provenance: memberProv
      });
    } else if (isRequiresDecl(member)) {
      const relation = member.relation ?? "requires";
      const memberProv = provenance(
        filePath,
        `component ${component.name} requires ${member.target.name} via ${relation}`
      );
      info.requires.push({ target: member.target.name, relation, provenance: memberProv });
      model.facts.push({
        kind: "requires",
        component: component.name,
        target: member.target.name,
        relation,
        provenance: memberProv
      });
    } else if (isFunctionSummary(member)) {
      const fn = lowerFunction(member, component.name, filePath);
      info.functions.set(fn.name, fn);
      emitFunctionFacts(fn, model);
    }
  }

  model.components.set(component.name, info);
  model.facts.push({ kind: "component", name: component.name, provenance: prov });
}

function lowerImplementation(
  implementation: ImplementationDecl,
  filePath: string | undefined,
  model: Model
): void {
  const prov = provenance(filePath, `implementation ${implementation.name}`);
  const info: ImplementationInfo = {
    name: implementation.name,
    paths: [],
    provenance: prov
  };

  for (const member of implementation.members) {
    if (isPathsBlock(member)) {
      for (const path of member.paths) {
        const glob = unquote(path);
        const pathProv = provenance(filePath, `implementation ${implementation.name} path ${glob}`);
        info.paths.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "implementation_path",
          implementation: implementation.name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isConformsToDecl(member)) {
      info.conformsTo = member.component.name;
      model.facts.push({
        kind: "conforms_to",
        implementation: implementation.name,
        component: member.component.name,
        provenance: provenance(
          filePath,
          `implementation ${implementation.name} conforms_to ${member.component.name}`
        )
      });
    } else if (isOnChangeDecl(member)) {
      info.onChangeRequirement = member.requirement;
    }
  }

  model.implementations.push(info);
  model.facts.push({ kind: "implementation", name: implementation.name, provenance: prov });
}

function lowerAttestation(
  attestation: AttestationDecl,
  filePath: string | undefined,
  model: Model
): void {
  const source = lowerSourceRef(attestation.source);
  const path = normalizeSourcePath(source.path);
  const reason = unquote(attestation.reason.value);
  const prov = provenance(filePath, `attest ${attestation.kind} for ${path}`);
  if (attestation.kind === "no_shape_change") {
    model.attestations.push({ path, reason, provenance: prov });
    model.facts.push({ kind: "attestation", path, reason, provenance: prov });
  }
}

function lowerRule(rule: RuleDecl, filePath: string | undefined, model: Model): void {
  const info: RuleInfo = {
    name: rule.name,
    whenHas: [],
    forbidEffects: [],
    forbidProvides: [],
    forbidCycles: [],
    provenance: provenance(filePath, `rule ${rule.name}`)
  };

  for (const member of rule.members) {
    if (isRuleWhenHasDecl(member)) {
      info.whenHas.push({ subject: member.subject, trait: member.trait });
    } else if (isRuleForbidEffectDecl(member)) {
      info.forbidEffects.push(lowerRuleForbid(member, filePath, rule.name));
    } else if (isRuleForbidProvidesDecl(member)) {
      info.forbidProvides.push(lowerRuleForbidProvides(member, filePath, rule.name));
    } else if (isRuleForbidCycleDecl(member)) {
      info.forbidCycles.push(lowerRuleForbidCycle(member, filePath, rule.name));
    }
  }

  model.rules.push(info);
  model.facts.push({ kind: "rule", name: rule.name, provenance: info.provenance });
}

function lowerRationale(
  rationale: RationaleDecl,
  filePath: string | undefined,
  model: Model
): void {
  const prov = provenance(filePath, `rationale ${rationale.name}`);
  if (model.rationales.has(rationale.name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "rationale",
      name: rationale.name,
      filePath,
      causedBy: [
        describeProvenance(model.rationales.get(rationale.name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: RationaleInfo = {
    name: rationale.name,
    contextType: rationale.contextType.name,
    target: lowerTargetRef(rationale.contextType.target),
    protects: [],
    guards: [],
    evidence: [],
    provenance: prov
  };

  for (const member of rationale.members) {
    if (isAppliesToDecl(member)) {
      info.appliesTo = lowerTargetRef(member.target);
    } else if (isWhyDecl(member)) {
      info.why = member.reason;
    } else if (isSummaryDecl(member)) {
      info.summary = unquote(member.value);
    } else if (isOwnerDecl(member)) {
      info.owner = member.value;
    } else if (isReviewByDecl(member)) {
      info.reviewBy = unquote(member.value);
    } else if (isProtectsDecl(member)) {
      info.protects.push({
        kind: member.kind,
        value: member.value,
        provenance: provenance(
          filePath,
          `rationale ${rationale.name} protects ${member.kind} ${member.value}`
        )
      });
    } else if (isGuardDecl(member)) {
      info.guards.push({
        requirement: member.requirement,
        provenance: provenance(
          filePath,
          `rationale ${rationale.name} guards on_change require ${member.requirement}`
        )
      });
    } else if (isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    }
  }

  model.rationales.set(rationale.name, info);
  model.facts.push({
    kind: "rationale",
    name: rationale.name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts("rationale", info, model);
}

function lowerMemory(memory: MemoryDecl, filePath: string | undefined, model: Model): void {
  const prov = provenance(filePath, `memory ${memory.name}`);
  if (model.memories.has(memory.name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "memory",
      name: memory.name,
      filePath,
      causedBy: [
        describeProvenance(model.memories.get(memory.name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: MemoryInfo = {
    name: memory.name,
    contextType: memory.contextType.name,
    target: lowerTargetRef(memory.contextType.target),
    protects: [],
    guards: [],
    observed: [],
    evidence: [],
    provenance: prov
  };

  for (const member of memory.members) {
    if (isAppliesToDecl(member)) {
      info.appliesTo = lowerTargetRef(member.target);
    } else if (isStatusDecl(member)) {
      info.status = member.value;
    } else if (isConfidenceDecl(member)) {
      info.confidence = member.value;
    } else if (isProtectsDecl(member)) {
      info.protects.push({
        kind: member.kind,
        value: member.value,
        provenance: provenance(
          filePath,
          `memory ${memory.name} protects ${member.kind} ${member.value}`
        )
      });
    } else if (isGuardDecl(member)) {
      info.guards.push({
        requirement: member.requirement,
        provenance: provenance(
          filePath,
          `memory ${memory.name} guards on_change require ${member.requirement}`
        )
      });
    } else if (isObservedDecl(member)) {
      info.observed.push(lowerSourceRef(member));
    } else if (isSummaryDecl(member)) {
      info.summary = unquote(member.value);
    } else if (isOwnerDecl(member)) {
      info.owner = member.value;
    } else if (isReviewByDecl(member)) {
      info.reviewBy = unquote(member.value);
    } else if (isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    }
  }

  model.memories.set(memory.name, info);
  model.facts.push({
    kind: "memory",
    name: memory.name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts("memory", info, model);
}

function lowerReevaluation(
  reevaluation: ReevaluationDecl,
  filePath: string | undefined,
  model: Model
): void {
  const prov = provenance(filePath, `reevaluation ${reevaluation.name}`);
  if (model.reevaluations.has(reevaluation.name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "reevaluation",
      name: reevaluation.name,
      filePath,
      causedBy: [
        describeProvenance(model.reevaluations.get(reevaluation.name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: ReevaluationInfo = {
    name: reevaluation.name,
    evidence: [],
    provenance: prov
  };

  for (const member of reevaluation.members) {
    if (isSatisfiesDecl(member)) {
      info.satisfiesKind = member.kind;
      info.satisfiesName = member.name;
    } else if (isOutcomeDecl(member)) {
      info.outcome = member.value;
    } else if (isSummaryDecl(member)) {
      info.summary = unquote(member.value);
    } else if (isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    } else if (isReviewerDecl(member)) {
      info.reviewer = member.value;
    } else if (isApproverDecl(member)) {
      info.approver = member.value;
    } else if (isDecidedOnDecl(member)) {
      info.decidedOn = unquote(member.value);
    }
  }

  model.reevaluations.set(reevaluation.name, info);
  if (info.satisfiesKind && info.satisfiesName) {
    model.facts.push({
      kind: "reevaluation",
      name: reevaluation.name,
      satisfiesKind: info.satisfiesKind,
      satisfies: info.satisfiesName,
      provenance: prov
    });
  }
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

function lowerChange(change: ChangeDecl, filePath: string | undefined, model: Model): void {
  for (const entry of change.entries) {
    if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
      const component = model.components.get(entry.component);
      if (!component) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: entry.component,
          filePath,
          causedBy: [
            describeProvenance(
              provenance(
                filePath,
                `change ${change.name} ${entry.$type} ${entry.component}.${entry.name}`
              )
            )
          ]
        });
        continue;
      }

      if (isModifyFunctionChange(entry)) {
        model.changeEvents.push({
          kind: "function_modified",
          target: functionTarget(entry.component, entry.name),
          provenance: provenance(
            filePath,
            `change ${change.name} modify fn ${entry.component}.${entry.name}`
          )
        });
      }

      const fn = lowerFunction(entry, entry.component, filePath, `change ${change.name}`);
      component.functions.set(fn.name, fn);
      model.shapeDeltaPaths.set(`${entry.component}.${entry.name}`, fn.provenance);
      collectShapeDeltaPathsFromFunction(fn, model);
      emitFunctionFacts(fn, model);
    } else if (isRemoveFunctionChange(entry)) {
      model.changeEvents.push({
        kind: "function_removed",
        target: functionTarget(entry.component, entry.name),
        provenance: provenance(
          filePath,
          `change ${change.name} remove fn ${entry.component}.${entry.name}`
        )
      });
      model.removedFunctions.add(functionKey(entry.component, entry.name));
      model.components.get(entry.component)?.functions.delete(entry.name);
    } else if (isAddDeclarationChange(entry)) {
      lowerDeclaration(entry.declaration, filePath, model);
    } else if (isModifyDeclarationChange(entry)) {
      const kind = declarationKind(entry.declaration);
      if (kind !== "attestation") {
        removeDeclaration(kind, declarationName(entry.declaration), model);
      }
      lowerDeclaration(entry.declaration, filePath, model);
    } else if (isRemoveDeclarationChange(entry)) {
      removeDeclaration(entry.kind, entry.name, model);
    }
  }
}

function lowerDeclaration(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"],
  filePath: string | undefined,
  model: Model
): void {
  if (isResourceDecl(declaration)) {
    lowerResource(declaration, filePath, model);
  } else if (isTraitDecl(declaration)) {
    lowerTrait(declaration, filePath, model);
  } else if (isComponentDecl(declaration)) {
    lowerComponent(declaration, filePath, model);
  } else if (isImplementationDecl(declaration)) {
    lowerImplementation(declaration, filePath, model);
  } else if (isAttestationDecl(declaration)) {
    lowerAttestation(declaration, filePath, model);
  } else if (isRuleDecl(declaration)) {
    lowerRule(declaration, filePath, model);
  }
}

function removeDeclaration(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  model: Model
): void {
  if (kind === "resource") {
    model.resources.delete(name);
  } else if (kind === "trait") {
    model.traits.delete(name);
  } else if (kind === "component") {
    model.components.delete(name);
  } else if (kind === "implementation") {
    model.implementations = model.implementations.filter(
      (implementation) => implementation.name !== name
    );
  } else if (kind === "rule") {
    model.rules = model.rules.filter((rule) => rule.name !== name);
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
  if (isImplementationDecl(declaration)) {
    return "implementation";
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
  filePath?: string,
  context?: string
): FunctionInfo {
  const source = fn.source ? lowerSourceRef(fn.source) : undefined;
  const info: FunctionInfo = {
    component: componentName,
    name: fn.name,
    source,
    unsafe: fn.unsafe,
    effects: lowerEffects(fn.effects, filePath, componentName, fn.name),
    requires: [],
    shapeTraits: lowerShapeTraits(fn, componentName, filePath, context),
    description: fn.description
      ? lowerDescription(fn.description, componentName, fn.name, filePath, context)
      : undefined,
    provenance: provenance(
      filePath,
      `${context ? `${context} ` : ""}fn ${componentName}.${fn.name}`
    )
  };

  for (const member of fn.members) {
    if (isFunctionRequiresDecl(member)) {
      info.requires.push(lowerTerm(member.term));
    } else if (isReasonDecl(member)) {
      info.reason = unquote(member.value);
    } else if (isExpiresDecl(member)) {
      info.expires = unquote(member.value);
    }
  }

  return info;
}

function lowerShapeTraits(
  fn: FunctionAst,
  componentName: string,
  filePath: string | undefined,
  context?: string
): Map<string, Provenance> {
  const traits = new Map<string, Provenance>();
  for (const trait of fn.shapeTraits?.traits ?? []) {
    traits.set(
      trait.name,
      provenance(
        filePath,
        `${context ? `${context} ` : ""}fn ${componentName}.${fn.name} : ${trait.name}`
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
    summary: unquote(description.summary),
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
  functionName: string
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
      lowerEffectEntry(entry, filePath, componentName, functionName)
    )
  };
}

function lowerEffectEntry(
  entry: EffectEntry,
  filePath: string | undefined,
  componentName: string,
  functionName: string
): EffectEntryInfo {
  const term = lowerTerm(entry.term);
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
  filePath: string | undefined,
  owner: string
): FinalForbidPattern {
  const pattern = lowerPattern(member.pattern);
  return {
    effect: pattern.name,
    target: pattern.target,
    final: member.final,
    provenance: provenance(
      filePath,
      `${owner} forbids ${member.final ? "final " : ""}${formatTerm(pattern.name, pattern.target ?? "")}`
    )
  };
}

function lowerRuleForbid(
  member: RuleForbidEffectDecl,
  filePath: string | undefined,
  ruleName: string
): FinalForbidPattern {
  const pattern = lowerPattern(member.pattern);
  return {
    effect: pattern.name,
    target: pattern.target,
    final: member.final,
    provenance: provenance(
      filePath,
      `rule ${ruleName} forbids ${member.final ? "final " : ""}${formatTerm(pattern.name, pattern.target ?? "")}`
    )
  };
}

function lowerRuleForbidProvides(
  member: RuleForbidProvidesDecl,
  filePath: string | undefined,
  ruleName: string
): RuleInfo["forbidProvides"][number] {
  return {
    target: member.target.name,
    except: member.except,
    provenance: provenance(filePath, `rule ${ruleName} forbids provides ${member.target.name}`)
  };
}

function lowerRuleForbidCycle(
  member: RuleForbidCycleDecl,
  filePath: string | undefined,
  ruleName: string
): RuleInfo["forbidCycles"][number] {
  return {
    relation: member.relation,
    relationKinds: member.relationKinds,
    provenance: provenance(filePath, `rule ${ruleName} forbids cycle over ${member.relation}`)
  };
}

function lowerTerm(term: EffectTerm): TermInfo {
  return {
    name: term.name,
    target: term.target?.name
  };
}

function lowerPattern(pattern: EffectPattern): TermInfo {
  return {
    name: pattern.name,
    target: pattern.target?.name
  };
}

function lowerSourceRef(source: { ref: SourceRef }): SourceRefInfo {
  return {
    language: source.ref.language,
    path: unquote(source.ref.path)
  };
}

function lowerTargetRef(target: TargetRef): ShapeTarget {
  return {
    kind: target.kind,
    name: target.name
  };
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

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      for (const requirement of requirementsForFunction(fn)) {
        model.facts.push({
          kind: "context_required",
          targetKind: "fn",
          target: functionKey(fn.component, fn.name),
          contextType: requirement.contextType,
          requiredBy: requirement.trait,
          provenance: fn.shapeTraits.get(requirement.trait) ?? fn.provenance
        });
      }
    }
  }
}

function collectShapeDeltaPathsFromFunction(fn: FunctionInfo, model: Model): void {
  if (fn.source) {
    model.shapeDeltaPaths.set(normalizeSourcePath(fn.source.path), fn.provenance);
    model.facts.push({
      kind: "shape_delta_for",
      path: normalizeSourcePath(fn.source.path),
      provenance: fn.provenance
    });
  }

  if (fn.effects.kind === "complete") {
    for (const entry of fn.effects.entries) {
      if (entry.evidence) {
        const path = normalizeSourcePath(entry.evidence.path);
        model.shapeDeltaPaths.set(path, entry.provenance);
        model.facts.push({ kind: "shape_delta_for", path, provenance: entry.provenance });
      }
    }
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

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      const target = functionTarget(fn.component, fn.name);
      for (const requirement of requirementsForFunction(fn)) {
        if (hasRequiredContext(requirement, target, model)) {
          continue;
        }

        const traitProvenance = fn.shapeTraits.get(requirement.trait) ?? fn.provenance;
        diagnostics.push({
          kind: "missing_required_context",
          targetKind: "fn",
          target: target.name,
          requiredContext: formatContextRequirement(requirement.contextType, target),
          requiredBy: requirement.trait,
          filePath: traitProvenance.filePath,
          causedBy: [
            describeProvenance(traitProvenance),
            describeProvenance(
              provenance(
                "standard prelude",
                `${requirement.trait} requires ${requirement.contextType}`
              )
            )
          ]
        });
      }
    }
  }

  return diagnostics;
}

function checkRequiredDescriptions(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      for (const requirement of requirementsForFunction(fn).filter(
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

  for (const event of model.changeEvents) {
    for (const guard of guards) {
      if (
        !targetsEqual(event.target, guard.target) ||
        hasValidReevaluationForGuard(model, guard.kind, guard.info.name)
      ) {
        continue;
      }

      diagnostics.push({
        kind: "guarded_shape_changed",
        guardKind: guard.kind,
        guard: guard.info.name,
        targetKind: event.target.kind,
        target: event.target.name,
        missingReevaluation: `reevaluation satisfying ${guard.kind} ${guard.info.name}`,
        filePath: event.provenance.filePath,
        causedBy: [describeProvenance(event.provenance), describeProvenance(guard.guard.provenance)]
      });
    }
  }

  return diagnostics;
}

function checkFunctions(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      if (model.removedFunctions.has(functionKey(component.name, fn.name))) {
        continue;
      }

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
      for (const component of model.components.values()) {
        for (const provided of component.provides) {
          if (provided.target === forbid.target && component.name !== forbid.except) {
            diagnostics.push({
              kind: "forbidden_provides",
              rule: rule.name,
              component: component.name,
              target: provided.target,
              allowedComponent: forbid.except,
              filePath: provided.provenance.filePath,
              causedBy: [
                describeProvenance(provided.provenance),
                describeProvenance(forbid.provenance)
              ]
            });
          }
        }
      }
    }
  }

  return diagnostics;
}

function checkDependencyCycles(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const edges = buildDependencyEdges(model);

  for (const rule of model.rules) {
    for (const cycleRule of rule.forbidCycles) {
      const cycle = findDependencyCycle(edges, cycleRule.relationKinds);
      if (cycle) {
        diagnostics.push({
          kind: "forbidden_dependency_cycle",
          rule: rule.name,
          path: cycle.path,
          relationKinds: cycle.relationKinds,
          filePath: cycleRule.provenance.filePath,
          causedBy: [
            describeProvenance(cycleRule.provenance),
            ...cycle.provenance.map((item) => describeProvenance(item))
          ]
        });
      }
    }
  }

  return diagnostics;
}

function checkCoverage(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const normalizedChanged = changedFiles
    .map((file) => normalizePath(file))
    .filter((file) => file.length > 0);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const implementation of model.implementations) {
    if (implementation.onChangeRequirement !== "shape_delta") {
      continue;
    }

    for (const changedFile of normalizedChanged) {
      if (changedFile.endsWith(".shape")) {
        continue;
      }

      const governingPath = implementation.paths.find((entry) =>
        globMatches(entry.glob, changedFile)
      );
      if (!governingPath) {
        continue;
      }

      if (model.shapeDeltaPaths.has(changedFile)) {
        continue;
      }

      if (model.attestations.some((attestation) => attestation.path === changedFile)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_shape_delta",
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

function requirementsForFunction(fn: FunctionInfo): ContextRequirementRule[] {
  return PRELUDE_CONTEXT_REQUIREMENTS.filter(
    (rule) => rule.targetKind === "fn" && fn.shapeTraits.has(rule.trait)
  );
}

function hasRequiredContext(
  requirement: ContextRequirementRule,
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

    if (model.components.get(component)?.functions.has(functionName)) {
      return true;
    }

    return model.facts.some(
      (fact) =>
        fact.kind === "function" && fact.component === component && fact.name === functionName
    );
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
  return false;
}

function splitFunctionTarget(target: string): [string | undefined, string | undefined] {
  const [component, functionName, ...extra] = target.split(".");
  if (extra.length > 0) {
    return [undefined, undefined];
  }
  return [component, functionName];
}

function targetsEqual(left: ShapeTarget, right: ShapeTarget): boolean {
  return left.kind === right.kind && left.name === right.name;
}

function formatTarget(target: ShapeTarget): string {
  return `${target.kind} ${target.name}`;
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

  return reasons;
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

function formatRationaleExplanation(rationale: RationaleInfo): string {
  const lines = [
    rationale.name,
    "  kind: rationale",
    `  type: ${rationale.contextType}`,
    `  target: ${formatTarget(rationale.target)}`
  ];
  if (rationale.owner) {
    lines.push(`  owner: ${rationale.owner}`);
  }
  if (rationale.protects.length > 0) {
    lines.push("  protects:");
    lines.push(...rationale.protects.map((item) => `    ${item.kind} ${item.value}`));
  }
  if (rationale.guards.length > 0) {
    lines.push("  guards:");
    lines.push(...rationale.guards.map((guard) => `    on_change require ${guard.requirement}`));
  }
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
  if (memory.owner) {
    lines.push(`  owner: ${memory.owner}`);
  }
  if (memory.reviewBy) {
    lines.push(`  review_by: ${memory.reviewBy}`);
  }
  if (memory.protects.length > 0) {
    lines.push("  protects:");
    lines.push(...memory.protects.map((item) => `    ${item.kind} ${item.value}`));
  }
  if (memory.guards.length > 0) {
    lines.push("  guards:");
    lines.push(...memory.guards.map((guard) => `    on_change require ${guard.requirement}`));
  }
  return lines.join("\n");
}

function formatRationaleMemoryListEntry(rationale: RationaleInfo): string[] {
  const lines = [`rationale ${rationale.name}`, `type: ${rationale.contextType}`];
  if (rationale.protects.length > 0) {
    lines.push(
      `protects: ${rationale.protects.map((item) => `${item.kind} ${item.value}`).join(", ")}`
    );
  }
  if (rationale.owner) {
    lines.push(`owner: ${rationale.owner}`);
  }
  if (rationale.reviewBy) {
    lines.push(`review_by: ${rationale.reviewBy}`);
  }
  return lines;
}

function formatMemoryListEntry(memory: MemoryInfo): string[] {
  const lines = [`memory ${memory.name}`, `type: ${memory.contextType}`];
  if (memory.status) {
    lines.push(`status: ${memory.status}`);
  }
  if (memory.confidence) {
    lines.push(`confidence: ${memory.confidence}`);
  }
  if (memory.protects.length > 0) {
    lines.push(
      `protects: ${memory.protects.map((item) => `${item.kind} ${item.value}`).join(", ")}`
    );
  }
  if (memory.owner) {
    lines.push(`owner: ${memory.owner}`);
  }
  if (memory.reviewBy) {
    lines.push(`review_by: ${memory.reviewBy}`);
  }
  return lines;
}

function isObligationDiagnostic(diagnostic: ShapeDiagnostic): diagnostic is Extract<
  SemanticDiagnostic,
  {
    kind:
      | "missing_required_context"
      | "missing_required_description"
      | "guarded_shape_changed"
      | "invalid_reevaluation";
  }
> {
  return (
    diagnostic.kind === "missing_required_context" ||
    diagnostic.kind === "missing_required_description" ||
    diagnostic.kind === "guarded_shape_changed" ||
    diagnostic.kind === "invalid_reevaluation"
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
    const when = rule.whenHas[0];
    if (!when || !resource.traits.has(when.trait)) {
      continue;
    }

    for (const forbid of rule.forbidEffects) {
      if (!forbid.final) {
        continue;
      }
      forbids.push({
        effect: forbid.effect,
        target: substituteTarget(forbid.target, resource.name, [when.subject]),
        trait: when.trait,
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

type DependencyEdge = {
  from: string;
  to: string;
  relation: string;
  provenance: Provenance;
};

function buildDependencyEdges(model: Model): DependencyEdge[] {
  const providers = new Map<string, string[]>();
  for (const component of model.components.values()) {
    for (const provided of component.provides) {
      const existing = providers.get(provided.target) ?? [];
      existing.push(component.name);
      providers.set(provided.target, existing);
    }
  }

  const edges: DependencyEdge[] = [];
  for (const component of model.components.values()) {
    for (const required of component.requires) {
      const directComponent = model.components.has(required.target) ? [required.target] : [];
      const providerComponents = providers.get(required.target) ?? [];
      const targets = directComponent.length > 0 ? directComponent : providerComponents;
      for (const target of targets) {
        edges.push({
          from: component.name,
          to: target,
          relation: required.relation,
          provenance: required.provenance
        });
      }
    }
  }
  return edges;
}

function findDependencyCycle(
  edges: DependencyEdge[],
  requiredKinds: string[]
): { path: string[]; relationKinds: string[]; provenance: Provenance[] } | undefined {
  const adjacency = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    const existing = adjacency.get(edge.from) ?? [];
    existing.push(edge);
    adjacency.set(edge.from, existing);
  }

  for (const start of adjacency.keys()) {
    const result = dfsCycle(start, start, adjacency, [], new Set(), requiredKinds);
    if (result) {
      return result;
    }
  }

  return undefined;
}

function dfsCycle(
  start: string,
  current: string,
  adjacency: Map<string, DependencyEdge[]>,
  path: DependencyEdge[],
  seen: Set<string>,
  requiredKinds: string[]
): { path: string[]; relationKinds: string[]; provenance: Provenance[] } | undefined {
  if (seen.has(current)) {
    return undefined;
  }
  seen.add(current);

  for (const edge of adjacency.get(current) ?? []) {
    const nextPath = [...path, edge];
    if (edge.to === start) {
      const relationKinds = nextPath.map((item) => item.relation);
      if (
        requiredKinds.length === 0 ||
        relationKinds.some((kind) => requiredKinds.includes(kind))
      ) {
        return {
          path: [start, ...nextPath.map((item) => item.to)],
          relationKinds,
          provenance: nextPath.map((item) => item.provenance)
        };
      }
      continue;
    }

    const result = dfsCycle(start, edge.to, adjacency, nextPath, new Set(seen), requiredKinds);
    if (result) {
      return result;
    }
  }

  return undefined;
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
    case "duplicate_declaration":
      return formatDuplicateDeclarationDiagnostic(diagnostic);
    case "missing_shape_delta":
      return formatMissingShapeDeltaDiagnostic(diagnostic);
    case "forbidden_dependency_cycle":
      return formatDependencyCycleDiagnostic(diagnostic);
    case "forbidden_provides":
      return formatForbiddenProvidesDiagnostic(diagnostic);
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
    `${diagnostic.component}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${diagnostic.target} has trait ${diagnostic.trait}.`,
    `${diagnostic.trait} forbids final ${formatTerm(diagnostic.effect, diagnostic.target)}.${evidence}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingGrantDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_grant" }>
): string {
  return [
    "error: missing grant",
    "",
    `${diagnostic.component}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${diagnostic.component} does not grant ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnknownEffectsDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_effects" }>
): string {
  return [
    "error: unknown effects",
    "",
    `${diagnostic.component}.${diagnostic.functionName} declares effects unknown.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnknownNameDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_name" }>
): string {
  return [
    `error: unknown ${diagnostic.nameKind}`,
    "",
    `${diagnostic.nameKind} ${diagnostic.name} is referenced but not declared.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatDuplicateDeclarationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "duplicate_declaration" }>
): string {
  return [
    `error: duplicate ${diagnostic.declarationKind}`,
    "",
    `${diagnostic.declarationKind} ${diagnostic.name} is declared more than once.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingShapeDeltaDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_shape_delta" }>
): string {
  return [
    "error: governed source changed without shape delta",
    "",
    `Changed file: ${diagnostic.changedFile}`,
    `Governed by: ${diagnostic.implementation}`,
    `Matched path: ${diagnostic.glob}`,
    "Required: add a .shape change with matching source/evidence, or add a no_shape_change attestation.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatDependencyCycleDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_dependency_cycle" }>
): string {
  return [
    "error: forbidden dependency cycle",
    "",
    `rule ${diagnostic.rule} rejects this dependency cycle:`,
    `  ${diagnostic.path.join(" -> ")}`,
    `relations: ${diagnostic.relationKinds.join(", ")}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatForbiddenProvidesDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_provides" }>
): string {
  const allowed = diagnostic.allowedComponent ? ` except ${diagnostic.allowedComponent}` : "";
  return [
    "error: forbidden provides",
    "",
    `${diagnostic.component} provides ${diagnostic.target}.`,
    `rule ${diagnostic.rule} forbids provides ${diagnostic.target}${allowed}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnsafeEffectsDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unsafe_effects" }>
): string {
  return [
    "error: unsafe effects missing policy metadata",
    "",
    `${diagnostic.component}.${diagnostic.functionName} declares unsafe effects.`,
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
    `${diagnostic.targetKind} ${diagnostic.target} has shape ${diagnostic.requiredBy}.`,
    `${diagnostic.requiredBy} requires ${diagnostic.requiredContext}.`,
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
    `${diagnostic.contextKind} ${diagnostic.name} applies to ${diagnostic.targetKind} ${diagnostic.target},`,
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
    `${diagnostic.targetKind} ${diagnostic.target} has shape ${diagnostic.requiredBy}.`,
    `${diagnostic.requiredBy} requires a description.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatGuardedShapeChangedDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }>
): string {
  return [
    "error: guarded shape changed",
    "",
    `${diagnostic.targetKind} ${diagnostic.target} is protected by ${diagnostic.guardKind} ${diagnostic.guard}.`,
    "This change modifies the guarded target.",
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

function formatTerm(effect: string, target: string): string {
  return target ? `${effect}<${target}>` : effect;
}

function termKey(term: TermInfo): string {
  return `${term.name}<${term.target ?? ""}>`;
}

function functionKey(component: string, name: string): string {
  return `${component}.${name}`;
}

function normalizeSourcePath(path: string): string {
  const withoutAnchor = path.split("#", 1)[0] ?? path;
  const lineMatch = /^(.*):\d+(?:-\d+)?$/.exec(withoutAnchor);
  return normalizePath(lineMatch?.[1] ?? withoutAnchor);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globMatches(glob: string, path: string): boolean {
  const normalizedGlob = normalizePath(glob);
  const normalizedPath = normalizePath(path);
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
  return prov.filePath ? `${prov.filePath}: ${prov.label}` : prov.label;
}

function isPreludeTrait(trait: TraitInfo | undefined): boolean {
  return (
    trait !== undefined &&
    (trait.provenance.filePath === undefined || trait.provenance.filePath === "standard prelude")
  );
}

function cloneTraitInfo(trait: TraitInfo): TraitInfo {
  return {
    name: trait.name,
    typeParams: [...trait.typeParams],
    finalForbids: trait.finalForbids.map((forbid) => ({ ...forbid })),
    provenance: { ...trait.provenance }
  };
}

function unquote(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
