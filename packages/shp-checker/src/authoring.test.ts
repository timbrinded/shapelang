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

  test("extracts a precise evidence span from a single unified-diff hunk", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -10,2 +10,4 @@
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

  test("extracts stable evidence spans from multiple hunks in the same file", () => {
    const diff = `diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -2,2 +2,4 @@
 context
+deleteAuditEvent()
+truncateAudit()
 unchanged
@@ -20,2 +22,3 @@
 context
+dropAuditTable()
 unchanged
`;

    expect(extractEvidenceSpansFromUnifiedDiff(diff)).toEqual([
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 3,
        endLine: 4
      },
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 23,
        endLine: 23
      }
    ]);
  });

  test("uses new-file line numbers for addition-only hunks", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/events.sql b/src/audit/events.sql
new file mode 100644
--- /dev/null
+++ b/src/audit/events.sql
@@ -0,0 +1,3 @@
+DELETE FROM audit_events;
+
+SELECT 1;
`);

    expect(spans).toEqual([
      {
        language: "sql",
        path: "src/audit/events.sql",
        startLine: 1,
        endLine: 3
      }
    ]);
  });

  test("coalesces additions that are adjacent in the new file", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -5,2 +5,3 @@
+firstReplacement()
-removedBetweenAdditions()
+secondReplacement()
 context
`);

    expect(spans).toEqual([
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 5,
        endLine: 6
      }
    ]);
  });

  test("does not count no-newline markers as new-file lines", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -1 +1 @@
-oldCall()
\\ No newline at end of file
+newCall()
\\ No newline at end of file
`);

    expect(spans).toEqual([
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 1,
        endLine: 1
      }
    ]);
  });

  test("treats header-like added content as hunk content", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -1 +1 @@
-oldCall()
+++ b/not-a-file-header.ts
`);

    expect(spans).toEqual([
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 1,
        endLine: 1
      }
    ]);
  });
});
