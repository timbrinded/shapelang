// Provenance helpers: how a fact or model entry records where it came from, and
// how that origin is rendered for diagnostics. Kept separate from the data
// model so both lowering (which stamps provenance) and the rules (which describe
// it in diagnostics) depend on this leaf rather than on each other.
import type { Provenance, SemanticDiagnostic } from "./model.ts";

export function provenance(filePath: string | undefined, label: string): Provenance {
  return { filePath, label };
}

export function describeProvenance(prov: Provenance | undefined): string {
  if (!prov) {
    return "";
  }
  const label = prov.label.replace(/\b[A-Za-z_][\w.]*::/g, "");
  return prov.filePath ? `${prov.filePath}: ${label}` : label;
}

export function duplicateDeclaration(
  declarationKind: Extract<
    SemanticDiagnostic,
    { kind: "duplicate_declaration" }
  >["declarationKind"],
  name: string,
  existing: Provenance | undefined,
  duplicate: Provenance
): SemanticDiagnostic {
  return {
    kind: "duplicate_declaration",
    declarationKind,
    name,
    filePath: duplicate.filePath,
    causedBy: [describeProvenance(existing), describeProvenance(duplicate)]
  };
}

export function invalidRelation(
  name: string,
  reason: string,
  source: Provenance
): SemanticDiagnostic {
  return {
    kind: "invalid_relation",
    name,
    reason,
    filePath: source.filePath,
    causedBy: [describeProvenance(source)]
  };
}
