import { statSync } from "node:fs";
import { createRequire } from "node:module";

import { formatShapeSource } from "./formatter.ts";

export type AstSourceFileInput = {
  path: string;
  source: string;
  language?: string;
};

export type AstGenerationDiagnostic = {
  kind: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
};

export type AstGenerationResult<T> =
  | {
      ok: true;
      value: T;
      diagnostics: AstGenerationDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: AstGenerationDiagnostic[];
    };

export type SourceSpan = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startByte?: number;
  endByte?: number;
};

export type RawAstNode = {
  id: string;
  parserId?: string;
  path: string;
  language: string;
  kind: string;
  named: boolean;
  semanticLabel?: string;
  parentId?: string;
  childIndex?: number;
  fieldName?: string;
  span?: SourceSpan;
  textHash?: string;
  text?: string;
};

export type RawAstFile = {
  id: string;
  path: string;
  language: string;
  rootNodeId: string;
  sourceHash?: string;
  parser?: string;
};

export type SemanticConfidence = "high" | "medium" | "low";

export type CodeContainer = {
  id: string;
  name: string;
  kind: "file" | "module" | "type" | "impl";
  path: string;
  language: string;
  nodeId?: string;
  anchorId?: string;
  ownerId?: string;
  confidence: SemanticConfidence;
};

export type CodeFunction = {
  id: string;
  name: string;
  path: string;
  language: string;
  nodeId?: string;
  anchorId?: string;
  ownerId: string;
  confidence: SemanticConfidence;
  sourceRef: string;
};

export type CodeResource = {
  id: string;
  name: string;
  path: string;
  language: string;
  nodeId?: string;
  anchorId?: string;
  confidence: SemanticConfidence;
  reason: string;
  sourceRef: string;
};

export type CodeAstAnchor = {
  id: string;
  name: string;
  path: string;
  language: string;
  nodeId: string;
  kind: string;
  sourceRef: string;
  target: string;
  targetKind: "component" | "fn" | "resource";
};

export type CodeRelation = {
  id: string;
  kind: "calls" | "candidate_call" | "imports" | "implements";
  fromId: string;
  toId: string;
  path: string;
  nodeId?: string;
  confidence: SemanticConfidence;
  summary: string;
};

export type CodeSemanticGraph = {
  files: RawAstFile[];
  rawNodes: RawAstNode[];
  containers: CodeContainer[];
  functions: CodeFunction[];
  resources: CodeResource[];
  anchors: CodeAstAnchor[];
  relations: CodeRelation[];
  diagnostics: AstGenerationDiagnostic[];
};

export type GenerateShapeOptions = {
  moduleName?: string;
  includeAstLayer?: boolean;
  rawModuleName?: string;
};

export type GeneratedShapeOutput = {
  semanticShape: string;
  rawShape?: string;
};

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

type TreeSitterParseProvider = (language: string, source: string) => Promise<unknown> | unknown;
type NativeBindingLoadResult =
  | { ok: true; moduleValue: unknown }
  | { ok: false; diagnostics: AstGenerationDiagnostic[] };
type TreeSitterNativeBindingPackageSpecifier =
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-arm64-msvc.node";
type TreeSitterNativeBindingEmbeddedSpecifier =
  | "./ts-pack-core-node.linux-x64-gnu.node"
  | "./ts-pack-core-node.linux-arm64-gnu.node"
  | "./ts-pack-core-node.darwin-arm64.node"
  | "./ts-pack-core-node.win32-x64-msvc.node"
  | "./ts-pack-core-node.win32-arm64-msvc.node";
type TreeSitterNativeBindingTarget = {
  packageSpecifier: TreeSitterNativeBindingPackageSpecifier;
  embeddedSpecifier: TreeSitterNativeBindingEmbeddedSpecifier;
};

const DATA_RESOURCE_NAME_HINT =
  /(Event|Record|Message|Config|State|Entity|Snapshot|Request|Response|Table|Queue|Topic|Payload)$/;
const CALL_RECEIVER_PATTERN =
  /\b(?:self|this)\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
const SHAPE_RESERVED_WORDS = new Set([
  "allow",
  "applies_to",
  "as",
  "attest",
  "binding",
  "callbacks",
  "change",
  "complete",
  "component",
  "conforms_to",
  "connects",
  "coordinated_call",
  "effects",
  "evidence",
  "final",
  "fn",
  "forbid",
  "grants",
  "implementation",
  "import",
  "kind",
  "memory",
  "module",
  "owns",
  "paths",
  "provides",
  "rationale",
  "reevaluation",
  "relation",
  "resource",
  "roles",
  "rule",
  "source",
  "storage",
  "summary",
  "trait",
  "unknown"
]);
const treeSitterNativeRequire = createRequire(import.meta.url);

export async function parseSourceFilesToCodeSemanticGraph(
  files: AstSourceFileInput[],
  options: {
    allowParseErrors?: boolean;
    parserProvider?: TreeSitterParseProvider;
  } = {}
): Promise<AstGenerationResult<CodeSemanticGraph>> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const graph = emptyGraph();
  const providerResult = options.parserProvider
    ? { ok: true as const, provider: options.parserProvider }
    : await loadTreeSitterProvider();

  if (!providerResult.ok) {
    return providerResult;
  }

  for (const file of files) {
    const language = normalizeLanguageName(file.language ?? inferLanguageFromPath(file.path));
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
  return { ok: true, value: graph, diagnostics };
}

export function buildCodeSemanticGraphFromAstJson(
  value: unknown
): AstGenerationResult<CodeSemanticGraph> {
  const parsed = parseJsonAstInput(value);
  if (!parsed.ok) {
    return parsed;
  }

  const graph = emptyGraph();
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
  return { ok: true, value: graph, diagnostics };
}

export function generateShapeFromCodeSemanticGraph(
  graph: CodeSemanticGraph,
  options: GenerateShapeOptions = {}
): GeneratedShapeOutput {
  const moduleName = normalizeModuleName(options.moduleName ?? "generated.ast");
  const semanticShape = formatSemanticShape(graph, moduleName, options.includeAstLayer === true);
  const rawShape =
    options.rawModuleName !== undefined
      ? formatRawAstShape(graph, normalizeModuleName(options.rawModuleName))
      : undefined;
  return { semanticShape, rawShape };
}

