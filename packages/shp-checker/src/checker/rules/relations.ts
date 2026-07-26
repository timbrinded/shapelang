import type { HyperedgeInfo, Model, Provenance, RuleInfo, SemanticDiagnostic } from "../model.ts";
import { PRELUDE_RELATION_KINDS } from "../../prelude.ts";
import { compareCodepointStrings } from "../../shape-strings.ts";
import { displaySymbol } from "../display.ts";
import { describeProvenance } from "../provenance.ts";

export function isResolvedVertex(name: string, model: Model): boolean {
  return model.components.has(name) || model.resources.has(name);
}

export function isAmbiguousVertex(name: string, model: Model): boolean {
  return model.components.has(name) && model.resources.has(name);
}

export function checkProvidesEndpointKinds(
  hyperedge: HyperedgeInfo,
  model: Model
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const provider = providesProvider(hyperedge);
  const target = providesTarget(hyperedge);

  if (provider && isResolvedVertex(provider, model) && !model.components.has(provider)) {
    diagnostics.push({
      kind: "invalid_relation",
      name: hyperedge.name,
      reason: `provides provider ${displaySymbol(provider)} must be a component`,
      filePath: hyperedge.provenance.filePath,
      causedBy: [describeProvenance(hyperedge.provenance)]
    });
  }

  if (target && isResolvedVertex(target, model) && !model.resources.has(target)) {
    diagnostics.push({
      kind: "invalid_relation",
      name: hyperedge.name,
      reason: `provides target ${displaySymbol(target)} must be a resource`,
      filePath: hyperedge.provenance.filePath,
      causedBy: [describeProvenance(hyperedge.provenance)]
    });
  }

  return diagnostics;
}

export function checkFingerprintExpectations(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const hyperedge of model.hypergraph.edges.values()) {
    const endpointSet = new Set(hyperedge.members.map((member) => member.endpoint));
    for (const expectation of hyperedge.fingerprintExpectations) {
      if (!endpointSet.has(expectation.endpoint)) {
        continue;
      }
      if (!isResolvedVertex(expectation.endpoint, model)) {
        continue;
      }
      if (isAmbiguousVertex(expectation.endpoint, model)) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `fingerprint expectation endpoint ${displaySymbol(expectation.endpoint)} resolves to both a component and a resource`,
          filePath: expectation.provenance.filePath,
          causedBy: [describeProvenance(expectation.provenance)]
        });
        continue;
      }

      const resource = model.resources.get(expectation.endpoint);
      if (!resource) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `fingerprint expectation endpoint ${displaySymbol(expectation.endpoint)} must be a resource`,
          filePath: expectation.provenance.filePath,
          causedBy: [describeProvenance(expectation.provenance)]
        });
        continue;
      }

      const actual = resource.fingerprints.get(expectation.provider);
      if (!actual || actual.value !== expectation.value) {
        diagnostics.push({
          kind: "fingerprint_mismatch",
          relation: hyperedge.name,
          endpoint: expectation.endpoint,
          provider: expectation.provider,
          expected: expectation.value,
          actual: actual?.value,
          filePath: expectation.provenance.filePath,
          causedBy: [
            describeProvenance(expectation.provenance),
            describeProvenance(resource.provenance),
            ...(actual ? [describeProvenance(actual.provenance)] : [])
          ]
        });
      }
    }
  }

  return diagnostics;
}

export function checkProvidesRules(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    for (const forbid of rule.forbidProvides) {
      for (const hyperedge of model.hypergraph.edges.values()) {
        if (hyperedge.kind !== "provides") {
          continue;
        }
        const provider = providesProvider(hyperedge);
        const target = providesTarget(hyperedge);
        if (!provider || !target) {
          continue;
        }
        if (target !== forbid.target) {
          continue;
        }
        if (provider === forbid.except) {
          continue;
        }
        diagnostics.push({
          kind: "forbidden_provides",
          rule: rule.name,
          provider,
          target,
          hyperedge: hyperedge.name,
          allowedComponent: forbid.except,
          filePath: hyperedge.provenance.filePath,
          causedBy: [
            describeProvenance(hyperedge.provenance),
            describeProvenance(forbid.provenance)
          ]
        });
      }
    }
  }

  return diagnostics;
}

/**
 * `provides` hyperedges connect `provider -> target` (binary, directed).
 */

export function providesProvider(hyperedge: HyperedgeInfo): string | undefined {
  return hyperedge.members[0]?.endpoint;
}

