import type { CodeSemanticGraph } from "./ast-generation-types.ts";

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
