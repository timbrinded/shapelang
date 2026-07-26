import {
  buildShapeAuthoringBundle,
  formatShapeCriticAdvisories,
  generateShapeUpdateDraft,
  reviewShapeAuthoringProposal,
  type ParseDiagnostic,
  type ShapeAuthorContextFile
} from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { CliDiagnosticError } from "../../errors";
import { stderr, stdout } from "../../io";
import { readChangedFiles, readCliTextFile } from "../../shape-files";

export type AuthorFlags = {
  readonly changedFiles: string;
  readonly component?: string;
  readonly criticPrompt?: string;
  readonly diff?: string;
  readonly instructions?: string;
  readonly module?: string;
  readonly projectPrelude?: string;
  readonly prompt?: boolean;
  readonly shapeFiles?: string;
  readonly snippetFiles?: string;
};

type ContextModeInput =
  | {
      readonly kind: "author_prompt";
      readonly componentName: string;
      readonly diffPath: string;
      readonly shapeFiles: string[];
    }
  | {
      readonly kind: "critic_prompt";
      readonly diffPath: string;
      readonly shapeFiles: string[];
      readonly proposedShapePath: string;
    };

type ExplicitPromptContext = {
  readonly diff: string;
  readonly existingShape: ShapeAuthorContextFile[];
  readonly relevantSnippets?: ShapeAuthorContextFile[];
  readonly projectPrelude?: ShapeAuthorContextFile;
};

type PromptInput = {
  readonly diffPath: string;
  readonly shapeFiles: string[];
};

export default async function author(this: CliContext, flags: AuthorFlags): Promise<void> {
  const contextMode = validateAuthorFlags(flags);
  const changedFiles = await readChangedFiles(flags.changedFiles);

  if (contextMode) {
    const context = await readExplicitPromptContext(flags, contextMode, changedFiles);
    if (contextMode.kind === "critic_prompt") {
      const proposedShapeUpdate = await readContextFile(contextMode.proposedShapePath);
      if (proposedShapeUpdate.content.trim().length === 0) {
        throw new CliDiagnosticError(
          "error: --critic-prompt requires a non-empty proposed Shape file.\n"
        );
      }

      const result = reviewShapeAuthoringProposal({
        changedFiles,
        diff: context.diff,
        existingShape: context.existingShape,
        proposedShapeUpdate,
        relevantSnippets: context.relevantSnippets,
        projectPrelude: context.projectPrelude,
        instructions: flags.instructions
      });
      if (!result.ok) {
        throw new CliDiagnosticError(formatCriticInputDiagnostics(result.diagnostics));
      }

      stdout(this, `${result.prompt}\n`);
      const advisoryOutput = formatShapeCriticAdvisories(result.advisories);
      if (advisoryOutput.length > 0) {
        stderr(this, advisoryOutput);
      }
      return;
    }

    const bundle = buildShapeAuthoringBundle({
      changedFiles,
      componentName: contextMode.componentName,
      moduleName: flags.module,
      diff: context.diff,
      existingShape: context.existingShape,
      relevantSnippets: context.relevantSnippets,
      projectPrelude: context.projectPrelude,
      instructions: flags.instructions
    });

    stdout(this, `${bundle.authorPrompt}\n`);
    return;
  }

  stdout(
    this,
    generateShapeUpdateDraft({
      changedFiles,
      componentName: requireComponent(flags),
      moduleName: flags.module
    })
  );
}

function validateAuthorFlags(flags: AuthorFlags): ContextModeInput | undefined {
  if (flags.prompt && flags.criticPrompt !== undefined) {
    throw new CliDiagnosticError("error: --prompt and --critic-prompt cannot be used together.\n");
  }

  if (flags.prompt) {
    const promptInput = requirePromptInput(flags, "--prompt");
    return {
      kind: "author_prompt",
      componentName: requireComponent(flags),
      ...promptInput
    };
  }

  if (flags.criticPrompt !== undefined) {
    const promptInput = requirePromptInput(flags, "--critic-prompt");
    return {
      kind: "critic_prompt",
      ...promptInput,
      proposedShapePath: flags.criticPrompt
    };
  }

  const promptOnlyFlag = [
    [flags.diff, "--diff"],
    [flags.instructions, "--instructions"],
    [flags.projectPrelude, "--project-prelude"],
    [flags.shapeFiles, "--shape-files"],
    [flags.snippetFiles, "--snippet-files"]
  ].find(([value]) => value !== undefined);
  if (promptOnlyFlag) {
    throw new CliDiagnosticError(
      `error: ${promptOnlyFlag[1]} requires --prompt or --critic-prompt.\n`
    );
  }

  requireComponent(flags);
  return undefined;
}

function requireComponent(flags: AuthorFlags): string {
  if (flags.component === undefined || flags.component.trim().length === 0) {
    throw new CliDiagnosticError(
      "error: --component is required unless --critic-prompt is used.\n"
    );
  }
  return flags.component;
}

function requirePromptInput(
  flags: AuthorFlags,
  modeFlag: "--prompt" | "--critic-prompt"
): PromptInput {
  if (flags.diff === undefined) {
    throw new CliDiagnosticError(`error: ${modeFlag} requires --diff.\n`);
  }
  const shapeFiles = parseFileList(flags.shapeFiles);
  if (shapeFiles.length === 0) {
    throw new CliDiagnosticError(`error: ${modeFlag} requires --shape-files.\n`);
  }
  return { diffPath: flags.diff, shapeFiles };
}

async function readExplicitPromptContext(
  flags: AuthorFlags,
  contextMode: ContextModeInput,
  changedFiles: string[]
): Promise<ExplicitPromptContext> {
  const diff = await readCliTextFile(contextMode.diffPath);
  const modeFlag = contextMode.kind === "author_prompt" ? "--prompt" : "--critic-prompt";
  if (diff.trim().length === 0) {
    throw new CliDiagnosticError(`error: ${modeFlag} requires a non-empty unified diff.\n`);
  }
  if (changedFiles.length === 0) {
    throw new CliDiagnosticError(`error: ${modeFlag} requires at least one changed file.\n`);
  }

  const snippetFiles = parseFileList(flags.snippetFiles);
  return {
    diff,
    existingShape: await readContextFiles(contextMode.shapeFiles),
    relevantSnippets: snippetFiles.length > 0 ? await readContextFiles(snippetFiles) : undefined,
    projectPrelude:
      flags.projectPrelude === undefined ? undefined : await readContextFile(flags.projectPrelude)
  };
}

function formatCriticInputDiagnostics(diagnostics: ParseDiagnostic[]): string {
  return `${diagnostics
    .map((diagnostic) => {
      const location =
        diagnostic.line === undefined
          ? ""
          : `:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
      return `error: failed to parse ${diagnostic.filePath}${location}: ${diagnostic.message}`;
    })
    .join("\n")}\n`;
}

function parseFileList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((path) => path.trim())
      .filter((path) => path.length > 0) ?? []
  );
}

async function readContextFiles(paths: string[]): Promise<ShapeAuthorContextFile[]> {
  return Promise.all(paths.map(readContextFile));
}

async function readContextFile(path: string): Promise<ShapeAuthorContextFile> {
  return { path, content: await readCliTextFile(path) };
}