export async function generateShapeFromSourceFiles(
  files: AstSourceFileInput[],
  options: GenerateShapeOptions & {
    allowParseErrors?: boolean;
    parserProvider?: TreeSitterParseProvider;
  } = {}
): Promise<AstGenerationResult<GeneratedShapeOutput>> {
  const graph = await parseSourceFilesToCodeSemanticGraph(files, options);
  if (!graph.ok) {
    return graph;
  }
  return {
    ok: true,
    value: generateShapeFromCodeSemanticGraph(graph.value, options),
    diagnostics: graph.diagnostics
  };
}

export function generateShapeFromAstJson(
  value: unknown,
  options: GenerateShapeOptions = {}
): AstGenerationResult<GeneratedShapeOutput> {
  const graph = buildCodeSemanticGraphFromAstJson(value);
  if (!graph.ok) {
    return graph;
  }
  return {
    ok: true,
    value: generateShapeFromCodeSemanticGraph(graph.value, options),
    diagnostics: graph.diagnostics
  };
}

function emptyGraph(): CodeSemanticGraph {
  return {
    files: [],
    rawNodes: [],
    containers: [],
    functions: [],
    resources: [],
    anchors: [],
    relations: [],
    diagnostics: []
  };
}

function normalizeTreeSitterFile(
  path: string,
  language: string,
  source: string,
  root: unknown
): Pick<CodeSemanticGraph, "files" | "rawNodes" | "diagnostics"> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const rawNodes: RawAstNode[] = [];
  const sourceHash = stableHash(source);
  const fileId = stableShapeId(`file_${path}`, "File");
  const byteMap = makeByteToStringIndexMap(source);
  let sequence = 0;

  function visit(
    node: unknown,
    parentId: string | undefined,
    childIndex: number | undefined,
    fieldName: string | undefined
  ): string {
    const id = stableShapeId(`${path}_${sequence}_${nodeKind(node)}`, "AstNode");
    sequence += 1;
    const byteRange = nodeByteRange(node);
    const text =
      byteRange.startByte !== undefined && byteRange.endByte !== undefined
        ? sliceByByteRange(source, byteRange.startByte, byteRange.endByte, byteMap)
        : undefined;
    rawNodes.push({
      id,
      path,
      language,
      kind: nodeKind(node),
      named: nodeNamed(node),
      parentId,
      childIndex,
      fieldName,
      span: nodeSpan(node),
      textHash: text ? stableHash(text) : undefined,
      text
    });

    const children = nodeChildren(node);
    children.forEach((child, index) => {
      visit(child, id, index, fieldNameForChild(node, index));
    });
    return id;
  }

  const rootNodeId = visit(root, undefined, undefined, undefined);
  return {
    files: [{ id: fileId, path, language, rootNodeId, sourceHash, parser: "tree-sitter" }],
    rawNodes,
    diagnostics
  };
}

