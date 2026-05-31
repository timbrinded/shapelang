// #61 — Coverage / bindings enforcement vs vacuity, plus the self-model dogfood.
//
// Coverage and binding checks only have value if they (a) fire on a real
// governed change and (b) stay silent when nothing relevant changed — and the
// only way to know (b) is not vacuous is to prove the SAME model fires in case
// (a). Every invariant here pairs a positive failing case with the negative it
// guards, so an implementation that ignored `changedFiles` (and thus passed
// everything) would be caught. See packages/shp-checker/TESTING.md.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Glob } from "bun";
import { checkShapeFiles, checkShapeModules } from "../index.ts";
import {
  characterization,
  findDiagnostic,
  lockedIntended,
  parseModuleOrThrow,
  requireDiagnostic,
  requireNoDiagnostic
} from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const fixture = (rel: string): string => resolve(repoRoot, rel);

/**
 * Read a `fixtures/changed/*.txt` list the way the CLI does (one repo-relative
 * path per non-empty line). Deriving the changed set from the SAME artifact the
 * CLI consumes keeps these tests honest: the governed paths are not magic
 * strings the author invented, they are read from the committed fixture.
 */
async function changedFilesFrom(rel: string): Promise<string[]> {
  const text = await readFile(fixture(rel), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe("#61 coverage/bindings enforcement vs vacuity + self-model dogfood", () => {
  // INVARIANT 1 — coverage semantics (enforceBindings:false) accept a binding
  // trigger that check semantics (bindings enforced) reject. The two readings
  // of the SAME fixture + SAME changed set must diverge exactly on the binding
  // obligation, proving the binding check is gated by enforceBindings and is
  // itself live (it produces a real, structured diagnostic).
  test(
    lockedIntended(
      "coverage accepts a bound source change that an enforced check rejects with missing_bound_docs_change",
      "docs-site/src/content/docs/concepts/implementations-coverage.md; shape/checker.shape CoverageCurrentUpdateContract"
    ),
    async () => {
      const changed = await changedFilesFrom("fixtures/changed/audit_store_with_shape.txt");
      // The fixture changes the governed source plus its own .shape file. The
      // governed source is the binding trigger; coverage ignores bindings.
      const governedSource = "src/audit/store.ts";
      expect(changed).toContain(governedSource);

      const coverage = await checkShapeFiles(
        [fixture("fixtures/pass/coverage_binding_only/audit.shape")],
        {
          changedFiles: changed,
          enforceBindings: false
        }
      );
      // Coverage semantics: the shape-update path is current, so no obligation.
      expect(coverage.ok).toBe(true);
      requireNoDiagnostic(coverage, "missing_bound_docs_change");
      requireNoDiagnostic(coverage, "missing_shape_update");

      const check = await checkShapeFiles(
        [fixture("fixtures/pass/coverage_binding_only/audit.shape")],
        {
          changedFiles: changed
          // enforceBindings defaults to true → check semantics.
        }
      );
      expect(check.ok).toBe(false);
      const diagnostic = requireDiagnostic(check, "missing_bound_docs_change");
      expect(diagnostic.binding).toBe("audit::AuditDocs");
      expect(diagnostic.changedFile).toBe(governedSource);
      // Required docs path and the attestation escape hatch come straight from
      // the fixture's `binding AuditDocs` block, not from this test.
      expect(diagnostic.requiredPaths).toEqual(["docs/audit.md"]);
      expect(diagnostic.attestationKinds).toEqual(["docs_not_needed"]);
    }
  );

  // INVARIANT 2 — coverage fires on a governed change with no current Shape
  // update, and stays silent for an ungoverned path and for an empty changeset.
  // The positive case (governed → fail) is what proves the two silent cases are
  // genuine PASSes and not the vacuous "ignored changedFiles" PASS.
  test(
    lockedIntended(
      "missing_shape_update fires for a governed source change but not for ungoverned or empty changesets",
      "docs-site/src/content/docs/concepts/implementations-coverage.md; shape/checker.shape CoverageCurrentUpdateContract"
    ),
    async () => {
      const shapeFile = fixture("fixtures/fail/missing_shape_update/audit.shape");
      const governed = await changedFilesFrom("fixtures/changed/audit_purge.txt");
      const governedSource = "src/audit/purge.ts";
      expect(governed).toEqual([governedSource]);

      // Positive: governed source changed, no current shape_update declared.
      const governedResult = await checkShapeFiles([shapeFile], { changedFiles: governed });
      expect(governedResult.ok).toBe(false);
      const diagnostic = requireDiagnostic(governedResult, "missing_shape_update");
      expect(diagnostic.changedFile).toBe(governedSource);
      expect(diagnostic.implementation).toBe("audit::AuditStoreImpl");
      // The reported glob is the implementation path that matched the change.
      expect(diagnostic.glob).toBe("src/audit/**/*.ts");

      // Negative A: a path no implementation governs. The glob in the diagnostic
      // above (src/audit/**) demonstrably does not match this path, so a live
      // check must stay silent — only a vacuous check would still complain.
      const ungoverned = await checkShapeFiles([shapeFile], {
        changedFiles: ["src/unrelated/elsewhere.ts"]
      });
      expect(ungoverned.ok).toBe(true);
      requireNoDiagnostic(ungoverned, "missing_shape_update");

      // Negative B: empty changeset is the no-op input; coverage has nothing to
      // require.
      const empty = await checkShapeFiles([shapeFile], { changedFiles: [] });
      expect(empty.ok).toBe(true);
      requireNoDiagnostic(empty, "missing_shape_update");
    }
  );

  // INVARIANT 3 — an `attest no_shape_change` only satisfies coverage when its
  // OWN declaring .shape file is part of the changed set. A stale attestation
  // (declared in a .shape file that was not touched in this change) must not
  // silently waive a governed source change; the same attestation declared in a
  // changed .shape file does waive it.
  test(
    lockedIntended(
      "a no_shape_change attestation satisfies coverage only when its declaring .shape file is in the changeset",
      "shape/checker.shape CoverageCurrentUpdateContract; concepts/implementations-coverage.md"
    ),
    () => {
      const shapePath = "shape/cov_attest.shape";
      const governedSource = "src/widget/store.ts";
      const source = [
        "module cov_attest",
        "",
        "resource Widget",
        "",
        "component WidgetStore {",
        "  owns Widget",
        "}",
        "",
        "implementation WidgetStoreImpl {",
        "  paths {",
        `    "src/widget/**/*.ts"`,
        "  }",
        "  conforms_to WidgetStore",
        "  on_change require shape_update",
        "}",
        "",
        "attest no_shape_change {",
        `  source ts("${governedSource}")`,
        `  reason "Refactor preserves the WidgetStore architecture contract."`,
        "}"
      ].join("\n");
      const moduleInput = { module: parseModuleOrThrow(source, shapePath), filePath: shapePath };

      // Stale: the attestation's source path changed, but the .shape file that
      // declares the attestation is NOT in the changeset → attestation is not
      // current → the governed change still lacks coverage.
      const stale = checkShapeModules([moduleInput], {
        changedFiles: [governedSource],
        enforceBindings: false
      });
      expect(stale.ok).toBe(false);
      const diagnostic = requireDiagnostic(stale, "missing_shape_update");
      expect(diagnostic.changedFile).toBe(governedSource);
      expect(diagnostic.implementation).toBe("cov_attest::WidgetStoreImpl");

      // Current: the .shape file is also in the changeset, so the attestation is
      // current and waives the governed change.
      const current = checkShapeModules([moduleInput], {
        changedFiles: [governedSource, shapePath],
        enforceBindings: false
      });
      expect(current.ok).toBe(true);
      requireNoDiagnostic(current, "missing_shape_update");
    }
  );

  // INVARIANT 4 — the shipped self-model passes its own checker with no changed
  // files. This is a positive oracle: the product dogfoods Shape, and a
  // regression that broke the self-model (or the checker) would turn this red.
  test(
    lockedIntended(
      "the shipped shape/**/*.shape self-model passes its own checker",
      "shape/checker.shape, shape/language.shape, shape/tooling.shape, shape/delivery.shape (self-model dogfood)"
    ),
    async () => {
      // Discover files exactly as the CLI does: Bun.Glob over shape/**/*.shape
      // from the repo root (so the set is the shipped self-model, not a list
      // hand-written here).
      const glob = new Glob("shape/**/*.shape");
      const files: string[] = [];
      for await (const relative of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
        files.push(resolve(repoRoot, relative));
      }
      files.sort();
      // Sanity: the self-model is non-empty and includes the core declarations.
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain(fixture("shape/checker.shape"));

      const result = await checkShapeFiles(files);
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
    }
  );

  // INVARIANT 5 — reevaluation validation does not require an `approver` today.
  // `approver` is documented as an OPTIONAL reevaluation member, and the
  // validator only requires satisfies/outcome/summary/evidence/reviewer/
  // decided_on. We pin this as CURRENT behaviour (not ratified law) because the
  // typed approver/role policy is the follow-up; #13. The negative half (a
  // reevaluation missing a truly required field) proves the validator is live
  // and that the approver omission is genuinely tolerated, not skipped wholesale.
  test(
    characterization(
      "a valid reevaluation without an approver is accepted; a missing required field is rejected",
      {
        reason:
          "approver is an optional reevaluation member; reevaluation validation requires satisfies/outcome/summary/evidence/reviewer/decided_on, not approver (docs-site/src/content/docs/reference/language-syntax.md:305)",
        followUp: "#13 typed-approver-policy"
      }
    ),
    () => {
      const withConstraint = (reevaluationLines: string[]): string =>
        [
          "module cov_reeval",
          "",
          "resource Widget",
          "",
          "component WidgetStore {",
          "  owns Widget",
          "}",
          "",
          "memory WidgetConstraint : RefactorConstraint<component WidgetStore> {",
          "  applies_to component WidgetStore",
          "  status Explained",
          "  confidence High",
          `  summary "Widget store ownership must stay append-only."`,
          "  owner WidgetMaintainers",
          "}",
          "",
          ...reevaluationLines
        ].join("\n");

      // No `approver` member — must still be a valid reevaluation.
      const accepted = checkShapeModules([
        parseModuleOrThrow(
          withConstraint([
            "reevaluation WidgetRechecked {",
            "  satisfies memory WidgetConstraint",
            "  outcome Confirmed",
            `  summary "Still append-only after refactor."`,
            "  reviewer WidgetMaintainers",
            `  decided_on "2026-05-30"`,
            `  evidence test("packages/shp-checker/src/checker.test.ts")`,
            "}"
          ])
        )
      ]);
      requireNoDiagnostic(accepted, "invalid_reevaluation");

      // IN-TEST NEGATIVE CONTROL for the validator: drop `reviewer` (a field the
      // validator DOES require). If validation were a no-op, this would also
      // pass and the characterization above would be meaningless. It must fail
      // with a reviewer-specific reason, proving approver-omission is a real
      // allowance and not blanket non-validation.
      const rejected = checkShapeModules([
        parseModuleOrThrow(
          withConstraint([
            "reevaluation WidgetReviewerless {",
            "  satisfies memory WidgetConstraint",
            "  outcome Confirmed",
            `  summary "Still append-only after refactor."`,
            `  decided_on "2026-05-30"`,
            `  evidence test("packages/shp-checker/src/checker.test.ts")`,
            "}"
          ])
        )
      ]);
      const invalid = requireDiagnostic(rejected, "invalid_reevaluation");
      // Internal symbols are module-qualified (`module::Name`).
      expect(invalid.name).toBe("cov_reeval::WidgetReviewerless");
      expect(invalid.reason).toBe("missing reviewer");
    }
  );

  // NEGATIVE CONTROL — proves the coverage check is LIVE: the SAME governed
  // model yields a missing_shape_update with the governing changedFile, and ZERO
  // diagnostics with an empty changeset. A coverage implementation that ignored
  // changedFiles (the vacuity failure mode) would produce identical output for
  // both inputs and fail this contrast.
  test(
    lockedIntended(
      "coverage output is a function of changedFiles, not a constant (live, non-vacuous)",
      "epic #53 standard: a check proven LIVE must pair a positive failing case with the silent one"
    ),
    async () => {
      const shapeFile = fixture("fixtures/fail/missing_shape_update/audit.shape");
      const governed = await changedFilesFrom("fixtures/changed/audit_purge.txt");

      const withChange = await checkShapeFiles([shapeFile], { changedFiles: governed });
      const withoutChange = await checkShapeFiles([shapeFile], { changedFiles: [] });

      const fires = findDiagnostic(withChange, "missing_shape_update");
      const silent = findDiagnostic(withoutChange, "missing_shape_update");

      // The contrast itself is the assertion: present for the governing input,
      // absent for the empty input. Equal outputs here would mean the check
      // ignores its changedFiles argument (vacuous).
      expect(fires).toBeDefined();
      expect(silent).toBeUndefined();
      expect(withChange.ok).toBe(false);
      expect(withoutChange.ok).toBe(true);
    }
  );
});
