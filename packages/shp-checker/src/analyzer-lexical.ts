import type { LexicalRegion, LexicalScan, LiteralRegion, SourceSpan } from "./analyzer-types.ts";

export type StaticTargetRead = {
  value: string;
  end: number;
};

export function scanLexicalRegions(source: string, dialect: "sql" | "typescript"): LexicalScan {
  const masked = source.split("");
  const regionsByStart = new Map<number, LexicalRegion>();
  let cursor = 0;

  while (cursor < source.length) {
    const start = cursor;
    const lineComment =
      dialect === "typescript"
        ? source.startsWith("//", start)
        : source.startsWith("--", start) || source[start] === "#";
    let region: LexicalRegion;
    if (lineComment || source.startsWith("/*", start)) {
      const end = lineComment
        ? consumeLineComment(source, start)
        : consumeBlockComment(source, start, dialect === "sql");
      region = { kind: "comment", span: { start, end } };
    } else {
      const char = source[start] ?? "";
      let consumed: ReturnType<typeof consumeQuoted>;
      let literalKind: LiteralRegion["literalKind"];
      let contentStart = start + 1;
      let staticLiteral = true;
      if (char === "'" || char === '"' || (dialect === "sql" && char === "`")) {
        consumed = consumeQuoted(source, start, char, dialect === "sql");
        literalKind = char === "'" ? "single" : dialect === "sql" ? "quoted_identifier" : "double";
      } else if (dialect === "typescript" && char === "`") {
        const template = consumeTemplate(source, start);
        consumed = template;
        literalKind = "template";
        staticLiteral = template.static;
      } else if (dialect === "sql" && char === "[") {
        consumed = consumeBracketIdentifier(source, start);
        literalKind = "quoted_identifier";
      } else if (dialect === "sql" && char === "$") {
        const delimiter = readDollarQuoteDelimiter(source, start);
        if (!delimiter) {
          cursor += 1;
          continue;
        }
        consumed = consumeDollarQuoted(source, start, delimiter);
        literalKind = "dollar";
        contentStart = start + delimiter.length;
      } else {
        cursor += 1;
        continue;
      }

      region = {
        kind: "literal",
        span: { start, end: consumed.end },
        contentSpan: { start: contentStart, end: consumed.contentEnd },
        literalKind,
        closed: consumed.closed,
        static: staticLiteral
      };
    }
    addMaskedRegion(source, masked, regionsByStart, region);
    cursor = region.span.end;
  }

  return {
    masked: masked.join(""),
    regionsByStart
  };
}

export function literalAt(
  regionsByStart: Map<number, LexicalRegion>,
  offset: number
): LiteralRegion | undefined {
  const region = regionsByStart.get(offset);
  return region?.kind === "literal" ? region : undefined;
}

export function skipTrivia(
  source: string,
  regionsByStart: Map<number, LexicalRegion>,
  start: number
): number {
  let cursor = start;

  while (cursor < source.length) {
    while (cursor < source.length && isWhitespace(source[cursor] ?? "")) {
      cursor += 1;
    }
    const region = regionsByStart.get(cursor);
    if (region?.kind !== "comment") {
      return cursor;
    }
    cursor = region.span.end;
  }

  return cursor;
}

export function readUnquotedIdentifier(
  source: string,
  start: number
): StaticTargetRead | undefined {
  if (!isIdentifierStart(source[start] ?? "")) {
    return undefined;
  }
  let cursor = start + 1;
  while (cursor < source.length && isIdentifierPart(source[cursor] ?? "")) {
    cursor += 1;
  }
  const value = source.slice(start, cursor);
  return value === "$" ? undefined : { value, end: cursor };
}

export function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

export function isHorizontalWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r";
}

export function isIdentifierStart(char: string): boolean {
  return (
    (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_" || char === "$"
  );
}

export function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

export function normalizeStaticTarget(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && !normalized.includes("\n") && !normalized.includes("\r")
    ? normalized
    : undefined;
}

export function trimHorizontalWhitespace(source: string, span: SourceSpan): SourceSpan {
  let { start, end } = span;
  while (start < end && isHorizontalWhitespace(source[start] ?? "")) {
    start += 1;
  }
  while (end > start && isHorizontalWhitespace(source[end - 1] ?? "")) {
    end -= 1;
  }
  return { start, end };
}

export function shiftSpan(span: SourceSpan, offset: number): SourceSpan {
  return {
    start: span.start + offset,
    end: span.end + offset
  };
}

function consumeLineComment(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") {
    cursor += 1;
  }
  return cursor;
}

