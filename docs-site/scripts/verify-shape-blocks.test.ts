// Docs fence verifier self-tests and parser parity (#64).
//
// Vision anchors:
//   - shape/language.shape DocsShapeBlockVerifier / DocsShapeBlockParsingContract:
//     "Docs examples must be parsed with the repo parser unless explicitly
//     marked no-verify."
//   - shape/delivery.shape DocsSite fn verifyDocs: "Verifies complete Shape
//     examples in the docs site".
//
// The docs fence verifier in docs-site/scripts/verify-shape-blocks.ts enforces
// one law: a `shape` fence in the docs is valid iff the repo parser
// (parseShapeModule) accepts it, and a fence is skipped iff its info string
// carries `no-verify`.
//
// Each test runs the verifier over an in-memory corpus built here rather than
// the live docs, so a failure points at the verifier, not at an edited doc. The
// parity test checks verdicts against parseShapeModule directly, and the
// broken-fence tests fail against a no-op verifier (`verify = () => []`) that
// would silently pass broken docs. See
// packages/shp-checker/TESTING.md.

import { describe, expect, test } from "bun:test";
import { parseShapeModule } from "@shape/shp-checker";
import {
  type CorpusFile,
  type Failure,
  extractShapeFences,
  verifyOneFence,
  verifyShapeCorpus
} from "./verify-shape-blocks.ts";

// Vision-anchor labels (string literals following the TESTING.md "Vision-anchored" and "Labelled" conventions).
// They are defined here rather than imported from the checker's behavioural
// harness because the docs-site workspace uses @shape/shp-checker only for the
// parser, not for that internal harness.
const VERIFIER_ANCHOR = "shape/language.shape DocsShapeBlockVerifier";
const DOCS_SITE_ANCHOR = 'shape/delivery.shape DocsSite ("verifies docs examples parse")';

function lockedIntended(title: string, anchor: string): string {
  return `[locked-intended] ${title} — anchor: ${anchor}`;
}

// Ordinary Shape snippets, not inputs tuned to a verifier-internal pattern. The
// parity test derives each accept/reject verdict from parseShapeModule rather
// than trusting these names.
const VALID_RESOURCE = "resource Ledger\n";
const VALID_COMPONENT = [
  "component Store {",
  "  owns Ledger",
  "  grants Read<Ledger>",
  "}",
  ""
].join("\n");
// A component body with an unterminated brace: the parser reports a parse error.
const BROKEN_DANGLING_BRACE = ["component Store {", "  owns Ledger", ""].join("\n");
const BROKEN_GIBBERISH = "this is not shape @@@ {{{\n";

/** Wrap a snippet in a fenced code block with the given info string. */
function fence(info: string, body: string): string {
  return ["```" + info, body.replace(/\n$/, ""), "```"].join("\n");
}

/** Build a single-document corpus from raw markdown source. */
function corpusOf(filePath: string, source: string): CorpusFile[] {
  return [{ filePath, source }];
}

