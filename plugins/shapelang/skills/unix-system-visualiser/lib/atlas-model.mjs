const COLLECTIONS = [
  ["resource", "resources"],
  ["component", "components"],
  ["function", "functions"],
  ["relation", "relations"],
  ["implementation", "implementations"],
  ["binding", "bindings"],
  ["rule", "rules"]
];

export function buildAtlasModel(model) {
  assertInspectionSchema(model);

  const authored = (items) => items.filter((item) => item.origin !== "generated_ast");
  const documents = authored(model.documents);
  if (documents.length === 0) {
    throw new Error("Shape inspection contains no authored documents");
  }

  const declarations = new Map();
  for (const [type, collection] of COLLECTIONS) {
    for (const declaration of authored(model[collection])) {
      if (declarations.has(declaration.id)) {
        throw new Error(`Shape inspection contains duplicate declaration id ${declaration.id}`);
      }
      declarations.set(declaration.id, { declaration, type });
    }
  }

  const moduleGroups = groupDocumentsByModule(documents);
  const modules = new Set(moduleGroups.map((group) => group.name));
  const nodes = [];
  const nodeById = new Map();
  const nodeIdByDeclarationId = new Map();
  const edges = [];
  const edgeKeys = new Set();

  const addNode = (node) => {
    if (nodeById.has(node.id)) {
      throw new Error(`Atlas model contains duplicate node id ${node.id}`);
    }
    const completeNode = { ...node, childIds: [], memories: [] };
    nodes.push(completeNode);
    nodeById.set(completeNode.id, completeNode);
    if (completeNode.modelId) {
      nodeIdByDeclarationId.set(completeNode.modelId, completeNode.id);
    }
    return completeNode;
  };

  const requireDeclarationNode = (reference, context, expectedType) => {
    const entry = declarations.get(reference);
    if (!entry) {
      throw new Error(`${context} references unavailable authored declaration ${reference}`);
    }
    if (expectedType && entry.type !== expectedType) {
      throw new Error(`${context} references ${entry.type} ${reference}; expected ${expectedType}`);
    }
    const id = nodeIdByDeclarationId.get(reference);
    if (!id) {
      throw new Error(`${context} references declaration ${reference} before it is available`);
    }
    return nodeById.get(id);
  };

  const addEdge = (from, to, kind) => {
    if (from === to) {
      return;
    }
    if (!nodeById.has(from) || !nodeById.has(to)) {
      throw new Error(`Atlas ${kind} edge references an unavailable node: ${from} -> ${to}`);
    }
    const key = `${kind}\u0000${from}\u0000${to}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ from, to, kind });
    }
  };

  const districts = moduleGroups.map((group, documentIndex) => {
    const fileLabel = group.files.join(", ");
    const node = addNode({
      id: moduleId(group.name),
      modelId: group.name,
      shapeName: group.name,
      type: "module",
      label: group.name,
      file: fileLabel,
      files: group.files,
      imports: group.imports,
      module: group.name,
      documentIndex,
      description:
        "Shape module defined in " +
        String(group.files.length) +
        (group.files.length === 1 ? " file: " : " files: ") +
        fileLabel +
        "."
    });
    return {
      id: node.id,
      module: group.name,
      file: fileLabel,
      files: group.files,
      label: group.name,
      nodeId: node.id,
      entityIds: []
    };
  });

  for (const component of authored(model.components)) {
    addNode({
      id: declarationNodeId("component", component.id),
      modelId: component.id,
      shapeName: component.name,
      type: "component",
      label: component.name,
      file: component.file,
      module: component.module,
      parentId: moduleId(component.module),
      classifiers: component.classifiers,
      grants: component.grants,
      description:
        "Component with " +
        component.owns.length +
        " owned resources and " +
        component.functions.length +
        " modeled functions."
    });
  }

  const resourceOwners = new Map();
  for (const component of authored(model.components)) {
    const componentNode = requireDeclarationNode(component.id, `${component.id}`, "component");
    for (const resourceId of component.owns) {
      const resource = declarations.get(resourceId);
      if (!resource || resource.type !== "resource") {
        throw new Error(`${component.id}.owns references unavailable resource ${resourceId}`);
      }
      const previousOwner = resourceOwners.get(resourceId);
      if (previousOwner && previousOwner !== componentNode.id) {
        throw new Error(`${resourceId} is owned by more than one component`);
      }
      resourceOwners.set(resourceId, componentNode.id);
    }
  }

  for (const resource of authored(model.resources)) {
    addNode({
      id: declarationNodeId("resource", resource.id),
      modelId: resource.id,
      shapeName: resource.name,
      type: "resource",
      label: resource.name,
      file: resource.file,
      module: resource.module,
      parentId: resourceOwners.get(resource.id) ?? moduleId(resource.module),
      traits: resource.traits,
      fingerprints: resource.fingerprints,
      description: resource.traits.length
        ? "Resource traits: " + resource.traits.join(", ") + "."
        : "Resource declared in " + resource.file + "."
    });
  }

  for (const fn of authored(model.functions)) {
    const component = requireDeclarationNode(fn.component, `${fn.id}.component`, "component");
    addNode({
      id: declarationNodeId("function", fn.id),
      modelId: fn.id,
      shapeName: fn.name,
      type: "function",
      label: fn.name,
      file: fn.file,
      module: fn.module,
      parentId: component.id,
      effects: fn.effects,
      effectsComplete: fn.effectsComplete,
      requires: fn.requires,
      shapeTraits: fn.shapeTraits,
      source: fn.source,
      description: fn.effects.length
        ? "Function with " + fn.effects.length + " modeled effects."
        : fn.effectsComplete
          ? "Function with a complete empty effect set."
          : "Function effects are unknown."
    });
  }

  for (const component of authored(model.components)) {
    const componentNode = requireDeclarationNode(component.id, component.id, "component");
    for (const functionId of component.functions) {
      const functionNode = requireDeclarationNode(
        functionId,
        `${component.id}.functions`,
        "function"
      );
      if (functionNode.parentId !== componentNode.id) {
        throw new Error(`${functionId} does not belong to component ${component.id}`);
      }
    }
  }

  for (const implementation of authored(model.implementations)) {
    const target = implementation.conformsTo
      ? requireDeclarationNode(implementation.conformsTo, `${implementation.id}.conformsTo`)
      : undefined;
    addNode({
      id: declarationNodeId("implementation", implementation.id),
      modelId: implementation.id,
      shapeName: implementation.name,
      type: "implementation",
      label: implementation.name,
      file: implementation.file,
      module: implementation.module,
      parentId: target?.id ?? moduleId(implementation.module),
      conformsTo: implementation.conformsTo,
      paths: implementation.paths,
      onChangeRequirement: implementation.onChangeRequirement,
      description: implementation.conformsTo
        ? "Implementation conformance for " + implementation.conformsTo + "."
        : "Implementation without a conformance target."
    });
  }

  for (const binding of authored(model.bindings)) {
    addNode({
      id: declarationNodeId("binding", binding.id),
      modelId: binding.id,
      shapeName: binding.name,
      type: "binding",
      label: binding.name,
      file: binding.file,
      module: binding.module,
      parentId: moduleId(binding.module),
      binding,
      description:
        "Change binding with " +
        binding.whenChanged.length +
        " watched paths and " +
        binding.requireChanged.length +
        " required paths."
    });
  }

  for (const rule of authored(model.rules)) {
    const clauseCount =
      rule.whenHas.length +
      rule.forbidEffects.length +
      rule.forbidProvides.length +
      rule.forbidHypercycles.length +
      rule.forbidPaths.length +
      (rule.finalForbidSubject ? 1 : 0);
    addNode({
      id: declarationNodeId("rule", rule.id),
      modelId: rule.id,
      shapeName: rule.name,
      type: "rule",
      label: rule.name,
      file: rule.file,
      module: rule.module,
      parentId: moduleId(rule.module),
      rule,
      description: "Architecture rule with " + clauseCount + " modeled clauses."
    });
  }

  for (const relation of authored(model.relations)) {
    const endpointIds = relationEndpointIds(relation);
    const endpoints = endpointIds.map((endpointId) =>
      requireDeclarationNode(endpointId, `${relation.id}.endpoints`)
    );
    const from = endpoints[0];
    addNode({
      id: declarationNodeId("relation", relation.id),
      modelId: relation.id,
      shapeName: relation.name,
      type: "relation",
      label: relation.name,
      file: relation.file,
      module: relation.module,
      parentId: from.parentId ?? from.id,
      relation,
      description:
        relation.summary || relation.kind + " relation with " + endpointIds.length + " endpoints."
    });
  }

  for (const memory of authored(model.memories)) {
    const target = requireDeclarationNode(memory.target.id, `${memory.id}.target`);
    target.memories.push(memory);
  }

  for (const node of nodes) {
    if (!modules.has(node.module)) {
      throw new Error(
        `${node.modelId ?? node.id} references unavailable authored module ${node.module}`
      );
    }
    if (node.parentId) {
      const parent = nodeById.get(node.parentId);
      if (!parent) {
        throw new Error(
          `${node.modelId ?? node.id} references unavailable parent ${node.parentId}`
        );
      }
      parent.childIds.push(node.id);
      addEdge(parent.id, node.id, "contains");
    }
  }

  for (const relation of authored(model.relations)) {
    const relationNode = requireDeclarationNode(relation.id, `${relation.id}`, "relation");
    for (const endpointId of relationEndpointIds(relation)) {
      const endpoint = requireDeclarationNode(endpointId, `${relation.id}.endpoints`);
      addEdge(relationNode.id, endpoint.id, "relation");
    }
  }

  for (const implementation of authored(model.implementations)) {
    if (!implementation.conformsTo) {
      continue;
    }
    const implementationNode = requireDeclarationNode(
      implementation.id,
      `${implementation.id}`,
      "implementation"
    );
    const target = requireDeclarationNode(
      implementation.conformsTo,
      `${implementation.id}.conformsTo`
    );
    addEdge(implementationNode.id, target.id, "conforms");
  }

  for (const group of moduleGroups) {
    for (const importedModule of group.imports) {
      if (modules.has(importedModule)) {
        addEdge(moduleId(group.name), moduleId(importedModule), "import");
      }
    }
  }

  const districtByModule = new Map(districts.map((district) => [district.module, district]));
  for (const node of nodes) {
    districtByModule.get(node.module).entityIds.push(node.id);
  }

  return {
    schemaVersion: model.schemaVersion,
    shapeVersion: model.shapeVersion,
    stats: authoredStats(model, documents, moduleGroups),
    nodes,
    districts,
    edges
  };
}

function assertInspectionSchema(model) {
  if (!model || model.schemaVersion !== 1) {
    throw new Error(`unsupported Shape inspection schema: ${String(model?.schemaVersion)}`);
  }
  const collections = ["documents", "memories", ...COLLECTIONS.map(([, name]) => name)];
  const missingCollection = collections.find((name) => !Array.isArray(model[name]));
  if (missingCollection) {
    throw new Error(`Shape inspection is missing the ${missingCollection} collection`);
  }
}

function authoredStats(model, documents, moduleGroups) {
  const authored = (items) => items.filter((item) => item.origin !== "generated_ast");
  const functions = authored(model.functions);
  return {
    documents: documents.length,
    modules: moduleGroups.length,
    resources: authored(model.resources).length,
    components: authored(model.components).length,
    functions: functions.length,
    effects: functions.reduce((count, fn) => count + fn.effects.length, 0),
    relations: authored(model.relations).length,
    implementations: authored(model.implementations).length,
    bindings: authored(model.bindings).length,
    rules: authored(model.rules).length,
    memories: authored(model.memories).length
  };
}

function groupDocumentsByModule(documents) {
  const groups = new Map();
  for (const document of documents) {
    const group = groups.get(document.module) ?? {
      id: moduleId(document.module),
      name: document.module,
      files: new Set(),
      imports: new Set()
    };
    group.files.add(document.file);
    for (const importedModule of document.imports) {
      group.imports.add(importedModule);
    }
    groups.set(document.module, group);
  }
  return [...groups.values()]
    .map((group) => ({
      id: group.id,
      name: group.name,
      files: [...group.files].sort(compareCodepoints),
      imports: [...group.imports].sort(compareCodepoints)
    }))
    .sort((left, right) => compareCodepoints(left.name, right.name));
}

function relationEndpointIds(relation) {
  return relation.endpoints.length > 0
    ? relation.endpoints.map((endpoint) => endpoint.id)
    : [relation.from, relation.to];
}

function declarationNodeId(type, id) {
  return `${type}:${id}`;
}

function moduleId(moduleName) {
  return `module:${moduleName}`;
}

function compareCodepoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
