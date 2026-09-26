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

function moveCamera(end, duration) {
  if (prefersReducedMotion.matches) {
    Object.assign(state.camera, end);
    state.focus = null;
  } else {
    state.focus = {
      start: { ...state.camera },
      end,
      startedAt: performance.now(),
      duration
    };
  }
}

function panToGround(point, speak) {
  if (!point) {
    return;
  }
  state.selectedId = null;
  closeDetailPanel();
  moveCamera(
    {
      x: point.x,
      y: state.camera.y,
      z: point.z - Math.max(110, state.camera.y * 1.75),
      yaw: fixedPerspective.yaw,
      pitch: fixedPerspective.pitch
    },
    520
  );
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
    detailRows.push(["CONNECTS", compactValues(relationEndpointIds(node.relation), 3)]);
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
    content.addEventListener("click", () => {
      pauseJourneyForManualControl();
      item.onActivate();
    });
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

function countLabel(count, noun) {
  return String(count) + " " + noun + (count === 1 ? "" : "s");
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
  const addEntry = (meta, title, copy) => entries.push({ meta, title, copy });
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
    addEntry(
      "SOURCE ANCHOR",
      sourceRefLabel(node.source),
      "Source path modeled for this function."
    );
  }
  if (node.effects?.length) {
    addEntry(
      "MODELED EFFECTS",
      compactValues(
        node.effects.map((effect) => {
          return effect.target ? effect.name + " <" + effect.target + ">" : effect.name;
        }),
        3
      ),
      countLabel(node.effects.length, "effect") + " declared by Shape."
    );
  } else if (node.type === "function" && !node.effectsComplete) {
    addEntry(
      "EFFECTS UNKNOWN",
      "Shape does not claim a complete effect set.",
      "Unknown is not the same as an authored empty effect set."
    );
  }
  if (node.requires?.length) {
    addEntry(
      "FUNCTION REQUIREMENTS",
      compactValues(node.requires.map(termLabel), 3),
      "Requirements declared on this function."
    );
  }
  if (node.shapeTraits?.length) {
    addEntry(
      "FUNCTION TRAITS",
      compactValues(node.shapeTraits, 4),
      "Shape traits declared on this function."
    );
  }
  if (node.traits?.length) {
    addEntry("RESOURCE TRAITS", compactValues(node.traits, 4), "Traits declared on this resource.");
  }
  if (node.fingerprints?.length) {
    addEntry(
      "RESOURCE FINGERPRINTS",
      compactValues(
        node.fingerprints.map((item) => item.provider + ":" + item.value),
        3
      ),
      "Fingerprint expectations declared on this resource."
    );
  }
  if (node.classifiers?.length) {
    addEntry(
      "COMPONENT CLASSIFIERS",
      compactValues(node.classifiers, 4),
      "Classifiers declared on this component."
    );
  }
  if (node.grants?.length) {
    addEntry(
      "COMPONENT GRANTS",
      compactValues(node.grants.map(termLabel), 3),
      "Effect grants declared on this component."
    );
  }
  if (node.relation) {
    addEntry(
      "RELATION CONTRACT",
      node.relation.kind + ": " + compactValues(relationEndpointIds(node.relation), 3),
      node.relation.summary || "Authored connection between the two endpoints."
    );
  }
  if (node.paths?.length) {
    addEntry(
      "GOVERNED PATHS",
      compactValues(node.paths, 2),
      countLabel(node.paths.length, "path") + " covered by this implementation."
    );
  }
  if (node.onChangeRequirement) {
    addEntry(
      "ON CHANGE",
      node.onChangeRequirement,
      "Required response when a governed implementation path changes."
    );
  }
  if (node.binding) {
    const watched = node.binding.whenChanged;
    const required = node.binding.requireChanged;
    addEntry(
      "CHANGE BINDING",
      compactValues(watched.concat(required), 2) ||
        compactValues(node.binding.allowAttestations, 2) ||
        "Modeled change binding",
      String(watched.length) + " watched and " + countLabel(required.length, "required path") + "."
    );
  }
  if (node.rule) {
    const clauses = ruleClauseLabels(node.rule);
    addEntry(
      "ARCHITECTURE RULE",
      compactValues(clauses, 3) || "Rule with no lowered clauses",
      countLabel(clauses.length, "deterministic rule clause") + "."
    );
  }
  if (node.type === "module") {
    if (node.imports.length) {
      addEntry(
        "MODULE IMPORTS",
        compactValues(node.imports, 4),
        countLabel(node.imports.length, "imported Shape module") + "."
      );
    }
  }
  if (entries.length === 0) {
    addEntry(
      "MODEL SOURCE",
      node.file,
      "No extra memory or structured evidence is modeled for this tile."
    );
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

function journeyFrameFor(step, destination) {
  const frameNodes = [step.fromNodeId, step.relationNodeId, step.nodeId]
    .map((id) => (id ? nodeById.get(id) : null))
    .filter(Boolean);
  if (frameNodes.length <= 1) {
    return focusFrameFor(destination);
  }

  const bounds = frameNodes.reduce(
    (result, node) => {
      const style = styles[node.type];
      return {
        minX: Math.min(result.minX, node.x - style.width / 2 - 10),
        maxX: Math.max(result.maxX, node.x + style.width / 2 + 10),
        minZ: Math.min(result.minZ, node.z - style.depth / 2 - 10),
        maxZ: Math.max(result.maxZ, node.z + style.depth / 2 + 10),
        targetHeight: Math.max(result.targetHeight, 2.55 + style.height)
      };
    },
    {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
      targetHeight: 0
    }
  );
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const cameraHeight = clamp(Math.max(58, spanX * 0.22, spanZ * 0.2), 58, maximumCameraHeight);
  const focal = Math.max(1, Math.min(state.width, state.height) / (2 * Math.tan(state.fov / 2)));
  const panelWidth = navigatorPanel.getBoundingClientRect().width || 308;
  const usableWidth = Math.max(state.width * 0.5, state.width - panelWidth - 32);
  const usableHalfWidth = Math.max(80, usableWidth / 2 - 28);
  const requiredDepth = ((spanX / 2) * focal) / usableHalfWidth;
  const pitchCos = Math.cos(fixedPerspective.pitch);
  const pitchSin = Math.sin(fixedPerspective.pitch);
  const verticalDelta = bounds.targetHeight - cameraHeight;
  const widthDistance =
    Math.abs(pitchCos) > 0.0001
      ? (requiredDepth - verticalDelta * pitchSin) / pitchCos
      : requiredDepth;
  const distance = Math.max(104, spanZ * 1.45, widthDistance);
  const cameraDepth = verticalDelta * pitchSin + distance * pitchCos;
  const panelShift = Math.min(panelWidth / 2 + 16, state.width * 0.22);

  return {
    x: centreX + (panelShift * cameraDepth) / focal,
    y: cameraHeight,
    z: centreZ - distance,
    yaw: fixedPerspective.yaw,
    pitch: fixedPerspective.pitch
  };
}

function focusJourneyStep(step) {
  const destination = nodeById.get(step.nodeId);
  if (!destination) {
    return false;
  }
  selectNode(destination, false);
  moveCamera(journeyFrameFor(step, destination), 820);
  scheduleRender();
  return true;
}

function focusNode(node, speak) {
  selectNode(node, speak);
  moveCamera(focusFrameFor(node), 820);
  scheduleRender();
}

function resetOverview(speak) {
  state.selectedId = null;
  state.hoverId = null;
  closeDetailPanel();
  moveCamera({ ...initialCamera }, 780);
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
      pauseJourneyForManualControl();
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

export {
  focusJourneyStep,
  groundPointFromPointer,
  nodeUnderPointer,
  panToGround,
  renderResults,
  resetOverview
};