function normalizeJsonAstFile(
  file: JsonAstFile,
  fallbackLanguage: string | undefined
): AstGenerationResult<Pick<CodeSemanticGraph, "files" | "rawNodes">> {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const language = normalizeLanguageName(
    file.language ?? fallbackLanguage ?? inferLanguageFromPath(file.path)
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
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(parserId: string): void {
    if (visiting.has(parserId)) {
      diagnostics.push({
        kind: "error",
        code: "cycle",
        path: file.path,
        nodeId: parserId,
        message: `AST child graph contains a cycle at ${parserId}`
      });
      return;
    }
    if (visited.has(parserId)) {
      return;
    }
    visiting.add(parserId);
    reachable.add(parserId);
    const node = nodeByParserId.get(parserId);
    for (const child of node?.children ?? []) {
      visit(child.id);
    }
    visiting.delete(parserId);
    visited.add(parserId);
  }
  visit(file.root);

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

function addSemanticProjection(graph: CodeSemanticGraph): void {
  const childrenByParent = groupChildren(graph.rawNodes);
  const nodeById = new Map(graph.rawNodes.map((node) => [node.id, node]));
  const containersByName = new Map<string, CodeContainer>();
  const resourcesByName = new Map<string, CodeResource>();

  for (const file of graph.files) {
    const fileNodes = graph.rawNodes.filter((node) => node.path === file.path);
    const declaredTypes = fileNodes.filter(isTypeDeclarationNode);
    const implByType = collectImplFunctions(fileNodes, childrenByParent);
    const receiverFunctionsByType = collectReceiverFunctions(fileNodes);
    const ownedFunctionNodeIds = new Set<string>();

    for (const typeNode of declaredTypes) {
      const name = semanticName(typeNode, childrenByParent, nodeById);
      if (!name) {
        continue;
      }
      const implFunctions = implByType.get(name) ?? [];
      const nestedFunctions = descendants(typeNode.id, childrenByParent).filter(isFunctionNode);
      const receiverFunctions = receiverFunctionsByType.get(name) ?? [];
      const ownedFunctions = uniqueNodes([
        ...implFunctions,
        ...nestedFunctions,
        ...receiverFunctions
      ]);
      if (ownedFunctions.length > 0 || typeLooksStateful(typeNode)) {
        const container = addContainer(graph, containersByName, {
          name,
          kind: "type",
          path: file.path,
          language: typeNode.language,
          nodeId: typeNode.id,
          confidence: "medium"
        });
        const anchor = addAnchor(graph, {
          name: `${container.name}AstAnchor`,
          path: typeNode.path,
          language: typeNode.language,
          nodeId: typeNode.id,
          kind: typeNode.kind,
          sourceRef: sourceRef(typeNode),
          target: container.name,
          targetKind: "component"
        });
        container.anchorId = anchor.id;
        for (const fn of ownedFunctions) {
          addFunction(graph, container, fn, childrenByParent, nodeById);
          ownedFunctionNodeIds.add(fn.id);
        }
      } else if (DATA_RESOURCE_NAME_HINT.test(name)) {
        const resource = addResource(graph, resourcesByName, {
          name,
          path: file.path,
          language: typeNode.language,
          nodeId: typeNode.id,
          confidence: "medium",
          reason: `Generated candidate from ${typeNode.language} ${typeNode.kind}`,
          sourceRef: sourceRef(typeNode)
        });
        const anchor = addAnchor(graph, {
          name: `${resource.name}AstAnchor`,
          path: typeNode.path,
          language: typeNode.language,
          nodeId: typeNode.id,
          kind: typeNode.kind,
          sourceRef: sourceRef(typeNode),
          target: resource.name,
          targetKind: "resource"
        });
        resource.anchorId = anchor.id;
      }
    }

    const freeFunctions = fileNodes.filter(
      (node) =>
        isFunctionNode(node) &&
        !nearestTypeOwner(node, nodeById) &&
        !receiverTypeName(node) &&
        !ownedFunctionNodeIds.has(node.id)
    );
    if (freeFunctions.length > 0) {
      const fileContainer = addContainer(graph, containersByName, {
        name: `${baseNameWithoutExtension(file.path)}Module`,
        kind: "file",
        path: file.path,
        language: file.language,
        nodeId: file.rootNodeId,
        confidence: "low"
      });
      for (const fn of freeFunctions) {
        addFunction(graph, fileContainer, fn, childrenByParent, nodeById);
      }
    }

    addResolvedReceiverCalls(graph, fileNodes, containersByName, nodeById);
  }
}

function collectImplFunctions(
  nodes: RawAstNode[],
  childrenByParent: Map<string, RawAstNode[]>
): Map<string, RawAstNode[]> {
  const implByType = new Map<string, RawAstNode[]>();
  for (const node of nodes) {
    if (!isImplNode(node)) {
      continue;
    }
    const typeName =
      childByField(node.id, "type", childrenByParent)?.text?.trim() ??
      firstMatchingChild(node.id, childrenByParent, (child) =>
        /type_identifier|identifier/.test(child.kind)
      )?.text?.trim();
    if (!typeName) {
      continue;
    }
    const functions = descendants(node.id, childrenByParent).filter(isFunctionNode);
    implByType.set(typeName, [...(implByType.get(typeName) ?? []), ...functions]);
  }
  return implByType;
}

function collectReceiverFunctions(nodes: RawAstNode[]): Map<string, RawAstNode[]> {
  const functionsByReceiver = new Map<string, RawAstNode[]>();
  for (const node of nodes.filter(isFunctionNode)) {
    const receiverType = receiverTypeName(node);
    if (!receiverType) {
      continue;
    }
    functionsByReceiver.set(receiverType, [...(functionsByReceiver.get(receiverType) ?? []), node]);
  }
  return functionsByReceiver;
}

function addFunction(
  graph: CodeSemanticGraph,
  owner: CodeContainer,
  node: RawAstNode,
  childrenByParent: Map<string, RawAstNode[]>,
  nodeById: Map<string, RawAstNode>
): void {
  const name = semanticName(node, childrenByParent, nodeById) ?? fallbackFunctionName(node);
  const id = stableShapeId(`fn_${owner.name}_${name}_${node.id}`, "Function");
  if (graph.functions.some((fn) => fn.id === id)) {
    return;
  }
  graph.functions.push({
    id,
    name: shapeFunctionName(name),
    path: node.path,
    language: node.language,
    nodeId: node.id,
    ownerId: owner.id,
    confidence: "medium",
    sourceRef: sourceRef(node)
  });
  const fn = graph.functions.at(-1);
  if (!fn) {
    return;
  }
  const anchor = addAnchor(graph, {
    name: `${owner.name}${shapeTypeName(fn.name)}AstAnchor`,
    path: node.path,
    language: node.language,
    nodeId: node.id,
    kind: node.kind,
    sourceRef: fn.sourceRef,
    target: `${owner.name}.${fn.name}`,
    targetKind: "fn"
  });
  fn.anchorId = anchor.id;
}

function addContainer(
  graph: CodeSemanticGraph,
  containersByName: Map<string, CodeContainer>,
  input: Omit<CodeContainer, "id">
): CodeContainer {
  const existing = containersByName.get(input.name);
  if (existing) {
    return existing;
  }
  const container = {
    ...input,
    id: stableShapeId(`component_${input.name}_${input.path}`, "Component"),
    name: uniqueSemanticName(
      shapeTypeName(input.name),
      graph.containers.map((item) => item.name),
      input.path
    )
  };
  containersByName.set(input.name, container);
  containersByName.set(container.name, container);
  graph.containers.push(container);
  return container;
}

function addResource(
  graph: CodeSemanticGraph,
  resourcesByName: Map<string, CodeResource>,
  input: Omit<CodeResource, "id">
): CodeResource {
  const existing = resourcesByName.get(input.name);
  if (existing) {
    return existing;
  }
  const resource = {
    ...input,
    id: stableShapeId(`resource_${input.name}_${input.path}`, "Resource"),
    name: uniqueSemanticName(
      shapeTypeName(input.name),
      graph.resources.map((item) => item.name),
      input.path
    )
  };
  resourcesByName.set(input.name, resource);
  resourcesByName.set(resource.name, resource);
  graph.resources.push(resource);
  return resource;
}

function addAnchor(
  graph: CodeSemanticGraph,
  input: Omit<CodeAstAnchor, "id" | "name"> & {
    name: string;
  }
): CodeAstAnchor {
  const existing = graph.anchors.find(
    (anchor) =>
      anchor.nodeId === input.nodeId &&
      anchor.target === input.target &&
      anchor.targetKind === input.targetKind
  );
  if (existing) {
    return existing;
  }
  const anchor = {
    ...input,
    id: stableShapeId(`anchor_${input.targetKind}_${input.target}_${input.nodeId}`, "AstAnchor"),
    name: uniqueSemanticName(
      shapeTypeName(input.name),
      graph.anchors.map((item) => item.name),
      input.nodeId
    )
  };
  graph.anchors.push(anchor);
  return anchor;
}

function addResolvedReceiverCalls(
  graph: CodeSemanticGraph,
  fileNodes: RawAstNode[],
  containersByName: Map<string, CodeContainer>,
  nodeById: Map<string, RawAstNode>
): void {
  const fieldTypesByOwner = collectFieldTypes(fileNodes, nodeById);
  const functionsByNode = new Map(graph.functions.map((fn) => [fn.nodeId, fn]));

  for (const fnNode of fileNodes.filter(isFunctionNode)) {
    const fn = functionsByNode.get(fnNode.id);
    if (!fn) {
      continue;
    }
    const owner = graph.containers.find((container) => container.id === fn.ownerId);
    if (!owner || !fnNode.text) {
      continue;
    }
    const fieldTypes =
      fieldTypesByOwner.get(owner.name) ?? fieldTypesByOwner.get(originalName(owner.name));
    if (!fieldTypes) {
      continue;
    }

    for (const match of fnNode.text.matchAll(CALL_RECEIVER_PATTERN)) {
      const field = match[1];
      if (!field) {
        continue;
      }
      const targetName = fieldTypes.get(field);
      if (!targetName) {
        continue;
      }
      const target =
        containersByName.get(targetName) ?? containersByName.get(shapeTypeName(targetName));
      if (!target) {
        continue;
      }
      const relationId = stableShapeId(
        `rel_${owner.name}_${target.name}_${fn.name}_${match[0]}`,
        "Relation"
      );
      if (graph.relations.some((relation) => relation.id === relationId)) {
        continue;
      }
      graph.relations.push({
        id: relationId,
        kind: "calls",
        fromId: owner.id,
        toId: target.id,
        path: fnNode.path,
        nodeId: fnNode.id,
        confidence: "high",
        summary: `${owner.name}.${fn.name} calls ${target.name}; generated from ${sourceRef(fnNode)}.`
      });
    }
  }
}

function collectFieldTypes(
  nodes: RawAstNode[],
  nodeById: Map<string, RawAstNode>
): Map<string, Map<string, string>> {
  const fieldTypesByOwner = new Map<string, Map<string, string>>();
  for (const node of nodes.filter(isTypeDeclarationNode)) {
    const name = nameFromText(node);
    if (!name || !node.text) {
      continue;
    }
    const fields = new Map<string, string>();
    for (const match of node.text.matchAll(
      /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Z][A-Za-z0-9_]*)\b/g
    )) {
      const field = match[1];
      const typeName = match[2];
      if (field && typeName) {
        fields.set(field, typeName);
      }
    }
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    void parent;
    if (fields.size > 0) {
      fieldTypesByOwner.set(name, fields);
      fieldTypesByOwner.set(shapeTypeName(name), fields);
    }
  }
  return fieldTypesByOwner;
}

