import type { RawAstNode } from "./ast-generation-types.ts";

export function signatureText(text: string, language: string): string {
  const withoutComments = stripComments(text, language);
  const braceIndex = withoutComments.indexOf("{");
  if (braceIndex >= 0) {
    return withoutComments.slice(0, braceIndex);
  }
  const lines = withoutComments.split(/\r?\n/);
  return lines[0] ?? withoutComments;
}

export function normalizeSemanticTokenText(
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

export function semanticTokens(text: string): string[] {
  const tokenPattern =
    /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|==|!=|<=|>=|&&|\|\||->|=>|::|\.\.\.|[+\-*/%=<>!&|?.]+|[{}()[\],;:]/g;
  return [...text.matchAll(tokenPattern)].map((match) => match[0]);
}

export function stripComments(text: string, language: string): string {
  let stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n\r]*/g, " ");
  if (language === "python") {
    stripped = stripped.replace(/#[^\n\r]*/g, " ");
  }
  return stripped;
}

export function isCommentNode(node: RawAstNode): boolean {
  return /\bcomment\b|^comment$|_comment$/.test(node.kind);
}

export function isSkippablePunctuationNode(node: RawAstNode): boolean {
  return !node.named && isSkippablePunctuation(node.text ?? node.kind);
}

export function isSkippablePunctuation(value: string): boolean {
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
