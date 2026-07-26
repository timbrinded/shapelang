import { describe, expect, test } from "bun:test";
import {
  buildShapeAuthorPrompt,
  buildShapeAuthoringBundle,
  buildShapeCriticPrompt,
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
    expect(prompt).toContain("Prefer stable #symbol source/evidence references");
    expect(prompt).toContain("do not add line-number or line-range suffixes");
    expect(prompt).toContain("do not infer architecture from names alone");
    expect(prompt).toContain("Do not use rationale or memory to waive final forbidden effects");
    expect(critic).toContain("Did the model update cover every governed changed file?");
    expect(critic).toContain("stable #symbol or file-only references");
    expect(critic).toContain("Did the model update touch a guarded target without reevaluation?");
  });

  test("builds a provider-neutral PR authoring bundle with a parseable conservative draft", () => {
    const bundle = buildShapeAuthoringBundle({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"],
      existingShape: [
        {
          path: "shape/audit.shape",
          content: `module audit

component AuditStore {
}
`
        }
      ],
      diff: `diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -10,2 +10,4 @@
 context
+deleteAuditEvent()
+truncateAudit()
 unchanged
`,
      projectPrelude: {
        path: "shape/prelude.shape",
        content: "trait AppendOnly"
      },
      relevantSnippets: [
        {
          path: "src/audit/purge.ts",
          content: 'return db.deleteFrom("audit_events");'
        }
      ],
      instructions: "Keep the update narrow."
    });
    const parsed = parseShapeModule(bundle.draft);

    expect(parsed.ok).toBe(true);
    expect(bundle.draft).toContain('source ts("src/audit/purge.ts")');
    expect(bundle.draft).not.toContain("src/audit/purge.ts:11-12");
    expect(bundle.draft).toContain("effects unknown");
    expect(bundle.draft).not.toContain("resource ");
    expect(bundle.draft).not.toContain("HardDelete<");
    expect(bundle.authorPrompt).toContain('return db.deleteFrom("audit_events");');
    expect(bundle.authorPrompt).toContain("HardDelete");
    expect(bundle.authorPrompt).toContain(
      "Project prelude:\n--- shape/prelude.shape ---\ntrait AppendOnly"
    );
    expect(bundle.authorPrompt).toContain(
      "Existing shape:\n--- shape/audit.shape ---\nmodule audit"
    );
    expect(bundle.authorPrompt).toContain("PR diff:\ndiff --git");
    expect(bundle.authorPrompt).toContain(
      'Relevant source snippets:\n--- src/audit/purge.ts ---\nreturn db.deleteFrom("audit_events");'
    );
    expect(bundle.authorPrompt).not.toContain("Candidate evidence spans:");
    expect(bundle.authorPrompt).toContain("Initial conservative draft:\nmodule audit");
    expect(bundle.authorPrompt).toContain("Human instructions:\nKeep the update narrow.");

    const sections = [
      "Changed files:",
      "Project prelude:",
      "Existing shape:",
      "PR diff:",
      "Relevant source snippets:",
      "Initial conservative draft:",
      "Human instructions:"
    ];
    const sectionIndexes = sections.map((section) => bundle.authorPrompt.indexOf(section));
    expect(sectionIndexes.every((index) => index >= 0)).toBe(true);
    expect(sectionIndexes).toEqual([...sectionIndexes].sort((left, right) => left - right));
  });

  test("generates a valid reviewable global model scaffold", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toBe(`module audit

component AuditStore {
  fn reviewPurgeShape1
    source ts("src/audit/purge.ts")
    effects unknown
}
`);
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
});
