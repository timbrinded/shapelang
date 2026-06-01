import { describe, expect, test } from "bun:test";
import { explainShapeModules, formatDiagnostics, listMemoryGuardsShapeModules } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget, requireParsed } from "./test-support.ts";

describe("Shape memory guard intent scenarios", () => {
  test("requires rationale when inline policy shape is review intent", () => {
    const missingRationale = checkShapeSource(`
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
    `);
    const missingOutput = formatDiagnostics(missingRationale);

    expect(missingRationale.exitCode).toBe(1);
    expect(missingOutput).toContain("missing required context");
    expect(missingOutput).toContain(
      contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))
    );

    const withRationale = checkShapeSource(`
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

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers inspect the full authorization branch locally."
        who { owner GatewayTeam }
      }
    `);

    expect(withRationale.exitCode).toBe(0);
  });

  test("protects check order when effects are unchanged by reordering", () => {
    const guardedWithoutReevaluation = checkShapeSource(`
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

      rationale PolicyCheckOrderMatters : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "The order controls which failure is visible to callers."
        who { owner GatewayTeam }
        protects { shape CheckOrder }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      change ReorderPolicyChecks {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const guardedOutput = formatDiagnostics(guardedWithoutReevaluation);

    expect(guardedWithoutReevaluation.exitCode).toBe(1);
    expect(guardedOutput).toContain("guarded shape changed");
    expect(guardedOutput).toContain("rationale PolicyCheckOrderMatters");

    const guardedWithReevaluation = checkShapeSource(`
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

      rationale PolicyCheckOrderMatters : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "The order controls which failure is visible to callers."
        who { owner GatewayTeam }
        protects { shape CheckOrder }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      reevaluation PolicyCheckOrderRechecked {
        satisfies rationale PolicyCheckOrderMatters
        outcome Confirmed
        summary "The modified implementation preserves visible failure ordering."
        evidence test("gateway/policy-check-order.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }

      change ReorderPolicyChecks {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(guardedWithReevaluation.exitCode).toBe(0);
  });

  test("requires memory for refactor-sensitive implementation shape", () => {
    const missingMemory = checkShapeSource(`
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
    `);
    const missingOutput = formatDiagnostics(missingMemory);

    expect(missingMemory.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))
    );

    const withMemory = checkShapeSource(`
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

      memory BridgePollingDelayConstraint : ${contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Shorter polling previously caused intermittent settlement misses."
        who { owner BridgeTeam }
      }
    `);

    expect(withMemory.exitCode).toBe(0);
  });

  test("requires design memory for intentional non-idiomatic code", () => {
    const missingRationale = checkShapeSource(`
      module gateway

      resource VendorPayload

      component Gateway {
        owns VendorPayload
        grants Read<VendorPayload>

        fn normalizeVendorPayload : NonIdiomatic
          effects complete {
            Read<VendorPayload>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missingRationale);

    expect(missingRationale.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("DesignRationale", fnTarget("Gateway.normalizeVendorPayload"))
    );

    const withRationale = checkShapeSource(`
      module gateway

      resource VendorPayload

      component Gateway {
        owns VendorPayload
        grants Read<VendorPayload>

        fn normalizeVendorPayload : NonIdiomatic
          effects complete {
            Read<VendorPayload>
          }
      }

      rationale VendorPayloadCompatibility : ${contextRef("DesignRationale", fnTarget("Gateway.normalizeVendorPayload"))} {
        applies_to fn Gateway.normalizeVendorPayload
        why VendorLimitation
        summary "The odd field order mirrors the upstream protocol contract."
        who { owner GatewayTeam }
      }
    `);

    expect(withRationale.exitCode).toBe(0);
  });

  test("requires purpose context for test-only production-shaped helpers", () => {
    const missingPurpose = checkShapeSource(`
      module audit

      resource AuditEvent

      component ReplayHarness {
        owns AuditEvent
        grants Append<AuditEvent>

        fn seedReplayFixture : TestOnly
          effects complete {
            Append<AuditEvent>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missingPurpose);

    expect(missingPurpose.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("TestOnlyPurpose", fnTarget("ReplayHarness.seedReplayFixture"))
    );

    const withPurpose = checkShapeSource(`
      module audit

      resource AuditEvent

      component ReplayHarness {
        owns AuditEvent
        grants Append<AuditEvent>

        fn seedReplayFixture : TestOnly
          effects complete {
            Append<AuditEvent>
          }
      }

      rationale ReplayFixturePurpose : ${contextRef("TestOnlyPurpose", fnTarget("ReplayHarness.seedReplayFixture"))} {
        applies_to fn ReplayHarness.seedReplayFixture
        why E2ETesting
        summary "This helper only builds replay fixtures for e2e tests."
        who { owner AuditTeam }
      }
    `);

    expect(withPurpose.exitCode).toBe(0);
  });

  test("requires a non-empty description when shape depends on local explanation", () => {
    const emptyDescription = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription
          description required ""
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyDecisionDescription : ${contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers need the local policy decision purpose."
        who { owner GatewayTeam }
      }
    `);
    const emptyOutput = formatDiagnostics(emptyDescription);

    expect(emptyDescription.exitCode).toBe(1);
    expect(emptyOutput).toContain("missing required description");

    const withDescription = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription
          description required "Builds the visible authorization decision from policy state."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyDecisionDescription : ${contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers need the local policy decision purpose."
        who { owner GatewayTeam }
      }
    `);

    expect(withDescription.exitCode).toBe(0);
  });

  test("does not let invalid reevaluation unlock guarded changes", () => {
    const invalidReevaluation = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Previous refactors broke error normalisation."
        who { owner GatewayTeam }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
      }

      reevaluation IncompleteReview {
        satisfies memory DecisionRefactorConstraint
        outcome Confirmed
        summary "The refactor looks equivalent."
      }

      change RefactorDecision {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(invalidReevaluation);

    expect(invalidReevaluation.exitCode).toBe(1);
    expect(output).toContain("invalid reevaluation");
    expect(output).toContain("missing evidence");
    expect(output).toContain("missing reviewer");
    expect(output).toContain("missing decided_on");
    expect(output).toContain("guarded shape changed");
  });

  test("does not allow memory to waive final forbidden effects", () => {
    const result = checkShapeSource(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents : RefactorSensitive
          effects complete {
            HardDelete<AuditEvent>
          }
      }

      memory PurgeDeleteConstraint : ${contextRef("RefactorConstraint", fnTarget("AuditStore.purgeOldEvents"))} {
        applies_to fn AuditStore.purgeOldEvents
        status Explained
        confidence High
        summary "This behavior is documented but still violates final storage policy."
        who { owner AuditTeam }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden effect");
    expect(output).toContain("AppendOnly forbids final HardDelete<AuditEvent>");
  });
});

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
