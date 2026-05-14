import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  checkShapeFiles,
  checkShapeModules,
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
      resolve(repoRoot, "fixtures/pass/append_only_append/audit.shp")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("passes append-only read fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/append_only_read/audit.shp")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("rejects hard delete against append-only resource", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/append_only_hard_delete/audit.shp")
    ]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditStore.purgeOldEvents");
    expect(output).toContain("HardDelete<AuditEvent>");
    expect(output).toContain("AuditEvent has trait AppendOnly");
    expect(output).toContain("AppendOnly forbids final HardDelete<AuditEvent>");
    expect(output).toContain("evidence: ts(\"src/audit/purge.ts:12-16\")");
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
});
