import { describe, expect, test } from "bun:test";
import { shapeReservedWords } from "./ast-generation-utils.ts";
import {
  isAddFunctionChange,
  isChangeDecl,
  isComponentDecl,
  isFunctionSummary,
  isModifyFunctionChange
} from "./language/generated/ast.ts";
import { parseShapeModule } from "./parser.ts";
import { unquoteShapeString } from "./shape-strings.ts";

describe("fn signature parsing", () => {
  test("parses a signature between source and description", () => {
    const parsed = parseShapeModule(`
      module gateway

      resource AuditLog

      component Gateway {
        owns AuditLog
        grants Append<AuditLog>
        fn writeAudit
          source ts("src/gateway.ts#writeAudit")
          signature ts("(entry: AuditEntry) => Promise<void>")
          description "Appends one audit entry."
          effects complete {
            Append<AuditLog>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const fn = parsed.module.declarations.find(isComponentDecl)?.members.find(isFunctionSummary);
    expect(fn?.signature?.language).toBe("ts");
    expect(unquoteShapeString(fn?.signature?.value ?? "")).toBe(
      "(entry: AuditEntry) => Promise<void>"
    );
  });

  test("keeps the signature optional", () => {
    const parsed = parseShapeModule(`
      module gateway
      component Gateway {
        fn writeAudit
          effects unknown
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const fn = parsed.module.declarations.find(isComponentDecl)?.members.find(isFunctionSummary);
    expect(fn?.signature).toBeUndefined();
  });

  test("rejects a signature declared after the description", () => {
    const parsed = parseShapeModule(`
      module gateway
      component Gateway {
        fn writeAudit
          description "Appends one audit entry."
          signature ts("() => void")
          effects unknown
      }
    `);

    expect(parsed.ok).toBe(false);
  });

  test("parses signatures on add and modify function changes", () => {
    const parsed = parseShapeModule(`
      module gateway

      change RetypeAudit {
        add fn Gateway.appendAudit
          signature ts("(entry: AuditEntry) => void")
          effects unknown
        modify fn Gateway.writeAudit
          source ts("src/gateway.ts#writeAudit")
          signature ts("(entry: AuditEntry) => Promise<void>")
          description "Appends one audit entry."
          effects unknown
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const change = parsed.module.declarations.find(isChangeDecl);
    const added = change?.entries.find(isAddFunctionChange);
    const modified = change?.entries.find(isModifyFunctionChange);
    expect(unquoteShapeString(added?.signature?.value ?? "")).toBe("(entry: AuditEntry) => void");
    expect(modified?.signature?.language).toBe("ts");
    expect(unquoteShapeString(modified?.signature?.value ?? "")).toBe(
      "(entry: AuditEntry) => Promise<void>"
    );
  });

  test("reserves the signature keyword for generated identifiers", () => {
    expect(shapeReservedWords().has("signature")).toBe(true);
  });
});
