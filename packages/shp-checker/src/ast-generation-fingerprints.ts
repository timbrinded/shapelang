import type {
  AstFingerprint,
  CodeAstAnchor,
  CodeSemanticGraph,
  RawAstNode
} from "./ast-generation-types.ts";
import { groupChildren, isFunctionNode } from "./ast-generation-raw.ts";
import {
  isCommentNode,
  isSkippablePunctuationNode,
  normalizeSemanticTokenText,
  signatureText
} from "./ast-generation-tokens.ts";
import { normalizeLanguageName, sha256Fingerprint, stableJson } from "./ast-generation-utils.ts";

type AstScalar = NonNullable<RawAstNode["attributes"]>[string];

export const AST_SEMANTIC_SUBTREE_FINGERPRINT_PROVIDER = "ast.semantic_subtree_v1";

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

export function fingerprintForAnchor(
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
