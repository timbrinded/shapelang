import type { FunctionInfo, Model, SemanticDiagnostic } from "../model.ts";
import { formatSourceRefInfo, termKey } from "../display.ts";
import { describeProvenance } from "../provenance.ts";
import { findFinalForbidden, shouldIgnoreUnknownEffectsDiagnostic } from "../derivations.ts";

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
