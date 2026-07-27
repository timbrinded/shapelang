import type { Model, SemanticDiagnostic } from "../model.ts";
import { compareCodepointStrings } from "../../shape-strings.ts";
import { resourceRuleConditionCompatibility } from "../derivations.ts";
import { describeProvenance } from "../provenance.ts";

export function checkRules(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const rule of model.rules) {
    const hasFinalForbid = rule.forbidEffects.some((forbid) => forbid.final);
    if (!hasFinalForbid) {
      continue;
    }

    const subjects = [...new Set(rule.whenHas.map((when) => when.subject))].sort(
      compareCodepointStrings
    );
    if (subjects.length === 0) {
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: "final effect forbids require exactly one when subject",
        filePath: rule.provenance.filePath,
        causedBy: [describeProvenance(rule.provenance)]
      });
      continue;
    }
    if (subjects.length > 1) {
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: `final effect forbids may bind only one subject, but found ${subjects.join(", ")}`,
        filePath: rule.provenance.filePath,
        causedBy: [describeProvenance(rule.provenance)]
      });
      continue;
    }

    for (const condition of rule.whenHas) {
      const compatibility = resourceRuleConditionCompatibility(condition, model);
      if (compatibility.kind !== "invalid") {
        continue;
      }
      diagnostics.push({
        kind: "invalid_rule",
        rule: rule.name,
        reason: compatibility.reason,
        filePath: condition.provenance.filePath,
        causedBy: [
          describeProvenance(condition.provenance),
          describeProvenance(compatibility.traitProvenance)
        ]
      });
    }
  }

  return diagnostics;
}
