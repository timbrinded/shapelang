import type { RawAstNode } from "./ast-generation-types.ts";

export function signatureText(text: string, language: string): string {
  const withoutComments = stripComments(normalizeLineEndings(text), language);
  const masked = maskStringLiterals(withoutComments);
  const braceIndex = masked.indexOf("{");
  if (braceIndex >= 0) {
    return withoutComments.slice(0, braceIndex);
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

function maskStringLiterals(text: string): string {
  let masked = "";
  let index = 0;
  while (index < text.length) {
    const quote = text[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      masked += quote;
      index += 1;
      continue;
    }

    masked += " ";
    index += 1;
    while (index < text.length) {
      const char = text[index];
      masked += char === "\n" ? "\n" : " ";
      index += 1;
      if (char === "\\") {
        if (index < text.length) {
          masked += text[index] === "\n" ? "\n" : " ";
          index += 1;
        }
        continue;
      }
      if (char === quote) {
        break;
      }
    }
  }
  return masked;
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
