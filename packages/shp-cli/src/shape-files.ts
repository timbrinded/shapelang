import { Glob } from "bun";
import {
  formatDiagnostics,
  parseShapeModule,
  type ParseDiagnostic,
  type ShapeModule
} from "@shape/shp-checker";
import { CliDiagnosticError, EXIT_USAGE, errorMessage } from "./errors";

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

/**
 * Today's date as an ISO `YYYY-MM-DD` string for freshness checking. The clock
 * is read only here at the CLI boundary; the checker stays deterministic and
 * receives the date explicitly.
 */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readChangedFiles(path: string): Promise<string[]> {
  const text = await readCliTextFile(path);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function parseModules(
  paths: string[]
): Promise<{ module: ShapeModule; filePath: string }[]> {
  const modules: { module: ShapeModule; filePath: string }[] = [];
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

  if (diagnostics.length > 0) {
    throw new CliDiagnosticError(
      formatDiagnostics({ ok: false, exitCode: EXIT_USAGE, diagnostics }),
      EXIT_USAGE
    );
  }
  return modules;
}

export async function readCliTextFile(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch (error) {
    throw new CliDiagnosticError(`error: failed to read ${path}\n\n${errorMessage(error)}\n`);
  }
}
