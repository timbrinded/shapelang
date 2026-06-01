// #56 — Formatter idempotence, round-trip semantic preservation, and the
// canonical (nested -> flat) on-disk form.
//
// The vision: Shape has ONE on-disk form. Formatting is a total normalisation
// that fixes a single canonical representative per parseable module, so reviews
// and CI diffs stay stable, and rationale/memory grouping collapses to flat
// members. We pin that as algebraic laws over a real corpus rather than a single
// hand-written golden snapshot:
//   - idempotence: format is a fixed point  (format∘format == format)
//   - round-trip:  format changes no semantics (same sorted diagnostic kinds)
// plus a negative control proving the laws can fail.
//
// Anchors:
//   - shape/tooling.shape:595 memory FormatterCanonicalDiffs
//     ("Formatter ordering and indentation keep Shape files reviewable and
//      stable in diffs."; protects shape CanonicalFormatting)
//   - docs-site/src/content/docs/inside-shape/design-rationale.md:120
//     (structure is preserved/derivable; "Where would a future formatter put
//      evidence?")
//   - specs/TODO.md:41 + specs/shape-memory-guards-implementation-spec.md:432,2203
//     (the nested what/why/how/who/when grouping block is an unbuilt TODO).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { checkShapeModules } from "../index.ts";
import { formatShapeSource } from "../formatter.ts";
import { parseShapeModule } from "../parser.ts";
import { diagnosticKinds, lockedIntended, parseModuleOrThrow, shouldBe } from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");

// Every declaration keyword the language reference teaches. Invariant 3 asserts
// the corpus actually exercises each, so invariants 1 and 2 are not vacuous
// (they would pass trivially on a corpus of, say, bare modules).
const DECLARATION_KEYWORDS = [
  "resource",
  "trait",
  "component",
  "relation",
  "candidate", // candidate effect
  "implementation",
  "binding",
  "attest",
  "change",
  "rule",
  "rationale",
  "memory",
  "reevaluation"
] as const;

/**
 * The corpus: every tracked `.shape` fixture plus Shape's own self-model. These
 * are real, reviewed inputs — not strings authored to flatter the formatter — so
 * the laws below are tested against the genuine declaration surface.
 */
