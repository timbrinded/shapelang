import type { RawAstNode } from "./ast-generation-types.ts";
import { stableHash } from "./ast-generation-utils.ts";

export function groupChildren(nodes: RawAstNode[]): Map<string, RawAstNode[]> {
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

export function childByField(
  nodeId: string,
  fieldName: string,
  childrenByParent: Map<string, RawAstNode[]>
): RawAstNode | undefined {
  return childrenByParent.get(nodeId)?.find((child) => child.fieldName === fieldName);
}

export function firstMatchingChild(
  nodeId: string,
  childrenByParent: Map<string, RawAstNode[]>,
  predicate: (node: RawAstNode) => boolean
): RawAstNode | undefined {
  return childrenByParent.get(nodeId)?.find(predicate);
}

export function descendants(
  nodeId: string,
  childrenByParent: Map<string, RawAstNode[]>
): RawAstNode[] {
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

export function isTypeDeclarationNode(node: RawAstNode): boolean {
  return /^(struct_item|enum_item|class_declaration|class_definition|interface_declaration|type_declaration|type_spec)$/.test(
    node.kind
  );
}

export function isImplNode(node: RawAstNode): boolean {
  return /^(impl_item|implementation_item)$/.test(node.kind);
}

export function isFunctionNode(node: RawAstNode): boolean {
  return /^(function_item|function_declaration|function_definition|method_definition|method_declaration)$/.test(
    node.kind
  );
}

export function semanticName(
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

export function nameFromText(node: RawAstNode): string | undefined {
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

export function nearestTypeOwner(
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

export function receiverTypeName(node: RawAstNode): string | undefined {
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

export function uniqueNodes(nodes: RawAstNode[]): RawAstNode[] {
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

export function typeLooksStateful(node: RawAstNode): boolean {
  const text = node.text ?? "";
  return (
    /\b(repo|client|store|db|database|queue|sender|receiver|connection|pool)\s*:/i.test(text) ||
    /\b(repo|client|store|db|database|queue|sender|receiver|connection|pool)\s+(?:\*|[A-Z])/i.test(
      text
    )
  );
}

export function fallbackFunctionName(node: RawAstNode): string {
  return `generated${stableHash(node.id).slice(0, 8)}`;
}

export function sourceRef(node: RawAstNode): string {
  if (!node.span) {
    return node.path;
  }
  return `${node.path}:${node.span.startLine}-${node.span.endLine}`;
}