function formatSemanticShape(
  graph: CodeSemanticGraph,
  moduleName: string,
  includeRawLayer: boolean
): string {
  const lines = [
    `module ${moduleName}`,
    "",
    "trait GeneratedCandidate {",
    "}",
    "",
    "trait GeneratedAstAnchor {",
    "}"
  ];
  const resources = [...graph.resources].sort((left, right) => left.name.localeCompare(right.name));
  for (const resource of resources) {
    lines.push(
      "",
      `resource ${resource.name} : GeneratedCandidate {`,
      `  storage ${sourceLanguage(resource.language)}.type(${quoteShapeString(resource.sourceRef)})`,
      "}"
    );
  }

  const components = [...graph.containers].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const component of components) {
    lines.push("", `component ${component.name} : GeneratedCandidate {`);
    const functions = graph.functions
      .filter((fn) => fn.ownerId === component.id)
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const fn of functions) {
      lines.push(
        `  fn ${fn.name}`,
        `    source ${sourceLanguage(fn.language)}(${quoteShapeString(fn.sourceRef)})`,
        "    effects unknown"
      );
    }
    lines.push("}");
  }

  const seenImplementationNames = new Set<string>();
  for (const component of components) {
    const implementationName = uniqueReadableShapeName(
      `${component.name}Impl`,
      seenImplementationNames
    );
    lines.push(
      "",
      `implementation ${implementationName} {`,
      "  paths {",
      `    ${quoteShapeString(component.path)}`,
      "  }",
      `  conforms_to ${component.name}`,
      "}"
    );
  }

  const anchors = [...graph.anchors].sort((left, right) => left.name.localeCompare(right.name));
  for (const anchor of anchors) {
    lines.push(
      "",
      `resource ${anchor.name} : GeneratedAstAnchor {`,
      `  storage ast.anchor(${quoteShapeString(
        JSON.stringify({
          target: anchor.target,
          targetKind: anchor.targetKind,
          nodeId: anchor.nodeId,
          path: anchor.path,
          language: anchor.language,
          kind: anchor.kind,
          source: anchor.sourceRef
        })
      )})`,
      "}"
    );
  }

  const endpointName = new Map<string, string>();
  for (const component of graph.containers) {
    endpointName.set(component.id, component.name);
  }
  for (const resource of graph.resources) {
    endpointName.set(resource.id, resource.name);
  }
  for (const anchor of graph.anchors) {
    endpointName.set(anchor.id, anchor.name);
  }

  const seenRelationNames = new Set<string>();
  for (const relation of [...graph.relations].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const from = endpointName.get(relation.fromId);
    const to = endpointName.get(relation.toId);
    if (!from || !to || from === to) {
      continue;
    }
    const relationName = uniqueReadableShapeName(
      shapeRelationName(`${from} ${relation.kind} ${to}`),
      seenRelationNames
    );
    const relationKind = relation.confidence === "high" ? relation.kind : "candidate_call";
    lines.push(
      "",
      `relation ${relationName} {`,
      `  kind ${relationKind}`,
      `  connects ${from} -> ${to}`,
      `  roles { ${from} as origin, ${to} as destination }`,
      `  summary ${quoteShapeString(relation.summary)}`,
      "}"
    );
  }

  appendGeneratedFromRelations(lines, graph, seenRelationNames);

  if (includeRawLayer) {
    appendRawAstDeclarations(lines, graph);
  }

  return formatGeneratedShape(`${lines.join("\n")}\n`, `${moduleName}.shape`);
}

