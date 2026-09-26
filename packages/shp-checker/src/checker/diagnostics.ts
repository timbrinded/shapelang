// Diagnostic formatting: the product surface that renders a CheckResult and its
// individual diagnostics to the byte-for-byte text reviewers and CI read. This
// module depends on the model (diagnostic shapes) and the shared model-display
// helpers (checker/display.ts); nothing here lowers declarations or evaluates
// rules, so lowering and query code never import from diagnostics.
import type { CheckResult, SemanticDiagnostic, ShapeDiagnostic } from "./model.ts";
import type { ParseDiagnostic } from "../parser.ts";
import { compareCodepointStrings } from "../shape-strings.ts";
import { displaySymbol, formatTarget, formatTerm } from "./display.ts";

export function formatDiagnostics(result: CheckResult): string {
  if (result.diagnostics.length === 0) {
    return "Shape check passed.\n";
  }

  const diagnostics = result.diagnostics.map(formatDiagnostic).join("\n\n");
  return result.ok ? `${diagnostics}\n\nShape check passed with warnings.\n` : `${diagnostics}\n`;
}

// Canonical diagnostic order: by kind, then by rendered text. Checker output
// must be deterministic over the input set, not its source declaration order,
// so rule evaluation order is never allowed to leak into the diagnostics list.
export function compareShapeDiagnostics(left: ShapeDiagnostic, right: ShapeDiagnostic): number {
  const byKind = compareCodepointStrings(left.kind, right.kind);
  if (byKind !== 0) {
    return byKind;
  }
  return compareCodepointStrings(formatDiagnostic(left), formatDiagnostic(right));
}

function formatDiagnostic(diagnostic: ShapeDiagnostic): string {
  if (diagnostic.kind === "parse") {
    return formatParseDiagnostic(diagnostic);
  }
  const [heading, ...body] = diagnosticLines(diagnostic);
  return [heading, "", ...body, formatCausedBy(diagnostic.causedBy)].join("\n");
}

