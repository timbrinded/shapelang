import { inferAstSourceLanguageFromPath } from "./source-languages.ts";
import { loadTreeSitterProvider } from "./ast-generation-tree-sitter.ts";

import type {
  AstGenerationResult,
  AstSourceFileInput,
  CodeSemanticGraph,
  TreeSitterParseProvider
} from "./ast-generation-types.ts";
import { createEmptyCodeSemanticGraph, finalizeCodeSemanticGraph } from "./ast-generation-graph.ts";
import {
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
  const graph = createEmptyCodeSemanticGraph();
  const diagnostics = graph.diagnostics;
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

    const fileGraph = normalizeTreeSitterFile(
      file.path,
      language,
      file.source,
      root,
      !options.allowParseErrors
    );
    graph.files.push(...fileGraph.files);
    graph.rawNodes.push(...fileGraph.rawNodes);
    diagnostics.push(...fileGraph.diagnostics);
  }

  return finalizeCodeSemanticGraph(graph);
}
