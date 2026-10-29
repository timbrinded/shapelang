import { expect, test } from "bun:test";
import { isChangeDecl } from "../language/generated/ast.ts";
import { requireParsed } from "../test-support.ts";
import { commitPlannedChange, stageModelForChange } from "./change-planning.ts";
import { lowerShapeModules } from "./lowerer.ts";
import { planChange } from "./lowering/changes.ts";
import { checkGuardedChanges } from "./rules/guards.ts";
import { moduleContext } from "./symbols.ts";

test("plans a guarded change without mutating the effective model", () => {
  const baseModule = requireParsed(`
    module gateway

    resource AuditLog

    component Gateway {
      owns AuditLog
      grants Append<AuditLog>
      fn writeAudit : PreserveInline
        description required "Keep the audited write local."
        effects complete {
          Append<AuditLog>
        }
    }
  `);
  const changeModule = requireParsed(`
    module gateway

    change ExtractAuditWriter {
      modify fn Gateway.writeAudit
        transform ExtractHelper
        effects complete {
          Append<AuditLog>
        }
    }
  `);
  const change = changeModule.declarations.find(isChangeDecl);
  if (!change) {
    throw new Error("expected a parsed change declaration");
  }

  const model = lowerShapeModules([baseModule]);
  const originalFunction = model.components.get("gateway::Gateway")?.functions.get("writeAudit");
  const plan = planChange(change, moduleContext({ module: changeModule }), model);

  expect(originalFunction?.shapeTraits.has("PreserveInline")).toBeTrue();
  expect(originalFunction?.description?.summary).toBe("Keep the audited write local.");
  expect(model.changeEvents).toEqual([]);
  expect(
    plan.stagedModel.components
      .get("gateway::Gateway")
      ?.functions.get("writeAudit")
      ?.shapeTraits.has("PreserveInline")
  ).toBeFalse();
  expect(plan.events.map((event) => event.kind)).toEqual([
    "target_changed",
    "shape_trait_removed",
    "description_removed",
    "transform_applied"
  ]);

  commitPlannedChange(model, plan);

  expect(
    model.components.get("gateway::Gateway")?.functions.get("writeAudit")?.description
  ).toBeUndefined();
  expect(model.changeEvents).toEqual(plan.events);
});

test("signature-only edits remain isolated until commit and require memory review", () => {
  const baseModule = requireParsed(`
    module gateway

    resource AuditLog

    component Gateway {
      owns AuditLog
      grants Append<AuditLog>
      fn writeAudit
        signature ts("(entry: number) => void")
        effects complete {
          Append<AuditLog>
        }
    }

    memory AuditContract : RefactorConstraint<fn Gateway.writeAudit> {
      applies_to fn Gateway.writeAudit
      status Explained
      confidence High
      summary "Callers depend on the reviewed audit contract."
      guards { on_change require ReEvaluation<Self> }
    }
  `);
  const changeModule = requireParsed(`
    module gateway

    change ReturnAuditCount {
      modify fn Gateway.writeAudit
        signature ts("(entry: number) => number")
        effects complete {
          Append<AuditLog>
        }
    }
  `);
  const change = changeModule.declarations.find(isChangeDecl);
  if (!change) {
    throw new Error("expected a parsed change declaration");
  }

  const model = lowerShapeModules([baseModule]);
  const originalFunction = model.components.get("gateway::Gateway")?.functions.get("writeAudit");
  const context = moduleContext({ module: changeModule });
  const plan = planChange(change, context, model);
  const stagedFunction = plan.stagedModel.components
    .get("gateway::Gateway")
    ?.functions.get("writeAudit");

  expect(originalFunction?.signature).toEqual({ language: "ts", value: "(entry: number) => void" });
  expect(stagedFunction).not.toBe(originalFunction);
  expect(stagedFunction?.signature).toEqual({ language: "ts", value: "(entry: number) => number" });
  expect(model.components.get("gateway::Gateway")?.functions.get("writeAudit")).toBe(
    originalFunction
  );
  expect(model.changeEvents).toEqual([]);
  expect(checkGuardedChanges(model)).toEqual([]);
  expect(plan.events.map(({ kind, target }) => ({ kind, target }))).toEqual([
    { kind: "target_changed", target: { kind: "fn", name: "gateway::Gateway.writeAudit" } }
  ]);

  commitPlannedChange(model, plan);

  expect(model.components.get("gateway::Gateway")?.functions.get("writeAudit")).toBe(
    stagedFunction
  );
  expect(originalFunction?.signature?.value).toBe("(entry: number) => void");
  expect(checkGuardedChanges(model)).toEqual([
    expect.objectContaining({
      kind: "guarded_shape_changed",
      guardKind: "memory",
      guard: "gateway::AuditContract",
      targetKind: "fn",
      target: "gateway::Gateway.writeAudit",
      missingReevaluation: "reevaluation satisfying memory AuditContract"
    })
  ]);

  const reevaluationModule = requireParsed(`
    module gateway

    reevaluation AuditCountReviewed {
      satisfies memory AuditContract
      outcome Replaced
      summary "Callers now consume the returned audit count."
      reviewer GatewayTeam
      decided_on "2026-10-27"
      evidence test("gateway/audit-count.test.ts")
    }
  `);
  const reviewedModel = lowerShapeModules([baseModule, reevaluationModule]);
  commitPlannedChange(reviewedModel, planChange(change, context, reviewedModel));

  expect(reviewedModel.changeEvents.map((event) => event.kind)).toEqual(["target_changed"]);
  expect(checkGuardedChanges(reviewedModel)).toEqual([]);
});

test("copies every model container mutated by change lowering", () => {
  const model = lowerShapeModules([
    requireParsed(`
      module gateway

      resource AuditLog

      component Gateway {
        owns AuditLog
        grants Append<AuditLog>
        fn writeAudit
          effects complete {
            Append<AuditLog>
          }
      }

      component Sink {
      }

      relation GatewayCallsSink {
        kind calls
        connects Gateway -> Sink
      }
    `)
  ]);
  const staged = stageModelForChange(model, { copyHypergraph: true });
  const stagedWithoutRelationChange = stageModelForChange(model, { copyHypergraph: false });

  expect(staged.resources).not.toBe(model.resources);
  expect(staged.traits).not.toBe(model.traits);
  expect(staged.components).not.toBe(model.components);
  expect(staged.hypergraph.edges).not.toBe(model.hypergraph.edges);
  expect(staged.hypergraph.incidence).not.toBe(model.hypergraph.incidence);
  expect(staged.hypergraph.incidence.get("gateway::Gateway")).not.toBe(
    model.hypergraph.incidence.get("gateway::Gateway")
  );
  expect(stagedWithoutRelationChange.hypergraph).toBe(model.hypergraph);
  expect(staged.implementations).not.toBe(model.implementations);
  expect(staged.bindings).not.toBe(model.bindings);
  expect(staged.rules).not.toBe(model.rules);
  expect(staged.attestations).not.toBe(model.attestations);
  expect(staged.changeEvents).not.toBe(model.changeEvents);
  expect(staged.facts).not.toBe(model.facts);
  expect(staged.diagnostics).not.toBe(model.diagnostics);
});
