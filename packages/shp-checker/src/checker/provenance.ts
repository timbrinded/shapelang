// Provenance helpers: how a fact or model entry records where it came from, and
// how that origin is rendered for diagnostics. Kept separate from the data
// model so both lowering (which stamps provenance) and diagnostics (which
// describe it) depend on this leaf rather than on each other.
import type { Provenance } from "./model.ts";

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
