export {
  buildCodeSemanticGraphFromAstJson,
  bundledTreeSitterParserAssetRoot,
  bundledTreeSitterParserLibsDir,
  configureBundledTreeSitterParsers,
  detectLinuxMuslRuntime,
  generateShapeFromAstJson,
  generateShapeFromCodeSemanticGraph,
  generateShapeFromSourceFiles,
  normalizeGeneratedModuleName,
  parseSourceFilesToCodeSemanticGraph,
  treeSitterParserLibraryName,
  BUNDLED_TREE_SITTER_LANGUAGES,
  TREE_SITTER_LANGUAGE_PACK_VERSION
} from "./ast-generation-core.ts";
export {
  GENERATED_AST_MANIFEST_FILE,
  GENERATED_AST_MODULE_BASE,
  isGeneratedAstManifest,
  isGeneratedAstModuleName,
  normalizeGeneratedAstPath,
  type GeneratedAstManifest,
  type GeneratedAstManifestEntry
} from "./generated-ast-policy.ts";
export {
  TREE_SITTER_NATIVE_BINDING_TARGETS,
  currentTreeSitterNativeBindingTarget,
  treeSitterNativePackageSpecifiers,
  type TreeSitterNativeBindingTarget
} from "./tree-sitter-native-targets.ts";
export type {
  AstGenerationDiagnostic,
  AstGenerationResult,
  AstSourceFileInput,
  CodeAstAnchor,
  CodeContainer,
  CodeFunction,
  CodeRelation,
  CodeResource,
  CodeSemanticGraph,
  GeneratedShapeOutput,
  GenerateShapeOptions,
  RawAstFile,
  RawAstNode,
  SemanticConfidence,
  SourceSpan,
  TreeSitterParseProvider
} from "./ast-generation-core.ts";
