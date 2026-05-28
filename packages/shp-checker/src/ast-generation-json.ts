import { inferAstSourceLanguageFromPath } from "./source-languages.ts";

import type {
  AstGenerationDiagnostic,
  AstGenerationResult,
  CodeSemanticGraph,
  SourceSpan
} from "./ast-generation-types.ts";
import { createEmptyCodeSemanticGraph } from "./ast-generation-graph.ts";
import { addSemanticProjection } from "./ast-generation-semantic.ts";
import {
  booleanProperty,
  hasNonScalarRecordEntry,
  isRecord,
  normalizeLanguageName,
  scalarRecordProperty,
  spanProperty,
  stableHash,
  stableShapeId,
  stringProperty
} from "./ast-generation-utils.ts";

type JsonAstInput = {
  module?: string;
  language?: string;
  files: JsonAstFile[];
};

type JsonAstFile = {
  path: string;
  language?: string;
  root: string;
  nodes: JsonAstNode[];
};

type JsonAstNode = {
  id: string;
  kind: string;
  named?: boolean;
  span?: SourceSpan;
  text?: string;
  textHash?: string;
  attributes?: Record<string, string | number | boolean | null>;
  children?: JsonAstChild[];
};

type JsonAstChild = {
  id: string;
  field?: string;
};

type ChildEdge = {
  parentId: string;
  childId: string;
  index: number;
  fieldName?: string;
};

export function buildCodeSemanticGraphFromAstJson(
  value: unknown
): AstGenerationResult<CodeSemanticGraph> {
  const parsed = parseJsonAstInput(value);
  if (!parsed.ok) {
    return parsed;
  }

  const graph = createEmptyCodeSemanticGraph();
  const diagnostics: AstGenerationDiagnostic[] = [];
  for (const file of parsed.value.files) {
    const fileResult = normalizeJsonAstFile(file, parsed.value.language);
    if (fileResult.ok) {
      graph.files.push(...fileResult.value.files);
      graph.rawNodes.push(...fileResult.value.rawNodes);
    }
    diagnostics.push(...fileResult.diagnostics);
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

function normalizeJsonAstFile(
  file: JsonAstFile,
  fallbackLanguage: string | undefined
): AstGenerationResult<Pick<CodeSemanticGraph, "files" | "rawNodes">> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const language = normalizeLanguageName(
    file.language ?? fallbackLanguage ?? inferAstSourceLanguageFromPath(file.path)
  );
  if (!language) {
    diagnostics.push({
      kind: "error",
      code: "unknown_language",
      path: file.path,
      message: `missing language for ${file.path}`
    });
  }

  const nodeByParserId = new Map<string, JsonAstNode>();
  for (const node of file.nodes) {
    if (nodeByParserId.has(node.id)) {
      diagnostics.push({
        kind: "error",
        code: "duplicate_node_id",
        path: file.path,
        nodeId: node.id,
        message: `duplicate AST node id ${node.id}`
      });
    }
    nodeByParserId.set(node.id, node);
  }

  if (!nodeByParserId.has(file.root)) {
    diagnostics.push({
      kind: "error",
      code: "missing_root",
      path: file.path,
      nodeId: file.root,
      message: `root AST node ${file.root} is not declared`
    });
  }

  const edges: ChildEdge[] = [];
  const parentByChild = new Map<string, string>();
  for (const node of file.nodes) {
    node.children?.forEach((child, index) => {
      if (!nodeByParserId.has(child.id)) {
        diagnostics.push({
          kind: "error",
          code: "missing_child",
          path: file.path,
          nodeId: child.id,
          message: `${node.id} references missing child ${child.id}`
        });
        return;
      }
      const existingParent = parentByChild.get(child.id);
      if (existingParent && existingParent !== node.id) {
        diagnostics.push({
          kind: "error",
          code: "multiple_parents",
          path: file.path,
          nodeId: child.id,
          message: `${child.id} has multiple parents: ${existingParent} and ${node.id}`
        });
      }
      parentByChild.set(child.id, node.id);
      edges.push({ parentId: node.id, childId: child.id, index, fieldName: child.field });
    });
  }

  const reachable = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: { parserId: string; leaving: boolean }[] = [{ parserId: file.root, leaving: false }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }
    if (frame.leaving) {
      visiting.delete(frame.parserId);
      visited.add(frame.parserId);
      continue;
    }
    if (visiting.has(frame.parserId)) {
      diagnostics.push({
        kind: "error",
        code: "cycle",
        path: file.path,
        nodeId: frame.parserId,
        message: `AST child graph contains a cycle at ${frame.parserId}`
      });
      continue;
    }
    if (visited.has(frame.parserId)) {
      continue;
    }
    visiting.add(frame.parserId);
    reachable.add(frame.parserId);
    stack.push({ parserId: frame.parserId, leaving: true });
    const node = nodeByParserId.get(frame.parserId);
    const children = node?.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        stack.push({ parserId: child.id, leaving: false });
      }
    }
  }

  for (const node of file.nodes) {
    if (!reachable.has(node.id)) {
      diagnostics.push({
        kind: "error",
        code: "unreachable_node",
        path: file.path,
        nodeId: node.id,
        message: `AST node ${node.id} is not reachable from root ${file.root}`
      });
    }
  }

  const nestedAttribute = file.nodes.find((node) =>
    Object.values(node.attributes ?? {}).some(
      (attribute) => typeof attribute === "object" && attribute !== null
    )
  );
  if (nestedAttribute) {
    diagnostics.push({
      kind: "error",
      code: "nested_attribute",
      path: file.path,
      nodeId: nestedAttribute.id,
      message: `AST node ${nestedAttribute.id} has a nested attribute; represent nested structure as child nodes`
    });
  }

  if (diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics };
  }

  const fileId = stableShapeId(`file_${file.path}`, "File");
  const rawNodes = file.nodes.map((node) => {
    const edge = edges.find((candidate) => candidate.childId === node.id);
    const name = node.attributes?.name;
    return {
      id: stableShapeId(`${file.path}_${node.id}_${node.kind}`, "AstNode"),
      parserId: node.id,
      path: file.path,
      language: language ?? "file",
      kind: node.kind,
      named: node.named ?? true,
      parentId:
        edge !== undefined
          ? stableShapeId(
              `${file.path}_${edge.parentId}_${nodeByParserId.get(edge.parentId)?.kind ?? "node"}`,
              "AstNode"
            )
          : undefined,
      childIndex: edge?.index,
      fieldName: edge?.fieldName,
      span: node.span,
      textHash: node.textHash ?? (node.text ? stableHash(node.text) : undefined),
      text: node.text,
      attributes: node.attributes,
      semanticLabel: typeof name === "string" ? name : undefined
    };
  });

  return {
    ok: true,
    value: {
      files: [
        {
          id: fileId,
          path: file.path,
          language: language ?? "file",
          rootNodeId: stableShapeId(
            `${file.path}_${file.root}_${nodeByParserId.get(file.root)?.kind ?? "root"}`,
            "AstNode"
          ),
          parser: "json"
        }
      ],
      rawNodes
    },
    diagnostics
  };
}