export function providesTarget(hyperedge: HyperedgeInfo): string | undefined {
  return hyperedge.members[1]?.endpoint;
}

export function checkForbiddenPaths(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    for (const forbid of rule.forbidPaths) {
      const invalidReason = forbiddenPathInvalidReason(forbid);
      if (invalidReason) {
        diagnostics.push({
          kind: "invalid_rule",
          rule: rule.name,
          reason: invalidReason,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
        continue;
      }
      if (
        forbid.sourceResolution !== "resolved" ||
        forbid.targetResolution !== "resolved" ||
        !isResolvedVertex(forbid.source, model) ||
        !isResolvedVertex(forbid.target, model) ||
        isAmbiguousVertex(forbid.source, model) ||
        isAmbiguousVertex(forbid.target, model)
      ) {
        continue;
      }

      const witness = findShortestPath(model, forbid.source, forbid.target, forbid.kinds);
      if (!witness) {
        continue;
      }

      diagnostics.push({
        kind: "forbidden_path",
        rule: rule.name,
        source: forbid.source,
        target: forbid.target,
        kinds: [...forbid.kinds],
        steps: witness.steps.map((step) => ({
          from: step.from,
          to: step.to,
          relation: step.hyperedge.name,
          kind: step.hyperedge.kind
        })),
        filePath: forbid.provenance.filePath,
        causedBy: [
          describeProvenance(forbid.provenance),
          ...witness.provenance.map(describeProvenance)
        ]
      });
    }
  }

  return diagnostics;
}

function forbiddenPathInvalidReason(forbid: RuleInfo["forbidPaths"][number]): string | undefined {
  if (forbid.source === forbid.target) {
    return "forbidden path endpoints must be distinct; use forbid hypercycle for cycles";
  }
  const unsupportedKinds = [
    ...new Set(
      forbid.kinds.filter(
        (kind) => (PRELUDE_RELATION_KINDS.get(kind)?.traversal ?? "none") === "none"
      )
    )
  ].sort(compareCodepointStrings);
  return unsupportedKinds.length > 0
    ? `relation kind${unsupportedKinds.length === 1 ? "" : "s"} ${unsupportedKinds.join(", ")} ${unsupportedKinds.length === 1 ? "has" : "have"} no directed traversal semantics`
    : undefined;
}

export function checkHypercycles(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const seenCycles = new Set<string>();

  for (const rule of model.rules) {
    for (const forbid of rule.forbidHypercycles) {
      const cycle = findHypercycle(model, forbid.kinds);
      if (!cycle) {
        continue;
      }

      const signature = cycle.hyperedges
        .map((edge) => edge.name)
        .sort()
        .join(",");
      const dedupeKey = `${rule.name}:${signature}`;
      if (seenCycles.has(dedupeKey)) {
        continue;
      }
      seenCycles.add(dedupeKey);

      diagnostics.push({
        kind: "forbidden_hypercycle",
        rule: rule.name,
        vertices: cycle.vertices,
        hyperedges: cycle.hyperedges.map((edge) => ({ name: edge.name, kind: edge.kind })),
        filePath: forbid.provenance.filePath,
        causedBy: [
          describeProvenance(forbid.provenance),
          ...cycle.provenance.map(describeProvenance)
        ]
      });
    }
  }

  return diagnostics;
}

type TraversalWitness = {
  vertices: string[];
  steps: RelationTraversalStep[];
  hyperedges: HyperedgeInfo[];
  provenance: Provenance[];
};

type RelationTraversalStep = {
  hyperedge: HyperedgeInfo;
  from: string;
  to: string;
};

type RelationTraversalGraph = {
  vertices: string[];
  adjacency: Map<string, RelationTraversalStep[]>;
};

/**
 * Find the shortest deterministic cycle in the directed hypergraph.
 *
 * Each relation kind contributes directed steps according to its `traversal`
 * rule in the prelude kind registry:
 *
 * - `directed_pairs`: a 2-vertex hyperedge contributes one step `members[0] -> members[1]`.
 * - `ordered_path`: an N-vertex hyperedge contributes consecutive steps
 *   `members[i] -> members[i+1]` along the declared order.
 * - `none`: the hyperedge does not participate in cycle detection.
 *
 * `kindsFilter`, if non-empty, restricts the search to the subgraph induced
 * by hyperedges whose `kind` matches one of the listed kinds. Steps from
 * other kinds are excluded from adjacency entirely, so cycles that require
 * traversing a non-allowed kind to close are not reported.
 */

export function findHypercycle(model: Model, kindsFilter: string[]): TraversalWitness | undefined {
  const graph = buildRelationTraversalGraph(model.hypergraph.edges.values(), kindsFilter);
  let shortestCycle: RelationTraversalStep[] | undefined;

  for (const component of stronglyConnectedComponents(graph)) {
    if (!isCyclicComponent(component, graph)) {
      continue;
    }
    const candidate = shortestCycleInComponent(component, graph);
    if (candidate && (!shortestCycle || compareTraversalPaths(candidate, shortestCycle) < 0)) {
      shortestCycle = candidate;
    }
  }

  return shortestCycle ? witnessFromPath(shortestCycle) : undefined;
}

export function findShortestPath(
  model: Model,
  source: string,
  target: string,
  kindsFilter: string[]
): TraversalWitness | undefined {
  const graph = buildRelationTraversalGraph(validPathHyperedges(model), kindsFilter);
  const path = shortestPathBetween(source, target, graph);
  return path ? witnessFromPath(path) : undefined;
}

function validPathHyperedges(model: Model): HyperedgeInfo[] {
  return [...model.hypergraph.edges.values()].filter((edge) => {
    if (
      edge.members.some(
        (member) =>
          !isResolvedVertex(member.endpoint, model) || isAmbiguousVertex(member.endpoint, model)
      )
    ) {
      return false;
    }
    if (edge.kind !== "provides") {
      return true;
    }
    const provider = providesProvider(edge);
    const target = providesTarget(edge);
    return (
      provider !== undefined &&
      target !== undefined &&
      model.components.has(provider) &&
      model.resources.has(target)
    );
  });
}

function buildRelationTraversalGraph(
  hyperedges: Iterable<HyperedgeInfo>,
  kindsFilter: string[]
): RelationTraversalGraph {
  const allowedKinds = kindsFilter.length === 0 ? undefined : new Set(kindsFilter);
  const adjacency = new Map<string, RelationTraversalStep[]>();
  const vertices = new Set<string>();

  const addStep = (hyperedge: HyperedgeInfo, from: string, to: string): void => {
    vertices.add(from);
    vertices.add(to);
    const steps = adjacency.get(from) ?? [];
    steps.push({ hyperedge, from, to });
    adjacency.set(from, steps);
  };

  for (const edge of hyperedges) {
    if (allowedKinds && !allowedKinds.has(edge.kind)) {
      continue;
    }
    const traversal = PRELUDE_RELATION_KINDS.get(edge.kind)?.traversal ?? "none";
    if (traversal === "directed_pairs") {
      const from = edge.members[0]?.endpoint;
      const to = edge.members[1]?.endpoint;
      if (from && to) {
        addStep(edge, from, to);
      }
    } else if (traversal === "ordered_path") {
      for (let index = 0; index < edge.members.length - 1; index += 1) {
        addStep(edge, edge.members[index]!.endpoint, edge.members[index + 1]!.endpoint);
      }
    }
  }

  for (const steps of adjacency.values()) {
    steps.sort(compareRelationTraversalSteps);
  }

  return {
    vertices: [...vertices].sort(compareCodepointStrings),
    adjacency
  };
}

function compareRelationTraversalSteps(
  left: RelationTraversalStep,
  right: RelationTraversalStep
): number {
  const byTarget = compareCodepointStrings(left.to, right.to);
  if (byTarget !== 0) {
    return byTarget;
  }
  const byKind = compareCodepointStrings(left.hyperedge.kind, right.hyperedge.kind);
  if (byKind !== 0) {
    return byKind;
  }
  return compareCodepointStrings(left.hyperedge.name, right.hyperedge.name);
}

function stronglyConnectedComponents(graph: RelationTraversalGraph): string[][] {
  const components: string[][] = [];
  const indexByVertex = new Map<string, number>();
  const lowLinkByVertex = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let nextIndex = 0;

  const visit = (vertex: string): void => {
    const vertexIndex = nextIndex;
    nextIndex += 1;
    indexByVertex.set(vertex, vertexIndex);
    lowLinkByVertex.set(vertex, vertexIndex);
    stack.push(vertex);
    onStack.add(vertex);

    for (const step of graph.adjacency.get(vertex) ?? []) {
      const targetIndex = indexByVertex.get(step.to);
      if (targetIndex === undefined) {
        visit(step.to);
        lowLinkByVertex.set(
          vertex,
          Math.min(lowLinkByVertex.get(vertex)!, lowLinkByVertex.get(step.to)!)
        );
      } else if (onStack.has(step.to)) {
        lowLinkByVertex.set(vertex, Math.min(lowLinkByVertex.get(vertex)!, targetIndex));
      }
    }

    if (lowLinkByVertex.get(vertex) !== vertexIndex) {
      return;
    }

    const component: string[] = [];
    while (true) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === vertex) {
        break;
      }
    }
    components.push(component);
  };

  for (const vertex of graph.vertices) {
    if (!indexByVertex.has(vertex)) {
      visit(vertex);
    }
  }

  return components;
}

