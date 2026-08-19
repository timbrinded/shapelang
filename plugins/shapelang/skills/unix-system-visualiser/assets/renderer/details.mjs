function pointInPolygon(point, polygonPoints) {
  let inside = false;
  for (
    let index = 0, previous = polygonPoints.length - 1;
    index < polygonPoints.length;
    previous = index, index += 1
  ) {
    const current = polygonPoints[index];
    const prior = polygonPoints[previous];
    const intersects =
      current.y > point.y !== prior.y > point.y &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function nodeUnderPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  let faceCandidate = null;
  let toleranceCandidate = null;
  state.projected.forEach((item) => {
    const withinFace = item.hitAreas.some((area) => pointInPolygon(point, area));
    if (withinFace) {
      if (!faceCandidate || item.paintOrder > faceCandidate.paintOrder) {
        faceCandidate = item;
      }
      return;
    }
    const tolerance = clamp(item.radius * 0.24, 3, 9);
    const closeToCentre = Math.hypot(point.x - item.point.x, point.y - item.point.y) < tolerance;
    if (closeToCentre && (!toleranceCandidate || item.paintOrder > toleranceCandidate.paintOrder)) {
      toleranceCandidate = item;
    }
  });
  return (faceCandidate || toleranceCandidate)?.node || null;
}

function groundPointFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const focal = Math.min(state.width, state.height) / (2 * Math.tan(state.fov / 2));
  const viewX = (event.clientX - rect.left - state.width / 2) / focal;
  const viewY = -(event.clientY - rect.top - state.height / 2) / focal;
  const viewZ = 1;
  const yawCos = Math.cos(fixedPerspective.yaw);
  const yawSin = Math.sin(fixedPerspective.yaw);
  const pitchCos = Math.cos(fixedPerspective.pitch);
  const pitchSin = Math.sin(fixedPerspective.pitch);
  const worldY = viewY * pitchCos + viewZ * pitchSin;
  const yawZ = -viewY * pitchSin + viewZ * pitchCos;
  if (worldY >= -0.0001) {
    return null;
  }
  const distance = -state.camera.y / worldY;
  if (distance <= 0 || distance > 10000) {
    return null;
  }
  return {
    x: state.camera.x + (viewX * yawCos + yawZ * yawSin) * distance,
    z: state.camera.z + (-viewX * yawSin + yawZ * yawCos) * distance
  };
}

function panToGround(point, speak) {
  if (!point) {
    return;
  }
  state.selectedId = null;
  closeDetailPanel();
  const end = {
    x: point.x,
    y: state.camera.y,
    z: point.z - Math.max(110, state.camera.y * 1.75),
    yaw: fixedPerspective.yaw,
    pitch: fixedPerspective.pitch
  };
  if (prefersReducedMotion.matches) {
    Object.assign(state.camera, end);
    state.focus = null;
  } else {
    state.focus = {
      start: { ...state.camera },
      end,
      startedAt: performance.now(),
      duration: 520
    };
  }
  selectionKind.textContent = "PLANE PAN";
  selectionTitle.textContent = "MOVING ACROSS MAP";
  selectionSummary.textContent =
    "The map stays at a fixed perspective while the view moves across the ground plane.";
  setDetails([
    ["OBJECTS", String(nodes.length) + " raised tiles"],
    ["PATHS", String(edges.length) + " modeled"],
    ["FILES", String(atlas.stats.documents) + " Shape files"],
    ["FLIGHT", "PANNING"]
  ]);
  if (speak) {
    announce("Panning across the fixed Shape plane.");
  }
}

