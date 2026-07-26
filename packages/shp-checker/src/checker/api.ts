// Public checker orchestration: the two entrypoints callers use to check Shape
// modules or files. checkShapeModules lowers the model, runs the ordered
// semantic checks, and (unless disabled) binding enforcement; checkShapeFiles
// parses files first. Individual rule logic lives in checker/rules.ts.
import { resolve } from "node:path";
import type { ShapeModule } from "../language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "../parser.ts";
import type {
  CheckModuleInput,
  CheckOptions,
  CheckResult,
  Fact,
  Model,
  NormalizedCheckOptions,
  SemanticDiagnostic
} from "./model.ts";
import { compareCodepointStrings } from "../shape-strings.ts";
import { compareShapeDiagnostics } from "./diagnostics.ts";
import { lowerShapeModules } from "./lowerer.ts";
import { requireIsoCalendarDate } from "./iso-date.ts";
import { checkBindings, runSemanticChecks } from "./rules.ts";
import { moduleOriginForShapeFile } from "./symbols.ts";

export function checkShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  options: CheckOptions = {}
): CheckResult {
  const normalizedOptions = normalizeCheckOptions(options);
  const model = lowerShapeModules(modules);
  return checkLoweredShapeModel(model, normalizedOptions);
}

/**
 * Runs the authoritative semantic and binding pipeline over an already lowered
 * model. This is an internal reuse boundary for the incremental checker; public
 * callers should normally use {@link checkShapeModules}.
 */
export function checkLoweredShapeModel(
  model: Model,
  normalizedOptions: NormalizedCheckOptions
): CheckResult {
  const diagnostics: SemanticDiagnostic[] = [
    ...model.diagnostics,
    ...runSemanticChecks(model, normalizedOptions),
    ...(normalizedOptions.enforceBindings === false
      ? []
      : checkBindings(model, normalizedOptions.changedFiles ?? [], normalizedOptions.repoRoot))
  ].map((diagnostic) =>
    normalizedOptions.allowUnknownEffects && diagnostic.kind === "unknown_effects"
      ? { ...diagnostic, severity: "warning" }
      : diagnostic
  );
  const ok = diagnostics.every(
    (diagnostic) => diagnostic.kind === "unknown_effects" && diagnostic.severity === "warning"
  );

  return {
    ok,
    exitCode: ok ? 0 : 1,
    diagnostics: diagnostics.toSorted(compareShapeDiagnostics),
    facts: normalizedOptions.includeFacts ? model.facts.toSorted(compareFacts) : undefined
  };
}

function compareFacts(left: Fact, right: Fact): number {
  return compareCodepointStrings(JSON.stringify(left), JSON.stringify(right));
}

/** @internal Shared by the full and incremental checker entrypoints. */
export function normalizeCheckOptions(options: CheckOptions): NormalizedCheckOptions {
  return {
    ...options,
    repoRoot: resolve(options.repoRoot ?? process.cwd()),
    freshnessDate:
      options.freshnessDate === undefined
        ? undefined
        : requireIsoCalendarDate(options.freshnessDate, "CheckOptions.freshnessDate")
  };
}

export async function checkShapeFiles(
  paths: string[],
  options: CheckOptions = {}
): Promise<CheckResult> {
  const parsedModules: { module: ShapeModule; filePath: string }[] = [];
  const parseDiagnostics: ParseDiagnostic[] = [];

  for (const filePath of paths) {
    try {
      const source = await Bun.file(filePath).text();
      const parsed = parseShapeModule(source, filePath);
      if (parsed.ok) {
        parsedModules.push({
          module: parsed.module,
          filePath
        });
      } else {
        parseDiagnostics.push(...parsed.diagnostics);
      }
    } catch (error) {
      parseDiagnostics.push({
        kind: "parse",
        filePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (parseDiagnostics.length > 0) {
    return {
      ok: false,
      exitCode: 2,
      diagnostics: parseDiagnostics
    };
  }

  const normalizedOptions = normalizeCheckOptions(options);
  return checkShapeModules(
    parsedModules.map(({ module, filePath }) => ({
      module,
      filePath,
      origin: moduleOriginForShapeFile(module, filePath, normalizedOptions.repoRoot)
    })),
    normalizedOptions
  );
}
