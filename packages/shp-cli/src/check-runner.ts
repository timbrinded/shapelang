import {
  checkShapeFiles,
  formatDiagnostics,
  type CheckOptions,
  type CheckResult
} from "@shape/shp-checker";
import { requireCandidateFiles } from "./check-input";
import type { CliContext } from "./context";
import { setExitCode, stderr, stdout } from "./io";
import { providedOrDefaultShapeFiles } from "./shape-files";

export async function runShapeFileCheck(
  context: CliContext,
  providedFiles: readonly string[],
  options: CheckOptions,
  json = false
): Promise<CheckResult> {
  const files = await providedOrDefaultShapeFiles(providedFiles);
  if (options.transition) requireCandidateFiles(files, options.repoRoot ?? process.cwd());
  const result = await checkShapeFiles(files, options);
  const output = json ? JSON.stringify(result) + "\n" : formatDiagnostics(result);
  if (json || result.exitCode === 0) {
    stdout(context, output);
  } else {
    stderr(context, output);
  }
  setExitCode(context, result.exitCode);
  return result;
}
