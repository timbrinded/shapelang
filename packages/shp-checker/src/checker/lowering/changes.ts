import type {
  AddDeclarationChange,
  AddFunctionChange,
  ChangeDecl,
  ModifyDeclarationChange,
  ModifyFunctionChange,
  RemoveDeclarationChange,
  RemoveFunctionChange
} from "../../language/generated/ast.ts";
import {
  isAddDeclarationChange,
  isAddFunctionChange,
  isAttestationDecl,
  isBindingDecl,
  isComponentDecl,
  isImplementationDecl,
  isModifyDeclarationChange,
  isModifyFunctionChange,
  isRelationDecl,
  isRemoveDeclarationChange,
  isRemoveFunctionChange,
  isResourceDecl,
  isRuleDecl,
  isTraitDecl
} from "../../language/generated/ast.ts";
import type { ComponentInfo, LoweringContext, Model, Provenance, ShapeTarget } from "../model.ts";
import { functionTarget, splitFunctionTarget, splitQualifiedName } from "../display.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import { resolveDeclName, resolveFunctionTargetName } from "../symbols.ts";
import {
  changeEventsForTransition,
  commitPlannedChange,
  snapshotChangeTarget,
  stageModelForChange,
  type ChangeTargetSnapshot,
  type ChangeTransition,
  type PlannedChange
} from "../change-planning.ts";
import {
  lowerAttestation,
  lowerBinding,
  lowerComponent,
  lowerFunction,
  lowerImplementation,
  lowerResource,
  lowerRule,
  lowerTrait
} from "./declarations.ts";
import { emitFunctionFacts, removeFunctionFacts } from "./facts.ts";
import { lowerRelation, removeRelation } from "./relations.ts";

export function lowerChange(change: ChangeDecl, context: LoweringContext, model: Model): void {
  commitPlannedChange(model, planChange(change, context, model));
}

export function planChange(
  change: ChangeDecl,
  context: LoweringContext,
  model: Model
): PlannedChange {
  const stagedModel = stageModelForChange(model, {
    copyHypergraph: change.entries.some(changesRelation)
  });
  const transitions: ChangeTransition[] = [];
  for (const entry of change.entries) {
    const transition = applyChangeEntry(change, entry, context, stagedModel);
    if (transition) {
      transitions.push(transition);
    }
  }
  return {
    stagedModel,
    events: transitions.flatMap(changeEventsForTransition)
  };
}

function applyChangeEntry(
  change: ChangeDecl,
  entry: ChangeDecl["entries"][number],
  context: LoweringContext,
  model: Model
): ChangeTransition | undefined {
  if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
    return applyFunctionChangeEntry(change, entry, context, model);
  } else if (isRemoveFunctionChange(entry)) {
    return applyRemoveFunctionChangeEntry(change, entry, context, model);
  } else if (isAddDeclarationChange(entry)) {
    lowerDeclaration(entry.declaration, context, model);
  } else if (isModifyDeclarationChange(entry)) {
    const kind = declarationKind(entry.declaration);
    if (kind !== "attestation") {
      const localName = declarationName(entry.declaration);
      const targetContext = contextForDeclarationChange(kind, localName, context, model);
      const resolvedName = resolveDeclName(localName, kind, targetContext, model);
      const target = guardedDeclarationTarget(kind, resolvedName);
      const before = target ? snapshotChangeTarget(model, target) : undefined;
      removeDeclaration(kind, localName, targetContext, model);
      lowerDeclaration(entry.declaration, targetContext, model);
      return target && before
        ? transitionAfter(
            target,
            before,
            [],
            provenance(context.filePath, `change ${change.name} modify ${kind} ${resolvedName}`),
            model
          )
        : undefined;
    }
    lowerDeclaration(entry.declaration, context, model);
  } else if (isRemoveDeclarationChange(entry)) {
    const resolvedName = resolveDeclName(entry.name, entry.kind, context, model);
    const target = guardedDeclarationTarget(entry.kind, resolvedName);
    const before = target ? snapshotChangeTarget(model, target) : undefined;
    removeDeclaration(entry.kind, entry.name, context, model);
    return target && before
      ? transitionAfter(
          target,
          before,
          [],
          provenance(
            context.filePath,
            `change ${change.name} remove ${entry.kind} ${resolvedName}`
          ),
          model
        )
      : undefined;
  }
  return undefined;
}

function changesRelation(entry: ChangeDecl["entries"][number]): boolean {
  if (isAddDeclarationChange(entry) || isModifyDeclarationChange(entry)) {
    return isRelationDecl(entry.declaration);
  }
  return isRemoveDeclarationChange(entry) && entry.kind === "relation";
}

function applyFunctionChangeEntry(
  change: ChangeDecl,
  entry: AddFunctionChange | ModifyFunctionChange,
  context: LoweringContext,
  model: Model
): ChangeTransition | undefined {
  const [componentName, functionName] = resolveFunctionTargetParts(entry.target, context, model);
  if (!componentName || !functionName) {
    model.diagnostics.push({
      kind: "unknown_name",
      nameKind: "component",
      name: entry.target,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(
          provenance(context.filePath, `change ${change.name} ${entry.$type} ${entry.target}`)
        )
      ]
    });
    return undefined;
  }
  const component = stageComponentForFunctionChange(model, componentName);
  if (!component) {
    model.diagnostics.push({
      kind: "unknown_name",
      nameKind: "component",
      name: componentName,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(
          provenance(
            context.filePath,
            `change ${change.name} ${entry.$type} ${componentName}.${functionName}`
          )
        )
      ]
    });
    return undefined;
  }

  const target = functionTarget(componentName, functionName);
  const before = snapshotChangeTarget(model, target);
  const fn = lowerFunction(entry, componentName, context, model, `change ${change.name}`);
  removeFunctionFacts(model, componentName, functionName);
  component.functions.set(fn.name, fn);
  emitFunctionFacts(fn, model);
  return isModifyFunctionChange(entry)
    ? transitionAfter(
        target,
        before,
        entry.transforms?.labels ?? [],
        provenance(
          context.filePath,
          `change ${change.name} modify fn ${componentName}.${functionName}`
        ),
        model
      )
    : undefined;
}

