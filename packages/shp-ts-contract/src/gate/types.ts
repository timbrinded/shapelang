export const TESTED_TYPESCRIPT_VERSION = "7.1.0-beta";
export const MAPPER_PACKAGE = "@shape/shp-ts-contract";

export type ContractProject = {
  name: string;
  tsconfig: string;
  include: string[];
  exclude: string[];
};

export type ContractConfig = {
  version: 1;
  repoRoot: string;
  compiler: { package: "typescript"; version: typeof TESTED_TYPESCRIPT_VERSION };
  projects: ContractProject[];
};

export type GateDiagnostic = {
  kind: string;
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

export function fail(kind: string, path: string, message: string, ...causedBy: string[]): never {
  throw new GateFailure({ kind, path, message, causedBy });
}

export { compareCodepointStrings as compareText } from "@shape/shp-checker";

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
