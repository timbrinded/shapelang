import { createHash } from "node:crypto";

import { formatShapeSource } from "./formatter.ts";
import { inferAstSourceLanguageFromPath } from "./source-languages.ts";
import { loadTreeSitterProvider } from "./ast-generation-tree-sitter.ts";

export {
  BUNDLED_TREE_SITTER_LANGUAGES,
  TREE_SITTER_LANGUAGE_PACK_VERSION,
  bundledTreeSitterParserAssetRoot,
  bundledTreeSitterParserLibsDir,
  configureBundledTreeSitterParsers,
  detectLinuxMuslRuntime,
  treeSitterParserLibraryName
} from "./ast-generation-tree-sitter.ts";

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
  attributes?: Record<string, AstScalar>;
  parentId?: string;
  childIndex?: number;
  fieldName?: string;
  span?: SourceSpan;
  textHash?: string;
  text?: string;
};

type AstScalar = string | number | boolean | null;

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
  fingerprint: AstFingerprint;
};

export type AstFingerprint = {
  provider: string;
  value: string;
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

export type CodeCandidateEffect = {
  id: string;
  name: string;
  functionId: string;
  effect: string;
  targetResourceId: string;
  sourceRef: string;
  confidence: SemanticConfidence;
  anchorId?: string;
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
  candidateEffects: CodeCandidateEffect[];
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

export type TreeSitterParseProvider = (
  language: string,
  source: string
) => Promise<unknown> | unknown;

const DATA_RESOURCE_NAME_HINT =
  /(Event|Record|Message|Config|State|Entity|Snapshot|Request|Response|Table|Queue|Topic|Payload)$/;
const CALL_RECEIVER_PATTERN =
  /\b(?:self|this)\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
const AST_SEMANTIC_SUBTREE_FINGERPRINT_PROVIDER = "ast.semantic_subtree_v1";
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
  "expects",
  "final",
  "fingerprint",
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
  if (graph.diagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics: graph.diagnostics };
  }
  return { ok: true, value: graph, diagnostics: graph.diagnostics };
}

export function generateShapeFromCodeSemanticGraph(
  graph: CodeSemanticGraph,
  options: GenerateShapeOptions = {}
): AstGenerationResult<GeneratedShapeOutput> {
  const validationDiagnostics = validateCodeSemanticGraphForRendering(graph);
  if (validationDiagnostics.some((diagnostic) => diagnostic.kind === "error")) {
    return { ok: false, diagnostics: validationDiagnostics };
  }

  const moduleName = normalizeGeneratedModuleName(options.moduleName ?? "generated.ast");
  const semanticShape = formatSemanticShape(graph, moduleName, options.includeAstLayer === true);
  if (!semanticShape.ok) {
    return semanticShape;
  }
  const rawShape =
    options.rawModuleName !== undefined
      ? formatRawAstShape(graph, normalizeModuleName(options.rawModuleName))
      : undefined;
  if (rawShape && !rawShape.ok) {
    return rawShape;
  }
  return {
    ok: true,
    value: { semanticShape: semanticShape.value, rawShape: rawShape?.value },
    diagnostics: validationDiagnostics
  };
}

export function normalizeGeneratedModuleName(moduleName: string): string {
  return normalizeModuleName(moduleName);
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
  const output = generateShapeFromCodeSemanticGraph(graph.value, options);
  return output.ok
    ? { ok: true, value: output.value, diagnostics: [...graph.diagnostics, ...output.diagnostics] }
    : { ok: false, diagnostics: [...graph.diagnostics, ...output.diagnostics] };
}

export function generateShapeFromAstJson(
  value: unknown,
  options: GenerateShapeOptions = {}
): AstGenerationResult<GeneratedShapeOutput> {
  const graph = buildCodeSemanticGraphFromAstJson(value);
  if (!graph.ok) {
    return graph;
  }
  const output = generateShapeFromCodeSemanticGraph(graph.value, options);
  return output.ok
    ? { ok: true, value: output.value, diagnostics: [...graph.diagnostics, ...output.diagnostics] }
    : { ok: false, diagnostics: [...graph.diagnostics, ...output.diagnostics] };
}

