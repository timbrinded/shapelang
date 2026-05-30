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
  EffectTerm,
  FingerprintDecl,
  FunctionMember,
  FunctionSummary,
  ImplementationDecl,
  MemoryDecl,
  MemoryMember,
  ModifyFunctionChange,
  TransformDecl,
  RationaleDecl,
  RationaleMember,
  ReevaluationDecl,
  RelationDecl,
  ResourceDecl,
  RuleDecl,
  ShapeTraitList,
  ShapeModule,
  SourceDecl,
  TargetRef,
  TraitDecl,
  TypeParamList
} from "./language/generated/ast.ts";
import { compareCodepointStrings } from "./shape-strings.ts";
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
  isResourceDecl,
  isReviewByDecl,
  isReviewerDecl,
  isRuleDecl,
  isRuleForbidEffectDecl,
  isRuleForbidHypercycleDecl,
  isRuleForbidProvidesDecl,
  isRuleWhenHasDecl,
  isSatisfiesDecl,
  isStatusDecl,
  isStorageDecl,
  isSummaryDecl,
  isTraitAllowDecl,
  isTraitDecl,
  isTraitForbidDecl,
  isTraitRequireDecl,
  isUnknownEffects,
  isWhyDecl
} from "./language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "./parser.ts";
import { unquoteShapeString } from "./shape-strings.ts";

export type FormatResult =
  | {
      ok: true;
      formatted: string;
    }
  | {
      ok: false;
      diagnostics: ParseDiagnostic[];
    };

export function formatShapeSource(source: string, filePath = "memory.shape"): FormatResult {
  const parsed = parseShapeModule(source, filePath);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics
    };
  }

  return {
    ok: true,
    formatted: formatShapeModule(parsed.module)
  };
}

export function formatShapeModule(module: ShapeModule): string {
  const chunks: string[] = [];
  if (module.name) {
    chunks.push(`module ${module.name}`);
  }

  for (const item of [...module.imports].sort((left, right) =>
    compareCodepointStrings(left.path, right.path)
  )) {
    chunks.push(`import ${item.path}`);
  }

  const declarations = [...module.declarations].sort((left, right) =>
    compareCodepointStrings(declarationSortKey(left), declarationSortKey(right))
  );
  for (const declaration of declarations) {
    chunks.push(formatDeclaration(declaration));
  }

  return `${chunks.filter((chunk) => chunk.length > 0).join("\n\n")}\n`;
}

function formatDeclaration(declaration: ShapeModule["declarations"][number]): string {
  if (isResourceDecl(declaration)) {
    return formatResource(declaration);
  }
  if (isTraitDecl(declaration)) {
    return formatTrait(declaration);
  }
  if (isComponentDecl(declaration)) {
    return formatComponent(declaration);
  }
  if (isRelationDecl(declaration)) {
    return formatRelation(declaration);
  }
  if (isCandidateEffectDecl(declaration)) {
    return formatCandidateEffect(declaration);
  }
  if (isImplementationDecl(declaration)) {
    return formatImplementation(declaration);
  }
  if (isBindingDecl(declaration)) {
    return formatBinding(declaration);
  }
  if (isAttestationDecl(declaration)) {
    return formatAttestation(declaration);
  }
  if (isChangeDecl(declaration)) {
    return formatChange(declaration);
  }
  if (isRuleDecl(declaration)) {
    return formatRule(declaration);
  }
  if (isRationaleDecl(declaration)) {
    return formatRationale(declaration);
  }
  if (isMemoryDecl(declaration)) {
    return formatMemory(declaration);
  }
  if (isReevaluationDecl(declaration)) {
    return formatReevaluation(declaration);
  }
  return "";
}

