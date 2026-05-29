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
import {
  compareCodepointStrings,
  normalizeLanguageName,
  sha256Fingerprint,
  stableJson
} from "./ast-generation-utils.ts";

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
  input: Omit<CodeAstAnchor, "id" | "name" | "fingerprint">,
  context: {
    childrenByParent?: Map<string, RawAstNode[]>;
    nodeById?: Map<string, RawAstNode>;
  } = {}
): AstFingerprint | undefined {
  const nodeById = context.nodeById ?? new Map(graph.rawNodes.map((node) => [node.id, node]));
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

  const payload = canonicalFingerprintPayload(graph, input, node, context.childrenByParent);
  if (!payload) {
    graph.diagnostics.push({
      kind: "warning",
      code: "missing_fingerprint_tokens",
      path: input.path,
      nodeId: input.nodeId,
      message: `cannot compute ${provider} for ${input.target}; skipping fingerprint because AST JSON/source node lacks token text or semantic child tokens`
    });
    return undefined;
  }

  return { provider, value: sha256Fingerprint(stableJson(payload)) };
}

function canonicalFingerprintPayload(
  graph: CodeSemanticGraph,
  input: Omit<CodeAstAnchor, "id" | "name" | "fingerprint">,
  node: RawAstNode,
  existingChildrenByParent?: Map<string, RawAstNode[]>
): Record<string, unknown> | undefined {
  const childrenByParent = existingChildrenByParent ?? groupChildren(graph.rawNodes);
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
  const results = new Map<string, CanonicalFingerprintResult>();
  const stack: { node: RawAstNode; entered: boolean }[] = [{ node, entered: false }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }
    if (!frame.entered) {
      if (isCommentNode(frame.node)) {
        results.set(frame.node.id, { hasToken: false });
        continue;
      }
      stack.push({ node: frame.node, entered: true });
      const pruneFunctionBody =
        options.mode === "declaration_shell" &&
        frame.node.id !== options.rootId &&
        isFunctionNode(frame.node);
      if (!pruneFunctionBody) {
        const children = childrenByParent.get(frame.node.id) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          if (child) {
            stack.push({ node: child, entered: false });
          }
        }
      }
      continue;
    }

    const children = childrenByParent.get(frame.node.id) ?? [];
    const pruneFunctionBody =
      options.mode === "declaration_shell" &&
      frame.node.id !== options.rootId &&
      isFunctionNode(frame.node);
    const canonicalChildren: CanonicalFingerprintNode[] = [];
    let hasToken = false;

    if (!pruneFunctionBody) {
      for (const child of children) {
        const childResult = results.get(child.id) ?? { hasToken: false };
        if (childResult.node) {
          canonicalChildren.push(childResult.node);
        }
        hasToken ||= childResult.hasToken;
      }
    }

    const attributes = canonicalAttributes(frame.node);
    const token =
      pruneFunctionBody && frame.node.text
        ? normalizeSemanticTokenText(
            signatureText(frame.node.text, frame.node.language),
            frame.node.language
          )
        : children.length === 0
          ? normalizeSemanticTokenText(frame.node.text, frame.node.language)
          : undefined;
    if (token) {
      hasToken = true;
    }

    if (
      !token &&
      canonicalChildren.length === 0 &&
      attributes === undefined &&
      !frame.node.semanticLabel &&
      isSkippablePunctuationNode(frame.node)
    ) {
      results.set(frame.node.id, { hasToken });
      continue;
    }

    const canonical: CanonicalFingerprintNode = {
      kind: frame.node.kind,
      named: frame.node.named
    };
    if (frame.node.fieldName) {
      canonical.field = frame.node.fieldName;
    }
    if (frame.node.semanticLabel) {
      canonical.label = frame.node.semanticLabel;
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
    results.set(frame.node.id, { node: canonical, hasToken });
  }

  return results.get(node.id) ?? { hasToken: false };
}

function canonicalAttributes(node: RawAstNode): Record<string, AstScalar> | undefined {
  if (!node.attributes) {
    return undefined;
  }
  const entries = Object.entries(node.attributes).sort(([left], [right]) =>
    compareCodepointStrings(left, right)
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}