function formatDetails(node) {
  const directLinks = neighbours.get(node.id)?.size || 0;
  const detailRows = [
    ["TYPE", typeNames[node.type].toUpperCase()],
    ["MODULE", node.module],
    ["FILE", node.file],
    ["NEIGHBORS", String(directLinks) + " direct tiles"]
  ];
  if (node.traits?.length) {
    detailRows.push(["TRAITS", node.traits.join(", ")]);
  } else if (node.effects?.length) {
    detailRows.push(["EFFECTS", node.effects.map((effect) => effect.name).join(", ")]);
  } else if (node.relation) {
    const endpointNames = relationEndpointIds(node.relation);
    detailRows.push([
      "CONNECTS",
      endpointNames.length
        ? compactValues(endpointNames, 3)
        : (node.relation.from || "?") + " to " + (node.relation.to || "?")
    ]);
  } else if (node.type === "function" && !node.effectsComplete) {
    detailRows.push(["EFFECTS", "UNKNOWN"]);
  } else if (node.paths?.length) {
    detailRows.push(["GOVERNED", String(node.paths.length) + " paths"]);
  }
  return detailRows.slice(0, 5);
}

function setDetails(rows) {
  details.replaceChildren();
  rows.forEach(([term, description]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    details.append(dt, dd);
  });
}

function edgeLabel(edge, node) {
  const startsHere = edge.from === node.id;
  if (edge.kind === "contains") {
    return startsHere ? "CONTAINS" : "CONTAINED BY";
  }
  if (edge.kind === "relation") {
    return startsHere ? "RELATES TO" : "RELATION ENDPOINT";
  }
  if (edge.kind === "conforms") {
    return startsHere ? "CONFORMS TO" : "CONFORMANCE";
  }
  if (edge.kind === "import") {
    return startsHere ? "IMPORTS" : "IMPORTED BY";
  }
  return edge.kind.toUpperCase();
}

function appendDetailItem(list, item) {
  const row = document.createElement("li");
  const content = item.onActivate
    ? document.createElement("button")
    : document.createElement("div");
  const meta = document.createElement("span");
  const title = document.createElement("span");
  const copy = document.createElement("span");
  row.className = "detail-item" + (item.memory ? " memory" : "");
  if (item.onActivate) {
    content.className = "detail-link";
    content.type = "button";
    content.setAttribute("aria-label", "Focus " + item.title + " via " + item.meta.toLowerCase());
    content.addEventListener("click", item.onActivate);
  }
  meta.className = "detail-meta";
  title.className = "detail-title";
  copy.className = "detail-copy";
  meta.textContent = item.meta;
  title.textContent = item.title;
  content.append(meta, title);
  if (item.copy) {
    copy.textContent = item.copy;
    content.append(copy);
  }
  row.append(content);
  list.append(row);
}

function renderRelationshipDetails(node) {
  const linked = edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => ({
      edge,
      other: nodeById.get(edge.from === node.id ? edge.to : edge.from)
    }))
    .filter((item) => item.other)
    .sort(
      (left, right) =>
        compareCodepoints(edgeLabel(left.edge, node), edgeLabel(right.edge, node)) ||
        compareCodepoints(left.other.label, right.other.label)
    );
  relationshipList.replaceChildren();
  relationshipCount.textContent = String(linked.length) + " TOTAL";
  if (linked.length === 0) {
    appendDetailItem(relationshipList, {
      meta: "NO DIRECT LINKS",
      title: "This tile has no modeled neighbor.",
      copy: "The item remains positioned in its authored Shape module."
    });
    return;
  }
  linked.slice(0, 10).forEach(({ edge, other }) => {
    appendDetailItem(relationshipList, {
      meta: edgeLabel(edge, node) + " / " + typeNames[other.type].toUpperCase(),
      title: other.label,
      copy: other.description,
      onActivate: () => focusNode(other, true)
    });
  });
  if (linked.length > 10) {
    appendDetailItem(relationshipList, {
      meta: "MORE LINKS",
      title: String(linked.length - 10) + " additional modeled connections",
      copy: "Use the locate field to focus another tile."
    });
  }
}

function compactValues(values, maximum) {
  if (values.length <= maximum) {
    return values.join(", ");
  }
  return values.slice(0, maximum).join(", ") + " +" + String(values.length - maximum) + " more";
}

