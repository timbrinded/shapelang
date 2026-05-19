export type ShapeAuthorPromptInput = {
  existingShape?: string;
  diff?: string;
  changedFiles: string[];
  projectPrelude?: string;
  instructions?: string;
};

export type ShapeDeltaInput = {
  moduleName?: string;
  changeName?: string;
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
    "You are authoring a Shape .shape change file for human review.",
    "",
    "Rules:",
    "- Output only valid .shape syntax.",
    "- Cover every governed changed file with a source or evidence reference.",
    "- Use effects complete only when every material effect is represented.",
    "- Use effects unknown when uncertainty remains; do not silently omit uncertainty.",
    "- Represent destructive operations explicitly, including HardDelete, Truncate, and DropStorage.",
    "- Include evidence spans for material effects when the diff gives enough line context.",
    "- If adding PreserveInline, RequiresDescription, ProtectedCheckOrder, RefactorSensitive, or NonIdiomatic, include matching rationale or memory.",
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

export function buildShapeCriticPrompt(input: ShapeAuthorPromptInput, proposedShapeDelta: string): string {
  return [
    "Review this proposed Shape .shape delta before a deterministic checker runs.",
    "",
    "Critic checklist:",
    "- Did the shape delta cover every governed changed file?",
    "- Are destructive effects represented honestly?",
    "- Are unknowns marked explicitly?",
    "- Are evidence spans plausible and reviewable?",
    "- Did the delta avoid weakening final invariants?",
    "- Did structural dependency changes appear as relation declarations with the correct kind?",
    "- Did the delta add shape traits without matching context?",
    "- Did the delta touch a guarded target without reevaluation?",
    "- Did the delta remove a required description?",
    "- Are memory/rationale blocks compact and typed rather than generic prose?",
    "- Did the delta try to justify a final forbidden effect instead of preserving the error?",
    "",
    "Changed files:",
    ...input.changedFiles.map((file) => `- ${file}`),
    input.diff ? `\nPR diff:\n${input.diff}` : "",
    `\nProposed shape delta:\n${proposedShapeDelta}`
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function generateShapeDelta(input: ShapeDeltaInput): string {
  const moduleName = input.moduleName ?? "changes.generated";
  const changeName = input.changeName ?? "GeneratedShapeDelta";
  const changedFunctions = input.changedFiles.map((file, index) => ({
    file,
    functionName: uniqueFunctionName(file, index)
  }));
  const functions = changedFunctions.map((item) => formatUnknownFunction(input.componentName, item.file, item.functionName));
  const scaffold = input.includeMemoryGuardScaffold && changedFunctions[0]
    ? [
        "",
        formatMemoryGuardScaffold(input.componentName, changedFunctions[0].functionName)
      ]
    : [];

  return [
    `module ${moduleName}`,
    "",
    `change ${changeName} {`,
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

function formatUnknownFunction(componentName: string, file: string, functionName: string): string {
  return [
    `add fn ${componentName}.${functionName}`,
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
    "  owner TODO",
    "}"
  ].join("\n");
}

function contextRef(contextType: string, target: string): string {
  return `${contextType}<${target}>`;
}

function uniqueFunctionName(file: string, index: number): string {
  const baseName = file.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "change";
  const words = baseName
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0);
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
  return "source";
}

function indentBlock(value: string): string[] {
  return value.split("\n").map((line) => `  ${line}`);
}
