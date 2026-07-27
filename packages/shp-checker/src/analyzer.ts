import {
  isIdentifierPart,
  literalAt,
  normalizeStaticTarget,
  readUnquotedIdentifier,
  scanLexicalRegions,
  shiftSpan,
  skipTrivia,
  trimHorizontalWhitespace
} from "./analyzer-lexical.ts";
import { collectTypeScriptFunctionScopes, sourceAnchorAtOffset } from "./analyzer-scopes.ts";
import { scanDestructiveSql } from "./analyzer-sql.ts";
import type {
  AnalyzerEffect,
  AnalyzerHint,
  AnalyzerMatch,
  AnalyzerTargetIdentity,
  LexicalRegion,
  LexicalScan,
  LiteralRegion,
  SourceSpan
} from "./analyzer-types.ts";

export { compareAnalyzerHintsToShape, formatAnalyzerWarnings } from "./analyzer-shape.ts";
export type {
  AnalyzerHint,
  AnalyzerTargetIdentity,
  AnalyzerTargetSegment,
  AnalyzerWarning
} from "./analyzer-types.ts";

type LibraryTargetMode = "captured_model" | "identifier_argument" | "literal_argument";

const EFFECT_ORDER: Record<AnalyzerEffect, number> = {
  HardDelete: 0,
  Truncate: 1,
  DropStorage: 2
};

