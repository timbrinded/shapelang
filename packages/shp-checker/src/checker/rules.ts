// Semantic rule engine: every check the deterministic pipeline runs over the
// effective model, plus the explicit ordered registry that fixes their order.
// Rules return SemanticDiagnostic[] and never format diagnostic text; shared
// model-derived queries they build on live in checker/derivations.ts. Binding
// enforcement is kept out of the default registry because CheckOptions controls
// it (see runSemanticChecks / checkBindings).
import type { TargetKind } from "../language/generated/ast.ts";
import type {
  AttestationInfo,
  ChangedFileContext,
  CheckOptions,
  FunctionInfo,
  HyperedgeInfo,
  MemoryInfo,
  Model,
  ProtectedProperty,
  Provenance,
  RationaleInfo,
  SemanticDiagnostic
} from "./model.ts";
import { KNOWN_PRELUDE_TRAITS, PRELUDE_RELATION_KINDS, type ContextKind } from "../prelude.ts";
import {
  displaySymbol,
  formatContextRequirement,
  formatSourceRefInfo,
  functionKey,
  termKey
} from "./display.ts";
import { describeProvenance, provenance } from "./provenance.ts";
import { globMatches, normalizeRepoPath } from "./globs.ts";
import {
  findFinalForbidden,
  hasGuardAction,
  hasNonEmptyDescription,
  hasRequiredContext,
  hasValidReevaluationForGuard,
  reevaluationValidationReasons,
  requirementsForTarget,
  requiresReevaluation,
  shapeTraitBearers,
  shouldIgnoreUnknownEffectsDiagnostic,
  targetExists,
  targetsEqual
} from "./derivations.ts";
import {
  evaluateGuards,
  type GuardContext,
  type GuardedProperty,
  type GuardViolation
} from "../memory-guards.ts";

export function checkResolvedNames(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const knownTraits = new Set([...KNOWN_PRELUDE_TRAITS, ...model.traits.keys()]);

  for (const resource of model.resources.values()) {
    for (const [trait, traitProv] of resource.traits) {
      if (!knownTraits.has(trait)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "trait",
          name: trait,
          filePath: traitProv.filePath,
          causedBy: [describeProvenance(traitProv)]
        });
      }
    }
  }

  for (const component of model.components.values()) {
    for (const [trait, traitProv] of component.classifiers) {
      if (!knownTraits.has(trait)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "trait",
          name: trait,
          filePath: traitProv.filePath,
          causedBy: [describeProvenance(traitProv)]
        });
      }
    }

    for (const [resource, ownProv] of component.owns) {
      if (!model.resources.has(resource)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: resource,
          filePath: ownProv.filePath,
          causedBy: [describeProvenance(ownProv)]
        });
      }
    }

    for (const fn of component.functions.values()) {
      for (const [trait, traitProv] of fn.shapeTraits) {
        if (!knownTraits.has(trait)) {
          diagnostics.push({
            kind: "unknown_name",
            nameKind: "trait",
            name: trait,
            filePath: traitProv.filePath,
            causedBy: [describeProvenance(traitProv)]
          });
        }
      }

      if (fn.effects.kind !== "complete") {
        continue;
      }
      for (const entry of fn.effects.entries) {
        const target = entry.term.target;
        if (target && !model.resources.has(target)) {
          diagnostics.push({
            kind: "unknown_name",
            nameKind: "resource",
            name: target,
            filePath: entry.provenance.filePath,
            causedBy: [describeProvenance(entry.provenance)]
          });
        }
      }
    }
  }

  for (const implementation of model.implementations) {
    if (implementation.conformsTo && !model.components.has(implementation.conformsTo)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "component",
        name: implementation.conformsTo,
        filePath: implementation.provenance.filePath,
        causedBy: [describeProvenance(implementation.provenance)]
      });
    }
  }

  for (const hyperedge of model.hypergraph.edges.values()) {
    for (const member of hyperedge.members) {
      if (!isResolvedVertex(member.endpoint, model)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "relation_endpoint",
          name: member.endpoint,
          filePath: hyperedge.provenance.filePath,
          causedBy: [describeProvenance(hyperedge.provenance)]
        });
      } else if (isAmbiguousVertex(member.endpoint, model)) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `endpoint ${displaySymbol(member.endpoint)} resolves to both a component and a resource`,
          filePath: hyperedge.provenance.filePath,
          causedBy: [describeProvenance(hyperedge.provenance)]
        });
      }
    }

    if (hyperedge.kind === "provides") {
      diagnostics.push(...checkProvidesEndpointKinds(hyperedge, model));
    }
  }

  for (const candidateEffect of model.candidateEffects.values()) {
    if (!candidateEffect.functionTarget) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "component",
        name: `${candidateEffect.name} function`,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    } else if (!targetExists({ kind: "fn", name: candidateEffect.functionTarget }, model)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "component",
        name: candidateEffect.functionTarget,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    }
    const target = candidateEffect.term?.target;
    if (target && !model.resources.has(target)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "resource",
        name: target,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    }
    if (candidateEffect.anchor && !model.resources.has(candidateEffect.anchor)) {
      diagnostics.push({
        kind: "unknown_name",
        nameKind: "resource",
        name: candidateEffect.anchor,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [describeProvenance(candidateEffect.provenance)]
      });
    }
  }

  for (const trait of model.traits.values()) {
    for (const forbid of trait.finalForbids) {
      if (
        forbid.target &&
        forbid.targetBinding === "concrete" &&
        !model.resources.has(forbid.target)
      ) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: forbid.target,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
    }
  }

  for (const rule of model.rules) {
    for (const forbid of rule.forbidEffects) {
      if (
        forbid.target &&
        forbid.targetBinding === "concrete" &&
        !model.resources.has(forbid.target)
      ) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: forbid.target,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
    }
    for (const forbid of rule.forbidProvides) {
      if (!model.resources.has(forbid.target)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "resource",
          name: forbid.target,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
      if (forbid.except && !model.components.has(forbid.except)) {
        diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: forbid.except,
          filePath: forbid.provenance.filePath,
          causedBy: [describeProvenance(forbid.provenance)]
        });
      }
    }
  }

  return diagnostics;
}

