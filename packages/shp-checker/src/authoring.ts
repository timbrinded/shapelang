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
};

export type EvidenceSpan = {
  language: string;
  path: string;
  startLine: number;
  endLine: number;
};

export function buildShapeAuthorPrompt(input: ShapeAuthorPromptInput): string {
  return [
    "You are authoring a Shape .shp change file for human review.",
    "",
    "Rules:",
    "- Output only valid .shp syntax.",
    "- Cover every governed changed file with a source or evidence reference.",
    "- Use effects complete only when every material effect is represented.",
    "- Use effects unknown when uncertainty remains; do not silently omit uncertainty.",
    "- Represent destructive operations explicitly, including HardDelete, Truncate, and DropStorage.",
    "- Include evidence spans for material effects when the diff gives enough line context.",
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
    "Review this proposed Shape .shp delta before a deterministic checker runs.",
    "",
    "Critic checklist:",
    "- Did the shape delta cover every governed changed file?",
    "- Are destructive effects represented honestly?",
    "- Are unknowns marked explicitly?",
    "- Are evidence spans plausible and reviewable?",
    "- Did the delta avoid weakening final invariants?",
    "- Did dependency changes appear as requires/provides declarations?",
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
  const functions = input.changedFiles.map((file, index) =>
    formatUnknownFunction(input.componentName, file, uniqueFunctionName(file, index))
  );

  return [
    `module ${moduleName}`,
    "",
    `change ${changeName} {`,
    ...functions.flatMap((fn, index) => (index === 0 ? indentBlock(fn) : ["", ...indentBlock(fn)])),
    "}",
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
