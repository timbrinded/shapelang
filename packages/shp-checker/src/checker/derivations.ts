// Pure model-derived queries needed by more than one layer. Lowering
// (emitDerivedFacts), the rule engine (required-context / reevaluation / final-
// forbid checks), and the query commands (explain / obligations) all read these;
// keeping them here stops any of those layers from importing another's
// internals.
import type { TargetKind } from "../language/generated/ast.ts";
import type {
  ContextRequirement,
  FinalForbidPattern,
  FunctionInfo,
  GuardInfo,
  MemoryInfo,
  Model,
  Provenance,
  RationaleInfo,
  ReevaluationInfo,
  ResourceInfo,
  RuleInfo,
  ShapeTarget
} from "./model.ts";
import { KNOWN_PRELUDE_TRAITS, type ContextKind } from "../prelude.ts";
import { displaySymbol, functionTarget, splitFunctionTarget } from "./display.ts";
import { compareKindName } from "./sort.ts";
import { targetsEqual } from "../targets.ts";

export type ShapeTraitBearer = {
  kind: TargetKind;
  target: ShapeTarget;
  traits: Map<string, Provenance>;
  fallback: Provenance;
};

/**
 * Every model declaration that can carry shape traits, paired with its trait
 * map. Functions store traits in `shapeTraits`, components in `classifiers`,
 * and resources in `traits`; required-context checking treats them uniformly.
 */
export function shapeTraitBearers(model: Model): ShapeTraitBearer[] {
  const bearers: ShapeTraitBearer[] = [];
  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      bearers.push({
        kind: "fn",
        target: functionTarget(fn.component, fn.name),
        traits: fn.shapeTraits,
        fallback: fn.provenance
      });
    }
    bearers.push({
      kind: "component",
      target: { kind: "component", name: component.name },
      traits: component.classifiers,
      fallback: component.provenance
    });
  }
  for (const resource of model.resources.values()) {
    bearers.push({
      kind: "resource",
      target: { kind: "resource", name: resource.name },
      traits: resource.traits,
      fallback: resource.provenance
    });
  }
  return bearers;
}

/**
 * The context obligations that apply to a target: for each shape trait the
 * target bears (by resolved name), the owning trait's `contextRequirements`
 * that match this target kind. Built-in and user obligations live on the same
 * trait model, so a same-name user trait shadows a built-in by replacing the
 * trait entry — no merge or special-case needed here.
 */
