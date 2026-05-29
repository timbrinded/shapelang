import { inferAstSourceLanguageFromPath } from "./source-languages.ts";
import { loadTreeSitterProvider } from "./ast-generation-tree-sitter.ts";

import type {
  AstGenerationDiagnostic,
  AstGenerationResult,
  AstSourceFileInput,
  CodeSemanticGraph,
  TreeSitterParseProvider
} from "./ast-generation-types.ts";
import { createEmptyCodeSemanticGraph } from "./ast-generation-graph.ts";
import { addSemanticProjection } from "./ast-generation-semantic.ts";
import {
  nodeHasError,
  normalizeTreeSitterFile,
  rootNodeFromTree
} from "./ast-generation-tree-sitter-normalize.ts";
import { errorMessage, normalizeLanguageName } from "./ast-generation-utils.ts";

export async function parseSourceFilesToCodeSemanticGraph(
  files: AstSourceFileInput[],
  options: {
    allowParseErrors?: boolean;
    parserProvider?: TreeSitterParseProvider;
  } = {}
): Promise<AstGenerationResult<CodeSemanticGraph>> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const graph = createEmptyCodeSemanticGraph();
  const providerResult = options.parserProvider
    ? { ok: true as const, provider: options.parserProvider }
    : await loadTreeSitterProvider();

  if (!providerResult.ok) {
    return providerResult;
  }

  for (const file of files) {
    const language = normalizeLanguageName(
      file.language ?? inferAstSourceLanguageFromPath(file.path)
    );
    if (!language) {
      diagnostics.push({
        kind: "error",
        code: "unknown_language",
        path: file.path,
        message: `could not infer a parser language for ${file.path}; pass --language LANG`
      });
      continue;
    }

    let tree: unknown;
    try {
      tree = await providerResult.provider(language, file.source);
    } catch (error) {
      diagnostics.push({
        kind: "error",
        code: "parse_failed",
        path: file.path,
        message: errorMessage(error)
      });
      continue;
    }

    const root = rootNodeFromTree(tree);
    if (!root) {
      diagnostics.push({
        kind: "error",
        code: "parse_failed",
        path: file.path,
        message: `parser for ${language} did not return a tree root`
      });
      continue;
    }

    const fileGraph = normalizeTreeSitterFile(file.path, language, file.source, root);
    graph.files.push(...fileGraph.files);
    graph.rawNodes.push(...fileGraph.rawNodes);
    diagnostics.push(...fileGraph.diagnostics);

    if (!options.allowParseErrors && nodeHasError(root)) {
      diagnostics.push({
        kind: "error",
        code: "parse_error",
        path: file.path,
        message: `${file.path} contains Tree-sitter ERROR or MISSING nodes`
      });
    }
  }

  graph.diagnostics.push(...diagnostics);
  const errors = diagnostics.filter((diagnostic) => diagnostic.kind === "error");
  if (errors.length > 0) {
    return { ok: false, diagnostics };
  }

  addSemanticProjection(graph);
  if (graph.diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics: graph.diagnostics };
  }
  return { ok: true, value: graph, diagnostics: graph.diagnostics };
}