function consumeBlockComment(source: string, start: number, allowsNesting: boolean): number {
  let cursor = start + 2;
  let depth = 1;

  while (cursor < source.length && depth > 0) {
    if (allowsNesting && source.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 2;
    } else if (source.startsWith("*/", cursor)) {
      depth -= 1;
      cursor += 2;
    } else {
      cursor += 1;
    }
  }

  return cursor;
}

function consumeQuoted(
  source: string,
  start: number,
  quote: "'" | '"' | "`",
  allowsNewlines: boolean
): { end: number; contentEnd: number; closed: boolean } {
  let cursor = start + 1;

  while (cursor < source.length) {
    const char = source[cursor] ?? "";
    if (!allowsNewlines && (char === "\n" || char === "\r")) {
      return { end: cursor, contentEnd: cursor, closed: false };
    }
    if (char === "\\") {
      cursor = Math.min(source.length, cursor + 2);
      continue;
    }
    if (char === quote) {
      if (allowsNewlines && source[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return { end: cursor + 1, contentEnd: cursor, closed: true };
    }
    cursor += 1;
  }

  return { end: source.length, contentEnd: source.length, closed: false };
}

function consumeTemplate(
  source: string,
  start: number
): { end: number; contentEnd: number; closed: boolean; static: boolean } {
  const modes: ({ kind: "template" } | { kind: "expression"; depth: number })[] = [
    { kind: "template" }
  ];
  let cursor = start + 1;
  let staticTemplate = true;

  while (cursor < source.length && modes.length > 0) {
    const mode = modes[modes.length - 1];
    if (!mode) {
      break;
    }
    if (mode.kind === "template") {
      if (source[cursor] === "\\") {
        cursor = Math.min(source.length, cursor + 2);
      } else if (source.startsWith("${", cursor)) {
        staticTemplate = false;
        modes.push({ kind: "expression", depth: 1 });
        cursor += 2;
      } else if (source[cursor] === "`") {
        modes.pop();
        cursor += 1;
        if (modes.length === 0) {
          return {
            end: cursor,
            contentEnd: cursor - 1,
            closed: true,
            static: staticTemplate
          };
        }
      } else {
        cursor += 1;
      }
      continue;
    }

    const char = source[cursor] ?? "";
    if (source.startsWith("//", cursor)) {
      cursor = consumeLineComment(source, cursor);
    } else if (source.startsWith("/*", cursor)) {
      cursor = consumeBlockComment(source, cursor, false);
    } else if (char === "'" || char === '"') {
      cursor = consumeQuoted(source, cursor, char, false).end;
    } else if (char === "`") {
      modes.push({ kind: "template" });
      cursor += 1;
    } else if (char === "{") {
      mode.depth += 1;
      cursor += 1;
    } else if (char === "}") {
      mode.depth -= 1;
      cursor += 1;
      if (mode.depth === 0) {
        modes.pop();
      }
    } else {
      cursor += 1;
    }
  }

  return {
    end: source.length,
    contentEnd: source.length,
    closed: false,
    static: staticTemplate
  };
}

function consumeBracketIdentifier(
  source: string,
  start: number
): { end: number; contentEnd: number; closed: boolean } {
  let cursor = start + 1;

  while (cursor < source.length) {
    if (source[cursor] === "]") {
      if (source[cursor + 1] === "]") {
        cursor += 2;
        continue;
      }
      return { end: cursor + 1, contentEnd: cursor, closed: true };
    }
    cursor += 1;
  }

  return { end: source.length, contentEnd: source.length, closed: false };
}

function readDollarQuoteDelimiter(source: string, start: number): string | undefined {
  // A dollar quote cannot start inside an unquoted SQL identifier.
  if (isIdentifierPart(source[start - 1] ?? "") || source.charCodeAt(start - 1) >= 0x80) {
    return undefined;
  }
  const delimiter = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y;
  delimiter.lastIndex = start;
  return delimiter.exec(source)?.[0];
}

function consumeDollarQuoted(
  source: string,
  start: number,
  delimiter: string
): { end: number; contentEnd: number; closed: boolean } {
  const contentStart = start + delimiter.length;
  const closing = source.indexOf(delimiter, contentStart);
  return closing >= 0
    ? {
        end: closing + delimiter.length,
        contentEnd: closing,
        closed: true
      }
    : {
        end: source.length,
        contentEnd: source.length,
        closed: false
      };
}

function addMaskedRegion(
  source: string,
  masked: string[],
  regionsByStart: Map<number, LexicalRegion>,
  region: LexicalRegion
): void {
  regionsByStart.set(region.span.start, region);
  for (let index = region.span.start; index < region.span.end; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") {
      masked[index] = " ";
    }
  }
}
