import type { ContextObjectInfo, Model, SemanticDiagnostic } from "../model.ts";
import type { ContextKind } from "../../prelude.ts";
import { formatContextRequirement, functionKey } from "../display.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import {
  allContexts,
  hasNonEmptyDescription,
  hasRequiredContext,
  reevaluationValidationReasons,
  requirementsForTarget,
  shapeTraitBearers,
  targetExists
} from "../derivations.ts";
import { targetsEqual } from "../../targets.ts";

export function checkContextTarget(
  kind: ContextKind,
  context: ContextObjectInfo,
  model: Model
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  for (const [index, target] of [context.target, context.appliesTo].entries()) {
    if (!target) {
      continue;
    }
    if (index === 1 && !targetsEqual(context.target, target)) {
      diagnostics.push({
        kind: "context_target_mismatch",
        contextKind: kind,
        name: context.name,
        declaredTarget: context.target,
        appliesToTarget: target,
        filePath: context.provenance.filePath,
        causedBy: [describeProvenance(context.provenance)]
      });
    }

    if (!targetExists(target, model)) {
      diagnostics.push({
        kind: "invalid_context_target",
        contextKind: kind,
        name: context.name,
        targetKind: target.kind,
        target: target.name,
        filePath: context.provenance.filePath,
        causedBy: [describeProvenance(context.provenance)]
      });
    }
  }

  return diagnostics;
}

export function checkContextTargets(model: Model): SemanticDiagnostic[] {
  return allContexts(model).flatMap(({ kind, info }) => checkContextTarget(kind, info, model));
}

export function checkRequiredContext(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const { target, traits } of shapeTraitBearers(model)) {
    for (const requirement of requirementsForTarget(model, target.kind, traits)) {
      if (hasRequiredContext(requirement, target, model)) {
        continue;
      }

      const traitProvenance = traits.get(requirement.trait)!;
      diagnostics.push({
        kind: "missing_required_context",
        targetKind: target.kind,
        target: target.name,
        requiredContext: formatContextRequirement(requirement.contextType, target),
        requiredBy: requirement.trait,
        filePath: traitProvenance.filePath,
        causedBy: [describeProvenance(traitProvenance), describeProvenance(requirement.provenance)]
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
