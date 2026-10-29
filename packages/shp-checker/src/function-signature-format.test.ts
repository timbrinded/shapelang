import { describe, expect, test } from "bun:test";
import { formatShapeSource } from "./formatter.ts";

function format(source: string): string {
  const result = formatShapeSource(source, "memory.shape");
  if (!result.ok) {
    throw new Error(result.diagnostics.map(({ message }) => message).join("\n"));
  }
  return result.formatted;
}

describe("fn signature formatting", () => {
  test("prints the signature between source and description", () => {
    const formatted = format(`
      module gateway
      resource AuditLog
      component Gateway {
        owns AuditLog
        grants Append<AuditLog>
        fn writeAudit
          source ts("src/gateway.ts#writeAudit")
          signature ts('(entry: AuditEntry) => Promise<void>')
          description "Appends one audit entry."
          effects complete {
            Append<AuditLog>
          }
      }
    `);

    expect(formatted).toContain(
      [
        '    source ts("src/gateway.ts#writeAudit")',
        '    signature ts("(entry: AuditEntry) => Promise<void>")',
        '    description "Appends one audit entry."'
      ].join("\n")
    );
    expect(format(formatted)).toBe(formatted);
  });

  test("round-trips signatures on add and modify function changes", () => {
    const formatted = format(`
      module gateway
      change RetypeAudit {
        modify fn Gateway.writeAudit
          transform ExtractHelper
          source ts("src/gateway.ts#writeAudit")
          signature ts("(entry: AuditEntry) => Promise<void>")
          effects unknown
        add fn Gateway.appendAudit
          signature ts("(entry: AuditEntry) => void")
          effects unknown
      }
    `);

    expect(formatted).toContain(
      [
        '    source ts("src/gateway.ts#writeAudit")',
        '    signature ts("(entry: AuditEntry) => Promise<void>")'
      ].join("\n")
    );
    expect(formatted).toContain('    signature ts("(entry: AuditEntry) => void")');
    expect(format(formatted)).toBe(formatted);
  });
});
