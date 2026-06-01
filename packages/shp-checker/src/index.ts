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
  generateShapeUpdateDraft,
  type EvidenceSpan,
  type ShapeAuthorPromptInput,
  type ShapeUpdateInput
} from "./authoring.ts";
export {
  generateShapeFromAstJson,
  generateShapeFromSourceFiles,
  isGeneratedAstManifest,
  isGeneratedAstModuleName,
  normalizeGeneratedModuleName,
  normalizeGeneratedAstPath,
  TREE_SITTER_NATIVE_BINDING_TARGETS,
  type AstGenerationDiagnostic,
  type AstGenerationResult,
  type AstSourceFileInput,
  type CodeAstAnchor,
  type GeneratedAstManifest,
  type GeneratedAstManifestEntry,
  type GeneratedShapeOutput,
  type GenerateShapeOptions,
  type SourceSpan,
  type TreeSitterNativeBindingTarget
} from "./ast-generation.ts";
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
  graphAllShapeModules,
  graphShapeModules,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  isIsoCalendarDate,
  parseIsoCalendarDate,
  requireIsoCalendarDate,
  statsShapeHypergraph,
  type CheckResult,
  type CheckModuleInput,
  type CheckModuleOrigin,
  type CheckOptions,
  type Fact,
  type SemanticDiagnostic,
  type ShapeDiagnostic,
  type IsoDateString
} from "./checker.ts";
export { formatShapeModule, formatShapeSource, type FormatResult } from "./formatter.ts";
export type { ShapeModule } from "./language/generated/ast.ts";
export { parseShapeModule, type ParseDiagnostic, type ParseShapeModuleResult } from "./parser.ts";
