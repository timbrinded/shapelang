import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  analyzeSourceText,
  buildShapeAuthorPrompt,
  buildShapeCriticPrompt,
  checkShapeFiles,
  checkShapeModules,
  compareAnalyzerHintsToShape,
  extractEvidenceSpansFromUnifiedDiff,
  formatAnalyzerWarnings,
  formatOnSave,
  formatShapeSource,
  generateShapeDelta,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText,
  formatDiagnostics,
  parseShapeModule
} from "./index.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

describe("Shape parser", () => {
  test("parses a minimal valid module", () => {
    const parsed = parseShapeModule(`
      module audit
      resource AuditEvent : AppendOnly
      component AuditStore {
        owns AuditEvent
        grants Append<AuditEvent>
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.module.name).toBe("audit");
      expect(parsed.module.declarations).toHaveLength(2);
    }
  });

  test("parses explicit trait declarations", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      module audit

      trait AppendOnly<T: Resource> {
        allow Read<T>
        allow Append<T>
        forbid final HardDelete<T>
      }

      resource AuditEvent : AppendOnly
    `);

    expect(parsed.ok).toBe(true);
  });

  test("reports parser errors", () => {
    const parsed = parseShapeModule("resource");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostics[0]?.message).toContain("Expecting");
    }
  });
});

describe("Shape checker", () => {
  test("passes append-only append fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/append_only_append/audit.shape")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("passes append-only read fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/append_only_read/audit.shape")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("rejects hard delete against append-only resource", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/append_only_hard_delete/audit.shape")
    ]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditStore.purgeOldEvents");
    expect(output).toContain("HardDelete<AuditEvent>");
    expect(output).toContain("AuditEvent has trait AppendOnly");
    expect(output).toContain("AppendOnly forbids final HardDelete<AuditEvent>");
    expect(output).toContain("evidence: ts(\"src/audit/purge.ts:12-16\")");
  });

  test("uses explicit trait final forbid declarations", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      trait Protected<T: Resource> {
        forbid final HardDelete<T>
      }

      resource AuditEvent : Protected

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], { includeFacts: true });
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditEvent has trait Protected");
    expect(output).toContain("Protected forbids final HardDelete<AuditEvent>");
    expect(output).toContain("caused by:");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "trait_final_forbid",
        trait: "Protected",
        effect: "HardDelete"
      })
    );
  });

  test("checks already parsed modules", () => {
    const parsed = parseShapeModule(`
      resource AuditEvent : AppendOnly
      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("forbidden effect");
  });

  test("applies change-file function additions to the base model", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_001
      import audit

      change AddAuditRetentionPurge {
        add fn AuditStore.purgeOldEvents
          source ts("src/audit/purge.ts#purgeOldEvents")
          effects complete {
            HardDelete<AuditEvent>
              evidence ts("src/audit/purge.ts:12-16")
          }
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("AuditStore.purgeOldEvents");
  });

  test("applies change-file function removals before checking", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_002
      import audit

      change RemoveAuditRetentionPurge {
        remove fn AuditStore.purgeOldEvents
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(0);
  });

  test("applies change-file top-level declaration modifications", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_004
      import audit

      change ReclassifyAuditEvent {
        modify resource AuditEvent
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(0);
  });

  test("fails coverage when governed files change without shape delta", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_delta
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], {
      changedFiles: ["src/audit/purge.ts"]
    });
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("governed source changed without shape delta");
    expect(output).toContain("src/audit/purge.ts");
    expect(output).toContain("AuditStoreImpl");
  });

  test("passes coverage with no-shape-change attestation", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_delta
      }

      attest no_shape_change {
        source ts("src/audit/purge.ts")
        reason "renamed local variable only"
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], {
      changedFiles: ["src/audit/purge.ts"]
    });

    expect(result.exitCode).toBe(0);
  });

  test("passes coverage when a change file references the governed source", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants Append<AuditEvent>
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_delta
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_003
      import audit

      change AddAppend {
        add fn AuditStore.appendEvent
          source ts("src/audit/store.ts#appendEvent")
          effects complete {
            Append<AuditEvent>
              evidence ts("src/audit/store.ts:8-14")
          }
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module], {
      changedFiles: ["src/audit/store.ts"]
    });

    expect(result.exitCode).toBe(0);
  });

  test("rejects forbidden dependency cycles with a witness path", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway : DataPlane {
        provides JsonRpcEndpoint
        requires PolicySnapshot via RuntimeCall
      }

      component PolicyService : ControlPlane {
        provides PolicySnapshot
        requires ContractRegistry via ControlPlaneDependency
      }

      component ContractRegistry : ControlPlane {
        requires Gateway via RuntimeCall
      }

      rule no_policy_decision_cycle {
        forbid cycle over requires where includes AuthorityDependency or RuntimeCall
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden dependency cycle");
    expect(output).toContain("Gateway -> PolicyService -> ContractRegistry -> Gateway");
    expect(output).toContain("RuntimeCall");
  });

  test("applies user-defined trait rules", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      module rules

      trait Immutable<T: Resource> {
      }

      resource LedgerEntry : Immutable

      component LedgerStore {
        owns LedgerEntry
        grants HardDelete<LedgerEntry>

        fn purgeEntry
          effects complete {
            HardDelete<LedgerEntry>
          }
      }

      rule immutable_forbids_delete<T: Resource> {
        when T has Immutable
        forbid final HardDelete<T>
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("LedgerEntry has trait Immutable");
    expect(output).toContain("Immutable forbids final HardDelete<LedgerEntry>");
    expect(output).toContain("rule immutable_forbids_delete forbids final HardDelete<T>");
  });

  test("applies user-defined provides exceptions", () => {
    const parsed = parseShapeModule(`
      module rules

      component Gateway {
        provides JsonRpcEndpoint
      }

      component PublicApi {
        provides JsonRpcEndpoint
      }

      rule gateway_only_rpc_ingress {
        forbid provides JsonRpcEndpoint except Gateway
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("PublicApi provides JsonRpcEndpoint");
    expect(output).toContain("except Gateway");
  });
});

