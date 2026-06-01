// Public checker orchestration: the two entrypoints callers use to check Shape
// modules or files. checkShapeModules lowers the model, runs the ordered
// semantic checks, and (unless disabled) binding enforcement; checkShapeFiles
// parses files first. Individual rule logic lives in checker/rules.ts.
import type { ShapeModule } from "../language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "../parser.ts";
import type { CheckModuleInput, CheckOptions, CheckResult } from "./model.ts";
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
  const diagnostics = [
    ...model.diagnostics,
    ...runSemanticChecks(model, normalizedOptions),
    ...(normalizedOptions.enforceBindings === false
      ? []
      : checkBindings(model, normalizedOptions.changedFiles ?? []))
  ];

  return {
    ok: diagnostics.length === 0,
    exitCode: diagnostics.length === 0 ? 0 : 1,
    diagnostics,
    facts: normalizedOptions.includeFacts ? model.facts : undefined
  };
}

function normalizeCheckOptions(options: CheckOptions): CheckOptions {
  if (options.freshnessDate === undefined) {
    return options;
  }
  return {
    ...options,
    freshnessDate: requireIsoCalendarDate(options.freshnessDate, "CheckOptions.freshnessDate")
  };
}

export async function checkShapeFiles(
  paths: string[],
  options: CheckOptions = {}
): Promise<CheckResult> {
  const parsedModules: CheckModuleInput[] = [];
  const parseDiagnostics: ParseDiagnostic[] = [];

  for (const filePath of paths) {
    try {
      const source = await Bun.file(filePath).text();
      const parsed = parseShapeModule(source, filePath);
      if (parsed.ok) {
        parsedModules.push({
          module: parsed.module,
          filePath,
          origin: moduleOriginForShapeFile(parsed.module, filePath)
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

  return checkShapeModules(parsedModules, options);
}
