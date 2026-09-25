// #61 — Coverage / bindings enforcement vs vacuity, plus the self-model dogfood.
//
// Coverage and binding checks only have value if they fire on a real governed
// change and stay silent when nothing relevant changed. Silence is not vacuous
// only when the SAME model also fires, so each enforcement test pairs a failing
// case with the silent case it guards. An implementation that ignored
// `changedFiles`, and so passed everything, would be caught.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Glob } from "bun";
import { checkShapeFiles, checkShapeModules, type CheckModuleInput } from "../index.ts";
import {
  characterization,
  diagnosticKinds,
  lockedIntended,
  parseModuleOrThrow,
  requireDiagnostic,
  requireNoDiagnostic
} from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const fixture = (rel: string): string => resolve(repoRoot, rel);

/**
 * Read a `fixtures/changed/*.txt` list the way the CLI does: one repo-relative
 * path per non-empty line. The changed set therefore comes from the committed
 * fixture, not from paths invented in the test.
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
      "docs-site/src/content/docs/guides/keep-model-current.md; shape/checker.shape CoverageCurrentUpdateContract"
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
      "docs-site/src/content/docs/guides/keep-model-current.md; shape/checker.shape CoverageCurrentUpdateContract"
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
      // above (src/audit/**) does not match this path, so a correct check stays
      // silent; one that fired regardless of path would fail here.
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
      "shape/checker.shape CoverageCurrentUpdateContract; guides/keep-model-current.md"
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
      // Discover files as the CLI's default discovery does: Bun.Glob over
      // shape/**/*.shape, here from the repo root, so the set is the shipped
      // self-model rather than a hand-written list.
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

  // INVARIANT 5 — reevaluation validation does not require an `approver` unless
  // a `policy Name { require approver }` declaration exists and the
  // reevaluation satisfies a `sensitive` memory; this model declares neither. The validator always requires satisfies, outcome,
  // summary, evidence, reviewer, and decided_on. This is pinned as CURRENT
  // behaviour, not ratified law; the follow-up is #13 (typed approver policy).
  // The negative half (a reevaluation missing a required field) shows the
  // validator is live, so the approver omission is a real allowance rather than
  // skipped validation.
  test(
    characterization(
      "a valid reevaluation without an approver is accepted; a missing required field is rejected",
      {
        reason:
          "approver is an optional reevaluation member; reevaluation validation requires satisfies/outcome/summary/evidence/reviewer/decided_on, not approver (docs-site/src/content/docs/reference/language-syntax.md#reevaluation)",
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
          "  who { owner WidgetMaintainers }",
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

      // IN-TEST NEGATIVE CONTROL for the validator: drop `reviewer`, a field
      // the validator DOES require. It must fail with a reviewer-specific
      // reason; if validation were a no-op, this would pass too and the
      // accepted case above would prove nothing.
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

  // INVARIANT 6 — an unknown `on_change require` value is rejected rather than
  // silently leaving the implementation's paths ungoverned. The INVARIANT 2
  // fixture with the pre-rename `shape_delta` spelling and the same governed
  // change must fail with invalid_implementation as its only diagnostic: before
  // the check, coverage skipped the implementation and the run passed.
  test(
    lockedIntended(
      "an unknown on_change requirement is rejected instead of ungoverning its paths",
      "docs-site/src/content/docs/reference/language-syntax.md implementation members"
    ),
    async () => {
      const source = await readFile(
        fixture("fixtures/fail/missing_shape_update/audit.shape"),
        "utf8"
      );
      const legacy = source.replace(
        "on_change require shape_update",
        "on_change require shape_delta"
      );
      expect(legacy).not.toBe(source);

      const result = checkShapeModules([parseModuleOrThrow(legacy)], {
        changedFiles: await changedFilesFrom("fixtures/changed/audit_purge.txt")
      });

      expect(result.ok).toBe(false);
      expect(diagnosticKinds(result)).toEqual(["invalid_implementation"]);
      const diagnostic = requireDiagnostic(result, "invalid_implementation");
      expect(diagnostic.name).toBe("audit::AuditStoreImpl");
      expect(diagnostic.reason).toContain("shape_delta");
    }
  );

  // INVARIANT 7 — with a base model, an attestation counts only if it is new
  // relative to the base. The same attestation carried over from the base is
  // stale: it no longer satisfies coverage even though its declaring .shape file
  // changed (the fallback rule accepts it, which is the revival this closes), and
  // it is reported as a stale_attestation warning. A freshly written reason for
  // the same path counts.
  test(
    lockedIntended(
      "with a base model, only attestations new relative to the base satisfy coverage",
      "docs-site/src/content/docs/guides/keep-model-current.md; shape/checker.shape CoverageCurrentUpdateContract"
    ),
    async () => {
      const shapeFile = "shape/audit.shape";
      const source = await readFile(
        fixture("fixtures/fail/missing_shape_update/audit.shape"),
        "utf8"
      );
      const withAttestation = (reason: string): CheckModuleInput => ({
        module: parseModuleOrThrow(
          `${source}\nattest no_shape_change {\n  source ts("src/audit/purge.ts")\n  reason "${reason}"\n}\n`
        ),
        filePath: shapeFile
      });
      const changedFiles = ["src/audit/purge.ts", shapeFile];
      const earlier = "Reviewed in an earlier change.";
      const baseModules = [withAttestation(earlier)];

      const fallback = checkShapeModules([withAttestation(earlier)], { changedFiles });
      expect(fallback.ok).toBe(true);
      requireNoDiagnostic(fallback, "missing_shape_update");

      const stale = checkShapeModules([withAttestation(earlier)], { changedFiles, baseModules });
      expect(stale.ok).toBe(false);
      expect(diagnosticKinds(stale)).toEqual(["missing_shape_update", "stale_attestation"]);
      expect(requireDiagnostic(stale, "stale_attestation").path).toBe("src/audit/purge.ts");

      const fresh = checkShapeModules([withAttestation("Reviewed again for this change.")], {
        changedFiles,
        baseModules
      });
      expect(fresh.ok).toBe(true);
      expect(diagnosticKinds(fresh)).toEqual([]);
    }
  );

  // INVARIANT 8 — bindings apply the same base comparison to the attestation
  // kinds they allow: a docs_not_needed carried over from the base does not
  // satisfy the binding, while a freshly written one does.
  test(
    lockedIntended(
      "with a base model, only docs_not_needed attestations new relative to the base satisfy bindings",
      "docs-site/src/content/docs/guides/keep-model-current.md; shape/checker.shape BindingDocsCouplingContract"
    ),
    async () => {
      const shapeFile = "fixtures/pass/coverage_binding_only/audit.shape";
      const source = await readFile(fixture(shapeFile), "utf8");
      const withAttestation = (reason: string): CheckModuleInput => ({
        module: parseModuleOrThrow(
          `${source}\nattest docs_not_needed {\n  source ts("src/audit/store.ts")\n  reason "${reason}"\n}\n`
        ),
        filePath: shapeFile
      });
      const changedFiles = await changedFilesFrom("fixtures/changed/audit_store_with_shape.txt");
      const earlier = "Internal change; documented behaviour unchanged.";
      const baseModules = [withAttestation(earlier)];

      const stale = checkShapeModules([withAttestation(earlier)], { changedFiles, baseModules });
      expect(stale.ok).toBe(false);
      expect(diagnosticKinds(stale)).toEqual(["missing_bound_docs_change", "stale_attestation"]);

      const fresh = checkShapeModules(
        [withAttestation("The refactor keeps the documented append behaviour.")],
        { changedFiles, baseModules }
      );
      expect(fresh.ok).toBe(true);
      expect(diagnosticKinds(fresh)).toEqual([]);
    }
  );

  // INVARIANT 9 — with a base model, a .shape file that changed only in its
  // attestations does not trigger bindings, so pruning stale attestations never
  // demands a docs change. The same file with a real model edit still triggers
  // the binding, and without a base the attestation-only edit triggers it too.
  // Both files are unnamed modules, so the comparison must be per file, and a
  // module built in code has no source text to compare, so it never skips.
  test(
    lockedIntended(
      "with a base model, attestation-only .shape changes do not trigger bindings",
      "docs-site/src/content/docs/guides/keep-model-current.md; shape/checker.shape BindingDocsCouplingContract"
    ),
    () => {
      const shapeFile = "shape/widget.shape";
      const model = [
        "resource Widget",
        "",
        "binding ModelDocs {",
        "  when_changed paths {",
        `    "${shapeFile}"`,
        "  }",
        "  require_changed paths {",
        `    "docs/widget.md"`,
        "  }",
        "  allow attest docs_not_needed",
        "}",
        ""
      ].join("\n");
      const other: CheckModuleInput = {
        module: parseModuleOrThrow("resource Other\n"),
        filePath: "shape/other.shape"
      };
      const inputs = (source: string): CheckModuleInput[] => [
        { module: parseModuleOrThrow(source), filePath: shapeFile },
        other
      ];
      const attested = `${model}\nattest no_shape_change {\n  source ts("src/widget.ts")\n  reason "Reviewed in an earlier change."\n}\n`;
      const baseModules = inputs(attested);
      const changedFiles = [shapeFile];

      const pruned = checkShapeModules(inputs(model), { changedFiles, baseModules });
      expect(pruned.ok).toBe(true);
      expect(diagnosticKinds(pruned)).toEqual([]);

      const edited = checkShapeModules(inputs(`${model}\nresource WidgetArchive\n`), {
        changedFiles,
        baseModules
      });
      expect(diagnosticKinds(edited)).toEqual(["missing_bound_docs_change"]);

      const withoutBase = checkShapeModules(inputs(model), { changedFiles });
      expect(diagnosticKinds(withoutBase)).toEqual(["missing_bound_docs_change"]);

      const withoutSource = (source: string): CheckModuleInput[] => {
        const { $cstNode: _source, ...module } = parseModuleOrThrow(source);
        return [{ module, filePath: shapeFile }];
      };
      const builtInCode = checkShapeModules(withoutSource(`${model}\nresource WidgetArchive\n`), {
        changedFiles,
        baseModules: withoutSource(attested)
      });
      expect(diagnosticKinds(builtInCode)).toEqual(["missing_bound_docs_change"]);
    }
  );

  // INVARIANT 10 — given the repository file list, every source, evidence, and
  // observed path the model cites must be in it. A function evidence path, a
  // candidate effect source, a memory observed reference, a reevaluation evidence
  // path, and a generated AST function's source that no longer exist are each
  // reported once; generated functions never count for coverage, but their
  // citations are checked all the same. The existing source path and an
  // attestation naming a deleted file are not reported. The check is opt-in, so
  // the same model passes without the file list.
  test(
    lockedIntended(
      "cited source and evidence paths must exist when the repository file list is given",
      "docs-site/src/content/docs/reference/diagnostics.md missing_cited_path"
    ),
    () => {
      const module = parseModuleOrThrow(
        [
          "module docs_cited",
          "",
          "resource Page",
          "",
          "component Docs {",
          "  owns Page",
          "  grants Read<Page>",
          "  fn verify",
          `    source ts("scripts/verify.ts#verify")`,
          "    effects complete {",
          "      Read<Page>",
          `        evidence md("docs/renamed.md")`,
          "    }",
          "}",
          "",
          "memory VerifyContract : RefactorConstraint<fn Docs.verify> {",
          "  applies_to fn Docs.verify",
          "  status Explained",
          "  confidence High",
          `  summary "Docs verification stays read-only."`,
          "  who { owner DocsTeam }",
          `  observed ts("scripts/observed.ts#verify")`,
          "}",
          "",
          "reevaluation VerifyRechecked {",
          "  satisfies memory VerifyContract",
          "  outcome Confirmed",
          `  summary "Still read-only."`,
          "  reviewer DocsTeam",
          `  decided_on "2026-09-25"`,
          `  evidence test("tests/deleted.test.ts")`,
          "}",
          "",
          "attest no_shape_change {",
          `  source ts("scripts/removed.ts")`,
          `  reason "The script was deleted; its behaviour moved into verify."`,
          "}",
          ""
        ].join("\n")
      );

      const generated: CheckModuleInput = {
        module: parseModuleOrThrow(
          [
            "module shape.generated.ast.scripts.gone",
            "",
            "resource Output",
            "",
            "resource GoneAnchor {",
            `  fingerprint ast.semantic_subtree_v1("sha256:${"a".repeat(64)}")`,
            "}",
            "",
            "component GoneModule {",
            "  fn gone",
            `    source ts("scripts/gone.ts#gone")`,
            "    effects unknown",
            "}",
            "",
            "effect candidate GoneWritesOutput {",
            "  fn GoneModule.gone",
            "  effect Update<Output>",
            `  source ts("scripts/candidate.ts#gone")`,
            "  confidence low",
            `  pin GoneAnchor fingerprint ast.semantic_subtree_v1("sha256:${"a".repeat(64)}")`,
            "}",
            ""
          ].join("\n")
        ),
        filePath: "shape/generated/ast/scripts/gone.shape",
        origin: "generated_ast"
      };

      const result = checkShapeModules([{ module }, generated], {
        repositoryFiles: ["scripts/verify.ts"]
      });
      expect(result.ok).toBe(false);
      expect(diagnosticKinds(result)).toEqual(Array(5).fill("missing_cited_path"));
      expect(
        result.diagnostics.flatMap((diagnostic) =>
          diagnostic.kind === "missing_cited_path" ? [diagnostic.path] : []
        )
      ).toEqual([
        "docs/renamed.md",
        "scripts/candidate.ts",
        "scripts/gone.ts",
        "scripts/observed.ts",
        "tests/deleted.test.ts"
      ]);

      const optedOut = checkShapeModules([{ module }, generated]);
      expect(optedOut.ok).toBe(true);
    }
  );
});