function diagnosticLines(diagnostic: SemanticDiagnostic): [string, ...string[]] {
  switch (diagnostic.kind) {
    case "final_forbidden_effect": {
      const evidence = diagnostic.evidence ? `\nevidence: ${diagnostic.evidence}` : "";
      return [
        "error: forbidden effect",
        `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
        `${displaySymbol(diagnostic.target)} has trait ${displaySymbol(diagnostic.trait)}.`,
        `${displaySymbol(diagnostic.trait)} forbids final ${formatTerm(diagnostic.effect, diagnostic.target)}.${evidence}`
      ];
    }
    case "missing_grant":
      return [
        "error: missing grant",
        `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
        `${displaySymbol(diagnostic.component)} does not grant ${formatTerm(diagnostic.effect, diagnostic.target)}.`
      ];
    case "unknown_effects":
      return [
        `${diagnostic.severity}: unknown effects`,
        `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} declares effects unknown.`
      ];
    case "unknown_name":
      return [
        `error: unknown ${diagnostic.nameKind}`,
        `${diagnostic.nameKind} ${displaySymbol(diagnostic.name)} is referenced but not declared.`
      ];
    case "ambiguous_name":
      return [
        `error: ambiguous ${diagnostic.nameKind}`,
        `${diagnostic.nameKind} ${diagnostic.name} matches more than one imported declaration.`,
        "Use a module-qualified reference.",
        `matches: ${diagnostic.matches.join(", ")}`
      ];
    case "invalid_rule":
      return [
        "error: invalid rule",
        `rule ${displaySymbol(diagnostic.rule)} is invalid: ${diagnostic.reason}.`
      ];
    case "duplicate_declaration":
      return [
        `error: duplicate ${diagnostic.declarationKind}`,
        `${diagnostic.declarationKind} ${displaySymbol(diagnostic.name)} is declared more than once.`
      ];
    case "duplicate_fingerprint":
      return [
        "error: duplicate fingerprint",
        `resource ${displaySymbol(diagnostic.resource)} declares fingerprint provider ${diagnostic.provider} more than once.`
      ];
    case "missing_shape_update":
      return [
        "error: governed source changed without current Shape update",
        `Changed file: ${diagnostic.changedFile}`,
        `Governed by: ${diagnostic.implementation}`,
        `Matched path: ${diagnostic.glob}`,
        "Required: update a current .shape file with matching source/evidence, or add a no_shape_change attestation."
      ];
    case "missing_bound_docs_change": {
      const attest =
        diagnostic.attestationKinds.length > 0
          ? `, or add ${diagnostic.attestationKinds.map((kind) => `attest ${kind}`).join(" or ")}`
          : "";
      return [
        "error: bound docs change missing",
        `binding ${diagnostic.binding} was triggered by ${diagnostic.changedFile}.`,
        `Required: change one of ${diagnostic.requiredPaths.join(", ")}${attest}.`
      ];
    }
    case "forbidden_path":
      return forbiddenPathLines(diagnostic);
    case "forbidden_hypercycle":
      return [
        "error: forbidden hypercycle",
        `rule ${displaySymbol(diagnostic.rule)} rejects this hypercycle:`,
        ...diagnostic.hyperedges.map((edge) => `  ${edge.kind} ${displaySymbol(edge.name)}`),
        `witness: ${diagnostic.vertices.map(displaySymbol).join(" -> ")}`
      ];
    case "forbidden_provides": {
      const allowed = diagnostic.allowedComponent
        ? ` except ${displaySymbol(diagnostic.allowedComponent)}`
        : "";
      return [
        "error: forbidden provides",
        `${displaySymbol(diagnostic.provider)} provides ${displaySymbol(diagnostic.target)} via relation ${displaySymbol(diagnostic.hyperedge)}.`,
        `rule ${displaySymbol(diagnostic.rule)} forbids provides ${displaySymbol(diagnostic.target)}${allowed}.`
      ];
    }
    case "fingerprint_mismatch": {
      const actual = diagnostic.actual ?? "missing";
      return [
        "error: stale fingerprint expectation",
        `relation ${displaySymbol(diagnostic.relation)} expects ${displaySymbol(diagnostic.endpoint)} fingerprint ${diagnostic.provider}.`,
        `expected: ${diagnostic.expected}`,
        `actual: ${actual}`
      ];
    }
    case "candidate_pin_fingerprint_mismatch": {
      const actual = diagnostic.actual ?? "missing";
      return [
        "error: stale candidate effect pin",
        `candidate effect ${displaySymbol(diagnostic.candidateEffect)} pins ${displaySymbol(diagnostic.anchor)} fingerprint ${diagnostic.provider}.`,
        `expected: ${diagnostic.expected}`,
        `actual: ${actual}`
      ];
    }
    case "invalid_candidate_effect":
      return [
        "error: invalid candidate effect",
        `candidate effect ${diagnostic.name}: ${diagnostic.reason}.`
      ];
    case "unsafe_effects":
      return [
        "error: unsafe effects missing policy metadata",
        `${displaySymbol(diagnostic.component)}.${diagnostic.functionName} declares unsafe effects.`,
        `Missing: ${diagnostic.missing.join(", ")}.`
      ];
    case "missing_required_context":
      return [
        "error: missing required context",
        `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} has shape ${displaySymbol(diagnostic.requiredBy)}.`,
        `${displaySymbol(diagnostic.requiredBy)} requires ${diagnostic.requiredContext}.`,
        "",
        "No matching rationale or memory found."
      ];
    case "invalid_context_target":
      return [
        "error: invalid context target",
        `${diagnostic.contextKind} ${displaySymbol(diagnostic.name)} applies to ${diagnostic.targetKind} ${displaySymbol(diagnostic.target)},`,
        "but that target is not declared."
      ];
    case "context_target_mismatch":
      return [
        "error: context target mismatch",
        `${diagnostic.contextKind} ${diagnostic.name} declares ${formatTarget(diagnostic.declaredTarget)},`,
        `but applies_to references ${formatTarget(diagnostic.appliesToTarget)}.`
      ];
    case "missing_required_description":
      return [
        "error: missing required description",
        `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} has shape ${displaySymbol(diagnostic.requiredBy)}.`,
        `${displaySymbol(diagnostic.requiredBy)} requires a description.`
      ];
    case "guarded_shape_changed":
      return [
        "error: guarded shape changed",
        `${diagnostic.targetKind} ${displaySymbol(diagnostic.target)} is protected by ${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)}.`,
        guardedShapeChangeSummary(diagnostic),
        "",
        "Required:",
        `  add ${diagnostic.missingReevaluation}`,
        "  or preserve the protected shape."
      ];
    case "invalid_reevaluation":
      return [
        "error: invalid reevaluation",
        `reevaluation ${diagnostic.name} is invalid: ${diagnostic.reason}.`
      ];
    case "stale_memory":
      return [
        "error: stale design memory",
        `${diagnostic.guardKind} ${displaySymbol(diagnostic.guard)} protects ${diagnostic.targetKind} ${displaySymbol(diagnostic.target)}.`,
        `Its review_by date ${diagnostic.reviewBy} is before ${diagnostic.asOf}.`,
        "",
        "Required:",
        "  review the design memory and update review_by, or replace it with a reevaluation."
      ];
    case "invalid_relation":
      return [
        "error: invalid relation",
        `relation ${diagnostic.name} is invalid: ${diagnostic.reason}.`
      ];
    case "invalid_require_context":
      return [
        "error: invalid require_context",
        `trait ${displaySymbol(diagnostic.trait)} require_context ${diagnostic.contextType}<${diagnostic.typeParam}> is invalid: ${diagnostic.reason}.`
      ];
    case "invalid_implementation":
      return [
        "error: invalid implementation",
        `implementation ${displaySymbol(diagnostic.name)} is invalid: ${diagnostic.reason}.`
      ];
    case "stale_attestation":
      return [
        "warning: stale attestation",
        `attest ${diagnostic.attestationKind} for ${diagnostic.path} is unchanged from the base model, so it no longer satisfies coverage or bindings.`,
        "Remove it with `shp attest prune`; git history keeps the decision."
      ];
    case "missing_cited_path":
      return [
        "error: missing cited path",
        `${diagnostic.path} is cited by the model but is not in the repository.`,
        "Update the citation to the file's new path, or remove it if the file is gone."
      ];
  }
}

function formatParseDiagnostic(diagnostic: ParseDiagnostic): string {
  const location = formatLocation(diagnostic.filePath, diagnostic.line, diagnostic.column);
  return `error: parse error\n\n${location} ${diagnostic.message}`;
}

function forbiddenPathLines(
  diagnostic: Extract<SemanticDiagnostic, { kind: "forbidden_path" }>
): [string, ...string[]] {
  const displayVertex = collisionAwareDisplay([
    diagnostic.source,
    diagnostic.target,
    ...diagnostic.steps.flatMap((step) => [step.from, step.to])
  ]);
  const displayRelation = collisionAwareDisplay(diagnostic.steps.map((step) => step.relation));
  return [
    "error: forbidden path",
    `rule ${displaySymbol(diagnostic.rule)} rejects this dependency path:`,
    ...diagnostic.steps.map(
      (step) =>
        `  ${step.kind} ${displayRelation(step.relation)}: ${displayVertex(step.from)} -> ${displayVertex(step.to)}`
    ),
    `witness: ${[diagnostic.source, ...diagnostic.steps.map((step) => step.to)]
      .map(displayVertex)
      .join(" -> ")}`
  ];
}

function collisionAwareDisplay(names: string[]): (name: string) => string {
  const canonicalNamesByLocalName = new Map<string, Set<string>>();
  for (const name of names) {
    const localName = displaySymbol(name);
    const canonicalNames = canonicalNamesByLocalName.get(localName) ?? new Set<string>();
    canonicalNames.add(name);
    canonicalNamesByLocalName.set(localName, canonicalNames);
  }
  return (name) =>
    (canonicalNamesByLocalName.get(displaySymbol(name))?.size ?? 0) > 1
      ? name
      : displaySymbol(name);
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
