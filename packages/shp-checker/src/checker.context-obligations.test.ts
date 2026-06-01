import { describe, expect, test } from "bun:test";
import { formatDiagnostics, formatShapeSource } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget } from "./test-support.ts";

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
