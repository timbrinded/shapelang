// Lowering orchestrator: the deterministic two-pass pipeline that turns parsed
// modules into the effective Model. Declarations from every module are indexed
// before any lowering. Pass 1 then lowers regular declarations, and pass 2
// applies change declarations. Finally, shape-update paths are rebuilt and
// derived facts emitted. Domain-specific lowerers live in checker/lowering/*;
// this module drives them, and they never import it.
import type { ShapeModule } from "../language/generated/ast.ts";
import { createModel, type CheckModuleInput, type LoweringContext, type Model } from "./model.ts";
import { attestationFreeText } from "./attestation-text.ts";
import { preludeTraitSeed } from "./prelude-seed.ts";
import { emptyDeclarationIndex, indexModuleDeclarations, moduleContext } from "./symbols.ts";
import { collectShapeUpdatePathsFromFunction, emitDerivedFacts } from "./lowering/facts.ts";
import { lowerDeclaration } from "./lowering/dispatch.ts";
import { lowerChange } from "./lowering/changes.ts";

export function lowerShapeModules(modules: ShapeModule[] | CheckModuleInput[]): Model {
  const inputs = normalizeModuleInputs(modules);
  const model = createModel(emptyDeclarationIndex(), preludeTraitSeed());

  const contexts = new Map<CheckModuleInput, LoweringContext>();
  for (const input of inputs) {
    const context = moduleContext(input);
    contexts.set(input, context);
    model.modules.set(context.name, context);
    const text = attestationFreeText(input.module);
    if (input.filePath !== undefined && text !== undefined) {
      model.attestationFreeTexts.set(input.filePath, text);
    }
    indexModuleDeclarations(input.module, context, model);
  }

  for (const input of inputs) {
    const context = contexts.get(input) ?? moduleContext(input);
    for (const declaration of input.module.declarations) {
      if (declaration.$type !== "ChangeDecl") {
        lowerDeclaration(declaration, context, model);
      }
    }
  }

  for (const input of inputs) {
    const context = contexts.get(input) ?? moduleContext(input);
    for (const declaration of input.module.declarations) {
      if (declaration.$type === "ChangeDecl") {
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
