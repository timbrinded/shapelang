import type { MemoryInfo, Model, RationaleInfo, SemanticDiagnostic } from "../model.ts";
import type { ContextKind } from "../../prelude.ts";
import { formatContextRequirement, functionKey } from "../display.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import {
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
