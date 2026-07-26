import { describe, expect, test } from "bun:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { shapeCompletionContext, shapeReferenceAtPosition } from "./positions";

describe("Shape LSP positions", () => {
  test("selects complete context references before their inner identifiers", () => {
    const source = "rationale Inline : InlineRationale<fn Gateway.derivePolicyDecision> {\n}\n";
    const document = TextDocument.create("untitled:context.shape", "shape", 1, source);
    const line = source.split("\n")[0] ?? "";
    const character = line.indexOf("Gateway") + 2;

    expect(shapeReferenceAtPosition(document, { line: 0, character })).toEqual({
      text: "InlineRationale<fn Gateway.derivePolicyDecision>",
      range: {
        start: { line: 0, character: line.indexOf("InlineRationale") },
        end: {
          line: 0,
          character:
            line.indexOf("InlineRationale") +
            "InlineRationale<fn Gateway.derivePolicyDecision>".length
        }
      }
    });
  });

  test("uses UTF-16 positions for qualified symbols", () => {
    const source = 'description "𐐀" AuditStore.appendEvent\n';
    const document = TextDocument.create("untitled:utf16.shape", "shape", 1, source);
    const symbolStart = source.indexOf("AuditStore");

    expect(shapeReferenceAtPosition(document, { line: 0, character: symbolStart + 8 })).toEqual({
      text: "AuditStore.appendEvent",
      range: {
        start: { line: 0, character: symbolStart },
        end: { line: 0, character: symbolStart + "AuditStore.appendEvent".length }
      }
    });
  });

  test("derives multiword and symbol completion replacement ranges from candidates", () => {
    const multiword = TextDocument.create("untitled:multiword.shape", "shape", 1, "  forbid p");
    const multiwordContext = shapeCompletionContext(multiword, { line: 0, character: 10 }, [
      "AuditEvent",
      "forbid path",
      "forbid provides"
    ]);
    expect(multiwordContext.prefix).toBe("forbid p");
    expect(multiwordContext.replacementRange("forbid path")).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 10 }
    });

    const multiwordSuffix = TextDocument.create(
      "untitled:multiword-suffix.shape",
      "shape",
      1,
      "forbid path"
    );
    const multiwordSuffixContext = shapeCompletionContext(
      multiwordSuffix,
      { line: 0, character: 4 },
      ["forbid path", "forbid provides"]
    );
    expect(multiwordSuffixContext.prefix).toBe("forb");
    expect(multiwordSuffixContext.replacementRange("forbid path")).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 11 }
    });

    const multiwordTypo = TextDocument.create(
      "untitled:multiword-typo.shape",
      "shape",
      1,
      "forbid paX"
    );
    const multiwordTypoContext = shapeCompletionContext(multiwordTypo, { line: 0, character: 4 }, [
      "forbid path",
      "forbid provides"
    ]);
    expect(multiwordTypoContext.replacementRange("forbid path")).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 }
    });

    const mixedCandidateLengths = TextDocument.create(
      "untitled:mixed-candidates.shape",
      "shape",
      1,
      "AuditEvenX Extra"
    );
    const mixedContext = shapeCompletionContext(mixedCandidateLengths, { line: 0, character: 9 }, [
      "AuditEvent",
      "AuditEvent Extra"
    ]);
    expect(mixedContext.replacementRange("AuditEvent")).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 }
    });
    expect(mixedContext.replacementRange("AuditEvent Extra")).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 16 }
    });

    const contextCandidate = "InlineRationale<fn Alpha.handle>";
    for (const [source, cursor] of [
      [contextCandidate, 8],
      [contextCandidate, contextCandidate.indexOf("handle") + 3],
      ["InlineRationalX<fn Alpha.handlX>", 8]
    ] as const) {
      const contextReference = TextDocument.create(
        "untitled:context-completion.shape",
        "shape",
        1,
        source
      );
      const context = shapeCompletionContext(contextReference, { line: 0, character: cursor }, [
        contextCandidate
      ]);
      const range = context.replacementRange(contextCandidate);
      expect(range).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: source.length }
      });
      expect(
        source.slice(0, range.start.character) +
          contextCandidate +
          source.slice(range.end.character)
      ).toBe(contextCandidate);
    }

    const symbol = TextDocument.create("untitled:symbol.shape", "shape", 1, "connects Aud");
    const symbolContext = shapeCompletionContext(symbol, { line: 0, character: 12 }, [
      "AuditEvent"
    ]);
    expect(symbolContext.prefix).toBe("Aud");
    expect(symbolContext.replacementRange("AuditEvent")).toEqual({
      start: { line: 0, character: 9 },
      end: { line: 0, character: 12 }
    });

    const typo = TextDocument.create("untitled:typo.shape", "shape", 1, "owns AuditEvenX");
    const typoContext = shapeCompletionContext(typo, { line: 0, character: 14 }, ["AuditEvent"]);
    expect(typoContext.prefix).toBe("AuditEven");
    expect(typoContext.replacementRange("AuditEvent")).toEqual({
      start: { line: 0, character: 5 },
      end: { line: 0, character: 15 }
    });
  });
});
