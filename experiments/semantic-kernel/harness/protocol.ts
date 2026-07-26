import type { Fact } from "../../../packages/shp-checker/src/index.ts";

export const KERNEL_SCHEMA_VERSION = 1;

export type KernelProvenance = {
  filePath?: string;
  label: string;
};

export type KernelFactV1 =
  | {
      kind: "resource";
      name: string;
      provenance: KernelProvenance;
    }
  | {
      kind: "resource_fingerprint";
      resource: string;
      provider: string;
      value: string;
      provenance: KernelProvenance;
    }
  | {
      kind: "candidate_effect";
      name: string;
      anchor?: string;
      fingerprintProvider?: string;
      fingerprintValue?: string;
      provenance: KernelProvenance;
    };

export type KernelRequestV1 = {
  schemaVersion: typeof KERNEL_SCHEMA_VERSION;
  facts: KernelFactV1[];
};

export type KernelDiagnosticCauseRole = "candidate_effect" | "anchor" | "actual_fingerprint";

export type KernelDiagnosticV1 = {
  kind: "candidate_pin_fingerprint_mismatch";
  candidateEffect: string;
  anchor: string;
  provider: string;
  expected: string;
  actual?: string;
  causes: {
    role: KernelDiagnosticCauseRole;
    provenance: KernelProvenance;
  }[];
};

export type KernelResponseV1 = {
  schemaVersion: typeof KERNEL_SCHEMA_VERSION;
  ok: boolean;
  diagnostics: KernelDiagnosticV1[];
};

export function createKernelRequestV1(facts: readonly Fact[]): KernelRequestV1 {
  const selected: KernelFactV1[] = [];
  for (const fact of facts) {
    switch (fact.kind) {
      case "resource":
        selected.push({
          kind: fact.kind,
          name: fact.name,
          provenance: fact.provenance
        });
        break;
      case "resource_fingerprint":
        selected.push({
          kind: fact.kind,
          resource: fact.resource,
          provider: fact.provider,
          value: fact.value,
          provenance: fact.provenance
        });
        break;
      case "candidate_effect":
        selected.push({
          kind: fact.kind,
          name: fact.name,
          anchor: fact.anchor,
          fingerprintProvider: fact.fingerprintProvider,
          fingerprintValue: fact.fingerprintValue,
          provenance: fact.provenance
        });
        break;
      default:
        break;
    }
  }
  return {
    schemaVersion: KERNEL_SCHEMA_VERSION,
    facts: selected
  };
}

export function parseKernelResponseV1(json: string): KernelResponseV1 {
  const parsed: unknown = JSON.parse(json);
  if (!isKernelResponseV1(parsed)) {
    throw new Error("The semantic kernel returned an invalid protocol-v1 response.");
  }
  return parsed;
}

function isKernelResponseV1(value: unknown): value is KernelResponseV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "ok", "diagnostics"]) ||
    value.schemaVersion !== KERNEL_SCHEMA_VERSION ||
    typeof value.ok !== "boolean" ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every(isKernelDiagnosticV1)
  ) {
    return false;
  }
  return value.ok === (value.diagnostics.length === 0);
}

function isKernelDiagnosticV1(value: unknown): value is KernelDiagnosticV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "kind",
      "candidateEffect",
      "anchor",
      "provider",
      "expected",
      "actual",
      "causes"
    ]) ||
    value.kind !== "candidate_pin_fingerprint_mismatch" ||
    typeof value.candidateEffect !== "string" ||
    typeof value.anchor !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.expected !== "string" ||
    (value.actual !== undefined && typeof value.actual !== "string") ||
    !Array.isArray(value.causes)
  ) {
    return false;
  }
  if (!value.causes.every(isKernelDiagnosticCause)) {
    return false;
  }

  const expectedRoles: KernelDiagnosticCauseRole[] =
    value.actual === undefined
      ? ["candidate_effect", "anchor"]
      : ["candidate_effect", "anchor", "actual_fingerprint"];
  return (
    value.causes.length === expectedRoles.length &&
    value.causes.every((cause, index) => cause.role === expectedRoles[index])
  );
}

function isKernelDiagnosticCause(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["role", "provenance"]) &&
    isKernelDiagnosticCauseRole(value.role) &&
    isKernelProvenance(value.provenance)
  );
}

function isKernelDiagnosticCauseRole(value: unknown): value is KernelDiagnosticCauseRole {
  return value === "candidate_effect" || value === "anchor" || value === "actual_fingerprint";
}

function isKernelProvenance(value: unknown): value is KernelProvenance {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["filePath", "label"]) &&
    (value.filePath === undefined || typeof value.filePath === "string") &&
    typeof value.label === "string"
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
