import type { ShapeModule } from "./language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "./parser.ts";

export type LoadedShapeModule = { module: ShapeModule; filePath: string };

export type LoadedShapeModulesResult = {
  modules: LoadedShapeModule[];
  diagnostics: ParseDiagnostic[];
};

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
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { modules, diagnostics };
}
