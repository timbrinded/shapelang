import type { ChangeEvent, Model, Provenance, ShapeTarget } from "./model.ts";
import { splitFunctionTarget } from "./display.ts";
import { hasNonEmptyDescription } from "./derivations.ts";

export type ChangeTargetSnapshot = {
  shapeTraits: ReadonlySet<string>;
  hasDescription: boolean;
};

export type ChangeTransition = {
  target: ShapeTarget;
  before: ChangeTargetSnapshot;
  after: ChangeTargetSnapshot;
  transforms: readonly string[];
  provenance: Provenance;
};

export type PlannedChange = {
  stagedModel: Model;
  events: ChangeEvent[];
};

export type ChangeStagingOptions = {
  copyHypergraph: boolean;
};

/**
 * Create a copy-on-write model for one change declaration. Every top-level
 * container that an addable declaration lowerer mutates is copied here;
 * relation state is copied only when the change contains relation entries, and
 * existing component function maps are copied at their mutation point. The
 * caller's effective model therefore remains untouched until the complete plan
 * is committed without cloning unrelated read-only model state.
 */
export function stageModelForChange(model: Model, options: ChangeStagingOptions): Model {
  return {
    ...model,
    resources: new Map(model.resources),
    traits: new Map(model.traits),
    components: new Map(model.components),
    hypergraph: options.copyHypergraph
      ? {
          edges: new Map(model.hypergraph.edges),
          incidence: new Map(
            [...model.hypergraph.incidence].map(([name, edges]) => [name, [...edges]])
          )
        }
      : model.hypergraph,
    implementations: [...model.implementations],
    bindings: new Map(model.bindings),
    rules: [...model.rules],
    attestations: [...model.attestations],
    changeEvents: [...model.changeEvents],
    facts: [...model.facts],
    diagnostics: [...model.diagnostics]
  };
}

/** Capture the guard-relevant state of a resolved target. */
export function snapshotChangeTarget(model: Model, target: ShapeTarget): ChangeTargetSnapshot {
  if (target.kind === "fn") {
    const [componentName, functionName] = splitFunctionTarget(target.name);
    const fn =
      componentName && functionName
        ? model.components.get(componentName)?.functions.get(functionName)
        : undefined;
    return {
      shapeTraits: new Set(fn?.shapeTraits.keys()),
      hasDescription: fn ? hasNonEmptyDescription(fn) : false
    };
  }
  if (target.kind === "component") {
    return {
      shapeTraits: new Set(model.components.get(target.name)?.classifiers.keys()),
      hasDescription: false
    };
  }
  if (target.kind === "resource") {
    return {
      shapeTraits: new Set(model.resources.get(target.name)?.traits.keys()),
      hasDescription: false
    };
  }
  return {
    shapeTraits: new Set(),
    hasDescription: false
  };
}

/**
 * Normalize one before/after target transition into the event vocabulary read
 * by Memory Guard checking. Ordering matches the prior lowering behavior:
 * coarse target, removed traits, removed description, then transforms.
 */
export function changeEventsForTransition(transition: ChangeTransition): ChangeEvent[] {
  const events: ChangeEvent[] = [
    {
      kind: "target_changed",
      target: transition.target,
      provenance: transition.provenance
    }
  ];
  for (const trait of transition.before.shapeTraits) {
    if (!transition.after.shapeTraits.has(trait)) {
      events.push({
        kind: "shape_trait_removed",
        target: transition.target,
        trait,
        provenance: transition.provenance
      });
    }
  }
  if (transition.before.hasDescription && !transition.after.hasDescription) {
    events.push({
      kind: "description_removed",
      target: transition.target,
      provenance: transition.provenance
    });
  }
  for (const label of transition.transforms) {
    events.push({
      kind: "transform_applied",
      target: transition.target,
      label,
      provenance: transition.provenance
    });
  }
  return events;
}

/** Publish a complete plan through the existing Model object identity. */
export function commitPlannedChange(model: Model, plan: PlannedChange): void {
  plan.stagedModel.changeEvents.push(...plan.events);
  Object.assign(model, plan.stagedModel);
}