function applyRemoveFunctionChangeEntry(
  change: ChangeDecl,
  entry: RemoveFunctionChange,
  context: LoweringContext,
  model: Model
): ChangeTransition | undefined {
  const [componentName, functionName] = resolveFunctionTargetParts(entry.target, context, model);
  if (!componentName || !functionName) {
    model.diagnostics.push({
      kind: "unknown_name",
      nameKind: "component",
      name: entry.target,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(
          provenance(context.filePath, `change ${change.name} remove fn ${entry.target}`)
        )
      ]
    });
    return undefined;
  }
  const target = functionTarget(componentName, functionName);
  const before = snapshotChangeTarget(model, target);
  const component = stageComponentForFunctionChange(model, componentName);
  removeFunctionFacts(model, componentName, functionName);
  component?.functions.delete(functionName);
  return transitionAfter(
    target,
    before,
    [],
    provenance(
      context.filePath,
      `change ${change.name} remove fn ${componentName}.${functionName}`
    ),
    model
  );
}

export function resolveFunctionTargetParts(
  target: string,
  context: LoweringContext,
  model: Model
): [string | undefined, string | undefined] {
  return splitFunctionTarget(resolveFunctionTargetName(target, context, model));
}

function stageComponentForFunctionChange(
  model: Model,
  componentName: string
): ComponentInfo | undefined {
  const component = model.components.get(componentName);
  if (!component) {
    return undefined;
  }
  const stagedComponent = {
    ...component,
    functions: new Map(component.functions)
  };
  model.components.set(componentName, stagedComponent);
  return stagedComponent;
}

function transitionAfter(
  target: ShapeTarget,
  before: ChangeTargetSnapshot,
  transforms: readonly string[],
  provenanceInfo: Provenance,
  model: Model
): ChangeTransition {
  return {
    target,
    before,
    after: snapshotChangeTarget(model, target),
    transforms,
    provenance: provenanceInfo
  };
}

function guardedDeclarationTarget(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string
): ShapeTarget | undefined {
  if (kind === "component" || kind === "resource" || kind === "relation") {
    return { kind, name: resolvedName };
  }
  return undefined;
}

export function contextForDeclarationChange(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  context: LoweringContext,
  model: Model
): LoweringContext {
  const resolvedName = resolveDeclName(name, kind, context, model);
  const qualified = splitQualifiedName(resolvedName);
  if (!qualified.moduleName) {
    return context;
  }
  return {
    ...context,
    name: qualified.moduleName,
    imports: model.modules.get(qualified.moduleName)?.imports ?? []
  };
}

export function lowerDeclaration(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"],
  context: LoweringContext,
  model: Model
): void {
  if (isResourceDecl(declaration)) {
    lowerResource(declaration, context, model);
  } else if (isTraitDecl(declaration)) {
    lowerTrait(declaration, context, model);
  } else if (isComponentDecl(declaration)) {
    lowerComponent(declaration, context, model);
  } else if (isRelationDecl(declaration)) {
    lowerRelation(declaration, context, model);
  } else if (isImplementationDecl(declaration)) {
    lowerImplementation(declaration, context, model);
  } else if (isBindingDecl(declaration)) {
    lowerBinding(declaration, context, model);
  } else if (isAttestationDecl(declaration)) {
    lowerAttestation(declaration, context, model);
  } else if (isRuleDecl(declaration)) {
    lowerRule(declaration, context, model);
  }
}

export function removeDeclaration(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  context: LoweringContext,
  model: Model
): void {
  const resolvedName = resolveDeclName(name, kind, context, model);
  if (kind === "resource") {
    model.resources.delete(resolvedName);
  } else if (kind === "trait") {
    // Obligations live on the trait, so deleting it drops them automatically.
    model.traits.delete(resolvedName);
  } else if (kind === "component") {
    model.components.delete(resolvedName);
  } else if (kind === "relation") {
    removeRelation(resolvedName, model);
  } else if (kind === "implementation") {
    model.implementations = model.implementations.filter(
      (implementation) => implementation.name !== resolvedName
    );
  } else if (kind === "binding") {
    model.bindings.delete(resolvedName);
  } else if (kind === "rule") {
    model.rules = model.rules.filter((rule) => rule.name !== resolvedName);
  }
}

export function declarationKind(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"]
): RemoveDeclarationChange["kind"] | "attestation" {
  if (isResourceDecl(declaration)) {
    return "resource";
  }
  if (isTraitDecl(declaration)) {
    return "trait";
  }
  if (isComponentDecl(declaration)) {
    return "component";
  }
  if (isRelationDecl(declaration)) {
    return "relation";
  }
  if (isImplementationDecl(declaration)) {
    return "implementation";
  }
  if (isBindingDecl(declaration)) {
    return "binding";
  }
  if (isAttestationDecl(declaration)) {
    return "attestation";
  }
  return "rule";
}

export function declarationName(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"]
): string {
  if (isAttestationDecl(declaration)) {
    return declaration.kind;
  }
  return declaration.name;
}
