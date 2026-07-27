import { describe, expect, test } from "bun:test";
import {
  formatOnSave,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText
} from "./index.ts";
import { PRELUDE_CONTEXT_REQUIREMENTS, PRELUDE_RELATION_KIND_NAMES } from "./prelude.ts";
import { contextRef, fnTarget } from "./test-support.ts";

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
    expect(getHoverText(source, "PreserveInline")).toContain("InlineRationale");
    expect(getDefinitionLocation(source, "AuditStore")?.line).toBeGreaterThan(1);
    expect(
      getDefinitionLocation(
        `
      component Gateway {
        fn derivePolicyDecision
          effects unknown
      }

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
      }
    `,
        "InlineRationale"
      )?.line
    ).toBeGreaterThan(1);
    expect(getCompletions(source, "Audit")).toContain("AuditStore.appendEvent");
    expect(getCompletions(source, "Preserve")).toContain("PreserveInline");
    expect(getCompletions(source, "forbid p")).toContain("forbid path");
    expect(getCompletions(source, "requ")).toContain("requires");

    const formatted = formatOnSave(source);
    expect(formatted.ok).toBe(true);
    if (formatted.ok) {
      expect(formatted.formatted).toContain("component AuditStore");
    }
  });

  test("keeps qualified function definition lookup scoped to components", () => {
    const scopedSource = `
      component Alpha {
        fn handle
          effects unknown
      }

      component Beta {
        fn handle
          effects unknown
      }
    `;

    const alpha = getDefinitionLocation(scopedSource, "Alpha.handle");
    const beta = getDefinitionLocation(scopedSource, "Beta.handle");

    expect(alpha?.line).toBeGreaterThan(1);
    expect(beta?.line).toBeGreaterThan(alpha?.line ?? 0);
  });

  test("derives editor shape-trait help from the prelude registry", () => {
    for (const requirement of PRELUDE_CONTEXT_REQUIREMENTS) {
      expect(getCompletions("", requirement.trait)).toContain(requirement.trait);
      expect(getHoverText("", requirement.trait)).toContain(requirement.contextType);
    }
    for (const relationKind of PRELUDE_RELATION_KIND_NAMES) {
      expect(getCompletions("", relationKind)).toContain(relationKind);
    }
  });
});