function sourceRefLabel(source) {
  return source.language + "(" + source.path + ")";
}

function termLabel(term) {
  return term.target ? term.name + "<" + term.target + ">" : term.name;
}

function relationEndpointIds(relation) {
  return relation.endpoints.length > 0
    ? relation.endpoints.map((endpoint) => endpoint.id)
    : [relation.from, relation.to];
}

function ruleClauseLabels(rule) {
  const clauses = [];
  rule.whenHas.forEach((item) => clauses.push("when " + item.subject + " has " + item.trait));
  if (rule.finalForbidSubject) {
    clauses.push("final forbid " + rule.finalForbidSubject);
  }
  rule.forbidEffects.forEach((item) =>
    clauses.push(
      (item.final ? "final " : "") +
        "forbid " +
        item.effect +
        (item.target ? "<" + item.target + ">" : "")
    )
  );
  rule.forbidProvides.forEach((item) =>
    clauses.push("forbid provides " + item.target + (item.except ? " except " + item.except : ""))
  );
  rule.forbidHypercycles.forEach((item) =>
    clauses.push("forbid hypercycle over " + item.kinds.join(" or "))
  );
  rule.forbidPaths.forEach((item) =>
    clauses.push(
      "forbid path " + item.source + " to " + item.target + " over " + item.kinds.join(" or ")
    )
  );
  return clauses;
}