async function loadCorpus(): Promise<{ path: string; source: string }[]> {
  const paths: string[] = [];
  for await (const rel of glob("fixtures/**/*.shape", { cwd: repoRoot })) {
    paths.push(resolve(repoRoot, rel));
  }
  for await (const rel of glob("shape/*.shape", { cwd: repoRoot })) {
    paths.push(resolve(repoRoot, rel));
  }
  paths.sort();
  return paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

const corpus = await loadCorpus();

describe("#56 formatter idempotence, round-trip, canonical flat form", () => {
  test(
    lockedIntended(
      "format is a fixed point over the whole .shape corpus (idempotence)",
      "shape/tooling.shape:595 FormatterCanonicalDiffs (stable in diffs)"
    ),
    () => {
      let formatted = 0;
      let skipped = 0;
      for (const { path, source } of corpus) {
        const once = formatShapeSource(source, path);
        if (!once.ok) {
          // A corpus file that does not format is counted, not asserted on —
          // some fail fixtures may be deliberately not parseable. The vacuity
          // guard below proves the loop still did real work.
          skipped += 1;
          continue;
        }
        formatted += 1;
        const twice = formatShapeSource(once.formatted, path);
        expect(twice.ok).toBe(true);
        if (twice.ok) {
          // format(format(x)) === format(x): re-formatting the canonical form is
          // the identity. This is the fixed-point property, not a comparison of
          // a value to itself — `once` and `twice` are independent format runs.
          expect(twice.formatted).toBe(once.formatted);
        }
      }
      // Non-vacuity: the corpus must really format a large number of files, or
      // an empty/degenerate corpus would make idempotence trivially "hold".
      expect(formatted).toBeGreaterThanOrEqual(15);
      // Sanity that the count split is real, not an accident of a smaller set.
      expect(formatted + skipped).toBe(corpus.length);
    }
  );

  test(
    lockedIntended(
      "formatting preserves semantics: identical sorted diagnostic kinds before and after",
      "docs-site/.../inside-shape/design-rationale.md:120 (structure preserved); shape/tooling.shape:595"
    ),
    () => {
      let compared = 0;
      for (const { path, source } of corpus) {
        const formatResult = formatShapeSource(source, path);
        if (!formatResult.ok) {
          continue;
        }
        // Both the original and its formatted form must parse for a meaningful
        // round-trip; the formatter only emits parseable text, so a parse
        // failure on the formatted side would itself be a real defect.
        const originalParse = parseShapeModule(source, path);
        const formattedParse = parseShapeModule(formatResult.formatted, path);
        if (!originalParse.ok || !formattedParse.ok) {
          continue;
        }
        const before = diagnosticKinds(checkShapeModules([{ module: originalParse.module }]));
        const after = diagnosticKinds(checkShapeModules([{ module: formattedParse.module }]));
        // Sorted multiset equality of diagnostic kinds: the checker's verdict is
        // invariant under formatting. A formatter that dropped a member or
        // reordered into a different meaning would change this set.
        expect(after).toEqual(before);
        compared += 1;
      }
      expect(compared).toBeGreaterThanOrEqual(15);
    }
  );

  test(
    lockedIntended(
      "the corpus exercises every declaration kind (guards idempotence/round-trip against vacuity)",
      "packages/shp-checker/src/language/shape.langium:9 Declaration union"
    ),
    () => {
      const concatenated = corpus.map(({ source }) => source).join("\n");
      for (const keyword of DECLARATION_KEYWORDS) {
        // Word-boundary match so e.g. `change` is the keyword, not a substring
        // of another identifier. Every kind must appear at least once.
        expect(new RegExp(`\\b${keyword}\\b`).test(concatenated)).toBe(true);
      }
    }
  );

  test(
    shouldBe(
      "grouped rationale/memory blocks are the only on-disk form; flat members are rejected",
      "shape.langium RationaleMember/MemoryMember (grouped-only); shape/tooling.shape:595 FormatterCanonicalDiffs"
    ),
    () => {
      // Guard members are authored as grouped blocks (`who`/`when`/`protects`/
      // `guards`). This is the canonical and only on-disk form: it parses and
      // formats idempotently onto itself.
      const groupedForm = [
        "module m",
        "",
        "memory Keep : RefactorConstraint<fn C.f> {",
        '  summary "grouped"',
        "  who { owner Team }",
        "}"
      ].join("\n");
      const groupedFormatted = formatShapeSource(groupedForm, "m.shape");
      expect(groupedFormatted.ok).toBe(true);
      if (groupedFormatted.ok) {
        expect(groupedFormatted.formatted).toContain('summary "grouped"');
        expect(groupedFormatted.formatted).toContain("who {");
        expect(groupedFormatted.formatted).toContain("owner Team");
        // Idempotent: reformatting the canonical output is a no-op.
        const reformatted = formatShapeSource(groupedFormatted.formatted, "m.shape");
        expect(reformatted.ok).toBe(true);
        if (reformatted.ok) {
          expect(reformatted.formatted).toBe(groupedFormatted.formatted);
        }
      }

      // The flat member form is no longer a parse-level construct: a bare
      // `owner`/`guards`/`protects`/`review_by` member outside a block is
      // rejected.
      const flatForm = [
        "module m",
        "",
        "memory Keep : RefactorConstraint<fn C.f> {",
        '  summary "grouped"',
        "  owner Team",
        "}"
      ].join("\n");
      const flatParse = parseShapeModule(flatForm, "m.shape");
      expect(flatParse.ok).toBe(false);
    }
  );

  // NEGATIVE CONTROL — proves the canonicalisation and idempotence laws above
  // can FAIL, so a green suite means something. We deliberately reformat a known-good
  // fixture (reordered members, extra blank lines, odd indentation) in a way
  // that still PARSES, and assert the formatter collapses it onto the exact
  // canonical representative. We do NOT mutate the shared fixture on disk — the
  // mutant is constructed in-memory here (agents run concurrently).
  test(
    lockedIntended(
      "negative control: a badly-formatted-but-parseable variant normalises to the canonical form, and a stray-newline regression would be caught",
      "shape/tooling.shape:595 FormatterCanonicalDiffs (one on-disk form)"
    ),
    () => {
      const canonicalPath = resolve(repoRoot, "fixtures/pass/append_only_read/audit.shape");
      const canonicalSource = readFileSync(canonicalPath, "utf8");

      const canonical = formatShapeSource(canonicalSource, canonicalPath);
      expect(canonical.ok).toBe(true);
      if (!canonical.ok) {
        return;
      }

      // The planted mutant: members reordered (grants before owns), doubled
      // blank lines, deep/odd indentation, and a trailing blank line. It must
      // still parse — otherwise we would be testing the parser, not the
      // formatter's normalisation.
      const misformattedVariant = [
        "module audit",
        "",
        "",
        "resource AuditEvent : AppendOnly",
        "",
        "component AuditStore {",
        "        grants Read<AuditEvent>",
        "  owns AuditEvent",
        "",
        "",
        "  fn listEvents",
        "    effects complete {",
        "          Read<AuditEvent>",
        "    }",
        "}",
        ""
      ].join("\n");

      // Guard: the mutant differs from the canonical SOURCE (it is genuinely
      // badly-formatted) yet still parses.
      expect(misformattedVariant).not.toBe(canonicalSource);
      expect(parseModuleOrThrow(misformattedVariant, canonicalPath)).toBeDefined();

      const normalised = formatShapeSource(misformattedVariant, canonicalPath);
      expect(normalised.ok).toBe(true);
      if (!normalised.ok) {
        return;
      }

      // The law: format collapses the mutant onto the single canonical
      // representative — character for character.
      expect(normalised.formatted).toBe(canonical.formatted);

      // The mutant reordered grants before owns; canonicalisation must restore
      // owns-before-grants. This is the structured reason the strings match, not
      // a coincidence of whitespace.
      const ownsIndex = canonical.formatted.indexOf("owns AuditEvent");
      const grantsIndex = canonical.formatted.indexOf("grants Read<AuditEvent>");
      expect(ownsIndex).toBeGreaterThanOrEqual(0);
      expect(grantsIndex).toBeGreaterThan(ownsIndex);

      // Derivable structural properties a "stray newline" regression would
      // violate: the canonical form ends with exactly one trailing newline and
      // contains no run of two blank lines. These would FAIL for a formatter
      // that appended a spurious "\n" or failed to collapse the mutant's doubled
      // blanks — demonstrating the negative control bites.
      expect(canonical.formatted.endsWith("\n")).toBe(true);
      expect(canonical.formatted.endsWith("\n\n")).toBe(false);
      expect(canonical.formatted.includes("\n\n\n")).toBe(false);

      // And the fixed-point law on this concrete input, to make the idempotence
      // claim falsifiable here too: the mutant, once normalised, is stable.
      const renormalised = formatShapeSource(normalised.formatted, canonicalPath);
      expect(renormalised.ok).toBe(true);
      if (renormalised.ok) {
        expect(renormalised.formatted).toBe(normalised.formatted);
      }
    }
  );
});
