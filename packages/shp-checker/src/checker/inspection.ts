import { compareCodepointStrings } from "../shape-strings.ts";
import { splitQualifiedName } from "./display.ts";
import { lowerShapeModules } from "./lowerer.ts";
import type {
  CheckModuleInput,
  CheckModuleOrigin,
  Model,
  Provenance,
  SourceRefInfo
} from "./model.ts";
import { moduleOriginForShapeFile } from "./symbols.ts";

export const SHAPE_INSPECTION_SCHEMA_VERSION = 1 as const;

// DTO types follow the explicit projections below, never the internal model.
export type ShapeInspection = ReturnType<typeof inspectShapeModules>;
export type ShapeInspectionSourceRef = ReturnType<typeof sourceRef>;
export type ShapeInspectionResource = ShapeInspection["resources"][number];
export type ShapeInspectionComponent = ShapeInspection["components"][number];
export type ShapeInspectionFunction = ShapeInspection["functions"][number];
export type ShapeInspectionRelation = ShapeInspection["relations"][number];
export type ShapeInspectionImplementation = ShapeInspection["implementations"][number];
export type ShapeInspectionBinding = ShapeInspection["bindings"][number];
export type ShapeInspectionRule = ShapeInspection["rules"][number];
export type ShapeInspectionMemory = ShapeInspection["memories"][number];
export type ShapeInspectionStats = ShapeInspection["stats"];

export type ShapeInspectionDocument = {
  file: string;
  module: string;
  imports: string[];
  origin: CheckModuleOrigin;
};

export type InspectShapeModulesOptions = {
  shapeVersion: string;
  repoRoot?: string;
};

type DeclarationIdentity = {
  id: string;
  name: string;
  module: string;
  file: string;
  origin: CheckModuleOrigin;
};

type InspectionContext = {
  model: Model;
  originByFile: ReadonlyMap<string, CheckModuleOrigin>;
  // Null marks a module whose declarations come from both origins.
  originsByModule: ReadonlyMap<string, CheckModuleOrigin | null>;
};

/**
 * Builds the stable, machine-readable view of the effective model.
 * Parsing and file discovery remain caller concerns; this adapter deliberately
 * reuses the checker's canonical lowering and reference-resolution pipeline.
 */
export function inspectShapeModules(
  modules: CheckModuleInput[],
  options: InspectShapeModulesOptions
) {
  const normalizedModules = modules.map((input) => ({
    ...input,
    origin:
      input.origin ??
      (input.filePath === undefined
        ? "authored"
        : moduleOriginForShapeFile(input.module, input.filePath, options.repoRoot ?? process.cwd()))
  }));
  const model = lowerShapeModules(normalizedModules);
  const context = inspectionContext(model, normalizedModules);
  const documents = normalizedModules
    .map(({ module, filePath, origin }) => ({
      file: filePath ?? "",
      module: module.name ?? "",
      imports: sortStrings(module.imports.map((item) => item.path)),
      origin
    }))
    .toSorted(compareDocuments);
  const resources = inspectResources(context);
  const components = inspectComponents(context);
  const functions = inspectFunctions(context);
  const relations = inspectRelations(context);
  const implementations = inspectImplementations(context);
  const bindings = inspectBindings(context);
  const rules = inspectRules(context);
  const memories = inspectMemories(context);

  return {
    schemaVersion: SHAPE_INSPECTION_SCHEMA_VERSION,
    shapeVersion: options.shapeVersion,
    documents,
    resources,
    components,
    functions,
    relations,
    implementations,
    bindings,
    rules,
    memories,
    stats: {
      documents: documents.length,
      modules: new Set(documents.map((document) => document.module)).size,
      resources: resources.length,
      components: components.length,
      functions: functions.length,
      effects: functions.reduce((count, fn) => count + fn.effects.length, 0),
      relations: relations.length,
      implementations: implementations.length,
      bindings: bindings.length,
      rules: rules.length,
      memories: memories.length
    }
  };
}

function inspectResources(context: InspectionContext) {
  return [...context.model.resources.values()]
    .map((resource) => ({
      ...identity(context, resource.name, resource.provenance),
      traits: sortStrings(resource.traits.keys()),
      fingerprints: [...resource.fingerprints.values()]
        .map(({ provider, value }) => ({ provider, value }))
        .toSorted(compareJson)
    }))
    .toSorted(compareIdentity);
}

