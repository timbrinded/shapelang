import type {
  AddDeclarationChange,
  AddFunctionChange,
  AttestationDecl,
  BindingDecl,
  ChangeDecl,
  ComponentDecl,
  DescriptionDecl,
  EffectEntry,
  EffectPattern,
  EffectTerm,
  FunctionMember,
  FunctionSummary,
  ImplementationDecl,
  MemoryDecl,
  ModifyFunctionChange,
  RationaleDecl,
  ReevaluationDecl,
  ResourceDecl,
  RuleDecl,
  ShapeTraitList,
  ShapeModule,
  SourceDecl,
  TargetRef,
  TraitDecl,
  TypeParamList
} from "./language/generated/ast.ts";
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
    left.path.localeCompare(right.path)
  )) {
    chunks.push(`import ${item.path}`);
  }

  const declarations = [...module.declarations].sort((left, right) =>
    declarationSortKey(left).localeCompare(declarationSortKey(right))
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
          .sort()
          .join(", ")}`
      : "";
  const storage = resource.body?.members.filter(isStorageDecl) ?? [];
  if (storage.length === 0) {
    return `resource ${resource.name}${traits}`;
  }

  return [
    `resource ${resource.name}${traits} {`,
    ...storage
      .sort((left, right) =>
        `${left.provider}:${left.value}`.localeCompare(`${right.provider}:${right.value}`)
      )
      .map((item) => indent(`storage ${item.provider}(${quote(item.value)})`)),
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
    .sort();

  return block(`trait ${trait.name}${formatTypeParams(trait.typeParams)}`, members);
}

function formatComponent(component: ComponentDecl): string {
  const owns: string[] = [];
  const provides: string[] = [];
  const requires: string[] = [];
  const grants: string[] = [];
  const functions: string[] = [];

  for (const member of component.members) {
    if (isOwnsDecl(member)) {
      owns.push(`owns ${member.resource.name}`);
    } else if (isProvidesDecl(member)) {
      provides.push(`provides ${member.target.name}`);
    } else if (isRequiresDecl(member)) {
      requires.push(
        `requires ${member.target.name}${member.relation ? ` via ${member.relation}` : ""}`
      );
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
          .sort()
          .join(", ")}`
      : "";
  const members = [
    ...owns.sort(),
    ...provides.sort(),
    ...requires.sort(),
    ...grants.sort(),
    ...functions.sort()
  ];
  return block(`component ${component.name}${classifiers}`, members);
}

function formatFunction(fn: FunctionSummary | AddFunctionChange): string {
  return formatFunctionParts(
    `fn ${fn.name}`,
    fn.shapeTraits,
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
    `${keyword} fn ${fn.component}.${fn.name}`,
    fn.shapeTraits,
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
  source: SourceDecl | undefined,
  description: DescriptionDecl | undefined,
  unsafe: boolean,
  effects: FunctionSummary["effects"],
  members: FunctionMember[]
): string {
  const lines = [`${header}${formatShapeTraitList(shapeTraits)}`];
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
      formatTerm(left.term).localeCompare(formatTerm(right.term))
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
    .sort()
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
    formatFunctionMember(left).localeCompare(formatFunctionMember(right))
  );
}

function formatImplementation(implementation: ImplementationDecl): string {
  const lines: string[] = [];
  const pathBlocks = implementation.members.filter(isPathsBlock);
  const conformsTo = implementation.members.find(isConformsToDecl);
  const onChange = implementation.members.find(isOnChangeDecl);

  for (const pathBlock of pathBlocks) {
    lines.push("paths {");
    lines.push(...[...pathBlock.paths].sort().map((path) => indent(quote(path))));
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
    ...whenChanged.sort(),
    ...requireChanged.sort(),
    ...allowAttest.sort()
  ]);
}

