const INFERRED_RELATION_KINDS = new Set(["calls", "callbacks"]);
const MAX_INFERRED_STEPS = 8;

export function buildJourneys(model, nodes) {
  const authored = (items) => items.filter((item) => item.origin !== "generated_ast");
  const nodeByModelId = new Map(
    nodes.filter((node) => node.modelId).map((node) => [node.modelId, node])
  );
  const relations = authored(model.relations).slice().sort(compareById);
  const authoredJourneys = relations
    .filter(
      (relation) =>
        relation.kind === "coordinated_call" &&
        relation.ordered === true &&
        orderedEndpoints(relation).length >= 2
    )
    .map((relation) => coordinatedJourney(relation, nodeByModelId));
  const inferredJourneys = inferDependencyJourneys(model, relations, nodeByModelId);

  return [...authoredJourneys, ...inferredJourneys];
}

function coordinatedJourney(relation, nodeByModelId) {
  const journeyId = `journey:authored:${relation.id}`;
  const endpoints = orderedEndpoints(relation);
  const steps = endpoints.map((endpoint, index) => {
    const node = requireNode(nodeByModelId, endpoint.id, relation.id);
    const previous =
      index > 0 ? requireNode(nodeByModelId, endpoints[index - 1].id, relation.id) : null;
    return {
      id: `${journeyId}:step:${index + 1}`,
      nodeId: node.id,
      modelId: node.modelId,
      fromNodeId: previous?.id ?? null,
      relationNodeId: index > 0 ? requireRelationNode(nodeByModelId, relation.id).id : null,
      relationKind: index > 0 ? relation.kind : null,
      relationSummary: index > 0 ? (relation.summary ?? null) : null,
      role: endpoint.role ?? null,
      narration: coordinatedNarration(relation, node, previous, endpoint.role)
    };
  });

  return {
    id: journeyId,
    title: humanize(relation.name),
    summary:
      sentence(relation.summary) ||
      "An ordered architecture journey declared with an authored coordinated call relation.",
    kind: "authored",
    relationId: relation.id,
    startNodeId: steps[0].nodeId,
    steps
  };
}

function inferDependencyJourneys(model, relations, nodeByModelId) {
  const links = relations
    .filter((relation) => INFERRED_RELATION_KINDS.has(relation.kind))
    .map((relation) => {
      const endpoints = orderedEndpoints(relation);
      if (endpoints.length !== 2) {
        return null;
      }
      return {
        relation,
        from: endpoints[0].id,
        to: endpoints[1].id
      };
    })
    .filter(Boolean);
  const outgoing = new Map();
  const incoming = new Set();
  for (const link of links) {
    const candidates = outgoing.get(link.from) ?? [];
    candidates.push(link);
    outgoing.set(link.from, candidates);
    incoming.add(link.to);
  }
  for (const candidates of outgoing.values()) {
    candidates.sort((left, right) => compareCodepoints(left.relation.id, right.relation.id));
  }

  const starts = new Set([...outgoing.keys()].filter((modelId) => !incoming.has(modelId)));

  const journeys = [];
  for (const start of [...starts].sort(compareCodepoints)) {
    for (const seed of outgoing.get(start) ?? []) {
      const journey = inferredJourney(seed, outgoing, nodeByModelId);
      if (journey.steps.length >= 2) {
        journeys.push(journey);
      }
    }
  }
  return journeys.sort((left, right) => compareCodepoints(left.id, right.id));
}

function inferredJourney(seed, outgoing, nodeByModelId) {
  const journeyId = `journey:inferred:${seed.relation.id}`;
  const links = [seed];
  const visited = new Set([seed.from]);
  let current = seed.to;
  if (visited.has(current)) {
    return inferredJourneyRecord(journeyId, seed, [], nodeByModelId);
  }
  visited.add(current);

  while (links.length + 1 < MAX_INFERRED_STEPS) {
    const next = (outgoing.get(current) ?? []).find((candidate) => !visited.has(candidate.to));
    if (!next) {
      break;
    }
    links.push(next);
    current = next.to;
    visited.add(current);
  }

  return inferredJourneyRecord(journeyId, seed, links, nodeByModelId);
}

