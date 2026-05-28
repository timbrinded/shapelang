import type {
  CodeAstAnchor,
  CodeContainer,
  CodeResource,
  CodeSemanticGraph,
  RawAstNode
} from "./ast-generation-types.ts";
import { fingerprintForAnchor } from "./ast-generation-fingerprints.ts";
import {
  baseNameWithoutExtension,
  originalName,
  shapeFunctionName,
  shapeTypeName,
  stableShapeId,
  uniqueSemanticName
} from "./ast-generation-utils.ts";
import { semanticTokens } from "./ast-generation-tokens.ts";
import {
  childByField,
  descendants,
  fallbackFunctionName,
  firstMatchingChild,
  groupChildren,
  isFunctionNode,
  isImplNode,
  isTypeDeclarationNode,
  nameFromText,
  nearestTypeOwner,
  receiverTypeName,
  semanticName,
  sourceRef,
  typeLooksStateful,
  uniqueNodes
} from "./ast-generation-raw.ts";

const DATA_RESOURCE_NAME_HINT =
  /(Event|Record|Message|Config|State|Entity|Snapshot|Request|Response|Table|Queue|Topic|Payload)$/;
const CALL_RECEIVER_PATTERN =
  /\b(?:self|this)\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;

export function addSemanticProjection(graph: CodeSemanticGraph): void {
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
