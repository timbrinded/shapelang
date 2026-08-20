import { describe, expect, test } from "bun:test";
import { buildJourneys } from "../lib/journey-model.mjs";

describe("Unix System Visualiser journeys", () => {
  test("preserves authored coordinated-call endpoint order, roles, and relation identity", () => {
    const relation = makeRelation("m::ReviewJourney", "coordinated_call", [
      { id: "m::Report", index: 2, role: "report" },
      { id: "m::Cli", index: 0, role: "dispatch" },
      { id: "m::Checker", index: 1, role: "check" }
    ]);
    relation.summary = "Review the authored model";
    const model = makeModel({
      components: [makeComponent("m::Cli"), makeComponent("m::Checker")],
      relations: [relation],
      resources: [makeResource("m::Report")]
    });

    const journeys = buildJourneys(model, makeNodes(model));

    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({
      id: "journey:authored:m::ReviewJourney",
      kind: "authored",
      relationId: "m::ReviewJourney",
      startNodeId: "component:m::Cli",
      summary: "Review the authored model."
    });
    expect(journeys[0].steps.map((step) => [step.nodeId, step.role])).toEqual([
      ["component:m::Cli", "dispatch"],
      ["component:m::Checker", "check"],
      ["resource:m::Report", "report"]
    ]);
    expect(journeys[0].steps[1]).toMatchObject({
      fromNodeId: "component:m::Cli",
      relationNodeId: "relation:m::ReviewJourney",
      relationKind: "coordinated_call"
    });
  });

  test("builds distinct stable inferred tours for seed relations with the same endpoints", () => {
    const check = makeRelation("m::CheckCommand", "calls", endpoints("m::Cli", "m::Checker"));
    check.summary = "CheckCommand";
    const inspect = makeRelation("m::InspectCommand", "calls", endpoints("m::Cli", "m::Checker"));
    inspect.summary = "InspectCommand";
    const downstream = makeRelation(
      "m::CheckerCallsRules",
      "calls",
      endpoints("m::Checker", "m::Rules")
    );
    const model = makeModel({
      components: [makeComponent("m::Cli"), makeComponent("m::Checker"), makeComponent("m::Rules")],
      relations: [inspect, downstream, check]
    });

    const first = buildJourneys(model, makeNodes(model));
    const reordered = buildJourneys(
      {
        ...model,
        components: model.components.slice().reverse(),
        relations: model.relations.slice().reverse()
      },
      makeNodes(model).slice().reverse()
    );

    expect(first).toEqual(reordered);
    expect(first.map((journey) => journey.id)).toEqual([
      "journey:inferred:m::CheckCommand",
      "journey:inferred:m::InspectCommand"
    ]);
    expect(first.map((journey) => journey.steps.map((step) => step.nodeId))).toEqual([
      ["component:m::Cli", "component:m::Checker", "component:m::Rules"],
      ["component:m::Cli", "component:m::Checker", "component:m::Rules"]
    ]);
    expect(first[0].steps[1].narration).toContain("not verified runtime order");
  });

  test("uses zero-indegree starts, stops at cycles, and limits inferred tours to eight entities", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `m::C${index}`);
    const chain = ids
      .slice(0, -1)
      .map((id, index) => makeRelation(`m::Chain${index}`, "calls", endpoints(id, ids[index + 1])));
    const cycleEntry = makeRelation(
      "m::CycleEntry",
      "calls",
      endpoints("m::CycleStart", "m::CycleA")
    );
    const cycleForward = makeRelation(
      "m::CycleForward",
      "calls",
      endpoints("m::CycleA", "m::CycleB")
    );
    const cycleBack = makeRelation(
      "m::CycleBack",
      "callbacks",
      endpoints("m::CycleB", "m::CycleA")
    );
    const model = makeModel({
      components: [
        ...ids.map((id) => makeComponent(id)),
        makeComponent("m::CycleStart"),
        makeComponent("m::CycleA"),
        makeComponent("m::CycleB")
      ],
      relations: [...chain, cycleEntry, cycleForward, cycleBack]
    });

    const journeys = buildJourneys(model, makeNodes(model));
    const chainJourney = journeys.find((journey) => journey.relationId === "m::Chain0");
    const cycleJourney = journeys.find((journey) => journey.relationId === "m::CycleEntry");

    expect(journeys).toHaveLength(2);
    expect(chainJourney.steps).toHaveLength(8);
    expect(new Set(chainJourney.steps.map((step) => step.nodeId)).size).toBe(8);
    expect(cycleJourney.steps.map((step) => step.nodeId)).toEqual([
      "component:m::CycleStart",
      "component:m::CycleA",
      "component:m::CycleB"
    ]);
  });

  test("excludes generated relations and supports models with no journey candidates", () => {
    const generated = makeRelation(
      "m::GeneratedJourney",
      "coordinated_call",
      endpoints("m::A", "m::B")
    );
    generated.origin = "generated_ast";
    const model = makeModel({
      components: [makeComponent("m::A"), makeComponent("m::B")],
      relations: [generated]
    });

    expect(buildJourneys(model, makeNodes(model))).toEqual([]);
  });
});

function makeModel({ components = [], functions = [], relations = [], resources = [] }) {
  return { components, functions, relations, resources };
}

function makeComponent(id, functions = []) {
  return { id, name: localName(id), origin: "authored", functions };
}

function makeResource(id) {
  return { id, name: localName(id), origin: "authored" };
}

function makeRelation(id, kind, relationEndpoints) {
  return {
    id,
    name: localName(id),
    kind,
    ordered: true,
    from: relationEndpoints[0].id,
    to: relationEndpoints.at(-1).id,
    endpoints: relationEndpoints,
    origin: "authored"
  };
}

function endpoints(from, to) {
  return [
    { id: from, index: 0 },
    { id: to, index: 1 }
  ];
}

function makeNodes(model) {
  return [
    ...model.components.map((component) => ({
      id: `component:${component.id}`,
      modelId: component.id,
      label: component.name,
      type: "component"
    })),
    ...model.resources.map((resource) => ({
      id: `resource:${resource.id}`,
      modelId: resource.id,
      label: resource.name,
      type: "resource"
    })),
    ...model.relations
      .filter((relation) => relation.origin !== "generated_ast")
      .map((relation) => ({
        id: `relation:${relation.id}`,
        modelId: relation.id,
        label: relation.name,
        type: "relation"
      }))
  ];
}

function localName(id) {
  return id.split("::").at(-1);
}
