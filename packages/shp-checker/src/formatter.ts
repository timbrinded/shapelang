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
  GuardForbidTransformDecl,
  GuardRequireDecl,
  ImplementationDecl,
  MemoryDecl,
  MemoryMember,
  ModifyFunctionChange,
  PolicyDecl,
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
  isGuardForbidTransformDecl,
  isGuardsBlock,
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
  isPolicyDecl,
  isProtectsBlock,
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
  isStorageDecl,
  isSummaryDecl,
  isTraitAllowDecl,
  isTraitDecl,
  isTraitForbidDecl,
  isTraitRequireDecl,
  isUnknownEffects,
  isWhenBlock,
  isWhoBlock,
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
  if (isRoleDecl(declaration)) {
    return `role ${declaration.name}`;
  }
  if (isPolicyDecl(declaration)) {
    return formatPolicy(declaration);
  }
  return "";
}

function formatPolicy(policy: PolicyDecl): string {
  const lines = [`policy ${policy.name} {`];
  if (policy.members.some(isRequireApproverDecl)) {
    lines.push(indent("require approver"));
  }
  lines.push("}");
  return lines.join("\n");
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
      if (isRequireContextDecl(member)) {
        const satisfiedBy =
          member.satisfiedBy.length > 0 ? ` satisfied_by ${member.satisfiedBy.join(" or ")}` : "";
        return `require_context ${member.contextType}<${member.target}>${satisfiedBy}`;
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
  const specific = rationale.members.filter(isWhyDecl).map((member) => `why ${member.reason}`);
  return block(
    `rationale ${rationale.name} : ${formatContextTypeRef(rationale.contextType)}`,
    formatContextMembers(rationale.members, specific, RATIONALE_MEMBER_ORDER)
  );
}

function formatMemory(memory: MemoryDecl): string {
  const specific: string[] = [];
  for (const member of memory.members) {
    if (isStatusDecl(member)) {
      specific.push(`status ${member.value}`);
    } else if (isConfidenceDecl(member)) {
      specific.push(`confidence ${member.value}`);
    } else if (isObservedDecl(member)) {
      specific.push(`observed ${formatSourceRef(member.ref)}`);
    } else if (isSensitiveDecl(member)) {
      specific.push("sensitive");
    }
  }
  return block(
    `memory ${memory.name} : ${formatContextTypeRef(memory.contextType)}`,
    formatContextMembers(memory.members, specific, MEMORY_MEMBER_ORDER)
  );
}

/**
 * Canonicalise the shared context members. The grouped block forms are
 * canonical: protects and guards are aggregated into one `protects { … }` /
 * `guards { … }` block, and owner/review_by are wrapped in `who { … }` /
 * `when { … }`. Both the flat and the nested input syntaxes parse, but the
 * formatter always emits the grouped form, so there is one canonical shape.
 */
function formatContextMembers(
  members: readonly (RationaleMember | MemoryMember)[],
  specificLines: string[],
  order: string[]
): string[] {
  const lines = [...specificLines];
  const protects: string[] = [];
  const guards: string[] = [];
  let owner: string | undefined;
  let reviewBy: string | undefined;

  for (const member of members) {
    if (isAppliesToDecl(member)) {
      lines.push(`applies_to ${formatTargetRef(member.target)}`);
    } else if (isSummaryDecl(member)) {
      lines.push(`summary ${quote(member.value)}`);
    } else if (isEvidenceLineDecl(member)) {
      lines.push(`evidence ${formatSourceRef(member.ref)}`);
    } else if (isOwnerDecl(member)) {
      owner = member.value;
    } else if (isReviewByDecl(member)) {
      reviewBy = member.value;
    } else if (isProtectsDecl(member)) {
      protects.push(formatProtectsEntry(member.kind, member.value));
    } else if (isProtectsBlock(member)) {
      for (const entry of member.entries) {
        protects.push(formatProtectsEntry(entry.kind, entry.value));
      }
    } else if (isGuardDecl(member)) {
      guards.push(formatGuardActionEntry(member.action));
    } else if (isGuardsBlock(member)) {
      for (const entry of member.entries) {
        guards.push(formatGuardActionEntry(entry));
      }
    } else if (isWhoBlock(member)) {
      if (member.owner) {
        owner = member.owner.value;
      }
    } else if (isWhenBlock(member)) {
      if (member.date) {
        reviewBy = member.date.value;
      }
    }
  }

  if (protects.length > 0) {
    lines.push(block("protects", commaSeparated([...protects].sort(compareCodepointStrings))));
  }
  if (guards.length > 0) {
    lines.push(block("guards", [...guards].sort(compareCodepointStrings)));
  }
  if (owner !== undefined) {
    lines.push(block("who", [`owner ${owner}`]));
  }
  if (reviewBy !== undefined) {
    lines.push(block("when", [`review_by ${quote(reviewBy)}`]));
  }

  return lines
    .filter((line) => line.length > 0)
    .sort(
      (left, right) =>
        memberOrder(left, order) - memberOrder(right, order) || compareCodepointStrings(left, right)
    );
}

function formatProtectsEntry(kind: string, value: string | undefined): string {
  return value ? `${kind} ${value}` : kind;
}

function formatGuardActionEntry(action: GuardRequireDecl | GuardForbidTransformDecl): string {
  return isGuardForbidTransformDecl(action)
    ? `forbid transform ${action.label}`
    : `on_change require ${action.requirement}`;
}

/** Append a trailing comma to every entry but the last (ProtectsBlock entries
 *  are comma-separated). */
function commaSeparated(entries: string[]): string[] {
  return entries.map((entry, index) => (index < entries.length - 1 ? `${entry},` : entry));
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
  "who",
  "when",
  "protects",
  "guards",
  "evidence"
];

const MEMORY_MEMBER_ORDER = [
  "applies_to",
  "status",
  "confidence",
  "sensitive",
  "summary",
  "who",
  "when",
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
  if (isRoleDecl(declaration)) {
    return `7A:${declaration.name}`;
  }
  if (isPolicyDecl(declaration)) {
    return `7B:${declaration.name}`;
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