export function checkRules(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    const hasFinalForbid = rule.forbidEffects.some((forbid) => forbid.final);
    if (!hasFinalForbid) {
      continue;
    }

    const subjects = [...new Set(rule.whenHas.map((when) => when.subject))];
    if (subjects.length === 0) {
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: "final effect forbids require exactly one when subject",
        filePath: rule.provenance.filePath,
        causedBy: [describeProvenance(rule.provenance)]
      });
    } else if (subjects.length > 1) {
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: `final effect forbids may bind only one subject, but found ${subjects.join(", ")}`,
        filePath: rule.provenance.filePath,
        causedBy: [describeProvenance(rule.provenance)]
      });
    }
  }

  return diagnostics;
}

export function isResolvedVertex(name: string, model: Model): boolean {
  return model.components.has(name) || model.resources.has(name);
}

export function isAmbiguousVertex(name: string, model: Model): boolean {
  return model.components.has(name) && model.resources.has(name);
}

export function checkProvidesEndpointKinds(
  hyperedge: HyperedgeInfo,
  model: Model
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const provider = providesProvider(hyperedge);
  const target = providesTarget(hyperedge);

  if (provider && isResolvedVertex(provider, model) && !model.components.has(provider)) {
    diagnostics.push({
      kind: "invalid_relation",
      name: hyperedge.name,
      reason: `provides provider ${displaySymbol(provider)} must be a component`,
      filePath: hyperedge.provenance.filePath,
      causedBy: [describeProvenance(hyperedge.provenance)]
    });
  }

  if (target && isResolvedVertex(target, model) && !model.resources.has(target)) {
    diagnostics.push({
      kind: "invalid_relation",
      name: hyperedge.name,
      reason: `provides target ${displaySymbol(target)} must be a resource`,
      filePath: hyperedge.provenance.filePath,
      causedBy: [describeProvenance(hyperedge.provenance)]
    });
  }

  return diagnostics;
}

