import { describe, expect, test } from "bun:test";
import {
  checkShapeModules,
  parseShapeModule,
  type Fact,
  type SemanticDiagnostic,
  type ShapeDiagnostic
} from "../index.ts";
import { evaluateMissingGrantPrototype } from "./datalog-rule-engine-spike.ts";

describe("Datalog-like rule engine spike", () => {
  test("matches the direct missing-grant diagnostic and its provenance", () => {
    const result = check(`
      module audit

      resource AuditEvent

      component AuditStore {
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }
    `);

    expect(evaluateMissingGrantPrototype(requiredFacts(result.facts))).toEqual(
      missingGrantDiagnostics(result.diagnostics)
    );
    expect(missingGrantDiagnostics(result.diagnostics)[0]?.causedBy).toEqual([
      "prototype.shape: effect AuditStore.appendEvent emits Append<AuditEvent>",
      "prototype.shape: component AuditStore"
    ]);
  });

  test("derives no diagnostic when the matching grant exists", () => {
    const result = check(`
      module audit

      resource AuditEvent

      component AuditStore {
        grants Append<AuditEvent>
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }
    `);

    expect(evaluateMissingGrantPrototype(requiredFacts(result.facts))).toEqual([]);
    expect(missingGrantDiagnostics(result.diagnostics)).toEqual([]);
  });

  test("matches production by ignoring targetless effects", () => {
    const result = check(`
      module audit

      component AuditStore {
        fn readClock
          effects complete {
            ClockRead
          }
      }
    `);

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "effect",
        effect: "ClockRead",
        target: ""
      })
    );
    expect(evaluateMissingGrantPrototype(requiredFacts(result.facts))).toEqual(
      missingGrantDiagnostics(result.diagnostics)
    );
    expect(missingGrantDiagnostics(result.diagnostics)).toEqual([]);
  });

  test("uses an exact component, effect, and target join", () => {
    const result = check(`
      module audit

      resource AuditEvent
      resource PolicySnapshot

      component AuditStore {
        grants Append<PolicySnapshot>
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }

      component PolicyStore {
        grants Append<AuditEvent>
      }
    `);

    expect(evaluateMissingGrantPrototype(requiredFacts(result.facts))).toEqual(
      missingGrantDiagnostics(result.diagnostics)
    );
  });

  test("keeps production precedence outside the prototype boundary", () => {
    const result = check(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        fn purgeEvent
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(missingGrantDiagnostics(result.diagnostics)).toEqual([]);
    expect(evaluateMissingGrantPrototype(requiredFacts(result.facts))).toHaveLength(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "final_forbidden_effect"
    );
  });

  test("is deterministic across input fact order", () => {
    const result = check(`
      module audit

      resource AuditEvent
      resource PolicySnapshot

      component ZetaStore {
        fn writeAudit
          effects complete {
            Append<AuditEvent>
          }
      }

      component AlphaStore {
        fn writePolicy
          effects complete {
            Update<PolicySnapshot>
          }
      }
    `);
    const facts = requiredFacts(result.facts);

    const forward = evaluateMissingGrantPrototype(facts);
    const reversed = evaluateMissingGrantPrototype(facts.toReversed());

    expect(reversed).toEqual(forward);
    expect(forward).toEqual(missingGrantDiagnostics(result.diagnostics));
    expect(forward.map((diagnostic) => diagnostic.component)).toEqual([
      "audit::AlphaStore",
      "audit::ZetaStore"
    ]);
  });
});

function check(source: string) {
  const parsed = parseShapeModule(source, "prototype.shape");
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  return checkShapeModules(
    [{ module: parsed.module, filePath: "prototype.shape", origin: "authored" }],
    {
      enforceBindings: false,
      includeFacts: true
    }
  );
}

function requiredFacts(facts: Fact[] | undefined): Fact[] {
  if (!facts) {
    throw new Error("expected checker facts");
  }
  return facts;
}

function missingGrantDiagnostics(
  diagnostics: readonly ShapeDiagnostic[]
): Extract<SemanticDiagnostic, { kind: "missing_grant" }>[] {
  return diagnostics.filter(
    (diagnostic): diagnostic is Extract<SemanticDiagnostic, { kind: "missing_grant" }> =>
      diagnostic.kind === "missing_grant"
  );
}
