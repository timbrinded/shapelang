// Guarded-change matching for Memory Guards.
//
// This module owns the guard/change domain as explicit discriminated unions and
// a single matcher that decides coarse / property / transform precedence in one
// place. Detectability is decided by the caller while lowering (a protected
// property arrives here already classified), so the matcher reads no prelude
// metadata and does no post-hoc dedupe over diagnostics — it consumes typed
// rules and triggers and returns typed violations.
//
// Shared shape types are imported type-only from the checker data model, so this
// module has no runtime dependency on the checker (no import cycle).
import type { Provenance, ShapeTarget } from "./checker/model.ts";
import type { ContextKind } from "./prelude.ts";

/** A property a guard protects, classified by what change (if any) we can
 *  detect against it. `opaque` properties (free-form labels, a description on a
 *  non-function target) are not individually detectable and force coarse
 *  matching. */
export type GuardedProperty =
  | { kind: "description" }
  | { kind: "shapeTrait"; trait: string; display: string }
  | { kind: "opaque" };

/** A change that occurred, at the granularity it was observed. */
export type ChangeTrigger =
  | { kind: "target_changed"; target: ShapeTarget; provenance: Provenance }
  | { kind: "shape_trait_removed"; target: ShapeTarget; trait: string; provenance: Provenance }
  | { kind: "description_removed"; target: ShapeTarget; provenance: Provenance }
  | { kind: "transform_applied"; target: ShapeTarget; label: string; provenance: Provenance };

/** A context (rationale/memory) whose guards may fire on a change to its target. */
export type GuardContext = {
  guardKind: ContextKind;
  guardName: string;
  target: ShapeTarget;
  /** A satisfying reevaluation already exists; the guard cannot fire. */
  satisfied: boolean;
  /** `on_change require ReEvaluation<...>` clauses, with their provenance. */
  requireClauses: { provenance: Provenance }[];
  /** Every protected property, classified for matching. */
  protects: GuardedProperty[];
  /** `forbid transform <label>` clauses, with their provenance. */
  transformClauses: { label: string; provenance: Provenance }[];
};

/** A matched guard violation, as plain data the checker maps to a diagnostic. */
export type GuardViolation = {
  guardKind: ContextKind;
  guardName: string;
  target: ShapeTarget;
  /** The specific property/transform that changed, or undefined for a coarse
   *  "the guarded target changed" violation. */
  change?: { kind: "property" | "transform"; label: string };
  changeProvenance: Provenance;
  guardProvenance: Provenance;
};

function targetsEqual(left: ShapeTarget, right: ShapeTarget): boolean {
  return left.kind === right.kind && left.name === right.name;
}

/** Human-readable label for a detectable protected property, used in the
 *  diagnostic's `changedProperty`. */
export function describeGuardedProperty(property: GuardedProperty): string {
  return property.kind === "shapeTrait" ? `shape trait ${property.display}` : "description";
}

function findPropertyTrigger(
  triggers: readonly ChangeTrigger[],
  target: ShapeTarget,
  property: GuardedProperty
): ChangeTrigger | undefined {
  return triggers.find((trigger) => {
    if (!targetsEqual(trigger.target, target)) {
      return false;
    }
    if (property.kind === "description") {
      return trigger.kind === "description_removed";
    }
    return (
      property.kind === "shapeTrait" &&
      trigger.kind === "shape_trait_removed" &&
      trigger.trait === property.trait
    );
  });
}

function findCoarseTrigger(
  triggers: readonly ChangeTrigger[],
  target: ShapeTarget
): ChangeTrigger | undefined {
  return triggers.find(
    (trigger) => trigger.kind === "target_changed" && targetsEqual(trigger.target, target)
  );
}

const violationKey = (violation: GuardViolation): string =>
  `${violation.guardKind}:${violation.guardName}:${violation.target.kind}:${violation.target.name}`;

/**
 * Match guard contexts against the observed changes and return one violation per
 * fired guard clause. Precedence is owned here:
 *
 * - A `require ReEvaluation` clause matches at property granularity when every
 *   protected property is individually detectable (and there is at least one),
 *   firing once per detected property; otherwise it falls back to a single
 *   coarse match on any change to the target.
 * - A `forbid transform` clause matches the declared transform intent.
 * - A coarse violation is dropped when a more specific property/transform
 *   violation exists for the same guard and target, so each guarded target is
 *   reported at its most specific granularity exactly once.
 */
export function evaluateGuards(
  contexts: readonly GuardContext[],
  triggers: readonly ChangeTrigger[]
): GuardViolation[] {
  const violations: GuardViolation[] = [];

  for (const context of contexts) {
    if (context.satisfied) {
      continue;
    }
    const detectable = context.protects.filter((property) => property.kind !== "opaque");
    const propertyLevel = detectable.length === context.protects.length && detectable.length > 0;
    for (const clause of context.requireClauses) {
      if (propertyLevel) {
        for (const property of detectable) {
          const trigger = findPropertyTrigger(triggers, context.target, property);
          if (trigger) {
            violations.push({
              guardKind: context.guardKind,
              guardName: context.guardName,
              target: context.target,
              change: { kind: "property", label: describeGuardedProperty(property) },
              changeProvenance: trigger.provenance,
              guardProvenance: clause.provenance
            });
          }
        }
      } else {
        const trigger = findCoarseTrigger(triggers, context.target);
        if (trigger) {
          violations.push({
            guardKind: context.guardKind,
            guardName: context.guardName,
            target: context.target,
            changeProvenance: trigger.provenance,
            guardProvenance: clause.provenance
          });
        }
      }
    }
  }

  for (const context of contexts) {
    if (context.satisfied) {
      continue;
    }
    for (const clause of context.transformClauses) {
      const trigger = triggers.find(
        (candidate) =>
          candidate.kind === "transform_applied" &&
          candidate.label === clause.label &&
          targetsEqual(candidate.target, context.target)
      );
      if (trigger) {
        violations.push({
          guardKind: context.guardKind,
          guardName: context.guardName,
          target: context.target,
          change: { kind: "transform", label: clause.label },
          changeProvenance: trigger.provenance,
          guardProvenance: clause.provenance
        });
      }
    }
  }

  const specificTargets = new Set(
    violations.filter((violation) => violation.change !== undefined).map(violationKey)
  );
  return violations.filter(
    (violation) => violation.change !== undefined || !specificTargets.has(violationKey(violation))
  );
}