const LIBRARY_CALL_PATTERNS = [
  {
    effect: "HardDelete",
    pattern: /\.\s*deleteFrom\s*\(/g,
    targetMode: "literal_argument"
  },
  {
    effect: "HardDelete",
    pattern: /\b(?:prisma|tx)\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*delete(?:Many)?\s*\(/g,
    targetMode: "captured_model"
  },
  {
    effect: "HardDelete",
    pattern: /\b(?:db|tx|trx)\s*\.\s*delete\s*\(/g,
    targetMode: "identifier_argument"
  },
  {
    effect: "Truncate",
    pattern: /\.truncate\s*\(/g,
    targetMode: "literal_argument"
  },
  {
    effect: "DropStorage",
    pattern: /\.dropTable\s*\(/g,
    targetMode: "literal_argument"
  }
] as const satisfies readonly {
  effect: AnalyzerEffect;
  pattern: RegExp;
  targetMode: LibraryTargetMode;
}[];

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
  const isSqlFile = sourcePath.toLowerCase().endsWith(".sql");
  const lexical = scanLexicalRegions(source, isSqlFile ? "sql" : "typescript");
  const matches = isSqlFile
    ? collectSqlFileMatches(source, lexical)
    : collectTypeScriptMatches(source, lexical);
  const functionScopes = isSqlFile ? [] : collectTypeScriptFunctionScopes(lexical.masked);
  const lineStarts = collectLineStarts(source);
  const hints: AnalyzerHint[] = [];
  const seen = new Set<string>();

  matches.sort(compareAnalyzerMatches);
  for (const match of matches) {
    const key = [
      match.effect,
      match.evidenceSpan.start,
      match.evidenceSpan.end,
      targetIdentityKey(match.targetIdentity),
      match.targetSpan?.start ?? ""
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const hint: AnalyzerHint = {
      effect: match.effect,
      sourcePath,
      line: lineNumberAtOffset(lineStarts, match.lineOffset),
      evidence: source.slice(match.evidenceSpan.start, match.evidenceSpan.end)
    };
    if (match.target !== undefined) {
      hint.target = match.target;
    }
    if (match.targetIdentity !== undefined) {
      hint.targetIdentity = match.targetIdentity;
    }
    const sourceAnchor = sourceAnchorAtOffset(functionScopes, match.span.start);
    if (sourceAnchor !== undefined) {
      hint.sourceAnchor = sourceAnchor;
    }
    hints.push(hint);
  }

  return hints;
}

function collectSqlFileMatches(source: string, lexical: LexicalScan): AnalyzerMatch[] {
  return scanDestructiveSql(source, lexical).map((match) => ({
    effect: match.effect,
    span: match.span,
    evidenceSpan: match.statementSpan,
    lineOffset: match.span.start,
    ...(match.target === undefined ? {} : { target: match.target }),
    ...(match.targetIdentity === undefined ? {} : { targetIdentity: match.targetIdentity }),
    ...(match.targetSpan === undefined ? {} : { targetSpan: match.targetSpan })
  }));
}

function collectTypeScriptMatches(source: string, lexical: LexicalScan): AnalyzerMatch[] {
  return [...collectLibraryCallMatches(source, lexical), ...collectRawSqlMatches(source, lexical)];
}

function collectLibraryCallMatches(source: string, lexical: LexicalScan): AnalyzerMatch[] {
  const matches: AnalyzerMatch[] = [];

  for (const definition of LIBRARY_CALL_PATTERNS) {
    const pattern = new RegExp(definition.pattern.source, definition.pattern.flags);
    for (const match of lexical.masked.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const evidenceSpan = callEvidenceSpan(source, start, end);
      const target =
        definition.targetMode === "captured_model"
          ? normalizeStaticTarget(match[1])
          : readDirectLibraryTarget(source, lexical, end, definition.targetMode);
      matches.push({
        effect: definition.effect,
        span: { start, end },
        evidenceSpan,
        lineOffset: evidenceSpan.start,
        ...(target === undefined
          ? {}
          : {
              target,
              targetIdentity: {
                kind: "orm",
                value: target
              }
            })
      });
    }
  }

  return matches;
}

function readDirectLibraryTarget(
  source: string,
  lexical: LexicalScan,
  argumentStart: number,
  mode: Exclude<LibraryTargetMode, "captured_model">
): string | undefined {
  const cursor = skipTrivia(source, lexical.regionsByStart, argumentStart);
  const literal = literalAt(lexical.regionsByStart, cursor);

  if (mode === "literal_argument") {
    if (
      !literal ||
      !literal.closed ||
      !literal.static ||
      literal.literalKind === "quoted_identifier" ||
      literal.literalKind === "dollar"
    ) {
      return undefined;
    }
    const value = source.slice(literal.contentSpan.start, literal.contentSpan.end);
    if (
      value.includes("\\") ||
      !isDirectArgumentBoundary(source, lexical.regionsByStart, literal.span.end)
    ) {
      return undefined;
    }
    return normalizeStaticTarget(value);
  }

  const identifier = readUnquotedIdentifier(lexical.masked, cursor);
  if (!identifier || !isDirectArgumentBoundary(source, lexical.regionsByStart, identifier.end)) {
    return undefined;
  }
  return normalizeStaticTarget(identifier.value);
}

function isDirectArgumentBoundary(
  source: string,
  regionsByStart: Map<number, LexicalRegion>,
  start: number
): boolean {
  const cursor = skipTrivia(source, regionsByStart, start);
  return source[cursor] === ")" || source[cursor] === ",";
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
      for (const sqlMatch of scanDestructiveSql(sql, sqlLexical)) {
        matches.push({
          effect: sqlMatch.effect,
          span: shiftSpan(sqlMatch.span, literal.contentSpan.start),
          evidenceSpan,
          lineOffset: sqlMatch.span.start + literal.contentSpan.start,
          ...(sqlMatch.target === undefined ? {} : { target: sqlMatch.target }),
          ...(sqlMatch.targetIdentity === undefined
            ? {}
            : { targetIdentity: sqlMatch.targetIdentity }),
          ...(sqlMatch.targetSpan === undefined
            ? {}
            : { targetSpan: shiftSpan(sqlMatch.targetSpan, literal.contentSpan.start) })
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

function compareAnalyzerMatches(left: AnalyzerMatch, right: AnalyzerMatch): number {
  return (
    left.span.start - right.span.start ||
    left.span.end - right.span.end ||
    EFFECT_ORDER[left.effect] - EFFECT_ORDER[right.effect] ||
    left.evidenceSpan.start - right.evidenceSpan.start ||
    left.evidenceSpan.end - right.evidenceSpan.end ||
    (left.targetSpan?.start ?? left.span.start) - (right.targetSpan?.start ?? right.span.start)
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

function targetIdentityKey(identity: AnalyzerTargetIdentity | undefined): string {
  if (identity === undefined) {
    return "";
  }
  if (identity.kind === "orm") {
    return `orm:${identity.value}`;
  }
  return `sql:${identity.segments
    .map((segment) => `${segment.quoted ? "q" : "u"}${segment.value.length}:${segment.value}`)
    .join(".")}`;
}