function inferredJourneyRecord(journeyId, seed, links, nodeByModelId) {
  if (links.length === 0) {
    return {
      id: journeyId,
      title: humanize(seed.relation.summary || seed.relation.name),
      summary: "Inferred dependency topology from authored calls and callbacks, not runtime order.",
      kind: "inferred",
      relationId: seed.relation.id,
      startNodeId: requireNode(nodeByModelId, seed.from, seed.relation.id).id,
      steps: []
    };
  }
  const start = requireNode(nodeByModelId, seed.from, seed.relation.id);
  const steps = [
    {
      id: `${journeyId}:step:1`,
      nodeId: start.id,
      modelId: start.modelId,
      fromNodeId: null,
      relationNodeId: null,
      relationKind: null,
      relationSummary: null,
      role: null,
      narration:
        `Start at ${start.label}. This inferred dependency tour begins with the authored ` +
        `${seed.relation.kind} relation ${seed.relation.name}. ` +
        "It shows dependency topology, not verified runtime order."
    }
  ];
  for (const [index, link] of links.entries()) {
    const from = requireNode(nodeByModelId, link.from, link.relation.id);
    const to = requireNode(nodeByModelId, link.to, link.relation.id);
    steps.push({
      id: `${journeyId}:step:${index + 2}`,
      nodeId: to.id,
      modelId: to.modelId,
      fromNodeId: from.id,
      relationNodeId: requireRelationNode(nodeByModelId, link.relation.id).id,
      relationKind: link.relation.kind,
      relationSummary: link.relation.summary ?? null,
      role: orderedEndpoints(link.relation)[1]?.role ?? null,
      narration:
        `Next, follow the authored ${link.relation.kind} relation ${link.relation.name} ` +
        `from ${from.label} to ${to.label}. ` +
        (relationSummaryText(link.relation) || "") +
        "This step describes dependency topology, not verified runtime order."
    });
  }

  return {
    id: journeyId,
    title: humanize(seed.relation.summary || seed.relation.name),
    summary: "Inferred dependency topology from authored calls and callbacks, not runtime order.",
    kind: "inferred",
    relationId: seed.relation.id,
    startNodeId: start.id,
    steps
  };
}

function coordinatedNarration(relation, node, previous, role) {
  if (!previous) {
    return (
      `Start at ${node.label}. Shape authors ${relation.name} as an ordered architecture journey. ` +
      relationSummaryText(relation) +
      "This is an authored claim, not a verified runtime trace."
    );
  }
  const roleText = role ? ` in the ${role} role` : "";
  return (
    `Next, move from ${previous.label} to ${node.label}${roleText}. ` +
    `The authored ${relation.name} coordinated call places ${node.label} after ${previous.label}. ` +
    relationSummaryText(relation) +
    "This is an authored claim, not a verified runtime trace."
  );
}

function orderedEndpoints(relation) {
  if (relation.endpoints.length === 0) {
    return [
      { id: relation.from, index: 0 },
      { id: relation.to, index: 1 }
    ];
  }
  return relation.endpoints
    .slice()
    .sort((left, right) => left.index - right.index || compareCodepoints(left.id, right.id));
}

function requireNode(nodeByModelId, modelId, relationId) {
  const node = nodeByModelId.get(modelId);
  if (!node || node.type === "relation") {
    throw new Error(
      `${relationId}.endpoints references unavailable authored declaration ${modelId}`
    );
  }
  return node;
}

function requireRelationNode(nodeByModelId, relationId) {
  const node = nodeByModelId.get(relationId);
  if (!node || node.type !== "relation") {
    throw new Error(`journey references unavailable authored relation ${relationId}`);
  }
  return node;
}

function humanize(value) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function sentence(value) {
  const text = value?.trim();
  if (!text) {
    return "";
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function relationSummaryText(relation) {
  const summary = sentence(relation.summary);
  return summary ? `${summary} ` : "";
}

function compareById(left, right) {
  return compareCodepoints(left.id, right.id);
}

function compareCodepoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