function validateCodeSemanticGraphForRendering(
  graph: CodeSemanticGraph
): AstGenerationDiagnostic[] {
  const diagnostics: AstGenerationDiagnostic[] = [];
  const endpointIds = new Set([
    ...graph.containers.map((container) => container.id),
    ...graph.resources.map((resource) => resource.id),
    ...graph.anchors.map((anchor) => anchor.id)
  ]);
  const functionIds = new Set(graph.functions.map((fn) => fn.id));
  const resourceIds = new Set(graph.resources.map((resource) => resource.id));
  const anchorIds = new Set(graph.anchors.map((anchor) => anchor.id));

  for (const relation of graph.relations) {
    if (!endpointIds.has(relation.fromId) || !endpointIds.has(relation.toId)) {
      diagnostics.push({
        kind: "error",
        code: "invalid_semantic_relation",
        path: relation.path,
        nodeId: relation.nodeId,
        message: `relation ${relation.id} references missing endpoint(s): ${relation.fromId} -> ${relation.toId}`
      });
    }
    if (relation.fromId === relation.toId) {
      diagnostics.push({
        kind: "error",
        code: "invalid_semantic_relation",
        path: relation.path,
        nodeId: relation.nodeId,
        message: `relation ${relation.id} points at the same endpoint twice`
      });
    }
  }

  for (const candidate of graph.candidateEffects) {
    if (!functionIds.has(candidate.functionId)) {
      diagnostics.push({
        kind: "error",
        code: "invalid_candidate_effect",
        message: `candidate effect ${candidate.name} references missing function ${candidate.functionId}`
      });
    }
    if (!resourceIds.has(candidate.targetResourceId)) {
      diagnostics.push({
        kind: "error",
        code: "invalid_candidate_effect",
        message: `candidate effect ${candidate.name} references missing resource ${candidate.targetResourceId}`
      });
    }
    if (candidate.anchorId && !anchorIds.has(candidate.anchorId)) {
      diagnostics.push({
        kind: "error",
        code: "invalid_candidate_effect",
        message: `candidate effect ${candidate.name} references missing anchor ${candidate.anchorId}`
      });
    }
  }

  return diagnostics;
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
    candidateEffects: [],
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

    addResolvedReceiverCalls(graph, fileNodes, containersByName);
    addCandidateEffects(graph, fileNodes);
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
    name: uniqueSemanticName(
      shapeFunctionName(name),
      graph.functions.filter((fn) => fn.ownerId === owner.id).map((fn) => fn.name),
      node.id
    ),
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
  const identity = `${input.kind}:${input.path}:${input.nodeId ?? input.name}:${input.name}`;
  const container = {
    ...input,
    id: stableShapeId(`component_${identity}`, "Component"),
    name: uniqueSemanticName(
      shapeTypeName(input.name),
      graph.containers.map((item) => item.name),
      identity
    )
  };
  containersByName.set(identity, container);
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
  const identity = `${input.path}:${input.nodeId ?? input.name}:${input.name}`;
  const resource = {
    ...input,
    id: stableShapeId(`resource_${identity}`, "Resource"),
    name: uniqueSemanticName(
      shapeTypeName(input.name),
      graph.resources.map((item) => item.name),
      identity
    )
  };
  resourcesByName.set(identity, resource);
  resourcesByName.set(input.name, resource);
  resourcesByName.set(resource.name, resource);
  graph.resources.push(resource);
  return resource;
}

