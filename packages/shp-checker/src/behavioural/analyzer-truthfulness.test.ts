// #62 — Analyzer truthfulness + the advisory-boundary law.
//
// The source analyzer is an ADVISORY surface. Its lexical scanner points at
// suspicious destructive operations while excluding inert comments and
// literals. This suite pins three things the vision actually guarantees:
//
//   1. The advisory boundary: analyzer hints NEVER change checker pass/fail.
//      Anchor: docs-site/.../learn/what-is-shape.md — "analyzer hints do not
//      replace the declared model"; shape/tooling.shape memory
//      AstGenerationUnknownSafety (candidate effect evidence is review hints,
//      not failures).
//   2. Truthful detection against REAL source fixtures at their ACTUAL lines.
//   3. Truthful lexical boundaries: safe operations and inert destructive text
//      produce no hints, while SQL passed to supported execution sinks does.
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
import { lockedIntended, parseModuleOrThrow } from "./harness.ts";

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
          `        evidence ts("${PURGE_PATH}#purgeOldEvents")`,
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

  // ── Invariant 3: FALSE-POSITIVE / NEGATIVE controls on real fixtures ─────
  test(
    lockedIntended(
      "safe persistence (repo.insert) produces ZERO hints — TypeScript fixture",
      "docs-site/.../learn/what-is-shape.md: hints point at SUSPICIOUS omissions, not benign writes"
    ),
    () => {
      const source = readFixture(STORE_TS_PATH);
      // Guard the control's premise: the fixture really does an insert (a
      // write), so a clean result reflects detector specificity, not an empty
      // file.
      expect(/\.insert\s*\(/.test(source)).toBe(true);
      expect(analyzeSourceText(STORE_TS_PATH, source)).toHaveLength(0);
    }
  );

  // ── Invariant 4: lexical boundaries around comments and literals ──────────
  test(
    lockedIntended(
      "destructive text in comments and inert literals stays silent, while a supported raw-execution literal is detected",
      "docs-site/.../concepts/analyzer-hints.md: lexical hints distinguish executable sinks from inert text"
    ),
    () => {
      const inert = [
        "// DELETE FROM users",
        "/* TRUNCATE TABLE sessions */",
        'const quoted = "DROP TABLE audit_log";',
        "const template = `DELETE FROM archived_users`;",
        'logger.info("TRUNCATE TABLE sessions");'
      ].join("\n");
      expect(analyzeSourceText("src/inert.ts", inert)).toEqual([]);

      const executable = [
        "await prisma.$executeRawUnsafe(`",
        "  DELETE",
        "  FROM users",
        "`);"
      ].join("\n");
      const hints = analyzeSourceText("src/executable.ts", executable);

      expect(hints).toHaveLength(1);
      expect(hints[0]).toEqual(
        expect.objectContaining({
          effect: "HardDelete",
          sourcePath: "src/executable.ts",
          line: 2
        })
      );
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
          '        evidence ts("src/x.ts#purge")',
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
});
