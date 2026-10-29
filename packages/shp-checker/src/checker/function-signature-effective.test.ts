import { describe, expect, test } from "bun:test";
import { requireParsed } from "../test-support.ts";
import { inspectShapeModules } from "./inspection.ts";
import { lowerShapeModules } from "./lowerer.ts";

const BASE = `
  module gateway

  resource AuditLog

  component Gateway {
    owns AuditLog
    grants Append<AuditLog>
    fn writeAudit
      source ts("src/gateway.ts#writeAudit")
      signature ts("(entry: AuditEntry) => Promise<void>")
      effects complete {
        Append<AuditLog>
      }
  }
`;

const UNTYPED = `
  module gateway
  component Gateway {
    fn writeAudit
      effects unknown
  }
`;

function signatureFor(functionName: string, sources: string[]) {
  const model = lowerShapeModules(sources.map((source) => requireParsed(source)));
  return model.components.get("gateway::Gateway")?.functions.get(functionName)?.signature;
}

describe("effective fn signatures", () => {
  test("keeps the quotes of a signature that begins and ends with a string-literal type", () => {
    const quoted = BASE.replace(
      'signature ts("(entry: AuditEntry) => Promise<void>")',
      String.raw`signature ts("\"open\" | \"closed\"")`
    );
    expect(signatureFor("writeAudit", [quoted])).toEqual({
      language: "ts",
      value: '"open" | "closed"'
    });
  });

  test("a modify that omits the signature removes it, as it removes an omitted description", () => {
    expect(
      signatureFor("writeAudit", [
        BASE,
        `
          module gateway

          change ExtractAuditWriter {
            modify fn Gateway.writeAudit
              transform ExtractHelper
              effects complete {
                Append<AuditLog>
              }
          }
        `
      ])
    ).toBeUndefined();
  });

  test("updates the signature when modify supplies one", () => {
    expect(
      signatureFor("writeAudit", [
        BASE,
        `
          module gateway

          change RetypeAuditWriter {
            modify fn Gateway.writeAudit
              signature ts("(entry: AuditEntry, now: Date) => Promise<void>")
              effects complete {
                Append<AuditLog>
              }
          }
        `
      ])
    ).toEqual({ language: "ts", value: "(entry: AuditEntry, now: Date) => Promise<void>" });
  });

  test("records the signature an add change declares", () => {
    expect(
      signatureFor("appendAudit", [
        BASE,
        `
          module gateway

          change AddAuditAppender {
            add fn Gateway.appendAudit
              signature ts("(entry: AuditEntry) => void")
              effects complete {
                Append<AuditLog>
              }
          }
        `
      ])
    ).toEqual({ language: "ts", value: "(entry: AuditEntry) => void" });
  });

  test("reports the signature in inspection JSON and omits it when absent", () => {
    const typed = inspectShapeModules(
      [{ module: requireParsed(BASE), filePath: "shape/gateway.shape" }],
      { shapeVersion: "0.0.0-test" }
    );
    const untyped = inspectShapeModules(
      [{ module: requireParsed(UNTYPED), filePath: "shape/gateway.shape" }],
      { shapeVersion: "0.0.0-test" }
    );

    expect(typed.functions[0]?.signature).toEqual({
      language: "ts",
      value: "(entry: AuditEntry) => Promise<void>"
    });
    expect(JSON.stringify(untyped.functions[0])).not.toContain("signature");
  });
});
