import type { RawAstNode } from "./ast-generation-types.ts";

export function signatureText(text: string, language: string): string {
  const withoutComments = stripComments(normalizeLineEndings(text), language);
  let quote: string | undefined;
  for (let index = 0; index < withoutComments.length; index++) {
    const char = withoutComments[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      return withoutComments.slice(0, index);
    }
  }
  return withoutComments;
}

export function normalizeSemanticTokenText(
  text: string | undefined,
  language: string
): string | undefined {
  if (!text) {
    return undefined;
  }
  const tokens = semanticTokens(stripComments(normalizeLineEndings(text), language)).filter(
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

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
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
