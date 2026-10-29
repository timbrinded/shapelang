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
  type GateResult,
  type NativeOutput
} from "./types.ts";

export type { GateDiagnostic, GateResult, NativeOutput } from "./types.ts";

export type RunTsContractGateOptions = {
  configPath: string;
  /** Explicit consent to execute the project's pinned compiler and content mapper. */
  runExternalCode: boolean;
};

type GateRun = { root: string; configPath: string; nativeOutputs: NativeOutput[] };
type PreparedProject = { project: ContractProject; compiler: Compiler };

/** Separate opt-in gate; ordinary Shape checks never execute source or compiler code. */
export async function runTsContractGate(options: RunTsContractGateOptions): Promise<GateResult> {
  const configPath = resolve(options.configPath);
  if (!options.runExternalCode) {
    return {
      ok: false,
      exitCode: 2,
      diagnostics: [
        {
          kind: "consent_required",
          path: configPath,
          message:
            "Pass --run-external-code to authorize the project-local compiler and native content mapper.",
          causedBy: []
        }
      ],
      nativeOutputs: [],
      projects: []
    };
  }
  const diagnostics: GateDiagnostic[] = [];
  const nativeOutputs: NativeOutput[] = [];
  const projects: GateResult["projects"] = [];
  const record = (error: unknown, path: string): void => {
    diagnostics.push(
      error instanceof GateFailure
        ? error.diagnostic
        : { kind: "gate_failed", path, message: errorText(error), causedBy: [configPath] }
    );
  };
  try {
    const config = await loadConfig(configPath);
    const run: GateRun = { root: config.repoRoot, configPath, nativeOutputs };
    const owners = new Map<string, string>();
    const ready: PreparedProject[] = [];
    for (const project of config.projects) {
      try {
        const sources = await selectedSources(config.repoRoot, project);
        projects.push({ name: project.name, sources });
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
        ready.push(await prepareProject(run, project, sources));
      } catch (error) {
        record(error, project.tsconfig);
      }
    }
    // Complete every inventory/configuration check before executing any mapper.
    if (diagnostics.length === 0) {
      for (const { project, compiler } of ready) {
        const checked = await runCompiler(compiler, project.tsconfig, false);
        nativeOutputs.push({ project: project.name, stage: "check", ...checked });
        if (checked.exitCode !== 0) {
          diagnostics.push({
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
  diagnostics.sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.kind, right.kind) ||
      compareText(left.message, right.message)
  );
  const ok = diagnostics.length === 0;
  return { ok, exitCode: ok ? 0 : 1, diagnostics, nativeOutputs, projects };
}

/** Every inventory and configuration check for one project; no mapper runs here. */
async function prepareProject(
  run: GateRun,
  project: ContractProject,
  sources: string[]
): Promise<PreparedProject> {
  const contracts: string[] = [];
  for (const source of sources) contracts.push(await validatePair(run.root, source));
  await validateMapper(project.tsconfig, run.root);
  const compiler = await resolveCompiler(project.tsconfig);
  const shown = await runCompiler(compiler, project.tsconfig, true);
  if (shown.exitCode !== 0) {
    run.nativeOutputs.push({ project: project.name, stage: "config", ...shown });
    fail(
      "compiler_config_failed",
      project.tsconfig,
      "The pinned compiler could not resolve this project; native diagnostics follow.",
      run.configPath
    );
  }
  const roots = compilerRoots(shown.stdout, project.tsconfig);
  rejectJavaScriptRoots(run.root, project, roots);
  const missingSource = sources.find((source) => !roots.has(source));
  if (missingSource) {
    fail(
      "source_not_in_project",
      missingSource,
      "Governed source must be a resolved compiler root file, not merely a transitive import.",
      project.tsconfig
    );
  }
  const missingContract = contracts.find((contract) => !roots.has(contract));
  if (missingContract) {
    fail(
      "contract_not_in_project",
      missingContract,
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
      run.configPath
    );
  }
  return { project, compiler };
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
