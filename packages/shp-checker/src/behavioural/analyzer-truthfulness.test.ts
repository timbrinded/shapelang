// #62 — Analyzer truthfulness + the advisory-boundary law.
//
// The source analyzer is an ADVISORY surface. It is a naive per-line regex
// detector (see ../analyzer.ts) that points at suspicious destructive
// operations. This suite pins three things the vision actually guarantees:
//
//   1. The advisory boundary: analyzer hints NEVER change checker pass/fail.
//      Anchor: docs-site/.../learn/what-is-shape.md — "analyzer hints do not
//      replace the declared model"; shape/tooling.shape memory
//      AstGenerationUnknownSafety (candidate effect evidence is review hints,
//      not failures).
//   2. Truthful detection against REAL source fixtures at their ACTUAL lines.
//   3. Honest false-positive accounting: safe operations produce no hints, and
//      the naive detector's comment/string false positives are pinned as
//      CHARACTERIZATION (current, not ideal) with a should-be for the ideal.
//
// Every fixture line number is DERIVED from the fixture text at runtime, never
// hard-coded as a magic value. Detector fixtures are the REAL source files, not
// strings hand-rigged to the regex (the one synthetic string used is a NEGATIVE
// control for the comment/string false positive, explicitly labelled as such).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  analyzeSourceText,
  checkShapeModules,
  compareAnalyzerHintsToShape,
  type AnalyzerHint
} from "../index.ts";
import { characterization, lockedIntended, parseModuleOrThrow, shouldBe } from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const fixture = (rel: string): string => resolve(repoRoot, rel);
const readFixture = (rel: string): string => readFileSync(fixture(rel), "utf8");

/**
 * 1-based line number of the first line whose text matches `pattern`. Used to
 * DERIVE the expected hint line from the actual fixture content, so the
 * assertion stays correct if the fixture is edited and never encodes a magic
 * number. Throws if the pattern is absent (the fixture changed out from under
 * the test — a failure a reviewer can act on).
 */
function lineMatching(source: string, pattern: RegExp): number {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) {
    throw new Error(`no line matched ${pattern} in fixture; content was:\n${source}`);
  }
  return index + 1;
}

const PURGE_PATH = "fixtures/source/audit_purge.ts";
const STORE_TS_PATH = "fixtures/source/audit_store.ts";
const STORE_RS_PATH = "fixtures/source/rust/audit_store.rs";

