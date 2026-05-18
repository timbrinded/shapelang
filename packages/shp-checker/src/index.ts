export {
  analyzeSourceText,
  compareAnalyzerHintsToShape,
  formatAnalyzerWarnings,
  type AnalyzerHint,
  type AnalyzerWarning
} from "./analyzer.ts";
export {
  buildShapeAuthorPrompt,
  buildShapeCriticPrompt,
  extractEvidenceSpansFromUnifiedDiff,
  generateShapeDelta,
  type EvidenceSpan,
  type ShapeAuthorPromptInput,
  type ShapeDeltaInput
} from "./authoring.ts";
export {
  formatOnSave,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText,
  type DefinitionLocation,
  type EditorDiagnostic
} from "./editor.ts";
export {
  checkShapeFiles,
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  graphShapeModules,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  type CheckResult,
  type CheckOptions,
  type Fact,
  type SemanticDiagnostic,
  type ShapeDiagnostic
} from "./checker.ts";
export { formatShapeModule, formatShapeSource, type FormatResult } from "./formatter.ts";
export type { ShapeModule } from "./language/generated/ast.ts";
export { parseShapeModule, type ParseDiagnostic, type ParseShapeModuleResult } from "./parser.ts";
