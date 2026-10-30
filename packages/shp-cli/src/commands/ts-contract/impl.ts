import { formatGateDiagnostics, runTsContractGate } from "@shape/shp-ts-contract/gate";
import type { CliContext } from "../../context";
import { setExitCode, stderr, stdout } from "../../io";

export type TsContractFlags = {
  readonly config: string;
  readonly runExternalCode?: boolean;
};

export default async function tsContract(this: CliContext, flags: TsContractFlags): Promise<void> {
  const result = await runTsContractGate({
    configPath: flags.config,
    runExternalCode: flags.runExternalCode === true
  });
  const diagnostics = formatGateDiagnostics(result.diagnostics);
  if (diagnostics) stderr(this, diagnostics);
  for (const output of result.nativeOutputs) {
    if (output.stdout) stdout(this, output.stdout);
    if (output.stderr) stderr(this, output.stderr);
  }
  if (result.ok) {
    const sourceCount = result.projects.reduce(
      (count, project) => count + project.sources.length,
      0
    );
    stdout(
      this,
      `TypeScript contracts passed for ${sourceCount} source file(s) in ${result.projects.length} project(s).\n`
    );
  }
  setExitCode(this, result.exitCode);
}