function appendGeneratedFromRelations(
  lines: string[],
  graph: CodeSemanticGraph,
  seenRelationNames: Set<string>
): void {
  const componentById = new Map(graph.containers.map((component) => [component.id, component]));
  const anchorsById = new Map(graph.anchors.map((anchor) => [anchor.id, anchor]));
  const semanticLinks: { from: string; anchor: CodeAstAnchor; summary: string; name: string }[] =
    [];

  for (const component of graph.containers) {
    const anchor = component.anchorId ? anchorsById.get(component.anchorId) : undefined;
    if (!anchor) {
      continue;
    }
    semanticLinks.push({
      from: component.name,
      anchor,
      summary: `component ${component.name} generated from ${anchor.language} ${anchor.kind} at ${anchor.sourceRef}.`,
      name: `${component.name}GeneratedFrom${anchor.name}`
    });
  }

  for (const resource of graph.resources) {
    const anchor = resource.anchorId ? anchorsById.get(resource.anchorId) : undefined;
    if (!anchor) {
      continue;
    }
    semanticLinks.push({
      from: resource.name,
      anchor,
      summary: `resource ${resource.name} generated from ${anchor.language} ${anchor.kind} at ${anchor.sourceRef}.`,
      name: `${resource.name}GeneratedFrom${anchor.name}`
    });
  }

  for (const fn of graph.functions) {
    const owner = componentById.get(fn.ownerId);
    const anchor = fn.anchorId ? anchorsById.get(fn.anchorId) : undefined;
    if (!owner || !anchor) {
      continue;
    }
    semanticLinks.push({
      from: owner.name,
      anchor,
      summary: `fn ${owner.name}.${fn.name} generated from ${anchor.language} ${anchor.kind} at ${anchor.sourceRef}.`,
      name: `${owner.name}${shapeTypeName(fn.name)}GeneratedFrom${anchor.name}`
    });
  }

  for (const link of semanticLinks.sort((left, right) => left.name.localeCompare(right.name))) {
    const relationName = uniqueReadableShapeName(link.name, seenRelationNames);
    lines.push(
      "",
      `relation ${relationName} {`,
      "  kind generated_from",
      `  connects ${link.from} -> ${link.anchor.name}`,
      `  roles { ${link.from} as generated, ${link.anchor.name} as syntax }`,
      `  summary ${quoteShapeString(link.summary)}`,
      "}"
    );
  }
}

function formatRawAstShape(graph: CodeSemanticGraph, moduleName: string): string {
  const lines = [`module ${moduleName}`];
  appendRawAstDeclarations(lines, graph);
  return formatGeneratedShape(`${lines.join("\n")}\n`, `${moduleName}.shape`);
}

function formatGeneratedShape(source: string, filePath: string): string {
  const formatted = formatShapeSource(source, filePath);
  return formatted.ok ? formatted.formatted : source;
}

function appendRawAstDeclarations(lines: string[], graph: CodeSemanticGraph): void {
  lines.push("", "trait GeneratedAstFile {", "}", "", "trait GeneratedAstNode {", "}");
  for (const file of [...graph.files].sort((left, right) => left.path.localeCompare(right.path))) {
    lines.push(
      "",
      `resource ${file.id} : GeneratedAstFile {`,
      `  storage ast.file(${quoteShapeString(
        JSON.stringify({
          path: file.path,
          language: file.language,
          parser: file.parser,
          sourceHash: file.sourceHash
        })
      )})`,
      "}"
    );
  }

  for (const node of [...graph.rawNodes].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(
      "",
      `resource ${node.id} : GeneratedAstNode {`,
      `  storage ast.node(${quoteShapeString(
        JSON.stringify({
          parserId: node.parserId,
          path: node.path,
          kind: node.kind,
          named: node.named,
          span: node.span,
          textHash: node.textHash,
          fieldName: node.fieldName,
          childIndex: node.childIndex
        })
      )})`,
      "}"
    );
  }

  const seenRelationNames = new Set<string>();
  for (const file of graph.files) {
    const relationName = uniqueShapeName(`${file.id}Root`, seenRelationNames);
    lines.push(
      "",
      `relation ${relationName} {`,
      "  kind ast_child",
      `  connects ${file.id} -> ${file.rootNodeId}`,
      `  roles { ${file.id} as parent, ${file.rootNodeId} as child }`,
      `  summary ${quoteShapeString(`Raw AST root for ${file.path}.`)}`,
      "}"
    );
  }

  for (const node of graph.rawNodes.filter((candidate) => candidate.parentId)) {
    const relationName = uniqueShapeName(
      `${node.parentId ?? "Ast"}To${node.id}`,
      seenRelationNames
    );
    lines.push(
      "",
      `relation ${relationName} {`,
      "  kind ast_child",
      `  connects ${node.parentId ?? ""} -> ${node.id}`,
      `  roles { ${node.parentId ?? ""} as parent, ${node.id} as child }`,
      `  summary ${quoteShapeString(
        `Raw AST child edge${node.fieldName ? ` field ${node.fieldName}` : ""} index ${
          node.childIndex ?? 0
        } for ${node.path}.`
      )}`,
      "}"
    );
  }
}

async function loadTreeSitterProvider(): Promise<
  | { ok: true; provider: TreeSitterParseProvider }
  | { ok: false; diagnostics: AstGenerationDiagnostic[] }
> {
  const nativeBinding = loadTreeSitterNativeBinding();
  if (!nativeBinding.ok) {
    return nativeBinding;
  }

  const moduleValue = nativeBinding.moduleValue;
  if (!isRecord(moduleValue)) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "invalid_tree_sitter_language_pack",
          message: "@kreuzberg/tree-sitter-language-pack did not export an object"
        }
      ]
    };
  }

  const getParser = methodFunction(moduleValue, ["getParser"]);
  if (!getParser) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "invalid_tree_sitter_language_pack",
          message: "@kreuzberg/tree-sitter-language-pack native binding does not expose getParser"
        }
      ]
    };
  }

  return {
    ok: true,
    provider: async (language, source) => {
      const parser = await getParser(undefined, language);
      const tree = await callMethod(parser, ["parse"], [source]);
      if (!tree) {
        throw new Error(`parser for ${language} returned no tree`);
      }
      return tree;
    }
  };
}

function loadTreeSitterNativeBinding(): NativeBindingLoadResult {
  const target = currentTreeSitterNativeBindingTarget();
  if (!target) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "unsupported_tree_sitter_platform",
          message: `no bundled @kreuzberg/tree-sitter-language-pack native binding target for ${process.platform}-${process.arch}`
        }
      ]
    };
  }

  try {
    return {
      ok: true,
      moduleValue: requireTreeSitterNativeBinding(target)
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "missing_tree_sitter_language_pack",
          message: `failed to load ${target.packageSpecifier}: ${errorMessage(error)}`
        }
      ]
    };
  }
}

