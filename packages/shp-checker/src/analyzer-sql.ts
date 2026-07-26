import {
  isIdentifierPart,
  isIdentifierStart,
  literalAt,
  normalizeStaticTarget,
  readUnquotedIdentifier,
  skipTrivia,
  trimHorizontalWhitespace
} from "./analyzer-lexical.ts";
import type {
  AnalyzerEffect,
  AnalyzerTargetSegment,
  LexicalScan,
  SourceSpan,
  SqlMatch
} from "./analyzer-types.ts";

type SqlTargetRead = {
  value: string;
  start: number;
  end: number;
  segments: AnalyzerTargetSegment[];
};

type SqlIdentifierSegmentRead = AnalyzerTargetSegment & {
  start: number;
  end: number;
};

export function scanDestructiveSql(source: string, lexical: LexicalScan): SqlMatch[] {
  const matches: SqlMatch[] = [];
  const { masked } = lexical;
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
        matches.push(
          ...sqlMatches(
            "Truncate",
            source,
            masked,
            tokenStart,
            cursor,
            readTruncateTargets(source, lexical, cursor)
          )
        );
      }
      continue;
    }

    if (pendingDeleteStart !== undefined && token === "FROM") {
      matches.push(
        ...sqlMatches(
          "HardDelete",
          source,
          masked,
          pendingDeleteStart,
          cursor,
          readDeleteTargets(source, lexical, cursor)
        )
      );
      pendingDeleteStart = undefined;
    }
    if (pendingDropStart !== undefined && token === "TABLE") {
      matches.push(
        ...sqlMatches(
          "DropStorage",
          source,
          masked,
          pendingDropStart,
          cursor,
          readDropTargets(source, lexical, cursor)
        )
      );
      pendingDropStart = undefined;
    }
  }

  return matches;
}

function sqlMatches(
  effect: AnalyzerEffect,
  source: string,
  masked: string,
  start: number,
  end: number,
  targets: SqlTargetRead[]
): SqlMatch[] {
  const common = {
    effect,
    span: { start, end },
    statementSpan: sqlStatementEvidenceSpan(source, masked, start, end)
  };
  if (targets.length === 0) {
    return [common];
  }
  return targets.map((target) => ({
    ...common,
    target: target.value,
    targetIdentity: {
      kind: "sql",
      segments: target.segments
    },
    targetSpan: {
      start: target.start,
      end: target.end
    }
  }));
}

function readTruncateTargets(source: string, lexical: LexicalScan, start: number): SqlTargetRead[] {
  let cursor = start;
  let target = readSqlTarget(source, lexical, cursor);
  if (!target) {
    return [];
  }
  if (isBareSqlKeyword(target, "TABLE")) {
    cursor = target.end;
    target = readSqlTarget(source, lexical, cursor);
  }
  if (target && isBareSqlKeyword(target, "ONLY")) {
    cursor = target.end;
  }
  return readSqlTargetList(source, lexical, cursor, true);
}

function readDeleteTargets(source: string, lexical: LexicalScan, start: number): SqlTargetRead[] {
  const target = readSqlTarget(source, lexical, start);
  const cursor = target && isBareSqlKeyword(target, "ONLY") ? target.end : start;
  return readSqlTargetList(source, lexical, cursor, true);
}

function readDropTargets(source: string, lexical: LexicalScan, start: number): SqlTargetRead[] {
  const target = readSqlTarget(source, lexical, start);
  if (!target || !isBareSqlKeyword(target, "IF")) {
    return readSqlTargetList(source, lexical, start, false);
  }
  const exists = readSqlTarget(source, lexical, target.end);
  return exists && isBareSqlKeyword(exists, "EXISTS")
    ? readSqlTargetList(source, lexical, exists.end, false)
    : [];
}

function readSqlTargetList(
  source: string,
  lexical: LexicalScan,
  start: number,
  allowsOnly: boolean
): SqlTargetRead[] {
  const targets: SqlTargetRead[] = [];
  let cursor = start;

  while (true) {
    let target = readSqlTarget(source, lexical, cursor);
    if (allowsOnly && target && isBareSqlKeyword(target, "ONLY")) {
      target = readSqlTarget(source, lexical, target.end);
    }
    if (!target) {
      return targets;
    }
    targets.push(target);
    cursor = skipTrivia(source, lexical.regionsByStart, target.end);
    if (source[cursor] !== ",") {
      return targets;
    }
    cursor += 1;
  }
}

function isBareSqlKeyword(target: SqlTargetRead, keyword: string): boolean {
  return (
    target.segments.length === 1 &&
    target.segments[0]?.quoted === false &&
    target.value.toUpperCase() === keyword
  );
}

function readSqlTarget(
  source: string,
  lexical: LexicalScan,
  start: number
): SqlTargetRead | undefined {
  let cursor = skipTrivia(source, lexical.regionsByStart, start);
  const targetStart = cursor;
  const segments: SqlIdentifierSegmentRead[] = [];

  while (true) {
    const segment = readSqlIdentifierSegment(source, lexical, cursor);
    if (!segment) {
      return undefined;
    }
    segments.push(segment);
    cursor = skipTrivia(source, lexical.regionsByStart, segment.end);
    if (source[cursor] !== ".") {
      break;
    }
    cursor = skipTrivia(source, lexical.regionsByStart, cursor + 1);
  }

  const value = normalizeStaticTarget(segments.map((segment) => segment.value).join("."));
  return value === undefined
    ? undefined
    : {
        value,
        start: targetStart,
        end: cursor,
        segments: segments.map((segment) => ({
          value: segment.value,
          quoted: segment.quoted
        }))
      };
}

function readSqlIdentifierSegment(
  source: string,
  lexical: LexicalScan,
  start: number
): SqlIdentifierSegmentRead | undefined {
  const literal = literalAt(lexical.regionsByStart, start);
  if (literal?.literalKind === "quoted_identifier" && literal.closed) {
    const raw = source.slice(literal.contentSpan.start, literal.contentSpan.end);
    const delimiter = source[literal.span.start];
    const value =
      delimiter === '"'
        ? raw.replaceAll('""', '"')
        : delimiter === "`"
          ? raw.replaceAll("``", "`")
          : delimiter === "["
            ? raw.replaceAll("]]", "]")
            : undefined;
    return value === undefined || value.length === 0
      ? undefined
      : { value, start, end: literal.span.end, quoted: true };
  }

  const identifier = readUnquotedIdentifier(lexical.masked, start);
  return identifier
    ? {
        value: identifier.value,
        start,
        end: identifier.end,
        quoted: false
      }
    : undefined;
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
