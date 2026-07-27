import { isIdentifierPart, isIdentifierStart, isWhitespace } from "./analyzer-lexical.ts";
import type { SourceSpan } from "./analyzer-types.ts";

type FunctionScope = {
  anchor: string;
  bodySpan: SourceSpan;
};

const NON_METHOD_IDENTIFIERS = new Set([
  "catch",
  "do",
  "for",
  "function",
  "if",
  "new",
  "switch",
  "while",
  "with"
]);

const METHOD_MODIFIERS = new Set([
  "abstract",
  "async",
  "function",
  "get",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "set",
  "static"
]);

const TYPE_PREFIX_KEYWORDS = new Set([
  "abstract",
  "infer",
  "keyof",
  "new",
  "readonly",
  "typeof",
  "unique"
]);

const TYPE_INFIX_KEYWORDS = new Set(["extends", "in", "is"]);

export function collectTypeScriptFunctionScopes(masked: string): FunctionScope[] {
  const scopes: FunctionScope[] = [];
  collectFunctionDeclarationScopes(masked, scopes);
  collectAssignedArrowScopes(masked, scopes);
  collectMethodScopes(masked, scopes);

  const deduplicated = new Map<string, FunctionScope>();
  for (const scope of scopes) {
    deduplicated.set(`${scope.anchor}:${scope.bodySpan.start}:${scope.bodySpan.end}`, scope);
  }
  return [...deduplicated.values()].sort(
    (left, right) =>
      left.bodySpan.start - right.bodySpan.start ||
      right.bodySpan.end - left.bodySpan.end ||
      left.anchor.localeCompare(right.anchor)
  );
}

export function sourceAnchorAtOffset(scopes: FunctionScope[], offset: number): string | undefined {
  let best: FunctionScope | undefined;
  for (const scope of scopes) {
    if (scope.bodySpan.start > offset || offset >= scope.bodySpan.end) {
      continue;
    }
    if (
      best === undefined ||
      scope.bodySpan.end - scope.bodySpan.start < best.bodySpan.end - best.bodySpan.start
    ) {
      best = scope;
    }
  }
  return best?.anchor;
}

function collectFunctionDeclarationScopes(masked: string, scopes: FunctionScope[]): void {
  const pattern = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g;
  for (const match of masked.matchAll(pattern)) {
    const anchor = match[1];
    if (!anchor) {
      continue;
    }
    const parameterStart = findParameterListAfterName(masked, match.index + match[0].length);
    if (parameterStart === undefined) {
      continue;
    }
    addFunctionScopeAfterParameters(masked, scopes, anchor, parameterStart);
  }
}

function collectAssignedArrowScopes(masked: string, scopes: FunctionScope[]): void {
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of masked.matchAll(pattern)) {
    const anchor = match[1];
    if (!anchor) {
      continue;
    }
    const declarationEnd = match.index + match[0].length;
    const assignment = findVariableAssignment(masked, declarationEnd);
    if (assignment === undefined) {
      continue;
    }
    const arrow = findTopLevelArrow(masked, assignment + 1);
    if (arrow === undefined) {
      continue;
    }
    const bodyStart = skipMaskedWhitespace(masked, arrow + 2);
    if (masked[bodyStart] !== "{") {
      continue;
    }
    addBalancedFunctionScope(masked, scopes, anchor, bodyStart);
  }
}

