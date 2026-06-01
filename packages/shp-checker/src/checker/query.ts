// User-facing read/query output: graph, explain, obligations, and memory-guard
// listing. These commands consume the effective model (via lowerShapeModules)
// and the shared display/derivation helpers to render stable text; they never
// lower declarations or evaluate rules themselves beyond calling checkShapeModules
// for obligation listing.
import type { ShapeModule } from "../language/generated/ast.ts";
import type {
  CheckModuleInput,
  ContextObjectInfo,
  HyperedgeInfo,
  HyperedgeMember,
  MemoryInfo,
  Model,
  ProtectedProperty,
  Provenance,
  RationaleInfo,
  SemanticDiagnostic,
  ShapeDiagnostic,
  ShapeTarget
} from "./model.ts";
import type { ContextKind } from "../prelude.ts";
import { compareCodepointStrings } from "../shape-strings.ts";
import {
  displaySymbol,
  formatContextRequirement,
  formatFingerprintInfo,
  formatSourceRefInfo,
  formatTarget,
  formatTerm,
  functionTarget,
  localNameOf,
  splitFunctionTarget
} from "./display.ts";
import {
  deriveFinalForbidsForResource,
  hasGuardAction,
  matchingContextsForTarget,
  requirementsForTarget,
  targetsEqual
} from "./derivations.ts";
import { lowerShapeModules } from "./lowerer.ts";
import { checkShapeModules } from "./api.ts";