function formatResource(resource: ResourceDecl): string {
  const traits =
    resource.traits.length > 0
      ? ` : ${resource.traits
          .map((trait) => trait.name)
          .sort(compareCodepointStrings)
          .join(", ")}`
      : "";
  const storage = resource.body?.members.filter(isStorageDecl) ?? [];
  const fingerprints = resource.body?.members.filter(isFingerprintDecl) ?? [];
  if (storage.length === 0 && fingerprints.length === 0) {
    return `resource ${resource.name}${traits}`;
  }

  return [
    `resource ${resource.name}${traits} {`,
    ...storage
      .sort((left, right) =>
        compareCodepointStrings(
          `${left.provider}:${left.value}`,
          `${right.provider}:${right.value}`
        )
      )
      .map((item) => indent(`storage ${item.provider}(${quote(item.value)})`)),
    ...fingerprints
      .sort((left, right) =>
        compareCodepointStrings(
          `${left.provider}:${left.value}`,
          `${right.provider}:${right.value}`
        )
      )
      .map((item) => indent(formatFingerprint(item))),
    "}"
  ].join("\n");
}

function formatTrait(trait: TraitDecl): string {
  const members = [...trait.members]
    .map((member) => {
      if (isTraitAllowDecl(member)) {
        return `allow ${formatPattern(member.pattern)}`;
      }
      if (isTraitRequireDecl(member)) {
        return `require ${formatPattern(member.pattern)}`;
      }
      if (isTraitForbidDecl(member)) {
        return `forbid ${member.final ? "final " : ""}${formatPattern(member.pattern)}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(compareCodepointStrings);

  return block(`trait ${trait.name}${formatTypeParams(trait.typeParams)}`, members);
}

function formatComponent(component: ComponentDecl): string {
  const owns: string[] = [];
  const grants: string[] = [];
  const functions: string[] = [];

  for (const member of component.members) {
    if (isOwnsDecl(member)) {
      owns.push(`owns ${member.resource.name}`);
    } else if (isGrantsDecl(member)) {
      grants.push(`grants ${formatTerm(member.term)}`);
    } else if (isFunctionSummary(member)) {
      functions.push(formatFunction(member));
    }
  }

  const classifiers =
    component.classifiers.length > 0
      ? ` : ${component.classifiers
          .map((classifier) => classifier.name)
          .sort(compareCodepointStrings)
          .join(", ")}`
      : "";
  const members = [
    ...owns.sort(compareCodepointStrings),
    ...grants.sort(compareCodepointStrings),
    ...functions.sort(compareCodepointStrings)
  ];
  return block(`component ${component.name}${classifiers}`, members);
}

function formatRelation(relation: RelationDecl): string {
  let kindLine = "";
  let connectsLine = "";
  const rolesLines: string[] = [];
  const expectationLines: string[] = [];
  let summaryLine = "";

  for (const member of relation.members) {
    if (isRelationKindDecl(member)) {
      kindLine = `kind ${member.value}`;
    } else if (isRelationConnectsDecl(member)) {
      const endpoints = member.endpoints.map((endpoint) => endpoint.name);
      if (member.ordered) {
        connectsLine = `connects ${endpoints.join(" -> ")}`;
      } else {
        connectsLine = `connects { ${endpoints.join(", ")} }`;
      }
    } else if (isRelationRolesDecl(member)) {
      const sortedRoles = [...member.roles].sort((left, right) =>
        compareCodepointStrings(left.name, right.name)
      );
      rolesLines.push(
        `roles { ${sortedRoles.map((role) => `${role.name} as ${role.role}`).join(", ")} }`
      );
    } else if (isRelationFingerprintExpectationDecl(member)) {
      expectationLines.push(
        `expects ${member.endpoint.name} fingerprint ${member.provider}(${quote(member.value)})`
      );
    } else if (isRelationSummaryDecl(member)) {
      summaryLine = `summary ${quote(member.value)}`;
    }
  }

  const lines = [
    kindLine,
    connectsLine,
    ...rolesLines,
    ...expectationLines.sort(compareCodepointStrings),
    summaryLine
  ].filter((line) => line.length > 0);
  return block(`relation ${relation.name}`, lines);
}

function formatCandidateEffect(candidateEffect: CandidateEffectDecl): string {
  const functionLines: string[] = [];
  const effectLines: string[] = [];
  const sourceLines: string[] = [];
  const confidenceLines: string[] = [];
  const anchorLines: string[] = [];

  for (const member of candidateEffect.members) {
    if (isCandidateEffectFunctionDecl(member)) {
      functionLines.push(`fn ${member.function}`);
    } else if (isCandidateEffectTermDecl(member)) {
      effectLines.push(`effect ${formatTerm(member.term)}`);
    } else if (isCandidateEffectConfidenceDecl(member)) {
      confidenceLines.push(`confidence ${member.value}`);
    } else if (isCandidateEffectAnchorDecl(member)) {
      anchorLines.push(
        `pin ${member.target.name} fingerprint ${member.provider}(${quote(member.value)})`
      );
    } else {
      sourceLines.push(`source ${formatSourceRef(member.ref)}`);
    }
  }

  return block(`effect candidate ${candidateEffect.name}`, [
    ...functionLines,
    ...effectLines,
    ...sourceLines,
    ...confidenceLines,
    ...anchorLines
  ]);
}

function formatFingerprint(fingerprint: FingerprintDecl): string {
  return `fingerprint ${fingerprint.provider}(${quote(fingerprint.value)})`;
}

function formatFunction(fn: FunctionSummary | AddFunctionChange): string {
  return formatFunctionParts(
    `fn ${formatFunctionLocalName(fn)}`,
    fn.shapeTraits,
    undefined,
    fn.source,
    fn.description,
    fn.unsafe,
    fn.effects,
    fn.members
  );
}

function formatQualifiedFunction(
  fn: AddFunctionChange | ModifyFunctionChange,
  keyword: "add" | "modify"
): string {
  return formatFunctionParts(
    `${keyword} fn ${fn.target}`,
    fn.shapeTraits,
    isModifyFunctionChange(fn) ? fn.transforms : undefined,
    fn.source,
    fn.description,
    fn.unsafe,
    fn.effects,
    fn.members
  );
}

function formatFunctionParts(
  header: string,
  shapeTraits: ShapeTraitList | undefined,
  transforms: TransformDecl | undefined,
  source: SourceDecl | undefined,
  description: DescriptionDecl | undefined,
  unsafe: boolean,
  effects: FunctionSummary["effects"],
  members: FunctionMember[]
): string {
  const lines = [`${header}${formatShapeTraitList(shapeTraits)}`];
  if (transforms && transforms.labels.length > 0) {
    lines.push(indent(`transform ${transforms.labels.join(", ")}`));
  }
  if (source) {
    lines.push(indent(`source ${formatSource(source)}`));
  }
  if (description) {
    lines.push(indent(formatDescription(description)));
  }

  if (isUnknownEffects(effects)) {
    lines.push(indent(`${unsafe ? "unsafe " : ""}effects unknown`));
  } else if (isCompleteEffects(effects)) {
    lines.push(indent(`${unsafe ? "unsafe " : ""}effects complete {`));
    for (const entry of [...effects.effects].sort((left, right) =>
      compareCodepointStrings(formatTerm(left.term), formatTerm(right.term))
    )) {
      lines.push(indent(formatEffectEntry(entry), 2));
    }
    lines.push(indent("}"));
  }

  for (const member of sortFunctionMembers(members)) {
    lines.push(indent(formatFunctionMember(member)));
  }

  return lines.join("\n");
}

function formatShapeTraitList(shapeTraits: ShapeTraitList | undefined): string {
  if (!shapeTraits || shapeTraits.traits.length === 0) {
    return "";
  }
  return ` : ${shapeTraits.traits
    .map((trait) => trait.name)
    .sort(compareCodepointStrings)
    .join(", ")}`;
}

function formatDescription(description: DescriptionDecl): string {
  return `description ${description.required ? "required " : ""}${quote(description.summary)}`;
}

function formatEffectEntry(entry: EffectEntry): string {
  const lines = [formatTerm(entry.term)];
  if (entry.evidence) {
    lines.push(indent(`evidence ${formatSourceRef(entry.evidence.ref)}`));
  }
  return lines.join("\n");
}

function formatFunctionMember(member: FunctionMember): string {
  if (isFunctionRequiresDecl(member)) {
    return `requires ${formatTerm(member.term)}`;
  }
  if (isReasonDecl(member)) {
    return `reason ${quote(member.value)}`;
  }
  if (isExpiresDecl(member)) {
    return `expires ${quote(member.value)}`;
  }
  return "";
}

function sortFunctionMembers(members: FunctionMember[]): FunctionMember[] {
  return [...members].sort((left, right) =>
    compareCodepointStrings(formatFunctionMember(left), formatFunctionMember(right))
  );
}

function formatImplementation(implementation: ImplementationDecl): string {
  const lines: string[] = [];
  const pathBlocks = implementation.members.filter(isPathsBlock);
  const conformsTo = implementation.members.find(isConformsToDecl);
  const onChange = implementation.members.find(isOnChangeDecl);

  for (const pathBlock of pathBlocks) {
    lines.push("paths {");
    lines.push(
      ...[...pathBlock.paths].sort(compareCodepointStrings).map((path) => indent(quote(path)))
    );
    lines.push("}");
  }
  if (conformsTo) {
    lines.push(`conforms_to ${conformsTo.component.name}`);
  }
  if (onChange) {
    lines.push(`on_change require ${onChange.requirement}`);
  }

  return block(`implementation ${implementation.name}`, lines);
}

function formatBinding(binding: BindingDecl): string {
  const whenChanged: string[] = [];
  const requireChanged: string[] = [];
  const allowAttest: string[] = [];

  for (const member of binding.members) {
    if (isBindingWhenChangedDecl(member)) {
      whenChanged.push(formatBindingPaths("when_changed", member.body.paths));
    } else if (isBindingRequireChangedDecl(member)) {
      requireChanged.push(formatBindingPaths("require_changed", member.body.paths));
    } else if (isBindingAllowAttestDecl(member)) {
      allowAttest.push(`allow attest ${member.kind}`);
    }
  }

  return block(`binding ${binding.name}`, [
    ...whenChanged.sort(compareCodepointStrings),
    ...requireChanged.sort(compareCodepointStrings),
    ...allowAttest.sort(compareCodepointStrings)
  ]);
}

function formatBindingPaths(keyword: "when_changed" | "require_changed", paths: string[]): string {
  return [
    `${keyword} paths {`,
    ...[...paths].sort(compareCodepointStrings).map((path) => indent(quote(path))),
    "}"
  ].join("\n");
}

function formatAttestation(attestation: AttestationDecl): string {
  return block(`attest ${attestation.kind}`, [
    `source ${formatSource(attestation.source)}`,
    `reason ${quote(attestation.reason.value)}`
  ]);
}

function formatChange(change: ChangeDecl): string {
  const entries = [...change.entries]
    .map((entry) => {
      if (isAddFunctionChange(entry)) {
        return formatQualifiedFunction(entry, "add");
      }
      if (isModifyFunctionChange(entry)) {
        return formatQualifiedFunction(entry, "modify");
      }
      if (isRemoveFunctionChange(entry)) {
        return `remove fn ${entry.target}`;
      }
      if (isAddDeclarationChange(entry)) {
        return formatChangedDeclaration("add", entry.declaration);
      }
      if (isModifyDeclarationChange(entry)) {
        return formatChangedDeclaration("modify", entry.declaration);
      }
      if (isRemoveDeclarationChange(entry)) {
        return `remove ${entry.kind} ${entry.name}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(compareCodepointStrings);

  return block(`change ${change.name}`, entries);
}

function formatFunctionLocalName(fn: FunctionSummary | AddFunctionChange): string {
  if (isFunctionSummary(fn)) {
    return fn.name;
  }
  return fn.target.slice(fn.target.lastIndexOf(".") + 1);
}

function formatChangedDeclaration(
  keyword: "add" | "modify",
  declaration: AddDeclarationChange["declaration"]
): string {
  const formatted = formatDeclaration(declaration);
  const lines = formatted.split("\n");
  if (lines.length === 1) {
    return `${keyword} ${formatted}`;
  }

  const [first, ...rest] = lines;
  return [`${keyword} ${first}`, ...rest].join("\n");
}

function formatRule(rule: RuleDecl): string {
  const members = [...rule.members]
    .map((member) => {
      if (isRuleWhenHasDecl(member)) {
        return `when ${member.subject} has ${member.trait}`;
      }
      if (isRuleForbidEffectDecl(member)) {
        return `forbid ${member.final ? "final " : ""}${formatPattern(member.pattern)}`;
      }
      if (isRuleForbidProvidesDecl(member)) {
        return `forbid provides ${member.target.name}${member.except ? ` except ${member.except}` : ""}`;
      }
      if (isRuleForbidHypercycleDecl(member)) {
        const kinds = member.kinds.length > 0 ? ` over ${member.kinds.join(" or ")}` : "";
        return `forbid hypercycle${kinds}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(compareCodepointStrings);

  return block(`rule ${rule.name}`, members);
}

function formatRationale(rationale: RationaleDecl): string {
  const members = [...rationale.members]
    .map((member) => {
      if (isWhyDecl(member)) {
        return `why ${member.reason}`;
      }
      return formatContextMember(member) ?? "";
    })
    .filter((line) => line.length > 0)
    .sort(
      (left, right) =>
        memberOrder(left, RATIONALE_MEMBER_ORDER) - memberOrder(right, RATIONALE_MEMBER_ORDER) ||
        compareCodepointStrings(left, right)
    );

  return block(
    `rationale ${rationale.name} : ${formatContextTypeRef(rationale.contextType)}`,
    members
  );
}

function formatMemory(memory: MemoryDecl): string {
  const members = [...memory.members]
    .map((member) => {
      if (isStatusDecl(member)) {
        return `status ${member.value}`;
      }
      if (isConfidenceDecl(member)) {
        return `confidence ${member.value}`;
      }
      if (isObservedDecl(member)) {
        return `observed ${formatSourceRef(member.ref)}`;
      }
      return formatContextMember(member) ?? "";
    })
    .filter((line) => line.length > 0)
    .sort(
      (left, right) =>
        memberOrder(left, MEMORY_MEMBER_ORDER) - memberOrder(right, MEMORY_MEMBER_ORDER) ||
        compareCodepointStrings(left, right)
    );

  return block(`memory ${memory.name} : ${formatContextTypeRef(memory.contextType)}`, members);
}

function formatContextMember(member: RationaleMember | MemoryMember): string | undefined {
  if (isAppliesToDecl(member)) {
    return `applies_to ${formatTargetRef(member.target)}`;
  }
  if (isSummaryDecl(member)) {
    return `summary ${quote(member.value)}`;
  }
  if (isOwnerDecl(member)) {
    return `owner ${member.value}`;
  }
  if (isReviewByDecl(member)) {
    return `review_by ${quote(member.value)}`;
  }
  if (isProtectsDecl(member)) {
    return member.value ? `protects ${member.kind} ${member.value}` : `protects ${member.kind}`;
  }
  if (isGuardDecl(member)) {
    return member.forbiddenTransform
      ? `guards forbid transform ${member.forbiddenTransform}`
      : `guards on_change require ${member.requirement}`;
  }
  if (isEvidenceLineDecl(member)) {
    return `evidence ${formatSourceRef(member.ref)}`;
  }
  return undefined;
}

function formatReevaluation(reevaluation: ReevaluationDecl): string {
  const members = [...reevaluation.members]
    .map((member) => {
      if (isSatisfiesDecl(member)) {
        return `satisfies ${member.kind} ${member.name}`;
      }
      if (isOutcomeDecl(member)) {
        return `outcome ${member.value}`;
      }
      if (isSummaryDecl(member)) {
        return `summary ${quote(member.value)}`;
      }
      if (isReviewerDecl(member)) {
        return `reviewer ${member.value}`;
      }
      if (isApproverDecl(member)) {
        return `approver ${member.value}`;
      }
      if (isDecidedOnDecl(member)) {
        return `decided_on ${quote(member.value)}`;
      }
      if (isEvidenceLineDecl(member)) {
        return `evidence ${formatSourceRef(member.ref)}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(
      (left, right) =>
        memberOrder(left, REEVALUATION_MEMBER_ORDER) -
          memberOrder(right, REEVALUATION_MEMBER_ORDER) || compareCodepointStrings(left, right)
    );

  return block(`reevaluation ${reevaluation.name}`, members);
}

const RATIONALE_MEMBER_ORDER = [
  "applies_to",
  "why",
  "summary",
  "owner",
  "review_by",
  "protects",
  "guards",
  "evidence"
];

const MEMORY_MEMBER_ORDER = [
  "applies_to",
  "status",
  "confidence",
  "summary",
  "owner",
  "review_by",
  "protects",
  "guards",
  "observed",
  "evidence"
];

const REEVALUATION_MEMBER_ORDER = [
  "satisfies",
  "outcome",
  "summary",
  "reviewer",
  "approver",
  "decided_on",
  "evidence"
];

function memberOrder(line: string, order: string[]): number {
  const keyword = line.split(/\s+/, 1)[0] ?? "";
  const index = order.indexOf(keyword);
  return index === -1 ? order.length : index;
}

function formatContextTypeRef(
  contextType: RationaleDecl["contextType"] | MemoryDecl["contextType"]
): string {
  return `${contextType.name}<${formatTargetRef(contextType.target)}>`;
}

function formatTargetRef(target: TargetRef): string {
  return `${target.kind} ${target.name}`;
}

function block(header: string, members: string[]): string {
  if (members.length === 0) {
    return `${header} {\n}`;
  }
  return [`${header} {`, ...members.map((member) => indent(member)), "}"].join("\n");
}

function formatTypeParams(typeParams: TypeParamList | undefined): string {
  if (!typeParams || typeParams.params.length === 0) {
    return "";
  }
  return `<${typeParams.params.map((param) => `${param.name}${param.bound ? `: ${param.bound}` : ""}`).join(", ")}>`;
}

function formatTerm(term: EffectTerm): string {
  return term.target ? `${term.name}<${term.target.name}>` : term.name;
}

function formatPattern(pattern: EffectPattern): string {
  return pattern.target ? `${pattern.name}<${pattern.target.name}>` : pattern.name;
}

function formatSource(source: SourceDecl): string {
  return formatSourceRef(source.ref);
}

function formatSourceRef(ref: SourceDecl["ref"]): string {
  return `${ref.language}(${quote(ref.path)})`;
}

function declarationSortKey(declaration: ShapeModule["declarations"][number]): string {
  if (isTraitDecl(declaration)) {
    return `0:${declaration.name}`;
  }
  if (isResourceDecl(declaration)) {
    return `1:${declaration.name}`;
  }
  if (isComponentDecl(declaration)) {
    return `2:${declaration.name}`;
  }
  if (isRelationDecl(declaration)) {
    return `3:${declaration.name}`;
  }
  if (isCandidateEffectDecl(declaration)) {
    return `4:${declaration.name}`;
  }
  if (isImplementationDecl(declaration)) {
    return `5:${declaration.name}`;
  }
  if (isBindingDecl(declaration)) {
    return `6:${declaration.name}`;
  }
  if (isRuleDecl(declaration)) {
    return `7:${declaration.name}`;
  }
  if (isRationaleDecl(declaration)) {
    return `8:${declaration.name}`;
  }
  if (isMemoryDecl(declaration)) {
    return `9:${declaration.name}`;
  }
  if (isReevaluationDecl(declaration)) {
    return `A:${declaration.name}`;
  }
  if (isAttestationDecl(declaration)) {
    return `B:${declaration.kind}`;
  }
  if (isChangeDecl(declaration)) {
    return `C:${declaration.name}`;
  }
  return "Z:";
}

function indent(value: string, depth = 1): string {
  const prefix = "  ".repeat(depth);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function quote(value: string): string {
  return JSON.stringify(unquoteShapeString(value));
}