function evidenceEntries(node) {
  const entries = [];
  node.memories.forEach((memory) => {
    const confidence = memory.confidence ? " / " + String(memory.confidence).toUpperCase() : "";
    const guardCount = memory.guards.length;
    const evidenceCount = memory.evidence.length;
    entries.push({
      meta: "MEMORY / " + (memory.status || "MODELED").toUpperCase() + confidence,
      title: memory.name,
      copy:
        memory.summary ||
        String(guardCount) + " guards and " + String(evidenceCount) + " evidence entries.",
      memory: true
    });
  });
  if (node.source) {
    entries.push({
      meta: "SOURCE ANCHOR",
      title: sourceRefLabel(node.source),
      copy: "Source path modeled for this function."
    });
  }
  if (node.effects?.length) {
    entries.push({
      meta: "MODELED EFFECTS",
      title: compactValues(
        node.effects.map((effect) => {
          return effect.target ? effect.name + " <" + effect.target + ">" : effect.name;
        }),
        3
      ),
      copy:
        String(node.effects.length) +
        " effect" +
        (node.effects.length === 1 ? "" : "s") +
        " declared by Shape."
    });
  } else if (node.type === "function" && !node.effectsComplete) {
    entries.push({
      meta: "EFFECTS UNKNOWN",
      title: "Shape does not claim a complete effect set.",
      copy: "Unknown is not the same as an authored empty effect set."
    });
  }
  if (node.requires?.length) {
    entries.push({
      meta: "FUNCTION REQUIREMENTS",
      title: compactValues(node.requires.map(termLabel), 3),
      copy: "Requirements declared on this function."
    });
  }
  if (node.shapeTraits?.length) {
    entries.push({
      meta: "FUNCTION TRAITS",
      title: compactValues(node.shapeTraits, 4),
      copy: "Shape traits declared on this function."
    });
  }
  if (node.traits?.length) {
    entries.push({
      meta: "RESOURCE TRAITS",
      title: compactValues(node.traits, 4),
      copy: "Traits declared on this resource."
    });
  }
  if (node.fingerprints?.length) {
    entries.push({
      meta: "RESOURCE FINGERPRINTS",
      title: compactValues(
        node.fingerprints.map((item) => item.provider + ":" + item.value),
        3
      ),
      copy: "Fingerprint expectations declared on this resource."
    });
  }
  if (node.classifiers?.length) {
    entries.push({
      meta: "COMPONENT CLASSIFIERS",
      title: compactValues(node.classifiers, 4),
      copy: "Classifiers declared on this component."
    });
  }
  if (node.grants?.length) {
    entries.push({
      meta: "COMPONENT GRANTS",
      title: compactValues(node.grants.map(termLabel), 3),
      copy: "Effect grants declared on this component."
    });
  }
  if (node.relation) {
    const endpointNames = relationEndpointIds(node.relation);
    entries.push({
      meta: "RELATION CONTRACT",
      title:
        node.relation.kind +
        ": " +
        (endpointNames.length
          ? compactValues(endpointNames, 3)
          : (node.relation.from || "?") + " to " + (node.relation.to || "?")),
      copy: node.relation.summary || "Authored connection between the two endpoints."
    });
  }
  if (node.paths?.length) {
    entries.push({
      meta: "GOVERNED PATHS",
      title: compactValues(node.paths, 2),
      copy:
        String(node.paths.length) +
        " path" +
        (node.paths.length === 1 ? "" : "s") +
        " covered by this implementation."
    });
  }
  if (node.onChangeRequirement) {
    entries.push({
      meta: "ON CHANGE",
      title: node.onChangeRequirement,
      copy: "Required response when a governed implementation path changes."
    });
  }
  if (node.binding) {
    const watched = node.binding.whenChanged;
    const required = node.binding.requireChanged;
    entries.push({
      meta: "CHANGE BINDING",
      title:
        compactValues(watched.concat(required), 2) ||
        compactValues(node.binding.allowAttestations, 2) ||
        "Modeled change binding",
      copy:
        String(watched.length) +
        " watched and " +
        String(required.length) +
        " required path" +
        (required.length === 1 ? "" : "s") +
        "."
    });
  }
  if (node.rule) {
    const clauses = ruleClauseLabels(node.rule);
    entries.push({
      meta: "ARCHITECTURE RULE",
      title: compactValues(clauses, 3) || "Rule with no lowered clauses",
      copy:
        String(clauses.length) +
        " deterministic rule clause" +
        (clauses.length === 1 ? "" : "s") +
        "."
    });
  }
  if (node.type === "module") {
    if (node.imports.length) {
      entries.push({
        meta: "MODULE IMPORTS",
        title: compactValues(node.imports, 4),
        copy:
          String(node.imports.length) +
          " imported Shape module" +
          (node.imports.length === 1 ? "" : "s") +
          "."
      });
    }
  }
  if (entries.length === 0) {
    entries.push({
      meta: "MODEL SOURCE",
      title: node.file,
      copy: "No extra memory or structured evidence is modeled for this tile."
    });
  }
  return entries;
}

function renderEvidenceDetails(node) {
  const entries = evidenceEntries(node);
  evidenceList.replaceChildren();
  evidenceCount.textContent = String(entries.length) + " ITEMS";
  entries.slice(0, 8).forEach((entry) => appendDetailItem(evidenceList, entry));
}

function closeDetailPanel() {
  navigatorPanel.classList.remove("is-open");
  relationshipCount.textContent = "";
  evidenceCount.textContent = "";
  relationshipList.replaceChildren();
  evidenceList.replaceChildren();
}

function announce(message) {
  flightStatus.textContent = "";
  window.setTimeout(() => {
    flightStatus.textContent = message;
  }, 20);
}

function selectNode(node, speak) {
  state.selectedId = node.id;
  navigatorPanel.classList.add("is-open");
  selectionKind.textContent = typeNames[node.type].toUpperCase() + " / FOCUSED TILE";
  selectionTitle.textContent = node.label;
  selectionSummary.textContent = node.description;
  setDetails(formatDetails(node));
  renderRelationshipDetails(node);
  renderEvidenceDetails(node);
  if (speak) {
    announce(
      node.label +
        " selected. " +
        (neighbours.get(node.id)?.size || 0) +
        " directly connected tiles are available."
    );
  }
}

