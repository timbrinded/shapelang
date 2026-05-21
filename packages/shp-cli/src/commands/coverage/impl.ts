import { checkShapeFiles, formatDiagnostics } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { setExitCode, stderr, stdout } from "../../io";
import { defaultShapeFiles, readChangedFiles } from "../../shape-files";

export type CoverageFlags = {
  readonly changedFiles: string;
};

export default async function coverage(
  this: CliContext,
  flags: CoverageFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const changedFiles = await readChangedFiles(flags.changedFiles);
  const result = await checkShapeFiles(files, {
    changedFiles,
    enforceBindings: false
  });
  const output = formatDiagnostics(result);
  if (result.exitCode === 0) {
    stdout(this, output);
  } else {
    stderr(this, output);
  }
  setExitCode(this, result.exitCode);
}
