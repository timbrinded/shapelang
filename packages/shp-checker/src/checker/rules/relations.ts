import type { HyperedgeInfo, Model, Provenance, SemanticDiagnostic } from "../model.ts";
import { PRELUDE_RELATION_KINDS } from "../../prelude.ts";
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

type HypercycleWitness = {
  vertices: string[];
  hyperedges: HyperedgeInfo[];
  provenance: Provenance[];
};

type HyperedgeStep = {
  hyperedge: HyperedgeInfo;
  from: string;
  to: string;
};

/**
 * Find a cycle in the directed hypergraph.
 *
 * Each relation kind contributes directed steps to the traversal according
 * to its `cycleTraversal` rule in the prelude kind registry:
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

export function findHypercycle(model: Model, kindsFilter: string[]): HypercycleWitness | undefined {
  const allSteps = buildHyperedgeSteps(model);
  const allowedKinds = kindsFilter.length === 0 ? undefined : new Set(kindsFilter);
  const steps = allowedKinds
    ? allSteps.filter((step) => allowedKinds.has(step.hyperedge.kind))
    : allSteps;
  if (steps.length === 0) {
    return undefined;
  }

  const adjacency = new Map<string, HyperedgeStep[]>();
  const vertices = new Set<string>();
  for (const step of steps) {
    vertices.add(step.from);
    vertices.add(step.to);
    const existing = adjacency.get(step.from) ?? [];
    existing.push(step);
    adjacency.set(step.from, existing);
  }

  for (const start of [...vertices].sort()) {
    const visited = new Set<string>();
    const witness = dfsHypercycle(start, start, adjacency, [], visited);
    if (witness) {
      return witness;
    }
  }

  return undefined;
}

export function dfsHypercycle(
  start: string,
  current: string,
  adjacency: Map<string, HyperedgeStep[]>,
  path: HyperedgeStep[],
  visited: Set<string>
): HypercycleWitness | undefined {
  if (visited.has(current)) {
    return undefined;
  }
  visited.add(current);

  const nextSteps = adjacency.get(current) ?? [];
  for (const step of nextSteps) {
    path.push(step);
    if (step.to === start) {
      return witnessFromPath(start, path);
    }

    const witness = dfsHypercycle(start, step.to, adjacency, path, visited);
    if (witness) {
      return witness;
    }
    path.pop();
  }

  visited.delete(current);
  return undefined;
}

export function witnessFromPath(start: string, path: HyperedgeStep[]): HypercycleWitness {
  const vertices = [start, ...path.map((step) => step.to)];
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
    hyperedges,
    provenance: hyperedges.map((edge) => edge.provenance)
  };
}

export function buildHyperedgeSteps(model: Model): HyperedgeStep[] {
  const steps: HyperedgeStep[] = [];
  for (const edge of model.hypergraph.edges.values()) {
    const rule = PRELUDE_RELATION_KINDS.get(edge.kind);
    const traversal = rule?.cycleTraversal ?? "none";
    if (traversal === "none") {
      continue;
    }

    if (traversal === "directed_pairs") {
      if (edge.members.length < 2) {
        continue;
      }
      steps.push({
        hyperedge: edge,
        from: edge.members[0]!.endpoint,
        to: edge.members[1]!.endpoint
      });
    } else if (traversal === "ordered_path") {
      for (let index = 0; index < edge.members.length - 1; index += 1) {
        steps.push({
          hyperedge: edge,
          from: edge.members[index]!.endpoint,
          to: edge.members[index + 1]!.endpoint
        });
      }
    }
  }
  return steps;
}