export function checkFingerprintExpectations(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const hyperedge of model.hypergraph.edges.values()) {
    const endpointSet = new Set(hyperedge.members.map((member) => member.endpoint));
    for (const expectation of hyperedge.fingerprintExpectations) {
      if (!endpointSet.has(expectation.endpoint)) {
        continue;
      }
      if (!isResolvedVertex(expectation.endpoint, model)) {
        continue;
      }
      if (isAmbiguousVertex(expectation.endpoint, model)) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `fingerprint expectation endpoint ${displaySymbol(expectation.endpoint)} resolves to both a component and a resource`,
          filePath: expectation.provenance.filePath,
          causedBy: [describeProvenance(expectation.provenance)]
        });
        continue;
      }

      const resource = model.resources.get(expectation.endpoint);
      if (!resource) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `fingerprint expectation endpoint ${displaySymbol(expectation.endpoint)} must be a resource`,
          filePath: expectation.provenance.filePath,
          causedBy: [describeProvenance(expectation.provenance)]
        });
        continue;
      }

      const actual = resource.fingerprints.get(expectation.provider);
      if (!actual || actual.value !== expectation.value) {
        diagnostics.push({
          kind: "fingerprint_mismatch",
          relation: hyperedge.name,
          endpoint: expectation.endpoint,
          provider: expectation.provider,
          expected: expectation.value,
          actual: actual?.value,
          filePath: expectation.provenance.filePath,
          causedBy: [
            describeProvenance(expectation.provenance),
            describeProvenance(resource.provenance),
            ...(actual ? [describeProvenance(actual.provenance)] : [])
          ]
        });
      }
    }
  }

  return diagnostics;
}

export function checkCandidateEffectFingerprints(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const candidateEffect of model.candidateEffects.values()) {
    if (
      !candidateEffect.anchor ||
      !candidateEffect.fingerprintProvider ||
      !candidateEffect.fingerprintValue
    ) {
      continue;
    }

    const anchor = model.resources.get(candidateEffect.anchor);
    if (!anchor) {
      continue;
    }

    const actual = anchor.fingerprints.get(candidateEffect.fingerprintProvider);
    if (!actual || actual.value !== candidateEffect.fingerprintValue) {
      diagnostics.push({
        kind: "candidate_pin_fingerprint_mismatch",
        candidateEffect: candidateEffect.name,
        anchor: candidateEffect.anchor,
        provider: candidateEffect.fingerprintProvider,
        expected: candidateEffect.fingerprintValue,
        actual: actual?.value,
        filePath: candidateEffect.provenance.filePath,
        causedBy: [
          describeProvenance(candidateEffect.provenance),
          describeProvenance(anchor.provenance),
          ...(actual ? [describeProvenance(actual.provenance)] : [])
        ]
      });
    }
  }

  return diagnostics;
}

export function checkContextTargets(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rationale of model.rationales.values()) {
    diagnostics.push(...checkContextTarget("rationale", rationale, model));
  }

  for (const memory of model.memories.values()) {
    diagnostics.push(...checkContextTarget("memory", memory, model));
  }

  return diagnostics;
}

export function checkContextTarget(
  kind: ContextKind,
  context: RationaleInfo | MemoryInfo,
  model: Model
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  if (!targetExists(context.target, model)) {
    diagnostics.push({
      kind: "invalid_context_target",
      contextKind: kind,
      name: context.name,
      targetKind: context.target.kind,
      target: context.target.name,
      filePath: context.provenance.filePath,
      causedBy: [describeProvenance(context.provenance)]
    });
  }

  if (context.appliesTo) {
    if (!targetsEqual(context.target, context.appliesTo)) {
      diagnostics.push({
        kind: "context_target_mismatch",
        contextKind: kind,
        name: context.name,
        declaredTarget: context.target,
        appliesToTarget: context.appliesTo,
        filePath: context.provenance.filePath,
        causedBy: [describeProvenance(context.provenance)]
      });
    }

    if (!targetExists(context.appliesTo, model)) {
      diagnostics.push({
        kind: "invalid_context_target",
        contextKind: kind,
        name: context.name,
        targetKind: context.appliesTo.kind,
        target: context.appliesTo.name,
        filePath: context.provenance.filePath,
        causedBy: [describeProvenance(context.provenance)]
      });
    }
  }

  return diagnostics;
}