function currentTreeSitterNativeBindingTarget(): TreeSitterNativeBindingTarget | undefined {
  if (process.platform === "linux" && isCurrentLinuxMusl()) {
    return undefined;
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return {
      packageSpecifier: "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node",
      embeddedSpecifier: "./ts-pack-core-node.linux-x64-gnu.node"
    };
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return {
      packageSpecifier:
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node",
      embeddedSpecifier: "./ts-pack-core-node.linux-arm64-gnu.node"
    };
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      packageSpecifier: "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node",
      embeddedSpecifier: "./ts-pack-core-node.darwin-arm64.node"
    };
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      packageSpecifier:
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node",
      embeddedSpecifier: "./ts-pack-core-node.win32-x64-msvc.node"
    };
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return {
      packageSpecifier:
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-arm64-msvc.node",
      embeddedSpecifier: "./ts-pack-core-node.win32-arm64-msvc.node"
    };
  }

  return undefined;
}

function requireTreeSitterNativeBinding(target: TreeSitterNativeBindingTarget): unknown {
  try {
    return requireTreeSitterNativePackageBinding(target.packageSpecifier);
  } catch (packageError) {
    try {
      return requireTreeSitterEmbeddedBinding(target.embeddedSpecifier);
    } catch (embeddedError) {
      throw new Error(
        `package ${errorMessage(packageError)}; embedded ${errorMessage(embeddedError)}`
      );
    }
  }
}

function requireTreeSitterNativePackageBinding(
  specifier: TreeSitterNativeBindingPackageSpecifier
): unknown {
  switch (specifier) {
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-arm64-msvc.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-arm64-msvc.node"
      );
  }
}

function requireTreeSitterEmbeddedBinding(
  specifier: TreeSitterNativeBindingEmbeddedSpecifier
): unknown {
  switch (specifier) {
    case "./ts-pack-core-node.linux-x64-gnu.node":
      return treeSitterNativeRequire("./ts-pack-core-node.linux-x64-gnu.node");
    case "./ts-pack-core-node.linux-arm64-gnu.node":
      return treeSitterNativeRequire("./ts-pack-core-node.linux-arm64-gnu.node");
    case "./ts-pack-core-node.darwin-arm64.node":
      return treeSitterNativeRequire("./ts-pack-core-node.darwin-arm64.node");
    case "./ts-pack-core-node.win32-x64-msvc.node":
      return treeSitterNativeRequire("./ts-pack-core-node.win32-x64-msvc.node");
    case "./ts-pack-core-node.win32-arm64-msvc.node":
      return treeSitterNativeRequire("./ts-pack-core-node.win32-arm64-msvc.node");
  }
}

function isCurrentLinuxMusl(): boolean {
  const report: unknown = process.report?.getReport?.();
  const header = isRecord(report) ? report["header"] : undefined;
  if (isRecord(header)) {
    if (typeof header["glibcVersion"] === "string") {
      return false;
    }
    if (!("glibcVersion" in header)) {
      return true;
    }
  }

  try {
    statSync("/lib64/ld-musl-x86_64.so.1");
    return true;
  } catch {
    return false;
  }
}

function rootNodeFromTree(tree: unknown): unknown | undefined {
  if (!tree) {
    return undefined;
  }
  const root = propertyOrMethodValue(tree, ["rootNode", "root_node"]);
  if (root) {
    return root;
  }
  return undefined;
}

function nodeKind(node: unknown): string {
  return (
    callStringMethod(node, ["kind"]) ??
    stringPropertyFromUnknown(node, "kind") ??
    stringPropertyFromUnknown(node, "type") ??
    "node"
  );
}

function nodeNamed(node: unknown): boolean {
  return (
    callBooleanMethod(node, ["isNamed", "is_named"]) ??
    booleanPropertyFromUnknown(node, "isNamed") ??
    booleanPropertyFromUnknown(node, "is_named") ??
    true
  );
}

function nodeChildren(node: unknown): unknown[] {
  const children = property(node, "children");
  if (Array.isArray(children)) {
    return children;
  }
  const count =
    callNumberMethod(node, ["childCount", "child_count"]) ??
    numberPropertyFromUnknown(node, "childCount") ??
    numberPropertyFromUnknown(node, "child_count") ??
    0;
  const result: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const child = callMethod(node, ["child"], [index]);
    if (child) {
      result.push(child);
    }
  }
  return result;
}

function fieldNameForChild(node: unknown, index: number): string | undefined {
  return (
    callStringMethod(node, ["fieldNameForChild", "field_name_for_child"], [index]) ??
    callStringMethod(node, ["fieldNameForNamedChild", "field_name_for_named_child"], [index])
  );
}

function nodeSpan(node: unknown): SourceSpan | undefined {
  const startPosition = positionValue(
    propertyOrMethodValue(node, ["startPosition", "start_position"])
  );
  const endPosition = positionValue(propertyOrMethodValue(node, ["endPosition", "end_position"]));
  if (!startPosition || !endPosition) {
    return undefined;
  }
  const bytes = nodeByteRange(node);
  return {
    startLine: startPosition.row + 1,
    startColumn: startPosition.column + 1,
    endLine: endPosition.row + 1,
    endColumn: endPosition.column + 1,
    startByte: bytes.startByte,
    endByte: bytes.endByte
  };
}

function nodeByteRange(node: unknown): { startByte?: number; endByte?: number } {
  return {
    startByte:
      callNumberMethod(node, ["startByte", "startIndex"]) ??
      numberPropertyFromUnknown(node, "startByte") ??
      numberPropertyFromUnknown(node, "startIndex"),
    endByte:
      callNumberMethod(node, ["endByte", "endIndex"]) ??
      numberPropertyFromUnknown(node, "endByte") ??
      numberPropertyFromUnknown(node, "endIndex")
  };
}

function nodeHasError(node: unknown): boolean {
  if (
    callBooleanMethod(node, ["hasError", "has_error"]) ??
    booleanPropertyFromUnknown(node, "hasError") ??
    false
  ) {
    return true;
  }
  if (nodeKind(node) === "ERROR" || nodeKind(node) === "MISSING") {
    return true;
  }
  return nodeChildren(node).some(nodeHasError);
}

function positionValue(value: unknown): { row: number; column: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const row = numberProperty(value, "row");
  const column = numberProperty(value, "column");
  if (row === undefined || column === undefined) {
    return undefined;
  }
  return { row, column };
}

function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function propertyOrMethodValue(value: unknown, keys: string[]): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const propertyValue = value[key];
    if (propertyValue !== undefined && typeof propertyValue !== "function") {
      return propertyValue;
    }
  }
  return callMethod(value, keys, []);
}

