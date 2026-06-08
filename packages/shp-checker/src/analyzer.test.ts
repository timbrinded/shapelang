import { describe, expect, test } from "bun:test";
import {
  analyzeSourceText,
  compareAnalyzerHintsToShape,
  formatAnalyzerWarnings,
  parseShapeModule
} from "./index.ts";

describe("Shape source analyzer", () => {
  test("detects destructive SQL and TypeScript hints", () => {
    // noinspection SqlNoDataSourceInspection
    const hints = [
      ...analyzeSourceText(
        "db/audit/purge.sql",
        "DELETE FROM audit_events;\nTRUNCATE audit_events;"
      ),
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

    const hints = analyzeSourceText(
      "src/audit/store.ts",
      "db.deleteFrom('audit_events').execute();"
    );
    const warnings = compareAnalyzerHintsToShape(hints, [parsed.module]);
    const output = formatAnalyzerWarnings(warnings);

    expect(warnings).toHaveLength(1);
    expect(output).toContain("missing from shape effects");
    expect(output).toContain("HardDelete");
  });
});