describe("Shape formatter", () => {
  test("canonicalizes declaration and member formatting", () => {
    const result = formatShapeSource(`
      module audit
      import zeta
      import alpha
      component AuditStore { grants Append<AuditEvent> owns AuditEvent fn appendEvent effects complete { Append<AuditEvent> evidence ts('src/audit/store.ts:8-14') } }
      resource AuditEvent : AppendOnly
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`module audit

import alpha

import zeta

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }
}
`);
  });
});

describe("Shape authoring assistant", () => {
  test("builds prompts that enforce explicit unknowns and evidence", () => {
    const prompt = buildShapeAuthorPrompt({
      changedFiles: ["src/audit/purge.ts"],
      diff: "diff --git a/src/audit/purge.ts b/src/audit/purge.ts"
    });
    const critic = buildShapeCriticPrompt({ changedFiles: ["src/audit/purge.ts"] }, "change Proposed {}");

    expect(prompt).toContain("Use effects unknown when uncertainty remains");
    expect(prompt).toContain("HardDelete");
    expect(critic).toContain("Did the shape delta cover every governed changed file?");
  });

  test("generates a valid reviewable change scaffold", () => {
    const source = generateShapeDelta({
      moduleName: "changes.PR_001",
      changeName: "ReviewAuditChange",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain("effects unknown");
    expect(source).toContain('source ts("src/audit/purge.ts")');
    expect(parsed.ok).toBe(true);
  });

  test("extracts evidence spans from unified diffs", () => {
    const spans = extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
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

describe("Shape editor support", () => {
  const source = `
    module audit

    resource AuditEvent : AppendOnly

    component AuditStore {
      owns AuditEvent
      grants Append<AuditEvent>

      fn appendEvent
        effects complete {
          Append<AuditEvent>
        }
    }
  `;

  test("returns diagnostics from the checker", () => {
    const diagnostics = getEditorDiagnostics(`
      resource AuditEvent : AppendOnly
      component AuditStore {
        owns AuditEvent
        fn mystery
          effects unknown
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("unknown effects");
  });

  test("provides hover, definition, completions, and format-on-save", () => {
    expect(getHoverText(source, "AuditEvent")).toContain("kind: resource");
    expect(getDefinitionLocation(source, "AuditStore")?.line).toBeGreaterThan(1);
    expect(getCompletions(source, "Audit")).toContain("AuditStore.appendEvent");

    const formatted = formatOnSave(source);
    expect(formatted.ok).toBe(true);
    if (formatted.ok) {
      expect(formatted.formatted).toContain("component AuditStore");
    }
  });
});

describe("Shape source analyzer", () => {
  test("detects destructive SQL and TypeScript hints", () => {
    // noinspection SqlNoDataSourceInspection
    const hints = [
      ...analyzeSourceText("db/audit/purge.sql", "DELETE FROM audit_events;\nTRUNCATE audit_events;"),
      ...analyzeSourceText("src/audit/purge.ts", "db.deleteFrom('audit_events').execute();")
    ];

    expect(hints.map((hint) => hint.effect)).toEqual(["HardDelete", "Truncate", "HardDelete"]);
  });

  test("warns when analyzer hints are missing from shape effects", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants Append<AuditEvent>

        fn appendEvent
          source ts("src/audit/store.ts#appendEvent")
          effects complete {
            Append<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const hints = analyzeSourceText("src/audit/store.ts", "db.deleteFrom('audit_events').execute();");
    const warnings = compareAnalyzerHintsToShape(hints, [parsed.module]);
    const output = formatAnalyzerWarnings(warnings);

    expect(warnings).toHaveLength(1);
    expect(output).toContain("missing from shape effects");
    expect(output).toContain("HardDelete");
  });
});