function callMethod(receiver: unknown, names: string[], args: unknown[]): unknown {
  if (!isRecord(receiver)) {
    return undefined;
  }
  for (const name of names) {
    const method = receiver[name];
    if (typeof method === "function") {
      return Reflect.apply(method, receiver, args) as unknown;
    }
  }
  return undefined;
}

function methodFunction(
  receiver: Record<string, unknown>,
  names: string[]
): ((thisValue: unknown, ...args: unknown[]) => Promise<unknown> | unknown) | undefined {
  for (const name of names) {
    const method = receiver[name];
    if (typeof method === "function") {
      return (thisValue, ...args) => Reflect.apply(method, thisValue ?? receiver, args) as unknown;
    }
  }
  return undefined;
}

function callStringMethod(
  node: unknown,
  names: string[],
  args: unknown[] = []
): string | undefined {
  const value = callMethod(node, names, args);
  return typeof value === "string" ? value : undefined;
}

function callBooleanMethod(node: unknown, names: string[]): boolean | undefined {
  const value = callMethod(node, names, []);
  return typeof value === "boolean" ? value : undefined;
}

function callNumberMethod(node: unknown, names: string[]): number | undefined {
  const value = callMethod(node, names, []);
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const propertyValue = value[key];
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function stringPropertyFromUnknown(value: unknown, key: string): string | undefined {
  return isRecord(value) ? stringProperty(value, key) : undefined;
}

function booleanProperty(value: Record<string, unknown>, key: string): boolean | undefined {
  const propertyValue = value[key];
  return typeof propertyValue === "boolean" ? propertyValue : undefined;
}

function booleanPropertyFromUnknown(value: unknown, key: string): boolean | undefined {
  return isRecord(value) ? booleanProperty(value, key) : undefined;
}

function numberProperty(value: Record<string, unknown>, key: string): number | undefined {
  const propertyValue = value[key];
  return typeof propertyValue === "number" ? propertyValue : undefined;
}

function numberPropertyFromUnknown(value: unknown, key: string): number | undefined {
  return isRecord(value) ? numberProperty(value, key) : undefined;
}

function spanProperty(value: Record<string, unknown>, key: string): SourceSpan | undefined {
  const propertyValue = value[key];
  if (!isRecord(propertyValue)) {
    return undefined;
  }
  const startLine = numberProperty(propertyValue, "startLine");
  const startColumn = numberProperty(propertyValue, "startColumn");
  const endLine = numberProperty(propertyValue, "endLine");
  const endColumn = numberProperty(propertyValue, "endColumn");
  if (
    startLine === undefined ||
    startColumn === undefined ||
    endLine === undefined ||
    endColumn === undefined
  ) {
    return undefined;
  }
  return {
    startLine,
    startColumn,
    endLine,
    endColumn,
    startByte: numberProperty(propertyValue, "startByte"),
    endByte: numberProperty(propertyValue, "endByte")
  };
}

function scalarRecordProperty(
  value: Record<string, unknown>,
  key: string
): Record<string, string | number | boolean | null> | undefined {
  const propertyValue = value[key];
  if (!isRecord(propertyValue)) {
    return undefined;
  }
  const result: Record<string, string | number | boolean | null> = {};
  for (const [entryKey, entryValue] of Object.entries(propertyValue)) {
    if (
      typeof entryValue === "string" ||
      typeof entryValue === "number" ||
      typeof entryValue === "boolean" ||
      entryValue === null
    ) {
      result[entryKey] = entryValue;
    } else {
      result[entryKey] = null;
    }
  }
  return result;
}

function hasNonScalarRecordEntry(value: Record<string, unknown>, key: string): boolean {
  const propertyValue = value[key];
  if (!isRecord(propertyValue)) {
    return false;
  }
  return Object.values(propertyValue).some(
    (entryValue) =>
      typeof entryValue !== "string" &&
      typeof entryValue !== "number" &&
      typeof entryValue !== "boolean" &&
      entryValue !== null
  );
}

function groupChildren(nodes: RawAstNode[]): Map<string, RawAstNode[]> {
  const children = new Map<string, RawAstNode[]>();
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    const current = children.get(node.parentId) ?? [];
    current.push(node);
    children.set(node.parentId, current);
  }
  for (const entries of children.values()) {
    entries.sort((left, right) => (left.childIndex ?? 0) - (right.childIndex ?? 0));
  }
  return children;
}

function childByField(
  nodeId: string,
  fieldName: string,
  childrenByParent: Map<string, RawAstNode[]>
): RawAstNode | undefined {
  return childrenByParent.get(nodeId)?.find((child) => child.fieldName === fieldName);
}

function firstMatchingChild(
  nodeId: string,
  childrenByParent: Map<string, RawAstNode[]>,
  predicate: (node: RawAstNode) => boolean
): RawAstNode | undefined {
  return childrenByParent.get(nodeId)?.find(predicate);
}

function descendants(nodeId: string, childrenByParent: Map<string, RawAstNode[]>): RawAstNode[] {
  const result: RawAstNode[] = [];
  const stack = [...(childrenByParent.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }
    result.push(node);
    stack.push(...(childrenByParent.get(node.id) ?? []));
  }
  return result;
}

function isTypeDeclarationNode(node: RawAstNode): boolean {
  return /^(struct_item|enum_item|class_declaration|class_definition|interface_declaration|type_declaration|type_spec)$/.test(
    node.kind
  );
}

function isImplNode(node: RawAstNode): boolean {
  return /^(impl_item|implementation_item)$/.test(node.kind);
}

function isFunctionNode(node: RawAstNode): boolean {
  return /^(function_item|function_declaration|function_definition|method_definition|method_declaration)$/.test(
    node.kind
  );
}

function semanticName(
  node: RawAstNode,
  childrenByParent: Map<string, RawAstNode[]>,
  nodeById: Map<string, RawAstNode>
): string | undefined {
  if (node.semanticLabel) {
    return node.semanticLabel;
  }
  const nameChild =
    childByField(node.id, "name", childrenByParent) ??
    firstMatchingChild(node.id, childrenByParent, (child) =>
      /identifier|type_identifier|property_identifier/.test(child.kind)
    );
  return nameChild?.text?.trim() ?? nameFromText(node) ?? nearestNamedText(node, nodeById);
}

