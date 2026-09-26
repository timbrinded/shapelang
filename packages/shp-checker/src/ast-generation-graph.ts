import type { AstGenerationResult, CodeSemanticGraph } from "./ast-generation-types.ts";
import { addSemanticProjection } from "./ast-generation-semantic.ts";

export function createEmptyCodeSemanticGraph(): CodeSemanticGraph {
  return {
    files: [],
    rawNodes: [],
    containers: [],
    functions: [],
    resources: [],
    anchors: [],
    relations: [],
    candidateEffects: [],
    diagnostics: []
  };
}

export function finalizeCodeSemanticGraph(
  graph: CodeSemanticGraph
): AstGenerationResult<CodeSemanticGraph> {
  const diagnostics = graph.diagnostics;
  if (diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics };
  }
  addSemanticProjection(graph);
  return diagnostics.some((diagnostic) => diagnostic.kind === "error")
    ? { ok: false, diagnostics }
    : { ok: true, value: graph, diagnostics };
}