function formatBindingPaths(keyword: "when_changed" | "require_changed", paths: string[]): string {
  return [`${keyword} paths {`, ...[...paths].sort().map((path) => indent(quote(path))), "}"].join(
    "\n"
  );
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
        return `remove fn ${entry.component}.${entry.name}`;
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
    .sort();

  return block(`change ${change.name}`, entries);
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
      if (isRuleForbidCycleDecl(member)) {
        const kinds =
          member.relationKinds.length > 0
            ? ` where includes ${member.relationKinds.join(" or ")}`
            : "";
        return `forbid cycle over ${member.relation}${kinds}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort();

  return block(`rule ${rule.name}${formatTypeParams(rule.typeParams)}`, members);
}

function formatRationale(rationale: RationaleDecl): string {
  const members = [...rationale.members]
    .map((member) => {
      if (isAppliesToDecl(member)) {
        return `applies_to ${formatTargetRef(member.target)}`;
      }
      if (isWhyDecl(member)) {
        return `why ${member.reason}`;
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
        return `protects ${member.kind} ${member.value}`;
      }
      if (isGuardDecl(member)) {
        return `guards on_change require ${member.requirement}`;
      }
      if (isEvidenceLineDecl(member)) {
        return `evidence ${formatSourceRef(member.ref)}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(
      (left, right) =>
        memberOrder(left, RATIONALE_MEMBER_ORDER) - memberOrder(right, RATIONALE_MEMBER_ORDER) ||
        left.localeCompare(right)
    );

  return block(
    `rationale ${rationale.name} : ${formatContextTypeRef(rationale.contextType)}`,
    members
  );
}

function formatMemory(memory: MemoryDecl): string {
  const members = [...memory.members]
    .map((member) => {
      if (isAppliesToDecl(member)) {
        return `applies_to ${formatTargetRef(member.target)}`;
      }
      if (isStatusDecl(member)) {
        return `status ${member.value}`;
      }
      if (isConfidenceDecl(member)) {
        return `confidence ${member.value}`;
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
        return `protects ${member.kind} ${member.value}`;
      }
      if (isGuardDecl(member)) {
        return `guards on_change require ${member.requirement}`;
      }
      if (isObservedDecl(member)) {
        return `observed ${formatSourceRef(member.ref)}`;
      }
      if (isEvidenceLineDecl(member)) {
        return `evidence ${formatSourceRef(member.ref)}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(
      (left, right) =>
        memberOrder(left, MEMORY_MEMBER_ORDER) - memberOrder(right, MEMORY_MEMBER_ORDER) ||
        left.localeCompare(right)
    );

  return block(`memory ${memory.name} : ${formatContextTypeRef(memory.contextType)}`, members);
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
          memberOrder(right, REEVALUATION_MEMBER_ORDER) || left.localeCompare(right)
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
    return `00:${declaration.name}`;
  }
  if (isResourceDecl(declaration)) {
    return `01:${declaration.name}`;
  }
  if (isComponentDecl(declaration)) {
    return `02:${declaration.name}`;
  }
  if (isImplementationDecl(declaration)) {
    return `03:${declaration.name}`;
  }
  if (isBindingDecl(declaration)) {
    return `04:${declaration.name}`;
  }
  if (isRuleDecl(declaration)) {
    return `05:${declaration.name}`;
  }
  if (isRationaleDecl(declaration)) {
    return `06:${declaration.name}`;
  }
  if (isMemoryDecl(declaration)) {
    return `07:${declaration.name}`;
  }
  if (isReevaluationDecl(declaration)) {
    return `08:${declaration.name}`;
  }
  if (isAttestationDecl(declaration)) {
    return `09:${declaration.kind}`;
  }
  if (isChangeDecl(declaration)) {
    return `10:${declaration.name}`;
  }
  return "10:";
}

function indent(value: string, depth = 1): string {
  const prefix = "  ".repeat(depth);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function quote(value: string): string {
  return JSON.stringify(unquote(value));
}

function unquote(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
