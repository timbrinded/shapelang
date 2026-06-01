import type { TargetKind } from "../../language/generated/ast.ts";
import type { Model, ProtectedProperty, SemanticDiagnostic } from "../model.ts";
import type { IsoDateString } from "../iso-date.ts";
import { isIsoCalendarDate } from "../iso-date.ts";
import { displaySymbol } from "../display.ts";
import { describeProvenance } from "../provenance.ts";
import {
  hasGuardAction,
  hasValidReevaluationForGuard,
  requiresReevaluation
} from "../derivations.ts";
import {
  evaluateGuards,
  type GuardContext,
  type GuardedProperty,
  type GuardViolation
} from "../../memory-guards.ts";
import { allContexts } from "./context.ts";

export function checkGuardedChanges(model: Model): SemanticDiagnostic[] {
  return evaluateGuards(buildGuardContexts(model), model.changeEvents).map(
    guardViolationDiagnostic
  );
}

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

export function checkFreshness(model: Model, asOf: IsoDateString): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const { kind, info } of allContexts(model)) {
    if (!info.reviewBy || !isIsoCalendarDate(info.reviewBy) || info.reviewBy >= asOf) {
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
