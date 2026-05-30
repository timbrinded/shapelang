import { checkShapeFiles, formatDiagnostics } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { setExitCode, stderr, stdout } from "../../io";
import { defaultShapeFiles, isoToday, readChangedFiles } from "../../shape-files";

export type CheckFlags = {
  readonly changedFiles?: string;
  readonly strictFreshness?: boolean;
};

export default async function check(
  this: CliContext,
  flags: CheckFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const changedFiles =
    flags.changedFiles !== undefined ? await readChangedFiles(flags.changedFiles) : undefined;
  const result = await checkShapeFiles(files, {
    changedFiles,
    enforceBindings: true,
    freshnessDate: flags.strictFreshness ? isoToday() : undefined
  });
  const output = formatDiagnostics(result);
  if (result.exitCode === 0) {
    stdout(this, output);
  } else {
    stderr(this, output);
  }
  setExitCode(this, result.exitCode);
}