export function listMemoryGuardsShapeModules(modules: ShapeModule[] | CheckModuleInput[]): string {
  const model = lowerShapeModules(modules);
  const entries = [
    ...[...model.rationales.values()].map((rationale) => ({
      target: rationale.appliesTo ?? rationale.target,
      lines: formatRationaleMemoryListEntry(rationale)
    })),
    ...[...model.memories.values()].map((memory) => ({
      target: memory.appliesTo ?? memory.target,
      lines: formatMemoryListEntry(memory)
    }))
  ].sort((left, right) =>
    `${formatTarget(left.target)}:${left.lines[0]}`.localeCompare(
      `${formatTarget(right.target)}:${right.lines[0]}`
    )
  );

  if (entries.length === 0) {
    return "Memory Guards\n\nNo active memory guards.\n";
  }

  const lines = ["Memory Guards", ""];
  for (const entry of entries) {
    lines.push(formatTarget(entry.target), ...entry.lines.map((line) => `  ${line}`), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function listShapeObligations(
  modules: ShapeModule[] | CheckModuleInput[],
  options: { freshnessDate?: string } = {}
): string {
  const result = checkShapeModules(modules, { freshnessDate: options.freshnessDate });
  const relevant = result.diagnostics.filter(isObligationDiagnostic);

  if (relevant.length === 0) {
    return "Open Shape Obligations\n\nNo open shape obligations.\n";
  }

  const lines = ["Open Shape Obligations", ""];
  const missingContext = relevant.filter(
    (diagnostic) => diagnostic.kind === "missing_required_context"
  );
  const missingDescription = relevant.filter(
    (diagnostic) => diagnostic.kind === "missing_required_description"
  );
  const guardedChanges = relevant.filter(
    (diagnostic) => diagnostic.kind === "guarded_shape_changed"
  );
  const invalidReevaluations = relevant.filter(
    (diagnostic) => diagnostic.kind === "invalid_reevaluation"
  );
  const staleMemories = relevant.filter((diagnostic) => diagnostic.kind === "stale_memory");

  if (missingContext.length > 0) {
    lines.push("missing context:");
    lines.push(
      ...missingContext.map(
        (diagnostic) =>
          `  ${diagnostic.targetKind} ${diagnostic.target} requires ${diagnostic.requiredContext}`
      )
    );
    lines.push("");
  }
  if (missingDescription.length > 0) {
    lines.push("missing description:");
    lines.push(
      ...missingDescription.map(
        (diagnostic) => `  ${diagnostic.targetKind} ${diagnostic.target} requires description`
      )
    );
    lines.push("");
  }
  if (guardedChanges.length > 0) {
    lines.push("guarded changes:");
    lines.push(
      ...guardedChanges.map(
        (diagnostic) =>
          `  ${diagnostic.targetKind} ${diagnostic.target} changed; requires ${diagnostic.missingReevaluation}`
      )
    );
    lines.push("");
  }
  if (invalidReevaluations.length > 0) {
    lines.push("invalid reevaluations:");
    lines.push(
      ...invalidReevaluations.map(
        (diagnostic) => `  reevaluation ${diagnostic.name}: ${diagnostic.reason}`
      )
    );
    lines.push("");
  }
  if (staleMemories.length > 0) {
    lines.push("stale design memory:");
    lines.push(
      ...staleMemories.map(
        (diagnostic) =>
          `  ${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)} review_by ${diagnostic.reviewBy} is before ${diagnostic.asOf}`
      )
    );
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function explainShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string
): string {
  const model = lowerShapeModules(modules);
  const symbolAmbiguity = formatAmbiguousQuerySymbol(symbol, [
    { kind: "resource", map: model.resources },
    { kind: "component", map: model.components },
    { kind: "relation", map: model.hypergraph.edges },
    { kind: "rationale", map: model.rationales },
    { kind: "memory", map: model.memories }
  ]);
  if (symbolAmbiguity) {
    return symbolAmbiguity;
  }

  const resourceKey = resolveQuerySymbol(symbol, model.resources);
  const resource = resourceKey ? model.resources.get(resourceKey) : undefined;
  if (resource) {
    const finalForbids = deriveFinalForbidsForResource(resource, model);
    const lines = [
      symbol,
      "  kind: resource",
      "  traits:",
      ...[...resource.traits.keys()].sort().map((trait) => `    ${trait}`)
    ];
    if (finalForbids.length > 0) {
      lines.push("", "  final forbidden effects:");
      lines.push(
        ...finalForbids.map((forbid) => `    ${formatTerm(forbid.effect, forbid.target)}`)
      );
    }
    if (resource.fingerprints.size > 0) {
      lines.push("", "  fingerprints:");
      lines.push(
        ...[...resource.fingerprints.values()]
          .sort((left, right) => left.provider.localeCompare(right.provider))
          .map((fingerprint) => `    ${formatFingerprintInfo(fingerprint)}`)
      );
    }
    appendShapeTraitContext(
      { kind: "resource", name: resource.name },
      resource.traits,
      model,
      lines
    );
    appendIncidence(resource.name, model, lines);
    return `${lines.join("\n")}\n`;
  }

  const [componentName, functionName] = splitFunctionTarget(symbol);
  if (componentName && functionName) {
    const componentKey = resolveQuerySymbol(componentName, model.components);
    const fn = componentKey
      ? model.components.get(componentKey)?.functions.get(functionName)
      : undefined;
    if (fn && componentKey) {
      const lines = [`${componentKey}.${functionName}`, "  kind: function"];
      if (fn.source) {
        lines.push(`  source: ${formatSourceRefInfo(fn.source)}`);
      }
      if (fn.shapeTraits.size > 0) {
        lines.push("", "  shape traits:");
        lines.push(...[...fn.shapeTraits.keys()].sort().map((trait) => `    ${trait}`));
      }
      if (fn.description) {
        lines.push("", "  description:");
        if (fn.description.required) {
          lines.push("    required");
        }
        lines.push(`    ${JSON.stringify(fn.description.summary)}`);
      }
      const requirements = requirementsForTarget(model, "fn", fn.shapeTraits);
      if (requirements.length > 0) {
        const target = functionTarget(componentKey, functionName);
        lines.push("", "  required context:");
        lines.push(
          ...requirements.map(
            (requirement) => `    ${formatContextRequirement(requirement.contextType, target)}`
          )
        );
      }
      const satisfiedBy = matchingContextsForTarget(
        functionTarget(componentKey, functionName),
        model
      );
      if (satisfiedBy.length > 0) {
        lines.push("", "  satisfied by:");
        lines.push(...satisfiedBy.map((context) => `    ${context.kind} ${context.name}`));
      }
      const guards = guardsForTarget(functionTarget(componentKey, functionName), model);
      if (guards.length > 0) {
        lines.push("", "  memory guards:");
        lines.push(...guards.map((guard) => `    ${guard.kind} ${guard.info.name}`));
      }
      lines.push("  effects:");
      if (fn.effects.kind === "unknown") {
        lines.push("    unknown");
      } else {
        lines.push(
          ...fn.effects.entries.map(
            (entry) => `    ${formatTerm(entry.term.name, entry.term.target ?? "")}`
          )
        );
      }
      return `${lines.join("\n")}\n`;
    }
    const ambiguity = formatAmbiguousQuerySymbol(componentName, [
      { kind: "component", map: model.components }
    ]);
    if (ambiguity) {
      return ambiguity;
    }
  }

  const rationaleKey = resolveQuerySymbol(symbol, model.rationales);
  const rationale = rationaleKey ? model.rationales.get(rationaleKey) : undefined;
  if (rationale) {
    return `${formatRationaleExplanation(rationale)}\n`;
  }

  const memoryKey = resolveQuerySymbol(symbol, model.memories);
  const memory = memoryKey ? model.memories.get(memoryKey) : undefined;
  if (memory) {
    return `${formatMemoryExplanation(memory)}\n`;
  }

  const componentKey = resolveQuerySymbol(symbol, model.components);
  const component = componentKey ? model.components.get(componentKey) : undefined;
  if (component) {
    const lines = [symbol, "  kind: component"];
    if (component.classifiers.size > 0) {
      lines.push("  classifiers:");
      lines.push(
        ...[...component.classifiers.keys()].sort().map((classifier) => `    ${classifier}`)
      );
    }
    lines.push(
      "  grants:",
      ...[...component.grants.keys()].sort().map((grant) => `    ${grant}`),
      "",
      "  functions:",
      ...[...component.functions.keys()].sort().map((name) => `    ${name}`)
    );
    appendShapeTraitContext(
      { kind: "component", name: component.name },
      component.classifiers,
      model,
      lines
    );
    appendIncidence(component.name, model, lines);
    return `${lines.join("\n")}\n`;
  }

  const relationKey = resolveQuerySymbol(symbol, model.hypergraph.edges);
  const relation = relationKey ? model.hypergraph.edges.get(relationKey) : undefined;
  if (relation) {
    return `${formatRelationExplanation(relation, model)}\n`;
  }

  return `No shape facts found for ${symbol}.\n`;
}

/**
 * Appends the shape-trait obligation sections (required context, satisfying
 * context, and active guards) for a component or resource target to an explain
 * listing. Guarded-change enforcement now fires for component/resource targets
 * via `modify`/`remove` change events, so listed guards are real.
 */
function appendShapeTraitContext(
  target: ShapeTarget,
  traits: ReadonlyMap<string, Provenance>,
  model: Model,
  lines: string[]
): void {
  const requirements = requirementsForTarget(model, target.kind, traits);
  if (requirements.length > 0) {
    lines.push("", "  required context:");
    lines.push(
      ...requirements.map(
        (requirement) => `    ${formatContextRequirement(requirement.contextType, target)}`
      )
    );
  }
  appendContextAndGuardSections(target, model, lines);
}

/**
 * Appends the "satisfied by" and "memory guards" sections for a target. Split
 * out so relation explain (which carries no shape traits and so has no required
 * context) can list its guards without a fake empty trait map.
 */
function appendContextAndGuardSections(target: ShapeTarget, model: Model, lines: string[]): void {
  const satisfiedBy = matchingContextsForTarget(target, model);
  if (satisfiedBy.length > 0) {
    lines.push("", "  satisfied by:");
    lines.push(...satisfiedBy.map((context) => `    ${context.kind} ${context.name}`));
  }
  const guards = guardsForTarget(target, model);
  if (guards.length > 0) {
    lines.push("", "  memory guards:");
    lines.push(...guards.map((guard) => `    ${guard.kind} ${guard.info.name}`));
  }
}

function compareHyperedges(left: HyperedgeInfo, right: HyperedgeInfo): number {
  return `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`);
}

function resolveQuerySymbol<T extends { name: string }>(
  symbol: string,
  map: ReadonlyMap<string, T>
): string | undefined {
  const matches = querySymbolMatches(symbol, map);
  return matches.length === 1 ? matches[0] : undefined;
}

function querySymbolMatches<T extends { name: string }>(
  symbol: string,
  map: ReadonlyMap<string, T>
): string[] {
  if (map.has(symbol)) {
    return [symbol];
  }
  return [...map.keys()].filter((key) => localNameOf(key) === symbol).sort(compareCodepointStrings);
}

function formatAmbiguousQuerySymbol(
  symbol: string,
  groups: { kind: string; map: ReadonlyMap<string, { name: string }> }[]
): string | undefined {
  const candidates = groups.flatMap((group) =>
    querySymbolMatches(symbol, group.map).map((name) => ({ kind: group.kind, name }))
  );
  if (candidates.length < 2) {
    return undefined;
  }
  const lines = [
    `Ambiguous shape symbol ${symbol}.`,
    "Candidates:",
    ...candidates.map((candidate) => `  ${candidate.kind} ${candidate.name}`),
    "Use a module-qualified reference."
  ];
  return `${lines.join("\n")}\n`;
}

function allHyperedgesByKind(model: Model, kindFilter?: string): HyperedgeInfo[] {
  const edges: HyperedgeInfo[] = [];
  for (const edge of model.hypergraph.edges.values()) {
    if (!kindFilter || edge.kind === kindFilter) {
      edges.push(edge);
    }
  }
  return edges;
}

export function graphShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string,
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);
  const symbolAmbiguity = formatAmbiguousQuerySymbol(symbol, [
    { kind: "relation", map: model.hypergraph.edges },
    { kind: "component", map: model.components },
    { kind: "resource", map: model.resources }
  ]);
  if (symbolAmbiguity) {
    return symbolAmbiguity;
  }

  const relationKey = resolveQuerySymbol(symbol, model.hypergraph.edges);
  const relation = relationKey ? model.hypergraph.edges.get(relationKey) : undefined;
  if (relation) {
    if (kindFilter && relation.kind !== kindFilter) {
      return `No relations match kind ${kindFilter} for ${symbol}.\n`;
    }
    return `${formatHyperedgeLine(relation, 0, model)}\n`;
  }
  const vertexKey =
    resolveQuerySymbol(symbol, model.components) ??
    resolveQuerySymbol(symbol, model.resources) ??
    symbol;
  const incidentNames = model.hypergraph.incidence.get(vertexKey) ?? [];
  const incident = incidentNames
    .map((name) => model.hypergraph.edges.get(name))
    .filter((edge): edge is HyperedgeInfo => edge !== undefined)
    .filter((edge) => !kindFilter || edge.kind === kindFilter)
    .sort(compareHyperedges);

  const lines = [formatVertexHeader(vertexKey, model)];
  if (incident.length === 0) {
    lines.push("  (no incident relations)");
    return `${lines.join("\n")}\n`;
  }

  for (const edge of incident) {
    lines.push(`  ${formatHyperedgeLine(edge, 1, model)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Dump every hyperedge in the loaded modules, grouped by kind and sorted by name.
 * Used by `shp graph` with no symbol argument.
 */
export function graphAllShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);
  const edges = allHyperedgesByKind(model, kindFilter).sort(compareHyperedges);

  if (edges.length === 0) {
    return kindFilter ? `No relations match kind ${kindFilter}.\n` : "No relations declared.\n";
  }

  const lines = ["Hypergraph"];
  let currentKind = "";
  for (const edge of edges) {
    if (edge.kind !== currentKind) {
      currentKind = edge.kind;
      lines.push("", `${currentKind}:`);
    }
    lines.push(`  ${formatHyperedgeLine(edge, 0, model)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `kindFilter`, if provided, scopes hyperedge, incidence, arity, and
 * isolated-vertex participation to a single relation kind; vertex totals
 * always reflect the full model.
 */
export function statsShapeHypergraph(
  modules: ShapeModule[] | CheckModuleInput[],
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);

  const filteredEdges = allHyperedgesByKind(model, kindFilter);
  const totalEdgeCount = model.hypergraph.edges.size;

  const componentCount = model.components.size;
  const resourceCount = model.resources.size;
  const vertexCount = componentCount + resourceCount;

  let totalIncidences = 0;
  let minArity = Number.POSITIVE_INFINITY;
  let maxArity = 0;
  let widestEdge: HyperedgeInfo | undefined;
  const participatingVertices = new Set<string>();
  for (const edge of filteredEdges) {
    totalIncidences += edge.members.length;
    if (edge.members.length < minArity) {
      minArity = edge.members.length;
    }
    if (edge.members.length > maxArity) {
      maxArity = edge.members.length;
      widestEdge = edge;
    }
    for (const member of edge.members) {
      participatingVertices.add(member.endpoint);
    }
  }

  const isolatedVertices = [...model.components.keys(), ...model.resources.keys()]
    .filter((vertex) => !participatingVertices.has(vertex))
    .sort();

  const lines = ["Hypergraph stats"];
  lines.push(
    `  vertices: ${vertexCount} (${componentCount} component${pluralSuffix(componentCount)}, ${resourceCount} resource${pluralSuffix(resourceCount)})`
  );
  if (kindFilter) {
    lines.push(`  filter: kind=${kindFilter}`);
  }
  lines.push(
    `  hyperedges: ${filteredEdges.length}${kindFilter ? ` (of ${totalEdgeCount} total)` : ""}`
  );
  if (kindFilter) {
    if (filteredEdges.length > 0) {
      lines.push(`    ${kindFilter}: ${filteredEdges.length}`);
    }
  } else {
    const kindCounts = new Map<string, number>();
    for (const edge of filteredEdges) {
      kindCounts.set(edge.kind, (kindCounts.get(edge.kind) ?? 0) + 1);
    }
    for (const [kind, count] of [...kindCounts.entries()].sort(([leftKind], [rightKind]) =>
      leftKind.localeCompare(rightKind)
    )) {
      lines.push(`    ${kind}: ${count}`);
    }
  }
  lines.push(`  incidences: ${totalIncidences}`);
  if (filteredEdges.length > 0) {
    const averageArity = totalIncidences / filteredEdges.length;
    lines.push(`  arity: min ${minArity}, max ${maxArity}, avg ${averageArity.toFixed(2)}`);
    if (maxArity > 2 && widestEdge) {
      lines.push(`    widest: ${widestEdge.kind} ${displaySymbol(widestEdge.name)}`);
    }
  }
  lines.push(`  isolated vertices: ${isolatedVertices.length}`);
  if (isolatedVertices.length > 0 && isolatedVertices.length <= 8) {
    lines.push(
      `    ${isolatedVertices.map((vertex) => formatVertexHeader(vertex, model)).join(", ")}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

function guardsForTarget(
  target: ShapeTarget,
  model: Model
): { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] {
  const guards: { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] = [];
  for (const rationale of model.rationales.values()) {
    if (
      targetsEqual(rationale.appliesTo ?? rationale.target, target) &&
      hasGuardAction(rationale)
    ) {
      guards.push({ kind: "rationale", info: rationale });
    }
  }
  for (const memory of model.memories.values()) {
    if (targetsEqual(memory.appliesTo ?? memory.target, target) && hasGuardAction(memory)) {
      guards.push({ kind: "memory", info: memory });
    }
  }
  return guards.sort((left, right) =>
    `${left.kind}:${left.info.name}`.localeCompare(`${right.kind}:${right.info.name}`)
  );
}

function formatRelationExplanation(relation: HyperedgeInfo, model: Model): string {
  const lines = [
    displaySymbol(relation.name),
    "  kind: relation",
    `  relation kind: ${relation.kind}`,
    `  ordered: ${relation.ordered ? "true" : "false"}`,
    "  connects:"
  ];
  for (const member of relation.members) {
    const role = member.role ? ` as ${member.role}` : "";
    lines.push(`    ${member.index}: ${displaySymbol(member.endpoint)}${role}`);
  }
  if (relation.summary) {
    lines.push("", `  summary: ${JSON.stringify(relation.summary)}`);
  }
  if (relation.fingerprintExpectations.length > 0) {
    lines.push("", "  fingerprint expectations:");
    lines.push(
      ...relation.fingerprintExpectations
        .sort((left, right) =>
          `${left.endpoint}:${left.provider}`.localeCompare(`${right.endpoint}:${right.provider}`)
        )
        .map(
          (expectation) =>
            `    ${displaySymbol(expectation.endpoint)} ${expectation.provider}(${JSON.stringify(expectation.value)})`
        )
    );
  }
  appendContextAndGuardSections({ kind: "relation", name: relation.name }, model, lines);
  return lines.join("\n");
}

function appendIncidence(vertex: string, model: Model, lines: string[]): void {
  const incident = (model.hypergraph.incidence.get(vertex) ?? [])
    .map((name) => model.hypergraph.edges.get(name))
    .filter((edge): edge is HyperedgeInfo => edge !== undefined)
    .sort(compareHyperedges);
  if (incident.length === 0) {
    return;
  }
  lines.push("", "  relations:");
  for (const edge of incident) {
    lines.push(`    ${formatHyperedgeLine(edge, 2, model)}`);
  }
}

function formatRationaleExplanation(rationale: RationaleInfo): string {
  const lines = [
    rationale.name,
    "  kind: rationale",
    `  type: ${rationale.contextType}`,
    `  target: ${formatTarget(rationale.target)}`
  ];
  appendContextExplanationFields(lines, rationale);
  return lines.join("\n");
}

function formatMemoryExplanation(memory: MemoryInfo): string {
  const lines = [
    memory.name,
    "  kind: memory",
    `  type: ${memory.contextType}`,
    `  target: ${formatTarget(memory.target)}`
  ];
  if (memory.status) {
    lines.push(`  status: ${memory.status}`);
  }
  if (memory.confidence) {
    lines.push(`  confidence: ${memory.confidence}`);
  }
  appendContextExplanationFields(lines, memory);
  return lines.join("\n");
}

function appendContextExplanationFields(lines: string[], context: ContextObjectInfo): void {
  if (context.owner) {
    lines.push(`  owner: ${context.owner}`);
  }
  if (context.reviewBy) {
    lines.push(`  review_by: ${context.reviewBy}`);
  }
  if (context.protects.length > 0) {
    lines.push("  protects:");
    lines.push(...context.protects.map((item) => `    ${protectedPropertyText(item)}`));
  }
  if (context.guards.length > 0) {
    lines.push("  guards:");
    lines.push(...context.guards.map((guard) => `    on_change require ${guard.requirement}`));
  }
}

/** Renders a protected property for listings, omitting an empty value. */
function protectedPropertyText(property: ProtectedProperty): string {
  return property.value ? `${property.kind} ${property.value}` : property.kind;
}

function formatRationaleMemoryListEntry(rationale: RationaleInfo): string[] {
  const lines = [`rationale ${displaySymbol(rationale.name)}`, `type: ${rationale.contextType}`];
  appendContextListFields(lines, rationale);
  return lines;
}

function formatMemoryListEntry(memory: MemoryInfo): string[] {
  const lines = [`memory ${displaySymbol(memory.name)}`, `type: ${memory.contextType}`];
  if (memory.status) {
    lines.push(`status: ${memory.status}`);
  }
  if (memory.confidence) {
    lines.push(`confidence: ${memory.confidence}`);
  }
  appendContextListFields(lines, memory);
  return lines;
}

function appendContextListFields(lines: string[], context: ContextObjectInfo): void {
  if (context.protects.length > 0) {
    lines.push(`protects: ${context.protects.map(protectedPropertyText).join(", ")}`);
  }
  if (context.owner) {
    lines.push(`owner: ${context.owner}`);
  }
  if (context.reviewBy) {
    lines.push(`review_by: ${context.reviewBy}`);
  }
}

function isObligationDiagnostic(diagnostic: ShapeDiagnostic): diagnostic is Extract<
  SemanticDiagnostic,
  {
    kind:
      | "missing_required_context"
      | "missing_required_description"
      | "guarded_shape_changed"
      | "invalid_reevaluation"
      | "stale_memory";
  }
> {
  return (
    diagnostic.kind === "missing_required_context" ||
    diagnostic.kind === "missing_required_description" ||
    diagnostic.kind === "guarded_shape_changed" ||
    diagnostic.kind === "invalid_reevaluation" ||
    diagnostic.kind === "stale_memory"
  );
}

function formatHyperedgeLine(edge: HyperedgeInfo, _indent: number, model: Model): string {
  const separator = edge.ordered ? " -> " : ", ";
  const labelled = edge.members.map((member) => formatHyperedgeMember(member, model));
  const set = edge.ordered ? labelled.join(separator) : `{ ${labelled.join(separator)} }`;
  const summary = edge.summary ? `  // ${edge.summary}` : "";
  return `${edge.kind} ${displaySymbol(edge.name)}: ${set}${summary}`;
}

function formatHyperedgeMember(member: HyperedgeMember, model: Model): string {
  const role = member.role ? ` as ${member.role}` : "";
  const kind = vertexKindLabel(member.endpoint, model);
  return `${displaySymbol(member.endpoint)}${kind}${role}`;
}

function vertexKindLabel(name: string, model: Model): string {
  if (model.components.has(name)) {
    return " (component)";
  }
  if (model.resources.has(name)) {
    return " (resource)";
  }
  return "";
}

function formatVertexHeader(name: string, model: Model): string {
  const kind = vertexKindLabel(name, model).trim();
  return kind ? `${displaySymbol(name)} ${kind}` : displaySymbol(name);
}