function addAnchor(
  graph: CodeSemanticGraph,
  input: Omit<CodeAstAnchor, "id" | "name" | "fingerprint"> & {
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
  const fingerprint = fingerprintForAnchor(graph, input);
  const anchor = {
    ...input,
    id: stableShapeId(`anchor_${input.targetKind}_${input.target}_${input.nodeId}`, "AstAnchor"),
    name: uniqueSemanticName(
      shapeTypeName(input.name),
      graph.anchors.map((item) => item.name),
      input.nodeId
    ),
    fingerprint
  };
  graph.anchors.push(anchor);
  return anchor;
}

type CanonicalFingerprintNode = {
  kind: string;
  named: boolean;
  field?: string;
  label?: string;
  attributes?: Record<string, AstScalar>;
  token?: string;
  children?: CanonicalFingerprintNode[];
};

type CanonicalFingerprintResult = {
  node?: CanonicalFingerprintNode;
  hasToken: boolean;
};

function fingerprintForAnchor(
  graph: CodeSemanticGraph,
  input: Omit<CodeAstAnchor, "id" | "name" | "fingerprint">
): AstFingerprint {
  const nodeById = new Map(graph.rawNodes.map((node) => [node.id, node]));
  const node = nodeById.get(input.nodeId);
  const provider = AST_SEMANTIC_SUBTREE_FINGERPRINT_PROVIDER;
  if (!node) {
    graph.diagnostics.push({
      kind: "error",
      code: "missing_fingerprint_node",
      path: input.path,
      nodeId: input.nodeId,
      message: `cannot fingerprint AST anchor ${input.target}: node ${input.nodeId} is missing`
    });
    return { provider, value: sha256Fingerprint("missing") };
  }

  const payload = canonicalFingerprintPayload(graph, input, node);
  if (!payload) {
    graph.diagnostics.push({
      kind: "error",
      code: "missing_fingerprint_tokens",
      path: input.path,
      nodeId: input.nodeId,
      message: `cannot compute ${provider} for ${input.target}; AST JSON/source node must include token text or semantic child tokens`
    });
    return { provider, value: sha256Fingerprint("missing") };
  }

  return { provider, value: sha256Fingerprint(stableJson(payload)) };
}

function canonicalFingerprintPayload(
  graph: CodeSemanticGraph,
  input: Omit<CodeAstAnchor, "id" | "name" | "fingerprint">,
  node: RawAstNode
): Record<string, unknown> | undefined {
  const childrenByParent = groupChildren(graph.rawNodes);
  const mode = input.targetKind === "fn" ? "function_subtree" : "declaration_shell";
  const result = canonicalizeFingerprintNode(node, childrenByParent, {
    rootId: node.id,
    mode
  });
  if (!result.node || !result.hasToken) {
    return undefined;
  }
  return {
    provider: AST_SEMANTIC_SUBTREE_FINGERPRINT_PROVIDER,
    language: normalizeLanguageName(node.language) ?? node.language,
    targetKind: input.targetKind,
    mode,
    node: result.node
  };
}

function canonicalizeFingerprintNode(
  node: RawAstNode,
  childrenByParent: Map<string, RawAstNode[]>,
  options: {
    rootId: string;
    mode: "function_subtree" | "declaration_shell";
  }
): CanonicalFingerprintResult {
  if (isCommentNode(node)) {
    return { hasToken: false };
  }

  const children = childrenByParent.get(node.id) ?? [];
  const pruneFunctionBody =
    options.mode === "declaration_shell" && node.id !== options.rootId && isFunctionNode(node);
  const canonicalChildren: CanonicalFingerprintNode[] = [];
  let hasToken = false;

  if (!pruneFunctionBody) {
    for (const child of children) {
      const childResult = canonicalizeFingerprintNode(child, childrenByParent, {
        ...options
      });
      if (childResult.node) {
        canonicalChildren.push(childResult.node);
      }
      hasToken ||= childResult.hasToken;
    }
  }

  const attributes = canonicalAttributes(node);
  const token =
    pruneFunctionBody && node.text
      ? normalizeSemanticTokenText(signatureText(node.text, node.language), node.language)
      : children.length === 0
        ? normalizeSemanticTokenText(node.text, node.language)
        : undefined;
  if (token) {
    hasToken = true;
  }

  if (
    !token &&
    canonicalChildren.length === 0 &&
    attributes === undefined &&
    !node.semanticLabel &&
    isSkippablePunctuationNode(node)
  ) {
    return { hasToken };
  }

  const canonical: CanonicalFingerprintNode = {
    kind: node.kind,
    named: node.named
  };
  if (node.fieldName) {
    canonical.field = node.fieldName;
  }
  if (node.semanticLabel) {
    canonical.label = node.semanticLabel;
  }
  if (attributes) {
    canonical.attributes = attributes;
  }
  if (token) {
    canonical.token = token;
  }
  if (canonicalChildren.length > 0) {
    canonical.children = canonicalChildren;
  }

  return { node: canonical, hasToken };
}

function canonicalAttributes(node: RawAstNode): Record<string, AstScalar> | undefined {
  if (!node.attributes) {
    return undefined;
  }
  const entries = Object.entries(node.attributes).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function signatureText(text: string, language: string): string {
  const withoutComments = stripComments(text, language);
  const braceIndex = withoutComments.indexOf("{");
  if (braceIndex >= 0) {
    return withoutComments.slice(0, braceIndex);
  }
  const lines = withoutComments.split(/\r?\n/);
  return lines[0] ?? withoutComments;
}

function normalizeSemanticTokenText(
  text: string | undefined,
  language: string
): string | undefined {
  if (!text) {
    return undefined;
  }
  const tokens = semanticTokens(stripComments(text, language)).filter(
    (token) => !isSkippablePunctuation(token)
  );
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.join(" ");
}

function semanticTokens(text: string): string[] {
  const tokenPattern =
    /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|==|!=|<=|>=|&&|\|\||->|=>|::|\.\.\.|[+\-*/%=<>!&|?.]+|[{}()[\],;:]/g;
  return [...text.matchAll(tokenPattern)].map((match) => match[0]);
}

function stripComments(text: string, language: string): string {
  let stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n\r]*/g, " ");
  if (language === "python") {
    stripped = stripped.replace(/#[^\n\r]*/g, " ");
  }
  return stripped;
}

function isCommentNode(node: RawAstNode): boolean {
  return /\bcomment\b|^comment$|_comment$/.test(node.kind);
}

function isSkippablePunctuationNode(node: RawAstNode): boolean {
  return !node.named && isSkippablePunctuation(node.text ?? node.kind);
}

function isSkippablePunctuation(value: string): boolean {
  const token = value.trim();
  if (!/^[^\w\s]+$/.test(token)) {
    return false;
  }
  const semanticPunctuation = new Set([
    "*",
    "&",
    "?",
    "!",
    "=",
    "==",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "+",
    "-",
    "/",
    "%",
    "&&",
    "||",
    "->",
    "=>",
    "::",
    ".",
    "..."
  ]);
  return !semanticPunctuation.has(token);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function addResolvedReceiverCalls(
  graph: CodeSemanticGraph,
  fileNodes: RawAstNode[],
  containersByName: Map<string, CodeContainer>
): void {
  const fieldTypesByOwner = collectFieldTypes(fileNodes);
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

function addCandidateEffects(graph: CodeSemanticGraph, fileNodes: RawAstNode[]): void {
  const nodeById = new Map(fileNodes.map((node) => [node.id, node]));
  const resourcesByName = new Map<string, CodeResource>();
  for (const resource of graph.resources) {
    resourcesByName.set(resource.name.toLowerCase(), resource);
    resourcesByName.set(originalName(resource.name).toLowerCase(), resource);
  }

  for (const fn of graph.functions) {
    if (fn.name === "constructor") {
      continue;
    }
    const node = fn.nodeId ? nodeById.get(fn.nodeId) : undefined;
    if (!node?.text) {
      continue;
    }
    const effect = candidateEffectName(fn.name, node.text);
    if (!effect) {
      continue;
    }
    const mentionedResources = [...new Set(candidateResourceMentions(node.text, resourcesByName))];
    for (const resource of mentionedResources) {
      const anchorId = fn.anchorId;
      const name = uniqueSemanticName(
        shapeTypeName(`${fn.name}_${effect}_${resource.name}_CandidateEffect`),
        graph.candidateEffects.map((item) => item.name),
        `${fn.id}_${resource.id}_${effect}`
      );
      const id = stableShapeId(
        `candidate_effect_${fn.id}_${resource.id}_${effect}`,
        "CandidateEffect"
      );
      if (graph.candidateEffects.some((item) => item.id === id)) {
        continue;
      }
      graph.candidateEffects.push({
        id,
        name,
        functionId: fn.id,
        effect,
        targetResourceId: resource.id,
        sourceRef: fn.sourceRef,
        confidence: "low",
        anchorId,
        summary: `${fn.name} may ${effect.toLowerCase()} ${resource.name}; generated from ${fn.sourceRef}.`
      });
    }
  }
}

function candidateResourceMentions(
  text: string,
  resourcesByName: Map<string, CodeResource>
): CodeResource[] {
  const resources: CodeResource[] = [];
  const tokens = new Set(semanticTokens(text).map((token) => token.toLowerCase()));
  for (const [name, resource] of resourcesByName) {
    if (tokens.has(name.toLowerCase())) {
      resources.push(resource);
    }
  }
  return resources;
}

function candidateEffectName(functionName: string, text: string): string | undefined {
  const haystack = `${functionName} ${text}`.toLowerCase();
  if (/\b(append|add|insert|create|push|write|save|persist)\b/.test(haystack)) {
    return "Append";
  }
  if (/\b(update|set|mutate|replace)\b/.test(haystack)) {
    return "Update";
  }
  if (/\b(delete|remove|purge|clear|drop)\b/.test(haystack)) {
    return "Delete";
  }
  if (/\b(read|get|load|fetch|find|list|query)\b/.test(haystack)) {
    return "Read";
  }
  return undefined;
}

function collectFieldTypes(nodes: RawAstNode[]): Map<string, Map<string, string>> {
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
): AstGenerationResult<string> {
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
      `  storage ast.anchor(${quoteShapeString(anchor.sourceRef)})`,
      `  fingerprint ${anchor.fingerprint.provider}(${quoteShapeString(anchor.fingerprint.value)})`,
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
      return {
        ok: false,
        diagnostics: [
          {
            kind: "error",
            code: "invalid_semantic_relation",
            path: relation.path,
            nodeId: relation.nodeId,
            message: `relation ${relation.id} references invalid endpoint(s): ${relation.fromId} -> ${relation.toId}`
          }
        ]
      };
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

  appendCandidateEffects(lines, graph);
  appendGeneratedFromRelations(lines, graph, seenRelationNames);

  if (includeRawLayer) {
    appendRawAstDeclarations(lines, graph);
  }

  return formatGeneratedShape(`${lines.join("\n")}\n`, `${moduleName}.shape`);
}

function appendCandidateEffects(lines: string[], graph: CodeSemanticGraph): void {
  const functionById = new Map(graph.functions.map((fn) => [fn.id, fn]));
  const ownerById = new Map(graph.containers.map((owner) => [owner.id, owner]));
  const resourceById = new Map(graph.resources.map((resource) => [resource.id, resource]));
  const anchorById = new Map(graph.anchors.map((anchor) => [anchor.id, anchor]));

  for (const candidate of [...graph.candidateEffects].sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const fn = functionById.get(candidate.functionId);
    const owner = fn ? ownerById.get(fn.ownerId) : undefined;
    const resource = resourceById.get(candidate.targetResourceId);
    const anchor = candidate.anchorId ? anchorById.get(candidate.anchorId) : undefined;
    if (!fn || !owner || !resource) {
      continue;
    }
    lines.push(
      "",
      `effect candidate ${candidate.name} {`,
      `  fn ${owner.name}.${fn.name}`,
      `  effect ${candidate.effect}<${resource.name}>`,
      `  source ${sourceLanguage(fn.language)}(${quoteShapeString(candidate.sourceRef)})`,
      `  confidence ${candidate.confidence}`,
      ...(anchor
        ? [
            `  pin ${anchor.name} fingerprint ${anchor.fingerprint.provider}(${quoteShapeString(
              anchor.fingerprint.value
            )})`
          ]
        : []),
      "}"
    );
  }
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
      `  expects ${link.anchor.name} fingerprint ${link.anchor.fingerprint.provider}(${quoteShapeString(
        link.anchor.fingerprint.value
      )})`,
      `  summary ${quoteShapeString(link.summary)}`,
      "}"
    );
  }
}

function formatRawAstShape(
  graph: CodeSemanticGraph,
  moduleName: string
): AstGenerationResult<string> {
  const lines = [`module ${moduleName}`];
  appendRawAstDeclarations(lines, graph);
  return formatGeneratedShape(`${lines.join("\n")}\n`, `${moduleName}.shape`);
}

function formatGeneratedShape(source: string, filePath: string): AstGenerationResult<string> {
  const formatted = formatShapeSource(source, filePath);
  if (formatted.ok) {
    return { ok: true, value: formatted.formatted, diagnostics: [] };
  }
  return {
    ok: false,
    diagnostics: formatted.diagnostics.map((diagnostic) => ({
      kind: "error",
      code: "generated_shape_parse_error",
      message: diagnostic.message,
      path: diagnostic.filePath
    }))
  };
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

function normalizeLanguageName(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }
  const lower = language.toLowerCase();
  if (lower === "ts") {
    return "typescript";
  }
  if (lower === "js" || lower === "jsx") {
    return "javascript";
  }
  if (lower === "tsx") {
    return "tsx";
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
