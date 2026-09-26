import { inferAstSourceLanguageFromPath } from "./source-languages.ts";

import type {
  AstGenerationDiagnostic,
  AstGenerationResult,
  CodeSemanticGraph
} from "./ast-generation-types.ts";
import { createEmptyCodeSemanticGraph, finalizeCodeSemanticGraph } from "./ast-generation-graph.ts";
import {
  astError,
  astErrorReporter,
  astFailure,
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

type JsonAstFile = {
  path: string;
  language?: string;
  root: string;
  nodes: JsonAstNode[];
};

type JsonAstNode = NonNullable<ReturnType<typeof parseJsonAstNode>>;

type JsonAstChild = {
  id: string;
  field?: string;
};

type ChildEdge = {
  parentId: string;
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
  for (const file of parsed.value.files) {
    const fileResult = normalizeJsonAstFile(file, parsed.value.language);
    if (fileResult.ok) {
      graph.files.push(...fileResult.value.files);
      graph.rawNodes.push(...fileResult.value.rawNodes);
    }
    graph.diagnostics.push(...fileResult.diagnostics);
  }

  return finalizeCodeSemanticGraph(graph);
}

function normalizeJsonAstFile(
  file: JsonAstFile,
  fallbackLanguage: string | undefined
): AstGenerationResult<Pick<CodeSemanticGraph, "files" | "rawNodes">> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const reportError = astErrorReporter(diagnostics, file.path);
  const language = normalizeLanguageName(
    file.language ?? fallbackLanguage ?? inferAstSourceLanguageFromPath(file.path)
  );
  if (!language) {
    reportError("unknown_language", `missing language for ${file.path}`);
  }

  const nodeByParserId = new Map<string, JsonAstNode>();
  for (const node of file.nodes) {
    if (nodeByParserId.has(node.id)) {
      reportError("duplicate_node_id", `duplicate AST node id ${node.id}`, node.id);
    }
    nodeByParserId.set(node.id, node);
  }

  if (!nodeByParserId.has(file.root)) {
    reportError("missing_root", `root AST node ${file.root} is not declared`, file.root);
  }

  const parentByChild = new Map<string, ChildEdge>();
  for (const node of file.nodes) {
    node.children.forEach((child, index) => {
      if (!nodeByParserId.has(child.id)) {
        reportError("missing_child", `${node.id} references missing child ${child.id}`, child.id);
        return;
      }
      const existingParent = parentByChild.get(child.id);
      if (existingParent && existingParent.parentId !== node.id) {
        reportError(
          "multiple_parents",
          `${child.id} has multiple parents: ${existingParent.parentId} and ${node.id}`,
          child.id
        );
      }
      if (!existingParent || existingParent.parentId !== node.id) {
        parentByChild.set(child.id, { parentId: node.id, index, fieldName: child.field });
      }
    });
  }

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
      reportError("cycle", `AST child graph contains a cycle at ${frame.parserId}`, frame.parserId);
      continue;
    }
    if (visited.has(frame.parserId)) {
      continue;
    }
    visiting.add(frame.parserId);
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
    if (!visited.has(node.id)) {
      reportError(
        "unreachable_node",
        `AST node ${node.id} is not reachable from root ${file.root}`,
        node.id
      );
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics };
  }

  const fileId = stableShapeId(`file_${file.path}`, "File");
  const rawNodes = file.nodes.map((node) => {
    const edge = parentByChild.get(node.id);
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

function parseJsonAstInput(value: unknown) {
  const diagnostics: AstGenerationDiagnostic[] = [];
  if (!isRecord(value)) {
    return astFailure("invalid_json_ast", "AST JSON input must be an object");
  }

  const filesValue = value.files;
  if (!Array.isArray(filesValue)) {
    return astFailure("invalid_json_ast", "AST JSON input must contain files[]");
  }

  const files: JsonAstFile[] = [];
  filesValue.forEach((fileValue, fileIndex) => {
    if (!isRecord(fileValue)) {
      diagnostics.push(astError("invalid_file", `files[${fileIndex}] must be an object`));
      return;
    }
    const path = stringProperty(fileValue, "path");
    const root = stringProperty(fileValue, "root");
    const nodesValue = fileValue.nodes;
    if (!path || !root || !Array.isArray(nodesValue)) {
      diagnostics.push(
        astError("invalid_file", `files[${fileIndex}] must include path, root, and nodes[]`)
      );
      return;
    }
    const nodes: JsonAstNode[] = [];
    const reportNodeError = astErrorReporter(diagnostics, path);
    nodesValue.forEach((nodeValue, nodeIndex) => {
      const node = parseJsonAstNode(nodeValue, nodeIndex, reportNodeError);
      if (node) {
        nodes.push(node);
      }
    });
    files.push({
      path,
      root,
      language: stringProperty(fileValue, "language"),
      nodes
    });
  });

  if (diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false as const, diagnostics };
  }
  return {
    ok: true as const,
    value: {
      module: stringProperty(value, "module"),
      language: stringProperty(value, "language"),
      files
    },
    diagnostics
  };
}

function parseJsonAstNode(
  nodeValue: unknown,
  nodeIndex: number,
  reportError: ReturnType<typeof astErrorReporter>
) {
  if (!isRecord(nodeValue)) {
    reportError("invalid_node", `nodes[${nodeIndex}] must be an object`);
    return;
  }
  const id = stringProperty(nodeValue, "id");
  const kind = stringProperty(nodeValue, "kind");
  if (!id || !kind) {
    reportError("invalid_node", `nodes[${nodeIndex}] must include id and kind`);
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
        reportError(
          "invalid_child",
          `children[${childIndex}] for ${id} must be a string or { id }`,
          id
        );
      }
    });
  }
  if (hasNonScalarRecordEntry(nodeValue, "attributes")) {
    reportError(
      "nested_attribute",
      `AST node ${id} has a nested attribute; represent nested structure as child nodes`,
      id
    );
  }

  return {
    id,
    kind,
    named: booleanProperty(nodeValue, "named"),
    span: spanProperty(nodeValue, "span"),
    text: stringProperty(nodeValue, "text"),
    textHash: stringProperty(nodeValue, "textHash"),
    attributes: scalarRecordProperty(nodeValue, "attributes"),
    children
  };
}
