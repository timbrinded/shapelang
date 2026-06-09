export {
  bundledTreeSitterParserAssetRoot,
  bundledTreeSitterParserLibsDir,
  configureBundledTreeSitterParsers,
  detectLinuxMuslRuntime,
  treeSitterParserLibraryName,
  BUNDLED_TREE_SITTER_LANGUAGES,
  TREE_SITTER_LANGUAGE_PACK_VERSION
} from "./ast-generation-tree-sitter.ts";
export { buildCodeSemanticGraphFromAstJson } from "./ast-generation-json.ts";
export { parseSourceFilesToCodeSemanticGraph } from "./ast-generation-source.ts";
export {
  generateShapeFromAstJson,
  generateShapeFromCodeSemanticGraph,
  generateShapeFromSourceFiles,
  normalizeGeneratedModuleName
} from "./ast-generation-render.ts";
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
export {
  AST_SOURCE_EXTENSIONS,
  SOURCE_LANGUAGES,
  isSourceLanguageName,
  parseSourceLanguageName,
  type SourceLanguageAlias,
  type SourceLanguageInput,
  type SourceLanguageName
} from "./source-languages.ts";
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
} from "./ast-generation-types.ts";
