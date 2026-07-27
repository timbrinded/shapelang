import { describe, expect, test } from "bun:test";
import {
  analyzeSourceText,
  compareAnalyzerHintsToShape,
  formatAnalyzerWarnings,
  parseShapeModule
} from "./index.ts";

function withoutTargetIdentity(hints: ReturnType<typeof analyzeSourceText>) {
  return hints.map(({ targetIdentity: _targetIdentity, ...hint }) => hint);
}

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

    expect(withoutTargetIdentity(analyzeSourceText("db/audit/purge.sql", source))).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "db/audit/purge.sql",
        line: 1,
        evidence: "DELETE\n/* retention policy */\nFROM audit_events;",
        target: "audit_events"
      },
      {
        effect: "Truncate",
        sourcePath: "db/audit/purge.sql",
        line: 5,
        evidence: "TRUNCATE\n-- optional keyword\nTABLE audit_event_staging;",
        target: "audit_event_staging"
      },
      {
        effect: "DropStorage",
        sourcePath: "db/audit/purge.sql",
        line: 8,
        evidence: "DROP /* archive rotation */ TEMPORARY\nTABLE audit_event_archive;",
        target: "audit_event_archive"
      }
    ]);
  });

  test("infers schema-qualified and quoted SQL targets without changing evidence", () => {
    const source = [
      "DELETE FROM archive.audit_events;",
      'TRUNCATE TABLE "archive"."audit_event_staging";',
      "DROP TABLE [archive].[audit_event_archive];"
    ].join("\n");

    const hints = analyzeSourceText("db/audit/purge.sql", source);

    expect(hints.map((hint) => hint.target)).toEqual([
      "archive.audit_events",
      "archive.audit_event_staging",
      "archive.audit_event_archive"
    ]);
    expect(hints.map((hint) => hint.evidence)).toEqual(source.split("\n"));
  });

  test("skips supported SQL target modifiers without mistaking them for resources", () => {
    const source = [
      "DELETE FROM ONLY audit_events;",
      "TRUNCATE TABLE ONLY audit_event_staging;",
      "DROP TABLE IF EXISTS audit_event_archive;",
      'TRUNCATE "ONLY";',
      'DROP TABLE "IF";'
    ].join("\n");

    expect(analyzeSourceText("db/audit/purge.sql", source).map((hint) => hint.target)).toEqual([
      "audit_events",
      "audit_event_staging",
      "audit_event_archive",
      "ONLY",
      "IF"
    ]);
  });

  test("infers only direct static targets from supported library calls", () => {
    const source = [
      'db.deleteFrom("audit_events").execute();',
      "prisma.auditEvent.delete({ where: { id: 1 } });",
      "db.delete(auditEvents);",
      'db.schema.dropTable("audit_event_archive").execute();',
      "db.deleteFrom(tableName).execute();",
      "db.delete(resolveTable());",
      "db.delete(schema.auditEvents);"
    ].join("\n");

    expect(analyzeSourceText("src/audit/purge.ts", source).map((hint) => hint.target)).toEqual([
      "audit_events",
      "auditEvent",
      "auditEvents",
      "audit_event_archive",
      undefined,
      undefined,
      undefined
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

    expect(withoutTargetIdentity(analyzeSourceText("db/audit/purge.sql", source))).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "db/audit/purge.sql",
        line: 2,
        evidence: "DELETE\r\nFROM audit_events;",
        target: "audit_events"
      },
      {
        effect: "DropStorage",
        sourcePath: "db/audit/purge.sql",
        line: 4,
        evidence: "DROP TABLE audit_event_archive;",
        target: "audit_event_archive"
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

    expect(withoutTargetIdentity(analyzeSourceText("src/audit/purge.ts", source))).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 1,
        evidence: "await db.executeQuery(`DELETE\n/* selected archive */ FROM audit_events;`);",
        target: "audit_events"
      },
      {
        effect: "Truncate",
        sourcePath: "src/audit/purge.ts",
        line: 3,
        evidence: 'await prisma.$executeRawUnsafe("TRUNCATE TABLE audit_event_staging");',
        target: "audit_event_staging"
      },
      {
        effect: "DropStorage",
        sourcePath: "src/audit/purge.ts",
        line: 4,
        evidence: "await prisma.$executeRaw`DROP TABLE audit_event_archive`;",
        target: "audit_event_archive"
      },
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 5,
        evidence: "await tx.execute(sql`DELETE FROM audit_event_archive`);",
        target: "audit_event_archive"
      }
    ]);
  });

  test("scans a direct raw-SQL first argument with bind values or a trailing comma", () => {
    const source = [
      'await prisma.$executeRawUnsafe("DELETE FROM audit_events WHERE id = $1", eventId);',
      'await db.execute("TRUNCATE TABLE audit_event_staging",);'
    ].join("\n");

    expect(withoutTargetIdentity(analyzeSourceText("src/audit/purge.ts", source))).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 1,
        evidence:
          'await prisma.$executeRawUnsafe("DELETE FROM audit_events WHERE id = $1", eventId);',
        target: "audit_events"
      },
      {
        effect: "Truncate",
        sourcePath: "src/audit/purge.ts",
        line: 2,
        evidence: 'await db.execute("TRUNCATE TABLE audit_event_staging",);',
        target: "audit_event_staging"
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

    expect(withoutTargetIdentity(analyzeSourceText("src/audit/purge.ts", source))).toEqual([
      {
        effect: "HardDelete",
        sourcePath: "src/audit/purge.ts",
        line: 1,
        evidence: source,
        target: "auditEvents"
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

  test("orders matches by source span and keeps distinct static targets", () => {
    const source =
      'db.execute("DROP TABLE archive; TRUNCATE TABLE staging; DELETE FROM old; DELETE FROM newer;");';
    const first = analyzeSourceText("src/audit/purge.ts", source);

    expect(first.map((hint) => hint.effect)).toEqual([
      "DropStorage",
      "Truncate",
      "HardDelete",
      "HardDelete"
    ]);
    expect(first.map((hint) => hint.target)).toEqual(["archive", "staging", "old", "newer"]);
    expect(analyzeSourceText("src/audit/purge.ts", source)).toEqual(first);
  });

  test("emits one ordered hint for every static multi-target SQL resource", () => {
    const source = [
      'DROP TABLE IF EXISTS "audit_events", archive.credentials;',
      'TRUNCATE TABLE ONLY audit_events, ONLY "Credentials";'
    ].join("\n");
    const hints = analyzeSourceText("db/audit/purge.sql", source);

    expect(
      hints.map((hint) => ({
        effect: hint.effect,
        line: hint.line,
        target: hint.target
      }))
    ).toEqual([
      { effect: "DropStorage", line: 1, target: "audit_events" },
      { effect: "DropStorage", line: 1, target: "archive.credentials" },
      { effect: "Truncate", line: 2, target: "audit_events" },
      { effect: "Truncate", line: 2, target: "Credentials" }
    ]);

    expect(
      analyzeSourceText("db/audit/purge.sql", "DROP TABLE audit_events, audit_events;").map(
        (hint) => hint.target
      )
    ).toEqual(["audit_events", "audit_events"]);

    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent {
        storage postgres.table("audit_events")
      }

      component AuditStore {
        fn purge
          source sql("db/audit/purge.sql")
          effects complete {
            DropStorage<AuditEvent>
            Truncate<AuditEvent>
          }
      }
    `);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(
      compareAnalyzerHintsToShape(hints, [parsed.module]).map((warning) =>
        warning.kind === "target_mismatch"
          ? [warning.hint.effect, warning.suspectedTarget]
          : warning.kind
      )
    ).toEqual([
      ["DropStorage", "archive.credentials"],
      ["Truncate", "Credentials"]
    ]);
  });

  test("attributes hints to conservatively recognized TypeScript function scopes", () => {
    const source = [
      'function purgeDeclared() { db.deleteFrom("declared").execute(); }',
      'class Store { async purgeMethod() { db.deleteFrom("method").execute(); } }',
      'function purgeObjectReturn(): { ok: boolean; value?: { nested: true } } { db.deleteFrom("objectReturn").execute(); return { ok: true }; }',
      'function purgeGeneric<T extends (...args: unknown[]) => Array<Map<string, number>>, U = ReturnType<T>>(): void { db.deleteFrom("generic").execute(); }',
      'class GenericStore { purgeGenericMethod<T extends Map<string, Array<number>>>() { db.deleteFrom("genericMethod").execute(); } }',
      'const purgeArrow = () => { db.deleteFrom("arrow").execute(); };',
      'const dynamic = wrap(() => { db.deleteFrom("dynamic").execute(); });',
      "function malformed(",
      'db.deleteFrom("malformed").execute();'
    ].join("\n");

    expect(
      analyzeSourceText("src/audit/purge.ts", source).map((hint) => ({
        target: hint.target,
        sourceAnchor: hint.sourceAnchor
      }))
    ).toEqual([
      { target: "declared", sourceAnchor: "purgeDeclared" },
      { target: "method", sourceAnchor: "purgeMethod" },
      { target: "objectReturn", sourceAnchor: "purgeObjectReturn" },
      { target: "generic", sourceAnchor: "purgeGeneric" },
      { target: "genericMethod", sourceAnchor: "purgeGenericMethod" },
      { target: "arrow", sourceAnchor: "purgeArrow" },
      { target: "dynamic", sourceAnchor: undefined },
      { target: "malformed", sourceAnchor: undefined }
    ]);
  });

  test("compares targets against the exact matching Shape source anchor", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent {
        storage postgres.table("audit_events")
      }

      resource User {
        storage postgres.table("users")
      }

      component AuditStore {
        fn purgeEvents
          source ts("src/store.ts#purgeEvents")
          effects complete {
            HardDelete<AuditEvent>
          }

        fn purgeUsers
          source ts("src/store.ts#purgeUsers")
          effects complete {
            HardDelete<User>
          }

        fn purgeGeneric
          source ts("src/store.ts#purgeGeneric")
          effects complete {
            HardDelete<User>
          }

        fn purgeGenericMethod
          source ts("src/store.ts#purgeGenericMethod")
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const hints = analyzeSourceText(
      "src/store.ts",
      [
        'function purgeEvents(){db.deleteFrom("users").execute()}',
        'function purgeUsers(){db.deleteFrom("audit_events").execute()}',
        'function purgeGeneric<T extends Map<string, Array<number>>>(){db.deleteFrom("audit_events").execute()}',
        'class Store { purgeGenericMethod<T extends { id: string; nested: Array<Map<string, string>> }>(){db.deleteFrom("users").execute()} }'
      ].join("\n")
    );
    const warnings = compareAnalyzerHintsToShape(hints, [parsed.module]);

    expect(warnings.map((warning) => warning.kind)).toEqual([
      "target_mismatch",
      "target_mismatch",
      "target_mismatch",
      "target_mismatch"
    ]);
    expect(
      warnings.map((warning) =>
        warning.kind === "target_mismatch"
          ? [warning.hint.sourceAnchor, warning.suspectedTarget, warning.declaredTargets]
          : undefined
      )
    ).toEqual([
      ["purgeEvents", "users", ["AuditEvent"]],
      ["purgeUsers", "audit_events", ["User"]],
      ["purgeGeneric", "audit_events", ["User"]],
      ["purgeGenericMethod", "users", ["AuditEvent"]]
    ]);
  });

  test("preserves quoted SQL identity when comparing storage targets", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent {
        storage postgres.table("audit_events")
      }

      resource ArchivedAuditEvent {
        storage postgres.table("archive.audit_events")
      }

      component AuditStore {
        fn purge
          source sql("db/audit/purge.sql")
          effects complete {
            HardDelete<AuditEvent>
            HardDelete<ArchivedAuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const hints = [
      ...analyzeSourceText("db/audit/purge.sql", 'DELETE FROM "audit-events";'),
      ...analyzeSourceText("db/audit/purge.sql", 'DELETE FROM "Audit_Events";'),
      ...analyzeSourceText("db/audit/purge.sql", "DELETE FROM Audit_Events;"),
      ...analyzeSourceText("db/audit/purge.sql", 'DELETE FROM archive."audit_events";'),
      ...analyzeSourceText("db/audit/purge.sql", 'DELETE FROM archive."Audit_Events";')
    ];
    expect(hints[1]?.targetIdentity).toEqual({
      kind: "sql",
      segments: [{ value: "Audit_Events", quoted: true }]
    });
    const warnings = compareAnalyzerHintsToShape(structuredClone(hints), [parsed.module]);

    expect(
      warnings.map((warning) =>
        warning.kind === "target_mismatch" ? warning.suspectedTarget : warning.kind
      )
    ).toEqual(["audit-events", "Audit_Events", "archive.Audit_Events"]);
  });

  test("does not silently union divergent scoped targets for an unscoped hint", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent {
        storage postgres.table("audit_events")
      }

      resource User {
        storage postgres.table("users")
      }

      component AuditStore {
        fn filePurge
          source ts("src/store.ts")
          effects complete {
            HardDelete<AuditEvent>
          }

        fn purgeEvents
          source ts("src/store.ts#purgeEvents")
          effects complete {
            HardDelete<AuditEvent>
          }

        fn purgeUsers
          source ts("src/store.ts#purgeUsers")
          effects complete {
            HardDelete<User>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const [hint] = analyzeSourceText(
      "src/store.ts",
      'const dynamic = wrap(() => db.deleteFrom("audit_events").execute());'
    );
    expect(hint?.sourceAnchor).toBeUndefined();
    expect(hint).toBeDefined();
    if (!hint) {
      return;
    }

    const warnings = compareAnalyzerHintsToShape([hint], [parsed.module]);
    expect(warnings).toEqual([
      {
        kind: "ambiguous_source_attribution",
        hint,
        declaredAnchors: ["purgeEvents", "purgeUsers"],
        declaredTargets: ["AuditEvent", "User"]
      }
    ]);
  });

  test("does not let a path-only effect hide one anchored target contract", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent {
        storage postgres.table("audit_events")
      }

      resource User {
        storage postgres.table("users")
      }

      component AuditStore {
        fn filePurge
          source ts("src/store.ts")
          effects complete {
            HardDelete<AuditEvent>
          }

        fn purgeUsers
          source ts("src/store.ts#purgeUsers")
          effects complete {
            HardDelete<User>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const [hint] = analyzeSourceText(
      "src/store.ts",
      'const purgeUsers = () => db.deleteFrom("audit_events").execute();'
    );
    expect(hint?.sourceAnchor).toBeUndefined();
    expect(hint).toBeDefined();
    if (!hint) {
      return;
    }

    expect(compareAnalyzerHintsToShape([hint], [parsed.module])).toEqual([
      {
        kind: "ambiguous_source_attribution",
        hint,
        declaredAnchors: ["purgeUsers"],
        declaredTargets: ["AuditEvent", "User"]
      }
    ]);
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
    expect(warnings[0]?.kind).toBe("missing_declared_effect");
    expect(output).toContain("missing from shape effects");
    expect(output).toContain("HardDelete");
  });

  test("preserves missing-effect wording for targetless hints", () => {
    expect(
      formatAnalyzerWarnings([
        {
          kind: "missing_declared_effect",
          hint: {
            effect: "HardDelete",
            sourcePath: "src/audit/purge.ts",
            line: 2,
            evidence: "db.deleteFrom(tableName)"
          }
        }
      ])
    ).toBe(
      [
        "warning: analyzer hint missing from shape effects",
        "",
        "src/audit/purge.ts:2 suggests HardDelete.",
        "evidence: db.deleteFrom(tableName)",
        ""
      ].join("\n")
    );
  });

  test("matches inferred targets against resource names and storage aliases", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent {
        storage postgres.table("archive.audit_events")
      }

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purge
          source ts("src/audit/purge.ts#purge")
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const hint = (target?: string) => ({
      effect: "HardDelete" as const,
      sourcePath: "src/audit/purge.ts",
      line: 1,
      evidence: "DELETE",
      ...(target === undefined ? {} : { target })
    });

    expect(
      compareAnalyzerHintsToShape(
        [hint("auditEvent"), hint("archive.audit_events")],
        [parsed.module]
      )
    ).toEqual([]);
    expect(compareAnalyzerHintsToShape([hint()], [parsed.module])).toEqual([]);

    const warnings = compareAnalyzerHintsToShape([hint("public.audit_events")], [parsed.module]);
    expect(warnings).toEqual([
      {
        kind: "target_mismatch",
        hint: hint("public.audit_events"),
        suspectedTarget: "public.audit_events",
        declaredTargets: ["AuditEvent"]
      }
    ]);
    expect(formatAnalyzerWarnings(warnings)).toContain(
      "warning: analyzer hint target does not match shape effects"
    );
    expect(formatAnalyzerWarnings(warnings)).toContain("suspected target: public.audit_events");
  });

  test("reports a target mismatch when the matching declared target is not a resource", () => {
    const parsed = parseShapeModule(`
      module audit

      component AuditStore {
        fn purge
          source ts("src/audit/purge.ts#purge")
          effects complete {
            HardDelete<MissingAuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const warnings = compareAnalyzerHintsToShape(
      [
        {
          effect: "HardDelete",
          sourcePath: "src/audit/purge.ts",
          line: 1,
          evidence: "prisma.missingAuditEvent.delete({})",
          target: "missingAuditEvent"
        }
      ],
      [parsed.module]
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("target_mismatch");
  });
});