export function checkRequiredContext(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const target of shapeTraitBearers(model)) {
    for (const requirement of requirementsForTarget(model, target.kind, target.traits)) {
      if (hasRequiredContext(requirement, target.target, model)) {
        continue;
      }

      const traitProvenance = target.traits.get(requirement.trait) ?? target.fallback;
      const requirementProvenance =
        requirement.provenance ??
        provenance("standard prelude", `${requirement.trait} requires ${requirement.contextType}`);
      diagnostics.push({
        kind: "missing_required_context",
        targetKind: target.kind,
        target: target.target.name,
        requiredContext: formatContextRequirement(requirement.contextType, target.target),
        requiredBy: requirement.trait,
        filePath: traitProvenance.filePath,
        causedBy: [describeProvenance(traitProvenance), describeProvenance(requirementProvenance)]
      });
    }
  }

  return diagnostics;
}

export function checkRequiredDescriptions(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      for (const requirement of requirementsForTarget(model, "fn", fn.shapeTraits).filter(
        (item) => item.requiresDescription
      )) {
        if (hasNonEmptyDescription(fn)) {
          continue;
        }

        const traitProvenance = fn.shapeTraits.get(requirement.trait) ?? fn.provenance;
        diagnostics.push({
          kind: "missing_required_description",
          targetKind: "fn",
          target: functionKey(fn.component, fn.name),
          requiredBy: requirement.trait,
          filePath: traitProvenance.filePath,
          causedBy: [
            describeProvenance(traitProvenance),
            describeProvenance(
              provenance("standard prelude", `${requirement.trait} requires description`)
            )
          ]
        });
      }

      if (fn.description?.required && fn.description.summary.trim().length === 0) {
        diagnostics.push({
          kind: "missing_required_description",
          targetKind: "fn",
          target: functionKey(fn.component, fn.name),
          requiredBy: "description required",
          filePath: fn.description.provenance.filePath,
          causedBy: [describeProvenance(fn.description.provenance)]
        });
      }
    }
  }

  return diagnostics;
}

export function checkReevaluations(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const reevaluation of model.reevaluations.values()) {
    for (const reason of reevaluationValidationReasons(reevaluation, model)) {
      diagnostics.push({
        kind: "invalid_reevaluation",
        name: reevaluation.name,
        reason,
        filePath: reevaluation.provenance.filePath,
        causedBy: [describeProvenance(reevaluation.provenance)]
      });
    }
  }

  return diagnostics;
}

export function checkGuardedChanges(model: Model): SemanticDiagnostic[] {
  return evaluateGuards(buildGuardContexts(model), model.changeEvents).map(
    guardViolationDiagnostic
  );
}

/**
 * Every rationale and memory paired with its context kind, in a stable order
 * (rationales then memories). Guard and freshness checking both enumerate the
 * full context population this way; sharing one builder keeps them from
 * drifting on ordering or which kinds are included.
 */
export function allContexts(
  model: Model
): { kind: ContextKind; info: RationaleInfo | MemoryInfo }[] {
  return [
    ...[...model.rationales.values()].map((info) => ({ kind: "rationale" as const, info })),
    ...[...model.memories.values()].map((info) => ({ kind: "memory" as const, info }))
  ];
}

/**
 * Lower every guarding rationale/memory into a GuardContext: its
 * `require ReEvaluation` and `forbid transform` clauses, plus its protected
 * properties already classified for detectability. Detectability is decided
 * here — where the trait table and prelude shape-trait set are available — so
 * the matcher consumes only the effective model.
 */
