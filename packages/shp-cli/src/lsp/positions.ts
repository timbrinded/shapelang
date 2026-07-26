import type { Position, Range } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

export type ShapeReferenceAtPosition = {
  text: string;
  range: Range;
};

export type ShapeCompletionContext = {
  prefix: string;
  replacementRange: (candidate: string) => Range;
};

const CONTEXT_REFERENCE =
  /[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*<(?:fn|component|resource)[ \t]+[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*>/g;
const QUALIFIED_IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*/g;
const COMPLETION_DELIMITER = /[\s<>{}()[\],:=]/;
const COMPLETION_IDENTIFIER_CONTINUATION = /[A-Za-z0-9_.:]/;

export function shapeReferenceAtPosition(
  document: TextDocument,
  position: Position
): ShapeReferenceAtPosition | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);

  return (
    referenceContainingOffset(document, source, offset, CONTEXT_REFERENCE) ??
    referenceContainingOffset(document, source, offset, QUALIFIED_IDENTIFIER)
  );
}

export function shapeCompletionContext(
  document: TextDocument,
  position: Position,
  candidates: readonly string[]
): ShapeCompletionContext {
  const source = document.getText();
  const cursorOffset = document.offsetAt(position);
  const lineStartOffset = document.offsetAt({ line: position.line, character: 0 });
  const textBeforeCursor = source.slice(lineStartOffset, cursorOffset);
  const candidateStarts = completionCandidateStarts(textBeforeCursor);

  for (const start of candidateStarts) {
    const prefix = textBeforeCursor.slice(start);
    const matchingCandidates = candidates.filter((candidate) => candidate.startsWith(prefix));
    if (matchingCandidates.length > 0) {
      const replacementStartOffset = lineStartOffset + start;
      return {
        prefix,
        replacementRange: (candidate) =>
          completionReplacementRange(
            document,
            source,
            cursorOffset,
            replacementStartOffset,
            candidate
          )
      };
    }
  }

  const fallbackStart = candidateStarts.at(-1) ?? textBeforeCursor.length;
  const replacementStartOffset = lineStartOffset + fallbackStart;
  return {
    prefix: "",
    replacementRange: (candidate) =>
      completionReplacementRange(document, source, cursorOffset, replacementStartOffset, candidate)
  };
}

function referenceContainingOffset(
  document: TextDocument,
  source: string,
  offset: number,
  pattern: RegExp
): ShapeReferenceAtPosition | undefined {
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const text = match[0];
    const end = start + text.length;
    if (offset >= start && offset <= end) {
      return {
        text,
        range: {
          start: document.positionAt(start),
          end: document.positionAt(end)
        }
      };
    }
  }
  return undefined;
}

function completionCandidateStarts(textBeforeCursor: string): number[] {
  const starts = new Set<number>();
  const firstNonWhitespace = textBeforeCursor.search(/\S/);
  starts.add(firstNonWhitespace < 0 ? textBeforeCursor.length : firstNonWhitespace);

  for (let index = 0; index < textBeforeCursor.length; index += 1) {
    if (COMPLETION_DELIMITER.test(textBeforeCursor[index] ?? "")) {
      starts.add(index + 1);
    }
  }

  return [...starts].sort((left, right) => left - right);
}

function completionReplacementRange(
  document: TextDocument,
  source: string,
  cursorOffset: number,
  replacementStartOffset: number,
  candidate: string
): Range {
  let endOffset = cursorOffset;
  while (
    endOffset < source.length &&
    COMPLETION_IDENTIFIER_CONTINUATION.test(source[endOffset] ?? "")
  ) {
    endOffset += 1;
  }

  let scannedOffset = replacementStartOffset;
  const candidateLexemes = candidate.match(/[A-Za-z0-9_.:]+|[ \t]+|./g) ?? [];
  for (const lexeme of candidateLexemes) {
    if (COMPLETION_IDENTIFIER_CONTINUATION.test(lexeme[0] ?? "")) {
      if (!COMPLETION_IDENTIFIER_CONTINUATION.test(source[scannedOffset] ?? "")) {
        break;
      }
      while (
        scannedOffset < source.length &&
        COMPLETION_IDENTIFIER_CONTINUATION.test(source[scannedOffset] ?? "")
      ) {
        scannedOffset += 1;
      }
    } else if (lexeme[0] === " " || lexeme[0] === "\t") {
      while (source[scannedOffset] === " " || source[scannedOffset] === "\t") {
        scannedOffset += 1;
      }
    } else {
      if (!source.startsWith(lexeme, scannedOffset)) {
        break;
      }
      scannedOffset += lexeme.length;
    }
    endOffset = Math.max(endOffset, scannedOffset);
  }

  return {
    start: document.positionAt(replacementStartOffset),
    end: document.positionAt(endOffset)
  };
}
