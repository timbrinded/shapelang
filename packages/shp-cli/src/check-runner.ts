import {
  checkShapeFiles,
  formatDiagnostics,
  type CheckOptions,
  type CheckResult
} from "@shape/shp-checker";
import type { CliContext } from "./context";
import { setExitCode, stderr, stdout } from "./io";
import { providedOrDefaultShapeFiles } from "./shape-files";

export async function runShapeFileCheck(
  context: CliContext,
  providedFiles: readonly string[],
  options: CheckOptions
): Promise<CheckResult> {
  const files = await providedOrDefaultShapeFiles(providedFiles);
  const result = await checkShapeFiles(files, options);
  const output = formatDiagnostics(result);
  if (result.exitCode === 0) {
    stdout(context, output);
  } else {
    stderr(context, output);
  }
  setExitCode(context, result.exitCode);
  return result;
}
