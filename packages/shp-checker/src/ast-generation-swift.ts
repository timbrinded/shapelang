import type { AstGenerationDiagnostic, RawAstNode } from "./ast-generation-types.ts";
import { isCommentNode } from "./ast-generation-tokens.ts";
import { compareCodepointStrings, shapeFunctionName, stableHash } from "./ast-generation-utils.ts";

type Children = Map<string, RawAstNode[]>;

export type SwiftFunction = {
  name: string;
  sourceSymbol: string | undefined;
};

export type SwiftType = {
  name: string;
  nodes: RawAstNode[];
  functions: RawAstNode[];
};

export function isSwiftType(node: RawAstNode): boolean {
  return node.kind === "class_declaration" || node.kind === "protocol_declaration";
}

export function isSwiftFunction(node: RawAstNode, children: Children): boolean {
  return (
    /^(function_declaration|protocol_function_declaration|init_declaration|deinit_declaration|subscript_declaration|protocol_property_declaration)$/.test(
      node.kind
    ) ||
    (node.kind === "property_declaration" &&
      (children.get(node.id) ?? []).some((child) => child.fieldName === "computed_value"))
  );
}

// Use the parser's leaves: Swift literals and Unicode are already tokenized.
// Retokenizing them as JavaScript loses URL contents and non-ASCII characters.
export function swiftTokens(
  node: RawAstNode,
  children: Children,
  signaturesOnly = false
): string[] {
  const tokens: string[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || isCommentNode(current)) continue;
    const nested =
      signaturesOnly && isSwiftFunction(current, children)
        ? swiftSignatureChildren(current, children)
        : (children.get(current.id) ?? []);
    if (nested.length === 0) {
      if (current.text) tokens.push(current.text);
    } else {
      for (let index = nested.length - 1; index >= 0; index--) {
        const child = nested[index];
        if (child) stack.push(child);
      }
    }
  }
  return tokens;
}

export function swiftSignatureChildren(node: RawAstNode, children: Children): RawAstNode[] {
  return (children.get(node.id) ?? []).filter(
    (child) =>
      child.fieldName !== "body" &&
      child.fieldName !== "computed_value" &&
      child.kind !== "computed_property" &&
      child.kind !== "property_observers"
  );
}

