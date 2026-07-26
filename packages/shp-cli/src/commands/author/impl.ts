import {
  buildShapeAuthoringBundle,
  generateShapeUpdateDraft,
  type ShapeAuthorContextFile
} from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { CliDiagnosticError } from "../../errors";
import { stdout } from "../../io";
import { readChangedFiles, readCliTextFile } from "../../shape-files";

export type AuthorFlags = {
  readonly changedFiles: string;
  readonly component: string;
  readonly diff?: string;
  readonly instructions?: string;
  readonly module?: string;
  readonly projectPrelude?: string;
  readonly prompt?: boolean;
  readonly shapeFiles?: string;
  readonly snippetFiles?: string;
};

type PromptInput = {
  readonly diffPath: string;
  readonly shapeFiles: string[];
};

export default async function author(this: CliContext, flags: AuthorFlags): Promise<void> {
  const promptInput = validateAuthorFlags(flags);
  const changedFiles = await readChangedFiles(flags.changedFiles);

  if (promptInput) {
    const diff = await readCliTextFile(promptInput.diffPath);
    if (diff.trim().length === 0) {
      throw new CliDiagnosticError("error: --prompt requires a non-empty unified diff.\n");
    }
    if (changedFiles.length === 0) {
      throw new CliDiagnosticError("error: --prompt requires at least one changed file.\n");
    }

    const snippetFiles = parseFileList(flags.snippetFiles);
    const existingShape = await readContextFiles(promptInput.shapeFiles);
    const relevantSnippets =
      snippetFiles.length > 0 ? await readContextFiles(snippetFiles) : undefined;
    const projectPrelude =
      flags.projectPrelude === undefined ? undefined : await readContextFile(flags.projectPrelude);
    const bundle = buildShapeAuthoringBundle({
      changedFiles,
      componentName: flags.component,
      moduleName: flags.module,
      diff,
      existingShape,
      relevantSnippets,
      projectPrelude,
      instructions: flags.instructions
    });

    stdout(this, `${bundle.authorPrompt}\n`);
    return;
  }

  stdout(
    this,
    generateShapeUpdateDraft({
      changedFiles,
      componentName: flags.component,
      moduleName: flags.module
    })
  );
}

function validateAuthorFlags(flags: AuthorFlags): PromptInput | undefined {
  if (flags.prompt) {
    if (flags.diff === undefined) {
      throw new CliDiagnosticError("error: --prompt requires --diff.\n");
    }
    const shapeFiles = parseFileList(flags.shapeFiles);
    if (shapeFiles.length === 0) {
      throw new CliDiagnosticError("error: --prompt requires --shape-files.\n");
    }
    return { diffPath: flags.diff, shapeFiles };
  }

  const promptOnlyFlag = [
    [flags.diff, "--diff"],
    [flags.instructions, "--instructions"],
    [flags.projectPrelude, "--project-prelude"],
    [flags.shapeFiles, "--shape-files"],
    [flags.snippetFiles, "--snippet-files"]
  ].find(([value]) => value !== undefined);
  if (promptOnlyFlag) {
    throw new CliDiagnosticError(`error: ${promptOnlyFlag[1]} requires --prompt.\n`);
  }

  return undefined;
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
