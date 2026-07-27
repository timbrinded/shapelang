import { describe, expect, test } from "bun:test";
import { formatDiagnostics } from "./index.ts";
import { checkShapeSource } from "./test-support.ts";

const UNKNOWN_EFFECTS_SOURCE = `
  module draft

  component AuditStore {
    fn appendEvent
      effects unknown
  }
`;

describe("draft validation", () => {
  test("keeps unknown effects blocking by default", () => {
    const result = checkShapeSource(UNKNOWN_EFFECTS_SOURCE);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unknown_effects", severity: "error" })
    );
    expect(formatDiagnostics(result)).toContain("error: unknown effects");
  });

  test("reports unknown effects as non-fatal warnings when explicitly allowed", () => {
    const result = checkShapeSource(UNKNOWN_EFFECTS_SOURCE, {
      allowUnknownEffects: true
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        kind: "unknown_effects",
        severity: "warning"
      })
    ]);
    expect(formatDiagnostics(result)).toContain("warning: unknown effects");
    expect(formatDiagnostics(result)).toContain("Shape check passed with warnings.");
  });

  test("keeps unrelated semantic failures blocking in draft validation", () => {
    const result = checkShapeSource(
      `
        module draft

        resource AuditEvent

        component AuditStore {
          fn appendEvent
            effects unknown
          fn listEvents
            effects complete {
              Read<AuditEvent>
            }
        }
      `,
      { allowUnknownEffects: true }
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unknown_effects", severity: "warning" })
    );
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ kind: "missing_grant" }));
    expect(formatDiagnostics(result)).toContain("error: missing grant");
  });
});