export function buildGuardContexts(model: Model): GuardContext[] {
  const contexts: GuardContext[] = [];
  for (const { kind, info } of allContexts(model)) {
    if (!hasGuardAction(info)) {
      continue;
    }
    const requireClauses = info.guards
      .filter((guard) => requiresReevaluation(guard))
      .map((guard) => ({ provenance: guard.provenance }));
    const target = info.appliesTo ?? info.target;
    contexts.push({
      guardKind: kind,
      guardName: info.name,
      target,
      satisfied: hasValidReevaluationForGuard(model, kind, info.name),
      requireClauses,
      protects: info.protects.map((property) =>
        classifyProtectedProperty(model, property, target.kind)
      ),
      transformClauses: info.forbiddenTransforms.map((guard) => ({
        label: guard.label,
        provenance: guard.provenance
      }))
    });
  }
  return contexts;
}

/**
 * Classify a stored protected property for guard matching. A description is
 * detectable only on a function target; a `shape` value is detectable when it
 * resolves to a real trait (built-in or declared). Everything else is opaque
 * and forces coarse matching.
 */
export function classifyProtectedProperty(
  model: Model,
  property: ProtectedProperty,
  targetKind: TargetKind
): GuardedProperty {
  if (property.kind === "description") {
    return targetKind === "fn" ? { kind: "description" } : { kind: "opaque" };
  }
  if (property.kind === "shape") {
    // Detectable iff the protected name resolves to a real trait. Prelude
    // shape-trait obligations are seeded into model.traits, so this reads only
    // the effective model — no separate prelude-metadata lookup.
    const resolved = property.resolvedValue ?? property.value;
    if (model.traits.has(resolved)) {
      return { kind: "shapeTrait", trait: resolved, display: property.value };
    }
  }
  return { kind: "opaque" };
}

export function guardViolationDiagnostic(
  violation: GuardViolation
): Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }> {
  return {
    kind: "guarded_shape_changed",
    guardKind: violation.guardKind,
    guard: violation.guardName,
    targetKind: violation.target.kind,
    target: violation.target.name,
    changedProperty: violation.change?.label,
    changeKind: violation.change?.kind,
    missingReevaluation: `reevaluation satisfying ${violation.guardKind} ${displaySymbol(violation.guardName)}`,
    filePath: violation.changeProvenance.filePath,
    causedBy: [
      describeProvenance(violation.changeProvenance),
      describeProvenance(violation.guardProvenance)
    ]
  };
}

/**
 * Reports design memory whose `review_by` date is strictly before `asOf`.
 * Only ISO `YYYY-MM-DD` `review_by` values are enforced; non-ISO and missing
 * values are left untouched so freshness never breaks a model on a typo's say-so.
 */
export function checkFreshness(model: Model, asOf: string): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const { kind, info } of allContexts(model)) {
    if (!info.reviewBy || !isIsoDate(info.reviewBy) || info.reviewBy >= asOf) {
      continue;
    }

    const target = info.appliesTo ?? info.target;
    diagnostics.push({
      kind: "stale_memory",
      guardKind: kind,
      guard: info.name,
      targetKind: target.kind,
      target: target.name,
      reviewBy: info.reviewBy,
      asOf,
      filePath: info.provenance.filePath,
      causedBy: [describeProvenance(info.provenance)]
    });
  }

  return diagnostics;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

