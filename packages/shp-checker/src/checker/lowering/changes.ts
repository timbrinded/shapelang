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
import type { FunctionInfo, LoweringContext, Model, Provenance, ShapeTarget } from "../model.ts";
import { functionTarget, splitFunctionTarget, splitQualifiedName } from "../display.ts";
import { hasNonEmptyDescription } from "../derivations.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import { resolveDeclName, resolveFunctionTargetName } from "../symbols.ts";
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
  for (const entry of change.entries) {
    if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
      lowerFunctionChangeEntry(change, entry, context, model);
    } else if (isRemoveFunctionChange(entry)) {
      removeFunctionChangeEntry(change, entry, context, model);
    } else if (isAddDeclarationChange(entry)) {
      lowerDeclaration(entry.declaration, context, model);
    } else if (isModifyDeclarationChange(entry)) {
      const kind = declarationKind(entry.declaration);
      if (kind !== "attestation") {
        const localName = declarationName(entry.declaration);
        const targetContext = contextForDeclarationChange(kind, localName, context, model);
        const resolvedName = resolveDeclName(localName, kind, targetContext, model);
        const before = declarationShapeTraits(kind, resolvedName, model);
        removeDeclaration(kind, localName, targetContext, model);
        lowerDeclaration(entry.declaration, targetContext, model);
        const after = declarationShapeTraits(kind, resolvedName, model);
        emitDeclarationChange(
          kind,
          resolvedName,
          removedTraitsBetween(before, after),
          provenance(context.filePath, `change ${change.name} modify ${kind} ${resolvedName}`),
          model
        );
        continue;
      }
      lowerDeclaration(entry.declaration, context, model);
    } else if (isRemoveDeclarationChange(entry)) {
      const resolvedName = resolveDeclName(entry.name, entry.kind, context, model);
      const before = declarationShapeTraits(entry.kind, resolvedName, model);
      emitDeclarationChange(
        entry.kind,
        resolvedName,
        before ? [...before.keys()] : [],
        provenance(context.filePath, `change ${change.name} remove ${entry.kind} ${resolvedName}`),
        model
      );
      removeDeclaration(entry.kind, entry.name, context, model);
    }
  }
}

function lowerFunctionChangeEntry(
  change: ChangeDecl,
  entry: AddFunctionChange | ModifyFunctionChange,
  context: LoweringContext,
  model: Model
): void {
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
    return;
  }
  const component = model.components.get(componentName);
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
    return;
  }

  const previous = component.functions.get(functionName);
  const fn = lowerFunction(entry, componentName, context, model, `change ${change.name}`);
  if (isModifyFunctionChange(entry)) {
    const target = functionTarget(componentName, functionName);
    const changeProvenance = provenance(
      context.filePath,
      `change ${change.name} modify fn ${componentName}.${functionName}`
    );
    emitTargetChange(
      target,
      removedTraitsBetween(previous?.shapeTraits, fn.shapeTraits),
      descriptionDropped(previous, fn),
      changeProvenance,
      model
    );
    for (const label of entry.transforms?.labels ?? []) {
      model.changeEvents.push({
        kind: "transform_applied",
        target,
        label,
        provenance: changeProvenance
      });
    }
  }
  removeFunctionFacts(model, componentName, functionName);
  component.functions.set(fn.name, fn);
  emitFunctionFacts(fn, model);
}

function removeFunctionChangeEntry(
  change: ChangeDecl,
  entry: RemoveFunctionChange,
  context: LoweringContext,
  model: Model
): void {
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
    return;
  }
  const removed = model.components.get(componentName)?.functions.get(functionName);
  emitTargetChange(
    functionTarget(componentName, functionName),
    removed ? [...removed.shapeTraits.keys()] : [],
    removed ? hasNonEmptyDescription(removed) : false,
    provenance(
      context.filePath,
      `change ${change.name} remove fn ${componentName}.${functionName}`
    ),
    model
  );
  removeFunctionFacts(model, componentName, functionName);
  model.components.get(componentName)?.functions.delete(functionName);
}

export function resolveFunctionTargetParts(
  target: string,
  context: LoweringContext,
  model: Model
): [string | undefined, string | undefined] {
  return splitFunctionTarget(resolveFunctionTargetName(target, context, model));
}

/**
 * Records a change to a target: a coarse `target_changed` event plus a
 * property-level `shape_trait_removed`/`description_removed` event for each
 * dropped property, so guarded-change checking can match either granularity.
 */

export function emitTargetChange(
  target: ShapeTarget,
  removedTraits: string[],
  descriptionRemoved: boolean,
  prov: Provenance,
  model: Model
): void {
  model.changeEvents.push({ kind: "target_changed", target, provenance: prov });
  for (const trait of removedTraits) {
    model.changeEvents.push({ kind: "shape_trait_removed", target, trait, provenance: prov });
  }
  if (descriptionRemoved) {
    model.changeEvents.push({ kind: "description_removed", target, provenance: prov });
  }
}

export function emitDeclarationChange(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string,
  removedTraits: string[],
  prov: Provenance,
  model: Model
): void {
  // Only target kinds that a guard can protect emit change events. Relations
  // carry no shape traits, so they record a coarse target change only.
  if (kind !== "component" && kind !== "resource" && kind !== "relation") {
    return;
  }
  emitTargetChange({ kind, name: resolvedName }, removedTraits, false, prov, model);
}

export function declarationShapeTraits(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string,
  model: Model
): ReadonlyMap<string, Provenance> | undefined {
  if (kind === "component") {
    return model.components.get(resolvedName)?.classifiers;
  }
  if (kind === "resource") {
    return model.resources.get(resolvedName)?.traits;
  }
  return undefined;
}

export function removedTraitsBetween(
  before: ReadonlyMap<string, Provenance> | undefined,
  after: ReadonlyMap<string, Provenance> | undefined
): string[] {
  if (!before) {
    return [];
  }
  return [...before.keys()].filter((trait) => after?.has(trait) !== true);
}

export function descriptionDropped(
  previous: FunctionInfo | undefined,
  next: FunctionInfo
): boolean {
  return (
    previous !== undefined && hasNonEmptyDescription(previous) && !hasNonEmptyDescription(next)
  );
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