function inspectComponents(context: InspectionContext) {
  return [...context.model.components.values()]
    .map((component) => ({
      ...identity(context, component.name, component.provenance),
      classifiers: sortStrings(component.classifiers.keys()),
      grants: [...component.grants.keys()].map(termFromKey).toSorted(compareJson),
      owns: sortStrings(component.owns.keys()),
      functions: sortStrings(
        [...component.functions.values()].map((fn) => `${component.name}.${fn.name}`)
      )
    }))
    .toSorted(compareIdentity);
}

function inspectFunctions(context: InspectionContext) {
  const functions = [];
  for (const component of context.model.components.values()) {
    for (const fn of component.functions.values()) {
      const effects =
        fn.effects.kind === "complete"
          ? fn.effects.entries
              .map((entry) => ({
                ...term(entry.term),
                ...(entry.evidence === undefined ? {} : { evidence: sourceRef(entry.evidence) })
              }))
              .toSorted(compareJson)
          : [];
      functions.push({
        ...identity(context, `${component.name}.${fn.name}`, fn.provenance, fn.name),
        component: component.name,
        ...(fn.source === undefined ? {} : { source: sourceRef(fn.source) }),
        unsafe: fn.unsafe,
        effectsComplete: fn.effects.kind === "complete",
        effects,
        requires: fn.requires.map(term).toSorted(compareJson),
        shapeTraits: sortStrings(fn.shapeTraits.keys()),
        ...(fn.description === undefined
          ? {}
          : {
              description: {
                required: fn.description.required,
                summary: fn.description.summary
              }
            })
      });
    }
  }
  return functions.toSorted(compareIdentity);
}

function inspectRelations(context: InspectionContext) {
  return [...context.model.hypergraph.edges.values()]
    .map((relation) => {
      const endpoints = relation.members
        .map((member) => ({
          id: member.endpoint,
          index: member.index,
          ...(member.role === undefined ? {} : { role: member.role })
        }))
        .toSorted((left, right) => left.index - right.index || compareJson(left, right));
      return {
        ...identity(context, relation.name, relation.provenance),
        kind: relation.kind,
        ordered: relation.ordered,
        from: endpoints.at(0)?.id ?? "",
        to: endpoints.at(-1)?.id ?? "",
        endpoints,
        fingerprintExpectations: relation.fingerprintExpectations
          .map(({ endpoint, provider, value }) => ({ endpoint, provider, value }))
          .toSorted(compareJson),
        ...(relation.summary === undefined ? {} : { summary: relation.summary })
      };
    })
    .toSorted(compareIdentity);
}

function inspectImplementations(context: InspectionContext) {
  return context.model.implementations
    .map((implementation) => ({
      ...identity(context, implementation.name, implementation.provenance),
      paths: sortStrings(implementation.paths.map(({ glob }) => glob)),
      ...(implementation.conformsTo === undefined ? {} : { conformsTo: implementation.conformsTo }),
      ...(implementation.onChangeRequirement === undefined
        ? {}
        : { onChangeRequirement: implementation.onChangeRequirement })
    }))
    .toSorted(compareIdentity);
}

function inspectBindings(context: InspectionContext) {
  return [...context.model.bindings.values()]
    .map((binding) => ({
      ...identity(context, binding.name, binding.provenance),
      whenChanged: sortStrings(binding.whenChanged.map(({ glob }) => glob)),
      requireChanged: sortStrings(binding.requireChanged.map(({ glob }) => glob)),
      allowAttestations: sortStrings(binding.allowAttestations.map(({ kind }) => kind))
    }))
    .toSorted(compareIdentity);
}

function inspectRules(context: InspectionContext) {
  return context.model.rules
    .map((rule) => ({
      ...identity(context, rule.name, rule.provenance),
      whenHas: rule.whenHas.map(({ subject, trait }) => ({ subject, trait })).toSorted(compareJson),
      ...(rule.finalForbidSubject === undefined
        ? {}
        : { finalForbidSubject: rule.finalForbidSubject }),
      forbidEffects: rule.forbidEffects
        .map(({ effect, target, targetBinding, final }) => ({
          effect,
          ...(target === undefined ? {} : { target }),
          targetBinding,
          final
        }))
        .toSorted(compareJson),
      forbidProvides: rule.forbidProvides
        .map(({ target, except: allowed }) => ({
          target,
          ...(allowed === undefined ? {} : { except: allowed })
        }))
        .toSorted(compareJson),
      forbidHypercycles: rule.forbidHypercycles
        .map(({ kinds }) => ({ kinds: sortStrings(kinds) }))
        .toSorted(compareJson),
      forbidPaths: rule.forbidPaths
        .map(({ source, target, kinds }) => ({ source, target, kinds: sortStrings(kinds) }))
        .toSorted(compareJson)
    }))
    .toSorted(compareIdentity);
}