// Calendar days in a month, with Gregorian leap-year rules. Kept as pure
// arithmetic (no `Date`) so the checker reads no wall clock and stays
// deterministic; the no-clock-in-checker invariant is locked by a test.
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeapYear ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function checkFunctions(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      if (fn.unsafe) {
        const missing = missingUnsafeRequirements(fn);
        if (missing.length > 0) {
          diagnostics.push({
            kind: "unsafe_effects",
            component: component.name,
            functionName: fn.name,
            missing,
            filePath: fn.provenance.filePath,
            causedBy: [describeProvenance(fn.provenance)]
          });
        }
      }

      if (fn.effects.kind === "unknown") {
        if (shouldIgnoreUnknownEffectsDiagnostic(fn)) {
          continue;
        }
        diagnostics.push({
          kind: "unknown_effects",
          component: component.name,
          functionName: fn.name,
          filePath: fn.provenance.filePath,
          causedBy: [describeProvenance(fn.provenance)]
        });
        continue;
      }

      for (const entry of fn.effects.entries) {
        const target = entry.term.target;
        if (!target) {
          continue;
        }

        const resource = model.resources.get(target);
        if (resource) {
          const finalForbidden = findFinalForbidden(entry.term.name, resource, model);
          if (finalForbidden) {
            diagnostics.push({
              kind: "final_forbidden_effect",
              component: component.name,
              functionName: fn.name,
              effect: entry.term.name,
              target,
              trait: finalForbidden.trait,
              evidence: entry.evidence ? formatSourceRefInfo(entry.evidence) : undefined,
              filePath: entry.provenance.filePath,
              causedBy: [
                describeProvenance(entry.provenance),
                describeProvenance(resource.traits.get(finalForbidden.trait)),
                describeProvenance(finalForbidden.provenance)
              ]
            });
            continue;
          }
        }

        if (!component.grants.has(termKey(entry.term))) {
          diagnostics.push({
            kind: "missing_grant",
            component: component.name,
            functionName: fn.name,
            effect: entry.term.name,
            target,
            filePath: entry.provenance.filePath,
            causedBy: [
              describeProvenance(entry.provenance),
              describeProvenance(component.provenance)
            ]
          });
        }
      }
    }
  }

  return diagnostics;
}

export function checkProvidesRules(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    for (const forbid of rule.forbidProvides) {
      for (const hyperedge of model.hypergraph.edges.values()) {
        if (hyperedge.kind !== "provides") {
          continue;
        }
        const provider = providesProvider(hyperedge);
        const target = providesTarget(hyperedge);
        if (!provider || !target) {
          continue;
        }
        if (target !== forbid.target) {
          continue;
        }
        if (provider === forbid.except) {
          continue;
        }
        diagnostics.push({
          kind: "forbidden_provides",
          rule: rule.name,
          provider,
          target,
          hyperedge: hyperedge.name,
          allowedComponent: forbid.except,
          filePath: hyperedge.provenance.filePath,
          causedBy: [
            describeProvenance(hyperedge.provenance),
            describeProvenance(forbid.provenance)
          ]
        });
      }
    }
  }

  return diagnostics;
}

/**
 * `provides` hyperedges connect `provider -> target` (binary, directed).
 */
export function providesProvider(hyperedge: HyperedgeInfo): string | undefined {
  return hyperedge.members[0]?.endpoint;
}

export function providesTarget(hyperedge: HyperedgeInfo): string | undefined {
  return hyperedge.members[1]?.endpoint;
}

export function checkHypercycles(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const seenCycles = new Set<string>();

  for (const rule of model.rules) {
    for (const forbid of rule.forbidHypercycles) {
      const cycle = findHypercycle(model, forbid.kinds);
      if (!cycle) {
        continue;
      }

      const signature = cycle.hyperedges
        .map((edge) => edge.name)
        .sort()
        .join(",");
      const dedupeKey = `${rule.name}:${signature}`;
      if (seenCycles.has(dedupeKey)) {
        continue;
      }
      seenCycles.add(dedupeKey);

      diagnostics.push({
        kind: "forbidden_hypercycle",
        rule: rule.name,
        vertices: cycle.vertices,
        hyperedges: cycle.hyperedges.map((edge) => ({ name: edge.name, kind: edge.kind })),
        filePath: forbid.provenance.filePath,
        causedBy: [
          describeProvenance(forbid.provenance),
          ...cycle.provenance.map(describeProvenance)
        ]
      });
    }
  }

  return diagnostics;
}

type HypercycleWitness = {
  vertices: string[];
  hyperedges: HyperedgeInfo[];
  provenance: Provenance[];
};

type HyperedgeStep = {
  hyperedge: HyperedgeInfo;
  from: string;
  to: string;
};

/**
 * Find a cycle in the directed hypergraph.
 *
 * Each relation kind contributes directed steps to the traversal according
 * to its `cycleTraversal` rule in the prelude kind registry:
 *
 * - `directed_pairs`: a 2-vertex hyperedge contributes one step `members[0] -> members[1]`.
 * - `ordered_path`: an N-vertex hyperedge contributes consecutive steps
 *   `members[i] -> members[i+1]` along the declared order.
 * - `none`: the hyperedge does not participate in cycle detection.
 *
 * `kindsFilter`, if non-empty, restricts the search to the subgraph induced
 * by hyperedges whose `kind` matches one of the listed kinds. Steps from
 * other kinds are excluded from adjacency entirely, so cycles that require
 * traversing a non-allowed kind to close are not reported.
 */
