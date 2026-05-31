// #64 — Docs fence verifier self-tests + parser parity.
//
// Vision anchors:
//   - shape/language.shape DocsShapeBlockVerifier / DocsShapeBlockParsingContract:
//     "Docs examples must be parsed with the repo parser unless explicitly
//     marked no-verify."
//   - shape/delivery.shape DocsSite fn verifyDocs: the docs site "verifies docs
//     examples parse".
//
// The gate this file pins is the docs fence verifier in
// docs-site/scripts/verify-shape-blocks.ts. It exists to enforce one law: a
// `shape` fence in the docs is VALID iff the repo parser (parseShapeModule)
// accepts it, and a fence is SKIPPED iff its info string carries `no-verify`.
//
// Every invariant runs the verifier over a TEMP in-memory corpus built here, not
// over the live docs content — so a test fails because the verifier is wrong,
// not because someone edited a real doc. The parity invariant grounds the
// verdicts against parseShapeModule directly (so the verifier embeds no divergent
// grammar), and the negative control proves the suite catches a no-op verifier
// (`verify = () => []`) that would silently pass broken docs. See
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

// Vision-anchor labels (string literals matching TESTING.md item 4/5). Kept
// inline rather than imported from the checker harness because this test lives
// in the docs-site workspace, which depends on @shape/shp-checker only for the
// parser, not for the internal behavioural harness.
const VERIFIER_ANCHOR = "shape/language.shape DocsShapeBlockVerifier";
const DOCS_SITE_ANCHOR = 'shape/delivery.shape DocsSite ("verifies docs examples parse")';

function lockedIntended(title: string, anchor: string): string {
  return `[locked-intended] ${title} — anchor: ${anchor}`;
}

// Ground-truth snippets. The accept/reject verdict of each was established by
// running parseShapeModule directly (see the parity invariant, which re-derives
// it rather than trusting these comments). These are ordinary Shape examples,
// NOT inputs hand-tuned to any verifier-internal pattern.
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
      // The opening fence sits on a line we control, so we can assert the
      // reported location is the fence's line, not some incidental value.
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
      // The parser's diagnostics are carried through — not an empty/opaque
      // failure. Each message begins with a location token: either a concrete
      // `line:col` or the explicit `unknown` the verifier emits when the parser
      // could not localise the error (the original script's documented
      // behaviour), never a blank prefix.
      expect(failure.messages.length).toBeGreaterThan(0);
      for (const message of failure.messages) {
        expect(message).toMatch(/^(\d+:\d+|unknown) \S/);
      }
      expect(report.checked).toBe(1);
      expect(report.skipped).toBe(0);

      // And prove the location passthrough is real, not always `unknown`: a
      // fence the parser CAN localise yields a concrete `line:col` prefix.
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
      // Same broken body as the failing case above; only the `no-verify` marker
      // differs. So this isolates the skip behaviour: the body would fail if
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

  // A corpus with several `shape` fences where EXACTLY ONE is broken. Reused by
  // the not-a-no-op invariant and by the negative control below.
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

  test(
    lockedIntended(
      "negative control: a no-op verifier fails the broken-fence and one-failure invariants",
      VERIFIER_ANCHOR
    ),
    () => {
      // A planted mutant: an always-pass verifier that reports zero failures for
      // any corpus. The real invariants above MUST reject it. We re-run the
      // exact assertions of invariants 2 and 5 against this stub and prove they
      // would throw — i.e. the suite is falsifiable, not a tautology.
      const noOpVerify = (_corpus: CorpusFile[]): { failures: Failure[] } => ({ failures: [] });

      // Invariant 2 (broken fence must fail): the stub reports no failure, so the
      // "exactly one failure" expectation must be violated.
      const brokenSource = ["# Heading", "", fence("shape", BROKEN_DANGLING_BRACE)].join("\n");
      const stubBrokenReport = noOpVerify(corpusOf("docs/broken.md", brokenSource));
      expect(() => {
        expect(stubBrokenReport.failures).toHaveLength(1);
      }).toThrow();

      // Invariant 5 (exactly one failure for one broken fence): the stub reports
      // zero, so this too must be violated.
      const stubOneReport = noOpVerify(corpusWithExactlyOneBrokenFence());
      expect(() => {
        expect(stubOneReport.failures).toHaveLength(1);
      }).toThrow();

      // Sanity: the REAL verifier passes those same assertions on the same
      // inputs (otherwise the controls above prove nothing about the real gate).
      expect(verifyShapeCorpus(corpusOf("docs/broken.md", brokenSource)).failures).toHaveLength(1);
      expect(verifyShapeCorpus(corpusWithExactlyOneBrokenFence()).failures).toHaveLength(1);
    }
  );
});