function focusFrameFor(node) {
  const style = styles[node.type];
  const targetHeight = 2.55 + style.height * 0.72;
  const cameraHeight = clamp(47 + style.height * 0.36, 47, 52);
  const focal = Math.max(1, Math.min(state.width, state.height) / (2 * Math.tan(state.fov / 2)));
  const compactViewport = state.width <= 740;
  const foregroundLine = state.height * (compactViewport ? 0.5 : 0.64);
  const screenRatio = (state.height / 2 - foregroundLine) / focal;
  const pitchCos = Math.cos(fixedPerspective.pitch);
  const pitchSin = Math.sin(fixedPerspective.pitch);
  const verticalDelta = targetHeight - cameraHeight;
  const denominator = -pitchSin - screenRatio * pitchCos;
  const distance =
    Math.abs(denominator) > 0.0001
      ? (verticalDelta * (screenRatio * pitchSin - pitchCos)) / denominator
      : 96;
  return {
    x: node.x,
    y: cameraHeight,
    z: node.z - clamp(Number.isFinite(distance) ? distance : 96, 74, compactViewport ? 180 : 150),
    yaw: fixedPerspective.yaw,
    pitch: fixedPerspective.pitch
  };
}

function focusNode(node, speak) {
  selectNode(node, speak);
  const end = focusFrameFor(node);
  if (prefersReducedMotion.matches) {
    Object.assign(state.camera, end);
    state.focus = null;
  } else {
    state.focus = {
      start: { ...state.camera },
      end,
      startedAt: performance.now(),
      duration: 820
    };
  }
  scheduleRender();
}

function resetOverview(speak) {
  state.selectedId = null;
  state.hoverId = null;
  closeDetailPanel();
  if (prefersReducedMotion.matches) {
    Object.assign(state.camera, initialCamera);
    state.focus = null;
  } else {
    state.focus = {
      start: { ...state.camera },
      end: { ...initialCamera },
      startedAt: performance.now(),
      duration: 780
    };
  }
  selectionKind.textContent = "PLANE OVERVIEW";
  selectionTitle.textContent = "START HERE";
  selectionSummary.textContent =
    "Fly over the blue module pads, or select a tile to bring its local paths into view.";
  setDetails([
    ["OBJECTS", String(nodes.length) + " raised tiles"],
    ["PATHS", String(edges.length) + " modeled"],
    ["FILES", String(atlas.stats.documents) + " Shape files"],
    ["FLIGHT", "FREE"]
  ]);
  if (speak) {
    announce("Returned to the complete Shape plane.");
  }
  scheduleRender();
}

function renderResults(query) {
  results.replaceChildren();
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  const matches = nodes
    .filter((node) => {
      const haystack = node.label + " " + node.type + " " + node.module + " " + node.file;
      return haystack.toLowerCase().includes(normalized);
    })
    .sort((left, right) => {
      const leftStarts = left.label.toLowerCase().startsWith(normalized) ? -1 : 0;
      const rightStarts = right.label.toLowerCase().startsWith(normalized) ? -1 : 0;
      return leftStarts - rightStarts || compareCodepoints(left.label, right.label);
    })
    .slice(0, 6);
  matches.forEach((node) => {
    const button = document.createElement("button");
    const kind = document.createElement("span");
    const name = document.createElement("span");
    button.className = "result";
    button.type = "button";
    kind.className = "result-kind";
    name.className = "result-name";
    kind.textContent = node.type;
    name.textContent = node.label;
    button.append(kind, name);
    button.addEventListener("click", () => {
      focusNode(node, true);
      locator.value = "";
      results.replaceChildren();
      canvas.focus();
    });
    results.append(button);
  });
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "result-kind";
    empty.textContent = "NO MATCHING TILES";
    results.append(empty);
  }
}

export { groundPointFromPointer, nodeUnderPointer, panToGround, renderResults, resetOverview };
