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

  function addNode(
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
    return id;
  }

  let rootNodeId = "";
  const stack: {
    node: unknown;
    parentId: string | undefined;
    childIndex: number | undefined;
    fieldName: string | undefined;
  }[] = [{ node: root, parentId: undefined, childIndex: undefined, fieldName: undefined }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }
    const id = addNode(frame.node, frame.parentId, frame.childIndex, frame.fieldName);
    if (!frame.parentId) {
      rootNodeId = id;
    }
    const children = nodeChildren(frame.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child) {
        continue;
      }
      stack.push({ node: child.node, parentId: id, childIndex: index, fieldName: child.fieldName });
    }
  }

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

type TreeSitterChild = {
  node: unknown;
  fieldName?: string;
};

function nodeChildren(node: unknown): TreeSitterChild[] {
  const cursorChildren = nodeChildrenFromCursor(node);
  if (cursorChildren) {
    return cursorChildren;
  }
  const children = property(node, "children");
  if (Array.isArray(children)) {
    return children.map((child) => ({ node: child }));
  }
  const count =
    callNumberMethod(node, ["childCount", "child_count"]) ??
    numberPropertyFromUnknown(node, "childCount") ??
    numberPropertyFromUnknown(node, "child_count") ??
    0;
  const result: TreeSitterChild[] = [];
  for (let index = 0; index < count; index += 1) {
    const child = callMethod(node, ["child"], [index]);
    if (child) {
      result.push({ node: child });
    }
  }
  return result;
}

function nodeChildrenFromCursor(node: unknown): TreeSitterChild[] | undefined {
  const cursor = callMethod(node, ["walk"], []);
  if (!cursor) {
    return undefined;
  }
  const hasFirstChild = callBooleanMethod(cursor, ["gotoFirstChild", "goto_first_child"]);
  if (!hasFirstChild) {
    return [];
  }
  const result: TreeSitterChild[] = [];
  do {
    const child = propertyOrMethodValue(cursor, ["currentNode", "current_node", "node"]);
    if (child) {
      result.push({
        node: child,
        fieldName: callStringMethod(cursor, ["fieldName", "field_name"])
      });
    }
  } while (callBooleanMethod(cursor, ["gotoNextSibling", "goto_next_sibling"]));
  return result;
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
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (
      callBooleanMethod(current, ["hasError", "has_error"]) ??
      booleanPropertyFromUnknown(current, "hasError") ??
      false
    ) {
      return true;
    }
    if (nodeKind(current) === "ERROR" || nodeKind(current) === "MISSING") {
      return true;
    }
    const children = nodeChildren(current);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        stack.push(child.node);
      }
    }
  }
  return false;
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