function collectMethodScopes(masked: string, scopes: FunctionScope[]): void {
  const pattern = /\b([A-Za-z_$][\w$]*)/g;
  for (const match of masked.matchAll(pattern)) {
    const anchor = match[1];
    if (!anchor || NON_METHOD_IDENTIFIERS.has(anchor)) {
      continue;
    }
    const parameterStart = findParameterListAfterName(masked, match.index + match[0].length);
    if (parameterStart === undefined) {
      continue;
    }
    const nameStart = match.index;
    const previous = previousNonWhitespace(masked, nameStart);
    const previousIdentifier =
      previous !== undefined && isIdentifierPart(previous.char)
        ? identifierEndingAt(masked, previous.offset)
        : undefined;
    if (
      previous !== undefined &&
      (previous.char === "." ||
        previous.char === "?" ||
        previous.char === "]" ||
        (isIdentifierPart(previous.char) &&
          (previousIdentifier === undefined || !METHOD_MODIFIERS.has(previousIdentifier))))
    ) {
      continue;
    }
    addFunctionScopeAfterParameters(masked, scopes, anchor, parameterStart);
  }
}

function findParameterListAfterName(masked: string, nameEnd: number): number | undefined {
  let cursor = skipMaskedWhitespace(masked, nameEnd);
  if (masked[cursor] === "<") {
    const typeParametersEnd = findMatchingTypeParameterList(masked, cursor);
    if (typeParametersEnd === undefined) {
      return undefined;
    }
    cursor = skipMaskedWhitespace(masked, typeParametersEnd + 1);
  }
  return masked[cursor] === "(" ? cursor : undefined;
}

function findMatchingTypeParameterList(masked: string, start: number): number | undefined {
  if (masked[start] !== "<") {
    return undefined;
  }

  const delimiters: ("<" | "(" | "[" | "{")[] = ["<"];
  for (let cursor = start + 1; cursor < masked.length; cursor += 1) {
    const char = masked[cursor] ?? "";
    if (char === "<" || char === "(" || char === "[" || char === "{") {
      delimiters.push(char);
      continue;
    }
    if (char === "=" && masked[cursor + 1] === ">") {
      cursor += 1;
      continue;
    }
    if (char !== ">" && char !== ")" && char !== "]" && char !== "}") {
      continue;
    }

    const expected = char === ">" ? "<" : char === ")" ? "(" : char === "]" ? "[" : "{";
    if (delimiters.pop() !== expected) {
      return undefined;
    }
    if (delimiters.length === 0) {
      return char === ">" ? cursor : undefined;
    }
  }

  return undefined;
}

function addFunctionScopeAfterParameters(
  masked: string,
  scopes: FunctionScope[],
  anchor: string,
  parameterStart: number
): void {
  const parameterEnd = findMatchingDelimiter(masked, parameterStart, "(", ")");
  if (parameterEnd === undefined) {
    return;
  }
  const bodyStart = findFunctionBodyStart(masked, parameterEnd + 1);
  if (bodyStart !== undefined) {
    addBalancedFunctionScope(masked, scopes, anchor, bodyStart);
  }
}

function addBalancedFunctionScope(
  masked: string,
  scopes: FunctionScope[],
  anchor: string,
  bodyStart: number
): void {
  const bodyEnd = findMatchingDelimiter(masked, bodyStart, "{", "}");
  if (bodyEnd === undefined) {
    return;
  }
  scopes.push({
    anchor,
    bodySpan: {
      start: bodyStart,
      end: bodyEnd + 1
    }
  });
}

function findFunctionBodyStart(masked: string, start: number): number | undefined {
  let cursor = skipMaskedWhitespace(masked, start);
  if (masked[cursor] === "{") {
    return cursor;
  }
  if (masked[cursor] !== ":") {
    return undefined;
  }
  return findBodyAfterReturnType(masked, cursor + 1);
}

