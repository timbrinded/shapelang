import { describe, expect, test } from "bun:test";
import {
  formatOnSave,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getEditorDiagnosticsForDocuments,
  getHoverText
} from "./index.ts";
import {
  PRELUDE_CONTEXT_REQUIREMENTS,
  PRELUDE_CONTEXT_TYPE_NAMES,
  PRELUDE_RELATION_KIND_NAMES
} from "./prelude.ts";
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

  test("checks imported modules as one editor document set", async () => {
    const documents = [
      {
        filePath: "/workspace/base.shape",
        source: `module base

resource AuditEvent
`
      },
      {
        filePath: "/workspace/consumer.shape",
        source: `module consumer

import base

component AuditStore {
  owns AuditEvent
}
`
      }
    ];

    expect(getEditorDiagnostics(documents[1]?.source ?? "", documents[1]?.filePath)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("unknown resource")
      })
    ]);
    expect(getEditorDiagnosticsForDocuments(documents)).toEqual([]);

    const authoredModel = await Promise.all(
      [
        "shape/language.shape",
        "shape/checker.shape",
        "shape/tooling.shape",
        "shape/incremental-checker.shape",
        "shape/delivery.shape"
      ].map(async (filePath) => ({
        filePath,
        source: await Bun.file(filePath).text()
      }))
    );
    const toolingOnly = getEditorDiagnostics(
      authoredModel[2]?.source ?? "",
      authoredModel[2]?.filePath
    );

    expect(
      toolingOnly.some((diagnostic) => diagnostic.message.includes("unknown relation_endpoint"))
    ).toBe(true);
    expect(getEditorDiagnosticsForDocuments(authoredModel)).toEqual([]);
  });

  test("associates multi-document semantic diagnostics with their source file", () => {
    const diagnostics = getEditorDiagnosticsForDocuments([
      {
        filePath: "/workspace/valid.shape",
        source: `module valid

resource Healthy
`
      },
      {
        filePath: "/workspace/broken.shape",
        source: `module broken

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent

  fn mystery
    effects unknown
}
`
      }
    ]);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        filePath: "/workspace/broken.shape",
        message: expect.stringContaining("unknown effects")
      })
    ]);
  });

  test("returns parse diagnostics before multi-document semantic diagnostics", () => {
    const diagnostics = getEditorDiagnosticsForDocuments([
      {
        filePath: "/workspace/broken-semantics.shape",
        source: `module broken

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent

  fn mystery
    effects unknown
}
`
      },
      {
        filePath: "/workspace/broken-syntax.shape",
        source: "component {"
      }
    ]);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(
      diagnostics.every((diagnostic) => diagnostic.filePath === "/workspace/broken-syntax.shape")
    ).toBe(true);
    expect(diagnostics.every((diagnostic) => !diagnostic.message.includes("unknown effects"))).toBe(
      true
    );
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
      module scoped

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
    if (!alpha) {
      throw new Error("Expected Alpha.handle to have a definition.");
    }
    expect(getDefinitionLocation(scopedSource, "scoped::Alpha.handle")).toEqual({
      ...alpha,
      symbol: "scoped::Alpha.handle"
    });
    expect(getDefinitionLocation(scopedSource, "other::Alpha.handle")).toBeUndefined();
  });

  test("keeps module-qualified definition lookup scoped to the parsed module", () => {
    expect(getDefinitionLocation(source, "audit::AuditEvent")).toEqual({
      symbol: "audit::AuditEvent",
      line: 4,
      column: 5
    });
    expect(getDefinitionLocation(source, "other::AuditEvent")).toBeUndefined();
    expect(getHoverText(source, "audit::AuditEvent")).toContain("kind: resource");
  });

  test("resolves exact context obligations and reevaluation targets", () => {
    const contextSource = `module context

component Alpha {
  fn handle
    effects complete {
    }
}

component Beta {
  fn handle
    effects complete {
    }
}

rationale AlphaInline : InlineRationale<fn Alpha.handle> {
}

rationale BetaInline : InlineRationale<fn Beta.handle> {
}

reevaluation BetaInlineRechecked {
  satisfies rationale BetaInline
}
`;

    expect(getDefinitionLocation(contextSource, "InlineRationale<fn Alpha.handle>")).toEqual({
      symbol: "InlineRationale<fn Alpha.handle>",
      line: 15,
      column: 25
    });
    expect(getDefinitionLocation(contextSource, "InlineRationale<fn Beta.handle>")).toEqual({
      symbol: "InlineRationale<fn Beta.handle>",
      line: 18,
      column: 24
    });
    expect(getDefinitionLocation(contextSource, "BetaInline")).toEqual({
      symbol: "BetaInline",
      line: 18,
      column: 1
    });
    expect(getCompletions(contextSource, "BetaInline")).toEqual([
      "BetaInline",
      "BetaInlineRechecked"
    ]);
  });

  test("derives editor shape-trait help from the prelude registry", () => {
    for (const requirement of PRELUDE_CONTEXT_REQUIREMENTS) {
      expect(getCompletions("", requirement.trait)).toContain(requirement.trait);
      expect(getHoverText("", requirement.trait)).toContain(requirement.contextType);
    }
    for (const relationKind of PRELUDE_RELATION_KIND_NAMES) {
      expect(getCompletions("", relationKind)).toContain(relationKind);
    }
    for (const contextType of PRELUDE_CONTEXT_TYPE_NAMES) {
      expect(getCompletions("", contextType)).toContain(contextType);
    }
  });
});
