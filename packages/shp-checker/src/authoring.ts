import {
  PRELUDE_CONTEXT_REQUIREMENTS,
  PRELUDE_FINAL_FORBID_EFFECT_NAMES,
  PRELUDE_RELATION_KIND_NAMES,
  type ContextKind
} from "./prelude.ts";

export type ShapeAuthorPromptInput = {
  existingShape?: string;
  diff?: string;
  changedFiles: string[];
  projectPrelude?: string;
  instructions?: string;
};

export type ShapeUpdateInput = {
  moduleName?: string;
  componentName: string;
  changedFiles: string[];
  includeMemoryGuardScaffold?: boolean;
};

export type EvidenceSpan = {
  language: string;
  path: string;
  startLine: number;
  endLine: number;
};

export function buildShapeAuthorPrompt(input: ShapeAuthorPromptInput): string {
  return [
    "You are authoring a Shape .shape global model update for human review.",
    "",
    "Rules:",
    "- Output only valid .shape syntax.",
    "- Cover every governed changed file with a source or evidence reference.",
    "- Use effects complete only when every material effect is represented.",
    "- Use effects unknown when uncertainty remains; do not silently omit uncertainty.",
    formatFinalForbidEffectGuidance(),
    "- Prefer stable #symbol source/evidence references; use file-only references when no stable symbol exists, and do not add line-number or line-range suffixes.",
    formatContextTraitGuidance(),
    formatRelationKindGuidance(),
    "- If modifying or removing a function protected by memory/rationale, include a reevaluation.",
    "- Use memory with status Unexplained when a refactor constraint is known but not fully explained yet.",
    "- Do not use rationale or memory to waive final forbidden effects.",
    "- Keep summaries short. Link longer evidence through source/evidence refs.",
    "",
    "Changed files:",
    ...input.changedFiles.map((file) => `- ${file}`),
    input.projectPrelude ? `\nProject prelude:\n${input.projectPrelude}` : "",
    input.existingShape ? `\nExisting shape:\n${input.existingShape}` : "",
    input.diff ? `\nPR diff:\n${input.diff}` : "",
    input.instructions ? `\nHuman instructions:\n${input.instructions}` : ""
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

function formatFinalForbidEffectGuidance(): string {
  return `- Represent destructive operations explicitly, including ${formatHumanList(PRELUDE_FINAL_FORBID_EFFECT_NAMES)}.`;
}

function formatContextTraitGuidance(): string {
  const traits = PRELUDE_CONTEXT_REQUIREMENTS.map((rule) => rule.trait);
  const contextKinds = new Set<ContextKind>();
  for (const rule of PRELUDE_CONTEXT_REQUIREMENTS) {
    for (const kind of rule.satisfiedBy) {
      contextKinds.add(kind);
    }
  }

  return `- If adding ${formatHumanList(traits)}, include matching ${formatHumanList([...contextKinds])}.`;
}

function formatRelationKindGuidance(): string {
  return `- Prefer prelude relation kinds ${formatHumanList(PRELUDE_RELATION_KIND_NAMES)} for structural dependencies unless project docs define a custom kind.`;
}

function formatHumanList(items: string[]): string {
  if (items.length <= 2) {
    return items.join(" or ");
  }

  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1) ?? ""}`;
}

export function buildShapeCriticPrompt(
  input: ShapeAuthorPromptInput,
  proposedShapeUpdate: string
): string {
  return [
    "Review this proposed Shape .shape model update before a deterministic checker runs.",
    "",
    "Critic checklist:",
    "- Did the model update cover every governed changed file?",
    "- Are destructive effects represented honestly?",
    "- Are unknowns marked explicitly?",
    "- Are source and evidence references stable #symbol or file-only references without line-number suffixes?",
    "- Did the model update avoid weakening final invariants?",
    `- Did structural dependency changes appear as relation declarations with ${formatHumanList(PRELUDE_RELATION_KIND_NAMES)} or an intentional custom kind?`,
    "- Did the model update add shape traits without matching context?",
    "- Did the model update touch a guarded target without reevaluation?",
    "- Did the model update remove a required description?",
    "- Are memory/rationale blocks compact and typed rather than generic prose?",
    "- Did the model update try to justify a final forbidden effect instead of preserving the error?",
    "",
    "Changed files:",
    ...input.changedFiles.map((file) => `- ${file}`),
    input.diff ? `\nPR diff:\n${input.diff}` : "",
    `\nProposed shape update:\n${proposedShapeUpdate}`
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function generateShapeUpdateDraft(input: ShapeUpdateInput): string {
  const moduleName = input.moduleName ?? "generated";
  const changedFunctions = input.changedFiles.map((file, index) => ({
    file,
    functionName: uniqueFunctionName(file, index)
  }));
  const functions = changedFunctions.map((item) =>
    formatUnknownFunction(item.file, item.functionName)
  );
  const scaffold =
    input.includeMemoryGuardScaffold && changedFunctions[0]
      ? ["", formatMemoryGuardScaffold(input.componentName, changedFunctions[0].functionName)]
      : [];

  return [
    `module ${moduleName}`,
    "",
    `component ${input.componentName} {`,
    ...functions.flatMap((fn, index) => (index === 0 ? indentBlock(fn) : ["", ...indentBlock(fn)])),
    "}",
    ...scaffold,
    ""
  ].join("\n");
}

export function extractEvidenceSpansFromUnifiedDiff(diff: string): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  let currentPath: string | undefined;
  let newLine = 0;
  let activeStart: number | undefined;
  let activeEnd: number | undefined;

  function flush(): void {
    if (currentPath && activeStart !== undefined && activeEnd !== undefined) {
      spans.push({
        language: languageForPath(currentPath),
        path: currentPath,
        startLine: activeStart,
        endLine: activeEnd
      });
    }
    activeStart = undefined;
    activeEnd = undefined;
  }

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      flush();
      currentPath = line.slice("+++ b/".length);
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush();
      newLine = Number(hunk[1]);
      continue;
    }

    if (!currentPath || line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      if (activeStart === undefined) {
        activeStart = newLine;
      }
      activeEnd = newLine;
      newLine += 1;
    } else {
      flush();
      if (!line.startsWith("-")) {
        newLine += 1;
      }
    }
  }

  flush();
  return spans;
}

function formatUnknownFunction(file: string, functionName: string): string {
  return [
    `fn ${functionName}`,
    `  source ${languageForPath(file)}(${JSON.stringify(file)})`,
    "  effects unknown"
  ].join("\n");
}

function formatMemoryGuardScaffold(componentName: string, functionName: string): string {
  const target = `fn ${componentName}.${functionName}`;
  return [
    `memory ReviewChangedShape : ${contextRef("RefactorConstraint", target)} {`,
    `  applies_to ${target}`,
    "  status Unexplained",
    "  confidence Medium",
    '  summary "TODO: replace with a specific refactor constraint or remove this memory."',
    "  who { owner TODO }",
    "}"
  ].join("\n");
}

function contextRef(contextType: string, target: string): string {
  return `${contextType}<${target}>`;
}

function uniqueFunctionName(file: string, index: number): string {
  const baseName =
    file
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? "change";
  const words = baseName.split(/[^a-zA-Z0-9]+/).filter((part) => part.length > 0);
  const pascal = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  return `review${pascal || "Change"}Shape${index + 1}`;
}

function languageForPath(file: string): string {
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    return "ts";
  }
  if (file.endsWith(".sql")) {
    return "sql";
  }
  if (file.endsWith(".rs")) {
    return "rust";
  }
  if (file.endsWith(".sol")) {
    return "solidity";
  }
  return "file";
}

function indentBlock(value: string): string[] {
  return value.split("\n").map((line) => `  ${line}`);
}
