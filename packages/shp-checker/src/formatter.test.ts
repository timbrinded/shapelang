import { describe, expect, test } from "bun:test";
import { formatShapeSource } from "./index.ts";
import { contextRef, fnTarget } from "./test-support.ts";

describe("Shape formatter", () => {
  test("canonicalizes relation declarations", () => {
    const result = formatShapeSource(`
      module deps
      relation AuditWritePath { summary 'Audit write path.' connects Gateway -> AuditStore -> AuditEvent kind coordinated_call }
      relation GatewayProvidesRpc { connects Gateway -> JsonRpcEndpoint kind provides }
      component Gateway { }
      component AuditStore { }
      resource AuditEvent
      resource JsonRpcEndpoint
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`module deps

resource AuditEvent

resource JsonRpcEndpoint

component AuditStore {
}

component Gateway {
}

relation AuditWritePath {
  kind coordinated_call
  connects Gateway -> AuditStore -> AuditEvent
  summary "Audit write path."
}

relation GatewayProvidesRpc {
  kind provides
  connects Gateway -> JsonRpcEndpoint
}
`);
  });

  test("canonicalizes declaration and member formatting", () => {
    const result = formatShapeSource(`
      module audit
      import zeta
      import alpha
      component AuditStore { grants Append<AuditEvent> owns AuditEvent fn appendEvent effects complete { Append<AuditEvent> evidence ts('src/audit/store.ts#appendEvent') } }
      resource AuditEvent : AppendOnly
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`module audit

import alpha

import zeta

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
}
`);
  });

  test("formats memory guard syntax canonically", () => {
    const result = formatShapeSource(`
      reevaluation DecisionShapeRechecked { evidence test('gateway/error-normalisation.test.ts') decided_on '2026-06-02' reviewer GatewayTeam summary 'Refactor preserves behaviour.' outcome Confirmed satisfies memory DecisionRefactorConstraint }
      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} { summary 'Previous refactors broke error normalisation.' guards { on_change require ${contextRef("ReEvaluation", "Self")} } confidence High status Unexplained applies_to fn Gateway.derivePolicyDecision who { owner GatewayTeam } protects { shape CheckOrder } }
      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} { summary 'Policy checks remain inline for auditability.' who { owner GatewayTeam } why CognitiveLocality applies_to fn Gateway.derivePolicyDecision }
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : RequiresDescription, PreserveInline description required 'Policy decision branches remain local for auditability.' effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : PreserveInline, RequiresDescription
    description required "Policy decision branches remain local for auditability."
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  who {
    owner GatewayTeam
  }
}

memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  who {
    owner GatewayTeam
  }
  protects {
    shape CheckOrder
  }
  guards {
    on_change require ${contextRef("ReEvaluation", "Self")}
  }
}

reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves behaviour."
  reviewer GatewayTeam
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
`);
  });

  test("formats a valueless protects description clause", () => {
    const result = formatShapeSource(`
      memory DescriptionGuard : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} { protects { description } summary 'Local description is required context.' applies_to fn Gateway.derivePolicyDecision who { owner GatewayTeam } status Explained confidence High }
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : RefactorSensitive effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // The valueless description canonicalizes into the protects block as a bare
    // `description` entry (no trailing value).
    expect(result.formatted).toContain("protects {\n    description\n  }");
  });

  test("formats effect candidate syntax canonically", () => {
    const result = formatShapeSource(`
      module shape.generated.ast.audit
      resource AuditEvent
      resource AuditStoreAppendEventAstAnchor { fingerprint ast.semantic_subtree_v1('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
      component AuditStore { fn appendEvent effects unknown }
      effect candidate AppendEventCandidate { confidence low source ts('src/audit/store.ts#AuditStore.appendEvent') effect Append<AuditEvent> fn AuditStore.appendEvent pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("effect candidate AppendEventCandidate");
    expect(result.formatted).toContain("  fn AuditStore.appendEvent");
    expect(result.formatted).toContain("  effect Append<AuditEvent>");
    expect(result.formatted).toContain("  confidence low");
    expect(result.formatted).toContain(
      '  pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")'
    );
  });
});
