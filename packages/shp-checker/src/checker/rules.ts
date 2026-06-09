// Semantic rule engine orchestration. Domain checks live under checker/rules/*
// and this file owns only the deterministic ordering registry plus the public
// binding-rule re-export used by the checker API.
import type { Model, NormalizedCheckOptions, SemanticDiagnostic } from "./model.ts";
import { checkRules } from "./rules/declarations.ts";
import {
  checkContextTargets,
  checkReevaluations,
  checkRequiredContext,
  checkRequiredDescriptions
} from "./rules/context.ts";
import { checkCoverage } from "./rules/coverage.ts";
import { checkCandidateEffectFingerprints, checkFunctions } from "./rules/functions.ts";
import { checkFreshness, checkGuardedChanges } from "./rules/guards.ts";
import { checkResolvedNames } from "./rules/names.ts";
import {
  checkFingerprintExpectations,
  checkHypercycles,
  checkProvidesRules
} from "./rules/relations.ts";

export { checkBindings } from "./rules/coverage.ts";

/**
 * The deterministic order semantic checks run in. checkShapeModules flattens
 * this list (then appends binding enforcement, which CheckOptions gates), so the
 * order here is the single source of truth and is covered by tests. Freshness
 * and coverage read CheckOptions; every other check ignores its second argument.
 */
export const SEMANTIC_CHECKS: ReadonlyArray<
  (model: Model, options: NormalizedCheckOptions) => SemanticDiagnostic[]
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
  (model, options) => checkCoverage(model, options.changedFiles ?? [], options.repoRoot)
];

export function runSemanticChecks(
  model: Model,
  options: NormalizedCheckOptions
): SemanticDiagnostic[] {
  return SEMANTIC_CHECKS.flatMap((check) => check(model, options));
}
