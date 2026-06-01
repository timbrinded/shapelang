// Compatibility facade: the checker's implementation now lives in focused
// modules under checker/ (api, lowerer/lowerers, rules, derivations, symbols,
// diagnostics, query, and the shared model/display/provenance/globs helpers).
// This file re-exports the public surface so existing imports from
// "./checker.ts" — notably src/index.ts — keep working unchanged.
export { checkShapeFiles, checkShapeModules } from "./checker/api.ts";
export {
  explainShapeModules,
  graphAllShapeModules,
  graphShapeModules,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  statsShapeHypergraph
} from "./checker/query.ts";
export { formatDiagnostics } from "./checker/diagnostics.ts";
export type {
  CheckModuleInput,
  CheckModuleOrigin,
  CheckOptions,
  CheckResult,
  Fact,
  SemanticDiagnostic,
  ShapeDiagnostic
} from "./checker/model.ts";