export function findHypercycle(model: Model, kindsFilter: string[]): HypercycleWitness | undefined {
  const allSteps = buildHyperedgeSteps(model);
  const allowedKinds = kindsFilter.length === 0 ? undefined : new Set(kindsFilter);
  const steps = allowedKinds
    ? allSteps.filter((step) => allowedKinds.has(step.hyperedge.kind))
    : allSteps;
  if (steps.length === 0) {
    return undefined;
  }

  const adjacency = new Map<string, HyperedgeStep[]>();
  const vertices = new Set<string>();
  for (const step of steps) {
    vertices.add(step.from);
    vertices.add(step.to);
    const existing = adjacency.get(step.from) ?? [];
    existing.push(step);
    adjacency.set(step.from, existing);
  }

  for (const start of [...vertices].sort()) {
    const visited = new Set<string>();
    const witness = dfsHypercycle(start, start, adjacency, [], visited);
    if (witness) {
      return witness;
    }
  }

  return undefined;
}

export function dfsHypercycle(
  start: string,
  current: string,
  adjacency: Map<string, HyperedgeStep[]>,
  path: HyperedgeStep[],
  visited: Set<string>
): HypercycleWitness | undefined {
  if (visited.has(current)) {
    return undefined;
  }
  visited.add(current);

  const nextSteps = adjacency.get(current) ?? [];
  for (const step of nextSteps) {
    path.push(step);
    if (step.to === start) {
      return witnessFromPath(start, path);
    }

    const witness = dfsHypercycle(start, step.to, adjacency, path, visited);
    if (witness) {
      return witness;
    }
    path.pop();
  }

  visited.delete(current);
  return undefined;
}

export function witnessFromPath(start: string, path: HyperedgeStep[]): HypercycleWitness {
  const vertices = [start, ...path.map((step) => step.to)];
  const seenEdges = new Set<string>();
  const hyperedges: HyperedgeInfo[] = [];
  for (const step of path) {
    if (!seenEdges.has(step.hyperedge.name)) {
      seenEdges.add(step.hyperedge.name);
      hyperedges.push(step.hyperedge);
    }
  }
  return {
    vertices,
    hyperedges,
    provenance: hyperedges.map((edge) => edge.provenance)
  };
}

export function buildHyperedgeSteps(model: Model): HyperedgeStep[] {
  const steps: HyperedgeStep[] = [];
  for (const edge of model.hypergraph.edges.values()) {
    const rule = PRELUDE_RELATION_KINDS.get(edge.kind);
    const traversal = rule?.cycleTraversal ?? "none";
    if (traversal === "none") {
      continue;
    }

    if (traversal === "directed_pairs") {
      if (edge.members.length < 2) {
        continue;
      }
      steps.push({
        hyperedge: edge,
        from: edge.members[0]!.endpoint,
        to: edge.members[1]!.endpoint
      });
    } else if (traversal === "ordered_path") {
      for (let index = 0; index < edge.members.length - 1; index += 1) {
        steps.push({
          hyperedge: edge,
          from: edge.members[index]!.endpoint,
          to: edge.members[index + 1]!.endpoint
        });
      }
    }
  }
  return steps;
}

export function checkCoverage(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles);
  const noShapeChangeAttestations = new Set(["no_shape_change"]);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const implementation of model.implementations) {
    if (implementation.onChangeRequirement !== "shape_update") {
      continue;
    }

    for (const changedFile of changed.files) {
      if (changedFile.endsWith(".shape")) {
        continue;
      }

      const governingPath = implementation.paths.find((entry) =>
        globMatches(entry.glob, changedFile)
      );
      if (!governingPath) {
        continue;
      }

      if (currentShapeUpdateExists(model, changedFile, changed.set)) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, noShapeChangeAttestations)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_shape_update",
        changedFile,
        implementation: implementation.name,
        glob: governingPath.glob,
        filePath: implementation.provenance.filePath,
        causedBy: [
          describeProvenance(implementation.provenance),
          describeProvenance(governingPath.provenance)
        ]
      });
    }
  }

  return diagnostics;
}

