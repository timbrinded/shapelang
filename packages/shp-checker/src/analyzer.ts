import type {
  AddFunctionChange,
  ModifyFunctionChange,
  ShapeModule
} from "./language/generated/ast.ts";
import {
  isAddFunctionChange,
  isChangeDecl,
  isCompleteEffects,
  isComponentDecl,
  isFunctionSummary,
  isModifyFunctionChange
} from "./language/generated/ast.ts";
import {
  normalizeShapePath,
  normalizeShapeSourcePath,
  unquoteShapeString
} from "./shape-strings.ts";

export type AnalyzerHint = {
  effect: "HardDelete" | "Truncate" | "DropStorage";
  sourcePath: string;
  line: number;
  evidence: string;
};

export type AnalyzerWarning = {
  kind: "missing_declared_effect";
  hint: AnalyzerHint;
};

type AnalyzerEffect = AnalyzerHint["effect"];

type SourceSpan = {
  start: number;
  end: number;
};

type AnalyzerMatch = {
  effect: AnalyzerEffect;
  span: SourceSpan;
  evidenceSpan: SourceSpan;
  lineOffset: number;
};

type LiteralRegion = {
  kind: "literal";
  span: SourceSpan;
  contentSpan: SourceSpan;
  literalKind: "single" | "double" | "template" | "quoted_identifier" | "dollar";
  closed: boolean;
  static: boolean;
};

type CommentRegion = {
  kind: "comment";
  span: SourceSpan;
};

type LexicalRegion = LiteralRegion | CommentRegion;

type LexicalScan = {
  masked: string;
  regionsByStart: Map<number, LexicalRegion>;
};

type SqlMatch = {
  effect: AnalyzerEffect;
  span: SourceSpan;
  statementSpan: SourceSpan;
};

const EFFECT_ORDER: Record<AnalyzerEffect, number> = {
  HardDelete: 0,
  Truncate: 1,
  DropStorage: 2
};

