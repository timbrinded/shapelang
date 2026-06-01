import { describe, expect, test } from "bun:test";
import { checkShapeModules, explainShapeModules, formatDiagnostics } from "./index.ts";
import { PRELUDE_CONTEXT_RULES } from "./prelude.ts";
import { checkShapeSource, contextRef, requireParsed } from "./test-support.ts";

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
