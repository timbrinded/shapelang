import {
  generateShapeFromAstJson,
  generateShapeFromSourceFiles,
  normalizeGeneratedModuleName,
  type AstGenerationDiagnostic,
  type AstSourceFileInput,
  type GenerateShapeOptions
} from "@shape/shp-checker";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { CliContext } from "../../context";
import { CliDiagnosticError, EXIT_FAILURE, EXIT_USAGE, errorMessage } from "../../errors";
import { stdout } from "../../io";
import { readCliTextFile } from "../../shape-files";

type AstOutputFlags = {
  readonly module?: string;
  readonly includeAstLayer?: boolean;
  readonly rawOut?: string;
};

type GeneratedAstManifestEntry = {
  module: string;
  path: string;
  sources: string[];
};

export type AstSourceFlags = AstOutputFlags & {
  readonly language?: string;
  readonly allowParseErrors?: boolean;
  readonly outDir?: string;
  readonly check?: boolean;
};

export type AstJsonFlags = AstOutputFlags;

export async function astSource(
  this: CliContext,
  flags: AstSourceFlags,
  ...sourcePaths: string[]
): Promise<void> {
  if (flags.outDir) {
    await writeGeneratedAstDirectory.call(this, flags, sourcePaths);
    return;
  }
  if (flags.check) {
    throw new CliDiagnosticError("error: --check requires --out-dir\n", EXIT_USAGE);
  }

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

async function writeGeneratedAstDirectory(
  this: CliContext,
  flags: AstSourceFlags,
  sourcePaths: string[]
): Promise<void> {
  if (flags.rawOut) {
    throw new CliDiagnosticError(
      "error: --out-dir and --raw-out cannot be used together\n",
      EXIT_USAGE
    );
  }
  if (flags.includeAstLayer) {
    throw new CliDiagnosticError(
      "error: --out-dir writes semantic AST drafts only; use --raw-out without --out-dir for raw traces\n",
      EXIT_USAGE
    );
  }

  const outDir = flags.outDir ?? "";
  const moduleBase = flags.module ?? "shape.generated.ast";
  if (!isGeneratedAstModuleName(moduleBase)) {
    throw new CliDiagnosticError(
      "error: --out-dir module base must be shape.generated.ast or a child module\n",
      EXIT_USAGE
    );
  }
  const manifestEntries: GeneratedAstManifestEntry[] = [];
  const writes: { path: string; contents: string }[] = [];

  for (const sourcePath of sourcePaths) {
    const file = {
      path: sourcePath,
      source: await readCliTextFile(sourcePath),
      language: flags.language
    };
    const relativeSourcePath = generatedRelativeSourcePath(sourcePath);
    const moduleName = normalizeGeneratedModuleName(
      `${moduleBase}.${sourcePathToModuleSuffix(relativeSourcePath)}`
    );
    const result = await generateShapeFromSourceFiles([file], {
      moduleName,
      allowParseErrors: flags.allowParseErrors
    });
    if (!result.ok) {
      throw new CliDiagnosticError(
        formatAstDiagnostics(result.diagnostics),
        diagnosticsExitCode(result.diagnostics)
      );
    }
    const outputPath = join(outDir, `${relativeSourcePath.replace(/\.[^/.]+$/, "")}.shape`);
    writes.push({ path: outputPath, contents: result.value.semanticShape });
    manifestEntries.push({
      module: moduleName,
      path: outputPath,
      sources: [relativeSourcePath]
    });
  }

  const manifestPath = join(outDir, "manifest.json");
  writes.push({
    path: manifestPath,
    contents: `${JSON.stringify({ version: 1, generatedAt: "deterministic", entries: manifestEntries }, null, 2)}\n`
  });

  if (flags.check) {
    const stale = await changedGeneratedFiles(writes);
    if (stale.length > 0) {
      throw new CliDiagnosticError(
        `error: generated AST Shape files are stale\n\n${stale.map((path) => `  ${path}`).join("\n")}\n`,
        EXIT_FAILURE
      );
    }
    stdout(this, `Generated AST Shape files are up to date in ${outDir}.\n`);
    return;
  }

  for (const write of writes) {
    await mkdir(dirname(write.path), { recursive: true });
    await Bun.write(write.path, write.contents);
  }
  stdout(this, `Wrote ${manifestEntries.length} generated AST Shape file(s) to ${outDir}.\n`);
}

function generatedRelativeSourcePath(sourcePath: string): string {
  const relativePath = sourcePath.startsWith("/")
    ? relative(process.cwd(), sourcePath)
    : sourcePath;
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new CliDiagnosticError(
      `error: --out-dir source path must be inside the current workspace: ${sourcePath}\n`,
      EXIT_USAGE
    );
  }
  return normalized;
}

function isGeneratedAstModuleName(moduleName: string): boolean {
  return moduleName === "shape.generated.ast" || moduleName.startsWith("shape.generated.ast.");
}

function sourcePathToModuleSuffix(sourcePath: string): string {
  return sourcePath
    .replace(/\.[^/.]+$/, "")
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.replace(/[^A-Za-z0-9_]/g, "_"))
    .map((part) => (/^[A-Za-z_]/.test(part) ? part : `_${part}`))
    .join(".");
}

async function changedGeneratedFiles(
  writes: { path: string; contents: string }[]
): Promise<string[]> {
  const changed: string[] = [];
  for (const write of writes) {
    try {
      const existing = await readFile(write.path, "utf8");
      if (existing !== write.contents) {
        changed.push(write.path);
      }
    } catch {
      changed.push(write.path);
    }
  }
  return changed;
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