function parseJsonAstInput(value: unknown): AstGenerationResult<JsonAstInput> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [
        { kind: "error", code: "invalid_json_ast", message: "AST JSON input must be an object" }
      ]
    };
  }

  const filesValue = value.files;
  if (!Array.isArray(filesValue)) {
    return {
      ok: false,
      diagnostics: [
        { kind: "error", code: "invalid_json_ast", message: "AST JSON input must contain files[]" }
      ]
    };
  }

  const files: JsonAstFile[] = [];
  filesValue.forEach((fileValue, fileIndex) => {
    if (!isRecord(fileValue)) {
      diagnostics.push({
        kind: "error",
        code: "invalid_file",
        message: `files[${fileIndex}] must be an object`
      });
      return;
    }
    const path = stringProperty(fileValue, "path");
    const root = stringProperty(fileValue, "root");
    const nodesValue = fileValue.nodes;
    if (!path || !root || !Array.isArray(nodesValue)) {
      diagnostics.push({
        kind: "error",
        code: "invalid_file",
        message: `files[${fileIndex}] must include path, root, and nodes[]`
      });
      return;
    }
    const nodes: JsonAstNode[] = [];
    nodesValue.forEach((nodeValue, nodeIndex) => {
      if (!isRecord(nodeValue)) {
        diagnostics.push({
          kind: "error",
          code: "invalid_node",
          path,
          message: `nodes[${nodeIndex}] must be an object`
        });
        return;
      }
      const id = stringProperty(nodeValue, "id");
      const kind = stringProperty(nodeValue, "kind");
      if (!id || !kind) {
        diagnostics.push({
          kind: "error",
          code: "invalid_node",
          path,
          message: `nodes[${nodeIndex}] must include id and kind`
        });
        return;
      }
      const childrenValue = nodeValue.children;
      const children: JsonAstChild[] = [];
      if (Array.isArray(childrenValue)) {
        childrenValue.forEach((childValue, childIndex) => {
          if (typeof childValue === "string") {
            children.push({ id: childValue });
          } else if (isRecord(childValue) && stringProperty(childValue, "id")) {
            children.push({
              id: stringProperty(childValue, "id") ?? "",
              field: stringProperty(childValue, "field")
            });
          } else {
            diagnostics.push({
              kind: "error",
              code: "invalid_child",
              path,
              nodeId: id,
              message: `children[${childIndex}] for ${id} must be a string or { id }`
            });
          }
        });
      }
      if (hasNonScalarRecordEntry(nodeValue, "attributes")) {
        diagnostics.push({
          kind: "error",
          code: "nested_attribute",
          path,
          nodeId: id,
          message: `AST node ${id} has a nested attribute; represent nested structure as child nodes`
        });
      }
      nodes.push({
        id,
        kind,
        named: booleanProperty(nodeValue, "named"),
        span: spanProperty(nodeValue, "span"),
        text: stringProperty(nodeValue, "text"),
        textHash: stringProperty(nodeValue, "textHash"),
        attributes: scalarRecordProperty(nodeValue, "attributes"),
        children
      });
    });
    files.push({
      path,
      root,
      language: stringProperty(fileValue, "language"),
      nodes
    });
  });

  if (diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    value: {
      module: stringProperty(value, "module"),
      language: stringProperty(value, "language"),
      files
    },
    diagnostics
  };
}
