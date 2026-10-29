export const TESTED_TYPESCRIPT_VERSION = "7.1.0-beta";
export const MAPPER_PACKAGE = "@shape/shp-ts-contract";

export type ContractProject = {
  name: string;
  tsconfig: string;
  include: string[];
  exclude: string[];
};

/** The validated configuration; version and compiler are checked, not carried. */
export type ContractConfig = {
  repoRoot: string;
  projects: ContractProject[];
};

export type GateDiagnosticKind =
  | "ambiguous_project"
  | "compiler_config_failed"
  | "compiler_failed"
  | "compiler_not_found"
  | "compiler_version_mismatch"
  | "consent_required"
  | "contract_not_in_project"
  | "empty_selection"
  | "gate_failed"
  | "invalid_compiler"
  | "invalid_config"
  | "invalid_contract"
  | "invalid_mapper"
  | "missing_contract"
  | "source_not_in_project"
  | "unexpected_contract"
  | "unreadable_config"
  | "unsafe_path"
  | "unsupported_compiler"
  | "unsupported_source";

export type GateDiagnostic = {
  kind: GateDiagnosticKind;
  path: string;
  message: string;
  causedBy: string[];
};

export type NativeOutput = {
  project: string;
  stage: "config" | "check";
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GateResult = {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  diagnostics: GateDiagnostic[];
  nativeOutputs: NativeOutput[];
  projects: { name: string; sources: string[] }[];
};

export class GateFailure extends Error {
  constructor(readonly diagnostic: GateDiagnostic) {
    super(diagnostic.message);
  }
}

export function fail(
  kind: GateDiagnosticKind,
  path: string,
  message: string,
  ...causedBy: string[]
): never {
  throw new GateFailure({ kind, path, message, causedBy });
}

export { compareCodepointStrings as compareText } from "@shape/shp-checker";

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