function isCyclicComponent(component: string[], graph: RelationTraversalGraph): boolean {
  if (component.length > 1) {
    return true;
  }
  const vertex = component[0];
  return (
    vertex !== undefined && (graph.adjacency.get(vertex) ?? []).some((step) => step.to === vertex)
  );
}

function shortestCycleInComponent(
  component: string[],
  graph: RelationTraversalGraph
): RelationTraversalStep[] | undefined {
  const members = new Set(component);
  let shortestCycle: RelationTraversalStep[] | undefined;

  for (const start of component) {
    const candidate = shortestCycleFrom(start, members, graph);
    if (candidate && (!shortestCycle || compareTraversalPaths(candidate, shortestCycle) < 0)) {
      shortestCycle = candidate;
    }
  }

  return shortestCycle;
}

function shortestCycleFrom(
  start: string,
  members: ReadonlySet<string>,
  graph: RelationTraversalGraph
): RelationTraversalStep[] | undefined {
  const queue: { vertex: string; path: RelationTraversalStep[] }[] = [{ vertex: start, path: [] }];
  const visited = new Set([start]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const step of graph.adjacency.get(current.vertex) ?? []) {
      if (!members.has(step.to)) {
        continue;
      }
      const path = [...current.path, step];
      if (step.to === start) {
        return path;
      }
      if (!visited.has(step.to)) {
        visited.add(step.to);
        queue.push({ vertex: step.to, path });
      }
    }
  }

  return undefined;
}

