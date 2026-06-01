import type { FunctionInfo, Model, Provenance } from "../model.ts";
import { functionKey } from "../display.ts";
import { requirementsForTarget, shapeTraitBearers } from "../derivations.ts";
import { normalizeShapeSourcePath } from "../../shape-strings.ts";

export function emitFunctionFacts(fn: FunctionInfo, model: Model): void {
  model.facts.push({
    kind: "function",
    component: fn.component,
    name: fn.name,
    provenance: fn.provenance
  });
  for (const [trait, traitProvenance] of fn.shapeTraits) {
    model.facts.push({
      kind: "shape_trait",
      targetKind: "fn",
      target: functionKey(fn.component, fn.name),
      trait,
      provenance: traitProvenance
    });
  }
  if (fn.description) {
    model.facts.push({
      kind: "description",
      targetKind: "fn",
      target: functionKey(fn.component, fn.name),
      required: fn.description.required,
      summary: fn.description.summary,
      provenance: fn.description.provenance
    });
  }
  if (fn.effects.kind === "unknown") {
    model.facts.push({
      kind: "effect_unknown",
      component: fn.component,
      functionName: fn.name,
      provenance: fn.provenance
    });
    return;
  }

  for (const entry of fn.effects.entries) {
    model.facts.push({
      kind: "effect",
      component: fn.component,
      functionName: fn.name,
      effect: entry.term.name,
      target: entry.term.target ?? "",
      provenance: entry.provenance
    });
  }
}

export function removeFunctionFacts(model: Model, component: string, functionName: string): void {
  const target = functionKey(component, functionName);
  model.facts = model.facts.filter((fact) => {
    if (fact.kind === "function") {
      return fact.component !== component || fact.name !== functionName;
    }
    if (fact.kind === "effect" || fact.kind === "effect_unknown") {
      return fact.component !== component || fact.functionName !== functionName;
    }
    if (
      fact.kind === "shape_trait" ||
      fact.kind === "description" ||
      fact.kind === "context_required"
    ) {
      return fact.targetKind !== "fn" || fact.target !== target;
    }
    return true;
  });
}

export function emitDerivedFacts(model: Model): void {
  for (const trait of model.traits.values()) {
    for (const forbid of trait.finalForbids) {
      model.facts.push({
        kind: "trait_final_forbid",
        trait: trait.name,
        effect: forbid.effect,
        target: forbid.target ?? "",
        provenance: forbid.provenance
      });
    }
  }

  for (const bearer of shapeTraitBearers(model)) {
    for (const requirement of requirementsForTarget(model, bearer.kind, bearer.traits)) {
      model.facts.push({
        kind: "context_required",
        targetKind: bearer.kind,
        target: bearer.target.name,
        contextType: requirement.contextType,
        requiredBy: requirement.trait,
        provenance: bearer.traits.get(requirement.trait) ?? bearer.fallback
      });
    }
  }
}

export function collectShapeUpdatePathsFromFunction(fn: FunctionInfo, model: Model): void {
  if (shouldIgnoreFunctionForCoverage(fn)) {
    return;
  }

  if (fn.source) {
    addShapeUpdatePath(model, fn.source.path, fn.provenance);
    model.facts.push({
      kind: "shape_update_for",
      path: normalizeShapeSourcePath(fn.source.path),
      provenance: fn.provenance
    });
  }

  if (fn.effects.kind === "complete") {
    for (const entry of fn.effects.entries) {
      if (entry.evidence) {
        const path = normalizeShapeSourcePath(entry.evidence.path);
        addShapeUpdatePath(model, path, entry.provenance);
        model.facts.push({ kind: "shape_update_for", path, provenance: entry.provenance });
      }
    }
  }
}

export function shouldIgnoreFunctionForCoverage(fn: FunctionInfo): boolean {
  return fn.generatedAstCandidate;
}

export function addShapeUpdatePath(model: Model, path: string, provenance: Provenance): void {
  const normalized = normalizeShapeSourcePath(path);
  const existing = model.shapeUpdatePaths.get(normalized);
  if (existing) {
    existing.push(provenance);
  } else {
    model.shapeUpdatePaths.set(normalized, [provenance]);
  }
}
