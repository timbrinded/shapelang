import {
  generateShapeFromAstJson,
  generateShapeFromSourceFiles,
  type AstGenerationDiagnostic,
  type AstSourceFileInput,
  type GenerateShapeOptions
} from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { CliDiagnosticError, EXIT_FAILURE, EXIT_USAGE, errorMessage } from "../../errors";
import { stdout } from "../../io";
import { readCliTextFile } from "../../shape-files";

type AstOutputFlags = {
  readonly module?: string;
  readonly includeAstLayer?: boolean;
  readonly rawOut?: string;
};

export type AstSourceFlags = AstOutputFlags & {
  readonly language?: string;
  readonly allowParseErrors?: boolean;
};

export type AstJsonFlags = AstOutputFlags;

export async function astSource(
  this: CliContext,
  flags: AstSourceFlags,
  ...sourcePaths: string[]
): Promise<void> {
  const outputOptions = shapeOptions(flags);
  const files: AstSourceFileInput[] = [];
  for (const path of sourcePaths) {
    files.push({
      path,
      source: await readCliTextFile(path),
      language: flags.language
    });
  }

  const result = await generateShapeFromSourceFiles(files, {
    ...outputOptions,
    allowParseErrors: flags.allowParseErrors
  });
  if (!result.ok) {
    throw new CliDiagnosticError(
      formatAstDiagnostics(result.diagnostics),
      diagnosticsExitCode(result.diagnostics)
    );
  }

  await writeOutput.call(this, flags, result.value.semanticShape, result.value.rawShape);
}

export async function astJson(
  this: CliContext,
  flags: AstJsonFlags,
  ...jsonPaths: string[]
): Promise<void> {
  const outputOptions = shapeOptions(flags);
  if (jsonPaths.length !== 1) {
    throw new CliDiagnosticError("error: `shp ast json` expects exactly one AST JSON file\n");
  }

  let astJsonValue: unknown;
  const [jsonPath] = jsonPaths;
  try {
    astJsonValue = JSON.parse(await readCliTextFile(jsonPath ?? ""));
  } catch (error) {
    throw new CliDiagnosticError(`error: failed to parse ${jsonPath}\n\n${errorMessage(error)}\n`);
  }

  const result = generateShapeFromAstJson(astJsonValue, outputOptions);
  if (!result.ok) {
    throw new CliDiagnosticError(
      formatAstDiagnostics(result.diagnostics),
      diagnosticsExitCode(result.diagnostics)
    );
  }

  await writeOutput.call(this, flags, result.value.semanticShape, result.value.rawShape);
}

function shapeOptions(flags: AstOutputFlags): GenerateShapeOptions {
  if (flags.includeAstLayer && flags.rawOut) {
    throw new CliDiagnosticError(
      "error: --include-ast-layer and --raw-out cannot be used together\n",
      EXIT_USAGE
    );
  }

  return {
    moduleName: flags.module,
    includeAstLayer: flags.includeAstLayer === true,
    rawModuleName: flags.rawOut ? `${flags.module ?? "generated.ast"}.raw` : undefined
  };
}

async function writeOutput(
  this: CliContext,
  flags: AstOutputFlags,
  semanticShape: string,
  rawShape: string | undefined
): Promise<void> {
  if (flags.rawOut) {
    if (!rawShape) {
      throw new CliDiagnosticError(
        "error: --raw-out requested but raw AST output was not generated\n",
        EXIT_USAGE
      );
    }
    await Bun.write(flags.rawOut, rawShape);
  }
  stdout(this, semanticShape);
}

function formatAstDiagnostics(diagnostics: AstGenerationDiagnostic[]): string {
  const lines = diagnostics.map((diagnostic) => {
    const location = diagnostic.path
      ? `${diagnostic.path}${diagnostic.nodeId ? `:${diagnostic.nodeId}` : ""}: `
      : "";
    return `${diagnostic.kind} ${diagnostic.code}: ${location}${diagnostic.message}`;
  });
  return `error: AST generation failed\n\n${lines.join("\n")}\n`;
}

function diagnosticsExitCode(diagnostics: AstGenerationDiagnostic[]): number {
  return diagnostics.some(
    (diagnostic) => diagnostic.code === "parse_error" || diagnostic.code === "parse_failed"
  )
    ? EXIT_FAILURE
    : EXIT_USAGE;
}