function shortestPathBetween(
  source: string,
  target: string,
  graph: RelationTraversalGraph
): RelationTraversalStep[] | undefined {
  const queue: { vertex: string; path: RelationTraversalStep[] }[] = [{ vertex: source, path: [] }];
  const visited = new Set([source]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const step of graph.adjacency.get(current.vertex) ?? []) {
      const path = [...current.path, step];
      if (step.to === target) {
        return path;
      }
      if (!visited.has(step.to)) {
        visited.add(step.to);
        queue.push({ vertex: step.to, path });
      }
    }
  }

  return undefined;
}

function compareTraversalPaths(
  left: RelationTraversalStep[],
  right: RelationTraversalStep[]
): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }

  const leftVertices = [left[0]!.from, ...left.map((step) => step.to)];
  const rightVertices = [right[0]!.from, ...right.map((step) => step.to)];
  for (let index = 0; index < leftVertices.length; index += 1) {
    const byVertex = compareCodepointStrings(leftVertices[index]!, rightVertices[index]!);
    if (byVertex !== 0) {
      return byVertex;
    }
  }

  for (let index = 0; index < left.length; index += 1) {
    const byKind = compareCodepointStrings(
      left[index]!.hyperedge.kind,
      right[index]!.hyperedge.kind
    );
    if (byKind !== 0) {
      return byKind;
    }
    const byName = compareCodepointStrings(
      left[index]!.hyperedge.name,
      right[index]!.hyperedge.name
    );
    if (byName !== 0) {
      return byName;
    }
  }

  return 0;
}

function witnessFromPath(path: RelationTraversalStep[]): TraversalWitness {
  const vertices = [path[0]!.from, ...path.map((step) => step.to)];
  const seenEdges = new Set<string>();
  const hyperedges: HyperedgeInfo[] = [];
  for (const step of path) {
    if (!seenEdges.has(step.hyperedge.name)) {
      seenEdges.add(step.hyperedge.name);
      hyperedges.push(step.hyperedge);
    }
  }
  return {
    vertices,
    steps: path,
    hyperedges,
    provenance: hyperedges.map((edge) => edge.provenance)
  };
}
