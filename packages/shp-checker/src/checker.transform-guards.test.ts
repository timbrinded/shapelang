import { describe, expect, test } from "bun:test";
import { explainShapeModules, formatDiagnostics, formatShapeSource } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget, requireParsed } from "./test-support.ts";

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