function findBodyAfterReturnType(masked: string, start: number): number | undefined {
  const delimiters: ("(" | "[" | "<" | "{")[] = [];
  let expectsOperand = true;
  let cursor = start;

  while (cursor < masked.length) {
    const char = masked[cursor] ?? "";
    if (isWhitespace(char)) {
      cursor += 1;
      continue;
    }
    if (isIdentifierStart(char)) {
      const tokenStart = cursor;
      cursor += 1;
      while (cursor < masked.length && isIdentifierPart(masked[cursor] ?? "")) {
        cursor += 1;
      }
      const token = masked.slice(tokenStart, cursor);
      expectsOperand = TYPE_PREFIX_KEYWORDS.has(token) || TYPE_INFIX_KEYWORDS.has(token);
      continue;
    }
    if (char === "{") {
      if (delimiters.length === 0 && !expectsOperand) {
        return cursor;
      }
      delimiters.push("{");
      expectsOperand = true;
      cursor += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "<") {
      delimiters.push(char);
      expectsOperand = true;
      cursor += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === ">" || char === "}") {
      const expected = char === ")" ? "(" : char === "]" ? "[" : char === ">" ? "<" : "{";
      if (delimiters.pop() !== expected) {
        return undefined;
      }
      expectsOperand = false;
      cursor += 1;
      continue;
    }
    if (char === ";" || char === ",") {
      if (delimiters.length === 0) {
        return undefined;
      }
      expectsOperand = true;
      cursor += 1;
      continue;
    }
    if (
      char === "|" ||
      char === "&" ||
      char === "?" ||
      char === ":" ||
      char === "." ||
      (char === "=" && masked[cursor + 1] === ">")
    ) {
      expectsOperand = true;
      cursor += char === "=" ? 2 : 1;
      continue;
    }
    if (char === "*" || char === "!") {
      expectsOperand = false;
      cursor += 1;
      continue;
    }
    return undefined;
  }

  return undefined;
}

function findVariableAssignment(masked: string, start: number): number | undefined {
  let cursor = start;
  while (cursor < masked.length) {
    const char = masked[cursor] ?? "";
    if (char === "=" && masked[cursor + 1] !== ">") {
      return cursor;
    }
    if (char === ";" || char === "\n" || char === "\r" || char === ",") {
      return undefined;
    }
    cursor += 1;
  }
  return undefined;
}

function findTopLevelArrow(masked: string, start: number): number | undefined {
  const delimiters: string[] = [];
  let cursor = start;

  while (cursor < masked.length) {
    const char = masked[cursor] ?? "";
    if (char === "(" || char === "[" || char === "{") {
      delimiters.push(char);
    } else if (char === ")" || char === "]" || char === "}") {
      const expected = char === ")" ? "(" : char === "]" ? "[" : "{";
      if (delimiters.pop() !== expected) {
        return undefined;
      }
    } else if (char === "=" && masked[cursor + 1] === ">" && delimiters.length === 0) {
      return cursor;
    } else if ((char === ";" || char === "\n" || char === "\r") && delimiters.length === 0) {
      return undefined;
    }
    cursor += 1;
  }
  return undefined;
}

function findMatchingDelimiter(
  masked: string,
  start: number,
  opening: "(" | "{",
  closing: ")" | "}"
): number | undefined {
  if (masked[start] !== opening) {
    return undefined;
  }
  let depth = 1;
  for (let cursor = start + 1; cursor < masked.length; cursor += 1) {
    if (masked[cursor] === opening) {
      depth += 1;
    } else if (masked[cursor] === closing) {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
  }
  return undefined;
}

function skipMaskedWhitespace(masked: string, start: number): number {
  let cursor = start;
  while (cursor < masked.length && isWhitespace(masked[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function previousNonWhitespace(
  masked: string,
  start: number
): { char: string; offset: number } | undefined {
  let cursor = start - 1;
  while (cursor >= 0 && isWhitespace(masked[cursor] ?? "")) {
    cursor -= 1;
  }
  const char = masked[cursor];
  return char === undefined ? undefined : { char, offset: cursor };
}

function identifierEndingAt(masked: string, end: number): string | undefined {
  if (!isIdentifierPart(masked[end] ?? "")) {
    return undefined;
  }
  let start = end;
  while (start > 0 && isIdentifierPart(masked[start - 1] ?? "")) {
    start -= 1;
  }
  return masked.slice(start, end + 1);
}
