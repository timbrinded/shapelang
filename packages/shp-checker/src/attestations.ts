import { createHash } from "node:crypto";
import type { SemanticDiagnostic } from "./checker/model.ts";

export type AttestationMode = "repo" | "pr";
export type CheckTransition = { base: string; head: string };
export type ShapeAttestationV1 = {
  obligation: string;
  kind: "no-shape-change";
  rationale: string;
};
export type ShapeAttestationBundleV1 = CheckTransition & {
  version: 1;
  attestations: ShapeAttestationV1[];
};
export type AttestationObligation = {
  id: string;
  type: "shape-change-or-attestation";
  message: string;
  paths: string[];
  satisfied: boolean;
};
export type AttestationErrorCode =
  | "malformed"
  | "unsupported_version"
  | "stale"
  | "unknown_obligation"
  | "conflicting_duplicates"
  | "invalid_mode"
  | "missing_transition";
export class AttestationError extends Error {
  constructor(
    readonly code: AttestationErrorCode,
    message: string
  ) {
    super(message);
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function parseAttestationBundle(value: unknown): ShapeAttestationBundleV1 {
  if (!isRecord(value))
    throw new AttestationError("malformed", "Attestation bundle must be an object.");
  if (value.version !== 1)
    throw new AttestationError("unsupported_version", "Attestation bundle requires version 1.");
  if (
    !exactKeys(value, ["version", "base", "head", "attestations"]) ||
    typeof value.base !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.base) ||
    typeof value.head !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.head) ||
    !Array.isArray(value.attestations)
  ) {
    throw new AttestationError(
      "malformed",
      "Expected full base/head commit IDs and an attestations array (no extra fields)."
    );
  }
  const attestations = value.attestations.map((item: unknown): ShapeAttestationV1 => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ["obligation", "kind", "rationale"]) ||
      typeof item.obligation !== "string" ||
      !/^shp-obligation-[a-f0-9]{64}$/.test(item.obligation) ||
      item.kind !== "no-shape-change" ||
      typeof item.rationale !== "string" ||
      !item.rationale.trim()
    ) {
      throw new AttestationError(
        "malformed",
        "Each attestation requires an obligation ID, no-shape-change kind, and non-empty rationale."
      );
    }
    return { obligation: item.obligation, kind: item.kind, rationale: item.rationale };
  });
  const seen = new Map<string, string>();
  for (const item of attestations) {
    if (seen.has(item.obligation) && seen.get(item.obligation) !== item.rationale) {
      throw new AttestationError(
        "conflicting_duplicates",
        `Conflicting attestations for ${item.obligation}.`
      );
    }
    seen.set(item.obligation, item.rationale);
  }
  return { version: 1, base: value.base, head: value.head, attestations };
}

/** Identity excludes machine-local provenance paths and diagnostic rendering. */
export function attestationObligation(
  diagnostic: Extract<SemanticDiagnostic, { kind: "missing_shape_update" }>,
  transition: CheckTransition
): AttestationObligation {
  const identity = JSON.stringify([
    1,
    transition.base,
    transition.head,
    diagnostic.kind,
    diagnostic.implementation,
    diagnostic.glob,
    diagnostic.changedFile
  ]);
  return {
    id: `shp-obligation-${createHash("sha256").update(identity).digest("hex")}`,
    type: "shape-change-or-attestation",
    message: `${diagnostic.changedFile} requires a shape update or no-shape-change attestation (${diagnostic.implementation}).`,
    paths: [diagnostic.changedFile],
    satisfied: false
  };
}

/** Validate all evidence before applying any; only explicit coverage obligations are attestable. */
export function applyAttestations(
  diagnostics: SemanticDiagnostic[],
  transition: CheckTransition,
  evidence?: unknown
): { diagnostics: SemanticDiagnostic[]; obligations: AttestationObligation[] } {
  if (
    ![transition.base, transition.head].every((revision) =>
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)
    )
  ) {
    throw new AttestationError(
      "missing_transition",
      "Checked transition requires full base/head commit IDs."
    );
  }
  const byDiagnostic = new Map<SemanticDiagnostic, AttestationObligation>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.kind === "missing_shape_update") {
      byDiagnostic.set(diagnostic, attestationObligation(diagnostic, transition));
    }
  }
  const obligations = [
    ...new Map([...byDiagnostic.values()].map((item) => [item.id, item])).values()
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const accepted = new Set<string>();
  if (evidence !== undefined) {
    const bundle = parseAttestationBundle(evidence);
    if (bundle.base !== transition.base || bundle.head !== transition.head) {
      throw new AttestationError(
        "stale",
        "Attestation base/head does not match the checked transition."
      );
    }
    const known = new Set(obligations.map((item) => item.id));
    for (const item of bundle.attestations) {
      if (!known.has(item.obligation))
        throw new AttestationError("unknown_obligation", `Unknown obligation: ${item.obligation}.`);
      accepted.add(item.obligation);
    }
  }
  return {
    diagnostics: diagnostics.filter((item) => !accepted.has(byDiagnostic.get(item)?.id ?? "")),
    obligations: obligations.map((item) => ({ ...item, satisfied: accepted.has(item.id) }))
  };
}