export function collectSwiftDeclarations(
  nodes: RawAstNode[],
  children: Children,
  nodeById: Map<string, RawAstNode>
): {
  types: SwiftType[];
  functions: Map<string, SwiftFunction>;
  freeFunctions: RawAstNode[];
  diagnostics: AstGenerationDiagnostic[];
} {
  const typeNames = new Map<string, string>();
  const typesByName = new Map<string, SwiftType>();
  const functions = new Map<string, SwiftFunction>();
  const freeFunctions: RawAstNode[] = [];
  const diagnostics: AstGenerationDiagnostic[] = [];

  function lexicalOwner(node: RawAstNode): RawAstNode | undefined {
    let parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    while (parent) {
      if (isSwiftType(parent) || isSwiftFunction(parent, children)) return parent;
      parent = parent.parentId ? nodeById.get(parent.parentId) : undefined;
    }
    return undefined;
  }

  function typeName(node: RawAstNode): string | undefined {
    const cached = typeNames.get(node.id);
    if (cached) return cached;
    const nameNode = (children.get(node.id) ?? []).find((child) => child.fieldName === "name");
    const name = nameNode ? swiftTokens(nameNode, children).join("") : node.semanticLabel;
    if (!name) return undefined;
    const owner = lexicalOwner(node);
    if (owner && !isSwiftType(owner)) return undefined;
    const ownerName = owner ? typeName(owner) : undefined;
    if (owner && !ownerName) return undefined;
    const qualified = ownerName ? `${ownerName}.${name}` : name;
    typeNames.set(node.id, qualified);
    return qualified;
  }

  for (const node of nodes.filter(isSwiftType)) {
    const name = typeName(node);
    if (!name) continue;
    const group = typesByName.get(name) ?? { name, nodes: [], functions: [] };
    group.nodes.push(node);
    typesByName.set(name, group);
  }

  for (const node of nodes.filter((node) => isSwiftFunction(node, children))) {
    const owner = lexicalOwner(node);
    if (owner && !isSwiftType(owner)) continue;
    const ownerName = owner ? typeName(owner) : undefined;
    if (owner && !ownerName) continue;
    const signature = functionSignature(node, children);
    if (!signature) continue;
    const constraints = owner
      ? (children.get(owner.id) ?? [])
          .filter((child) => child.kind === "type_constraints")
          .flatMap((child) => swiftTokens(child, children))
          .join(" ")
      : "";
    const requirement = node.kind.startsWith("protocol_") ? " [requirement]" : "";
    const sourceSymbol = `${ownerName ? `${ownerName}.` : ""}${signature}${constraints ? ` [${constraints}]` : ""}${requirement}`;
    const name = shapeFunctionName(signature).replace(/_+/g, "_").replace(/_+$/, "");
    functions.set(node.id, { name, sourceSymbol });
    if (ownerName) typesByName.get(ownerName)?.functions.push(node);
    else freeFunctions.push(node);
  }

  for (const type of typesByName.values()) {
    const extension = (node: RawAstNode) =>
      (children.get(node.id) ?? []).some((child) => child.kind === "extension");
    type.nodes.sort(
      (left, right) =>
        Number(extension(left)) - Number(extension(right)) ||
        compareCodepointStrings(
          swiftTokens(left, children, true).join("\0"),
          swiftTokens(right, children, true).join("\0")
        )
    );
  }

  // Disambiguate readable names using syntax identity, never traversal positions.
  for (const group of [...typesByName.values()]
    .map((type) => type.functions)
    .concat([freeFunctions])) {
    const counts = new Map<string, number>();
    const symbolCounts = new Map<string, number>();
    for (const node of group) {
      const fn = functions.get(node.id);
      if (fn) counts.set(fn.name, (counts.get(fn.name) ?? 0) + 1);
      if (fn?.sourceSymbol)
        symbolCounts.set(fn.sourceSymbol, (symbolCounts.get(fn.sourceSymbol) ?? 0) + 1);
    }
    for (const node of group) {
      const fn = functions.get(node.id);
      if (!fn?.sourceSymbol) continue;
      if ((counts.get(fn.name) ?? 0) > 1) fn.name += `_${stableHash(fn.sourceSymbol)}`;
      if ((symbolCounts.get(fn.sourceSymbol) ?? 0) > 1) {
        diagnostics.push({
          kind: "warning",
          code: "ambiguous_swift_symbol",
          path: node.path,
          nodeId: node.id,
          message: `Swift symbol ${fn.sourceSymbol} has multiple declarations; using a file-only source reference`
        });
        fn.sourceSymbol = undefined;
      }
    }
  }
  return { types: [...typesByName.values()], functions, freeFunctions, diagnostics };
}

function functionSignature(node: RawAstNode, children: Children): string | undefined {
  const parts = swiftSignatureChildren(node, children);
  const property =
    node.kind === "property_declaration" || node.kind === "protocol_property_declaration";
  const nameNode = parts.find((child) => child.fieldName === "name");
  const name =
    node.kind === "subscript_declaration"
      ? "subscript"
      : node.kind === "deinit_declaration"
        ? "deinit"
        : nameNode
          ? swiftTokens(nameNode, children)
              .filter((token) => token !== "var" && token !== "let")
              .join("")
          : node.semanticLabel;
  if (!name) return undefined;
  if (property) return name;
  const parameters = parts
    .filter((child) => child.kind === "parameter")
    .map((parameter) => {
      const fields = children.get(parameter.id) ?? [];
      const colon = fields.findIndex((child) => child.kind === ":");
      const label =
        fields.find((child) => child.fieldName === "external_name") ??
        fields.find((child) => child.fieldName === "name");
      const type = fields
        .slice(colon + 1)
        .flatMap((child) => swiftTokens(child, children))
        .join("");
      return `${label?.text ?? "_"}:${type}`;
    });
  const generics = parts
    .filter((child) => child.kind === "type_parameters")
    .flatMap((child) => swiftTokens(child, children))
    .join("");
  const closingParen = parts.findIndex((child) => child.kind === ")");
  const suffix =
    closingParen < 0
      ? ""
      : parts
          .slice(closingParen + 1)
          .flatMap((child) => swiftTokens(child, children))
          .join(" ");
  const modifiers = parts
    .filter((child) => child.kind === "modifiers")
    .flatMap((child) => swiftTokens(child, children));
  const dispatch = modifiers.includes("static")
    ? "static "
    : modifiers.includes("class")
      ? "class "
      : "";
  const failable =
    node.kind === "init_declaration" && parts.some((child) => child.kind === "?") ? "?" : "";
  return `${dispatch}${name}${failable}${generics}(${parameters.join(",")})${suffix ? ` ${suffix}` : ""}`;
}
