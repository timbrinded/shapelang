import { formatShapeSource } from "./formatter.ts";

import type {
  AstGenerationDiagnostic,
  AstGenerationResult,
  AstSourceFileInput,
  CodeAstAnchor,
  CodeSemanticGraph,
  GenerateShapeOptions,
  GeneratedShapeOutput,
  TreeSitterParseProvider
} from "./ast-generation-types.ts";
import { buildCodeSemanticGraphFromAstJson } from "./ast-generation-json.ts";
import { parseSourceFilesToCodeSemanticGraph } from "./ast-generation-source.ts";
import {
  normalizeModuleName,
  compareCodepointStrings,
  quoteShapeString,
  shapeRelationName,
  shapeTypeName,
  sourceLanguage,
  uniqueReadableShapeName,
  uniqueShapeName
} from "./ast-generation-utils.ts";

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
  const resources = [...graph.resources].sort((left, right) =>
    compareCodepointStrings(left.name, right.name)
  );
  for (const resource of resources) {
    lines.push(
      "",
      `resource ${resource.name} : GeneratedCandidate {`,
      `  storage ${sourceLanguage(resource.language)}.type(${quoteShapeString(resource.sourceRef)})`,
      "}"
    );
  }

  const components = [...graph.containers].sort((left, right) =>
    compareCodepointStrings(left.name, right.name)
  );
  for (const component of components) {
    lines.push("", `component ${component.name} : GeneratedCandidate {`);
    const functions = graph.functions
      .filter((fn) => fn.ownerId === component.id)
      .sort((left, right) => compareCodepointStrings(left.name, right.name));
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

  const anchors = [...graph.anchors].sort((left, right) =>
    compareCodepointStrings(left.name, right.name)
  );
  for (const anchor of anchors) {
    lines.push(
      "",
      `resource ${anchor.name} : GeneratedAstAnchor {`,
      `  storage ast.anchor(${quoteShapeString(anchor.sourceRef)})`
    );
    if (anchor.fingerprint) {
      lines.push(
        `  fingerprint ${anchor.fingerprint.provider}(${quoteShapeString(anchor.fingerprint.value)})`
      );
    }
    lines.push("}");
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
    compareCodepointStrings(left.id, right.id)
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
    compareCodepointStrings(left.name, right.name)
  )) {
    const fn = functionById.get(candidate.functionId);
    const owner = fn ? ownerById.get(fn.ownerId) : undefined;
    const resource = resourceById.get(candidate.targetResourceId);
    const anchor = candidate.anchorId ? anchorById.get(candidate.anchorId) : undefined;
    if (!fn || !owner || !resource || !anchor?.fingerprint) {
      continue;
    }
    lines.push(
      "",
      `effect candidate ${candidate.name} {`,
      `  fn ${owner.name}.${fn.name}`,
      `  effect ${candidate.effect}<${resource.name}>`,
      `  source ${sourceLanguage(fn.language)}(${quoteShapeString(candidate.sourceRef)})`,
      `  confidence ${candidate.confidence}`,
      `  pin ${anchor.name} fingerprint ${anchor.fingerprint.provider}(${quoteShapeString(
        anchor.fingerprint.value
      )})`,
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

  for (const link of semanticLinks.sort((left, right) =>
    compareCodepointStrings(left.name, right.name)
  )) {
    const relationName = uniqueReadableShapeName(link.name, seenRelationNames);
    lines.push(
      "",
      `relation ${relationName} {`,
      "  kind generated_from",
      `  connects ${link.from} -> ${link.anchor.name}`,
      `  roles { ${link.from} as generated, ${link.anchor.name} as syntax }`
    );
    if (link.anchor.fingerprint) {
      lines.push(
        `  expects ${link.anchor.name} fingerprint ${link.anchor.fingerprint.provider}(${quoteShapeString(
          link.anchor.fingerprint.value
        )})`
      );
    }
    lines.push(`  summary ${quoteShapeString(link.summary)}`, "}");
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
  for (const file of [...graph.files].sort((left, right) =>
    compareCodepointStrings(left.path, right.path)
  )) {
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

  for (const node of [...graph.rawNodes].sort((left, right) =>
    compareCodepointStrings(left.id, right.id)
  )) {
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
