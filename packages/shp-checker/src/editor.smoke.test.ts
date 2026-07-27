import { describe, expect, test } from "bun:test";
import {
  formatOnSave,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText
} from "./index.ts";

describe("Shape editor request smoke", () => {
  test("serves a valid Memory Guard file through every editor primitive", async () => {
    const source = await Bun.file("fixtures/pass/memory_guard_preserve_inline/audit.shape").text();
    const contextReference = "InlineRationale<fn Gateway.derivePolicyDecision>";

    expect(getEditorDiagnostics(source)).toEqual([]);
    expect(getHoverText(source, "PreserveInline")).toContain("InlineRationale");
    expect(getCompletions(source, "Inline")).toContain("InlineRationale");
    expect(getCompletions(source, "DerivePolicy")).toContain("DerivePolicyDecisionInline");

    const definition = getDefinitionLocation(source, contextReference);
    const contextLine = source.split("\n")[13] ?? "";
    expect(definition).toEqual({
      symbol: contextReference,
      line: 14,
      column: contextLine.indexOf("InlineRationale") + 1
    });

    const formatted = formatOnSave(source);
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) {
      throw new Error("valid editor smoke fixture should format");
    }
    expect(formatOnSave(formatted.formatted)).toEqual(formatted);
  });

  test("returns a stable obligation diagnostic for an invalid Memory Guard file", async () => {
    const source = await Bun.file(
      "fixtures/fail/memory_guard_missing_rationale/audit.shape"
    ).text();
    const diagnostics = getEditorDiagnostics(source);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("InlineRationale");
    expect(getHoverText(source, "PreserveInline")).toContain("InlineRationale");
    expect(getCompletions(source, "Inline")).toEqual(["InlineRationale"]);
    expect(
      getDefinitionLocation(source, "InlineRationale<fn Gateway.derivePolicyDecision>")
    ).toBeUndefined();
  });
});