function nameFromText(node: RawAstNode): string | undefined {
  const text = node.text?.trim();
  if (!text) {
    return undefined;
  }
  const patterns = [
    /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\benum\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /\btype\s+([A-Za-z_][A-Za-z0-9_]*)/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function nearestNamedText(node: RawAstNode, nodeById: Map<string, RawAstNode>): string | undefined {
  const children = [...nodeById.values()].filter((candidate) => candidate.parentId === node.id);
  const identifier = children.find((child) => /identifier/.test(child.kind) && child.text);
  return identifier?.text?.trim();
}

function nearestTypeOwner(
  node: RawAstNode,
  nodeById: Map<string, RawAstNode>
): RawAstNode | undefined {
  let current = node.parentId ? nodeById.get(node.parentId) : undefined;
  while (current) {
    if (isTypeDeclarationNode(current) || isImplNode(current)) {
      return current;
    }
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  return undefined;
}

function receiverTypeName(node: RawAstNode): string | undefined {
  const text = node.text?.trim();
  if (!text) {
    return undefined;
  }
  const goMatch =
    /\bfunc\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*[A-Za-z_][A-Za-z0-9_]*/.exec(
      text
    );
  return goMatch?.[1];
}

function uniqueNodes(nodes: RawAstNode[]): RawAstNode[] {
  const seen = new Set<string>();
  const result: RawAstNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    result.push(node);
  }
  return result;
}

function typeLooksStateful(node: RawAstNode): boolean {
  const text = node.text ?? "";
  return (
    /\b(repo|client|store|db|database|queue|sender|receiver|connection|pool)\s*:/i.test(text) ||
    /\b(repo|client|store|db|database|queue|sender|receiver|connection|pool)\s+(?:\*|[A-Z])/i.test(
      text
    )
  );
}

function fallbackFunctionName(node: RawAstNode): string {
  return `generated${stableHash(node.id).slice(0, 8)}`;
}

function sourceRef(node: RawAstNode): string {
  if (!node.span) {
    return node.path;
  }
  return `${node.path}:${node.span.startLine}-${node.span.endLine}`;
}

function sourceLanguage(language: string): string {
  if (language === "typescript" || language === "tsx") {
    return "ts";
  }
  if (language === "javascript" || language === "jsx") {
    return "js";
  }
  if (language === "python") {
    return "python";
  }
  if (language === "rust") {
    return "rust";
  }
  if (language === "go") {
    return "go";
  }
  return "file";
}

function inferLanguageFromPath(path: string): string | undefined {
  if (path.endsWith(".ts")) {
    return "typescript";
  }
  if (path.endsWith(".tsx")) {
    return "tsx";
  }
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return "javascript";
  }
  if (path.endsWith(".jsx")) {
    return "jsx";
  }
  if (path.endsWith(".rs")) {
    return "rust";
  }
  if (path.endsWith(".go")) {
    return "go";
  }
  if (path.endsWith(".py")) {
    return "python";
  }
  return undefined;
}

function normalizeLanguageName(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }
  const lower = language.toLowerCase();
  if (lower === "ts") {
    return "typescript";
  }
  if (lower === "js") {
    return "javascript";
  }
  if (lower === "rs") {
    return "rust";
  }
  if (lower === "py") {
    return "python";
  }
  return lower;
}

function normalizeModuleName(moduleName: string): string {
  return moduleName
    .split(".")
    .map((part) => stableShapeId(part, "generated").replace(/_[0-9a-f]{8}$/, ""))
    .join(".");
}

function shapeTypeName(value: string): string {
  const raw = toPascal(value);
  const clean = raw.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(clean) ? clean : `Generated_${clean}`;
  return avoidReservedShapeWord(prefixed || "Generated", "Generated");
}

function shapeFunctionName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(clean) ? clean : `fn_${clean}`;
  return avoidReservedShapeWord(prefixed || "generatedFunction", "generatedFunction");
}

function stableShapeId(value: string, fallback: string): string {
  const base = value
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  const clean = base.length > 0 ? base : fallback;
  const prefixed = avoidReservedShapeWord(
    /^[A-Za-z_]/.test(clean) ? clean : `${fallback}_${clean}`,
    fallback
  );
  return `${prefixed}_${stableHash(value).slice(0, 8)}`;
}

function avoidReservedShapeWord(value: string, fallback: string): string {
  return SHAPE_RESERVED_WORDS.has(value.toLowerCase()) ? `${fallback}_${value}` : value;
}

function uniqueSemanticName(value: string, existing: string[], salt: string): string {
  if (!existing.includes(value)) {
    return value;
  }
  return stableShapeId(`${value}_${salt}`, value);
}

function uniqueShapeName(value: string, seen: Set<string>): string {
  let name = stableShapeId(value, "Generated");
  let suffix = 2;
  while (seen.has(name)) {
    name = stableShapeId(`${value}_${suffix}`, "Generated");
    suffix += 1;
  }
  seen.add(name);
  return name;
}

function uniqueReadableShapeName(value: string, seen: Set<string>): string {
  const base = shapeTypeName(value);
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  let suffix = stableHash(value).slice(0, 8);
  let name = `${base}_${suffix}`;
  let counter = 2;
  while (seen.has(name)) {
    suffix = stableHash(`${value}_${counter}`).slice(0, 8);
    name = `${base}_${suffix}`;
    counter += 1;
  }
  seen.add(name);
  return name;
}

function shapeRelationName(value: string): string {
  return shapeTypeName(value.replace(/\bcandidate_call\b/g, "candidate call"));
}

function originalName(name: string): string {
  return name.replace(/_[0-9a-f]{8}$/, "");
}

function toPascal(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const pascal = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  return pascal || value;
}

function baseNameWithoutExtension(path: string): string {
  return (
    path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? "file"
  );
}

function quoteShapeString(value: string): string {
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeByteToStringIndexMap(source: string): number[] {
  const encoder = new TextEncoder();
  const map: number[] = [];
  let byteOffset = 0;
  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index);
    const text = String.fromCodePoint(codePoint ?? 0);
    const width = encoder.encode(text).length;
    for (let byte = 0; byte < width; byte += 1) {
      map[byteOffset + byte] = index;
    }
    byteOffset += width;
    index += text.length;
  }
  map[byteOffset] = source.length;
  return map;
}

function sliceByByteRange(
  source: string,
  startByte: number,
  endByte: number,
  map: number[]
): string {
  const start = map[startByte] ?? source.length;
  const end = map[endByte] ?? source.length;
  return source.slice(start, end);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
