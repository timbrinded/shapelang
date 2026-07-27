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

  test("detects multiline SQL with comments between structural tokens", () => {
    const source = [
      "DELETE",
      "/* retention policy */",
      "FROM audit_events;",
      "",
      "TRUNCATE",
      "-- optional keyword",
      "TABLE audit_event_staging;",
      "DROP /* archive rotation */ TEMPORARY",
      "TABLE audit_event_archive;"
    ].join("\n");

    expect(analyzeSourceText("db/audit/purge.sql", source)).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "db/audit/purge.sql",
        line: 1,
        evidence: "DELETE\n/* retention policy */\nFROM audit_events;"
      },
      {
        effect: "Truncate",
        sourcePath: "db/audit/purge.sql",
        line: 5,
        evidence: "TRUNCATE\n-- optional keyword\nTABLE audit_event_staging;"
      },
      {
        effect: "DropStorage",
        sourcePath: "db/audit/purge.sql",
        line: 8,
        evidence: "DROP /* archive rotation */ TEMPORARY\nTABLE audit_event_archive;"
      }
    ]);
  });

  test("ignores destructive SQL vocabulary in comments and quoted regions", () => {
    const source = [
      "-- DELETE FROM audit_events;",
      "/* TRUNCATE TABLE audit_events; */",
      "SELECT 'DROP TABLE audit_events';",
      'SELECT "DELETE FROM audit_events";',
      "SELECT `TRUNCATE TABLE audit_events`;",
      "SELECT $$DROP TABLE audit_events$$;"
    ].join("\n");

    expect(analyzeSourceText("db/audit/report.sql", source)).toEqual([]);
  });

  test("preserves CRLF offsets and reports one-based start lines", () => {
    const source = [
      "SELECT 1;",
      "DELETE",
      "FROM audit_events;",
      "DROP TABLE audit_event_archive;"
    ].join("\r\n");

    expect(analyzeSourceText("db/audit/purge.sql", source)).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "db/audit/purge.sql",
        line: 2,
        evidence: "DELETE\r\nFROM audit_events;"
      },
      {
        effect: "DropStorage",
        sourcePath: "db/audit/purge.sql",
        line: 4,
        evidence: "DROP TABLE audit_event_archive;"
      }
    ]);
  });

  test("scans SQL only in direct supported raw-execution literals", () => {
    const source = [
      "await db.executeQuery(`DELETE",
      "/* selected archive */ FROM audit_events;`);",
      'await prisma.$executeRawUnsafe("TRUNCATE TABLE audit_event_staging");',
      "await prisma.$executeRaw`DROP TABLE audit_event_archive`;",
      "await tx.execute(sql`DELETE FROM audit_event_archive`);"
    ].join("\n");

    expect(analyzeSourceText("src/audit/purge.ts", source)).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 1,
        evidence: "await db.executeQuery(`DELETE\n/* selected archive */ FROM audit_events;`);"
      },
      {
        effect: "Truncate",
        sourcePath: "src/audit/purge.ts",
        line: 3,
        evidence: 'await prisma.$executeRawUnsafe("TRUNCATE TABLE audit_event_staging");'
      },
      {
        effect: "DropStorage",
        sourcePath: "src/audit/purge.ts",
        line: 4,
        evidence: "await prisma.$executeRaw`DROP TABLE audit_event_archive`;"
      },
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 5,
        evidence: "await tx.execute(sql`DELETE FROM audit_event_archive`);"
      }
    ]);
  });

  test("scans a direct raw-SQL first argument with bind values or a trailing comma", () => {
    const source = [
      'await prisma.$executeRawUnsafe("DELETE FROM audit_events WHERE id = $1", eventId);',
      'await db.execute("TRUNCATE TABLE audit_event_staging",);'
    ].join("\n");

    expect(analyzeSourceText("src/audit/purge.ts", source)).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 1,
        evidence:
          'await prisma.$executeRawUnsafe("DELETE FROM audit_events WHERE id = $1", eventId);'
      },
      {
        effect: "Truncate",
        sourcePath: "src/audit/purge.ts",
        line: 2,
        evidence: 'await db.execute("TRUNCATE TABLE audit_event_staging",);'
      }
    ]);
  });

  test("ignores inert TypeScript text and indirect or unrelated raw calls", () => {
    const source = [
      "// db.delete(auditEvents); prisma.auditEvent.deleteMany({});",
      'const quoted = "db.deleteFrom(\\"audit_events\\")";',
      "const templated = `prisma.auditEvent.delete({}); DROP TABLE audit_events`;",
      "const nestedTemplate = `${`db.delete(auditEvents)`}`;",
      'const query = "TRUNCATE TABLE audit_events";',
      'cache.delete("audit-events");',
      'router.delete("/audit-events/:id");',
      'service.execute("DROP TABLE audit_events");',
      'await prisma.$queryRawUnsafe("DELETE FROM audit_events");',
      "await db.executeQuery(query);",
      'await db.execute("DROP " + "TABLE audit_events");',
      "await db.execute(`DELETE FROM ${tableName}`);"
    ].join("\n");

    expect(analyzeSourceText("src/audit/report.ts", source)).toEqual([]);
  });

  test("uses TypeScript block-comment termination rather than SQL nesting rules", () => {
    const source = "/* note /* */ db.delete(auditEvents);";

    expect(analyzeSourceText("src/audit/purge.ts", source)).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 1,
        evidence: source
      }
    ]);
  });

  test("fails softly on malformed comments and literals", () => {
    expect(analyzeSourceText("db/audit/purge.sql", "/* DELETE FROM audit_events")).toEqual([]);
    expect(analyzeSourceText("db/audit/purge.sql", "'DROP TABLE audit_events")).toEqual([]);
    expect(
      analyzeSourceText("src/audit/purge.ts", 'db.execute("TRUNCATE TABLE audit_events')
    ).toEqual([]);
    expect(analyzeSourceText("src/audit/purge.ts", "/* db.delete(auditEvents)")).toEqual([]);
  });

  test("orders matches by source span and deduplicates one effect per evidence span", () => {
    const source =
      'db.execute("DROP TABLE archive; TRUNCATE TABLE staging; DELETE FROM old; DELETE FROM newer;");';
    const first = analyzeSourceText("src/audit/purge.ts", source);

    expect(first.map((hint) => hint.effect)).toEqual(["DropStorage", "Truncate", "HardDelete"]);
    expect(analyzeSourceText("src/audit/purge.ts", source)).toEqual(first);
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
