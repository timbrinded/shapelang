// #62 — Analyzer truthfulness + the advisory-boundary law.
//
// The source analyzer is an ADVISORY surface. Its lexical scanner points at
// suspicious destructive operations while excluding inert comments and
// literals. This suite pins what the vision guarantees about it:
//
//   - The advisory boundary: analyzer hints NEVER change checker pass/fail.
//     Anchor: docs-site/.../guides/analyzer.md — "Its output is advisory.
//     `shp check` never reads it"; shape/tooling.shape memory
//     AstGenerationUnknownSafety (candidate effect evidence is review hints,
//     not failures).
//   - Truthful detection against REAL source fixtures at their ACTUAL lines.
//   - Truthful lexical boundaries: safe operations and inert destructive text
//     produce no hints, while SQL passed to supported execution sinks does.
//   - Path normalization: POSIX and Windows spellings of one hint path match
//     the same declared effect.
//
// Expected lines for the real fixtures are derived from the fixture text at
// runtime, never hard-coded. The short synthetic strings are controls for
// false positives, lexical boundaries, and paired detection, not inputs shaped
// to fit the detector's pattern.

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
 * 1-based line number of the first line whose text matches `pattern`. Tests
 * derive expected hint lines from the fixture content with it, so assertions
 * survive fixture edits without magic numbers. Throws with the fixture content
 * when no line matches.
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
  // ── Advisory boundary ─────────────────────────────────────────────────────
  test(
    lockedIntended(
      "a model omitting an analyzer-flagged effect still PASSES the checker (hints never gate the build)",
      "docs-site/.../guides/analyzer.md: analyzer output is advisory and shp check never reads it; shape/tooling.shape AstGenerationUnknownSafety"
    ),
    () => {
      // The function is sourced at audit_purge.ts but declares only
      // Read<Ledger>, OMITTING the HardDelete the analyzer flags for that path.
      // No trait forbids anything and the declared effect is granted, so the
      // model is valid. The checker does not read the source, so it passes.
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

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toHaveLength(0);

      // NEGATIVE-CONTROL COMPANION: the analyzer DOES flag a HardDelete for
      // this exact source, yet the check above passed. Without that hint, the
      // passing check would say nothing about the advisory boundary.
      const hints = analyzeSourceText(PURGE_PATH, readFixture(PURGE_PATH));
      expect(hints.map((hint) => hint.effect)).toContain("HardDelete");
      expect(hints.some((hint) => hint.sourcePath === PURGE_PATH)).toBe(true);
    }
  );

  // ── Real-fixture detection at the actual line ─────────────────────────────
  test(
    lockedIntended(
      "analyzer flags HardDelete on the real audit_purge.ts at the actual deleteFrom call line",
      "shape/tooling.shape AstGenerationUnknownSafety: candidate destructive effects surfaced as review hints"
    ),
    () => {
      const source = readFixture(PURGE_PATH);
      // The executable call is `return db.deleteFrom("audit_events");`. The
      // signature line mentions `deleteFrom:` as a parameter type with no `(`,
      // so the pattern below matches only the call line. The line is derived
      // from the file rather than asserted as a magic "2".
      const callLine = lineMatching(source, /\bdeleteFrom\s*\(/);

      const hints = analyzeSourceText(PURGE_PATH, source);

      expect(hints).toHaveLength(1);
      const hint = hints[0];
      expect(hint).toBeDefined();
      expect(hint?.effect).toBe("HardDelete");
      expect(hint?.sourcePath).toBe(PURGE_PATH);
      expect(hint?.line).toBe(callLine);
      expect(hint?.evidence).toBe(source.split(/\r?\n/)[callLine - 1]?.trim());
    }
  );

  // ── False-positive controls: safe writes produce no hints ─────────────────
  test(
    lockedIntended(
      "safe persistence (repo.insert) produces ZERO hints — TypeScript fixture",
      "docs-site/.../guides/analyzer.md: hints cover obvious destructive operations, not benign writes"
    ),
    () => {
      const source = readFixture(STORE_TS_PATH);
      // Premise guard: the fixture really performs an insert (a write), so a
      // clean result reflects detector specificity rather than an empty file.
      expect(/\.insert\s*\(/.test(source)).toBe(true);
      expect(analyzeSourceText(STORE_TS_PATH, source)).toHaveLength(0);
    }
  );

  // ── Lexical boundaries around comments and literals ───────────────────────
  test(
    lockedIntended(
      "destructive text in comments and inert literals stays silent, while a supported raw-execution literal is detected",
      "docs-site/.../guides/analyzer.md: lexical hints distinguish executable sinks from inert text"
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

  // ── Path normalization in compareAnalyzerHintsToShape ─────────────────────
  test(
    lockedIntended(
      "Windows-style and POSIX hint paths match the same declared effect identically",
      "shape/tooling.shape AstGenerationUnknownSafety: checkable pins; packages/shp-checker/src/shape-strings.ts normalizeShapePath"
    ),
    () => {
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

      // CONTRAST CONTROL: an undeclared path does warn, so the empty results
      // above come from path EQUALITY under normalization, not from a
      // comparator that never warns.
      const otherPathWarnings = compareAnalyzerHintsToShape([hintFor("src/other.ts")], [model]);
      expect(otherPathWarnings).toHaveLength(1);
      expect(otherPathWarnings[0]?.kind).toBe("missing_declared_effect");
      expect(otherPathWarnings[0]?.hint.sourcePath).toBe("src/other.ts");
    }
  );
});
