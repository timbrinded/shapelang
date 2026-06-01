import { describe, expect, test } from "bun:test";
import { formatDiagnostics } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget } from "./test-support.ts";

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
