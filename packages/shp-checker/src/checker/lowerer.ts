// Lowering orchestrator: the deterministic two-pass pipeline that turns parsed
// modules into the effective Model. Pass 1 indexes declarations and lowers
// regular declarations; pass 2 applies change declarations; then shape-update
// paths are rebuilt and derived facts emitted. Domain-specific lowerers live in
// checker/lowering/*, which this module drives but never the reverse.
import type { ShapeModule } from "../language/generated/ast.ts";
import {
  isAttestationDecl,
  isBindingDecl,
  isCandidateEffectDecl,
  isChangeDecl,
  isComponentDecl,
  isImplementationDecl,
  isMemoryDecl,
  isPolicyDecl,
  isRationaleDecl,
  isReevaluationDecl,
  isRelationDecl,
  isResourceDecl,
  isRoleDecl,
  isRuleDecl,
  isTraitDecl
} from "../language/generated/ast.ts";
import type { CheckModuleInput, LoweringContext, Model } from "./model.ts";
import { preludeTraitSeed } from "./prelude-seed.ts";
import { emptyDeclarationIndex, indexModuleDeclarations, moduleContext } from "./symbols.ts";
import { collectShapeUpdatePathsFromFunction, emitDerivedFacts } from "./lowering/facts.ts";
import {
  lowerAttestation,
  lowerBinding,
  lowerCandidateEffect,
  lowerComponent,
  lowerImplementation,
  lowerResource,
  lowerRule,
  lowerTrait
} from "./lowering/declarations.ts";
import { lowerRelation } from "./lowering/relations.ts";
import {
  lowerMemory,
  lowerPolicy,
  lowerRationale,
  lowerReevaluation,
  lowerRole
} from "./lowering/context.ts";
import { lowerChange } from "./lowering/changes.ts";

export function lowerShapeModules(modules: ShapeModule[] | CheckModuleInput[]): Model {
  const inputs = normalizeModuleInputs(modules);
  const model: Model = {
    modules: new Map(),
    declarations: emptyDeclarationIndex(),
    resources: new Map(),
    traits: preludeTraitSeed(),
    components: new Map(),
    hypergraph: {
      edges: new Map(),
      incidence: new Map()
    },
    candidateEffects: new Map(),
    implementations: [],
    bindings: new Map(),
    rules: [],
    rationales: new Map(),
    memories: new Map(),
    reevaluations: new Map(),
    roles: new Map(),
    policies: new Map(),
    attestations: [],
    shapeUpdatePaths: new Map(),
    changeEvents: [],
    facts: [],
    diagnostics: []
  };

  const contexts = new Map<CheckModuleInput, LoweringContext>();
  for (const input of inputs) {
    const context = moduleContext(input);
    contexts.set(input, context);
    model.modules.set(context.name, context);
    indexModuleDeclarations(input.module, context, model);
  }

  for (const input of inputs) {
    const context = contexts.get(input) ?? moduleContext(input);
    for (const declaration of input.module.declarations) {
      if (isResourceDecl(declaration)) {
        lowerResource(declaration, context, model);
      } else if (isTraitDecl(declaration)) {
        lowerTrait(declaration, context, model);
      } else if (isComponentDecl(declaration)) {
        lowerComponent(declaration, context, model);
      } else if (isRelationDecl(declaration)) {
        lowerRelation(declaration, context, model);
      } else if (isCandidateEffectDecl(declaration)) {
        lowerCandidateEffect(declaration, context, model);
      } else if (isImplementationDecl(declaration)) {
        lowerImplementation(declaration, context, model);
      } else if (isBindingDecl(declaration)) {
        lowerBinding(declaration, context, model);
      } else if (isAttestationDecl(declaration)) {
        lowerAttestation(declaration, context, model);
      } else if (isRuleDecl(declaration)) {
        lowerRule(declaration, context, model);
      } else if (isRationaleDecl(declaration)) {
        lowerRationale(declaration, context, model);
      } else if (isMemoryDecl(declaration)) {
        lowerMemory(declaration, context, model);
      } else if (isReevaluationDecl(declaration)) {
        lowerReevaluation(declaration, context, model);
      } else if (isRoleDecl(declaration)) {
        lowerRole(declaration, context, model);
      } else if (isPolicyDecl(declaration)) {
        lowerPolicy(declaration, context, model);
      }
    }
  }

  for (const input of inputs) {
    const context = contexts.get(input) ?? moduleContext(input);
    for (const declaration of input.module.declarations) {
      if (isChangeDecl(declaration)) {
        lowerChange(declaration, context, model);
      }
    }
  }

  rebuildShapeUpdatePaths(model);
  emitDerivedFacts(model);
  return model;
}

function rebuildShapeUpdatePaths(model: Model): void {
  model.shapeUpdatePaths = new Map();
  model.facts = model.facts.filter((fact) => fact.kind !== "shape_update_for");

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      collectShapeUpdatePathsFromFunction(fn, model);
    }
  }
}

function normalizeModuleInputs(modules: ShapeModule[] | CheckModuleInput[]): CheckModuleInput[] {
  return modules.map((input) => {
    if ("module" in input) {
      return input;
    }
    return { module: input };
  });
}
