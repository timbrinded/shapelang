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
  buildCodeSemanticGraphFromAstJson,
  generateShapeFromAstJson,
  generateShapeFromCodeSemanticGraph,
  generateShapeFromSourceFiles,
  normalizeGeneratedModuleName,
  parseSourceFilesToCodeSemanticGraph,
  type AstGenerationDiagnostic,
  type AstGenerationResult,
  type AstSourceFileInput,
  type CodeAstAnchor,
  type CodeContainer,
  type CodeFunction,
  type CodeRelation,
  type CodeResource,
  type CodeSemanticGraph,
  type GeneratedShapeOutput,
  type GenerateShapeOptions,
  type RawAstFile,
  type RawAstNode,
  type SemanticConfidence,
  type SourceSpan
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
  statsShapeHypergraph,
  type CheckResult,
  type CheckOptions,
  type Fact,
  type SemanticDiagnostic,
  type ShapeDiagnostic
} from "./checker.ts";
export { formatShapeModule, formatShapeSource, type FormatResult } from "./formatter.ts";
export type { ShapeModule } from "./language/generated/ast.ts";
export { parseShapeModule, type ParseDiagnostic, type ParseShapeModuleResult } from "./parser.ts";
