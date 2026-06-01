// Diagnostic formatting: the product surface that renders a CheckResult and its
// individual diagnostics to the byte-for-byte text reviewers and CI read. This
// module depends on the model (diagnostic shapes) and the shared model-display
// helpers (checker/display.ts); nothing here lowers declarations or evaluates
// rules, so lowering and query code never import from diagnostics.
import type { CheckResult, SemanticDiagnostic, ShapeDiagnostic } from "./model.ts";
import type { ParseDiagnostic } from "../parser.ts";
import { displaySymbol, formatTarget, formatTerm } from "./display.ts";

export function formatDiagnostics(result: CheckResult): string {
  if (result.diagnostics.length === 0) {
    return "Shape check passed.\n";
  }

  return `${result.diagnostics.map(formatDiagnostic).join("\n\n")}\n`;
}

function formatDiagnostic(diagnostic: ShapeDiagnostic): string {
  switch (diagnostic.kind) {
    case "parse":
      return formatParseDiagnostic(diagnostic);
    case "final_forbidden_effect":
      return formatFinalForbiddenDiagnostic(diagnostic);
    case "missing_grant":
      return formatMissingGrantDiagnostic(diagnostic);
    case "unknown_effects":
      return formatUnknownEffectsDiagnostic(diagnostic);
    case "unknown_name":
      return formatUnknownNameDiagnostic(diagnostic);
    case "ambiguous_name":
      return formatAmbiguousNameDiagnostic(diagnostic);
    case "invalid_rule":
      return formatInvalidRuleDiagnostic(diagnostic);
    case "duplicate_declaration":
      return formatDuplicateDeclarationDiagnostic(diagnostic);
    case "duplicate_fingerprint":
      return formatDuplicateFingerprintDiagnostic(diagnostic);
    case "missing_shape_update":
      return formatMissingShapeUpdateDiagnostic(diagnostic);
    case "missing_bound_docs_change":
      return formatMissingBoundDocsChangeDiagnostic(diagnostic);
    case "forbidden_hypercycle":
      return formatForbiddenHypercycleDiagnostic(diagnostic);
    case "forbidden_provides":
      return formatForbiddenProvidesDiagnostic(diagnostic);
    case "fingerprint_mismatch":
      return formatFingerprintMismatchDiagnostic(diagnostic);
    case "candidate_pin_fingerprint_mismatch":
      return formatCandidatePinFingerprintMismatchDiagnostic(diagnostic);
    case "invalid_candidate_effect":
      return formatInvalidCandidateEffectDiagnostic(diagnostic);
    case "unsafe_effects":
      return formatUnsafeEffectsDiagnostic(diagnostic);
    case "missing_required_context":
      return formatMissingRequiredContextDiagnostic(diagnostic);
    case "invalid_context_target":
      return formatInvalidContextTargetDiagnostic(diagnostic);
    case "context_target_mismatch":
      return formatContextTargetMismatchDiagnostic(diagnostic);
    case "missing_required_description":
      return formatMissingRequiredDescriptionDiagnostic(diagnostic);
    case "guarded_shape_changed":
      return formatGuardedShapeChangedDiagnostic(diagnostic);
    case "invalid_reevaluation":
      return formatInvalidReevaluationDiagnostic(diagnostic);
    case "stale_memory":
      return formatStaleMemoryDiagnostic(diagnostic);
    case "invalid_relation":
      return formatInvalidRelationDiagnostic(diagnostic);
    case "invalid_require_context":
      return formatInvalidRequireContextDiagnostic(diagnostic);
  }
}

function formatParseDiagnostic(diagnostic: ParseDiagnostic): string {
  const location = formatLocation(diagnostic.filePath, diagnostic.line, diagnostic.column);
  return `error: parse error\n\n${location} ${diagnostic.message}`;
}

function formatFinalForbiddenDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "final_forbidden_effect" }>
): string {
  const evidence = diagnostic.evidence ? `\nevidence: ${diagnostic.evidence}` : "";
  return [
    "error: forbidden effect",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${displaySymbol(diagnostic.target)} has trait ${displaySymbol(diagnostic.trait)}.`,
    `${displaySymbol(diagnostic.trait)} forbids final ${formatTerm(diagnostic.effect, diagnostic.target)}.${evidence}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingGrantDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_grant" }>
): string {
  return [
    "error: missing grant",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${displaySymbol(diagnostic.component)} does not grant ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnknownEffectsDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_effects" }>
): string {
  return [
    "error: unknown effects",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} declares effects unknown.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnknownNameDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_name" }>
): string {
  return [
    `error: unknown ${diagnostic.nameKind}`,
    "",
    `${diagnostic.nameKind} ${displaySymbol(diagnostic.name)} is referenced but not declared.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatAmbiguousNameDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "ambiguous_name" }>
): string {
  return [
    `error: ambiguous ${diagnostic.nameKind}`,
    "",
    `${diagnostic.nameKind} ${diagnostic.name} matches more than one imported declaration.`,
    "Use a module-qualified reference.",
    `matches: ${diagnostic.matches.join(", ")}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidRuleDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_rule" }>
): string {
  return [
    "error: invalid rule",
    "",
    `rule ${displaySymbol(diagnostic.rule)} is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatDuplicateDeclarationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "duplicate_declaration" }>
): string {
  return [
    `error: duplicate ${diagnostic.declarationKind}`,
    "",
    `${diagnostic.declarationKind} ${displaySymbol(diagnostic.name)} is declared more than once.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatDuplicateFingerprintDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "duplicate_fingerprint" }>
): string {
  return [
    "error: duplicate fingerprint",
    "",
    `resource ${displaySymbol(diagnostic.resource)} declares fingerprint provider ${diagnostic.provider} more than once.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingShapeUpdateDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_shape_update" }>
): string {
  return [
    "error: governed source changed without current Shape update",
    "",
    `Changed file: ${diagnostic.changedFile}`,
    `Governed by: ${diagnostic.implementation}`,
    `Matched path: ${diagnostic.glob}`,
    "Required: update a current .shape file with matching source/evidence, or add a no_shape_change attestation.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingBoundDocsChangeDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_bound_docs_change" }>
): string {
  const attest =
    diagnostic.attestationKinds.length > 0
      ? `, or add ${diagnostic.attestationKinds.map((kind) => `attest ${kind}`).join(" or ")}`
      : "";
  return [
    "error: bound docs change missing",
    "",
    `binding ${diagnostic.binding} was triggered by ${diagnostic.changedFile}.`,
    `Required: change one of ${diagnostic.requiredPaths.join(", ")}${attest}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatForbiddenHypercycleDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_hypercycle" }>
): string {
  return [
    "error: forbidden hypercycle",
    "",
    `rule ${displaySymbol(diagnostic.rule)} rejects this hypercycle:`,
    ...diagnostic.hyperedges.map((edge) => `  ${edge.kind} ${displaySymbol(edge.name)}`),
    `witness: ${diagnostic.vertices.map(displaySymbol).join(" -> ")}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatForbiddenProvidesDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_provides" }>
): string {
  const allowed = diagnostic.allowedComponent
    ? ` except ${displaySymbol(diagnostic.allowedComponent)}`
    : "";
  return [
    "error: forbidden provides",
    "",
    `${displaySymbol(diagnostic.provider)} provides ${displaySymbol(diagnostic.target)} via relation ${displaySymbol(diagnostic.hyperedge)}.`,
    `rule ${displaySymbol(diagnostic.rule)} forbids provides ${displaySymbol(diagnostic.target)}${allowed}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatFingerprintMismatchDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "fingerprint_mismatch" }>
): string {
  const actual = diagnostic.actual ?? "missing";
  return [
    "error: stale fingerprint expectation",
    "",
    `relation ${displaySymbol(diagnostic.relation)} expects ${displaySymbol(diagnostic.endpoint)} fingerprint ${diagnostic.provider}.`,
    `expected: ${diagnostic.expected}`,
    `actual: ${actual}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatCandidatePinFingerprintMismatchDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "candidate_pin_fingerprint_mismatch" }>
): string {
  const actual = diagnostic.actual ?? "missing";
  return [
    "error: stale candidate effect pin",
    "",
    `candidate effect ${displaySymbol(diagnostic.candidateEffect)} pins ${displaySymbol(diagnostic.anchor)} fingerprint ${diagnostic.provider}.`,
    `expected: ${diagnostic.expected}`,
    `actual: ${actual}`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidCandidateEffectDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_candidate_effect" }>
): string {
  return [
    "error: invalid candidate effect",
    "",
    `candidate effect ${diagnostic.name}: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatUnsafeEffectsDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "unsafe_effects" }>
): string {
  return [
    "error: unsafe effects missing policy metadata",
    "",
    `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} declares unsafe effects.`,
    `Missing: ${diagnostic.missing.join(", ")}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingRequiredContextDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_required_context" }>
): string {
  return [
    "error: missing required context",
    "",
    `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} has shape ${displaySymbol(diagnostic.requiredBy)}.`,
    `${displaySymbol(diagnostic.requiredBy)} requires ${diagnostic.requiredContext}.`,
    "",
    "No matching rationale or memory found.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidContextTargetDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_context_target" }>
): string {
  return [
    "error: invalid context target",
    "",
    `${diagnostic.contextKind} ${displaySymbol(diagnostic.name)} applies to ${diagnostic.targetKind} ${displaySymbol(diagnostic.target)},`,
    "but that target is not declared.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatContextTargetMismatchDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "context_target_mismatch" }>
): string {
  return [
    "error: context target mismatch",
    "",
    `${diagnostic.contextKind} ${diagnostic.name} declares ${formatTarget(diagnostic.declaredTarget)},`,
    `but applies_to references ${formatTarget(diagnostic.appliesToTarget)}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatMissingRequiredDescriptionDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_required_description" }>
): string {
  return [
    "error: missing required description",
    "",
    `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} has shape ${displaySymbol(diagnostic.requiredBy)}.`,
    `${displaySymbol(diagnostic.requiredBy)} requires a description.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function guardedShapeChangeSummary(
  diagnostic: Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }>
): string {
  if (diagnostic.changeKind === "transform" && diagnostic.changedProperty) {
    return `This change applies the ${diagnostic.changedProperty} transform to the guarded target.`;
  }
  if (diagnostic.changeKind === "property" && diagnostic.changedProperty) {
    return `This change removes ${diagnostic.changedProperty} from the guarded target.`;
  }
  return "This change modifies the guarded target.";
}

function formatGuardedShapeChangedDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "guarded_shape_changed" }>
): string {
  return [
    "error: guarded shape changed",
    "",
    `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} is protected by ${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)}.`,
    guardedShapeChangeSummary(diagnostic),
    "",
    "Required:",
    `  add ${diagnostic.missingReevaluation}`,
    "  or preserve the protected shape.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidReevaluationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_reevaluation" }>
): string {
  return [
    "error: invalid reevaluation",
    "",
    `reevaluation ${diagnostic.name} is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatStaleMemoryDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "stale_memory" }>
): string {
  return [
    "error: stale design memory",
    "",
    `${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)} protects ${diagnostic.targetKind} ${displaySymbol(diagnostic.target)}.`,
    `Its review_by date ${diagnostic.reviewBy} is before ${diagnostic.asOf}.`,
    "",
    "Required:",
    "  review the design memory and update review_by, or replace it with a reevaluation.",
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidRelationDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_relation" }>
): string {
  return [
    "error: invalid relation",
    "",
    `relation ${diagnostic.name} is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatInvalidRequireContextDiagnostic(
  diagnostic: Extract<SemanticDiagnostic, { kind: "invalid_require_context" }>
): string {
  return [
    "error: invalid require_context",
    "",
    `trait ${displaySymbol(diagnostic.trait)} require_context ${diagnostic.contextType}<${diagnostic.typeParam}> is invalid: ${diagnostic.reason}.`,
    formatCausedBy(diagnostic.causedBy)
  ].join("\n");
}

function formatCausedBy(causedBy: string[]): string {
  const lines = causedBy.filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }
  return ["", "caused by:", ...lines.map((line) => `  - ${line}`)].join("\n");
}

function formatLocation(filePath: string, line?: number, column?: number): string {
  if (line === undefined) {
    return `${filePath}:`;
  }
  if (column === undefined) {
    return `${filePath}:${line}:`;
  }
  return `${filePath}:${line}:${column}:`;
}