const LIBRARY_CALL_PATTERNS = [
  {
    effect: "HardDelete",
    pattern: /\.\s*deleteFrom\s*\(/g
  },
  {
    effect: "HardDelete",
    pattern: /\b(?:prisma|tx)\s*\.\s*[A-Za-z_$][\w$]*\s*\.\s*delete(?:Many)?\s*\(/g
  },
  {
    effect: "HardDelete",
    pattern: /\b(?:db|tx|trx)\s*\.\s*delete\s*\(/g
  },
  {
    effect: "Truncate",
    pattern: /\.truncate\s*\(/g
  },
  {
    effect: "DropStorage",
    pattern: /\.dropTable\s*\(/g
  }
] as const satisfies readonly { effect: AnalyzerEffect; pattern: RegExp }[];

const RAW_SQL_SINK_PATTERNS = [
  {
    pattern: /\b(?:db|tx|trx)\s*\.\s*executeQuery\b/g,
    allowsTaggedTemplate: false
  },
  {
    pattern: /\b(?:prisma|tx|trx)\s*\.\s*\$executeRaw(?:Unsafe)?\b/g,
    allowsTaggedTemplate: true
  },
  {
    pattern: /\b(?:db|tx|trx)\s*\.\s*execute\b/g,
    allowsTaggedTemplate: false
  }
] as const;

export function analyzeSourceText(sourcePath: string, source: string): AnalyzerHint[] {
  const matches = sourcePath.toLowerCase().endsWith(".sql")
    ? collectSqlFileMatches(source)
    : collectTypeScriptMatches(source);
  const lineStarts = collectLineStarts(source);
  const hints: AnalyzerHint[] = [];
  const seen = new Set<string>();

  matches.sort(compareAnalyzerMatches);
  for (const match of matches) {
    const key = `${match.effect}:${match.evidenceSpan.start}:${match.evidenceSpan.end}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hints.push({
      effect: match.effect,
      sourcePath,
      line: lineNumberAtOffset(lineStarts, match.lineOffset),
      evidence: source.slice(match.evidenceSpan.start, match.evidenceSpan.end)
    });
  }

  return hints;
}

function collectSqlFileMatches(source: string): AnalyzerMatch[] {
  const lexical = scanLexicalRegions(source, "sql");
  return scanDestructiveSql(source, lexical.masked).map((match) => ({
    effect: match.effect,
    span: match.span,
    evidenceSpan: match.statementSpan,
    lineOffset: match.span.start
  }));
}

function collectTypeScriptMatches(source: string): AnalyzerMatch[] {
  const lexical = scanLexicalRegions(source, "typescript");
  return [
    ...collectLibraryCallMatches(source, lexical.masked),
    ...collectRawSqlMatches(source, lexical)
  ];
}

function collectLibraryCallMatches(source: string, masked: string): AnalyzerMatch[] {
  const matches: AnalyzerMatch[] = [];

  for (const definition of LIBRARY_CALL_PATTERNS) {
    const pattern = new RegExp(definition.pattern.source, definition.pattern.flags);
    for (const match of masked.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const evidenceSpan = callEvidenceSpan(source, start, end);
      matches.push({
        effect: definition.effect,
        span: { start, end },
        evidenceSpan,
        lineOffset: evidenceSpan.start
      });
    }
  }

  return matches;
}

function collectRawSqlMatches(source: string, lexical: LexicalScan): AnalyzerMatch[] {
  const matches: AnalyzerMatch[] = [];

  for (const sink of RAW_SQL_SINK_PATTERNS) {
    const pattern = new RegExp(sink.pattern.source, sink.pattern.flags);
    for (const match of lexical.masked.matchAll(pattern)) {
      const sinkStart = match.index;
      const sinkEnd = sinkStart + match[0].length;
      const literal = findDirectRawSqlLiteral(source, lexical, sinkEnd, sink.allowsTaggedTemplate);
      if (!literal) {
        continue;
      }

      const sql = source.slice(literal.contentSpan.start, literal.contentSpan.end);
      const sqlLexical = scanLexicalRegions(sql, "sql");
      const evidenceSpan = callEvidenceSpan(source, sinkStart, literal.span.end);
      for (const sqlMatch of scanDestructiveSql(sql, sqlLexical.masked)) {
        matches.push({
          effect: sqlMatch.effect,
          span: shiftSpan(sqlMatch.span, literal.contentSpan.start),
          evidenceSpan,
          lineOffset: sqlMatch.span.start + literal.contentSpan.start
        });
      }
    }
  }

  return matches;
}

function findDirectRawSqlLiteral(
  source: string,
  lexical: LexicalScan,
  sinkEnd: number,
  allowsTaggedTemplate: boolean
): LiteralRegion | undefined {
  let cursor = skipTrivia(source, lexical.regionsByStart, sinkEnd);
  const taggedLiteral = literalAt(lexical.regionsByStart, cursor);

  if (allowsTaggedTemplate && taggedLiteral?.literalKind === "template") {
    return isUsableRawSqlLiteral(taggedLiteral) ? taggedLiteral : undefined;
  }
  if (source[cursor] !== "(") {
    return undefined;
  }

  cursor = skipTrivia(source, lexical.regionsByStart, cursor + 1);
  let literal = literalAt(lexical.regionsByStart, cursor);
  if (!literal && isSqlTemplateTagAt(lexical.masked, cursor)) {
    cursor = skipTrivia(source, lexical.regionsByStart, cursor + "sql".length);
    const taggedArgument = literalAt(lexical.regionsByStart, cursor);
    if (taggedArgument?.literalKind === "template") {
      literal = taggedArgument;
    }
  }
  if (!literal || !isUsableRawSqlLiteral(literal)) {
    return undefined;
  }

  const afterLiteral = skipTrivia(source, lexical.regionsByStart, literal.span.end);
  const nextToken = source[afterLiteral];
  return nextToken === ")" || nextToken === "," ? literal : undefined;
}

function isUsableRawSqlLiteral(literal: LiteralRegion): boolean {
  return literal.closed && literal.static;
}

function isSqlTemplateTagAt(masked: string, offset: number): boolean {
  if (masked.slice(offset, offset + "sql".length) !== "sql") {
    return false;
  }
  const next = masked[offset + "sql".length];
  return next === undefined || !isIdentifierPart(next);
}

function literalAt(
  regionsByStart: Map<number, LexicalRegion>,
  offset: number
): LiteralRegion | undefined {
  const region = regionsByStart.get(offset);
  return region?.kind === "literal" ? region : undefined;
}

function skipTrivia(
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

function scanDestructiveSql(source: string, masked: string): SqlMatch[] {
  const matches: SqlMatch[] = [];
  let pendingDeleteStart: number | undefined;
  let pendingDropStart: number | undefined;
  let statementStarted = false;
  let cursor = 0;

  while (cursor < masked.length) {
    const char = masked[cursor] ?? "";
    if (char === ";") {
      pendingDeleteStart = undefined;
      pendingDropStart = undefined;
      statementStarted = false;
      cursor += 1;
      continue;
    }
    if (!isIdentifierStart(char)) {
      cursor += 1;
      continue;
    }

    const tokenStart = cursor;
    cursor += 1;
    while (cursor < masked.length && isIdentifierPart(masked[cursor] ?? "")) {
      cursor += 1;
    }
    const token = masked.slice(tokenStart, cursor).toUpperCase();

    if (!statementStarted) {
      statementStarted = true;
      if (token === "DELETE") {
        pendingDeleteStart = tokenStart;
      } else if (token === "DROP") {
        pendingDropStart = tokenStart;
      } else if (token === "TRUNCATE") {
        matches.push(sqlMatch("Truncate", source, masked, tokenStart, cursor));
      }
      continue;
    }

    if (pendingDeleteStart !== undefined && token === "FROM") {
      matches.push(sqlMatch("HardDelete", source, masked, pendingDeleteStart, cursor));
      pendingDeleteStart = undefined;
    }
    if (pendingDropStart !== undefined && token === "TABLE") {
      matches.push(sqlMatch("DropStorage", source, masked, pendingDropStart, cursor));
      pendingDropStart = undefined;
    }
  }

  return matches;
}

function sqlMatch(
  effect: AnalyzerEffect,
  source: string,
  masked: string,
  start: number,
  end: number
): SqlMatch {
  return {
    effect,
    span: { start, end },
    statementSpan: sqlStatementEvidenceSpan(source, masked, start, end)
  };
}

function sqlStatementEvidenceSpan(
  source: string,
  masked: string,
  start: number,
  matchedEnd: number
): SourceSpan {
  const semicolon = masked.indexOf(";", matchedEnd);
  const lineEnd = source.indexOf("\n", matchedEnd);
  const end = semicolon >= 0 ? semicolon + 1 : lineEnd >= 0 ? lineEnd : source.length;
  return trimHorizontalWhitespace(source, { start, end });
}

function scanLexicalRegions(source: string, dialect: "sql" | "typescript"): LexicalScan {
  const masked = source.split("");
  const regionsByStart = new Map<number, LexicalRegion>();
  let cursor = 0;

  while (cursor < source.length) {
    if (
      (dialect === "typescript" && source.startsWith("//", cursor)) ||
      (dialect === "sql" && (source.startsWith("--", cursor) || source[cursor] === "#"))
    ) {
      const end = consumeLineComment(source, cursor);
      addMaskedRegion(source, masked, regionsByStart, {
        kind: "comment",
        span: { start: cursor, end }
      });
      cursor = end;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const end = consumeBlockComment(source, cursor, dialect === "sql");
      addMaskedRegion(source, masked, regionsByStart, {
        kind: "comment",
        span: { start: cursor, end }
      });
      cursor = end;
      continue;
    }

    const char = source[cursor] ?? "";
    if (dialect === "typescript" && (char === "'" || char === '"')) {
      const consumed = consumeQuoted(source, cursor, char, false);
      addMaskedRegion(source, masked, regionsByStart, {
        kind: "literal",
        span: { start: cursor, end: consumed.end },
        contentSpan: { start: cursor + 1, end: consumed.contentEnd },
        literalKind: char === "'" ? "single" : "double",
        closed: consumed.closed,
        static: true
      });
      cursor = consumed.end;
      continue;
    }
    if (dialect === "typescript" && char === "`") {
      const consumed = consumeTemplate(source, cursor);
      addMaskedRegion(source, masked, regionsByStart, {
        kind: "literal",
        span: { start: cursor, end: consumed.end },
        contentSpan: { start: cursor + 1, end: consumed.contentEnd },
        literalKind: "template",
        closed: consumed.closed,
        static: consumed.static
      });
      cursor = consumed.end;
      continue;
    }
    if (dialect === "sql" && (char === "'" || char === '"' || char === "`")) {
      const consumed = consumeQuoted(source, cursor, char, true);
      addMaskedRegion(source, masked, regionsByStart, {
        kind: "literal",
        span: { start: cursor, end: consumed.end },
        contentSpan: { start: cursor + 1, end: consumed.contentEnd },
        literalKind: char === "'" ? "single" : "quoted_identifier",
        closed: consumed.closed,
        static: true
      });
      cursor = consumed.end;
      continue;
    }
    if (dialect === "sql" && char === "[") {
      const consumed = consumeBracketIdentifier(source, cursor);
      addMaskedRegion(source, masked, regionsByStart, {
        kind: "literal",
        span: { start: cursor, end: consumed.end },
        contentSpan: { start: cursor + 1, end: consumed.contentEnd },
        literalKind: "quoted_identifier",
        closed: consumed.closed,
        static: true
      });
      cursor = consumed.end;
      continue;
    }
    if (dialect === "sql" && char === "$") {
      const delimiter = readDollarQuoteDelimiter(source, cursor);
      if (delimiter) {
        const consumed = consumeDollarQuoted(source, cursor, delimiter);
        addMaskedRegion(source, masked, regionsByStart, {
          kind: "literal",
          span: { start: cursor, end: consumed.end },
          contentSpan: {
            start: cursor + delimiter.length,
            end: consumed.contentEnd
          },
          literalKind: "dollar",
          closed: consumed.closed,
          static: true
        });
        cursor = consumed.end;
        continue;
      }
    }

    cursor += 1;
  }

  return {
    masked: masked.join(""),
    regionsByStart
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
  let cursor = start + 1;
  if (source[cursor] === "$") {
    return "$$";
  }
  if (!isIdentifierStart(source[cursor] ?? "")) {
    return undefined;
  }
  cursor += 1;
  while (cursor < source.length && isIdentifierPart(source[cursor] ?? "")) {
    cursor += 1;
  }
  return source[cursor] === "$" ? source.slice(start, cursor + 1) : undefined;
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

function callEvidenceSpan(source: string, matchStart: number, matchEnd: number): SourceSpan {
  let start = lineStartOffset(source, matchStart);
  const prefix = source.slice(start, matchStart);
  if (source[matchStart] === "." && prefix.trim().length === 0 && start > 0) {
    const previousLineEnd = start - 1;
    const previousLineStart = lineStartOffset(source, previousLineEnd);
    if (source.slice(previousLineStart, previousLineEnd).trim().length > 0) {
      start = previousLineStart;
    }
  }

  const newline = source.indexOf("\n", matchEnd);
  const end = newline >= 0 ? newline : source.length;
  return trimHorizontalWhitespace(source, { start, end });
}

function lineStartOffset(source: string, offset: number): number {
  return source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function trimHorizontalWhitespace(source: string, span: SourceSpan): SourceSpan {
  let { start, end } = span;
  while (start < end && isHorizontalWhitespace(source[start] ?? "")) {
    start += 1;
  }
  while (end > start && isHorizontalWhitespace(source[end - 1] ?? "")) {
    end -= 1;
  }
  return { start, end };
}

function shiftSpan(span: SourceSpan, offset: number): SourceSpan {
  return {
    start: span.start + offset,
    end: span.end + offset
  };
}

function compareAnalyzerMatches(left: AnalyzerMatch, right: AnalyzerMatch): number {
  return (
    left.span.start - right.span.start ||
    left.span.end - right.span.end ||
    EFFECT_ORDER[left.effect] - EFFECT_ORDER[right.effect] ||
    left.evidenceSpan.start - right.evidenceSpan.start ||
    left.evidenceSpan.end - right.evidenceSpan.end
  );
}

function collectLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineNumberAtOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle];
    if (start !== undefined && start <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isHorizontalWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r";
}

function isIdentifierStart(char: string): boolean {
  return (
    (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_" || char === "$"
  );
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

export function compareAnalyzerHintsToShape(
  hints: AnalyzerHint[],
  modules: ShapeModule[]
): AnalyzerWarning[] {
  const declaredEffectsByPath = collectDeclaredEffectsBySourcePath(modules);
  const warnings: AnalyzerWarning[] = [];

  for (const hint of hints) {
    const declared =
      declaredEffectsByPath.get(normalizeShapePath(hint.sourcePath)) ?? new Set<string>();
    if (!declared.has(hint.effect)) {
      warnings.push({
        kind: "missing_declared_effect",
        hint
      });
    }
  }

  return warnings;
}

export function formatAnalyzerWarnings(warnings: AnalyzerWarning[]): string {
  if (warnings.length === 0) {
    return "Shape analyzer found no mismatches.\n";
  }

  return `${warnings
    .map((warning) =>
      [
        "warning: analyzer hint missing from shape effects",
        "",
        `${warning.hint.sourcePath}:${warning.hint.line} suggests ${warning.hint.effect}.`,
        `evidence: ${warning.hint.evidence}`
      ].join("\n")
    )
    .join("\n\n")}\n`;
}

function collectDeclaredEffectsBySourcePath(modules: ShapeModule[]): Map<string, Set<string>> {
  const effects = new Map<string, Set<string>>();

  for (const module of modules) {
    for (const declaration of module.declarations) {
      if (isComponentDecl(declaration)) {
        for (const member of declaration.members) {
          if (isFunctionSummary(member)) {
            collectFunctionEffects(member, effects);
          }
        }
      } else if (isChangeDecl(declaration)) {
        for (const entry of declaration.entries) {
          if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
            collectFunctionEffects(entry, effects);
          }
        }
      }
    }
  }

  return effects;
}

function collectFunctionEffects(
  fn:
    | AddFunctionChange
    | ModifyFunctionChange
    | Extract<ShapeModule["declarations"][number], { $type: "ComponentDecl" }>["members"][number],
  effects: Map<string, Set<string>>
): void {
  if (!("effects" in fn) || !isCompleteEffects(fn.effects)) {
    return;
  }

  const sourcePath = fn.source
    ? normalizeShapeSourcePath(unquoteShapeString(fn.source.ref.path))
    : undefined;
  for (const entry of fn.effects.effects) {
    const paths = new Set<string>();
    if (sourcePath) {
      paths.add(sourcePath);
    }
    if (entry.evidence) {
      paths.add(normalizeShapeSourcePath(unquoteShapeString(entry.evidence.ref.path)));
    }

    for (const path of paths) {
      const declared = effects.get(path) ?? new Set<string>();
      declared.add(entry.term.name);
      effects.set(path, declared);
    }
  }
}
