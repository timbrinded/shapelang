import { Glob } from "bun";
import {
  formatDiagnostics,
  parseShapeModule,
  type CheckModuleInput,
  type ParseDiagnostic,
  type ShapeModule
} from "@shape/shp-checker";
import { CliDiagnosticError, EXIT_USAGE, errorMessage } from "./errors";

export type LoadedShapeModule = { module: ShapeModule; filePath: string };

export type LoadedShapeModulesResult = {
  modules: LoadedShapeModule[];
  diagnostics: ParseDiagnostic[];
};

export async function defaultShapeFiles(): Promise<string[]> {
  const patterns = ["shape/**/*.shape"];
  const files = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
      files.add(file);
    }
  }
  return [...files].sort();
}

export async function readChangedFiles(path: string): Promise<string[]> {
  const text = await readCliTextFile(path);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function providedOrDefaultShapeFiles(
  providedFiles: readonly string[]
): Promise<string[]> {
  return providedFiles.length > 0 ? [...providedFiles] : await defaultShapeFiles();
}

export async function loadShapeModules(
  paths: readonly string[]
): Promise<LoadedShapeModulesResult> {
  const modules: LoadedShapeModule[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  for (const filePath of paths) {
    try {
      const parsed = parseShapeModule(await Bun.file(filePath).text(), filePath);
      if (parsed.ok) {
        modules.push({ module: parsed.module, filePath });
      } else {
        diagnostics.push(...parsed.diagnostics);
      }
    } catch (error) {
      diagnostics.push({
        kind: "parse",
        filePath,
        message: errorMessage(error)
      });
    }
  }
  return { modules, diagnostics };
}

export async function parseModules(paths: readonly string[]): Promise<LoadedShapeModule[]> {
  const result = await loadShapeModules(paths);
  if (result.diagnostics.length > 0) {
    throw new CliDiagnosticError(
      formatDiagnostics({ ok: false, exitCode: EXIT_USAGE, diagnostics: result.diagnostics }),
      EXIT_USAGE
    );
  }
  return result.modules;
}

export async function parseProvidedOrDefaultModules(
  providedFiles: readonly string[]
): Promise<CheckModuleInput[]> {
  return parseModules(await providedOrDefaultShapeFiles(providedFiles));
}

export async function readCliTextFile(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch (error) {
    throw new CliDiagnosticError(`error: failed to read ${path}\n\n${errorMessage(error)}\n`);
  }
}
