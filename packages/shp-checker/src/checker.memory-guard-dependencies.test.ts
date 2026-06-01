import { describe, expect, test } from "bun:test";
import { explainShapeModules, formatDiagnostics } from "./index.ts";
import { checkShapeSource, contextRef, requireParsed } from "./test-support.ts";

describe("Shape dependency-target guards", () => {
  function relationGuardModel(options: { reevaluation?: boolean; remove?: boolean } = {}): string {
    const change = options.remove
      ? `change RewireFlow {
          remove relation PollerCallsSettlement
        }`
      : `change RewireFlow {
          modify relation PollerCallsSettlement {
            kind calls
            connects BridgePoller -> Settlement
            summary "RewiredFlow"
          }
        }`;
    const reevaluation = options.reevaluation
      ? `reevaluation FlowRewireReviewed {
          satisfies memory PollerSettlementCoupling
          outcome Confirmed
          summary "The rewired flow preserves settlement timing."
          evidence test("bridge/flow.test.ts")
          reviewer BridgeTeam
          decided_on "2026-06-02"
        }`
      : "";
    return `
      module deps

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn poll
          effects complete {
            Read<Attestation>
          }
      }

      component Settlement {
        grants Read<Attestation>
        fn settle
          effects complete {
            Read<Attestation>
          }
      }

      relation PollerCallsSettlement {
        kind calls
        connects BridgePoller -> Settlement
        summary "BridgeFlow"
      }

      memory PollerSettlementCoupling : ${contextRef("RefactorConstraint", "relation PollerCallsSettlement")} {
        applies_to relation PollerCallsSettlement
        status Unexplained
        confidence High
        summary "The poller-settlement call edge is timing-sensitive."
        who { owner BridgeTeam }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      ${change}
      ${reevaluation}
    `;
  }

  test("fails when a guarded dependency edge is modified without reevaluation", () => {
    const result = checkShapeSource(relationGuardModel());
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("relation PollerCallsSettlement is protected by memory");
  });

  test("passes a guarded dependency edge change with a matching reevaluation", () => {
    const result = checkShapeSource(relationGuardModel({ reevaluation: true }));

    expect(result.exitCode).toBe(0);
  });

  test("fails when a guarded dependency edge is removed without reevaluation", () => {
    const result = checkShapeSource(relationGuardModel({ remove: true }));

    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("guarded shape changed");
  });

  test("does not guard an unprotected dependency edge change", () => {
    const result = checkShapeSource(`
      module deps

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn poll
          effects complete {
            Read<Attestation>
          }
      }

      component Settlement {
        grants Read<Attestation>
        fn settle
          effects complete {
            Read<Attestation>
          }
      }

      relation PollerCallsSettlement {
        kind calls
        connects BridgePoller -> Settlement
        summary "BridgeFlow"
      }

      change RewireFlow {
        modify relation PollerCallsSettlement {
          kind calls
          connects BridgePoller -> Settlement
          summary "RewiredFlow"
        }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("explains dependency-edge guards and satisfying context", () => {
    const explanation = explainShapeModules(
      [requireParsed(relationGuardModel())],
      "PollerCallsSettlement"
    );

    expect(explanation).toContain("kind: relation");
    expect(explanation).toContain("memory guards:");
    expect(explanation).toContain("memory deps::PollerSettlementCoupling");
  });
});
