import { describe, expect, test } from "bun:test";
import {
  buildShapeAuthorPrompt,
  buildShapeCriticPrompt,
  extractEvidenceSpansFromUnifiedDiff,
  generateShapeUpdateDraft,
  parseShapeModule
} from "./index.ts";
import { contextRef, fnTarget } from "./test-support.ts";

describe("Shape authoring assistant", () => {
  test("builds prompts that enforce explicit unknowns and evidence", () => {
    const prompt = buildShapeAuthorPrompt({
      changedFiles: ["src/audit/purge.ts"],
      diff: "diff --git a/src/audit/purge.ts b/src/audit/purge.ts"
    });
    const critic = buildShapeCriticPrompt(
      { changedFiles: ["src/audit/purge.ts"] },
      "component AuditStore {}"
    );

    expect(prompt).toContain("Use effects unknown when uncertainty remains");
    expect(prompt).toContain("HardDelete");
    expect(prompt).toContain("If adding PreserveInline");
    expect(prompt).toContain("Do not use rationale or memory to waive final forbidden effects");
    expect(critic).toContain("Did the model update cover every governed changed file?");
    expect(critic).toContain("Did the model update touch a guarded target without reevaluation?");
  });

  test("generates a valid reviewable global model scaffold", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain("effects unknown");
    expect(source).toContain('source ts("src/audit/purge.ts")');
    expect(parsed.ok).toBe(true);
  });

  test("uses a valid fallback source language for unknown file extensions", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["README"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain('source file("README")');
    expect(source).not.toContain("source source(");
    expect(parsed.ok).toBe(true);
  });

  test("can generate an optional memory guard scaffold", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"],
      includeMemoryGuardScaffold: true
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain(
      `memory ReviewChangedShape : ${contextRef("RefactorConstraint", fnTarget("AuditStore.reviewPurgeShape1"))}`
    );
    expect(source).toContain("status Unexplained");
    expect(parsed.ok).toBe(true);
  });

  test("extracts evidence spans from unified diffs", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -10,2 +10,3 @@
 context
+deleteAuditEvent()
+truncateAudit()
 unchanged
`);

    expect(spans).toEqual([
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 11,
        endLine: 12
      }
    ]);
  });
});