export function changedFileContext(changedFiles: string[]): ChangedFileContext {
  const files = changedFiles
    .map((file) => normalizeRepoPath(file))
    .filter((file) => file.length > 0);
  return {
    files,
    set: new Set(files)
  };
}

export function currentShapeUpdateExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>
): boolean {
  return (
    model.shapeUpdatePaths
      .get(changedFile)
      ?.some((provenance) => provenanceFileChanged(provenance, changedSet)) ?? false
  );
}

export function currentAttestationExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>
): boolean {
  return model.attestations.some((attestation) =>
    isCurrentAttestation(attestation, changedFile, changedSet, allowedKinds)
  );
}

export function isCurrentAttestation(
  attestation: AttestationInfo,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>
): boolean {
  return (
    allowedKinds.has(attestation.kind) &&
    attestation.path === changedFile &&
    attestation.reason.trim().length > 0 &&
    provenanceFileChanged(attestation.provenance, changedSet)
  );
}

export function provenanceFileChanged(provenance: Provenance, changedSet: Set<string>): boolean {
  return (
    provenance.filePath !== undefined && changedSet.has(normalizeRepoPath(provenance.filePath))
  );
}

export function checkBindings(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const binding of model.bindings.values()) {
    const requiredChanged = changed.files.some((file) =>
      binding.requireChanged.some((entry) => globMatches(entry.glob, file))
    );
    if (requiredChanged) {
      continue;
    }

    const allowedKinds = new Set(binding.allowAttestations.map((item) => item.kind));
    for (const changedFile of changed.files) {
      const trigger = binding.whenChanged.find((entry) => globMatches(entry.glob, changedFile));
      if (!trigger) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, allowedKinds)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_bound_docs_change",
        binding: binding.name,
        changedFile,
        requiredPaths: binding.requireChanged.map((entry) => entry.glob).sort(),
        attestationKinds: [...allowedKinds].sort(),
        filePath: binding.provenance.filePath,
        causedBy: [describeProvenance(binding.provenance), describeProvenance(trigger.provenance)]
      });
    }
  }

  return diagnostics;
}
export function missingUnsafeRequirements(fn: FunctionInfo): string[] {
  const missing: string[] = [];
  if (!fn.reason) {
    missing.push("reason");
  }
  if (!fn.expires) {
    missing.push("expires");
  }
  if (fn.requires.length === 0) {
    missing.push("required capability");
  }
  return missing;
}

/**
 * The deterministic order semantic checks run in. checkShapeModules flattens
 * this list (then appends binding enforcement, which CheckOptions gates), so the
 * order here is the single source of truth and is covered by tests. Freshness
 * and coverage read CheckOptions; every other check ignores its second argument.
 */
export const SEMANTIC_CHECKS: ReadonlyArray<
  (model: Model, options: CheckOptions) => SemanticDiagnostic[]
> = [
  (model) => checkResolvedNames(model),
  (model) => checkRules(model),
  (model) => checkFingerprintExpectations(model),
  (model) => checkCandidateEffectFingerprints(model),
  (model) => checkContextTargets(model),
  (model) => checkRequiredContext(model),
  (model) => checkRequiredDescriptions(model),
  (model) => checkReevaluations(model),
  (model) => checkGuardedChanges(model),
  (model, options) => (options.freshnessDate ? checkFreshness(model, options.freshnessDate) : []),
  (model) => checkFunctions(model),
  (model) => checkProvidesRules(model),
  (model) => checkHypercycles(model),
  (model, options) => checkCoverage(model, options.changedFiles ?? [])
];

export function runSemanticChecks(model: Model, options: CheckOptions): SemanticDiagnostic[] {
  return SEMANTIC_CHECKS.flatMap((check) => check(model, options));
}
