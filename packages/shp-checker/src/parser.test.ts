import { describe, expect, test } from "bun:test";
import { parseShapeModule } from "./index.ts";
import { isRuleDecl, isRuleForbidPathDecl } from "./language/generated/ast.ts";
import { contextRef, fnTarget } from "./test-support.ts";

describe("Shape parser", () => {
  test("parses a minimal valid module", () => {
    const parsed = parseShapeModule(`
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

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.module.name).toBe("audit");
      expect(parsed.module.declarations).toHaveLength(2);
    }
  });

  test("parses explicit trait declarations", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      module audit

      trait AppendOnly<T: Resource> {
        allow Read<T>
        allow Append<T>
        forbid final HardDelete<T>
      }

      resource AuditEvent : AppendOnly
    `);

    expect(parsed.ok).toBe(true);
  });

  test("parses constrained forbidden path rules", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component PolicyService {
      }
      resource SecretStore

      rule no_gateway_to_secrets {
        forbid path Gateway -> SecretStore over calls or provides
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const rule = parsed.module.declarations.find(isRuleDecl);
    const forbid = rule?.members.find(isRuleForbidPathDecl);
    expect(forbid?.source).toBe("Gateway");
    expect(forbid?.target).toBe("SecretStore");
    expect(forbid?.kinds).toEqual(["calls", "provides"]);
  });

  test("requires an explicit kind filter for forbidden paths", () => {
    const parsed = parseShapeModule(`
      module deps
      component Gateway {}
      resource SecretStore
      rule no_gateway_to_secrets {
        forbid path Gateway -> SecretStore
      }
    `);

    expect(parsed.ok).toBe(false);
  });

  test("parses effect candidate declarations", () => {
    const parsed = parseShapeModule(`
      module shape.generated.ast.audit

      resource AuditEvent
      resource AuditStoreAppendEventAstAnchor {
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }

      component AuditStore {
        fn appendEvent
          effects unknown
      }

      effect candidate AppendEventCandidate {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
        source ts("src/audit/store.ts#AuditStore.appendEvent")
        confidence low
        pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);

    expect(parsed.ok).toBe(true);
  });

  test("parses memory guard declarations and function annotations", () => {
    const parsed = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription, PreserveInline
          source ts("src/gateway/authorize.ts#derivePolicyDecision")
          description required "Policy decision branches remain local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Policy checks remain inline for auditability."
        who { owner GatewayTeam }
      }

      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        protects { shape CheckOrder }
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
        observed issue("SEC-231")
        summary "Previous refactors broke error normalisation."
        who { owner GatewayTeam }
        when { review_by "2026-08-18" }
      }

      reevaluation DecisionShapeRechecked {
        satisfies memory DecisionRefactorConstraint
        outcome Confirmed
        summary "Refactor preserves error-normalisation behaviour."
        evidence test("gateway/error-normalisation.test.ts")
        reviewer GatewayTeam
        approver Security
        decided_on "2026-06-02"
      }

      change RefactorGatewayDecision {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          description required "Policy decision branches remain local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
  });

  test("reports parser errors", () => {
    const parsed = parseShapeModule("resource");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostics[0]?.message).toContain("Expecting");
    }
  });
});
