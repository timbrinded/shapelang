import type {
  AstGenerationDiagnostic,
  CodeSemanticGraph,
  RawAstNode,
  SourceSpan
} from "./ast-generation-types.ts";
import {
  booleanPropertyFromUnknown,
  isRecord,
  makeByteToStringIndexMap,
  numberProperty,
  numberPropertyFromUnknown,
  sliceByByteRange,
  stableHash,
  stableShapeId,
  stringPropertyFromUnknown
} from "./ast-generation-utils.ts";

export function normalizeTreeSitterFile(
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

export function rootNodeFromTree(tree: unknown): unknown | undefined {
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

export function nodeHasError(node: unknown): boolean {
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
