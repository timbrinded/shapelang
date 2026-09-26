// User-facing read/query output: graph, explain, obligations, and memory-guard
// listing. These commands render stable text from the effective model (built by
// lowerShapeModules) and the shared display and derivation helpers. They never
// lower declarations or evaluate rules themselves; obligation listing calls
// checkShapeModules for its diagnostics.
import type { ShapeModule } from "../language/generated/ast.ts";
import type {
  CheckModuleInput,
  ContextObjectInfo,
  HyperedgeInfo,
  HyperedgeMember,
  Model,
  ProtectedProperty,
  Provenance,
  ShapeTarget
} from "./model.ts";
import type { IsoDateString } from "./iso-date.ts";
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
  allContexts,
  deriveFinalForbidsForResource,
  hasGuardAction,
  matchingContextsForTarget,
  requirementsForTarget,
  type ContextEntry
} from "./derivations.ts";
import { lowerShapeModules } from "./lowerer.ts";
import { checkShapeModules } from "./api.ts";
import { compareKindName } from "./sort.ts";
import { targetsEqual } from "../targets.ts";

export function listMemoryGuardsShapeModules(modules: ShapeModule[] | CheckModuleInput[]): string {
  const model = lowerShapeModules(modules);
  const entries = allContexts(model)
    .map((context) => ({
      target: context.info.appliesTo ?? context.info.target,
      lines: formatContextListEntry(context)
    }))
    .sort((left, right) =>
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
  options: { freshnessDate?: IsoDateString } = {}
): string {
  const result = checkShapeModules(modules, { freshnessDate: options.freshnessDate });
  const sections: {
    [heading in
      | "missing context"
      | "missing description"
      | "guarded changes"
      | "invalid reevaluations"
      | "stale design memory"]: string[];
  } = {
    "missing context": [],
    "missing description": [],
    "guarded changes": [],
    "invalid reevaluations": [],
    "stale design memory": []
  };
  for (const diagnostic of result.diagnostics) {
    switch (diagnostic.kind) {
      case "missing_required_context":
        sections["missing context"].push(
          `${diagnostic.targetKind} ${diagnostic.target} requires ${diagnostic.requiredContext}`
        );
        break;
      case "missing_required_description":
        sections["missing description"].push(
          `${diagnostic.targetKind} ${diagnostic.target} requires description`
        );
        break;
      case "guarded_shape_changed":
        sections["guarded changes"].push(
          `${diagnostic.targetKind} ${diagnostic.target} changed; requires ${diagnostic.missingReevaluation}`
        );
        break;
      case "invalid_reevaluation":
        sections["invalid reevaluations"].push(
          `reevaluation ${diagnostic.name}: ${diagnostic.reason}`
        );
        break;
      case "stale_memory":
        sections["stale design memory"].push(
          `${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)} review_by ${diagnostic.reviewBy} is before ${diagnostic.asOf}`
        );
        break;
    }
  }
  const lines = Object.entries(sections).flatMap(([heading, entries]) =>
    entries.length > 0 ? [`${heading}:`, ...entries.map((line) => `  ${line}`), ""] : []
  );
  if (lines.length === 0) {
    return "Open Shape Obligations\n\nNo open shape obligations.\n";
  }
  return `Open Shape Obligations\n\n${lines.join("\n").trimEnd()}\n`;
}

export function explainShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  symbol: string
): string {
  const model = lowerShapeModules(modules);
  const resolved = resolveQuerySymbols(symbol, {
    resource: model.resources,
    component: model.components,
    relation: model.hypergraph.edges,
    rationale: model.rationales,
    memory: model.memories
  });
  if (typeof resolved === "string") {
    return resolved;
  }

  const resource = resolved.resource;
  if (resource) {
    const finalForbids = deriveFinalForbidsForResource(resource, model);
    const lines = [
      symbol,
      "  kind: resource",
      "  traits:",
      ...[...resource.traits.keys()].sort().map((trait) => `    ${trait}`)
    ];
    appendSection(
      lines,
      "final forbidden effects",
      finalForbids.map((forbid) => formatTerm(forbid.effect, forbid.target))
    );
    appendSection(
      lines,
      "fingerprints",
      [...resource.fingerprints.values()]
        .sort((left, right) => left.provider.localeCompare(right.provider))
        .map(formatFingerprintInfo)
    );
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
    const resolvedComponent = resolveQuerySymbols(componentName, { component: model.components });
    if (typeof resolvedComponent === "string") {
      return resolvedComponent;
    }
    const component = resolvedComponent.component;
    const fn = component?.functions.get(functionName);
    if (fn && component) {
      const lines = [`${component.name}.${functionName}`, "  kind: function"];
      if (fn.source) {
        lines.push(`  source: ${formatSourceRefInfo(fn.source)}`);
      }
      appendSection(lines, "shape traits", [...fn.shapeTraits.keys()].sort());
      if (fn.description) {
        lines.push("", "  description:");
        if (fn.description.required) {
          lines.push("    required");
        }
        lines.push(`    ${JSON.stringify(fn.description.summary)}`);
      }
      appendShapeTraitContext(
        functionTarget(component.name, functionName),
        fn.shapeTraits,
        model,
        lines
      );
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
  }

  const rationale = resolved.rationale;
  if (rationale) {
    return `${formatContextExplanation({ kind: "rationale", info: rationale })}\n`;
  }

  const memory = resolved.memory;
  if (memory) {
    return `${formatContextExplanation({ kind: "memory", info: memory })}\n`;
  }

  const component = resolved.component;
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

  const relation = resolved.relation;
  if (relation) {
    return `${formatRelationExplanation(relation, model)}\n`;
  }

  return `No shape facts found for ${symbol}.\n`;
}

/**
 * Appends the shape-trait obligation sections (required context, satisfying
 * context, and active guards) for a function, component, or resource target.
 */
function appendShapeTraitContext(
  target: ShapeTarget,
  traits: ReadonlyMap<string, Provenance>,
  model: Model,
  lines: string[]
): void {
  appendSection(
    lines,
    "required context",
    requirementsForTarget(model, target.kind, traits).map((requirement) =>
      formatContextRequirement(requirement.contextType, target)
    )
  );
  appendContextAndGuardSections(target, model, lines);
}

/**
 * Appends the "satisfied by" and "memory guards" sections for a target. Split
 * out so relation explain (which carries no shape traits and so has no required
 * context) can list its guards without a fake empty trait map.
 */
function appendContextAndGuardSections(target: ShapeTarget, model: Model, lines: string[]): void {
  appendSection(
    lines,
    "satisfied by",
    matchingContextsForTarget(target, model).map((context) => `${context.kind} ${context.name}`)
  );
  appendSection(
    lines,
    "memory guards",
    guardsForTarget(target, model).map((guard) => `${guard.kind} ${guard.info.name}`)
  );
}

function appendSection(lines: string[], heading: string, entries: string[]): void {
  if (entries.length > 0) {
    lines.push("", `  ${heading}:`);
    for (const entry of entries) {
      lines.push(`    ${entry}`);
    }
  }
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

function resolveQuerySymbols<Entries extends Record<string, { name: string }>>(
  symbol: string,
  groups: { [Kind in keyof Entries]: ReadonlyMap<string, Entries[Kind]> }
): Partial<Entries> | string {
  const resolved: Partial<Entries> = {};
  const candidates: string[] = [];
  for (const kind in groups) {
    const matches = querySymbolMatches(symbol, groups[kind]);
    if (matches.length === 1) {
      resolved[kind] = matches[0] ? groups[kind].get(matches[0]) : undefined;
    }
    for (const name of matches) {
      candidates.push(`  ${kind} ${name}`);
    }
  }
  return candidates.length < 2
    ? resolved
    : [
        `Ambiguous shape symbol ${symbol}.`,
        "Candidates:",
        ...candidates,
        "Use a module-qualified reference.\n"
      ].join("\n");
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
  const resolved = resolveQuerySymbols(symbol, {
    relation: model.hypergraph.edges,
    component: model.components,
    resource: model.resources
  });
  if (typeof resolved === "string") {
    return resolved;
  }

  const relation = resolved.relation;
  if (relation) {
    if (kindFilter && relation.kind !== kindFilter) {
      return `No relations match kind ${kindFilter} for ${symbol}.\n`;
    }
    return `${formatHyperedgeLine(relation, 0, model)}\n`;
  }
  const vertexKey = resolved.component?.name ?? resolved.resource?.name ?? symbol;
  const incident = allHyperedgesByKind(model, kindFilter)
    .filter((edge) => edge.members.some((member) => member.endpoint === vertexKey))
    .sort(compareKindName);

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
 * Dump every hyperedge in the loaded modules, or only those of `kindFilter`,
 * grouped by kind and sorted by name. Used by `shp graph` with no symbol
 * argument.
 */
export function graphAllShapeModules(
  modules: ShapeModule[] | CheckModuleInput[],
  kindFilter?: string
): string {
  const model = lowerShapeModules(modules);
  const edges = allHyperedgesByKind(model, kindFilter).sort(compareKindName);

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

function guardsForTarget(target: ShapeTarget, model: Model): ContextEntry[] {
  return allContexts(model)
    .filter(
      ({ info }) => targetsEqual(info.appliesTo ?? info.target, target) && hasGuardAction(info)
    )
    .sort((left, right) =>
      compareKindName(
        { kind: left.kind, name: left.info.name },
        { kind: right.kind, name: right.info.name }
      )
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
  appendSection(
    lines,
    "fingerprint expectations",
    relation.fingerprintExpectations
      .sort((left, right) =>
        `${left.endpoint}:${left.provider}`.localeCompare(`${right.endpoint}:${right.provider}`)
      )
      .map(
        (expectation) =>
          `${displaySymbol(expectation.endpoint)} ${expectation.provider}(${JSON.stringify(expectation.value)})`
      )
  );
  appendContextAndGuardSections({ kind: "relation", name: relation.name }, model, lines);
  return lines.join("\n");
}

function appendIncidence(vertex: string, model: Model, lines: string[]): void {
  const incident = allHyperedgesByKind(model)
    .filter((edge) => edge.members.some((member) => member.endpoint === vertex))
    .sort(compareKindName);
  appendSection(
    lines,
    "relations",
    incident.map((edge) => formatHyperedgeLine(edge, 2, model))
  );
}

function formatContextExplanation({ kind, info }: ContextEntry): string {
  const lines = [
    info.name,
    `  kind: ${kind}`,
    `  type: ${info.contextType}`,
    `  target: ${formatTarget(info.target)}`
  ];
  if (kind === "memory") {
    if (info.status) {
      lines.push(`  status: ${info.status}`);
    }
    if (info.confidence) {
      lines.push(`  confidence: ${info.confidence}`);
    }
  }
  appendContextExplanationFields(lines, info);
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

function formatContextListEntry({ kind, info }: ContextEntry): string[] {
  const lines = [`${kind} ${displaySymbol(info.name)}`, `type: ${info.contextType}`];
  if (kind === "memory") {
    if (info.status) {
      lines.push(`status: ${info.status}`);
    }
    if (info.confidence) {
      lines.push(`confidence: ${info.confidence}`);
    }
  }
  appendContextListFields(lines, info);
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
