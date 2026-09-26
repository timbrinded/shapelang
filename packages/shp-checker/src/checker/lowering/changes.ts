import * as ast from "../../language/generated/ast.ts";
import type { ComponentInfo, LoweringContext, Model, Provenance, ShapeTarget } from "../model.ts";
import { functionTarget, splitFunctionTarget, splitQualifiedName } from "../display.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import { declarationKinds, resolveDeclName, resolveFunctionTargetName } from "../symbols.ts";
import {
  changeEventsForTransition,
  commitPlannedChange,
  snapshotChangeTarget,
  stageModelForChange,
  type ChangeTargetSnapshot,
  type ChangeTransition,
  type PlannedChange
} from "../change-planning.ts";
import { lowerFunction } from "./declarations.ts";
import { lowerDeclaration } from "./dispatch.ts";
import { emitFunctionFacts, removeFunctionFacts } from "./facts.ts";

export function lowerChange(change: ast.ChangeDecl, context: LoweringContext, model: Model): void {
  commitPlannedChange(model, planChange(change, context, model));
}

export function planChange(
  change: ast.ChangeDecl,
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
  change: ast.ChangeDecl,
  entry: ast.ChangeDecl["entries"][number],
  context: LoweringContext,
  model: Model
): ChangeTransition | undefined {
  if (
    ast.isAddFunctionChange(entry) ||
    ast.isModifyFunctionChange(entry) ||
    ast.isRemoveFunctionChange(entry)
  ) {
    return applyFunctionChangeEntry(change, entry, context, model);
  } else if (ast.isAddDeclarationChange(entry)) {
    lowerDeclaration(entry.declaration, context, model);
  } else if (ast.isModifyDeclarationChange(entry)) {
    const kind = declarationKinds[entry.declaration.$type];
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
  } else if (ast.isRemoveDeclarationChange(entry)) {
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

function changesRelation(entry: ast.ChangeDecl["entries"][number]): boolean {
  if (ast.isAddDeclarationChange(entry) || ast.isModifyDeclarationChange(entry)) {
    return ast.isRelationDecl(entry.declaration);
  }
  return ast.isRemoveDeclarationChange(entry) && entry.kind === "relation";
}

function applyFunctionChangeEntry(
  change: ast.ChangeDecl,
  entry: ast.AddFunctionChange | ast.ModifyFunctionChange | ast.RemoveFunctionChange,
  context: LoweringContext,
  model: Model
): ChangeTransition | undefined {
  const [componentName, functionName] = splitFunctionTarget(
    resolveFunctionTargetName(entry.target, context, model)
  );
  if (!componentName || !functionName) {
    const operation = ast.isRemoveFunctionChange(entry) ? "remove fn" : entry.$type;
    model.diagnostics.push({
      kind: "unknown_name",
      nameKind: "component",
      name: entry.target,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(
          provenance(context.filePath, `change ${change.name} ${operation} ${entry.target}`)
        )
      ]
    });
    return undefined;
  }
  const component = stageComponentForFunctionChange(model, componentName);
  const removing = ast.isRemoveFunctionChange(entry);
  if (!component && !removing) {
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
  if (removing) {
    removeFunctionFacts(model, componentName, functionName);
    component?.functions.delete(functionName);
  } else if (component) {
    const fn = lowerFunction(entry, componentName, context, model, `change ${change.name}`);
    removeFunctionFacts(model, componentName, functionName);
    component.functions.set(fn.name, fn);
    emitFunctionFacts(fn, model);
  }
  return ast.isAddFunctionChange(entry)
    ? undefined
    : transitionAfter(
        target,
        before,
        ast.isModifyFunctionChange(entry) ? (entry.transforms?.labels ?? []) : [],
        provenance(
          context.filePath,
          `change ${change.name} ${removing ? "remove" : "modify"} fn ${componentName}.${functionName}`
        ),
        model
      );
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
  kind: ast.RemoveDeclarationChange["kind"],
  resolvedName: string
): ShapeTarget | undefined {
  if (kind === "component" || kind === "resource" || kind === "relation") {
    return { kind, name: resolvedName };
  }
  return undefined;
}

export function contextForDeclarationChange(
  kind: ast.RemoveDeclarationChange["kind"],
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

export function removeDeclaration(
  kind: ast.RemoveDeclarationChange["kind"],
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
    model.hypergraph.edges.delete(resolvedName);
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

export function declarationName(
  declaration: ast.AddDeclarationChange["declaration"] | ast.ModifyDeclarationChange["declaration"]
): string {
  if (ast.isAttestationDecl(declaration)) {
    return declaration.kind;
  }
  return declaration.name;
}