describe("docs fence verifier", () => {
  test(lockedIntended("a valid shape fence yields zero failures", DOCS_SITE_ANCHOR), () => {
    const source = [
      "# Title",
      "",
      "Some prose.",
      "",
      fence("shape", VALID_RESOURCE),
      "",
      "More prose, and a non-shape fence that must be ignored:",
      "",
      fence("ts", "const x: number = 1;\n")
    ].join("\n");

    const report = verifyShapeCorpus(corpusOf("docs/valid.md", source));

    expect(report.failures).toEqual([]);
    // Exactly the one `shape` fence was checked; the `ts` fence is not counted.
    expect(report.checked).toBe(1);
    expect(report.skipped).toBe(0);
  });

  test(
    lockedIntended(
      "a broken shape fence fails with a message naming the file and line",
      VERIFIER_ANCHOR
    ),
    () => {
      // The preamble fixes the opening fence's line, so the reported location
      // can be checked against that line rather than an incidental value.
      const preamble = ["# Heading", "", "Intro paragraph.", ""];
      const fenceStartLine = preamble.length + 1; // 1-based line of the ```shape line
      const source = [...preamble, fence("shape", BROKEN_DANGLING_BRACE)].join("\n");

      const report = verifyShapeCorpus(corpusOf("docs/broken.md", source));

      expect(report.failures).toHaveLength(1);
      const failure = report.failures[0] as Failure;
      // Structured assertion: the failure names the corpus file and the line of
      // the offending fence (so a reviewer can navigate straight to it).
      expect(failure.filePath).toBe("docs/broken.md");
      expect(failure.line).toBe(fenceStartLine);
      // The parser's diagnostics are carried through, not an empty or opaque
      // failure. Each message begins with a location token: a concrete
      // `line:col`, or `unknown` when the parser could not localise the error;
      // never a blank prefix.
      expect(failure.messages.length).toBeGreaterThan(0);
      for (const message of failure.messages) {
        expect(message).toMatch(/^(\d+:\d+|unknown) \S/);
      }
      expect(report.checked).toBe(1);
      expect(report.skipped).toBe(0);

      // The location passthrough is not always `unknown`: a fence the parser
      // can localise yields a concrete `line:col` prefix.
      const localisable = verifyOneFence(
        { info: "shape", code: BROKEN_GIBBERISH, line: 1 },
        "docs/gibberish.md"
      );
      expect(localisable.kind).toBe("fail");
      if (localisable.kind === "fail") {
        expect(localisable.messages.some((m) => /^\d+:\d+ /.test(m))).toBe(true);
      }
    }
  );

  test(
    lockedIntended("a broken fence marked no-verify is skipped, not failed", VERIFIER_ANCHOR),
    () => {
      // The body matches the failing case above and only the `no-verify` marker
      // differs, which isolates the skip behaviour: the body would fail if
      // checked.
      const source = ["# Doc", "", fence("shape no-verify", BROKEN_DANGLING_BRACE)].join("\n");

      const report = verifyShapeCorpus(corpusOf("docs/skipped.md", source));

      expect(report.failures).toEqual([]);
      expect(report.skipped).toBe(1);
      expect(report.checked).toBe(0);

      // Cross-check at the single-fence level: the same broken body IS a failure
      // without the marker, proving the skip is the only thing suppressing it.
      const fences = extractShapeFences(fence("shape", BROKEN_DANGLING_BRACE));
      expect(fences).toHaveLength(1);
      const withoutMarker = verifyOneFence(fences[0]!, "docs/skipped.md");
      expect(withoutMarker.kind).toBe("fail");
    }
  );

  test(
    lockedIntended(
      "the verifier verdict equals parseShapeModule(snippet).ok for every snippet",
      VERIFIER_ANCHOR
    ),
    () => {
      // A mixed set with BOTH accepts and rejects, so parity is non-trivially
      // tested in both directions. If the verifier embedded its own grammar that
      // diverged from the parser, at least one row would disagree.
      const snippets: { name: string; code: string }[] = [
        { name: "valid resource", code: VALID_RESOURCE },
        { name: "valid component", code: VALID_COMPONENT },
        { name: "empty snippet", code: "" },
        { name: "broken dangling brace", code: BROKEN_DANGLING_BRACE },
        { name: "broken gibberish", code: BROKEN_GIBBERISH }
      ];

      let sawAccept = false;
      let sawReject = false;
      for (const { name, code } of snippets) {
        const parserOk = parseShapeModule(code, "parity.shape").ok;
        const verdict = verifyOneFence({ info: "shape", code, line: 1 }, "parity.md");
        const verifierOk = verdict.kind === "pass";
        expect({ name, verifierOk }).toEqual({ name, verifierOk: parserOk });
        sawAccept ||= parserOk;
        sawReject ||= !parserOk;
      }

      // Guard against a vacuous parity set (all-accept or all-reject would let a
      // one-sided verifier pass): require at least one of each.
      expect(sawAccept).toBe(true);
      expect(sawReject).toBe(true);
    }
  );

  // A corpus with several `shape` fences where EXACTLY ONE is broken, for the
  // not-a-no-op invariant.
  function corpusWithExactlyOneBrokenFence(): CorpusFile[] {
    const docA = [
      "# Doc A",
      "",
      fence("shape", VALID_RESOURCE),
      "",
      fence("shape", VALID_COMPONENT)
    ].join("\n");
    const docB = [
      "# Doc B",
      "",
      fence("shape", VALID_RESOURCE),
      "",
      fence("shape", BROKEN_GIBBERISH), // the one broken fence
      "",
      fence("shape no-verify", BROKEN_DANGLING_BRACE) // skipped, must not count
    ].join("\n");
    return [
      { filePath: "docs/a.md", source: docA },
      { filePath: "docs/b.md", source: docB }
    ];
  }

  test(
    lockedIntended(
      "a corpus with exactly one broken fence reports exactly one failure",
      VERIFIER_ANCHOR
    ),
    () => {
      const report = verifyShapeCorpus(corpusWithExactlyOneBrokenFence());

      // Not zero (would mean it never checks) and not all four checked shape
      // fences (would mean it rejects valid input): exactly the single broken
      // fence.
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]!.filePath).toBe("docs/b.md");
      // Four checked (docA: two valid; docB: one valid + one broken); the
      // no-verify fence in docB is skipped, never checked.
      expect(report.checked).toBe(4);
      expect(report.skipped).toBe(1);
    }
  );
});
