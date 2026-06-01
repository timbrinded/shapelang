import { describe, expect, test } from "bun:test";
import { checkShapeModules, formatDiagnostics, formatShapeSource } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget, requireParsed } from "./test-support.ts";

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
