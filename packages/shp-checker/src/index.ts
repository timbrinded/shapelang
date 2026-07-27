export {
  analyzeSourceText,
  compareAnalyzerHintsToShape,
  formatAnalyzerWarnings,
  type AnalyzerHint,
  type AnalyzerTargetIdentity,
  type AnalyzerTargetSegment,
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
  AST_SOURCE_EXTENSIONS,
  isSourceLanguageName,
  parseSourceLanguageName,
  TREE_SITTER_NATIVE_BINDING_TARGETS,
  SOURCE_LANGUAGES,
  type AstGenerationDiagnostic,
  type AstGenerationResult,
  type AstSourceFileInput,
  type CodeAstAnchor,
  type GeneratedAstManifest,
  type GeneratedAstManifestEntry,
  type GeneratedShapeOutput,
  type GenerateShapeOptions,
  type SourceLanguageAlias,
  type SourceLanguageInput,
  type SourceLanguageName,
  type SourceSpan,
  type TreeSitterNativeBindingTarget
} from "./ast-generation.ts";
export {
  formatOnSave,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getEditorDiagnosticsForDocuments,
  getHoverText,
  type DefinitionLocation,
  type EditorDocumentDiagnostic,
  type EditorDocumentInput,
  type EditorDiagnostic
} from "./editor.ts";
export {
  checkShapeFiles,
  checkShapeModules,
  IncrementalShapeChecker,
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
  type IncrementalCheckResult,
  type IncrementalInvalidationCause,
  type IncrementalInvalidationReport,
  type IncrementalShapeDocument,
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
export { compareCodepointStrings } from "./shape-strings.ts";
