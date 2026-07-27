// Compatibility facade: the checker's implementation now lives in focused
// modules under checker/ (api, lowerer, lowering/*, rules/*, derivations,
// symbols, diagnostics, query, and shared model/display/provenance/globs
// helpers).
// This file re-exports the public surface so existing imports from
// "./checker.ts" — notably src/index.ts — keep working unchanged.
export { checkShapeFiles, checkShapeModules } from "./checker/api.ts";
export {
  IncrementalShapeChecker,
  type IncrementalCheckResult,
  type IncrementalInvalidationCause,
  type IncrementalInvalidationReport,
  type IncrementalShapeDocument
} from "./checker/incremental.ts";
export {
  explainShapeModules,
  graphAllShapeModules,
  graphShapeModules,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  statsShapeHypergraph
} from "./checker/query.ts";
export { formatDiagnostics } from "./checker/diagnostics.ts";
export {
  isIsoCalendarDate,
  parseIsoCalendarDate,
  requireIsoCalendarDate,
  type IsoDateString
} from "./checker/iso-date.ts";
export type {
  CheckModuleInput,
  CheckModuleOrigin,
  CheckOptions,
  CheckResult,
  Fact,
  SemanticDiagnostic,
  ShapeDiagnostic
} from "./checker/model.ts";