function inspectMemories(context: InspectionContext) {
  return [...context.model.memories.values()]
    .map((memory) => ({
      ...identity(context, memory.name, memory.provenance),
      contextType: memory.contextType,
      target: { kind: memory.target.kind as string, id: memory.target.name },
      ...(memory.appliesTo === undefined
        ? {}
        : { appliesTo: { kind: memory.appliesTo.kind as string, id: memory.appliesTo.name } }),
      ...(memory.status === undefined ? {} : { status: memory.status }),
      ...(memory.confidence === undefined ? {} : { confidence: memory.confidence }),
      ...(memory.summary === undefined ? {} : { summary: memory.summary }),
      ...(memory.owner === undefined ? {} : { owner: memory.owner }),
      ...(memory.reviewBy === undefined ? {} : { reviewBy: memory.reviewBy }),
      sensitive: memory.sensitive,
      protects: memory.protects.map(({ kind, value }) => ({ kind, value })).toSorted(compareJson),
      guards: sortStrings(memory.guards.map(({ requirement }) => requirement)),
      forbiddenTransforms: sortStrings(memory.forbiddenTransforms.map(({ label }) => label)),
      observed: memory.observed.map(sourceRef).toSorted(compareJson),
      evidence: memory.evidence.map(sourceRef).toSorted(compareJson)
    }))
    .toSorted(compareIdentity);
}

function identity(
  context: InspectionContext,
  id: string,
  provenance: Provenance,
  explicitName?: string
): DeclarationIdentity {
  const split = splitQualifiedName(id);
  const module = split.moduleName ?? "";
  return {
    id,
    name: explicitName ?? split.localName,
    module,
    file: provenance.filePath ?? "",
    origin: declarationOrigin(context, module, provenance)
  };
}

function inspectionContext(model: Model, modules: CheckModuleInput[]): InspectionContext {
  const originByFile = new Map<string, CheckModuleOrigin>();
  const originsByModule = new Map<string, CheckModuleOrigin | null>();
  for (const { module, filePath, origin = "authored" } of modules) {
    if (filePath !== undefined) {
      const existing = originByFile.get(filePath);
      if (existing !== undefined && existing !== origin) {
        throw new Error(`Conflicting Shape origins for ${filePath}`);
      }
      originByFile.set(filePath, origin);
    }
    const moduleName = module.name ?? "";
    const existing = originsByModule.get(moduleName);
    originsByModule.set(moduleName, existing === undefined || existing === origin ? origin : null);
  }
  return { model, originByFile, originsByModule };
}

function declarationOrigin(
  context: InspectionContext,
  module: string,
  provenance: Provenance
): CheckModuleOrigin {
  if (provenance.filePath !== undefined) {
    const origin = context.originByFile.get(provenance.filePath);
    if (origin !== undefined) {
      return origin;
    }
  }
  const origin = context.originsByModule.get(module);
  if (origin === null) {
    throw new Error(
      `Cannot determine Shape origin for ${provenance.label} without file provenance`
    );
  }
  return origin ?? "authored";
}

function sourceRef(ref: SourceRefInfo) {
  return { language: ref.language, path: ref.path };
}

function term(value: { name: string; target?: string }): { name: string; target?: string } {
  return {
    name: value.name,
    ...(value.target === undefined ? {} : { target: value.target })
  };
}

function termFromKey(value: string): { name: string; target?: string } {
  const separator = value.indexOf("<");
  const name = separator < 0 ? value : value.slice(0, separator);
  const target = separator < 0 ? "" : value.slice(separator + 1, -1);
  return target.length === 0 ? { name } : { name, target };
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].toSorted(compareCodepointStrings);
}

function compareDocuments(left: ShapeInspectionDocument, right: ShapeInspectionDocument): number {
  return (
    compareCodepointStrings(left.file, right.file) ||
    compareCodepointStrings(left.module, right.module) ||
    compareJson(left.imports, right.imports)
  );
}

function compareIdentity(left: DeclarationIdentity, right: DeclarationIdentity): number {
  return (
    compareCodepointStrings(left.id, right.id) || compareCodepointStrings(left.file, right.file)
  );
}

function compareJson(left: unknown, right: unknown): number {
  return compareCodepointStrings(JSON.stringify(left), JSON.stringify(right));
}
