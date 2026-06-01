import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkShapeModules,
  formatDiagnostics,
  formatShapeSource,
  parseShapeModule
} from "./index.ts";
import { shapeReservedWords } from "./ast-generation-utils.ts";
import { checkShapeSource, contextRef, fnTarget, requireParsed } from "./test-support.ts";

describe("Shape nested memory guard blocks", () => {
  const nested = `
    module gateway

    resource PolicySnapshot

    component Gateway {
      owns PolicySnapshot
      grants Read<PolicySnapshot>
      fn derivePolicyDecision : ProtectedCheckOrder
        effects complete {
          Read<PolicySnapshot>
        }
    }

    rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
      applies_to fn Gateway.derivePolicyDecision
      why CognitiveLocality
      summary "Inline."
      protects {
        description,
        shape PreserveInline
      }
      guards {
        on_change require ${contextRef("ReEvaluation", "Self")}
        forbid transform ExtractHelper
      }
      who {
        owner GatewayTeam
      }
      when {
        review_by "2026-08-18"
      }
    }
  `;

  const flat = `
    module gateway

    resource PolicySnapshot

    component Gateway {
      owns PolicySnapshot
      grants Read<PolicySnapshot>
      fn derivePolicyDecision : ProtectedCheckOrder
        effects complete {
          Read<PolicySnapshot>
        }
    }

    rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
      applies_to fn Gateway.derivePolicyDecision
      why CognitiveLocality
      summary "Inline."
      who { owner GatewayTeam }
      when { review_by "2026-08-18" }
      protects { shape PreserveInline }
      protects { description }
      guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      guards { forbid transform ExtractHelper }
    }
  `;

  test("parses and checks nested rationale blocks", () => {
    expect(checkShapeSource(nested).exitCode).toBe(0);
  });

  test("formatter canonicalizes flat and nested context members to the block form", () => {
    const nestedFormatted = formatShapeSource(nested);
    const flatFormatted = formatShapeSource(flat);

    expect(nestedFormatted.ok).toBe(true);
    expect(flatFormatted.ok).toBe(true);
    if (!nestedFormatted.ok || !flatFormatted.ok) {
      return;
    }
    // Flat and nested inputs canonicalize to the same grouped block form.
    expect(nestedFormatted.formatted).toBe(flatFormatted.formatted);
    expect(nestedFormatted.formatted).toContain("protects {");
    expect(nestedFormatted.formatted).toContain("guards {");
    expect(nestedFormatted.formatted).toContain("who {");
    expect(nestedFormatted.formatted).toContain("when {");
  });

  test("nested guards block still enforces a forbid-transform guard", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Inline."
        guards {
          forbid transform ExtractHelper
        }
      }

      change ExtractIt {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          transform ExtractHelper
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("applies the ExtractHelper transform to the guarded target");
  });

  test("supports nested blocks in a memory declaration", () => {
    const result = checkShapeSource(`
      module bridge

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn pollAttestation : RefactorSensitive
          effects complete {
            Read<Attestation>
          }
      }

      memory PollConstraint : ${contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Timing-sensitive."
        who {
          owner BridgeTeam
        }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("preserves the exact protected-property set from a nested protects block", () => {
    // Regression: a value-less entry (description) before a valued entry
    // (shape PreserveInline) must not let the optional value swallow the next
    // entry's keyword.
    const parsed = requireParsed(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : ProtectedCheckOrder
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Inline."
        protects {
          description,
          shape PreserveInline
        }
      }
    `);
    const facts = checkShapeModules([parsed], { includeFacts: true }).facts ?? [];
    const protectedProps = facts
      .filter((fact) => fact.kind === "protected_shape")
      .map((fact) => `${fact.propertyKind} ${fact.propertyValue}`.trim())
      .sort();

    expect(protectedProps).toEqual(["description", "shape PreserveInline"]);
  });

  test("formats nested blocks idempotently", () => {
    const once = formatShapeSource(nested);
    expect(once.ok).toBe(true);
    if (!once.ok) {
      return;
    }
    const twice = formatShapeSource(once.formatted);
    expect(twice.ok).toBe(true);
    if (twice.ok) {
      expect(twice.formatted).toBe(once.formatted);
    }
  });

  test("accepts and erases empty nested blocks", () => {
    const result = formatShapeSource(`
      rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Inline."
        protects {
        }
        guards {
        }
        who {
        }
        when {
        }
      }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const marker of ["protects {", "guards {", "who {", "when {"]) {
      expect(result.formatted).not.toContain(marker);
    }
  });

  test("rejects more than one entry in a single-valued who block", () => {
    const parsed = parseShapeModule(`
      module gateway

      rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        who {
          owner GatewayTeam
          owner SecurityTeam
        }
      }
    `);

    expect(parsed.ok).toBe(false);
  });
});

describe("Shape grammar keyword reservation", () => {
  test("reserved words cover every ID-shaped grammar keyword", async () => {
    const grammar = await Bun.file(join(import.meta.dir, "language", "shape.langium")).text();
    const keywords = new Set(
      [...grammar.matchAll(/'([a-zA-Z_][a-zA-Z0-9_]*)'/g)].map((match) => match[1] as string)
    );
    const reserved = shapeReservedWords();
    const missing = [...keywords].filter((keyword) => !reserved.has(keyword)).sort();

    expect(missing).toEqual([]);
  });
});