export function requirementsForTarget(
  model: Model,
  targetKind: TargetKind,
  traits: ReadonlyMap<string, Provenance>
): ContextRequirement[] {
  const matched: ContextRequirement[] = [];
  const seen = new Set<string>();
  for (const traitName of traits.keys()) {
    const trait = model.traits.get(traitName);
    if (!trait) {
      continue;
    }
    for (const requirement of trait.contextRequirements) {
      if (requirement.targetKind !== targetKind) {
        continue;
      }
      const key = `${traitName}:${requirement.targetKind}:${requirement.contextType}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      matched.push({ trait: traitName, ...requirement });
    }
  }
  return matched;
}
export function hasNonEmptyDescription(fn: FunctionInfo): boolean {
  return fn.description !== undefined && fn.description.summary.trim().length > 0;
}

// Generated-AST candidate functions are advisory: their unknown-effects are not
// reported as defects. Used by the effects rule.
export function shouldIgnoreUnknownEffectsDiagnostic(fn: FunctionInfo): boolean {
  return fn.generatedAstCandidate;
}

export function requiresReevaluation(guard: GuardInfo): boolean {
  const normalized = guard.requirement.replace(/\s+/g, "").toLowerCase();
  return normalized === "reevaluation" || normalized === "reevaluation<self>";
}

export function hasRequiredContext(
  requirement: { contextType: string; satisfiedBy: ContextKind[] },
  target: ShapeTarget,
  model: Model
): boolean {
  if (requirement.satisfiedBy.includes("rationale")) {
    const rationale = [...model.rationales.values()].find((item) =>
      contextSatisfiesRequirement(item, requirement.contextType, target)
    );
    if (rationale) {
      return true;
    }
  }

  if (requirement.satisfiedBy.includes("memory")) {
    return [...model.memories.values()].some((item) =>
      contextSatisfiesRequirement(item, requirement.contextType, target)
    );
  }

  return false;
}

export function contextSatisfiesRequirement(
  context: RationaleInfo | MemoryInfo,
  contextType: string,
  target: ShapeTarget
): boolean {
  const effectiveTarget = context.appliesTo ?? context.target;
  return (
    context.contextType === contextType &&
    targetsEqual(effectiveTarget, target) &&
    targetsEqual(context.target, effectiveTarget)
  );
}

export function targetExists(target: ShapeTarget, model: Model): boolean {
  if (target.kind === "fn") {
    const [component, functionName] = splitFunctionTarget(target.name);
    if (!component || !functionName) {
      return false;
    }

    return model.components.get(component)?.functions.has(functionName) === true;
  }

  if (target.kind === "component") {
    return model.components.has(target.name);
  }
  if (target.kind === "resource") {
    return model.resources.has(target.name);
  }
  if (target.kind === "implementation") {
    return model.implementations.some((implementation) => implementation.name === target.name);
  }
  if (target.kind === "rule") {
    return model.rules.some((rule) => rule.name === target.name);
  }
  if (target.kind === "relation") {
    return model.hypergraph.edges.has(target.name);
  }
  return false;
}

export function reevaluationValidationReasons(
  reevaluation: ReevaluationInfo,
  model: Model
): string[] {
  const reasons: string[] = [];
  if (!reevaluation.satisfiesKind || !reevaluation.satisfiesName) {
    reasons.push("missing satisfies");
  } else if (!contextObjectExists(reevaluation.satisfiesKind, reevaluation.satisfiesName, model)) {
    reasons.push(`unknown satisfied ${reevaluation.satisfiesKind}`);
  }

  if (!reevaluation.outcome) {
    reasons.push("missing outcome");
  }
  if (!reevaluation.summary || reevaluation.summary.trim().length === 0) {
    reasons.push("missing summary");
  }
  if (reevaluation.evidence.length === 0) {
    reasons.push("missing evidence");
  }
  if (!reevaluation.reviewer) {
    reasons.push("missing reviewer");
  }
  if (!reevaluation.decidedOn) {
    reasons.push("missing decided_on");
  }
  if (approverRequiredBy(reevaluation, model) && !reevaluation.approver) {
    reasons.push("missing approver required by policy");
  }
  if (model.roles.size > 0) {
    if (reevaluation.reviewer && !model.roles.has(reevaluation.reviewer)) {
      reasons.push(`unknown reviewer role ${reevaluation.reviewer}`);
    }
    if (reevaluation.approver && !model.roles.has(reevaluation.approver)) {
      reasons.push(`unknown approver role ${reevaluation.approver}`);
    }
  }

  return reasons;
}

/**
 * True when a project policy requires an approver and the reevaluation
 * satisfies a memory marked `sensitive`. Without such a policy, approver stays
 * optional, preserving the default reviewer-only path.
 */
export function approverRequiredBy(reevaluation: ReevaluationInfo, model: Model): boolean {
  if (![...model.policies.values()].some((policy) => policy.requiresApprover)) {
    return false;
  }
  if (reevaluation.satisfiesKind !== "memory" || !reevaluation.satisfiesName) {
    return false;
  }
  return model.memories.get(reevaluation.satisfiesName)?.sensitive === true;
}

function contextObjectExists(kind: ContextKind, name: string, model: Model): boolean {
  return kind === "memory" ? model.memories.has(name) : model.rationales.has(name);
}

/**
 * A context carries an enforceable guard when it requires reevaluation or
 * forbids a transform. Both `check` (via {@link buildGuardContexts}) and
 * `explain` (via {@link guardsForTarget}) gate on this, so transform-only
 * guards stay visible in explain output instead of being silently dropped.
 */
export function hasGuardAction(info: RationaleInfo | MemoryInfo): boolean {
  return info.guards.some(requiresReevaluation) || info.forbiddenTransforms.length > 0;
}

export function hasValidReevaluationForGuard(
  model: Model,
  kind: ContextKind,
  name: string
): boolean {
  return [...model.reevaluations.values()].some(
    (reevaluation) =>
      reevaluation.satisfiesKind === kind &&
      reevaluation.satisfiesName === name &&
      reevaluationValidationReasons(reevaluation, model).length === 0
  );
}

export function matchingContextsForTarget(
  target: ShapeTarget,
  model: Model
): { kind: ContextKind; name: string }[] {
  const contexts: { kind: ContextKind; name: string }[] = [];
  for (const rationale of model.rationales.values()) {
    if (targetsEqual(rationale.appliesTo ?? rationale.target, target)) {
      contexts.push({ kind: "rationale", name: rationale.name });
    }
  }
  for (const memory of model.memories.values()) {
    if (targetsEqual(memory.appliesTo ?? memory.target, target)) {
      contexts.push({ kind: "memory", name: memory.name });
    }
  }
  return contexts.sort(compareKindName);
}

export type ResourceRuleConditionCompatibility =
  | { kind: "compatible" }
  | { kind: "unresolved" }
  | { kind: "invalid"; reason: string; traitProvenance: Provenance };

/**
 * Classifies whether a `when <subject> has <trait>` condition can safely bind
 * the subject to a resource for a final-effect rule. Validation and derivation
 * share this predicate so an invalid or unresolved condition cannot still
 * derive a misleading final forbid.
 */
export function resourceRuleConditionCompatibility(
  condition: RuleInfo["whenHas"][number],
  model: Model
): ResourceRuleConditionCompatibility {
  if (condition.traitResolution === "ambiguous") {
    return { kind: "unresolved" };
  }

  const trait = model.traits.get(condition.trait);
  if (!trait) {
    return condition.traitResolution === "resolved" && KNOWN_PRELUDE_TRAITS.has(condition.trait)
      ? { kind: "compatible" }
      : { kind: "unresolved" };
  }

  if (trait.typeParams.length === 0) {
    return { kind: "compatible" };
  }
  if (trait.typeParams.length > 1) {
    return {
      kind: "invalid",
      reason: `rule condition trait ${displaySymbol(trait.name)} declares ${trait.typeParams.length} type parameters; expected no type parameters or exactly one Resource-bound parameter`,
      traitProvenance: trait.provenance
    };
  }

  const typeParam = trait.typeParams[0];
  if (!typeParam) {
    return { kind: "unresolved" };
  }
  if (typeParam.bound === undefined) {
    return {
      kind: "invalid",
      reason: `rule condition trait ${displaySymbol(trait.name)} type parameter ${typeParam.name} is unbound; expected Resource`,
      traitProvenance: trait.provenance
    };
  }
  if (typeParam.bound.toLowerCase() !== "resource") {
    return {
      kind: "invalid",
      reason: `rule condition trait ${displaySymbol(trait.name)} type parameter ${typeParam.name} has incompatible bound ${typeParam.bound}; expected Resource`,
      traitProvenance: trait.provenance
    };
  }
  return { kind: "compatible" };
}

export function deriveFinalForbidsForResource(
  resource: ResourceInfo,
  model: Model
): { effect: string; target: string; trait: string; provenance: Provenance }[] {
  const forbids: { effect: string; target: string; trait: string; provenance: Provenance }[] = [];

  for (const traitName of resource.traits.keys()) {
    const trait = model.traits.get(traitName);
    if (!trait) {
      continue;
    }

    for (const forbid of trait.finalForbids) {
      if (!forbid.final) {
        continue;
      }
      forbids.push({
        effect: forbid.effect,
        target: instantiateFinalForbidTarget(forbid, resource.name),
        trait: traitName,
        provenance: forbid.provenance
      });
    }
  }

  for (const rule of model.rules) {
    const subject = rule.finalForbidSubject;
    if (!subject) {
      continue;
    }
    const whens = rule.whenHas.filter((when) => when.subject === subject);
    if (
      whens.length === 0 ||
      !whens.every(
        (when) =>
          resourceRuleConditionCompatibility(when, model).kind === "compatible" &&
          resource.traits.has(when.trait)
      )
    ) {
      continue;
    }
    const diagnosticTrait = whens[0]?.trait;
    if (!diagnosticTrait) {
      continue;
    }

    for (const forbid of rule.forbidEffects) {
      if (!forbid.final) {
        continue;
      }
      forbids.push({
        effect: forbid.effect,
        target: instantiateFinalForbidTarget(forbid, resource.name),
        trait: diagnosticTrait,
        provenance: forbid.provenance
      });
    }
  }

  return dedupeForbids(forbids);
}

export function findFinalForbidden(
  effectName: string,
  resource: ResourceInfo,
  model: Model
): { trait: string; provenance: Provenance } | undefined {
  return deriveFinalForbidsForResource(resource, model).find(
    (forbid) => forbid.effect === effectName && forbid.target === resource.name
  );
}

function instantiateFinalForbidTarget(forbid: FinalForbidPattern, resourceName: string): string {
  if (forbid.targetBinding === "omitted" || forbid.targetBinding === "generic") {
    return resourceName;
  }
  return forbid.target ?? resourceName;
}

function dedupeForbids(
  forbids: { effect: string; target: string; trait: string; provenance: Provenance }[]
): { effect: string; target: string; trait: string; provenance: Provenance }[] {
  const seen = new Set<string>();
  return forbids.filter((forbid) => {
    const key = `${forbid.effect}<${forbid.target}>:${forbid.trait}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
