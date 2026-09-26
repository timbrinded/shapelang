import { compareCodepointStrings } from "./shape-strings.ts";
import * as ast from "./language/generated/ast.ts";
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

export function formatShapeModule(module: ast.ShapeModule): string {
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

function formatDeclaration(declaration: ast.ShapeModule["declarations"][number]): string {
  switch (declaration.$type) {
    case "ResourceDecl":
      return formatResource(declaration);
    case "TraitDecl":
      return block(
        `trait ${declaration.name}${formatTypeParams(declaration.typeParams)}`,
        sortMembers(declaration.members.map(formatMember))
      );
    case "ComponentDecl":
      return block(
        `component ${declaration.name}${formatTypeRefs(declaration.classifiers)}`,
        sortMembers(declaration.members.map(formatMember), ["owns", "grants", "fn"])
      );
    case "RelationDecl":
      return formatRelation(declaration);
    case "CandidateEffectDecl":
      return formatCandidateEffect(declaration);
    case "ImplementationDecl":
      return formatImplementation(declaration);
    case "BindingDecl":
      return block(
        `binding ${declaration.name}`,
        sortMembers(declaration.members.map(formatMember), [
          "when_changed",
          "require_changed",
          "allow"
        ])
      );
    case "AttestationDecl":
      return block(`attest ${declaration.kind}`, [
        `source ${formatSourceRef(declaration.source.ref)}`,
        `reason ${quote(declaration.reason.value)}`
      ]);
    case "ChangeDecl":
      return formatChange(declaration);
    case "RuleDecl":
      return block(`rule ${declaration.name}`, sortMembers(declaration.members.map(formatMember)));
    case "RationaleDecl":
      return block(
        `rationale ${declaration.name} : ${formatContextTypeRef(declaration.contextType)}`,
        formatContextMembers(declaration.members, RATIONALE_MEMBER_ORDER)
      );
    case "MemoryDecl":
      return block(
        `memory ${declaration.name} : ${formatContextTypeRef(declaration.contextType)}`,
        formatContextMembers(declaration.members, MEMORY_MEMBER_ORDER)
      );
    case "ReevaluationDecl":
      return block(
        `reevaluation ${declaration.name}`,
        sortMembers(declaration.members.map(formatMember), REEVALUATION_MEMBER_ORDER)
      );
    case "RoleDecl":
      return `role ${declaration.name}`;
    case "PolicyDecl":
      return formatPolicy(declaration);
  }
  return "";
}

function formatPolicy(policy: ast.PolicyDecl): string {
  const lines = [`policy ${policy.name} {`];
  if (policy.members.some(ast.isRequireApproverDecl)) {
    lines.push(indent("require approver"));
  }
  lines.push("}");
  return lines.join("\n");
}

function formatResource(resource: ast.ResourceDecl): string {
  const traits = formatTypeRefs(resource.traits);
  const storage = resource.body?.members.filter(ast.isStorageDecl) ?? [];
  const fingerprints = resource.body?.members.filter(ast.isFingerprintDecl) ?? [];
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

function formatRelation(relation: ast.RelationDecl): string {
  let kindLine = "";
  let connectsLine = "";
  const rolesLines: string[] = [];
  const expectationLines: string[] = [];
  let summaryLine = "";

  for (const member of relation.members) {
    if (member.$type === "RelationKindDecl") {
      kindLine = `kind ${member.value}`;
    } else if (member.$type === "RelationConnectsDecl") {
      const endpoints = member.endpoints.map((endpoint) => endpoint.name);
      if (member.ordered) {
        connectsLine = `connects ${endpoints.join(" -> ")}`;
      } else {
        connectsLine = `connects { ${endpoints.join(", ")} }`;
      }
    } else if (member.$type === "RelationRolesDecl") {
      const sortedRoles = [...member.roles].sort((left, right) =>
        compareCodepointStrings(left.name, right.name)
      );
      rolesLines.push(
        `roles { ${sortedRoles.map((role) => `${role.name} as ${role.role}`).join(", ")} }`
      );
    } else if (member.$type === "RelationFingerprintExpectationDecl") {
      expectationLines.push(
        `expects ${member.endpoint.name} fingerprint ${member.provider}(${quote(member.value)})`
      );
    } else if (member.$type === "RelationSummaryDecl") {
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

function formatCandidateEffect(candidateEffect: ast.CandidateEffectDecl): string {
  const functionLines: string[] = [];
  const effectLines: string[] = [];
  const sourceLines: string[] = [];
  const confidenceLines: string[] = [];
  const anchorLines: string[] = [];

  for (const member of candidateEffect.members) {
    if (member.$type === "CandidateEffectFunctionDecl") {
      functionLines.push(`fn ${member.function}`);
    } else if (member.$type === "CandidateEffectTermDecl") {
      effectLines.push(`effect ${formatTerm(member.term)}`);
    } else if (member.$type === "CandidateEffectConfidenceDecl") {
      confidenceLines.push(`confidence ${member.value}`);
    } else if (member.$type === "CandidateEffectAnchorDecl") {
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

function formatFingerprint(fingerprint: ast.FingerprintDecl): string {
  return `fingerprint ${fingerprint.provider}(${quote(fingerprint.value)})`;
}

function formatFunction(
  fn: ast.FunctionSummary | ast.AddFunctionChange | ast.ModifyFunctionChange,
  header: string
): string {
  const { shapeTraits, source, description, unsafe, effects, members } = fn;
  const transforms = fn.$type === "ModifyFunctionChange" ? fn.transforms : undefined;
  const lines = [`${header}${shapeTraits ? formatTypeRefs(shapeTraits.traits) : ""}`];
  if (transforms && transforms.labels.length > 0) {
    lines.push(indent(`transform ${transforms.labels.join(", ")}`));
  }
  if (source) {
    lines.push(indent(`source ${formatSourceRef(source.ref)}`));
  }
  if (description) {
    lines.push(indent(formatDescription(description)));
  }

  if (effects.$type === "UnknownEffects") {
    lines.push(indent(`${unsafe ? "unsafe " : ""}effects unknown`));
  } else if (effects.$type === "CompleteEffects") {
    lines.push(indent(`${unsafe ? "unsafe " : ""}effects complete {`));
    for (const entry of [...effects.effects].sort((left, right) =>
      compareCodepointStrings(formatTerm(left.term), formatTerm(right.term))
    )) {
      lines.push(indent(formatEffectEntry(entry), 2));
    }
    lines.push(indent("}"));
  }

  for (const member of members.map(formatMember).sort(compareCodepointStrings)) {
    lines.push(indent(member));
  }

  return lines.join("\n");
}

function formatTypeRefs(traits: readonly ast.TypeRef[]): string {
  if (traits.length === 0) {
    return "";
  }
  return ` : ${traits
    .map((trait) => trait.name)
    .sort(compareCodepointStrings)
    .join(", ")}`;
}

function formatDescription(description: ast.DescriptionDecl): string {
  return `description ${description.required ? "required " : ""}${quote(description.summary)}`;
}

function formatEffectEntry(entry: ast.EffectEntry): string {
  const lines = [formatTerm(entry.term)];
  if (entry.evidence) {
    lines.push(indent(`evidence ${formatSourceRef(entry.evidence.ref)}`));
  }
  return lines.join("\n");
}

function formatImplementation(implementation: ast.ImplementationDecl): string {
  const pathBlocks = implementation.members.filter(ast.isPathsBlock);
  const conformsTo = implementation.members.find(ast.isConformsToDecl);
  const onChange = implementation.members.find(ast.isOnChangeDecl);

  const lines = pathBlocks.map((pathBlock) => formatPathsBlock(pathBlock.paths));
  if (conformsTo) {
    lines.push(`conforms_to ${conformsTo.component.name}`);
  }
  if (onChange) {
    lines.push(`on_change require ${onChange.requirement}`);
  }

  return block(`implementation ${implementation.name}`, lines);
}

function formatPathsBlock(paths: string[]): string {
  return block("paths", [...paths].sort(compareCodepointStrings).map(quote));
}

function formatChange(change: ast.ChangeDecl): string {
  const entries = [...change.entries]
    .map((entry) => {
      if (entry.$type === "AddFunctionChange") {
        return formatFunction(entry, `add fn ${entry.target}`);
      }
      if (entry.$type === "ModifyFunctionChange") {
        return formatFunction(entry, `modify fn ${entry.target}`);
      }
      if (entry.$type === "RemoveFunctionChange") {
        return `remove fn ${entry.target}`;
      }
      if (entry.$type === "AddDeclarationChange") {
        return `add ${formatDeclaration(entry.declaration)}`;
      }
      if (entry.$type === "ModifyDeclarationChange") {
        return `modify ${formatDeclaration(entry.declaration)}`;
      }
      if (entry.$type === "RemoveDeclarationChange") {
        return `remove ${entry.kind} ${entry.name}`;
      }
      return "";
    })
    .filter((line) => line.length > 0)
    .sort(compareCodepointStrings);

  return block(`change ${change.name}`, entries);
}

/**
 * Canonicalise the shared context members. Grouped blocks are the only guard
 * syntax: protects and guards are aggregated into one `protects { … }` /
 * `guards { … }` block, and owner/review_by are wrapped in `who { … }` /
 * `when { … }`. Repeated blocks of the same kind are merged into one.
 */
function formatContextMembers(
  members: readonly (ast.RationaleMember | ast.MemoryMember)[],
  order: string[]
): string[] {
  const lines: string[] = [];
  const protects: string[] = [];
  const guards: string[] = [];
  let owner: string | undefined;
  let reviewBy: string | undefined;

  for (const member of members) {
    if (member.$type === "ProtectsBlock") {
      for (const entry of member.entries) {
        protects.push(formatProtectsEntry(entry.kind, entry.value));
      }
    } else if (member.$type === "GuardsBlock") {
      for (const entry of member.entries) {
        guards.push(formatGuardActionEntry(entry));
      }
    } else if (member.$type === "WhoBlock") {
      if (member.owner) {
        owner = member.owner.value;
      }
    } else if (member.$type === "WhenBlock") {
      if (member.date) {
        reviewBy = member.date.value;
      }
    } else {
      lines.push(formatMember(member));
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

  return sortMembers(lines, order);
}

function formatProtectsEntry(kind: string, value: string | undefined): string {
  return value ? `${kind} ${value}` : kind;
}

function formatGuardActionEntry(
  action: ast.GuardRequireDecl | ast.GuardForbidTransformDecl
): string {
  return action.$type === "GuardForbidTransformDecl"
    ? `forbid transform ${action.label}`
    : `on_change require ${action.requirement}`;
}

/** Append a trailing comma to every entry but the last (ProtectsBlock entries
 *  are comma-separated). */
function commaSeparated(entries: string[]): string[] {
  return entries.map((entry, index) => (index < entries.length - 1 ? `${entry},` : entry));
}

type FormattableMember =
  | ast.BindingMember
  | ast.ComponentMember
  | ast.FunctionMember
  | ast.MemoryMember
  | ast.RationaleMember
  | ast.ReevaluationMember
  | ast.RuleMember
  | ast.TraitMember;

function formatMember(member: FormattableMember): string {
  switch (member.$type) {
    case "OwnsDecl":
      return `owns ${member.resource.name}`;
    case "GrantsDecl":
      return `grants ${formatTerm(member.term)}`;
    case "FunctionSummary":
      return formatFunction(member, `fn ${member.name}`);
    case "BindingWhenChangedDecl":
      return `when_changed ${formatPathsBlock(member.body.paths)}`;
    case "BindingRequireChangedDecl":
      return `require_changed ${formatPathsBlock(member.body.paths)}`;
    case "BindingAllowAttestDecl":
      return `allow attest ${member.kind}`;
    case "TraitAllowDecl":
      return `allow ${formatTerm(member.pattern)}`;
    case "TraitRequireDecl":
      return `require ${formatTerm(member.pattern)}`;
    case "TraitForbidDecl":
    case "RuleForbidEffectDecl":
      return `forbid ${member.final ? "final " : ""}${formatTerm(member.pattern)}`;
    case "RequireContextDecl": {
      const satisfiedBy =
        member.satisfiedBy.length > 0 ? ` satisfied_by ${member.satisfiedBy.join(" or ")}` : "";
      return `require_context ${member.contextType}<${member.target}>${satisfiedBy}`;
    }
    case "FunctionRequiresDecl":
      return `requires ${formatTerm(member.term)}`;
    case "ReasonDecl":
      return `reason ${quote(member.value)}`;
    case "ExpiresDecl":
      return `expires ${quote(member.value)}`;
    case "AppliesToDecl":
      return `applies_to ${formatTargetRef(member.target)}`;
    case "WhyDecl":
      return `why ${member.reason}`;
    case "SummaryDecl":
      return `summary ${quote(member.value)}`;
    case "EvidenceLineDecl":
      return `evidence ${formatSourceRef(member.ref)}`;
    case "StatusDecl":
      return `status ${member.value}`;
    case "ConfidenceDecl":
      return `confidence ${member.value}`;
    case "ObservedDecl":
      return `observed ${formatSourceRef(member.ref)}`;
    case "SensitiveDecl":
      return "sensitive";
    case "SatisfiesDecl":
      return `satisfies ${member.kind} ${member.name}`;
    case "OutcomeDecl":
      return `outcome ${member.value}`;
    case "ReviewerDecl":
      return `reviewer ${member.value}`;
    case "ApproverDecl":
      return `approver ${member.value}`;
    case "DecidedOnDecl":
      return `decided_on ${quote(member.value)}`;
    case "RuleWhenHasDecl":
      return `when ${member.subject} has ${member.trait}`;
    case "RuleForbidProvidesDecl":
      return `forbid provides ${member.target.name}${member.except ? ` except ${member.except}` : ""}`;
    case "RuleForbidHypercycleDecl": {
      const kinds = member.kinds.length > 0 ? ` over ${member.kinds.join(" or ")}` : "";
      return `forbid hypercycle${kinds}`;
    }
    case "RuleForbidPathDecl":
      return `forbid path ${member.source} -> ${member.target} over ${member.kinds.join(" or ")}`;
  }
  return "";
}

function sortMembers(lines: string[], order: readonly string[] = []): string[] {
  const groups = new Map(order.map((keyword) => [keyword, [] as string[]]));
  const remaining: string[] = [];
  for (const line of lines) {
    if (line.length > 0) {
      const keyword = line.split(/\s+/, 1)[0] ?? "";
      (groups.get(keyword) ?? remaining).push(line);
    }
  }
  return [...groups.values(), remaining].flatMap((group) => group.sort(compareCodepointStrings));
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

function formatContextTypeRef(
  contextType: ast.RationaleDecl["contextType"] | ast.MemoryDecl["contextType"]
): string {
  return `${contextType.name}<${formatTargetRef(contextType.target)}>`;
}

function formatTargetRef(target: ast.TargetRef): string {
  return `${target.kind} ${target.name}`;
}

function block(header: string, members: string[]): string {
  return [`${header} {`, ...members.map((member) => indent(member)), "}"].join("\n");
}

function formatTypeParams(typeParams: ast.TypeParamList | undefined): string {
  if (!typeParams || typeParams.params.length === 0) {
    return "";
  }
  return `<${typeParams.params.map((param) => `${param.name}${param.bound ? `: ${param.bound}` : ""}`).join(", ")}>`;
}

function formatTerm(term: ast.EffectTerm | ast.EffectPattern): string {
  return term.target ? `${term.name}<${term.target.name}>` : term.name;
}

function formatSourceRef(ref: ast.SourceDecl["ref"]): string {
  return `${ref.language}(${quote(ref.path)})`;
}

const DECLARATION_ORDER: Record<ast.ShapeModule["declarations"][number]["$type"], string> = {
  TraitDecl: "0",
  ResourceDecl: "1",
  ComponentDecl: "2",
  RelationDecl: "3",
  CandidateEffectDecl: "4",
  ImplementationDecl: "5",
  BindingDecl: "6",
  RuleDecl: "7",
  RoleDecl: "7A",
  PolicyDecl: "7B",
  RationaleDecl: "8",
  MemoryDecl: "9",
  ReevaluationDecl: "A",
  AttestationDecl: "B",
  ChangeDecl: "C"
};

function declarationSortKey(declaration: ast.ShapeModule["declarations"][number]): string {
  const order = DECLARATION_ORDER[declaration.$type];
  if (order === undefined) {
    return "Z:";
  }
  const name = declaration.$type === "AttestationDecl" ? declaration.kind : declaration.name;
  return `${order}:${name}`;
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
