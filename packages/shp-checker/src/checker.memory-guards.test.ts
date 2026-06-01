import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  formatShapeSource,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  parseShapeModule
} from "./index.ts";
import { shapeReservedWords } from "./ast-generation-utils.ts";
import { PRELUDE_CONTEXT_RULES } from "./prelude.ts";
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

describe("Shape role and approver policy", () => {
  function policyModel(options: {
    policy?: boolean;
    sensitive?: boolean;
    roles?: boolean;
    reviewer?: string;
    approver?: string;
  }): string {
    const policy = options.policy ? "policy ReviewPolicy {\n  require approver\n}" : "";
    const roles = options.roles ? "role Security\n      role GatewayTeam" : "";
    const sensitive = options.sensitive ? "\n        sensitive" : "";
    const approver = options.approver ? `\n        approver ${options.approver}` : "";
    return `
      module gateway

      resource PolicySnapshot

      ${roles}

      ${policy}

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High${sensitive}
        summary "Security-sensitive decision path."
        who { owner GatewayTeam }
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed and confirmed."
        evidence test("gateway/decision.test.ts")
        reviewer ${options.reviewer ?? "GatewayTeam"}${approver}
        decided_on "2026-06-02"
      }
    `;
  }

  test("requires an approver for a sensitive memory under an approver policy", () => {
    const missing = checkShapeSource(policyModel({ policy: true, sensitive: true }));
    const output = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(output).toContain("missing approver required by policy");

    const satisfied = checkShapeSource(
      policyModel({ policy: true, sensitive: true, approver: "Security" })
    );
    expect(satisfied.exitCode).toBe(0);
  });

  test("merges a later require-approver policy with an earlier empty one", () => {
    // Regression for PR #66 review: a duplicate policy declaration must not let
    // an earlier empty policy hide a later `require approver` of the same name,
    // or sensitive memories would silently stop requiring approvers.
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      policy ReviewPolicy {
      }

      policy ReviewPolicy {
        require approver
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        sensitive
        summary "Security-sensitive decision path."
        who { owner GatewayTeam }
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed and confirmed."
        evidence test("gateway/decision.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("missing approver required by policy");
  });

  test("keeps approver optional without an approver policy", () => {
    const result = checkShapeSource(policyModel({ sensitive: true }));

    expect(result.exitCode).toBe(0);
  });

  test("keeps approver optional for non-sensitive memories under a policy", () => {
    const result = checkShapeSource(policyModel({ policy: true }));

    expect(result.exitCode).toBe(0);
  });

  test("rejects a reviewer that is not a declared role", () => {
    const result = checkShapeSource(policyModel({ roles: true, reviewer: "UnknownTeam" }));
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown reviewer role UnknownTeam");
  });

  test("rejects an approver that is not a declared role", () => {
    const result = checkShapeSource(policyModel({ roles: true, approver: "Outsiders" }));
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown approver role Outsiders");
  });

  test("accepts declared reviewer and approver roles", () => {
    const result = checkShapeSource(
      policyModel({ roles: true, reviewer: "GatewayTeam", approver: "Security" })
    );

    expect(result.exitCode).toBe(0);
  });

  test("does not validate roles when none are declared", () => {
    const result = checkShapeSource(policyModel({ reviewer: "AnyTeam", approver: "AnyApprover" }));

    expect(result.exitCode).toBe(0);
  });

  test("parses and formats role, policy, and sensitive declarations", () => {
    const result = formatShapeSource(`
      policy ReviewPolicy { require approver }
      role Security
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : RefactorSensitive effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} { sensitive summary 'Sensitive.' applies_to fn Gateway.derivePolicyDecision who { owner GatewayTeam } status Unexplained confidence High }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("role Security");
    expect(result.formatted).toContain("policy ReviewPolicy {\n  require approver\n}");
    expect(result.formatted).toContain("  confidence High\n  sensitive\n");

    const reformatted = formatShapeSource(result.formatted);
    expect(reformatted.ok).toBe(true);
    if (reformatted.ok) {
      expect(reformatted.formatted).toBe(result.formatted);
    }
    // Declaration order: resource (1) < role (7A) < policy (7B) < memory (9).
    const order = ["resource PolicySnapshot", "role Security", "policy ReviewPolicy", "memory"].map(
      (token) => result.formatted.indexOf(token)
    );
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  test("authorises a role declared in another module", () => {
    const roles = requireParsed(`
      module governance
      role Security
    `);
    const gateway = requireParsed(`
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Decision path."
        who { owner Security }
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed."
        evidence test("gateway/decision.test.ts")
        reviewer Security
        decided_on "2026-06-02"
      }
    `);

    expect(checkShapeModules([roles, gateway]).exitCode).toBe(0);
  });

  test("keeps approver optional under a policy that does not require an approver", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      policy AdvisoryPolicy {
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        sensitive
        summary "Sensitive."
        who { owner GatewayTeam }
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed."
        evidence test("gateway/decision.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("accepts duplicate role declarations idempotently", () => {
    const result = checkShapeSource(`
      module gateway
      role Security
      role Security
    `);

    expect(result.exitCode).toBe(0);
  });
});

describe("Shape user-defined context obligations", () => {
  test("a user trait require_context obligation behaves like a prelude one", () => {
    const base = `
      module gateway

      resource PolicySnapshot

      trait PreserveLocal<T: Fn> {
        require_context LocalRationale<T> satisfied_by rationale
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : PreserveLocal
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
    const missing = checkShapeSource(base);
    const missingOutput = formatDiagnostics(missing);
    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain("missing required context");
    expect(missingOutput).toContain(
      contextRef("LocalRationale", fnTarget("Gateway.derivePolicyDecision"))
    );
    expect(missingOutput).toContain("trait PreserveLocal require_context");

    const satisfied = checkShapeSource(`${base}
      rationale LocalReason : ${contextRef("LocalRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Kept local."
        who { owner GatewayTeam }
      }
    `);
    expect(satisfied.exitCode).toBe(0);
  });

  test("satisfied_by restricts which context kind satisfies the obligation", () => {
    const base = `
      module bridge

      resource Attestation

      trait DelaySensitive<T: Fn> {
        require_context DelayConstraint<T> satisfied_by memory
      }

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn pollAttestation : DelaySensitive
          effects complete {
            Read<Attestation>
          }
      }
    `;
    const withRationale = checkShapeSource(`${base}
      rationale PollDelay : ${contextRef("DelayConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        why ExternalProtocolConstraint
        summary "A rationale must not satisfy a memory-only obligation."
        who { owner BridgeTeam }
      }
    `);
    expect(withRationale.exitCode).toBe(1);

    const withMemory = checkShapeSource(`${base}
      memory PollDelay : ${contextRef("DelayConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Lowering the delay caused settlement failures."
        who { owner BridgeTeam }
      }
    `);
    expect(withMemory.exitCode).toBe(0);
  });

  test("derives the target kind from the trait type parameter bound", () => {
    const missing = checkShapeSource(`
      module audit

      trait ComponentBoundary<T: Component> {
        require_context BoundaryReason<T>
      }

      resource AuditEvent

      component AuditStore : ComponentBoundary {
        owns AuditEvent
        grants Read<AuditEvent>
        fn read
          effects complete {
            Read<AuditEvent>
          }
      }
    `);
    const output = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(output).toContain("component AuditStore has shape ComponentBoundary");
    expect(output).toContain(contextRef("BoundaryReason", "component AuditStore"));
  });

  test("keeps the hardcoded prelude obligations working alongside user traits", () => {
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
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain(
      contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))
    );
  });

  test("parses and formats require_context trait members", () => {
    const result = formatShapeSource(`
      trait PreserveLocal<T: Fn> { require_context LocalRationale<T> satisfied_by rationale or memory }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.formatted).toContain(
      "require_context LocalRationale<T> satisfied_by rationale or memory"
    );
  });

  test("accepts either kind when satisfied_by is omitted", () => {
    const base = (context: string) => `
      module gateway

      resource PolicySnapshot

      trait FlexibleLocal<T: Fn> {
        require_context LocalReason<T>
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : FlexibleLocal
          effects complete {
            Read<PolicySnapshot>
          }
      }

      ${context}
    `;
    const withRationale = checkShapeSource(
      base(`rationale R : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Reason."
        who { owner GatewayTeam }
      }`)
    );
    const withMemory = checkShapeSource(
      base(`memory M : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Reason."
        who { owner GatewayTeam }
      }`)
    );

    expect(withRationale.exitCode).toBe(0);
    expect(withMemory.exitCode).toBe(0);
  });

  test("satisfies a component-target user obligation with a memory", () => {
    const result = checkShapeSource(`
      module audit

      trait ComponentBoundary<T: Component> {
        require_context BoundaryReason<T> satisfied_by memory
      }

      resource AuditEvent

      component AuditStore : ComponentBoundary {
        owns AuditEvent
        grants Read<AuditEvent>
        fn read
          effects complete {
            Read<AuditEvent>
          }
      }

      memory AuditStoreBoundary : ${contextRef("BoundaryReason", "component AuditStore")} {
        applies_to component AuditStore
        status Unexplained
        confidence High
        summary "Boundary is load-bearing."
        who { owner AuditTeam }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("defaults an unbound type parameter to a function target", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      trait Unbound<T> {
        require_context UnboundReason<T>
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : Unbound
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain(contextRef("UnboundReason", fnTarget("Gateway.derivePolicyDecision")));
  });

  test("reports require_context with an undeclared type parameter or unsupported bound", () => {
    const result = checkShapeSource(`
      module m

      trait BadTarget<T: Component> {
        require_context Reason<X>
      }

      trait BadBound<T: Fnn> {
        require_context Reason<T>
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid require_context");
    expect(output).toContain("type parameter X is not declared by the trait");
    expect(output).toContain("unsupported bound Fnn");
  });

  test("a user trait shadows a same-named prelude obligation via name resolution", () => {
    // Declaring a trait named like a prelude trait (RefactorSensitive) makes
    // `: RefactorSensitive` resolve to the local trait, so the user obligation
    // replaces the prelude one rather than stacking with it.
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      trait RefactorSensitive<T: Fn> {
        require_context LocalReason<T> satisfied_by rationale
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale R : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Reason."
        who { owner GatewayTeam }
      }
    `);

    // The prelude RefactorSensitive requires a memory; the local trait requires
    // a rationale. A rationale satisfying the local obligation passes, proving
    // the local trait shadowed the prelude one.
    expect(result.exitCode).toBe(0);
  });
});

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

describe("Shape transform guards", () => {
  function transformGuardModel(forbidden: string, applied: string): string {
    return `
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
        guards { forbid transform ${forbidden} }
      }

      change ApplyTransform {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          transform ${applied}
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
  }

  test("fails when a forbidden transform is applied without reevaluation", () => {
    const result = checkShapeSource(transformGuardModel("ExtractHelper", "ExtractHelper"));
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("applies the ExtractHelper transform to the guarded target");
  });

  test("does not fire when an applied transform is not forbidden", () => {
    const result = checkShapeSource(transformGuardModel("ExtractHelper", "RenameSymbol"));

    expect(result.exitCode).toBe(0);
  });

  test("passes a forbidden transform with a matching reevaluation", () => {
    const result = checkShapeSource(`
      ${transformGuardModel("ExtractHelper", "ExtractHelper")}
      reevaluation ExtractHelperReviewed {
        satisfies rationale DerivePolicyInline
        outcome Replaced
        summary "Helper extraction keeps the audited branch structure intact."
        evidence test("gateway/extract-helper.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("matches a forbidden transform among several applied labels", () => {
    const result = checkShapeSource(
      transformGuardModel("SplitDecisionTree", "RenameSymbol, SplitDecisionTree")
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("applies the SplitDecisionTree transform to the guarded target");
  });

  test("parses and formats transform intent and forbid-transform guards", () => {
    const result = formatShapeSource(`
      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} { guards { forbid transform ExtractHelper } summary 'Inline.' who { owner GatewayTeam } why CognitiveLocality applies_to fn Gateway.derivePolicyDecision }
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : PreserveInline effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
      change ApplyTransform { modify fn Gateway.derivePolicyDecision : PreserveInline transform ExtractHelper, RemoveDescription effects complete { Read<PolicySnapshot> } }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("guards {");
    expect(result.formatted).toContain("forbid transform ExtractHelper");
    expect(result.formatted).toContain("    transform ExtractHelper, RemoveDescription");
  });

  test("enforces forbid-transform guards declared on a memory", () => {
    const guarded = `
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Splitting the decision tree changed visible failures before."
        who { owner GatewayTeam }
        guards { forbid transform SplitDecisionTree }
      }

      change SplitIt {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          transform SplitDecisionTree
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
    const withoutReevaluation = checkShapeSource(guarded);
    expect(withoutReevaluation.exitCode).toBe(1);
    expect(formatDiagnostics(withoutReevaluation)).toContain(
      "applies the SplitDecisionTree transform to the guarded target"
    );

    const withReevaluation = checkShapeSource(`${guarded}
      reevaluation DecisionSplitReviewed {
        satisfies memory DecisionConstraint
        outcome Replaced
        summary "The split preserves visible failure ordering."
        evidence test("gateway/split.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);
    expect(withReevaluation.exitCode).toBe(0);
  });

  test("treats transform intent on an unguarded function as inert", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }

      change ExtractIt {
        modify fn Gateway.derivePolicyDecision
          transform ExtractHelper
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("matches multiple forbidden transforms independently", () => {
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
        guards { forbid transform ExtractHelper }
        guards { forbid transform SplitDecisionTree }
      }

      change RefactorBoth {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          transform ExtractHelper, SplitDecisionTree
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("applies the ExtractHelper transform");
    expect(output).toContain("applies the SplitDecisionTree transform");
  });

  test("reports a single diagnostic when on_change and forbid-transform both fire", () => {
    const result = checkShapeSource(`
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Extracting a helper has historically changed behaviour."
        who { owner GatewayTeam }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
        guards { forbid transform ExtractHelper }
      }

      change ExtractIt {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          transform ExtractHelper
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const guardedChanges = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "guarded_shape_changed"
    );

    expect(guardedChanges).toHaveLength(1);
    expect(formatDiagnostics(result)).toContain(
      "applies the ExtractHelper transform to the guarded target"
    );
  });

  test("keeps the coarse guard when a non-matching transform is applied alongside on_change", () => {
    const result = checkShapeSource(`
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Extracting a helper has historically changed behaviour."
        who { owner GatewayTeam }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
        guards { forbid transform ExtractHelper }
      }

      change RenameIt {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          transform RenameSymbol
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const guardedChanges = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "guarded_shape_changed"
    );

    expect(guardedChanges).toHaveLength(1);
    expect(formatDiagnostics(result)).toContain("modifies the guarded target");
  });

  test("a user trait shadows the built-in obligation of the same name", () => {
    // Documented behaviour: a trait declared with the same name as a built-in
    // shape trait replaces the built-in obligation. A root-module RefactorSensitive
    // resolves to the same key as the prelude rule, so the user obligation must
    // win and the built-in RefactorConstraint must not be required.
    const base = `
      resource PolicySnapshot

      trait RefactorSensitive<T: Fn> {
        require_context LocalReason<T> satisfied_by rationale
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
    const missing = checkShapeSource(base);
    const missingOutput = formatDiagnostics(missing);
    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))
    );
    // The shadowed built-in RefactorConstraint obligation is gone.
    expect(missingOutput).not.toContain("RefactorConstraint");

    const satisfied = checkShapeSource(`${base}
      rationale LocalReasonGiven : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Kept local on purpose."
        who { owner GatewayTeam }
      }
    `);
    expect(satisfied.exitCode).toBe(0);
  });

  test("modifying a trait to drop require_context relaxes the obligation", () => {
    // The user obligation rule is appended to a flat list at lowering time;
    // modifying the trait to an empty body must drop the stale rule so the
    // obligation no longer fires.
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      trait NeedsReason<T: Fn> {
        require_context Reason<T> satisfied_by rationale
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : NeedsReason
          effects complete {
            Read<PolicySnapshot>
          }
      }

      change RelaxObligation {
        modify trait NeedsReason<T: Fn> {
        }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("explain lists a transform-only guard that has no reevaluation clause", () => {
    // Regression: a context whose only guard action is `forbid transform` is
    // enforced by `check` but was previously dropped from `shp explain`'s
    // memory-guards section, which filtered on reevaluation guards alone.
    const explanation = explainShapeModules(
      [requireParsed(transformGuardModel("ExtractHelper", "RenameSymbol"))],
      "Gateway.derivePolicyDecision"
    );

    expect(explanation).toContain("memory guards:");
    expect(explanation).toContain("rationale gateway::DerivePolicyInline");
  });
});

describe("Shape component and resource shape traits", () => {
  // The component/resource obligation matrix is driven from the prelude rule
  // table, so it protects the data model instead of duplicating it by hand.
  // Genuinely special cases (satisfied_by enforcement, semantic traits, derived
  // facts) stay as bespoke tests below.
  function obligationModule(
    targetKind: "component" | "resource",
    trait: string,
    context?: { contextType: string; satisfiedBy: "memory" | "rationale" }
  ): string {
    const targetRef = `${targetKind} Subject`;
    const subject =
      targetKind === "component"
        ? `resource Backing\ncomponent Subject : ${trait} { owns Backing grants Read<Backing> fn act effects complete { Read<Backing> } }`
        : `resource Subject : ${trait}\ncomponent Holder { owns Subject grants Read<Subject> fn act effects complete { Read<Subject> } }`;
    const ref = contextRef(context?.contextType ?? "", targetRef);
    const satisfier = !context
      ? ""
      : context.satisfiedBy === "memory"
        ? `\nmemory SubjectContext : ${ref} { applies_to ${targetRef} status Unexplained confidence High summary "Documented obligation." who { owner ProbeTeam } }`
        : `\nrationale SubjectContext : ${ref} { applies_to ${targetRef} why DesignChoice summary "Documented obligation." who { owner ProbeTeam } }`;
    return `module probe\n${subject}${satisfier}\n`;
  }

  const obligationCases = PRELUDE_CONTEXT_RULES.flatMap((rule) =>
    rule.targetKinds
      .filter((targetKind): targetKind is "component" | "resource" => targetKind !== "fn")
      .map((targetKind) => ({ rule, targetKind }))
  );

  for (const { rule, targetKind } of obligationCases) {
    test(`requires ${rule.contextType} context for a ${rule.trait} ${targetKind}`, () => {
      const missing = checkShapeSource(obligationModule(targetKind, rule.trait));
      const missingOutput = formatDiagnostics(missing);
      expect(missing.exitCode).toBe(1);
      expect(missingOutput).toContain(`${targetKind} Subject has shape ${rule.trait}`);
      expect(missingOutput).toContain(contextRef(rule.contextType, `${targetKind} Subject`));

      const satisfiedBy = rule.satisfiedBy.includes("rationale") ? "rationale" : "memory";
      const satisfied = checkShapeSource(
        obligationModule(targetKind, rule.trait, { contextType: rule.contextType, satisfiedBy })
      );
      expect(satisfied.exitCode).toBe(0);
    });
  }

  test("does not let a rationale satisfy a memory-only RefactorSensitive obligation", () => {
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

      rationale GatewayShape : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        why LegacyCompatibility
        summary "A rationale must not satisfy a RefactorConstraint obligation."
        who { owner GatewayTeam }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("component Gateway has shape RefactorSensitive");
  });

  test("keeps semantic resource traits free of shape-trait obligations", () => {
    const parsed = requireParsed(`
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
    `);
    const result = checkShapeModules([parsed], { includeFacts: true });

    expect(result.exitCode).toBe(0);
    expect(
      result.facts?.some(
        (fact) => fact.kind === "context_required" && fact.target.endsWith("AuditEvent")
      )
    ).toBe(false);
  });

  test("emits context_required facts for component and resource targets", () => {
    const parsed = requireParsed(`
      module gateway

      resource PolicySnapshot : RefactorSensitive

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const result = checkShapeModules([parsed], { includeFacts: true });

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "context_required",
        targetKind: "component",
        target: "gateway::Gateway",
        contextType: "RefactorConstraint",
        requiredBy: "RefactorSensitive"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "context_required",
        targetKind: "resource",
        target: "gateway::PolicySnapshot",
        contextType: "RefactorConstraint",
        requiredBy: "RefactorSensitive"
      })
    );
  });

  test("explains component classifiers and required context", () => {
    const explanation = explainShapeModules(
      [
        requireParsed(`
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

          memory GatewayShapeConstraint : ${contextRef("RefactorConstraint", "component Gateway")} {
            applies_to component Gateway
            status Unexplained
            confidence High
            summary "The Gateway boundary isolates policy evaluation from transport."
            who { owner GatewayTeam }
          }
        `)
      ],
      "Gateway"
    );

    expect(explanation).toContain("classifiers:");
    expect(explanation).toContain("RefactorSensitive");
    expect(explanation).toContain("required context:");
    expect(explanation).toContain(contextRef("RefactorConstraint", "component Gateway"));
    expect(explanation).toContain("satisfied by:");
    expect(explanation).toContain("memory gateway::GatewayShapeConstraint");
  });

  test("explains resource traits and required context", () => {
    const explanation = explainShapeModules(
      [
        requireParsed(`
          module audit

          resource AuditEvent : RefactorSensitive

          component AuditStore {
            owns AuditEvent
            grants Read<AuditEvent>
            fn read
              effects complete {
                Read<AuditEvent>
              }
          }

          memory AuditEventLayout : ${contextRef("RefactorConstraint", "resource AuditEvent")} {
            applies_to resource AuditEvent
            status Explained
            confidence High
            summary "External auditors depend on the AuditEvent field layout."
            who { owner AuditTeam }
          }
        `)
      ],
      "AuditEvent"
    );

    expect(explanation).toContain("required context:");
    expect(explanation).toContain(contextRef("RefactorConstraint", "resource AuditEvent"));
    expect(explanation).toContain("satisfied by:");
    expect(explanation).toContain("memory audit::AuditEventLayout");
  });
});

describe("Shape memory freshness checking", () => {
  function refactorMemorySource(reviewBy?: string): string {
    const reviewByLine = reviewBy === undefined ? "" : `\n        when { review_by "${reviewBy}" }`;
    return `
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
        summary "Earlier attempts to lower this delay caused settlement failures."
        who { owner BridgeTeam }${reviewByLine}
      }
    `;
  }

  // Thin wrapper over the shared checkShapeSource helper so the parse/error flow
  // lives in one place; this only threads the freshness option through.
  function checkWithFreshness(source: string, freshnessDate?: string) {
    return checkShapeSource(source, { freshnessDate });
  }

  test("flags design memory whose review_by is before the freshness date", () => {
    const result = checkWithFreshness(refactorMemorySource("2026-01-01"), "2026-05-30");
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale design memory");
    expect(output).toContain("memory BridgePollingDelayConstraint");
    expect(output).toContain("review_by date 2026-01-01 is before 2026-05-30");
  });

  test("keeps memory fresh on the review_by date itself", () => {
    const result = checkWithFreshness(refactorMemorySource("2026-05-30"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("treats future review_by dates as fresh", () => {
    const result = checkWithFreshness(refactorMemorySource("2027-01-01"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("ignores memory without a review_by date", () => {
    const result = checkWithFreshness(refactorMemorySource(), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("does not enforce non-ISO review_by values", () => {
    const result = checkWithFreshness(refactorMemorySource("soon"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("does not enforce calendar-invalid ISO-shaped review_by values", () => {
    // These match the YYYY-MM-DD regex but are not real dates; the calendar
    // round-trip in isIsoDate must reject them rather than letting Date roll
    // them forward (2026-02-30 -> 2026-03-02) and suppress a real diagnostic.
    for (const invalid of ["2026-02-30", "2026-13-40"]) {
      const result = checkWithFreshness(refactorMemorySource(invalid), "2026-05-30");
      expect(result.exitCode).toBe(0);
    }
  });

  test("never reports staleness when freshness checking is disabled", () => {
    const result = checkWithFreshness(refactorMemorySource("2020-01-01"));

    expect(result.exitCode).toBe(0);
  });

  test("flags stale rationale review_by dates as well", () => {
    const result = checkWithFreshness(
      `
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
          when { review_by "2025-01-01" }
        }
      `,
      "2026-05-30"
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale design memory");
    expect(output).toContain("rationale DerivePolicyDecisionInline");
  });

  test("surfaces stale design memory through obligations in strict freshness mode", () => {
    const parsed = parseShapeModule(refactorMemorySource("2026-01-01"));
    if (!parsed.ok) {
      throw new Error("expected module to parse");
    }

    const withFreshness = listShapeObligations([parsed.module], { freshnessDate: "2026-05-30" });
    expect(withFreshness).toContain("stale design memory:");
    expect(withFreshness).toContain(
      "memory BridgePollingDelayConstraint review_by 2026-01-01 is before 2026-05-30"
    );

    const withoutFreshness = listShapeObligations([parsed.module]);
    expect(withoutFreshness).not.toContain("stale design memory");
  });
});
