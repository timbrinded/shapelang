import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import {
  compilerRoots,
  resolveCompiler,
  runCompiler,
  validateMapper,
  type Compiler
} from "./compiler.ts";
import { rejectJavaScriptRoots, selectedSources, validatePair } from "./inventory.ts";
import {
  compareText,
  errorText,
  fail,
  GateFailure,
  type ContractProject,
  type GateDiagnostic,
  type GateResult
} from "./types.ts";

export type { GateDiagnostic, GateResult, NativeOutput } from "./types.ts";

export type RunTsContractGateOptions = {
  configPath: string;
  /** Explicit consent to execute the project's pinned compiler and content mapper. */
  runExternalCode: boolean;
};

/** Separate opt-in gate; ordinary Shape checks never execute source or compiler code. */
export async function runTsContractGate(options: RunTsContractGateOptions): Promise<GateResult> {
  const configPath = resolve(options.configPath);
  const result: GateResult = {
    ok: false,
    exitCode: 1,
    diagnostics: [],
    nativeOutputs: [],
    projects: []
  };
  if (!options.runExternalCode) {
    result.exitCode = 2;
    result.diagnostics.push({
      kind: "consent_required",
      path: configPath,
      message:
        "Pass --run-external-code to authorize the project-local compiler and native content mapper.",
      causedBy: []
    });
    return result;
  }
  const record = (error: unknown, path: string): void => {
    result.diagnostics.push(
      error instanceof GateFailure
        ? error.diagnostic
        : {
            kind: "gate_failed",
            path,
            message: errorText(error),
            causedBy: [configPath]
          }
    );
  };
  try {
    const config = await loadConfig(configPath);
    const owners = new Map<string, string>();
    const ready: { project: ContractProject; compiler: Compiler }[] = [];
    for (const project of config.projects) {
      try {
        const sources = await selectedSources(config.repoRoot, project);
        result.projects.push({ name: project.name, sources });
        for (const source of sources) {
          const owner = owners.get(source);
          if (owner)
            fail(
              "ambiguous_project",
              source,
              `Source is selected by both ${owner} and ${project.name}; make project selections disjoint.`,
              configPath
            );
          owners.set(source, project.name);
        }
        const contracts: string[] = [];
        for (const source of sources) contracts.push(await validatePair(config.repoRoot, source));
        await validateMapper(project, config.repoRoot);
        const compiler = await resolveCompiler(project.tsconfig);
        const shown = await runCompiler(compiler, project, true);
        if (shown.exitCode !== 0) {
          result.nativeOutputs.push({ project: project.name, stage: "config", ...shown });
          fail(
            "compiler_config_failed",
            project.tsconfig,
            "The pinned compiler could not resolve this project; native diagnostics follow.",
            configPath
          );
        }
        const roots = compilerRoots(shown.stdout, project);
        rejectJavaScriptRoots(config.repoRoot, project, roots);
        for (const source of sources) {
          if (!roots.has(source))
            fail(
              "source_not_in_project",
              source,
              "Governed source must be a resolved compiler root file, not merely a transitive import.",
              project.tsconfig
            );
        }
        for (const contract of contracts) {
          if (!roots.has(contract))
            fail(
              "contract_not_in_project",
              contract,
              "Sibling contract must be a resolved compiler root file; include it explicitly or with a matching include pattern.",
              project.tsconfig
            );
        }
        const selectedContracts = new Set(contracts);
        const unexpectedContract = [...roots]
          .filter((path) => path.endsWith(".shape") && !selectedContracts.has(path))
          .sort(compareText)[0];
        if (unexpectedContract) {
          fail(
            "unexpected_contract",
            unexpectedContract,
            `This .shape compiler root has no governed sibling source in project ${project.name}; remove it from the project or explicitly include its source in the gate's scope.`,
            project.tsconfig,
            configPath
          );
        }
        ready.push({ project, compiler });
      } catch (error) {
        record(error, project.tsconfig);
      }
    }
    // Complete every inventory/configuration check before executing any mapper.
    if (result.diagnostics.length === 0) {
      for (const { project, compiler } of ready) {
        const checked = await runCompiler(compiler, project, false);
        result.nativeOutputs.push({ project: project.name, stage: "check", ...checked });
        if (checked.exitCode !== 0) {
          result.diagnostics.push({
            kind: "compiler_failed",
            path: project.tsconfig,
            message: `Native TypeScript contract checking failed with exit ${checked.exitCode}; native diagnostics follow.`,
            causedBy: [configPath]
          });
        }
      }
    }
  } catch (error) {
    record(error, configPath);
  }
  result.diagnostics.sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.kind, right.kind) ||
      compareText(left.message, right.message)
  );
  result.ok = result.diagnostics.length === 0;
  result.exitCode = result.ok ? 0 : 1;
  return result;
}

export function formatGateDiagnostics(diagnostics: readonly GateDiagnostic[]): string {
  return (
    diagnostics
      .map((diagnostic) =>
        [
          `error: ${diagnostic.kind}`,
          `${diagnostic.path}: ${diagnostic.message}`,
          ...(diagnostic.causedBy.length
            ? ["caused by:", ...diagnostic.causedBy.map((cause) => `  - ${cause}`)]
            : [])
        ].join("\n")
      )
      .join("\n\n") + (diagnostics.length ? "\n" : "")
  );
}