describe("#62 analyzer truthfulness + advisory boundary", () => {
  // ── Invariant 1: ADVISORY BOUNDARY ──────────────────────────────────────
  test(
    lockedIntended(
      "a model omitting an analyzer-flagged effect still PASSES the checker (hints never gate the build)",
      "docs-site/.../learn/what-is-shape.md: analyzer hints do not replace the declared model; shape/tooling.shape AstGenerationUnknownSafety"
    ),
    () => {
      // A valid model whose function is sourced at audit_purge.ts but declares
      // only Read<Ledger> — deliberately OMITTING the HardDelete the analyzer
      // flags for that path. No trait forbids anything; the granted effect is
      // declared. The checker has no business reading the source, so it passes.
      const model = parseModuleOrThrow(
        [
          "module advisory",
          "resource Ledger",
          "component Store {",
          "  owns Ledger",
          "  grants Read<Ledger>",
          "  fn purge",
          `    source ts("${PURGE_PATH}#purgeOldEvents")`,
          "    effects complete {",
          "      Read<Ledger>",
          `        evidence ts("${PURGE_PATH}:1-3")`,
          "    }",
          "}"
        ].join("\n")
      );

      const result = checkShapeModules([model]);

      // Structured assertion: the checker accepts the model outright.
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toHaveLength(0);

      // NEGATIVE-CONTROL COMPANION: prove the boundary is REAL, not vacuous —
      // the analyzer genuinely DOES flag a HardDelete for that exact source,
      // yet the check above still passed. If the analyzer produced nothing
      // here, "the check passes" would be a tautology rather than a boundary.
      const hints = analyzeSourceText(PURGE_PATH, readFixture(PURGE_PATH));
      expect(hints.map((hint) => hint.effect)).toContain("HardDelete");
      expect(hints.some((hint) => hint.sourcePath === PURGE_PATH)).toBe(true);
    }
  );

  // ── Invariant 2: REAL-FIXTURE DETECTION at the ACTUAL line ───────────────
  test(
    lockedIntended(
      "analyzer flags HardDelete on the real audit_purge.ts at the actual deleteFrom call line",
      "shape/tooling.shape AstGenerationUnknownSafety: candidate destructive effects surfaced as review hints"
    ),
    () => {
      const source = readFixture(PURGE_PATH);
      // The executable call is `return db.deleteFrom("audit_events");`. The
      // signature line mentions `deleteFrom:` (a type, no `(`), so it does NOT
      // match the `/\bdeleteFrom\s*\(/` rule — only the call line does. We
      // derive that line from the file rather than asserting a magic "2".
      const callLine = lineMatching(source, /\bdeleteFrom\s*\(/);

      const hints = analyzeSourceText(PURGE_PATH, source);

      // Exactly one hint, fully structured (effect + path + derived line + the
      // trimmed evidence the analyzer captured).
      expect(hints).toHaveLength(1);
      const hint = hints[0];
      expect(hint).toBeDefined();
      expect(hint?.effect).toBe("HardDelete");
      expect(hint?.sourcePath).toBe(PURGE_PATH);
      expect(hint?.line).toBe(callLine);
      expect(hint?.evidence).toBe(source.split(/\r?\n/)[callLine - 1]?.trim());
    }
  );

  // ── Invariant 3 + 6: FALSE-POSITIVE / NEGATIVE controls on real fixtures ─
  test(
    lockedIntended(
      "safe persistence (repo.insert) produces ZERO hints — TypeScript fixture",
      "docs-site/.../learn/what-is-shape.md: hints point at SUSPICIOUS omissions, not benign writes"
    ),
    () => {
      const source = readFixture(STORE_TS_PATH);
      // Guard the control's premise: the fixture really does an insert (a
      // write), so a clean result reflects detector specificity, not an empty
      // file. This is the over-broad-regex catcher of invariant 6.
      expect(/\.insert\s*\(/.test(source)).toBe(true);
      expect(analyzeSourceText(STORE_TS_PATH, source)).toHaveLength(0);
    }
  );

  test(
    lockedIntended(
      "safe persistence (repo.insert) produces ZERO hints — Rust fixture (cross-language specificity)",
      "shape/tooling.shape AstGenerationUnknownSafety: warn instead of failing; no false destructive claims"
    ),
    () => {
      // NOTE on intent: fixtures/source/rust/audit_store.rs is a SAFE fixture —
      // its only persistence call is `self.repo.insert(event)`. It therefore
      // serves invariant 6's "safe fixture asserts none" role across a second
      // language. (There is no destructive Rust fixture in the tree; the
      // genuine-deletion catcher of invariant 6 is the TS audit_purge.ts test
      // above, whose `deleteFrom(` call must keep producing a hint.)
      const source = readFixture(STORE_RS_PATH);
      expect(/\.insert\s*\(/.test(source)).toBe(true);
      expect(analyzeSourceText(STORE_RS_PATH, source)).toHaveLength(0);
    }
  );

  test(
    lockedIntended(
      "synthetic safe DB calls (insert/update) produce ZERO hints",
      "docs-site/.../learn/what-is-shape.md: analyzer flags destructive ops, not ordinary writes"
    ),
    () => {
      // These are non-destructive writes that an over-broad regex might catch.
      // They are NOT rigged to any detector pattern — they are the operations a
      // truthful detector must leave alone.
      const safe = ["db.insert({ id: 1 });", "db.update({ id: 1 }, { name: 'x' });"].join("\n");
      expect(analyzeSourceText("src/safe.ts", safe)).toHaveLength(0);
    }
  );

  // ── Invariant 4: the comment / string-literal naive-regex case ───────────
  //
  // The detector matches lines, not parsed tokens, so destructive keywords in
  // comments and string literals are (falsely) flagged. We pin the CURRENT
  // behaviour as a characterization (not a guarantee) AND state the ideal as a
  // should-be that is allowed to fail without breaking CI.
  test(
    characterization(
      'a `// DELETE FROM ...` comment and a "DELETE FROM ..." string literal each produce a (false) hint',
      {
        reason:
          "the detector is a naive per-line regex that matches inside comments and string literals",
        followUp: "harden analyzer to ignore comments/strings (open a follow-up issue)"
      }
    ),
    () => {
      const source = ["// DELETE FROM users", '"DELETE FROM users"', "const ok = 1;"].join("\n");
      const commentLine = lineMatching(source, /^\/\//);
      const stringLine = lineMatching(source, /^"/);

      const hints = analyzeSourceText("src/false-positive.ts", source);

      // Current behaviour: BOTH non-executable lines are flagged HardDelete.
      expect(hints).toHaveLength(2);
      expect(hints.map((hint) => hint.line).sort((a, b) => a - b)).toEqual([
        commentLine,
        stringLine
      ]);
      for (const hint of hints) {
        expect(hint.effect).toBe("HardDelete");
      }
    }
  );

  test.todo(
    shouldBe(
      "destructive keywords inside comments and string literals produce NO hints",
      "docs-site/.../learn/what-is-shape.md: hints must point at real destructive OPERATIONS, not text"
    ),
    () => {
      // The ideal: a comment and a string literal are not executable deletes,
      // so a truthful analyzer emits nothing. Currently fails (see the
      // characterization above); kept as test.todo so it documents intent
      // without freezing the bug or breaking CI.
      const source = ["// DELETE FROM users", '"DELETE FROM users"', "const ok = 1;"].join("\n");
      expect(analyzeSourceText("src/false-positive.ts", source)).toHaveLength(0);
    }
  );

  // ── Invariant 5: PATH NORMALIZATION in compareAnalyzerHintsToShape ───────
  test(
    lockedIntended(
      "Windows-style and POSIX hint paths match the same declared effect identically",
      "shape/tooling.shape AstGenerationUnknownSafety: checkable pins; packages/shp-checker/src/shape-strings.ts normalizeShapePath"
    ),
    () => {
      // The model declares HardDelete for a function sourced at "src/x.ts".
      const model = parseModuleOrThrow(
        [
          "module norm",
          "resource Ledger",
          "component Store {",
          "  owns Ledger",
          "  grants HardDelete<Ledger>",
          "  fn purge",
          '    source ts("src/x.ts#purge")',
          "    effects complete {",
          "      HardDelete<Ledger>",
          '        evidence ts("src/x.ts:1-2")',
          "    }",
          "}"
        ].join("\n")
      );
      const hintFor = (sourcePath: string): AnalyzerHint => ({
        effect: "HardDelete",
        sourcePath,
        line: 1,
        evidence: "db.deleteFrom('x')"
      });

      // POSIX and Windows spellings of the SAME path both resolve to the
      // declared effect, so neither raises a missing_declared_effect warning.
      expect(compareAnalyzerHintsToShape([hintFor("src/x.ts")], [model])).toHaveLength(0);
      expect(compareAnalyzerHintsToShape([hintFor(".\\src\\x.ts")], [model])).toHaveLength(0);

      // CONTRAST CONTROL: a genuinely different path is NOT declared, so it
      // warns. This proves the zero-counts above come from path EQUALITY under
      // normalization, not from the comparator ignoring effects wholesale.
      const otherPathWarnings = compareAnalyzerHintsToShape([hintFor("src/other.ts")], [model]);
      expect(otherPathWarnings).toHaveLength(1);
      expect(otherPathWarnings[0]?.kind).toBe("missing_declared_effect");
      expect(otherPathWarnings[0]?.hint.sourcePath).toBe("src/other.ts");
    }
  );

  // ── Invariant 6 (genuine-deletion catcher), made explicit ────────────────
  test(
    lockedIntended(
      "a genuine deleteFrom(...) in executable code IS flagged; a safe insert is NOT",
      "shape/tooling.shape AstGenerationUnknownSafety: candidate destructive effects surfaced as hints; benign writes are not"
    ),
    () => {
      // Paired control over the SAME comparison surface: if the HardDelete
      // regex ever stops matching, the first expectation fails; if it becomes
      // over-broad and matches inserts, the second fails.
      const destructive = "await db.deleteFrom('audit_events');";
      const safe = "await db.insert({ id: 1 });";

      const destructiveHints = analyzeSourceText("src/purge.ts", destructive);
      expect(destructiveHints).toHaveLength(1);
      expect(destructiveHints[0]?.effect).toBe("HardDelete");

      expect(analyzeSourceText("src/append.ts", safe)).toHaveLength(0);
    }
  );
});
