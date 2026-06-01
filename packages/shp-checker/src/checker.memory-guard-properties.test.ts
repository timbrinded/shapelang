import { describe, expect, test } from "bun:test";
import { formatDiagnostics, listMemoryGuardsShapeModules } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget, requireParsed } from "./test-support.ts";

describe("Shape property-level guarded changes", () => {
  function inlineGuardModel(modifyTraits: string, modifyDescription: string): string {
    return `
      module gateway

      resource PolicySnapshot
      resource DecisionLog

      component Gateway {
        owns PolicySnapshot
        owns DecisionLog
        grants Read<PolicySnapshot>
        grants Append<DecisionLog>
        fn derivePolicyDecision : PreserveInline
          description required "Policy branches stay local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        who { owner GatewayTeam }
        protects { shape PreserveInline }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change RefactorDecision {
        modify fn Gateway.derivePolicyDecision${modifyTraits}${modifyDescription}
          effects complete {
            Read<PolicySnapshot>
            Append<DecisionLog>
          }
      }
    `;
  }

  test("passes when a precise guard's protected trait is preserved", () => {
    const result = checkShapeSource(
      inlineGuardModel(
        " : PreserveInline",
        '\n          description required "Policy branches stay local for auditability."'
      )
    );

    expect(result.exitCode).toBe(0);
  });

  test("fails when a guarded shape trait is removed", () => {
    const result = checkShapeSource(
      inlineGuardModel(
        "",
        '\n          description required "Policy branches stay local for auditability."'
      )
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("removes shape trait PreserveInline from the guarded target");
  });

  test("fails when a guarded description is removed", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          description required "Decision rationale lives next to the code."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionDescriptionGuard : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Explained
        confidence High
        summary "The local description is required context for reviewers."
        who { owner GatewayTeam }
        protects { description }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change DropDescription {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("removes description from the guarded target");
  });

  test("passes a precise guarded property removal with a matching reevaluation", () => {
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

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        who { owner GatewayTeam }
        protects { shape PreserveInline }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      reevaluation InlineExtracted {
        satisfies rationale DerivePolicyInline
        outcome Replaced
        summary "Helper extraction keeps the audited branch structure."
        evidence test("gateway/inline.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }

      change ExtractHelper {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("keeps coarse guard behavior when no protected property is detectable", () => {
    const result = checkShapeSource(`
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

      rationale CheckOrderMatters : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Check order controls the visible failure."
        who { owner GatewayTeam }
        protects { shape CheckOrder }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change ReorderChecks {
        modify fn Gateway.derivePolicyDecision : ProtectedCheckOrder
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("modifies the guarded target");
  });

  test("enforces guards on a modified component target", () => {
    const guarded = `
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayBoundary : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation."
        who { owner GatewayTeam }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change WidenGateway {
        modify component Gateway : RefactorSensitive {
          owns PolicySnapshot
          grants Read<PolicySnapshot>
          grants Append<PolicySnapshot>
          fn read
            effects complete {
              Read<PolicySnapshot>
            }
        }
      }
    `;
    const withoutReevaluation = checkShapeSource(guarded);
    const output = formatDiagnostics(withoutReevaluation);

    expect(withoutReevaluation.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("component Gateway is protected by memory");

    const withReevaluation = checkShapeSource(`${guarded}
      reevaluation GatewayBoundaryRechecked {
        satisfies memory GatewayBoundary
        outcome Confirmed
        summary "Widening the grant preserves the isolation boundary."
        evidence test("gateway/boundary.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);

    expect(withReevaluation.exitCode).toBe(0);
  });

  test("fires a precise guard when the protected trait is removed by remove fn", () => {
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

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        who { owner GatewayTeam }
        protects { shape PreserveInline }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change RemoveDecision {
        remove fn Gateway.derivePolicyDecision
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("removes shape trait PreserveInline from the guarded target");
  });

  test("fires a precise guard for a removed user-defined protected trait", () => {
    // Regression for PR #66 review: the protected `shape` value is raw, but the
    // removed-trait event stores the resolved (module-qualified) name, and a
    // user-defined trait is not in the built-in shape-trait set. Both must be
    // resolved/recognised so the guard matches precisely rather than coarsely.
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      trait LocallyScoped<T: Component> {
        require_context ScopeReason<T> satisfied_by memory
      }

      component Gateway : LocallyScoped {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayScope : ${contextRef("ScopeReason", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "Gateway is deliberately locally scoped."
        who { owner GatewayTeam }
        protects { shape LocallyScoped }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change DropScope {
        modify component Gateway {
          owns PolicySnapshot
          grants Read<PolicySnapshot>
          fn read
            effects complete {
              Read<PolicySnapshot>
            }
        }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("removes shape trait LocallyScoped from the guarded target");
  });

  test("enforces coarse guards on a removed component", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayBoundary : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation."
        who { owner GatewayTeam }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change DropGateway {
        remove component Gateway
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("component Gateway is protected by memory");
    expect(output).toContain("modifies the guarded target");
  });

  test("falls back to coarse when protects clauses mix detectable and free-form", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot
      resource DecisionLog

      component Gateway {
        owns PolicySnapshot
        owns DecisionLog
        grants Read<PolicySnapshot>
        grants Append<DecisionLog>
        fn derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        who { owner GatewayTeam }
        protects { shape PreserveInline }
        protects { shape CheckOrder }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change WidenEffects {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
            Append<DecisionLog>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("modifies the guarded target");
    expect(output).not.toContain("removes shape trait");
  });

  test("lists a valueless protects description without a trailing space", () => {
    const listing = listMemoryGuardsShapeModules([
      requireParsed(`
        module gateway

        resource PolicySnapshot

        component Gateway {
          owns PolicySnapshot
          grants Read<PolicySnapshot>
          fn derivePolicyDecision : RefactorSensitive
            description required "Decision rationale lives next to the code."
            effects complete {
              Read<PolicySnapshot>
            }
        }

        memory DecisionDescriptionGuard : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
          applies_to fn Gateway.derivePolicyDecision
          status Explained
          confidence High
          summary "The local description is required context for reviewers."
          who { owner GatewayTeam }
          protects { description }
        }
      `)
    ]);

    expect(listing).toContain("protects: description");
    expect(listing.split("\n").some((line) => line.endsWith(" "))).toBe(false);
  });

  test("treats a description-protect on a component as coarse, not silently inert", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayBoundary : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation."
        who { owner GatewayTeam }
        protects { description }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change DropGateway {
        remove component Gateway
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("modifies the guarded target");
  });
});
